package policyobject

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

// How a request becomes an authenticated session on a firewall.
//
// Every device-proxy handler in this package starts here, which is why the per-user access check,
// the credential lookup and the request's context all live in these two functions rather than being
// repeated across roughly a hundred routes — a check written a hundred times is a check missing
// from one of them.
//
// Lifted out of device_proxy.go, which had grown past the size this repo tracks in
// backend/test/layout-budget.json while holding two different things: the session plumbing, and the
// policy and address handlers built on top of it.

// defaultAPIPort is the HTTPS port for FortiGate REST API.
//
// Aliased from services rather than redeclared: the port is part of the session-pool key, so a
// handler here and services.buildLiveDeviceContext (the AI Assistant) must agree on it or they
// open two sessions to the same device instead of sharing the one the pool keeps warm.
const defaultAPIPort = services.DefaultAPIPort

// ── shared: get device + build FortiGate client ──────────────────────────────

type deviceInfo struct {
	Device entity.NetworkDevice

	// Login is the account this request reaches the firewall with, resolved once by getDeviceInfo.
	// It carries WHICH stored credential it came from, not just a username and password, because
	// that identity is what the session pool keys on — see services.DeviceLogin.PoolScope.
	Login services.DeviceLogin
}

// Convenience accessors, so the ~100 handlers below read as before.
func (d *deviceInfo) Username() string   { return d.Login.Username }
func (d *deviceInfo) Password() string   { return d.Login.Password }
func (d *deviceInfo) Personal() bool     { return d.Login.Personal }
func (d *deviceInfo) CredentialID() uint { return d.Login.CredentialID }

// getDeviceInfo loads the request's device and decides which account to reach it with.
//
// This is the single place the whole device-proxy layer answers "log in as whom?", so mapping a
// personal FortiGate account to a device (Profile ▸ Device Credentials) takes effect across every
// handler below — policies, objects, security profiles, VPN, interfaces, the dashboard and the SSH
// diagnostics that build on diagTarget — without any of them being touched.
//
// That is the point of the feature: the firewall's own event log stops attributing everything to
// one shared `admin` and starts naming the person who actually did it.
func getDeviceInfo(c *gin.Context) (*deviceInfo, bool) {
	idStr := c.Param("deviceId")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device id"})
		return nil, false
	}

	role := c.GetString("user_role")
	// Read-only accounts (Phase A4) may see every page a normal user can, but never change one. A
	// write recognised as a genuine CMDB object write (services.ResolveChangeTarget — the same
	// classifier the Change Ledger and the mandatory-approval gate use, so teaching the app a new
	// resource type keeps all three in step) is refused outright. A POST that merely previews,
	// simulates or re-runs a scan is not in that classifier and stays open — a read-only auditor can
	// still run Troubleshooting, Audit and Impact Preview, which is the point of the role.
	isWrite := false
	if role == "readonly" {
		_, isWrite = services.ResolveChangeTarget(c.Request.Method, deviceRouteTail(c, idStr))
	}

	uid, _ := c.Get("user_id")
	di, err := resolveDeviceInfoByID(config.DB(), services.UserIDOf(uid), role, uint(id), isWrite)
	if err != nil {
		switch {
		case errors.Is(err, errDeviceNotFound):
			// 404 rather than 403: see the note in networkdevice.GetByID.
			c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		case errors.Is(err, errReadOnlyWrite):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return nil, false
	}
	return di, true
}

// errDeviceNotFound and errReadOnlyWrite are sentinels so callers of resolveDeviceInfoByID — both
// getDeviceInfo and the fleet-apply handlers, which loop over several devices instead of reading
// one :deviceId — can each present the same two refusals their own way, rather than resolveDeviceInfoByID
// having to know how to write a gin response.
var (
	errDeviceNotFound = errors.New("device not found")
	errReadOnlyWrite  = errors.New("read-only account: cannot write to this device")
)

// resolveDeviceInfoByID is the device-lookup half of getDeviceInfo, taking an explicit id instead of
// a *gin.Context's :deviceId — the one place fleet handlers (fleet_apply.go) and getDeviceInfo both
// go through, so a request naming one device in its path and a request looping over several get the
// exact same access and role checks. isWrite decides whether the read-only role refusal applies;
// getDeviceInfo computes it from the real request, fleet handlers know it outright since they are
// never used for a read.
func resolveDeviceInfoByID(db *gorm.DB, uid uint, role string, deviceID uint, isWrite bool) (*deviceInfo, error) {
	var device entity.NetworkDevice
	if err := db.First(&device, deviceID).Error; err != nil {
		return nil, errDeviceNotFound
	}

	isAdmin := role == "admin"
	// Per-user device access, enforced for the WHOLE proxy layer in one place — the same reason the
	// credential lookup below lives here. Roughly a hundred routes take a :deviceId, and a check
	// that had to be repeated on each of them would be missing from one of them by now.
	if !services.UserCanAccessDevice(db, uid, isAdmin, device.ID) {
		return nil, errDeviceNotFound
	}

	if isWrite && role == "readonly" {
		return nil, errReadOnlyWrite
	}

	login, err := services.ResolveDeviceLogin(db, uid, &device)
	if err != nil {
		return nil, err
	}
	return &deviceInfo{Device: device, Login: login}, nil
}

// deviceRouteTail returns the part of the request path after "/policy/device/<idStr>/", the same
// slice services.ResolveChangeTarget expects — mirrors middleware.ChangeRecorder's resolveRequest,
// which cannot be called from here (different package) and is not exported, since it is Gin
// middleware shaped and this is a plain helper on an already-parsed request.
func deviceRouteTail(c *gin.Context, idStr string) string {
	prefix := "/policy/device/" + idStr + "/"
	path := c.Request.URL.EscapedPath()
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	return strings.TrimPrefix(path, prefix)
}

// getAPIPort returns the HTTPS port to reach the device's REST API on.
//
// It used to accept an `?api_port=` override from the query string, any value in 1..65535. Nothing
// ever sent one — no page in the console, no API wrapper — so it was a caller-controlled input
// with no caller, and it fed the session-pool key (services.AcquireFortiClient keys on device+port).
// A loop over 65,000 ports would therefore have opened a pool entry per port, each one a login
// attempt against a firewall that locks an admin account after three failures.
//
// Now per-device, from `device.api_port` (Devices ▸ edit), where an administrator sets it once — not
// on a query parameter every request can choose for itself. The device's `Port` column is the SSH
// port and is deliberately not reused here (see device_diagnostics.go). A row created before this
// field existed carries the GORM column default (443), so nothing already working changes.
func getAPIPort(di *deviceInfo) int {
	if di.Device.APIPort != 0 {
		return di.Device.APIPort
	}
	return defaultAPIPort
}

// buildClient returns an authenticated FortiGate client for the request's device.
//
// The session comes from a pool (services.AcquireFortiClient) and is SHARED, so handlers must not
// call Logout on it — doing so would close the session out from under every other in-flight
// request. It expires on its own well inside the device's admintimeout, and do() re-authenticates
// transparently if the device drops it early.
func buildClient(c *gin.Context, di *deviceInfo) (deviceClient, bool) {
	fc, err := buildClientOrErr(c, di)
	if err != nil {
		if di.Personal() {
			// Say whose account failed. Otherwise "FortiGate login failed" on a page that worked
			// yesterday sends the user to check the device, when what changed is the password on
			// the account THEY mapped — and every retry spends one of the three attempts the
			// firewall allows before it locks that account.
			c.JSON(http.StatusBadGateway, gin.H{
				"error": fmt.Sprintf(
					"FortiGate login failed for your own device account %q: %s — check it in Profile ▸ Device Credentials",
					di.Username(), err.Error()),
			})
			return nil, false
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "FortiGate login failed: " + err.Error()})
		return nil, false
	}
	return fc, true
}

// deviceSession is how a device-proxy handler starts: one call for "which firewall, as whom, and
// give me a session on it".
//
// It is getDeviceInfo + buildClient, which every one of the ~190 routes in this package used to
// write out by hand:
//
//	di, ok := getDeviceInfo(c)
//	if !ok { return }
//	fc, ok := buildClient(c, di)
//	if !ok { return }
//
// Eight lines, repeated ~190 times, each of them a place the second half could be forgotten — and
// a handler that forgot it would not fail, it would reach the firewall with no session and no
// per-user credential. Now there is one call, and device_session_db_test.go fails the build of any
// handler that reaches a client another way.
//
// Everything that decides WHETHER this request may touch this firewall stays where it was, inside
// the two halves: the per-user device grant and the read-only refusal in getDeviceInfo, the
// credential resolution, session pool, VDOM and request cancellation in acquireDeviceClient. This
// function adds no policy of its own; it only makes the pair impossible to half-apply.
//
// It writes its own refusal (404 unknown or ungranted device, 403 a read-only account on a write,
// 502 a login that never answered) and reports ok=false, so a handler reads:
//
//	di, fc, ok := deviceSession(c)
//	if !ok { return }
//
// di is still returned because handlers need the device itself — its name for a change-ledger
// entry, its MgmtIP for the SSH diagnostics, CredentialID for the live-stream hub key.
//
// The handlers that validate input first (a JSON body, an unparseable :id) still call the two
// halves separately, with their 400 in between, so a malformed request is still refused without a
// login to a firewall ever being attempted. Those are held to the canonical shape by
// TestTheSecondHalfIsAlwaysTheCanonicalPair; what no caller anywhere may do is build a deviceInfo
// or acquire a session itself, which is the guard that replaced reading ~190 prologues by eye.
func deviceSession(c *gin.Context) (*deviceInfo, deviceClient, bool) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return nil, nil, false
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return nil, nil, false
	}
	return di, fc, true
}

// ── what the firewall said no with, as an HTTP status ────────────────────────

// respondDeviceError writes the HTTP answer for a failed device call and reports whether it wrote
// one (false only when err is nil, so call sites read `if respondDeviceError(...) { return }`).
//
// ── The bug ──────────────────────────────────────────────────────────────────
//
// Every one of these call sites answered 502 Bad Gateway:
//
//	c.JSON(http.StatusBadGateway, gin.H{"error": "FortiGate error: " + err.Error()})
//
// 502 means "the upstream did not give me a usable answer". But a FortiOS -5 (that name is already
// taken) or -23 (something still points at this object) is the firewall ANSWERING, clearly and
// correctly, about the caller's own input. Reporting it as 502 told the browser the firewall was
// broken when the firewall was fine and the form was wrong — so the page could not tell "fix your
// input" from "the device is down", and could not retry, or not retry, on the right one.
//
// What the frontend did instead was search the message text for "-5". That is the substring trap
// this repo has been bitten by twice (services/fortigate_error.go has the full account): "-5"
// matches -50..-59, -518, and an object the device quoted back whose own name contains "-5".
//
// ── The contract ─────────────────────────────────────────────────────────────
//
// Every branch where the device supplied a code puts that code in the body as `fortios_code`, as a
// NUMBER. The client compares it numerically; nothing has to parse a sentence. The field name is
// fixed — the API wrapper reads exactly this key.
//
//	FGErrDuplicate       -5    409  the mkey is taken (names share one space per table)
//	FGErrStillReferenced -23   409  a policy/group/profile still points at it
//	gone (-3, -15, 404)        404  the object named is not there
//	any other device code      400  the device refused this input for its own stated reason
//	no code at all             502  nothing answered: unreachable, TLS, timeout, cancelled
//
// `noun` names the object in the sentence ("address", "firewall policy"). It is a parameter rather
// than something derived from the route for the same reason authServerDeleteMsg takes one: the
// -23 and -5 messages are only useful if they say what to go and fix.
func respondDeviceError(c *gin.Context, err error, noun string) bool {
	return respondDeviceErrorMsg(c, err, noun, "")
}

// respondDeviceErrorMsg is respondDeviceError with the sentence supplied by the caller instead of
// derived from `noun` — for the few refusals this console can explain better than a generic line
// can: DeleteLocalUser's -23 ("still a member of a user group") and sdwanMemberError's -3 ("an
// interface cannot join SD-WAN while a policy still names it").
//
// The HTTP status and `fortios_code` are still decided here, which is the whole point of routing
// those two through this function rather than letting them keep their own c.JSON: a better
// sentence must not cost the client the number it compares numerically. An empty msg means "write
// the standard one".
func respondDeviceErrorMsg(c *gin.Context, err error, noun, msg string) bool {
	if err == nil {
		return false
	}
	if noun == "" {
		noun = "object"
	}
	// override returns the caller's sentence when it gave one, and the standard one otherwise.
	override := func(standard string) string {
		if msg != "" {
			return msg
		}
		return standard
	}
	code, hasCode := services.DeviceErrorCode(err)
	_, hasStatus := services.DeviceErrorHTTPStatus(err)

	// answered is the whole question behind 4xx-vs-502: did the firewall reply at all? A typed
	// *services.DeviceError is built from a response envelope, so a code OR an http_status means
	// yes. A transport failure carries neither and must not be dressed up as a client error.
	answered := hasCode || hasStatus

	write := func(httpStatus int, sentence string) bool {
		body := gin.H{"error": sentence}
		if hasCode {
			body["fortios_code"] = code
		}
		c.JSON(httpStatus, body)
		return true
	}

	switch {
	case hasCode && code == services.FGErrDuplicate:
		// Phrased so the noun needs no article. "A %s" read "A address with that name already
		// exists" on the live device, and it would have gone on to say "A interface", "A internet
		// service", "A IPsec tunnel" and "A SD-WAN zone" — most of the nouns this helper is given
		// start with a vowel sound. Choosing "a" vs "an" correctly needs the SOUND, not the first
		// letter ("an SD-WAN zone" but "a SIP profile"), which is not a thing to encode here.
		return write(http.StatusConflict, override(fmt.Sprintf(
			"That %s name is already taken on the firewall — reuse the existing one, or choose another name.", noun)))

	case hasCode && code == services.FGErrStillReferenced:
		return write(http.StatusConflict, override(fmt.Sprintf(
			"This %s is still referenced by something else on the firewall (a policy, group or profile) — remove those references first, then try again.", noun)))

	// services.IsObjectGoneError, not a hand-written code list: -3, -15 and a bare 404 all mean
	// "there is nothing there", and that judgement already exists in one place. Gated on `answered`
	// so its text fallback ("not found") can never promote a transport failure to a 404.
	//
	// Gated on the METHOD as well, because "there is nothing there" is only about the ADDRESSED
	// object on a GET/PUT/DELETE. On a POST there is no addressed object yet: a create refused with
	// -3 means a name in the BODY did not resolve, and the clearest real example is
	// DeviceCreateSDWANMember — FortiOS answers -3 when an interface cannot join SD-WAN because a
	// firewall policy or a DHCP server still holds it. The interface plainly exists; answering 404
	// would say the opposite, and it would read to the client as the end state a delete wanted
	// rather than as a create that has to be fixed. So a POST falls through to the 400 branch,
	// which is the right answer for a body that has to change, and keeps `fortios_code: -3` either
	// way so the client is never reading the sentence.
	case answered && c.Request.Method != http.MethodPost && services.IsObjectGoneError(err):
		return write(http.StatusNotFound, override(fmt.Sprintf(
			"The firewall has no such %s: %s", noun, err.Error())))

	case hasCode:
		// The device refused for a reason of its own — a value out of range, a field this firmware
		// does not support, a reserved name. 400, because the request is what has to change.
		return write(http.StatusBadRequest, override("FortiGate error: "+err.Error()))

	default:
		// Nothing answered. This is the only case 502 was ever right for.
		c.JSON(http.StatusBadGateway, gin.H{"error": override("FortiGate error: " + err.Error())})
		return true
	}
}

// buildClientOrErr is buildClient's login half, returning the plain error instead of writing a gin
// response — the one place fleet handlers (fleet_apply.go) need, since a login failure on ONE
// device in a fleet request must become that device's own result row, not an aborted response for
// every device in the batch.
func buildClientOrErr(c *gin.Context, di *deviceInfo) (deviceClient, error) {
	return acquireDeviceClient(c, di)
}

// acquireDeviceClient is the single step where a request becomes a live session on a firewall, and
// it is a variable rather than a plain function for one reason: it is the seam a test replaces.
//
// Everything above this line — the device lookup, the per-user access check, which stored
// credential to log in as, the read-only refusal, the VDOM — is decision-making this console has to
// get right, and it was all unreachable from a test while the only way to reach a handler was
// through a socket to a real FortiGate. Swap this one function and the same handlers run against
// answers a test wrote (device_client_stub_test.go), so a 403 stays provable without hardware and a
// -5 from the device stays provable without a device.
//
// Production never reassigns it. Tests reassign it and restore it with t.Cleanup; keep it that way,
// because a test that leaves it pointing at a stub would make every later test in the package pass
// without touching the thing it claims to test.
var acquireDeviceClient = func(c *gin.Context, di *deviceInfo) (deviceClient, error) {
	apiPort := getAPIPort(di)
	fc, err := services.AcquireFortiClient(di.Device.ID, di.Device.MgmtIP, apiPort, di.Login)
	if err != nil {
		return nil, err
	}
	services.TouchDeviceCredential(config.DB(), di.CredentialID())

	// Bind the session to THIS request, so cancelling the request cancels the device calls.
	//
	// One line, ~137 routes: every device-proxy handler gets its client from here, which is the
	// same reason the access check and the credential lookup live in getDeviceInfo. Before this,
	// every call ran under context.Background() — a user who navigated away, or whose browser gave
	// up after the frontend's 20-second timeout, left the backend finishing work nobody would read.
	// That is not one request on this console: /audit is a 37-call fan-out and the AI's live device
	// context is sixteen concurrent reads, each holding a session out of a deliberately small pool.
	//
	// WithContext returns a handle, not a copy of the session — the pooled login, its CSRF token
	// and its schema cache stay shared, which is what makes it safe to do per request.
	//
	// The VDOM rides the same handle, from ?vdom= on the request. One chokepoint for ~137 routes,
	// for the same reason the access check and the credential lookup are here: a per-handler
	// `?vdom=` would be 137 places to forget it, and forgetting it on a split firewall means
	// silently reading a different tenant than the one on screen. Absent means root, which is what
	// every caller got before this existed.
	return fc.WithContext(c.Request.Context()).WithVDOM(requestVDOM(c)), nil
}

// requestVDOM reads the virtual domain a request names, if any.
//
// Validated rather than passed through: it lands in a URL query on the device, and a name carrying
// & or ? would let a caller append parameters to every CMDB call this console makes. FortiOS VDOM
// names are alphanumerics, hyphen and underscore, up to 31 characters — anything else is not a
// VDOM name and is dropped rather than sanitised, because a silently altered tenant name would
// read from a VDOM the operator did not ask for.
func requestVDOM(c *gin.Context) string {
	v := strings.TrimSpace(c.Query("vdom"))
	if v == "" || len(v) > 31 {
		return ""
	}
	for _, r := range v {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return ""
		}
	}
	return v
}

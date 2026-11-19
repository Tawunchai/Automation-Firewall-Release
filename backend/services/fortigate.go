package services

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"network_automation/services/platform"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The FortiGate REST client itself: session auth, the CSRF-guarded request path, and the
// shared data structures and conversion helpers every domain file builds on.
//
// Per-domain calls live in fortigate_<domain>.go next to this file.

// ── FortiGate data structures ─────────────────────────────────────────────────

// fgAPIResponse is the common FortiGate REST API envelope.
type fgAPIResponse struct {
	HTTPMethod string          `json:"http_method"`
	Results    json.RawMessage `json:"results"`
	Status     string          `json:"status"`
	HTTPStatus int             `json:"http_status"`
	MKey       interface{}     `json:"mkey"`
	Error      int             `json:"error,omitempty"`
	Message    string          `json:"message,omitempty"`
	CLIError   string          `json:"cli_error,omitempty"` // FortiOS CLI parser error (the useful one)

	// FortiOS stamps the device's own identity on EVERY response envelope, outside "results".
	// monitor/system/status in particular returns serial/version/build only here — its results
	// object carries just model/hostname/log_disk_status.
	Serial  string `json:"serial,omitempty"`
	Version string `json:"version,omitempty"`
	Build   int    `json:"build,omitempty"`

	// Revision marks the state of the TABLE this response came from — not the device's whole
	// configuration, and not the rows actually returned. Confirmed on 7.2.10:
	//
	//	· three identical reads of firewall/policy return the same value, so it is stable;
	//	· nine different tables return nine different values, so it is per-table;
	//	· `count=1` does not change it, which drops the policy table from 42 KB to 6 KB;
	//	· creating an object and deleting it again does NOT restore the previous value.
	//
	// That last one is why this is a revision MARKER and not a content hash. Equal values mean
	// nothing was written; unequal values mean something was, even if the content ended up
	// identical. For detecting change that is the safe direction — a revert is itself a change and
	// is reported as one — but nothing here may be read as "the configuration is the same".
	//
	// There is no device-wide config revision on this firmware, so "was this device written to?"
	// is answered by combining several of these — see ConfigFingerprint in audit_governance.go.
	Revision string `json:"revision,omitempty"`
}

// fgErrorText builds the most useful human error from a FortiGate response, preferring the
// CLI parser error (e.g. "entry not found in datasource / value parse error before 'X'")
// over the bare numeric code, and collapsing its newlines so it reads on one line.
func fgErrorText(r *fgAPIResponse) string {
	msg := strings.TrimSpace(r.CLIError)
	if msg == "" {
		msg = strings.TrimSpace(r.Message)
	}
	if msg != "" {
		msg = strings.Join(strings.Fields(strings.ReplaceAll(msg, "\n", " ")), " ")
		// Add a plain-language hint for the most common opaque code.
		if r.Error == -3 || strings.Contains(msg, "entry not found in datasource") {
			msg += " — a referenced object (address/service/interface) doesn't exist or isn't valid for the chosen interface (an address bound to a specific interface can only be used in a policy on that interface)"
		}
		return msg
	}
	return fmt.Sprintf("error code %d", r.Error)
}

// ── FortiGate Client ──────────────────────────────────────────────────────────

// fortiSession is everything a pooled client SHARES between the requests using it.
//
// It sits behind a pointer so that FortiClient itself is cheap to copy — which is what makes
// WithContext possible. These fields used to live directly on FortiClient, and a copy would then
// have duplicated a sync.RWMutex (a vet error) and forked the schema cache and the CSRF token, so
// a re-login on one copy would have been invisible to the others.
type fortiSession struct {
	// mu guards csrfToken and the stored credentials. A pooled session is used by several requests
	// at once (http.Client and the cookie jar are already goroutine-safe); the CSRF token is the
	// one piece a re-login rewrites underneath them.
	mu        sync.RWMutex
	csrfToken string

	// Credentials, kept only when the client is pooled, so do() can re-authenticate an expired
	// session without the caller knowing. Empty on a one-shot client — see EnableReauth.
	username string
	password string

	// schema caches the device's own attribute tables, read on demand. It is per-device because a
	// schema is a property of one device's firmware — see fortigate_schema.go.
	schema schemaCache
}

type FortiClient struct {
	BaseURL    string
	httpClient *http.Client

	// s is the shared session. Every copy made by WithContext points at the same one.
	s *fortiSession

	// ctx bounds the requests made through THIS handle. nil means context.Background().
	//
	// Per-handle rather than per-session precisely because the session is shared: a request's
	// cancellation must reach its own device calls and nobody else's.
	ctx context.Context

	// vdom is the virtual domain this handle reads and writes. Empty means root.
	//
	// Per-handle for exactly the reason ctx is: the session is shared by every request holding it
	// out of the pool, so a VDOM stored on the session would let one request's choice of tenant
	// change another's mid-flight. See WithVDOM in fortigate_vdom.go.
	vdom string
}

// WithContext returns a handle onto the same device session whose requests are bound to ctx.
//
// This is what makes a cancelled HTTP request stop working the firewall. Without it, every device
// call ran under context.Background(): a user who navigated away, or whose browser gave up after
// the frontend's 20-second timeout, left the backend finishing a scan nobody would read — and on
// this console a scan is not one call. /audit is a 37-request fan-out and buildLiveDeviceContext
// is sixteen concurrent reads, all of them holding sessions out of a pool that is deliberately
// small.
//
// The copy is shallow and that is the point: BaseURL and httpClient are immutable, and the mutable
// half is the shared *fortiSession, so a re-login or a schema read through one handle is seen by
// every other handle on the same device. Only ctx differs.
func (f *FortiClient) WithContext(ctx context.Context) *FortiClient {
	if f == nil || ctx == nil {
		return f
	}
	clone := *f
	clone.ctx = ctx
	return &clone
}

// sess returns the shared session, creating it if this client was built as a bare literal.
//
// NewFortiClient always supplies one, so the lazy branch exists for the zero-value `&FortiClient{}`
// that the payload-builder tests construct — those never make a request and never share the client,
// so there is nothing to race. Without it, moving the mutable half behind a pointer would have
// turned every one of those tests into a nil dereference.
func (f *FortiClient) sess() *fortiSession {
	if f.s == nil {
		f.s = &fortiSession{}
	}
	return f.s
}

// context returns the handle's context, or Background for a client built without one (the
// scheduler, the notify sweep, and anything else with no request behind it).
func (f *FortiClient) context() context.Context {
	if f.ctx != nil {
		return f.ctx
	}
	return context.Background()
}

// token reads the CSRF token under the lock.
func (f *FortiClient) token() string {
	f.sess().mu.RLock()
	defer f.sess().mu.RUnlock()
	return f.sess().csrfToken
}

// EnableReauth stores the credentials so an expired session can be renewed in place. Only pooled
// clients get this: a one-shot client is discarded on failure anyway, and holding a password for
// longer than necessary is not free.
func (f *FortiClient) EnableReauth(username, password string) {
	f.sess().mu.Lock()
	defer f.sess().mu.Unlock()
	f.sess().username, f.sess().password = username, password
}

func (f *FortiClient) canReauth() bool {
	f.sess().mu.RLock()
	defer f.sess().mu.RUnlock()
	return f.sess().username != ""
}

// relogin re-authenticates in place. Callers reach it only after a 401, so a concurrent re-login
// racing another is harmless — both end up with a valid session — but the write is still locked.
func (f *FortiClient) relogin() error {
	f.sess().mu.RLock()
	user, pass := f.sess().username, f.sess().password
	f.sess().mu.RUnlock()
	if user == "" {
		return fmt.Errorf("no stored credentials to re-authenticate with")
	}
	log.Printf("[fortigate] session expired at %s — re-authenticating", f.BaseURL)
	return f.Login(user, pass)
}

// maxDeviceFanout is the widest burst of simultaneous reads this platform aims at one device.
//
// The audit scan is the widest: nine top-level reads, plus six security-profile tables, plus the
// thirteen of the management-plane pass, plus the nine of the configuration fingerprint — 37 at
// once through a single pooled session. The connection pool is sized above that with headroom, so
// a whole fan-out is served from warm connections instead of leaving the tail to open new ones.
const maxDeviceFanout = 48

// fgTransport is the ONE connection pool every FortiGate client shares.
//
// It is shared, and it is tuned, and both halves were measured against the lab FGT80E rather than
// assumed. Each client used to build its own zero-value http.Transport, which carries two defaults
// that are wrong for this workload:
//
//	MaxIdleConnsPerHost = 2   Only two connections are KEPT after a burst. A 37-way fan-out
//	                          therefore returned 35 sockets to be closed, and the next fan-out
//	                          opened 35 fresh ones. Measured: 37 parallel GETs took 2.30-3.29s
//	                          with 2 connections reused; with the pool sized for the fan-out the
//	                          same 37 took 0.32s with all 37 reused. The device is not slow — it
//	                          was being asked to do a TLS handshake 35 times per page.
//	no ClientSessionCache     Every handshake that DOES have to happen is a full one. FortiOS 7.2
//	                          offers TLS session resumption; without a cache the client declines
//	                          it. Measured on a cold pool: 2.44s of full handshakes becomes 0.59s
//	                          of resumed ones.
//
// Sharing one transport across clients is safe and is the point: HTTP/1.1 carries no per-connection
// identity, the session cookie travels in each request from the client's own jar, and the CSRF
// token is a header. Two people working on the same firewall through their own credentials
// therefore reuse one warm pool instead of building two, and the TLS session cache is shared with
// them. Cookies stay strictly per-client — the jar lives on http.Client, never here.
//
// A dead device cannot poison it: failures are per-connection, and DialContext still times out in
// 10s. Nothing here changes what is sent or what comes back — only how often the socket underneath
// has to be built again.

// fgTLSConfig is the TLS half of that pool, pulled out so the dialler below can clone it.
//
// InsecureSkipVerify stays, and it is no longer the whole story: FortiOS ships a self-signed
// certificate, so there is no authority to check it against — but every certificate after the
// first IS checked, against the one this console pinned. See services/tlspin.go.
var fgTLSConfig = &tls.Config{
	InsecureSkipVerify: true, //nolint:gosec // self-signed; pinned instead, see tlspin.go
	// Lets a handshake that must happen resume a previous session instead of doing the full
	// key exchange. 64 entries is far more than the number of firewalls one console manages;
	// the cache is keyed by host, not by connection.
	ClientSessionCache: tls.NewLRUClientSessionCache(64),
}

var fgDialer = &net.Dialer{
	Timeout: 10 * time.Second,
	// Detect a silently dropped path (a firewall reboot, a NAT table expiring) instead of
	// leaving a dead socket in the idle pool for the next request to discover.
	KeepAlive: 30 * time.Second,
}

// fgDialTLS dials, handshakes, and only then decides whether this is the device it pinned.
//
// The certificate check runs after HandshakeContext and before the connection is handed back, so a
// changed certificate means no request is ever written to the socket — the credential in a
// /logincheck POST never leaves the process.
func fgDialTLS(ctx context.Context, network, addr string) (net.Conn, error) {
	raw, err := fgDialer.DialContext(ctx, network, addr)
	if err != nil {
		return nil, err
	}

	cfg := fgTLSConfig.Clone() // shares the session cache pointer, which is the point
	host, _, splitErr := net.SplitHostPort(addr)
	if splitErr != nil {
		host = addr
	}
	// Set even for an IP, where Go will not put it in SNI: it costs nothing and keeps the config
	// honest about who was being dialled.
	cfg.ServerName = host

	conn := tls.Client(raw, cfg)
	if err := conn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, err
	}
	if err := platform.VerifyPinnedCertificate(addr, conn.ConnectionState()); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

var fgTransport = &http.Transport{
	TLSClientConfig: fgTLSConfig,
	DialContext:     fgDialer.DialContext,
	// DialTLSContext, not TLSClientConfig.VerifyConnection, and that is a measurement rather than
	// a preference: tls.ConnectionState.ServerName is EMPTY when the host is an IP address (seen
	// on the lab 80E, on both a fresh and a repeat handshake), and every firewall in this console
	// is reached by management IP. A check hung off VerifyConnection would therefore have keyed
	// the whole fleet under one empty host. The dialler is handed the address it dialled.
	DialTLSContext:      fgDialTLS,
	TLSHandshakeTimeout: 10 * time.Second,
	// Sized for one full fan-out per device, with headroom, and a global ceiling for a console
	// managing several.
	MaxIdleConnsPerHost: maxDeviceFanout,
	MaxIdleConns:        maxDeviceFanout * 4,
	// Comfortably longer than a page's worth of requests, so the next page starts warm; short
	// enough that an idle console is not holding sockets on the firewall indefinitely.
	IdleConnTimeout:       90 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
	// FortiOS 7.2's admin daemon answers HTTP/1.1 (confirmed live). Not attempting the h2 upgrade
	// saves the ALPN negotiation from advertising something that is never accepted.
	ForceAttemptHTTP2: false,
}

// NewFortiClient creates an HTTPS client that skips TLS verification
// (FortiGates commonly use self-signed certs) and manages cookies.
//
// The cookie jar is per client — it holds THIS session's identity. The connection pool underneath
// is shared (see fgTransport).
func NewFortiClient(mgmtIP string, apiPort int) *FortiClient {
	jar, _ := cookiejar.New(nil)
	return &FortiClient{
		// net.JoinHostPort, not fmt.Sprintf("%s:%d", …): an IPv6 management address has to be
		// bracketed (https://[2001:db8::1]:443) or url.Parse and the dialer both reject it.
		BaseURL: "https://" + net.JoinHostPort(mgmtIP, strconv.Itoa(apiPort)),
		s:       &fortiSession{},
		httpClient: &http.Client{
			Jar:       jar,
			Transport: fgTransport,
			Timeout:   30 * time.Second,
		},
	}
}

// Login authenticates to FortiGate via the web GUI session endpoint and extracts the CSRF token.
// Supports all FortiOS versions — CSRF cookie name varies (ccsrftoken, ccsrftoken_7_4_3, etc.)
func (f *FortiClient) Login(username, password string) error {
	data := url.Values{}
	data.Set("username", username)
	data.Set("secretkey", password)
	data.Set("ajax", "1")

	resp, err := f.httpClient.PostForm(f.BaseURL+"/logincheck", data)
	if err != nil {
		return fmt.Errorf("FortiGate login failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := strings.TrimSpace(string(body))

	// FortiOS returns exactly "1" on success, "0" or negative on failure.
	// BUG-FIX: strings.Contains("-1","1") == true, so we must NOT use Contains.
	if bodyStr == "0" || strings.HasPrefix(bodyStr, "-") {
		return fmt.Errorf("FortiGate authentication failed (wrong credentials or account locked)")
	}
	if resp.StatusCode != http.StatusOK && bodyStr != "1" {
		return fmt.Errorf("FortiGate authentication failed (HTTP %d, body: %s)", resp.StatusCode, bodyStr)
	}

	// Extract CSRF token from the cookie jar.
	// FortiGate sets a cookie named "ccsrftoken" (or "ccsrftoken_7_4_x" in newer builds).
	// BUG-FIX: cookie jar may key by host without port (443 is default for HTTPS),
	// so we try both the full BaseURL and the host-only URL.
	// u.Hostname(), not strings.Split(u.Host, ":")[0]: splitting on ":" truncates an IPv6 literal
	// to "[2001" and the cookie lookup then silently finds nothing, leaving the CSRF token empty
	// so every write returns 403. Hostname() strips the port AND the brackets correctly.
	u, _ := url.Parse(f.BaseURL)
	hostOnly, _ := url.Parse("https://" + u.Hostname())

	token := ""
	for _, lookup := range []*url.URL{u, hostOnly} {
		for _, c := range f.httpClient.Jar.Cookies(lookup) {
			// Match any cookie whose name starts with "ccsrf" (handles all FG version suffixes)
			if strings.HasPrefix(strings.ToLower(c.Name), "ccsrf") {
				token = strings.Trim(c.Value, `"`)
				break
			}
		}
		if token != "" {
			break
		}
	}
	f.sess().mu.Lock()
	f.sess().csrfToken = token
	f.sess().mu.Unlock()
	return nil
}

// Logout ends the FortiGate session.
//
// The response is drained and closed even though nothing reads it. Leaving a body open holds its
// connection out of the shared pool permanently — and Logout is called from exactly the places
// that churn sessions (a credential edit, a device edit, pool invalidation), so the one call that
// is supposed to RELEASE a slot on the device was the one call that also lost a socket on ours.
func (f *FortiClient) Logout() {
	req, err := http.NewRequestWithContext(f.context(), "GET", f.BaseURL+"/logout", nil)
	if err != nil {
		return
	}
	resp, err := f.httpClient.Do(req)
	if err != nil {
		return
	}
	// Read to EOF before closing: a body abandoned part-read cannot be reused, and the logout
	// response is a handful of bytes.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close() //nolint:errcheck
}

// ── internal HTTP helpers ─────────────────────────────────────────────────────

// writeMethods require the CSRF token header and the vdom parameter.
var writeMethods = map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}

// do performs one CMDB call, transparently re-authenticating if the session has expired.
//
// Sessions are pooled and reused (see fortigate_sessionpool.go), so a client can outlive its session:
// FortiOS drops an idle admin session after `admintimeout` minutes, and a device reboot or a
// manual logout kills it early. Rather than surface that to 78 handlers, a call that comes back
// "not authenticated" logs in again and replays itself exactly once. The body is buffered up front
// so the replay can re-send it.
func (f *FortiClient) do(method, path string, body interface{}) (*fgAPIResponse, error) {
	var payload []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = b
	}

	resp, err := f.doOnce(method, path, payload)
	if err == nil || !isSessionExpiredErr(err) || !f.canReauth() {
		return resp, err
	}
	if relogErr := f.relogin(); relogErr != nil {
		// Report the ORIGINAL failure — "session expired" is the useful half, and the re-login
		// error is usually the same credential problem stated twice.
		return nil, err
	}
	return f.doOnce(method, path, payload)
}

// isSessionExpiredErr matches the two answers FortiOS gives an unauthenticated caller: a 401, or
// the HTML login page served instead of JSON.
func isSessionExpiredErr(err error) bool {
	if err == nil {
		return false
	}
	// The status when the device answered one, rather than the rendering of it. The text check
	// stays for the paths that never build a DeviceError — the HTML login page served instead of
	// JSON is exactly that case, and it is the commonest way an expired session shows up.
	if status, ok := DeviceErrorHTTPStatus(err); ok {
		return status == http.StatusUnauthorized
	}
	msg := err.Error()
	return strings.Contains(msg, "HTTP 401") || strings.Contains(msg, "session expired")
}

func (f *FortiClient) doOnce(method, path string, payload []byte) (*fgAPIResponse, error) {
	var bodyReader io.Reader
	if payload != nil {
		bodyReader = bytes.NewReader(payload)
	}

	// Every CMDB path names its VDOM. This used to be a hard-coded "root", which on a firewall
	// split between departments silently picked one tenant and hid the rest; it is now the
	// handle's own VDOM, defaulting to root so every existing caller behaves exactly as before.
	// See fortigate_vdom.go.
	apiPath := f.vdomParam(path)

	req, err := http.NewRequestWithContext(f.context(), method, f.BaseURL+apiPath, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	// BUG-FIX: CSRF token is REQUIRED for all write operations (POST/PUT/PATCH/DELETE).
	// Without it FortiGate returns HTTP 403.
	if writeMethods[method] {
		token := f.token()
		if token == "" {
			return nil, fmt.Errorf("FortiGate CSRF token not available — check admin credentials and account permissions")
		}
		req.Header.Set("X-CSRFTOKEN", token)
	}

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("FortiGate API request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// Handle non-JSON responses (HTML login page = session expired / trusted host block)
	var apiResp fgAPIResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		if resp.StatusCode == http.StatusForbidden {
			return nil, fmt.Errorf("FortiGate API error: HTTP 403 — check admin account: (1) enable REST API access in admin profile, (2) add server IP to trusted hosts, or (3) verify password")
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("FortiGate API error: HTTP 401 — session expired or invalid credentials")
		}
		return nil, fmt.Errorf("FortiGate API error: unexpected response (HTTP %d): %s", resp.StatusCode, platform.TruncateUTF8(string(respBody), 200))
	}

	// Build helpful 403 message when CSRF token was present but FortiGate still denied
	if apiResp.HTTPStatus == http.StatusForbidden || resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("FortiGate API error: HTTP 403 — admin profile may not allow REST API write access, or this IP is not in trusted hosts list (csrftoken set=%v)", f.token() != "")
	}

	// A device that says "error" IS an error, whatever status line carried it.
	//
	// The three signals used to be ANDed, so a failure had to show up in all of them at once to be
	// reported. On FortiOS 7.2.10 it does — an error envelope arrives with a matching HTTP status,
	// verified against the lab unit across missing objects, unknown tables, invalid field values
	// and a missing mkey — so the AND happened to be right for this firmware and only for it. Put
	// anything in the path that normalises the status line (a reverse proxy, a load balancer, a
	// firmware that answers 200 with the verdict in the body) and the caller receives nil error
	// with empty Results: the Addresses page renders "no addresses" for a device that actually
	// refused the read, which is the worst answer a firewall console can give.
	//
	// Split in two so each half means one thing. `status` is checked against "" first because not
	// every monitor endpoint sends the field, and absent must not read as failure — the same rule
	// ParseTrafficLog applies to the log API's envelope.
	// *DeviceError, not fmt.Errorf: the numeric code has to survive the trip. Several flows turn a
	// specific refusal into "carry on" — a duplicate means the object is already there, a missing
	// node means the delete already happened — and they used to decide that by searching the
	// MESSAGE for "-5" or "-3", which also matched -50, -518 and any object name with a hyphen and
	// a digit in it. See fortigate_error.go. The rendered text is byte-identical to what this line
	// produced before.
	if apiResp.Status != "" && !strings.EqualFold(apiResp.Status, "success") {
		return nil, &DeviceError{Code: apiResp.Error, HTTPStatus: apiResp.HTTPStatus, Text: fgErrorText(&apiResp)}
	}
	if apiResp.HTTPStatus != 200 && resp.StatusCode != 200 {
		return nil, &DeviceError{Code: apiResp.Error, HTTPStatus: apiResp.HTTPStatus, Text: fgErrorText(&apiResp)}
	}
	return &apiResp, nil
}

// doRawGet fetches a path whose body is a FILE rather than the JSON envelope, and returns it
// verbatim.
//
// do/doOnce are useless for these: they json.Unmarshal the body, so a 570 KB debug bundle or a
// config backup comes back as "unexpected response". The Tech Support Report endpoint
// (monitor/system/debug/download) is the caller that needs this.
//
// maxBytes caps what is read so a device that answers with something unexpectedly enormous cannot
// be turned into an out-of-memory in this process by a single request. It is a hard stop, not a
// truncation to be papered over: a short read is reported as an error, because half a support
// bundle looks like a whole one to whoever opens it.
// It re-authenticates and replays once on an expired session, exactly as do() does — a pooled
// session outlives the request that opened it, and a support bundle is a slow enough call to be
// the one that finds the session gone.
func (f *FortiClient) doRawGet(path string, maxBytes int64) ([]byte, string, error) {
	body, ctype, err := f.doRawGetOnce(path, maxBytes)
	if err == nil || !isSessionExpiredErr(err) || !f.canReauth() {
		return body, ctype, err
	}
	if relogErr := f.relogin(); relogErr != nil {
		return nil, "", err
	}
	return f.doRawGetOnce(path, maxBytes)
}

func (f *FortiClient) doRawGetOnce(path string, maxBytes int64) ([]byte, string, error) {
	apiPath := f.vdomParam(path)

	req, err := http.NewRequestWithContext(f.context(), "GET", f.BaseURL+apiPath, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "*/*")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("FortiGate download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, "", fmt.Errorf("FortiGate API error: HTTP 401 — session expired or invalid credentials")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("FortiGate download failed: HTTP %d", resp.StatusCode)
	}

	// +1 so a body that is exactly at the cap is still distinguishable from one that exceeds it.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("FortiGate download failed: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, "", fmt.Errorf("file from device exceeds the %d MB limit", maxBytes/(1024*1024))
	}
	if len(body) == 0 {
		return nil, "", fmt.Errorf("device returned an empty file")
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// ── System Info ───────────────────────────────────────────────────────────────

// GetHostname fetches the FortiGate system hostname from system/global.
func (f *FortiClient) GetHostname() (string, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/global", nil)
	if err != nil {
		return "", err
	}
	var global map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &global); err != nil {
		return "", fmt.Errorf("failed to parse system/global: %w", err)
	}
	var hostname string
	if v, ok := global["hostname"]; ok {
		json.Unmarshal(v, &hostname) //nolint:errcheck
	}
	if hostname == "" {
		hostname = "FortiGate"
	}
	return hostname, nil
}

// FGSystemStatus holds the device identity shown on the faceplate widget.
type FGSystemStatus struct {
	Model         string `json:"model"`      // e.g. "FortiGate 80E"
	ModelCode     string `json:"model_code"` // e.g. "FGT80E"
	Serial        string `json:"serial"`
	Version       string `json:"version"`
	Build         int    `json:"build"`
	Hostname      string `json:"hostname"`
	LogDiskStatus string `json:"log_disk_status"` // available | not_available
}

// GetSystemStatus fetches model/serial/version from monitor/system/status. The GUI
// device widget's title ("FortiGate 80E") is model_name + " " + model_number, confirmed
// live (model_name="FortiGate", model_number="80E").
//
// Serial, version and build are read from the response ENVELOPE, not from results — that is
// where FortiOS puts them (verified live on 7.2.10, whose results object holds only
// model_name/model_number/model/hostname/log_disk_status). Results is still checked first so a
// firmware that does include them there keeps working.
func (f *FortiClient) GetSystemStatus() (FGSystemStatus, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/status", nil)
	if err != nil {
		return FGSystemStatus{}, err
	}
	var r struct {
		Model         string `json:"model"`
		ModelName     string `json:"model_name"`
		ModelNumber   string `json:"model_number"`
		Serial        string `json:"serial"`
		Version       string `json:"version"`
		Build         int    `json:"build"`
		Hostname      string `json:"hostname"`
		LogDiskStatus string `json:"log_disk_status"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return FGSystemStatus{}, fmt.Errorf("failed to parse system/status: %w", err)
	}
	model := strings.TrimSpace(r.ModelName + " " + r.ModelNumber)
	if strings.TrimSpace(model) == "" {
		model = r.Model
	}
	st := FGSystemStatus{
		Model: model, ModelCode: r.Model, Serial: r.Serial, Version: r.Version,
		Build: r.Build, Hostname: r.Hostname, LogDiskStatus: r.LogDiskStatus,
	}
	if st.Serial == "" {
		st.Serial = resp.Serial
	}
	if st.Version == "" {
		st.Version = resp.Version
	}
	if st.Build == 0 {
		st.Build = resp.Build
	}
	return st, nil
}

// ── Format conversion helpers ─────────────────────────────────────────────────

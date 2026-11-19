package policyobject

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// deviceSession, the one step every device-proxy route starts with.
//
// Phase 5 collapsed ~190 copies of
//
//	di, ok := getDeviceInfo(c)
//	if !ok { return }
//	fc, ok := buildClient(c, di)
//	if !ok { return }
//
// into one call. That makes this function the chokepoint for the per-user device grant, the
// read-only refusal, which stored credential to log in as, the session pool and request
// cancellation — so it is also the single place all of those could be broken for every route at
// once. These tests are what stands between a refactor there and the third authz hole this repo
// has shipped.
//
// The DB-backed ones follow the convention in device_handler_db_test.go: skipped unless
// POLICYOBJECT_DB_TEST_DSN names a throwaway Postgres. See the note at the top of that file.

// The happy path: an admin asking for a device that exists gets both halves back, and the client
// is the one the seam supplied.
func TestDeviceSessionResolvesDeviceAndClient(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{addresses: []services.FGAddress{{Name: "LAN-10.0.0.0"}}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	di, fc, ok := deviceSession(c)

	if !ok {
		t.Fatalf("deviceSession refused the happy path: %d %s", rec.Code, rec.Body.String())
	}
	if di == nil || di.Device.ID != device.ID {
		t.Fatalf("deviceSession resolved the wrong device: %+v", di)
	}
	if fc != deviceClient(stub) {
		t.Fatal("deviceSession did not return the client the seam supplied")
	}
	// Nothing written: a successful session leaves the whole response to the handler.
	if rec.Body.Len() != 0 {
		t.Fatalf("deviceSession wrote a response on success: %d %s", rec.Code, rec.Body.String())
	}
	// The credential the device row carries, not a guess — this is the half that makes the
	// firewall's own event log name the right operator.
	if di.Username() != "admin" {
		t.Fatalf("login username = %q, want the device account", di.Username())
	}
}

// A user with no grant for this device is refused BEFORE the device is touched, and told 404 so
// the console does not confirm the existence of firewalls they were never given.
func TestDeviceSessionRefusesAUserWithNoGrant(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{addresses: []services.FGAddress{{Name: "LEAKED"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testPlainUserID, "user")
	di, fc, ok := deviceSession(c)

	if ok {
		t.Fatalf("deviceSession served a device the user was never granted: %+v", di)
	}
	if fc != nil {
		t.Fatal("deviceSession returned a live client on a refusal")
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "LEAKED") {
		t.Fatal("the session reached the device for a user with no grant")
	}
}

// A granted user gets through — otherwise the refusal above would be proving a lockout.
func TestDeviceSessionServesAGrantedUser(t *testing.T) {
	device := handlerTestDevice(t)
	grantDevice(t, device.ID)
	withDeviceClient(t, &stubClient{}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testPlainUserID, "user")
	if _, _, ok := deviceSession(c); !ok {
		t.Fatalf("deviceSession refused a granted user: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDeviceSessionRefusesADeviceThatIsNotThere(t *testing.T) {
	handlerTestDevice(t)
	withDeviceClient(t, &stubClient{}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", 9999, testAdminUserID, "admin")
	if _, _, ok := deviceSession(c); ok {
		t.Fatal("deviceSession resolved a device id that does not exist")
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// The read-only role: every page a normal user can see, not one of them changed. 403, and before
// the firewall is reached.
func TestDeviceSessionRefusesAWriteFromAReadOnlyAccount(t *testing.T) {
	device := handlerTestDevice(t)
	grantDevice(t, device.ID)
	withDeviceClient(t, &stubClient{}, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testPlainUserID, "readonly",
		`{"name":"should-never-be-written","type":"subnet","subnet":"10.0.0.0/24"}`)
	if _, _, ok := deviceSession(c); ok {
		t.Fatal("deviceSession allowed a write from a read-only account")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

// Nothing answered on the way to the firewall: the session fails, writes 502 itself, and does not
// dress a transport failure up as something the device said (no fortios_code).
func TestDeviceSessionReportsALoginFailureAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, nil, errTransport{})

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	_, fc, ok := deviceSession(c)

	if ok {
		t.Fatal("deviceSession reported success when the login failed")
	}
	if fc != nil {
		t.Fatal("deviceSession returned a client when the login failed")
	}
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "fortios_code") {
		t.Fatalf("a login failure carried a device code:\n%s", rec.Body.String())
	}
}

// A VDOM named by the request reaches the session layer, so a split firewall is read in the tenant
// the operator has on screen. One chokepoint for ~190 routes: a per-handler ?vdom= would be ~190
// places to forget it, and forgetting it means silently reading a different tenant.
func TestDeviceSessionCarriesTheRequestedVDOM(t *testing.T) {
	device := handlerTestDevice(t)
	// withDeviceClient replaces the seam with a fixed client, which cannot show what was asked
	// for. Record the VDOM the session resolved instead — that is the decision under test; the
	// real seam hands it to fc.WithVDOM.
	prev := acquireDeviceClient
	var sawVDOM string
	acquireDeviceClient = func(c *gin.Context, di *deviceInfo) (deviceClient, error) {
		sawVDOM = requestVDOM(c)
		return &stubClient{}, nil
	}
	t.Cleanup(func() { acquireDeviceClient = prev })

	c, _ := deviceRequest(t, http.MethodGet, "addresses?vdom=branch-1", device.ID, testAdminUserID, "admin")
	if _, _, ok := deviceSession(c); !ok {
		t.Fatal("deviceSession refused a request naming a VDOM")
	}
	if sawVDOM != "branch-1" {
		t.Fatalf("the session asked for VDOM %q, want branch-1", sawVDOM)
	}
}

// ── the chokepoint stays the only way in ────────────────────────────────────

// Nothing in this package may reach a firewall around the session layer.
//
// This is the guard on the refactor, not a style rule. Two things have to hold for a device call
// to be safe, and neither is visible at the call site:
//
//  1. The *deviceInfo it goes out with came from resolveDeviceInfoByID — so the per-user device
//     grant, the read-only refusal and the credential lookup all ran. A hand-built deviceInfo
//     would skip every one of them and the handler would look exactly like its neighbours.
//  2. The client came from acquireDeviceClient — so it is the pooled session, bound to this
//     request's context (cancellation) and to the VDOM the request named.
//
// So: deviceInfo may only be constructed, and a client may only be acquired, in device_session.go.
// Two files take the second door on purpose and say why in their own comments — fleet_apply.go,
// which needs a login failure on ONE device to become that device's result row instead of
// aborting the batch, and device_livestream.go, which cannot write a gin response to an SSE
// stream that has already started. Both go through resolveDeviceInfoByID/buildClientOrErr, which
// keep every check and only hand the error back instead of writing it.
func TestNothingReachesAFirewallAroundTheSessionLayer(t *testing.T) {
	forbidden := []struct {
		pattern *regexp.Regexp
		allowed map[string]bool
		why     string
	}{
		{
			// Constructing a deviceInfo IS claiming the access check passed.
			regexp.MustCompile(`&deviceInfo\{`),
			map[string]bool{"device_session.go": true},
			"builds a deviceInfo by hand, skipping the per-user device grant — use deviceSession(c)",
		},
		{
			// The low-level session acquisition: the pool, the context, the VDOM.
			regexp.MustCompile(`\b(acquireDeviceClient|services\.AcquireFortiClient)\(`),
			map[string]bool{"device_session.go": true},
			"acquires a device session directly, bypassing deviceSession(c)",
		},
		{
			regexp.MustCompile(`\bbuildClientOrErr\(`),
			map[string]bool{"device_session.go": true, "fleet_apply.go": true, "device_livestream.go": true},
			"uses the error-returning door; it exists for the fleet loop and the SSE stream only",
		},
	}

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no .go files found — this guard would pass vacuously")
	}
	for _, path := range files {
		name := filepath.Base(path)
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			for _, rule := range forbidden {
				if rule.allowed[name] || !rule.pattern.MatchString(line) {
					continue
				}
				t.Errorf("%s:%d %s:\n\t%s", name, i+1, rule.why, strings.TrimSpace(line))
			}
		}
	}
}

// The handlers that still call the two halves separately must call them in the one shape that is
// safe.
//
// ~75 handlers validate their input before they log in to a firewall — a malformed body or an
// unparseable :id is answered 400 without a session being opened. Those cannot use deviceSession
// in one call without moving the access check after input validation, which would change which
// refusal a doubly-bad request gets, so they keep `getDeviceInfo` … `buildClient(c, di)` with the
// validation in between.
//
// What this pins is that the second half is always the canonical pair — buildClient(c, di) with
// the `if !ok { return }` right behind it — because a buildClient whose error was ignored would
// carry on with a nil client, and the panic would arrive somewhere else entirely.
func TestTheSecondHalfIsAlwaysTheCanonicalPair(t *testing.T) {
	call := regexp.MustCompile(`\bbuildClient\(`)
	canonical := regexp.MustCompile(`^\s*fc, ok := buildClient\(c, di\)$`)

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	seen := 0
	for _, path := range files {
		name := filepath.Base(path)
		if strings.HasSuffix(name, "_test.go") || name == "device_session.go" {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		lines := strings.Split(string(src), "\n")
		for i, line := range lines {
			if !call.MatchString(line) {
				continue
			}
			seen++
			if !canonical.MatchString(line) {
				t.Errorf("%s:%d is not the canonical second half:\n\t%s", name, i+1, strings.TrimSpace(line))
				continue
			}
			if i+2 >= len(lines) ||
				strings.TrimSpace(lines[i+1]) != "if !ok {" ||
				strings.TrimSpace(lines[i+2]) != "return" {
				t.Errorf("%s:%d does not check ok — a nil client would be used:\n\t%s",
					name, i+1, strings.TrimSpace(line))
			}
		}
	}
	if seen == 0 {
		t.Skip("no separate buildClient call sites left — fold this guard into the one above")
	}
}

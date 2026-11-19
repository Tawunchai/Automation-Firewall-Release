package workercred

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

// The host-key endpoint. What it must get right is narrower than the credential endpoint next to
// it, but it is the thing standing between the worker and handing a firewall administrator's
// password to whatever answered on port 22, so the two refusals below are the point.
//
// These run without a database: every case here is answered before platform.CheckOrPinFingerprint
// would need one, or exercises the "no store wired" branch deliberately.

func hostKeyRequest(t *testing.T, secret, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/ssh-host-key", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if secret != "" {
		c.Request.Header.Set("X-Worker-Secret", secret)
	}
	CheckHostKey(c)
	return w
}

func TestHostKeyCheckRefusesACallerWithoutTheWorkerSecret(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "a-real-worker-secret-value")

	for _, c := range []struct{ name, secret string }{
		{"no header at all", ""},
		{"the wrong secret", "not-the-secret"},
		{"a prefix of the real one", "a-real-worker"},
	} {
		w := hostKeyRequest(t, c.secret,
			`{"host":"10.10.20.90","port":22,"key_type":"ssh-ed25519","fingerprint":"SHA256:x"}`)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", c.name, w.Code)
		}
	}
}

// A request that names no host, or carries no fingerprint, is a bug in the worker rather than a
// device problem — and must not reach the store, where an empty fingerprint would be compared
// against a pin.
func TestHostKeyCheckRefusesAnIncompleteRequest(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "s")

	for _, c := range []struct{ name, body string }{
		{"not JSON at all", `not json`},
		{"no host", `{"port":22,"fingerprint":"SHA256:x"}`},
		{"no fingerprint", `{"host":"10.10.20.90","port":22}`},
		{"an empty fingerprint", `{"host":"10.10.20.90","port":22,"fingerprint":""}`},
	} {
		w := hostKeyRequest(t, "s", c.body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", c.name, w.Code)
		}
	}
}

// With no store wired the answer is 503, not 500 and not a verdict.
//
// It matters which: the worker turns 503 into "the console is misconfigured, so this worker will
// not send the device's password", which is a different thing to tell an operator than "the
// device's key changed" — and the one answer it must never be able to read here is "match".
func TestHostKeyCheckSaysUnavailableWhenNoStoreIsWired(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "s")

	// Nothing in this package's tests wires a store — there is no main.go here — so the unset
	// branch is simply the state of the world. Set explicitly all the same, so the test states
	// its own precondition rather than relying on one.
	platform.SetHostKeyStore(nil)

	w := hostKeyRequest(t, "s",
		`{"host":"10.10.20.90","port":22,"key_type":"ssh-ed25519","fingerprint":"SHA256:x"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), platform.HostKeyVerdictMatch) {
		t.Error("the reply carried a verdict although nothing was consulted")
	}
}

// The pin is keyed on the address, so this endpoint has to spell it exactly the way
// services/fortigate_ssh.go and services/terminal.go dial it. Spelled differently, the same
// firewall is pinned twice under two names and neither connection is ever checked against the
// other's key — the check would still pass, and still protect nothing.
func TestHostKeyAddrMatchesHowTheGoSideDials(t *testing.T) {
	for _, c := range []struct {
		name, host, want string
		port             int
	}{
		{name: "an IPv4 address", host: "10.10.20.90", port: 22, want: "10.10.20.90:22"},
		{name: "a non-default port", host: "10.10.20.90", port: 2222, want: "10.10.20.90:2222"},
		{name: "no port in the job message", host: "10.10.20.90", port: 0, want: "10.10.20.90:22"},
		{name: "a negative port", host: "10.10.20.90", port: -1, want: "10.10.20.90:22"},
		// net.JoinHostPort brackets an IPv6 literal; fmt.Sprintf("%s:%d", …) does not, and the
		// result would not match what ssh.Dial pinned.
		{name: "an IPv6 literal", host: "2001:db8::1", port: 22, want: "[2001:db8::1]:22"},
	} {
		if got := hostKeyAddr(c.host, c.port); got != c.want {
			t.Errorf("%s: hostKeyAddr(%q, %d) = %q, want %q", c.name, c.host, c.port, got, c.want)
		}
	}
}

// And the same spelling really is what the Go dial side pins. net.JoinHostPort is the shared
// answer; this asserts the agreement rather than trusting that both files were written the same
// day by the same person.
func TestHostKeyAddrAgreesWithNetJoinHostPort(t *testing.T) {
	if got, want := hostKeyAddr("10.10.20.90", 22), net.JoinHostPort("10.10.20.90", "22"); got != want {
		t.Errorf("hostKeyAddr = %q, ssh.Dial would pin %q", got, want)
	}
}

package services

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The pool exists because every device-proxy handler used to login → call → logout, three HTTPS
// round trips for one operation. These tests drive a fake FortiGate so the counts are exact rather
// than inferred from timings.
//
// The device's own limits are what the design has to respect (FortiOS 7.2.10, `show
// full-configuration system global`): admintimeout 5 (idle session dies), admin-lockout-threshold 3
// (three bad logins lock the admin account for 60s), admin-concurrent enable.

// poolFakeDevice counts logins and serves a minimal CMDB endpoint. authOK controls whether an
// already-issued session is still accepted, so session expiry can be simulated.
type poolFakeDevice struct {
	srv           *httptest.Server
	logins        int32
	calls         int32
	logouts       int32
	rejectLogin   atomic.Bool // credentials refused
	expireSession atomic.Bool // session no longer accepted → 401
}

// newPoolFakeDevice starts a stand-in FortiGate.
//
// `configure` runs against the http.Server BEFORE it starts serving. That ordering is the point:
// http.Server reads fields like ConnState from its own goroutine the moment a connection arrives,
// so setting them on an already-started server is a data race (go test -race flags it).
func newPoolFakeDevice(t *testing.T, configure ...func(*http.Server)) *poolFakeDevice {
	t.Helper()
	f := &poolFakeDevice{}
	mux := http.NewServeMux()

	mux.HandleFunc("/logincheck", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.logins, 1)
		if f.rejectLogin.Load() {
			_, _ = w.Write([]byte("-1")) // FortiOS: negative body = auth failure
			return
		}
		f.expireSession.Store(false) // a fresh login revives the session
		http.SetCookie(w, &http.Cookie{Name: "ccsrftoken", Value: `"tok123"`, Path: "/"})
		_, _ = w.Write([]byte("1"))
	})
	mux.HandleFunc("/logout", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.logouts, 1)
	})
	mux.HandleFunc("/api/v2/cmdb/", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.calls, 1)
		if f.expireSession.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("<html>login</html>")) // non-JSON, like the real login page
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","http_status":200,"results":[]}`))
	})

	f.srv = httptest.NewUnstartedServer(mux)
	for _, apply := range configure {
		apply(f.srv.Config)
	}
	f.srv.StartTLS()
	t.Cleanup(f.srv.Close)
	return f
}

// countNewConnections counts TCP connections the server accepts. Handed to newPoolFakeDevice so
// the counter is installed before the first connection can arrive.
func countNewConnections(conns *int32) func(*http.Server) {
	return func(s *http.Server) {
		s.ConnState = func(_ net.Conn, state http.ConnState) {
			if state == http.StateNew {
				atomic.AddInt32(conns, 1)
			}
		}
	}
}

// hostPort splits the httptest URL into the pieces NewFortiClient wants.
func (f *poolFakeDevice) hostPort(t *testing.T) (string, int) {
	t.Helper()
	trimmed := strings.TrimPrefix(f.srv.URL, "https://")
	host, portStr, found := strings.Cut(trimmed, ":")
	if !found {
		t.Fatalf("unexpected test server URL %q", f.srv.URL)
	}
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		t.Fatalf("port %q: %v", portStr, err)
	}
	return host, port
}

// resetPool clears global state so tests do not leak into each other.
func resetPool(t *testing.T) {
	t.Helper()
	fortiSessions.mu.Lock()
	fortiSessions.entries = make(map[string]*pooledSession)
	fortiSessions.mu.Unlock()
	t.Cleanup(func() {
		fortiSessions.mu.Lock()
		fortiSessions.entries = make(map[string]*pooledSession)
		fortiSessions.mu.Unlock()
	})
}

// ─── the point of the pool ───────────────────────────────────────────────────

// Ten operations on one device used to mean ten logins. Now they mean one.
func TestPool_ReusesOneLoginAcrossRequests(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	for i := 0; i < 10; i++ {
		fc, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"})
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}

	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 — the whole point is not re-authenticating per request", got)
	}
	if got := atomic.LoadInt32(&fg.calls); got != 10 {
		t.Errorf("api calls = %d, want 10", got)
	}
	if got := atomic.LoadInt32(&fg.logouts); got != 0 {
		t.Errorf("logouts = %d, want 0 — a pooled session must outlive the request", got)
	}
}

// The Firewall Policy create page fires five reads in parallel. They must share ONE login, not
// stampede the device with five.
func TestPool_ConcurrentAcquireLogsInOnce(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	var wg sync.WaitGroup
	errs := make([]error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			fc, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"})
			if err != nil {
				errs[i] = err
				return
			}
			_, errs[i] = fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 for a 5-way parallel page load", got)
	}
}

// Separate devices must not share a session.
func TestPool_SeparatePerDevice(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	for _, id := range []uint{1, 2, 3} {
		if _, err := AcquireFortiClient(id, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
			t.Fatalf("device %d: %v", id, err)
		}
	}
	if got := atomic.LoadInt32(&fg.logins); got != 3 {
		t.Errorf("logins = %d, want 3 (one per device)", got)
	}
	if got := PooledSessionCount(); got != 3 {
		t.Errorf("pooled sessions = %d, want 3", got)
	}
}

// ─── expiry and self-healing ─────────────────────────────────────────────────

// A session older than sessionTTL is replaced before the device would drop it.
func TestPool_ExpiredSessionIsReplaced(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	// Age the entry past its TTL.
	e := fortiSessions.entry(sessionKey(1, host, port, poolScopeFor(0)))
	e.mu.Lock()
	e.expiresAt = time.Now().Add(-time.Second)
	e.mu.Unlock()

	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
		t.Fatalf("second acquire: %v", err)
	}
	if got := atomic.LoadInt32(&fg.logins); got != 2 {
		t.Errorf("logins = %d, want 2 (expired session must be renewed)", got)
	}
}

// sessionTTL has to sit under the device's admintimeout, or the pool hands out dead sessions.
func TestPool_TTLIsUnderDeviceAdminTimeout(t *testing.T) {
	const deviceAdminTimeout = 5 * time.Minute // `admintimeout 5` on the lab FGT80E
	if sessionTTL >= deviceAdminTimeout {
		t.Errorf("sessionTTL = %s, must be shorter than the device's admintimeout (%s)",
			sessionTTL, deviceAdminTimeout)
	}
}

// If the device kills the session early (reboot, manual logout), the call re-authenticates and
// replays itself — the caller never sees the 401.
func TestPool_CallRecoversFromExpiredSession(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	fc, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"})
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	fg.expireSession.Store(true) // the device forgets us

	if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
		t.Fatalf("call should have recovered transparently, got: %v", err)
	}
	if got := atomic.LoadInt32(&fg.logins); got != 2 {
		t.Errorf("logins = %d, want 2 (initial + one re-auth)", got)
	}
}

// A one-shot client (no stored credentials) must NOT try to re-login — it would silently retry
// with nothing and confuse the error.
func TestClient_WithoutCredentialsDoesNotReauth(t *testing.T) {
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	fc := NewFortiClient(host, port)
	if err := fc.Login("admin", "pw"); err != nil {
		t.Fatalf("login: %v", err)
	}
	fg.expireSession.Store(true)

	if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err == nil {
		t.Fatal("expected the 401 to surface on a client with no stored credentials")
	}
	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 (no re-auth attempt)", got)
	}
}

// ─── the circuit breaker ─────────────────────────────────────────────────────

// The device locks an admin account after 3 failed logins. One page load makes 5 requests, so
// retrying per request would lock the firewall's admin out. The pool stops at 2.
func TestPool_StopsBeforeDeviceLockoutThreshold(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	fg.rejectLogin.Store(true)

	for i := 0; i < 5; i++ {
		if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "wrong"}); err == nil {
			t.Fatalf("attempt %d unexpectedly succeeded", i)
		}
	}

	const deviceLockoutThreshold = 3 // `admin-lockout-threshold 3`
	got := int(atomic.LoadInt32(&fg.logins))
	if got >= deviceLockoutThreshold {
		t.Errorf("sent %d login attempts; the device locks the account at %d — the breaker must trip first",
			got, deviceLockoutThreshold)
	}
	if got != loginFailThreshold {
		t.Errorf("login attempts = %d, want %d", got, loginFailThreshold)
	}
}

// While the breaker is open the error must say so, rather than looking like a credential problem.
func TestPool_BreakerErrorExplainsItself(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	fg.rejectLogin.Store(true)

	for i := 0; i < loginFailThreshold; i++ {
		_, _ = AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "wrong"})
	}
	_, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "wrong"})
	if err == nil {
		t.Fatal("expected the breaker to refuse")
	}
	for _, want := range []string{"temporarily disabled", "locks an admin account"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should mention %q", err, want)
		}
	}
}

// Once the credentials are right again the breaker must clear, not stay latched.
func TestPool_BreakerResetsAfterSuccess(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	fg.rejectLogin.Store(true)
	_, _ = AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "wrong"})

	fg.rejectLogin.Store(false)
	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "right"}); err != nil {
		t.Fatalf("a good login after one failure should succeed: %v", err)
	}

	e := fortiSessions.entry(sessionKey(1, host, port, poolScopeFor(0)))
	e.mu.Lock()
	fails, blocked := e.fails, e.blockedUntil
	e.mu.Unlock()
	if fails != 0 || !blocked.IsZero() {
		t.Errorf("breaker state = fails:%d blockedUntil:%v, want cleared", fails, blocked)
	}
}

// ─── invalidation ────────────────────────────────────────────────────────────

// Editing a device's credentials or address must drop the cached session, or the next few minutes
// of requests keep using the old login.
func TestPool_InvalidateForcesFreshLogin(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
		t.Fatalf("acquire: %v", err)
	}
	InvalidateAllDeviceSessions(1)

	if got := PooledSessionCount(); got != 0 {
		t.Errorf("pooled sessions after invalidate = %d, want 0", got)
	}
	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
		t.Fatalf("re-acquire: %v", err)
	}
	if got := atomic.LoadInt32(&fg.logins); got != 2 {
		t.Errorf("logins = %d, want 2 (invalidation must force a new one)", got)
	}
}

// Invalidating one device must not disturb another's session.
func TestPool_InvalidateIsScopedToOneDevice(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	for _, id := range []uint{1, 2} {
		if _, err := AcquireFortiClient(id, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
			t.Fatalf("device %d: %v", id, err)
		}
	}
	InvalidateAllDeviceSessions(1)

	if got := PooledSessionCount(); got != 1 {
		t.Errorf("pooled sessions = %d, want 1 (device 2 must survive)", got)
	}
}

// ─── round trips actually saved ──────────────────────────────────────────────

// The real cost of the old login→call→logout pattern was not just the extra requests: every one
// built a NEW http.Client, so every operation paid a fresh TCP connect + TLS handshake. Measured
// against the lab FGT80E, one request on a fresh connection is ~0.119s of which ~0.078s is the
// handshake — roughly two thirds of the request spent before any work happens.
//
// A pooled client keeps its transport, so the handshake is paid once. Counting connections is the
// deterministic way to prove that; wall-clock on a live device is too noisy to assert on.
func TestPool_ReusesOneTCPConnection(t *testing.T) {
	resetPool(t)
	var conns int32
	fg := newPoolFakeDevice(t, countNewConnections(&conns))
	host, port := fg.hostPort(t)

	for i := 0; i < 10; i++ {
		fc, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"})
		if err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
		if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}

	// 1 connection carries the login plus all ten calls. The old code needed one per operation.
	if got := atomic.LoadInt32(&conns); got != 1 {
		t.Errorf("TCP connections = %d, want 1 — each extra one is a full TLS handshake", got)
	}
}

// Sanity check on the counter itself: a client with its own transport really does open its own
// connection. Three of them, three connections — which is what proves the counter above is
// measuring something and not just always reading 1.
//
// It has to build its own transport to demonstrate that, and that is the point of the test below.
func TestClientsWithTheirOwnTransport_OpenAConnectionEach(t *testing.T) {
	var conns int32
	fg := newPoolFakeDevice(t, countNewConnections(&conns))
	host, port := fg.hostPort(t)

	for i := 0; i < 3; i++ {
		fc := NewFortiClient(host, port)
		// Its own pool, which is what every FortiClient used to have.
		tr := fgTransport.Clone()
		fc.httpClient.Transport = tr
		t.Cleanup(tr.CloseIdleConnections)

		if err := fc.Login("admin", "pw"); err != nil {
			t.Fatalf("login %d: %v", i, err)
		}
		if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}

	if got := atomic.LoadInt32(&conns); got != 3 {
		t.Errorf("TCP connections = %d, want 3 (one per client with its own transport)", got)
	}
}

// The other half of the same fact, and a saving in its own right: a client that is NOT in the
// session pool still shares the process-wide connection pool (see fgTransport), so it does not pay
// a TLS handshake either.
//
// That matters because several paths deliberately do not pool: "Test this credential" on the
// Device Credentials page, and the AI Assistant's own short-lived session. Each of those used to
// open a fresh socket and handshake it — ~0.078s of a ~0.119s request against the lab FGT80E —
// for one call.
func TestThrowawayClientsStillShareTheConnectionPool(t *testing.T) {
	var conns int32
	fg := newPoolFakeDevice(t, countNewConnections(&conns))
	host, port := fg.hostPort(t)

	for i := 0; i < 3; i++ {
		fc := NewFortiClient(host, port)
		if err := fc.Login("admin", "pw"); err != nil {
			t.Fatalf("login %d: %v", i, err)
		}
		if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}

	// One connection carries three separate logins and three calls. The SESSIONS are still
	// separate — each client has its own cookie jar — because a shared TCP connection carries no
	// identity of its own; the session cookie travels in each request.
	if got := atomic.LoadInt32(&conns); got != 1 {
		t.Errorf("TCP connections = %d, want 1 — three throwaway clients should share the pooled "+
			"connection rather than each handshaking their own", got)
	}
}

// ── the pool key ─────────────────────────────────────────────────────────────

// The regression this replaced, stated as a test.
//
// The key used to be the device plus the USERNAME. Two stored credentials very often carry the same
// username — a person's own firewall account is usually called `admin`, the same name the device's
// automation account uses — so they shared one pooled session AND one circuit breaker. One stale
// password therefore locked everybody else out of that firewall, including the background alert
// sweep, which then reported the healthy device as unreachable. Observed on the lab box.
func TestSessionKey_SeparatesCredentialsSharingAUsername(t *testing.T) {
	mine := DeviceLogin{Username: "admin", Password: "right", CredentialID: 7, Personal: true}
	theirs := DeviceLogin{Username: "admin", Password: "stale", CredentialID: 9, Personal: true}
	automation := DeviceLogin{Username: "admin", Password: "right"}

	keys := map[string]string{
		"mine":       sessionKey(1, "10.0.0.1", 443, mine.PoolScope()),
		"theirs":     sessionKey(1, "10.0.0.1", 443, theirs.PoolScope()),
		"automation": sessionKey(1, "10.0.0.1", 443, automation.PoolScope()),
		"probe":      sessionKey(1, "10.0.0.1", 443, probeLogin("admin", "typo").PoolScope()),
	}

	seen := map[string]string{}
	for name, k := range keys {
		if other, dup := seen[k]; dup {
			t.Errorf("%q and %q share pool entry %q — one stale password would lock out the other",
				name, other, k)
		}
		seen[k] = name
	}
}

// The same credential must still be ONE session, or every page load would open another.
func TestSessionKey_SameCredentialIsOneEntry(t *testing.T) {
	a := DeviceLogin{Username: "admin", Password: "pw", CredentialID: 7}
	b := DeviceLogin{Username: "renamed-since", Password: "rotated-since", CredentialID: 7}

	if sessionKey(1, "h", 443, a.PoolScope()) != sessionKey(1, "h", 443, b.PoolScope()) {
		t.Error("one credential produced two pool entries — a rename must not orphan its session")
	}
}

// A device's own automation slot is distinct per device, and separate from any personal credential.
func TestSessionKey_StillSeparatesDevicesAndPorts(t *testing.T) {
	l := DeviceLogin{Username: "admin", Password: "pw"}
	if sessionKey(1, "h", 443, l.PoolScope()) == sessionKey(2, "h", 443, l.PoolScope()) {
		t.Error("two devices shared a pool entry")
	}
	if sessionKey(1, "h", 443, l.PoolScope()) == sessionKey(1, "h", 8443, l.PoolScope()) {
		t.Error("two ports shared a pool entry")
	}
}

// A wrong password typed into "test this account" must not open the breaker for the account that is
// already working — least of all for the one the scheduler uses.
func TestProbeLogin_BreakerIsIsolatedFromRealSessions(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	// Three bad "test" attempts — past the pool's own 2-failure threshold.
	for i := 0; i < 3; i++ {
		_, _ = AcquireFortiClient(1, host, port, probeLogin("admin", "wrong"))
	}

	// The device's automation account must still be able to log in.
	if _, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"}); err != nil {
		t.Fatalf("a failed credential TEST blocked the account the scheduler uses: %v", err)
	}
}

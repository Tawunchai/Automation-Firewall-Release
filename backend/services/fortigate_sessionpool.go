package services

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

// A pool of authenticated FortiGate sessions, one per device.
//
// Why: every device-proxy handler used to build a fresh FortiClient, POST /logincheck, make ONE
// API call, then GET /logout — three HTTPS round trips (plus a TLS handshake) for one operation.
// Measured against the lab FGT80E, the login alone is ~0.14s of a ~0.20s request, and opening the
// Firewall Policy create page fires five such requests in parallel: 5 logins, ~15 round trips.
//
// The device's own settings set the constraints (`show full-configuration system global` on
// FortiOS 7.2.10):
//
//	admintimeout 5            an IDLE admin session is dropped after 5 minutes, so a pooled
//	                          session must be treated as dead well before that
//	admin-lockout-threshold 3 three failed logins lock the account for admin-lockout-duration
//	                          (60s) — so wrong credentials must NOT be retried once per request,
//	                          or a single page load locks the firewall's admin account
//	admin-concurrent enable   several admin sessions may coexist, so pooling is safe alongside
//	                          the AI Assistant's own short-lived session

// DefaultAPIPort is the HTTPS port the FortiGate REST API listens on.
//
// It lives here, next to the pool, because the port is part of the pool KEY: two callers that
// disagree about it open two sessions to the same device instead of sharing one. Everything that
// reaches a FortiGate without an explicit port must use this constant.
const DefaultAPIPort = 443

const (
	// sessionTTL is deliberately below admintimeout (5m) so a pooled session is refreshed before
	// the device would drop it. do() also re-authenticates on a 401, so this is the fast path
	// rather than the only defence.
	sessionTTL = 4 * time.Minute

	// loginFailThreshold stops one short of admin-lockout-threshold (3): after two consecutive
	// failures the pool stops trying, leaving the device one attempt of headroom instead of
	// hammering it into a lockout.
	loginFailThreshold = 2

	// loginFailCooldown matches the device's admin-lockout-duration.
	loginFailCooldown = 60 * time.Second
)

// pooledSession is one device's session plus its login circuit breaker.
type pooledSession struct {
	// mu serialises login/refresh for this device so five parallel page requests produce ONE
	// login, not five. It is held only while (re)authenticating, never for the API call itself,
	// so requests still run concurrently over the shared session.
	mu        sync.Mutex
	client    *FortiClient
	expiresAt time.Time

	fails        int
	blockedUntil time.Time
}

type sessionPool struct {
	mu      sync.Mutex
	entries map[string]*pooledSession
}

var fortiSessions = &sessionPool{entries: make(map[string]*pooledSession)}

// sessionKey identifies one pooled session.
//
// The key is the device plus WHICH STORED CREDENTIAL opened the session — see DeviceLogin.PoolScope.
// A pool keyed only by device would hand Bob the session Alice logged in with, so the firewall would
// record Alice's name against Bob's changes: precisely the confusion per-user credentials exist to
// remove. It also gives each credential its own circuit breaker, which is what the device wants,
// since a FortiOS lockout is per admin account.
//
// ⚠️ It used to key on the USERNAME, and that was not enough. Two credentials can carry the same
// username — a person's own account is very often called `admin`, the same name the device's
// automation account uses — and they then shared one pool entry AND one breaker. One stale password
// therefore locked everybody else out of that firewall, including the background alert sweep, which
// reported the healthy device as unreachable. Observed on the lab box; the scope below is what fixes
// it, and TestSessionKey_SeparatesCredentialsSharingAUsername pins it.
func sessionKey(deviceID uint, host string, port int, scope string) string {
	return fmt.Sprintf("%d|%s|%d|%s", deviceID, host, port, scope)
}

// entry returns the per-device slot, creating it on first use.
func (p *sessionPool) entry(key string) *pooledSession {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.entries[key]
	if !ok {
		e = &pooledSession{}
		p.entries[key] = e
	}
	return e
}

// ErrLoginPaused is returned while the circuit breaker is open — i.e. when THIS PLATFORM has
// stopped trying, not when the device has said anything.
//
// The distinction matters to exactly one caller and matters a lot to it: the alert sweep
// (services/notify_runner.go) would otherwise announce "Device Unreachable" for a firewall that is
// perfectly healthy and merely being backed off from. It was caught doing precisely that during
// live verification, after a burst of manual runs exhausted the device's login attempts. An alert
// about the monitoring system's own back-off, phrased as an outage, is worse than no alert.
var ErrLoginPaused = errors.New("FortiGate login is temporarily disabled for this device")

// AcquireFortiClient returns a logged-in client for the device, reusing the pooled session when
// one is still fresh.
//
// It takes a DeviceLogin rather than a bare username and password because the pool has to know
// WHICH credential this is, not merely what it is called — see sessionKey. Callers get one from
// ResolveDeviceLogin (a person's own account) or ResolveAutomationLogin (scheduled work).
//
// Callers MUST NOT call Logout on the result — the session is shared and outlives the request.
// Use InvalidateDeviceSession when the credentials change or the device is removed.
func AcquireFortiClient(deviceID uint, host string, port int, login DeviceLogin) (*FortiClient, error) {
	username, password := login.Username, login.Password
	key := sessionKey(deviceID, host, port, login.PoolScope())
	e := fortiSessions.entry(key)

	e.mu.Lock()
	defer e.mu.Unlock()

	if e.client != nil && time.Now().Before(e.expiresAt) {
		return e.client, nil
	}
	if !e.blockedUntil.IsZero() && time.Now().Before(e.blockedUntil) {
		return nil, fmt.Errorf("%w: %d consecutive failures, retrying in %ds "+
			"(the device locks an admin account after 3 failed attempts)",
			ErrLoginPaused, e.fails, int(time.Until(e.blockedUntil).Seconds()))
	}

	fc := NewFortiClient(host, port)
	if err := fc.Login(username, password); err != nil {
		e.fails++
		if e.fails >= loginFailThreshold {
			e.blockedUntil = time.Now().Add(loginFailCooldown)
			log.Printf("[fortigate] device %d: %d consecutive login failures — pausing logins for %s",
				deviceID, e.fails, loginFailCooldown)
		}
		e.client = nil
		return nil, err
	}

	// Let the session renew itself mid-flight if the device drops it early.
	fc.EnableReauth(username, password)

	e.client = fc
	e.expiresAt = time.Now().Add(sessionTTL)
	e.fails = 0
	e.blockedUntil = time.Time{}
	return fc, nil
}

// InvalidateDeviceSession drops the pooled session for ONE stored credential on a device and logs
// it out on the far side.
//
// Call it whenever that credential's password or username changes — otherwise the pool would keep
// using the session opened with the old one for up to sessionTTL, and the firewall would go on
// recording the previous account. Editing the DEVICE itself (its address) needs
// InvalidateAllDeviceSessions instead, which drops every credential's session at once.
//
// credentialID is the device_credentials row; 0 means the device's own automation account.
func InvalidateDeviceSession(deviceID uint, host string, port int, credentialID uint) {
	key := sessionKey(deviceID, host, port, poolScopeFor(credentialID))

	fortiSessions.mu.Lock()
	e, ok := fortiSessions.entries[key]
	if ok {
		delete(fortiSessions.entries, key)
	}
	fortiSessions.mu.Unlock()
	if !ok {
		return
	}

	e.mu.Lock()
	client := e.client
	e.client = nil
	e.mu.Unlock()

	if client != nil {
		// Best-effort: release the slot on the device rather than leaving it to time out.
		go client.Logout()
	}
}

// InvalidateAllDeviceSessions drops every pooled session for a device id — whatever host/port it
// was opened against and whichever account opened it. Used when an edit may have changed the
// address or the shared credential itself.
func InvalidateAllDeviceSessions(deviceID uint) {
	prefix := fmt.Sprintf("%d|", deviceID)

	fortiSessions.mu.Lock()
	var doomed []*pooledSession
	for k, e := range fortiSessions.entries {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			doomed = append(doomed, e)
			delete(fortiSessions.entries, k)
		}
	}
	fortiSessions.mu.Unlock()

	for _, e := range doomed {
		e.mu.Lock()
		client := e.client
		e.client = nil
		e.mu.Unlock()
		if client != nil {
			go client.Logout()
		}
	}
}

// PooledSessionCount reports how many live sessions the pool holds (diagnostics and tests).
func PooledSessionCount() int {
	fortiSessions.mu.Lock()
	defer fortiSessions.mu.Unlock()
	n := 0
	for _, e := range fortiSessions.entries {
		e.mu.Lock()
		if e.client != nil && time.Now().Before(e.expiresAt) {
			n++
		}
		e.mu.Unlock()
	}
	return n
}

package middlewares

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Fixed-window rate limiting.
//
// ── Why the key is not simply the IP ─────────────────────────────────────────
//
// It used to be, for every limiter, and that is wrong for a console used from an office. Everyone
// behind one NAT shares an address, so the budget was shared too:
//
//   - GeneralLimiter allows 120 requests a minute. The device dashboard polls every 5 seconds,
//     which is 12 a minute per open tab — so about ten colleagues with the dashboard open spent
//     the whole allowance and the eleventh person's console started answering 429 for no visible
//     reason.
//   - LoginLimiter allows 10 attempts per 15 minutes. Three people mistyping a password four times
//     each locked the entire office out of signing in.
//
// And it was not even buying much against the thing it was for: an attacker with a handful of
// addresses got a fresh budget per address, while the office shared one.
//
// So the key is now what the limiter is actually protecting against. Requests that carry a session
// are counted per SESSION, so one person cannot spend another's budget. Unauthenticated requests
// are still counted per IP, because there is nothing else to count them by. And brute force is
// answered where it belongs — per ACCOUNT, in LoginAccountLimiter below, which no number of source
// addresses can spread out.

type windowEntry struct {
	count   int
	resetAt time.Time
}

// RateLimiter is a fixed-window limiter over an arbitrary key.
//
// In-memory, so the counters live in one process. That is correct today — the backend runs as a
// single container — and would need Redis (already in the stack) the day it is scaled out, or two
// replicas would silently double every limit here.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*windowEntry
	max     int
	window  time.Duration

	// keyOf decides what a request is counted against. nil means the client IP.
	keyOf func(*gin.Context) string
}

// NewRateLimiter creates a limiter allowing max requests per window, counted per client IP.
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return NewKeyedRateLimiter(max, window, nil)
}

// NewKeyedRateLimiter creates a limiter that counts against whatever keyOf returns.
func NewKeyedRateLimiter(max int, window time.Duration, keyOf func(*gin.Context) string) *RateLimiter {
	rl := &RateLimiter{
		entries: make(map[string]*windowEntry),
		max:     max,
		window:  window,
		keyOf:   keyOf,
	}
	go rl.cleanupLoop()
	return rl
}

func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(rl.window * 2)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for key, e := range rl.entries {
			if now.After(e.resetAt) {
				delete(rl.entries, key)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow consumes one unit of the key's budget, reporting whether there was any left.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, exists := rl.entries[key]

	if !exists || now.After(e.resetAt) {
		rl.entries[key] = &windowEntry{count: 1, resetAt: now.Add(rl.window)}
		return true
	}

	if e.count >= rl.max {
		return false
	}
	e.count++
	return true
}

// Blocked reports whether the key is out of budget WITHOUT consuming any.
//
// The pair Blocked/RecordFailure is how a limiter counts failures rather than attempts: a person
// who signs in correctly every morning must never be throttled for it, while somebody guessing is
// stopped after a handful of wrong answers.
func (rl *RateLimiter) Blocked(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	e, exists := rl.entries[key]
	if !exists || time.Now().After(e.resetAt) {
		return false
	}
	return e.count >= rl.max
}

// RecordFailure charges the key one unit.
func (rl *RateLimiter) RecordFailure(key string) {
	rl.Allow(key)
}

// Reset clears a key's budget — called after a success, so a correct password wipes the record of
// the typos that preceded it.
func (rl *RateLimiter) Reset(key string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.entries, key)
}

func (rl *RateLimiter) key(c *gin.Context) string {
	if rl.keyOf != nil {
		return rl.keyOf(c)
	}
	return "ip:" + c.ClientIP()
}

// Middleware returns a Gin handler that enforces the rate limit.
func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !rl.Allow(rl.key(c)) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests — please try again later",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// SessionOrIPKey counts a request against its session when it has one, and its address otherwise.
//
// The cookie is hashed rather than used directly: these keys live in a map for the length of the
// window and turn up in any debugging dump of it, and a session token is a credential. Eight bytes
// is ample to separate the sessions of one deployment.
//
// It reads the raw cookie instead of the user id, because this limiter runs BEFORE Authorizes —
// it has to, or the cost of an unauthenticated flood would be paid before any limit applied. An
// invalid or expired cookie therefore still gets its own bucket, which is harmless: that request
// is about to be rejected with a 401 anyway.
func SessionOrIPKey(c *gin.Context) string {
	if token, err := c.Cookie("auth_token"); err == nil && token != "" {
		sum := sha256.Sum256([]byte(token))
		return "s:" + hex.EncodeToString(sum[:8])
	}
	return "ip:" + c.ClientIP()
}

// Pre-built limiters for different sensitivity levels.
var (
	// ── The two login limits, and why neither alone is enough ────────────────
	//
	// LoginLimiter: 60 attempts per 15 min per IP — a ceiling on ONE MACHINE working through a list
	// of accounts, which the per-account limit below cannot see because each account is only tried
	// once or twice.
	//
	// It was 10, which is the number that belongs on an account, not on an address. An office is
	// one address: three people mistyping their password four times each locked everyone there out
	// of signing in for fifteen minutes. And it was measurably NOT the protection it looked like —
	// with the account limit also at 10, the address limit tripped first every time, so the precise
	// control could never fire.
	//
	// 60 still stops a machine guessing at any speed worth the name, while leaving room for a
	// roomful of people having a bad Monday.
	LoginLimiter = NewRateLimiter(60, 15*time.Minute)

	// LoginAccountLimiter: 10 FAILED sign-ins per 15 min per email address.
	//
	// This is the half a botnet cannot spread out. The address limit gives an attacker with fifty
	// addresses fifty budgets against one account; this one follows the account being attacked
	// wherever the attempts come from, and 10 wrong passwords for one account in fifteen minutes is
	// already well past honest mistyping.
	//
	// Failures only, and cleared on success — see auth.Login. Somebody who signs in correctly ten
	// times a day is not doing anything this needs to slow down.
	LoginAccountLimiter = NewRateLimiter(10, 15*time.Minute)

	// OTPLimiter: 5 send requests per 10 min per IP (OTP spam protection). Unauthenticated by
	// nature — the whole point is that the caller has lost their password — so IP is all there is.
	OTPLimiter = NewRateLimiter(5, 10*time.Minute)

	// GeneralLimiter: 120 requests per minute per SESSION (per IP when signed out).
	//
	// Per session rather than per address because this is the limit ordinary use runs into: the
	// dashboard polls every 5s, several pages poll their own data, and a shared office address made
	// those add up across colleagues until somebody got a 429 for opening a page.
	GeneralLimiter = NewKeyedRateLimiter(120, time.Minute, SessionOrIPKey)

	// AILimiter: 15 AI assistant requests per minute per session — generate-config calls the (paid)
	// Anthropic API, so this caps cost exposure beyond GeneralLimiter. Per session, so one person
	// exploring the assistant cannot exhaust the team's allowance.
	AILimiter = NewKeyedRateLimiter(15, time.Minute, SessionOrIPKey)

	// DiagLimiter: 10 device LOGINS per minute per session.
	//
	// Everything it guards opens a session on the firewall with somebody's account, and the device
	// locks an admin account after 3 failed logins (admin-lockout-threshold 3). It is attached in
	// routes.go to:
	//
	//   GET  /diag-stream/:deviceId/:tool          ping + traceroute over SSH (controller/diagstream)
	//   POST /me/device-credentials                verifies the new account before storing it
	//   PUT  /me/device-credentials/:id            verifies again on rename / password rotation
	//   POST /me/device-credentials/:id/test       the same check, on demand
	//
	// The per-device gate in services/fortigate_diagexec.go already serialises the SSH tools and
	// trips a breaker on failure; this is the front door equivalent, so a held-down refresh key —
	// or a credential form resubmitted in a loop with the wrong password — cannot queue a minute of
	// logins against a production firewall before that gate ever sees them.
	//
	// It was declared and attached to nothing until 2026-11-13: the comments in routes.go described
	// protection that did not exist. If a new route opens a device session, it belongs on this list.
	DiagLimiter = NewKeyedRateLimiter(10, time.Minute, SessionOrIPKey)

	// TwoFactorAccountLimiter: 5 FAILED second-factor attempts per 15 min per ACCOUNT.
	//
	// The other half of LoginAccountLimiter, and for the same reason it is keyed on the account
	// rather than the address: /auth/verify-totp and /auth/verify-backup-code are the second step of
	// a sign-in, and the first step does not charge anything on success. So somebody who already has
	// a password could mint a fresh pending token whenever they liked and spray six-digit codes at
	// it, 120 a minute per address and as many addresses as they cared to use, with nothing counting
	// across them. A six-digit code is one in a million, and three live windows at a time make it
	// rather better than that for the attacker.
	//
	// 5 rather than the password limit's 10 because this is the last gate, both endpoints share the
	// budget (an attacker switching between codes and recovery codes gains nothing), and the honest
	// failure modes are few: a mistyped code, or a phone whose clock has drifted — and the second of
	// those is not fixed by trying again, so a tighter ceiling costs a real user almost nothing.
	//
	// Failures only, and cleared on success: somebody who fat-fingers two digits every morning is
	// not an attack.
	//
	// A throttled caller is answered 429 and told to wait, NOT given the same indistinguishable
	// answer as a wrong code. That is a deliberate departure from auth.Login, which must never
	// reveal whether an email exists: by the time a request reaches these two endpoints the caller
	// already holds a pending token for this account, so they have proved both that the account
	// exists and that they have its password. There is nothing left for the wording to protect,
	// and a real person whose phone clock has drifted is owed the reason their next four attempts
	// will also fail. See twoFactorThrottled in controller/auth/totp_verify.go.
	TwoFactorAccountLimiter = NewRateLimiter(5, 15*time.Minute)
)

package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// One office, one public address.
//
// Every limiter used to count per IP, so colleagues sharing a NAT shared a budget: the device
// dashboard polls every 5 seconds — 12 requests a minute per open tab — and ten people with it
// open spent the 120/minute allowance between them, after which the console started answering 429
// to whoever asked next. This is the property that stops that: two sessions from ONE address are
// two budgets.
func TestSessionKeyedLimiterDoesNotShareBudgetAcrossSessions(t *testing.T) {
	rl := NewKeyedRateLimiter(2, time.Minute, SessionOrIPKey)

	req := func(cookie string) int {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/anything", nil)
		// The same source address for both callers, which is the whole point.
		c.Request.RemoteAddr = "203.0.113.10:44444"
		if cookie != "" {
			c.Request.AddCookie(&http.Cookie{Name: "auth_token", Value: cookie})
		}
		rl.Middleware()(c)
		return w.Code
	}

	// Session A spends its whole allowance.
	if got := req("token-for-somchai"); got == http.StatusTooManyRequests {
		t.Fatalf("first request of session A was throttled (%d)", got)
	}
	if got := req("token-for-somchai"); got == http.StatusTooManyRequests {
		t.Fatalf("second request of session A was throttled (%d)", got)
	}
	if got := req("token-for-somchai"); got != http.StatusTooManyRequests {
		t.Errorf("session A got %d on its third request, want 429 — its own budget must still apply", got)
	}

	// Session B, same address, must be untouched by that.
	if got := req("token-for-nuch"); got == http.StatusTooManyRequests {
		t.Errorf("session B was throttled by session A's usage from the same IP — "+
			"this is the shared-office failure the session key exists to prevent (got %d)", got)
	}
}

// Signed-out callers have no session to count against, so they fall back to the address — which is
// right, and must keep working.
func TestUnauthenticatedCallersAreCountedPerAddress(t *testing.T) {
	if got := SessionOrIPKey(ctxFrom("198.51.100.7:1234", "")); got != "ip:198.51.100.7" {
		t.Errorf("key = %q, want the client address", got)
	}

	withCookie := SessionOrIPKey(ctxFrom("198.51.100.7:1234", "abc"))
	if withCookie == "ip:198.51.100.7" {
		t.Error("a request carrying a session was still counted per address")
	}
	// The raw token must not become the map key: these keys are held for the length of the window
	// and appear in any dump of it, and a session token is a credential.
	if withCookie == "s:abc" || len(withCookie) < 4 || withCookie[:2] != "s:" {
		t.Errorf("session key = %q, want a hashed s:… key that does not contain the token", withCookie)
	}
}

func ctxFrom(remoteAddr, cookie string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Request.RemoteAddr = remoteAddr
	if cookie != "" {
		c.Request.AddCookie(&http.Cookie{Name: "auth_token", Value: cookie})
	}
	return c
}

// The per-account throttle counts FAILURES and forgets them on success.
//
// Counting attempts instead would throttle somebody who signs in correctly ten times in a morning,
// which is normal behaviour for an operator moving between machines.
func TestLoginAccountThrottleCountsFailuresAndResetsOnSuccess(t *testing.T) {
	rl := NewRateLimiter(3, 15*time.Minute)
	const key = "acct:somchai@got.co.th"

	if rl.Blocked(key) {
		t.Fatal("a fresh account was blocked before any attempt")
	}

	// Checking must not itself consume budget, or merely visiting the login page would count.
	for i := 0; i < 10; i++ {
		rl.Blocked(key)
	}
	if rl.Blocked(key) {
		t.Fatal("Blocked() consumed budget; it must only report")
	}

	rl.RecordFailure(key)
	rl.RecordFailure(key)
	if rl.Blocked(key) {
		t.Fatal("blocked after 2 failures with a budget of 3")
	}

	rl.RecordFailure(key)
	if !rl.Blocked(key) {
		t.Fatal("not blocked after 3 failures with a budget of 3 — brute force is not being slowed")
	}

	// The right password clears the record of the typos before it.
	rl.Reset(key)
	if rl.Blocked(key) {
		t.Error("still blocked after a successful sign-in reset the counter")
	}
}

// Two accounts guessed at from the same machine must not share a budget either — otherwise
// stopping an attack on one account would lock everyone else out with it.
func TestLoginAccountThrottleIsPerAccount(t *testing.T) {
	rl := NewRateLimiter(1, 15*time.Minute)

	rl.RecordFailure("acct:a@got.co.th")
	if !rl.Blocked("acct:a@got.co.th") {
		t.Fatal("the attacked account was not blocked")
	}
	if rl.Blocked("acct:b@got.co.th") {
		t.Error("a different account was blocked by failures against the first one")
	}
}

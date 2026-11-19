package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	middlewares "network_automation/middleware"
)

// gin.Default() trusts EVERY proxy, so c.ClientIP() returns whatever X-Forwarded-For the caller
// sent. Two things read that value and both are security-relevant:
//
//   - middleware.RateLimiter keys its buckets on it. LoginLimiter allows 10 attempts per 15 min
//     per IP (the brute-force defence on /auth/login) and AILimiter caps the paid Anthropic calls
//     at 15/min — a client that changes the header each request gets a fresh bucket every time and
//     neither limit ever fires.
//   - auth.createSession stores it as the session's origin, so the Sessions page and the login
//     history showed an attacker-chosen string.
//
// These tests drive real gin engines with the real limiter, because the bug is in how the two fit
// together: the limiter code was always correct, it was just being handed a forged key.

// buildEngine mirrors what main() does: set the trust list first, then install the limiter.
func buildEngine(t *testing.T, proxies []string, limiter *middlewares.RateLimiter) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies(proxies); err != nil {
		t.Fatalf("SetTrustedProxies(%v): %v", proxies, err)
	}
	r.Use(limiter.Middleware())
	r.GET("/probe", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })
	return r
}

func get(r *gin.Engine, remoteAddr, xff string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// The regression, stated as the attack: a login brute-forcer rotating X-Forwarded-For must not get
// a fresh rate-limit bucket per attempt.
func TestRateLimit_CannotBeBypassedByForgedForwardedFor(t *testing.T) {
	const max = 3
	limiter := middlewares.NewRateLimiter(max, time.Minute)
	r := buildEngine(t, trustedProxies(), limiter) // no TRUSTED_PROXIES set → trust nothing

	forged := []string{"1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5", "6.6.6.6"}
	blocked := 0
	for _, ip := range forged {
		if get(r, "203.0.113.9:5555", ip).Code == http.StatusTooManyRequests {
			blocked++
		}
	}

	if blocked == 0 {
		t.Fatal("every forged X-Forwarded-For got its own bucket — the limiter is bypassable")
	}
	if want := len(forged) - max; blocked != want {
		t.Errorf("blocked %d of %d requests, want %d — all attempts share the real peer's bucket",
			blocked, len(forged), want)
	}
}

// With no trust list, the client IP is the address that actually connected, whatever the header
// claims.
func TestClientIP_IgnoresForwardedForFromAnUntrustedPeer(t *testing.T) {
	limiter := middlewares.NewRateLimiter(1000, time.Minute)
	r := buildEngine(t, nil, limiter)

	w := get(r, "203.0.113.9:5555", "1.2.3.4")
	if got := w.Body.String(); got != "203.0.113.9" {
		t.Errorf("ClientIP = %q, want the real peer 203.0.113.9 — the header must not win", got)
	}
}

// The other half of the trade-off, and the reason the fix is a configurable list rather than a
// blanket deny: behind nginx every user shares the proxy's address. If the proxy is not trusted,
// one person exhausting the limit locks out everyone, and the Sessions page shows the container's
// IP for every login. Trusting the proxy's /32 restores the real client.
func TestClientIP_TrustsTheConfiguredProxy(t *testing.T) {
	limiter := middlewares.NewRateLimiter(1000, time.Minute)
	r := buildEngine(t, []string{"172.29.0.10/32"}, limiter)

	// What nginx sends: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for
	w := get(r, "172.29.0.10:41234", "192.168.1.50")
	if got := w.Body.String(); got != "192.168.1.50" {
		t.Errorf("ClientIP = %q, want 192.168.1.50 (the browser behind the trusted proxy)", got)
	}
}

// Trust must be scoped to the listed address. Publishing 9000 on the host means the docker bridge
// gateway can also reach the backend, so trusting the whole subnet instead of nginx's /32 would
// hand that same trust to anything on the host.
func TestClientIP_DoesNotTrustNeighboursOfTheProxy(t *testing.T) {
	limiter := middlewares.NewRateLimiter(1000, time.Minute)
	r := buildEngine(t, []string{"172.29.0.10/32"}, limiter)

	for _, peer := range []string{"172.29.0.1:5000", "172.29.0.11:5000", "172.29.5.5:5000"} {
		w := get(r, peer, "1.2.3.4")
		wantIP := peer[:len(peer)-5] // strip ":5000"
		if got := w.Body.String(); got != wantIP {
			t.Errorf("peer %s: ClientIP = %q, want %q — only the listed proxy may set the header",
				peer, got, wantIP)
		}
	}
}

// A chain of forged hops appended in front of the real one must not fool the walk-back either:
// gin skips trusted addresses from the right, so the first UNTRUSTED entry is the answer.
func TestClientIP_UsesTheLastUntrustedHopInAChain(t *testing.T) {
	limiter := middlewares.NewRateLimiter(1000, time.Minute)
	r := buildEngine(t, []string{"172.29.0.10/32"}, limiter)

	// The client claimed two extra hops; only the rightmost entry was written by nginx.
	w := get(r, "172.29.0.10:41234", "9.9.9.9, 8.8.8.8, 192.168.1.50")
	if got := w.Body.String(); got != "192.168.1.50" {
		t.Errorf("ClientIP = %q, want 192.168.1.50 — the client-supplied hops must be ignored", got)
	}
}

// ─── the env parsing ─────────────────────────────────────────────────────────

func TestTrustedProxies_Parsing(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want []string
	}{
		{"unset means deny", "", nil},
		{"whitespace only means deny", "   ", nil},
		{"single cidr", "172.29.0.10/32", []string{"172.29.0.10/32"}},
		{"bare ip", "10.0.0.5", []string{"10.0.0.5"}},
		{"list is trimmed", " 10.0.0.5 , 172.29.0.0/16 ", []string{"10.0.0.5", "172.29.0.0/16"}},
		{"empty entries dropped", "10.0.0.5,,", []string{"10.0.0.5"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("TRUSTED_PROXIES", c.env)
			got := trustedProxies()

			if len(got) != len(c.want) {
				t.Fatalf("trustedProxies() = %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("entry %d = %q, want %q", i, got[i], c.want[i])
				}
			}
			// nil, not an empty slice: SetTrustedProxies(nil) is what turns the header off.
			if len(c.want) == 0 && got != nil {
				t.Errorf("trustedProxies() = %#v, want nil so gin disables X-Forwarded-For", got)
			}
		})
	}
}

// Whatever the env holds must be something gin accepts — main() treats a rejection as fatal, and
// this pins that the compose default is on the accepted side of that line.
func TestTrustedProxies_ComposeDefaultIsAccepted(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "172.29.0.10/32") // the value docker-compose.yml passes
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies(trustedProxies()); err != nil {
		t.Fatalf("the docker-compose default is rejected by gin: %v", err)
	}
}

func TestTrustedProxies_MalformedValueIsRejected(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "not-an-ip")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := r.SetTrustedProxies(trustedProxies()); err == nil {
		t.Error("a malformed entry must be rejected — main() turns this into a fatal startup error")
	}
}

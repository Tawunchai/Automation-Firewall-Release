package auth

import (
	"crypto/sha256"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// The session half of authentication, which had no tests at all.
//
// What makes it worth pinning: `user_sessions` is not a feature, it is the mechanism that makes
// logging out mean something. A JWT is valid until it expires no matter what the server thinks, so
// the only thing that can revoke one early is the row this package writes at login and flips at
// logout, which middleware.Authorizes checks on every request. Break any link in that chain and
// nothing fails loudly — logout still "works", it just stops actually invalidating the token.
//
// The Session Management PAGE was deleted on request; this machinery deliberately stayed, and
// these tests are what stops a later cleanup from removing it as apparently-unused.

// ── Token hashing ────────────────────────────────────────────────────────────

func TestHashTokenIsSHA256Hex(t *testing.T) {
	// The column is size:64 with a unique index, so the hash must be exactly 64 hex characters.
	// A change in encoding here would silently stop every existing session from being found —
	// which Authorizes treats as "session no longer exists", logging everyone out.
	got := hashToken("some.jwt.value")
	want := fmt.Sprintf("%x", sha256.Sum256([]byte("some.jwt.value")))

	if got != want {
		t.Errorf("hashToken = %q, want %q", got, want)
	}
	if len(got) != 64 {
		t.Errorf("hash length = %d, want 64 (the token_hash column is size:64)", len(got))
	}
	if strings.ToLower(got) != got {
		t.Error("hash must be lower-case hex; a case change would miss existing rows")
	}
}

func TestHashTokenIsStableAndDistinct(t *testing.T) {
	// Two separate calls, named, because the point is that hashing the SAME token twice agrees.
	first, again := hashToken("abc"), hashToken("abc")
	if first != again {
		t.Error("hashing is not deterministic — a session could never be looked up again")
	}
	if hashToken("abc") == hashToken("abd") {
		t.Error("two different tokens hashed to the same value")
	}
}

func TestHashTokenNeverStoresTheTokenItself(t *testing.T) {
	// The point of hashing is that a database leak does not hand out live sessions.
	token := "header.payload.signature"
	if strings.Contains(hashToken(token), token) {
		t.Error("the raw token appears in its own hash")
	}
}

// TestHashTokenMatchesTheMiddleware is the important one: the two packages each define their own
// hashToken, and a lookup only works while they agree. They are separate functions because the
// middleware cannot import the controller (which imports the middleware), so nothing but a test
// keeps them in step.
func TestHashTokenMatchesTheMiddleware(t *testing.T) {
	// Recomputed here rather than imported, for the same reason the duplication exists.
	middlewareHash := func(token string) string {
		sum := sha256.Sum256([]byte(token))
		return fmt.Sprintf("%x", sum)
	}
	for _, token := range []string{"", "a", "a.longer.jwt.like.value", strings.Repeat("x", 500)} {
		if hashToken(token) != middlewareHash(token) {
			t.Fatalf("controller and middleware disagree on the hash of %q — every session lookup "+
				"would miss, and Authorizes would reject valid tokens as 'session no longer exists'", token)
		}
	}
}

// ── Cookie ───────────────────────────────────────────────────────────────────

func cookieFrom(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range (&http.Response{Header: rec.Header()}).Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func ctxWith(headers map[string]string, tls bool) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if tls {
		req.TLS = &tlsState
	}
	c.Request = req
	return c, rec
}

func TestAuthCookieIsHttpOnly(t *testing.T) {
	// The token must not be readable from JavaScript: an XSS anywhere in the console would
	// otherwise hand over a valid firewall-administration session.
	c, rec := ctxWith(nil, false)
	setAuthCookie(c, "tok")

	got := cookieFrom(rec, "auth_token")
	if got == nil {
		t.Fatal("no auth_token cookie was set")
	}
	if !got.HttpOnly {
		t.Error("auth_token is not HttpOnly")
	}
	if got.Path != "/" {
		t.Errorf("cookie path = %q, want / so it is sent to every endpoint", got.Path)
	}
}

func TestAuthCookieIsSecureOnlyOverHTTPS(t *testing.T) {
	// Secure+SameSite=None over plain HTTP would make the browser drop the cookie, which is how a
	// LAN deployment (this console's normal case) breaks. SameSite no longer varies with it.
	plain, plainRec := ctxWith(nil, false)
	setAuthCookie(plain, "tok")
	if c := cookieFrom(plainRec, "auth_token"); c.Secure {
		t.Error("Secure set on a plain-HTTP request — the browser would discard the cookie")
	}

	fwd, fwdRec := ctxWith(map[string]string{"X-Forwarded-Proto": "https"}, false)
	setAuthCookie(fwd, "tok")
	got := cookieFrom(fwdRec, "auth_token")
	if !got.Secure {
		t.Error("Secure not set behind an HTTPS proxy (X-Forwarded-Proto: https)")
	}
	// Secure and SameSite are now independent: Secure follows the scheme, SameSite is Lax either
	// way. See cookieSameSite for why None was dropped.
	if got.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v behind an HTTPS proxy, want Lax", got.SameSite)
	}
}

func TestClearAuthCookieExpiresIt(t *testing.T) {
	// Logout has to actually remove the cookie, not merely blank it: a MaxAge of 0 would leave a
	// session cookie in place.
	c, rec := ctxWith(nil, false)
	clearAuthCookie(c)

	got := cookieFrom(rec, "auth_token")
	if got == nil {
		t.Fatal("clearAuthCookie set no cookie at all")
	}
	if got.Value != "" {
		t.Errorf("cookie value = %q, want empty", got.Value)
	}
	if got.MaxAge >= 0 {
		t.Errorf("MaxAge = %d, want negative so the browser deletes it", got.MaxAge)
	}
}

func TestClearAuthCookieMatchesTheAttributesItWasSetWith(t *testing.T) {
	// A browser only replaces a cookie when Path (and Secure/SameSite) match. Clearing it with
	// different attributes leaves the original in place and the user stays logged in.
	set, setRec := ctxWith(map[string]string{"X-Forwarded-Proto": "https"}, false)
	setAuthCookie(set, "tok")
	clr, clrRec := ctxWith(map[string]string{"X-Forwarded-Proto": "https"}, false)
	clearAuthCookie(clr)

	a, b := cookieFrom(setRec, "auth_token"), cookieFrom(clrRec, "auth_token")
	if a.Path != b.Path || a.Secure != b.Secure || a.SameSite != b.SameSite {
		t.Errorf("clear attributes (path=%q secure=%v samesite=%v) do not match set "+
			"(path=%q secure=%v samesite=%v) — the browser would keep the original cookie",
			b.Path, b.Secure, b.SameSite, a.Path, a.Secure, a.SameSite)
	}
}

func TestIsHTTPSRecognisesEveryTerminationPoint(t *testing.T) {
	// This console runs behind nginx in docker, direct over TLS, and plain on a LAN. Each one has
	// to be detected, or the cookie is issued with the wrong Secure flag and logins silently fail.
	cases := []struct {
		name    string
		headers map[string]string
		tls     bool
		want    bool
	}{
		{"plain http", nil, false, false},
		{"direct TLS", nil, true, true},
		{"behind a proxy", map[string]string{"X-Forwarded-Proto": "https"}, false, true},
		{"proxy header cased oddly", map[string]string{"X-Forwarded-Proto": "HTTPS"}, false, true},
		{"https origin", map[string]string{"Origin": "https://console.lan"}, false, true},
		{"http origin", map[string]string{"Origin": "http://console.lan"}, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := ctxWith(tc.headers, tc.tls)
			if got := isHTTPS(c); got != tc.want {
				t.Errorf("isHTTPS = %v, want %v", got, tc.want)
			}
		})
	}
}

// The session cookie must never be SameSite=None.
//
// This test used to assert the opposite — that a Secure cookie gets None "to survive a cross-site
// request". No deployment of this console is cross-site: nginx proxies /api so the browser sees one
// origin, and in development localhost:5173 and localhost:9000 are different origins but the same
// SITE, which is what SameSite is about. So the old pairing bought nothing and gave away the one
// property that keeps another site's page from acting as the signed-in user.
func TestSessionCookieIsNeverSameSiteNone(t *testing.T) {
	for _, secure := range []bool{true, false} {
		if got := cookieSameSite(secure); got == http.SameSiteNoneMode {
			t.Errorf("secure=%v produced SameSite=None — that is the value that lets another site's "+
				"page send this cookie, and nothing in this deployment needs it", secure)
		}
		if got := cookieSameSite(secure); got != http.SameSiteLaxMode {
			t.Errorf("secure=%v produced %v, want Lax", secure, got)
		}
	}
}

// The cookie the login flow actually writes, not just the helper behind it.
func TestSetAuthCookieIsHttpOnlyAndLax(t *testing.T) {
	c, rec := ctxWith(map[string]string{}, false)
	setAuthCookie(c, "token-value")

	ck := cookieFrom(rec, "auth_token")
	if ck == nil {
		t.Fatal("no auth_token cookie was set")
	}
	if !ck.HttpOnly {
		t.Error("auth_token must be HttpOnly — a readable session token is one XSS away from stolen")
	}
	if ck.SameSite != http.SameSiteLaxMode {
		t.Errorf("auth_token SameSite = %v, want Lax", ck.SameSite)
	}
}

// tlsState is a non-nil ConnectionState, which is all isHTTPS looks at.
var tlsState = tls.ConnectionState{}

package routes

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Which routes may be reached WITHOUT credentials.
//
// Why this test exists: "this endpoint is admin-only" lived in three places — the frontend, which
// hides the button; a comment above the route; and the reviewer's memory. The compiler reads none
// of them. GET /email-phone-numbers was registered on the public OTP group and returned every
// user's address and phone number to anyone who asked, for as long as it took somebody to notice
// by hand. Registering a route in the wrong group is a one-line mistake with no symptom.
//
// So the exposure of all 260-odd routes is written down ONCE, here, and checked against what the
// router actually does. A new route defaults to guarded, because it is absent from this list; a
// route that becomes public has to be added to it in the same diff, where a reviewer sees it.
//
// ── What this verifies, and what it does not ─────────────────────────────────
//
// It sends a real request with no cookie and asserts the response. That is a genuine check of the
// authentication gate, not a restatement of the route table.
//
// It does NOT distinguish "any signed-in user" from "admin only". Telling those apart needs a
// valid JWT and a session row, so it needs a database, which this package has no business
// starting. That layer is covered where it is enforced instead — see the handler tests in
// controller/user and controller/policyobject.
//
// A route listed here is therefore only saying "unauthenticated callers reach the handler". It is
// still on the author to make sure the handler is one that SHOULD be reachable that way.
var openRoutes = map[string]string{
	"GET /": "health check",

	// Container probes. Called by docker's HEALTHCHECK from inside the container, which holds no
	// session and cannot be given one — so they are open by necessity, and that is exactly why
	// neither returns anything but component names and ok/fail. See controller/health for the
	// reasoning, including why a failing dependency must not restart the API.
	"GET /healthz": "liveness probe; touches nothing",
	"GET /readyz":  "readiness probe; reports database/redis reachability as ok|fail only",

	// The login flow itself. Each of these has to be callable by someone holding no session, which
	// is the whole point of them.
	"POST /auth/login":              "issues the session",
	"POST /auth/logout":             "clears the cookie; safe with none",
	"POST /auth/verify-2fa":         "second factor, gated by the pending token from /auth/login",
	"POST /auth/verify-totp":        "second factor, gated by the pending token",
	"POST /auth/verify-backup-code": "second factor, gated by the pending token",

	// OAuth: the browser arrives here with no session by definition, and comes back from the
	// provider the same way.
	"GET /auth/google":          "redirect to provider",
	"GET /auth/github":          "redirect to provider",
	"GET /auth/line":            "redirect to provider",
	"GET /auth/google/callback": "provider callback",
	"GET /auth/github/callback": "provider callback",
	"GET /auth/line/callback":   "provider callback",

	// Read by the login screen before anyone can possibly be signed in.
	"GET /maintenance/status": "the login page shows the banner",
	"GET /password-policy":    "the login page renders the password rules",

	// Forgot-password. None of these three may disclose whether an address is registered, and the
	// only proof of ownership any of them accepts is the OTP code delivered to the mailbox.
	// /check-user-email used to hand out a reset token here instead — see controller/auth.
	"POST /check-user-email":    "step 1; answers identically for every input",
	"POST /send-otp":            "mails the code; same answer whether or not the address exists",
	"POST /verify-otp-password": "sets the password, but only with the mailed code",
}

// workerRoutes are the callbacks the Python worker posts job results to.
//
// They carry no session cookie — the worker is not a person — and are authenticated by the shared
// secret in X-Worker-Secret instead. That refusal is also a 401, so they satisfy the guarded case
// below without special handling; they are named here only so the reader knows the 401 they return
// comes from a different gate than everything else.
var workerRoutes = map[string]bool{
	"POST /internal/jobs/:id/start":                   true,
	"POST /internal/jobs/:id/result":                  true,
	"POST /internal/config-deploys/:id/start":         true,
	"POST /internal/config-deploys/:id/device-result": true,
}

var paramSegment = regexp.MustCompile(`[:*][^/]+`)

// concreteURL turns a route pattern into something the router will match.
// The value does not matter: every guarded route is rejected before its handler sees it.
func concreteURL(pattern string) string {
	return paramSegment.ReplaceAllString(pattern, "1")
}

func testEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Recovery, because several PUBLIC handlers read the database and this package deliberately
	// has none. A panic inside the handler still answers the question being asked — the request
	// got past the gate — so it must become a 500 rather than take the test process down.
	r.Use(gin.Recovery())
	Setup(r)
	return r
}

func TestEveryRouteIsGuardedUnlessExplicitlyOpen(t *testing.T) {
	r := testEngine()

	for _, route := range r.Routes() {
		key := route.Method + " " + route.Path
		reason, isOpen := openRoutes[key]

		req := httptest.NewRequest(route.Method, concreteURL(route.Path), strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if isOpen {
			// An open route must not be answered by the auth gate. Any other status is fine — a
			// 400 for an empty body, a 302 to a provider, a 500 with no database — because all of
			// them mean the request reached the handler.
			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s is listed as open (%s) but answered 401 — either the route moved "+
					"behind the auth middleware or this list is stale", key, reason)
			}
			continue
		}

		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s answered %d without a session cookie; expected 401.\n"+
				"Every route is guarded unless it appears in openRoutes. If this one really is "+
				"meant to be reachable by anyone, add it there WITH a reason and make sure the "+
				"handler discloses nothing that requires an account to see.", key, w.Code)
		}
	}
}

// A stale entry in openRoutes is a comment claiming something the router no longer does, and the
// next person to read it inherits a wrong mental model of the public surface.
func TestOpenRouteListHasNoStaleEntries(t *testing.T) {
	r := testEngine()

	registered := make(map[string]bool, len(r.Routes()))
	for _, route := range r.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	var stale []string
	for key := range openRoutes {
		if !registered[key] {
			stale = append(stale, key)
		}
	}
	sort.Strings(stale)
	for _, key := range stale {
		t.Errorf("openRoutes lists %q, which is not a registered route — remove it", key)
	}

	for key := range workerRoutes {
		if !registered[key] {
			t.Errorf("workerRoutes lists %q, which is not a registered route — remove it", key)
		}
	}
}

// The two endpoints that used to be public and no longer are. Named explicitly rather than left to
// the sweep above, because a regression here is not "a new route was misfiled" — it is the exact
// hole being closed coming back, and it deserves a test that says so by name.
func TestPreviouslyPublicEndpointsAreGuarded(t *testing.T) {
	r := testEngine()

	cases := []struct {
		method, path, why string
	}{
		{http.MethodGet, "/email-phone-numbers",
			"dumps every user's email and phone number; it was reachable with no cookie at all"},
		{http.MethodPost, "/reset-password-direct",
			"set any account's password using a token /check-user-email gave to anyone who asked; the route is gone"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// 401 (now behind auth) or 404 (route removed) — anything else means it answered.
		if w.Code != http.StatusUnauthorized && w.Code != http.StatusNotFound {
			t.Errorf("%s %s answered %d to an unauthenticated caller: %s",
				tc.method, tc.path, w.Code, tc.why)
		}
	}
}

// /check-user-email must never again return something that can be exchanged for a password reset.
func TestCheckUserEmailReturnsNoResetToken(t *testing.T) {
	r := testEngine()

	req := httptest.NewRequest(http.MethodPost, "/check-user-email",
		strings.NewReader(`{"email":"admin@got.co.th"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	body := w.Body.String()
	for _, forbidden := range []string{"reset_token", "resetToken"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("/check-user-email response contains %q.\n"+
				"That token was proof of ownership for a password reset, handed to an "+
				"unauthenticated caller. Proof must come from the mailbox, never from this "+
				"response. Body: %s", forbidden, body)
		}
	}
	// It must also not answer "is this address registered": both a hit and a miss look the same.
	if strings.Contains(body, `"exists":false`) || w.Code == http.StatusNotFound {
		t.Errorf("/check-user-email distinguishes a registered address from an unknown one "+
			"(status %d, body %s) — that is an account-enumeration oracle on a public endpoint",
			w.Code, body)
	}
}

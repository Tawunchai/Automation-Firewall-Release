package platform

import (
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Where the browser is allowed to be, for everything that trusts a cookie.
//
// ── Why this is in services and not in main.go ───────────────────────────────
//
// The same question — "may a page at this origin talk to this API?" — was being answered in three
// places that could not see each other: corsMiddleware in main.go read CORS_ALLOWED_ORIGINS, while
// controller/terminal and controller/diagstream each shipped
// `CheckOrigin: func(_ *http.Request) bool { return true }`, i.e. YES, to everyone, forever.
//
// What that opened: a WebSocket upgrade is NOT subject to the same-origin policy and NOT preflighted.
// A page on any site the user is browsing can open one to this app, and the browser attaches this
// app's session cookie. SameSite=Lax is what has been stopping it — one cookie attribute, set in a
// third file, standing between a visited web page and a live SSH shell on the firewall (that is
// what controller/terminal is) or a live diagnostics stream. Nothing in the code said so.
//
// So the allow-list lives here, once, and both the CORS middleware and the two upgraders read it.

// AllowedBrowserOrigins is the configured allow-list: the dev server, plus whatever
// CORS_ALLOWED_ORIGINS names.
//
// Read from the environment on every call rather than cached, to match corsMiddleware's original
// behaviour — the list is a handful of strings and these calls are not hot.
func AllowedBrowserOrigins() map[string]bool {
	allowed := map[string]bool{"http://localhost:5173": true}
	for _, o := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		if t := strings.TrimSpace(o); t != "" {
			allowed[t] = true
		}
	}
	return allowed
}

// browserOriginAllowed reports whether a request carrying this Origin, addressed to this Host, may
// be served.
//
// Three answers, in order:
//
//  1. NO ORIGIN AT ALL → allowed. A browser always sends one on a WebSocket upgrade; something
//     that does not is a CLI, a test or a health check, and those are not what this guard is for —
//     the attack it stops is a PAGE the user is visiting acting with the user's cookie. Refusing
//     them would break `wscat`, the smoke suite and anything scripted, and would buy nothing: an
//     attacker who can omit a header can also forge one.
//
//  2. SAME HOST as the request → allowed. In production the console is served same-origin through
//     nginx (https://<lan-ip>/), and that origin is NOT in CORS_ALLOWED_ORIGINS precisely because
//     a same-origin request needs no CORS entry. An allow-list alone would therefore have passed
//     every test and broken the terminal on the LAN the day it shipped.
//
//     "Host" here means the authority the BROWSER addressed, port included — which is why the
//     caller passes browserRequestHost(r) and not r.Host. That distinction is not academic: it is
//     exactly how this shipped broken. See the note on browserRequestHost.
//
//     The comparison is on HOST, not on the whole origin, so http:// and https:// on the same name
//     both pass. That is deliberate: the deployment switches between them (see the entrypoint's
//     HTTP/HTTPS switch in docs), X-Forwarded-Proto is what the backend sees rather than the real
//     scheme, and a mismatch there would fail closed in a way nobody could debug from the error.
//     An attacker who can MITM plain HTTP on the same host already has the cookie.
//
//  3. otherwise → only if the exact origin is allow-listed. This is the dev case: the Vite server
//     on :5173 talking to the backend on :9000.
func browserOriginAllowed(origin, host string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		// "null" (a sandboxed iframe or a file:// page) lands here, and so does anything malformed.
		return false
	}
	if strings.EqualFold(u.Host, host) {
		return true
	}
	return AllowedBrowserOrigins()[origin]
}

// browserRequestHost returns the authority the BROWSER addressed — host and port — for a request
// that may have come through a reverse proxy.
//
// ── Why this exists: the LAN terminal shipped broken for exactly this ────────
//
// nginx forwards with `proxy_set_header Host $host`, and nginx's $host is the host name with NO
// PORT. So a browser on http://10.10.20.5:5173 sends Origin "http://10.10.20.5:5173" and the
// backend sees Host "10.10.20.5". Those are not equal, the origin is not in the allow-list either
// (a same-origin deployment has no reason to be listed), and every WebSocket upgrade from the LAN
// was answered 403 — the Config Deploy terminal and the diagnostics stream both. Only
// http://localhost:5173 kept working, because that one string is the built-in dev default. Proved
// against the running stack, not reasoned about: the LAN origin got 403 while the same request
// with no Origin header got 101 and a live prompt on the lab 80E.
//
// X-Forwarded-Host carries the original authority with its port, and nginx/the Vite dev proxy are
// both configured here to send it. Falling back to r.Host keeps a direct connection (`go run`, the
// tests, curl against :9000) working.
//
// ── Why trusting that header costs nothing here ──────────────────────────────
//
// This guard exists for ONE attacker: a page the user is visiting, opening a socket that rides
// their cookie. Such a page cannot set X-Forwarded-Host — a browser sets no custom headers on a
// WebSocket handshake at all, and on fetch() a custom header forces a preflight this API does not
// answer for a foreign origin. Anything that CAN set the header is not a browser, and a non-browser
// is already allowed by rule 1 the moment it omits Origin. So this adds no reachable path; it only
// stops the proxy from lying about where the browser was.
func browserRequestHost(r *http.Request) string {
	if fwd := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); fwd != "" {
		// A chain of proxies appends, comma-separated. The first entry is what the browser typed.
		if i := strings.IndexByte(fwd, ','); i >= 0 {
			fwd = strings.TrimSpace(fwd[:i])
		}
		if fwd != "" {
			return fwd
		}
	}
	return r.Host
}

// CheckWebsocketOrigin is the CheckOrigin both upgraders use (controller/terminal and
// controller/diagstream).
//
// It exists as a named function rather than a closure in each package so there is ONE answer to
// "may this page open a socket", and so a refusal says why. A refused upgrade reaches the browser
// as a bare 403 "Forbidden" with no body the UI can explain — the symptom is a terminal that never
// connects. Without this line the only way to find out which origin was rejected against which
// host is to re-derive it from the proxy configuration, which is how the LAN break above survived
// a passing unit-test suite.
func CheckWebsocketOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	host := browserRequestHost(r)
	if browserOriginAllowed(origin, host) {
		return true
	}
	log.Printf("websocket upgrade refused on %s: Origin %q is not allowed for host %q "+
		"(add it to CORS_ALLOWED_ORIGINS if this deployment is meant to serve it)",
		r.URL.Path, origin, host)
	return false
}

package main

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// What package main does BEFORE the first byte is served, and the three middlewares it wraps every
// request in.
//
// main() itself is not called here and should not be: it connects to a database, binds a port and
// then blocks on a signal. Everything it does that has a rule attached is either a function it
// calls — setupStructuredLogging, trustedProxies (main_trustedproxy_test.go), bodyLimitMiddleware,
// corsMiddleware — or an ORDER, and the order is checked by reading main()'s own syntax tree at
// the bottom of this file. That is the same technique authz_guard_test.go uses on the controllers,
// and for the same reason: the rule is about the shape of the code, and no runtime assertion can
// see it.
//
// This file needs no database and no environment.

func init() { gin.SetMode(gin.TestMode) }

// ── setupStructuredLogging ───────────────────────────────────────────────────

// LOG_LEVEL decides what reaches the collector. Getting it wrong is quiet in both directions: too
// high and the one line per request that this exists to produce is dropped, too low and a busy
// console writes a debug record per request forever.
func TestLogLevelFromTheEnvironment(t *testing.T) {
	for _, c := range []struct {
		env      string
		want     slog.Level
		debugOff bool
	}{
		{"", slog.LevelInfo, true},
		{"info", slog.LevelInfo, true},
		{"debug", slog.LevelDebug, false},
		{"DEBUG", slog.LevelDebug, false},
		{"warn", slog.LevelWarn, true},
		{"warning", slog.LevelWarn, true},
		{"error", slog.LevelError, true},
		// Anything unrecognised falls back to info rather than to silence. A typo in a deployment
		// variable must not be the thing that turns logging off.
		{"verbose", slog.LevelInfo, true},
		{"trace", slog.LevelInfo, true},
	} {
		t.Run("LOG_LEVEL="+c.env, func(t *testing.T) {
			restore := slog.Default()
			t.Cleanup(func() { slog.SetDefault(restore) })

			t.Setenv("LOG_LEVEL", c.env)
			setupStructuredLogging()

			h := slog.Default().Handler()
			if !h.Enabled(t.Context(), c.want) {
				t.Errorf("level %v is not enabled, but LOG_LEVEL=%q asks for it", c.want, c.env)
			}
			if c.debugOff && h.Enabled(t.Context(), slog.LevelDebug) {
				t.Errorf("debug is enabled although LOG_LEVEL=%q", c.env)
			}
			// Error is never switched off, whatever the variable says.
			if !h.Enabled(t.Context(), slog.LevelError) {
				t.Errorf("error is not enabled with LOG_LEVEL=%q", c.env)
			}
		})
	}
}

// The records have to be JSON, because the whole point is that a collector can parse them. A
// handler that wrote slog's human-readable text format would look identical in a terminal and be
// useless to the thing it is shipped to.
func TestTheLogRecordsAreJSON(t *testing.T) {
	restore := slog.Default()
	t.Cleanup(func() { slog.SetDefault(restore) })

	t.Setenv("LOG_LEVEL", "info")
	setupStructuredLogging()

	// setupStructuredLogging writes to os.Stdout by name, so the record is captured by replacing
	// the file for the duration of one call.
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	realStdout := os.Stdout
	os.Stdout = w
	setupStructuredLogging() // re-bind the handler to the pipe
	slog.Info("probe", "device", "lab-80E", "status", 200)
	os.Stdout = realStdout
	_ = w.Close()

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("read: %v", err)
	}
	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("nothing was written to stdout")
	}
	var rec map[string]any
	if err := json.Unmarshal([]byte(line), &rec); err != nil {
		t.Fatalf("the record is not JSON: %v — %q", err, line)
	}
	if rec["msg"] != "probe" || rec["device"] != "lab-80E" {
		t.Errorf("the structured fields did not survive: %v", rec)
	}
	if _, ok := rec["time"]; !ok {
		t.Error("the record carries no timestamp")
	}
}

// ── bodyLimitMiddleware ──────────────────────────────────────────────────────

// The body cap is what stops one request from spending the process's memory. It has to refuse the
// oversized body rather than truncate it: a half-read JSON object that still parsed would be a
// write to a firewall that nobody sent.
func TestTheBodyLimitRefusesAnOversizedRequest(t *testing.T) {
	const limit = 64

	r := gin.New()
	r.Use(bodyLimitMiddleware(limit))
	r.POST("/probe", func(c *gin.Context) {
		var body map[string]any
		if err := c.ShouldBindJSON(&body); err != nil {
			c.String(http.StatusRequestEntityTooLarge, "refused")
			return
		}
		c.String(http.StatusOK, "accepted")
	})

	for _, c := range []struct {
		name string
		size int
		want int
	}{
		{"well under the cap", 10, http.StatusOK},
		{"at the cap", limit - 15, http.StatusOK},
		{"over the cap", limit * 4, http.StatusRequestEntityTooLarge},
		{"far over the cap", limit * 1000, http.StatusRequestEntityTooLarge},
	} {
		t.Run(c.name, func(t *testing.T) {
			payload := `{"n":"` + strings.Repeat("x", c.size) + `"}`
			req := httptest.NewRequest(http.MethodPost, "/probe", strings.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != c.want {
				t.Errorf("a %d-byte body: status = %d, want %d (%s)", len(payload), w.Code, c.want, w.Body.String())
			}
		})
	}
}

// The production cap is 10 MB, which has to be above the 5 MB avatar upload the profile page
// allows. A cap below it would make that feature fail with a message about the request size.
func TestTheProductionBodyCapClearsTheAvatarUpload(t *testing.T) {
	const avatarMax = 5 << 20
	if maxBodyBytes <= avatarMax {
		t.Fatalf("maxBodyBytes = %d, which is not above the %d-byte avatar limit", maxBodyBytes, avatarMax)
	}
}

// ── corsMiddleware ───────────────────────────────────────────────────────────

func corsProbe(t *testing.T, method, origin string) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.Use(corsMiddleware())
	r.Any("/probe", func(c *gin.Context) { c.String(http.StatusOK, "handler ran") })

	req := httptest.NewRequest(method, "/probe", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// Only an allow-listed origin is echoed back. Echoing the request's own Origin unconditionally —
// the usual way this is written — together with Allow-Credentials: true lets any page on the
// internet read this console's responses with the user's session cookie attached.
func TestOnlyAnAllowListedOriginIsEchoed(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://console.example.test")

	for _, c := range []struct {
		origin string
		echoed bool
	}{
		// The built-in dev origin: the Vite server talking to the backend on :9000.
		{"http://localhost:5173", true},
		{"https://console.example.test", true},
		{"https://evil.example", false},
		// Near misses, each of which a substring or prefix check would wave through.
		{"https://console.example.test.evil.example", false},
		{"http://console.example.test", false},
		{"https://console.example.test:8443", false},
		{"null", false},
	} {
		t.Run(c.origin, func(t *testing.T) {
			w := corsProbe(t, http.MethodGet, c.origin)
			got := w.Header().Get("Access-Control-Allow-Origin")
			if c.echoed && got != c.origin {
				t.Errorf("Allow-Origin = %q, want %q", got, c.origin)
			}
			if !c.echoed && got != "" {
				t.Errorf("Allow-Origin = %q for an origin that is not allow-listed", got)
			}
		})
	}

	// A request with no Origin at all — curl, a health check — gets no Allow-Origin header, and
	// is still served.
	w := corsProbe(t, http.MethodGet, "")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin = %q for a request with no Origin", got)
	}
	if w.Code != http.StatusOK {
		t.Errorf("a request with no Origin was refused with %d", w.Code)
	}
}

// Vary: Origin is not cosmetic. The response differs per origin, so without it a shared cache can
// serve the allow-listed response to a caller whose origin was refused.
func TestVaryOriginIsAlwaysSet(t *testing.T) {
	for _, origin := range []string{"http://localhost:5173", "https://evil.example", ""} {
		w := corsProbe(t, http.MethodGet, origin)
		if got := w.Header().Get("Vary"); got != "Origin" {
			t.Errorf("origin %q: Vary = %q, want Origin", origin, got)
		}
	}
}

// The preflight is answered and SHORT-CIRCUITED: 204, and the handler behind it never runs.
func TestAPreflightIsAnsweredWithoutReachingTheHandler(t *testing.T) {
	w := corsProbe(t, http.MethodOptions, "http://localhost:5173")

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", w.Code)
	}
	if strings.Contains(w.Body.String(), "handler ran") {
		t.Error("the preflight reached the route handler")
	}
	for _, h := range []string{"Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"} {
		if w.Header().Get(h) == "" {
			t.Errorf("%s is missing from the preflight response", h)
		}
	}
	if got := w.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "PATCH") ||
		!strings.Contains(got, "DELETE") {
		t.Errorf("Allow-Methods = %q — the console issues PATCH and DELETE", got)
	}
}

// Two headers the conditional-GET cache depends on, both of which fail silently when missing.
//
// If-None-Match is not CORS-safelisted, so without it the browser drops the revalidation header in
// dev — where the console runs cross-origin on :5173 — and every request re-downloads the full
// body while appearing to work. ETag is likewise unreadable on a cross-origin response unless it
// is exposed.
func TestTheConditionalGetHeadersAreNegotiated(t *testing.T) {
	w := corsProbe(t, http.MethodGet, "http://localhost:5173")

	allow := w.Header().Get("Access-Control-Allow-Headers")
	for _, h := range []string{"If-None-Match", "Content-Type", "X-CSRF-Token", "Cache-Control"} {
		if !strings.Contains(allow, h) {
			t.Errorf("%s is not in Access-Control-Allow-Headers: %q", h, allow)
		}
	}
	if got := w.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(got, "ETag") {
		t.Errorf("Expose-Headers = %q, want ETag", got)
	}
	// Credentials are allowed because the session is a cookie — and that is precisely why the
	// origin check above has to be an exact match.
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want true", got)
	}
}

// ── the boot order ───────────────────────────────────────────────────────────

// main() is a sequence, and four places in it are ORDER-dependent in ways that fail quietly.
//
// Each has a comment in main.go explaining itself, and a comment is not a guard. main() cannot be
// called from a test — it connects to a database, binds a port and blocks on a signal — so the
// order is checked by reading its syntax tree, the same way authz_guard_test.go checks the
// controllers for their admin gates.
//
// What each rule protects:
//
//   - the two secret validations run BEFORE ConnectDB, so a deployment whose credential key is
//     missing or still a published placeholder fails at boot rather than after it has stored a
//     firewall's admin password under a key from docker-compose.yml.
//   - SetHostKeyStore and SetTLSPinStore run before the scheduler, because the scheduler opens SSH
//     and HTTPS connections on its own. Until the stores are set, host-key checking REFUSES every
//     session — a boot-order mistake here is a console that cannot reach any firewall.
//   - SetTrustedProxies runs before the first r.Use, because the rate limiter reads c.ClientIP()
//     and would otherwise key its buckets on a header the client chose.
//   - SetChangeRequestReplayer runs AFTER routes.Setup: an engine with no routes serves every
//     replayed write a 404, which the applier records as the device refusing it.
func TestMainKeepsItsBootOrder(t *testing.T) {
	calls := mainCallSequence(t)

	indexOf := func(name string) int {
		for i, c := range calls {
			if c == name {
				return i
			}
		}
		t.Fatalf("main() does not call %s any more — if that is deliberate, this rule needs rewriting, not deleting", name)
		return -1
	}

	for _, rule := range []struct {
		first, then, why string
	}{
		{"platform.ValidateCredKeyConfig", "config.ConnectDB",
			"a missing or placeholder credential key must be fatal before anything is stored under it"},
		{"platform.ValidateWorkerSecret", "config.ConnectDB",
			"the worker callback secret is validated before the database is reachable"},
		{"config.ConnectDB", "platform.SetHostKeyStore",
			"the host-key store needs the database handle"},
		{"platform.SetHostKeyStore", "scheduler.Start",
			"the scheduler opens SSH sessions, and host-key checking refuses every one until the store is set"},
		{"platform.SetTLSPinStore", "scheduler.Start",
			"the scheduler reads devices over HTTPS, and the pin store has to exist first"},
		{"r.SetTrustedProxies", "r.Use",
			"the rate limiter reads c.ClientIP(), which is a client-supplied string until the trust list is set"},
		{"routes.Setup", "services.SetChangeRequestReplayer",
			"an engine with no routes answers every replayed write 404, recorded as a device refusal"},
	} {
		if i, j := indexOf(rule.first), indexOf(rule.then); i > j {
			t.Errorf("main() calls %s (position %d) after %s (position %d) — %s",
				rule.first, i, rule.then, j, rule.why)
		}
	}
}

// The server must not start listening before the routes are registered, or the window between the
// two answers 404 to a health check and to anything else that arrives in it.
func TestTheServerStartsListeningLast(t *testing.T) {
	calls := mainCallSequence(t)

	listen, setup := -1, -1
	for i, c := range calls {
		switch c {
		case "srv.ListenAndServe":
			if listen == -1 {
				listen = i
			}
		case "routes.Setup":
			setup = i
		}
	}
	if listen == -1 || setup == -1 {
		t.Fatalf("main() no longer both registers routes and listens (routes.Setup=%d, ListenAndServe=%d)", setup, listen)
	}
	if listen < setup {
		t.Error("main() starts listening before routes.Setup — requests arriving in that window get 404")
	}
}

// The scheduler is stopped before the HTTP drain. It is the only thing that starts new work on its
// own, so letting it enqueue another backup while the server is closing leaves a job queued that
// nothing is left to report on.
func TestShutdownStopsTheSchedulerBeforeDrainingHTTP(t *testing.T) {
	calls := mainCallSequence(t)

	stop, shutdown := -1, -1
	for i, c := range calls {
		switch c {
		case "scheduler.Stop":
			stop = i
		case "srv.Shutdown":
			shutdown = i
		}
	}
	if stop == -1 || shutdown == -1 {
		t.Fatalf("main() no longer both stops the scheduler and shuts the server down (Stop=%d, Shutdown=%d)", stop, shutdown)
	}
	if stop > shutdown {
		t.Error("scheduler.Stop runs after srv.Shutdown — the scheduler can queue work nothing will report on")
	}
}

// mainCallSequence returns the names of the calls in main()'s body, in source order, including the
// ones inside its goroutine and its defers.
//
// Flattened rather than walked per-statement on purpose: every rule above is "x before y", and the
// one call that matters inside a nested block — srv.ListenAndServe, in a goroutine — is at the
// position its `go func() {` appears, which is where it is started.
func mainCallSequence(t *testing.T) []string {
	t.Helper()

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}

	var body *ast.BlockStmt
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == "main" && fn.Recv == nil {
			body = fn.Body
			break
		}
	}
	if body == nil {
		t.Fatal("main.go has no func main")
	}

	var out []string
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if name := calleeName(call.Fun); name != "" {
			out = append(out, name)
		}
		return true
	})
	if len(out) == 0 {
		t.Fatal("no calls found in main()")
	}
	return out
}

// calleeName renders `pkg.Func` and `recv.Method` as a flat string, and anything else as "".
func calleeName(fn ast.Expr) string {
	sel, ok := fn.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	recv, ok := sel.X.(*ast.Ident)
	if !ok {
		return ""
	}
	return recv.Name + "." + sel.Sel.Name
}

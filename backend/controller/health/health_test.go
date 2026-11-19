package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// These two endpoints are unauthenticated — docker's HEALTHCHECK runs inside the container and
// holds no session — which puts a hard limit on what they may say. Anyone who can reach the port
// can read them, so the body has to be component names and ok/fail and nothing else: no hostname,
// no DSN, no driver error, no version.
//
// The other property worth pinning is the split itself. Liveness must not consult the database:
// a probe that does turns "Postgres is unwell" into "restart the API", which is the one reaction
// guaranteed not to help and which produces a crash loop during a database blip.

func newCtx() (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	return c, rec
}

func TestLiveIsAlwaysOKAndTouchesNothing(t *testing.T) {
	// No database and no Redis are configured in this binary. Liveness answering 200 here IS the
	// assertion: a version that consulted either would panic instead.
	c, rec := newCtx()
	Live(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("liveness answered %d with no dependencies configured, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("liveness body is not JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status = %v, want ok", body["status"])
	}
	if len(body) != 1 {
		t.Errorf("liveness returned %d fields (%v) — it should say one thing", len(body), body)
	}
}

func TestReadyReports503WhenADependencyIsUnreachable(t *testing.T) {
	// config.DB() is nil here and Redis is not running, so this exercises the degraded path.
	c, rec := newCtx()
	Ready(c)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness answered %d with no database, want 503 — the status code has to be "+
			"actionable on its own, so a load balancer need not parse the body", rec.Code)
	}

	var body struct {
		Status string            `json:"status"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("readiness body is not JSON: %v", err)
	}
	if body.Status != "degraded" {
		t.Errorf("status = %q, want degraded", body.Status)
	}
	if body.Checks["database"] != "fail" {
		t.Errorf("database check = %q, want fail", body.Checks["database"])
	}
	if _, named := body.Checks["redis"]; !named {
		t.Error("the redis check is missing — a probe that silently drops a component reports " +
			"healthy for the wrong reason")
	}
}

// The constraint that comes with being unauthenticated.
func TestReadyLeaksNothingBeyondOKAndFail(t *testing.T) {
	c, rec := newCtx()
	Ready(c)

	body := rec.Body.String()
	for _, secret := range []string{
		"postgres", "password", "sslmode", "host=", "5432", "6379",
		"dial tcp", "connection refused", "redis://", "DATABASE_URL",
	} {
		if strings.Contains(strings.ToLower(body), strings.ToLower(secret)) {
			t.Errorf("the readiness body contains %q — this endpoint needs no session, so anything "+
				"in it is readable by anyone who can reach the port:\n%s", secret, body)
		}
	}

	// And every check value is one of exactly two words.
	var parsed struct {
		Checks map[string]string `json:"checks"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	for name, v := range parsed.Checks {
		if v != "ok" && v != "fail" {
			t.Errorf("check %q = %q; only ok/fail may appear, or the error text becomes the leak", name, v)
		}
	}
}

func TestPingHelpersReportFailRatherThanPanic(t *testing.T) {
	// Both are called from a request handler, so a panic would be a 500 on the endpoint whose job
	// is to report trouble calmly.
	ctx := t.Context()
	if got := pingDatabase(ctx); got != "fail" {
		t.Errorf("pingDatabase with no connection = %q, want fail", got)
	}
	if got := pingRedis(ctx); got != "fail" {
		t.Errorf("pingRedis with no server = %q, want fail", got)
	}
}

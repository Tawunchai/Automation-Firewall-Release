package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// AppMetrics is admin-only — unlike Live/Ready above it is a page a person opens, not a probe an
// orchestrator calls with no session, so it is allowed to require one.

func newMetricsCtx(role string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/admin/system-metrics", nil)
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

func TestAppMetrics_RefusesANonAdmin(t *testing.T) {
	c, rec := newMetricsCtx("user")
	AppMetrics(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin caller", rec.Code)
	}
}

func TestAppMetrics_RefusesNoRoleAtAll(t *testing.T) {
	c, rec := newMetricsCtx("")
	AppMetrics(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when no role was set on the context", rec.Code)
	}
}

func TestAppMetrics_ServesTheSnapshotToAnAdmin(t *testing.T) {
	c, rec := newMetricsCtx("admin")
	AppMetrics(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for an admin caller", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	for _, field := range []string{
		"uptime_seconds", "total_requests", "status_2xx", "status_4xx", "status_5xx",
		"avg_latency_ms", "error_rate_percent", "open_forti_sessions",
	} {
		if _, ok := body[field]; !ok {
			t.Errorf("response is missing %q: %v", field, body)
		}
	}
}

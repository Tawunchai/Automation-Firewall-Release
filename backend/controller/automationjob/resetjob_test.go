package automationjob

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// ResetJob force-fails a stuck job — admin only. The role check runs before any database read, so
// this is testable without one; see the note at the top of services/changerequest_test.go for why
// this codebase pins rules this way wherever the check allows it.

func TestResetJob_RefusesANonAdmin(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPatch, "/jobs/1/reset", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "user")

	ResetJob(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin", rec.Code)
	}
}

func TestResetJob_RefusesAnOperator(t *testing.T) {
	// Operator (Phase A4) may write device config, but resetting another person's queued job is an
	// app-administration action, not a device write — it must stay admin-only.
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPatch, "/jobs/1/reset", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "operator")

	ResetJob(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator", rec.Code)
	}
}

func TestResetJob_RefusesNoRoleAtAll(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPatch, "/jobs/1/reset", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	ResetJob(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when no role was set on the context", rec.Code)
	}
}

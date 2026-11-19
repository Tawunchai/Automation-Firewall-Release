package passwordpolicy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

func newCtx(method, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/password-policy", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

// UpdatePolicy sets the complexity and expiry rules every account is checked against — a caller who
// could change it without being admin could weaken every account's password requirement at once.
func TestUpdatePolicy_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodPatch, "user", `{"min_length":6}`)
	UpdatePolicy(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin", rec.Code)
	}
}

func TestUpdatePolicy_RefusesNoRoleAtAll(t *testing.T) {
	c, rec := newCtx(http.MethodPatch, "", `{"min_length":6}`)
	UpdatePolicy(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when no role was set on the context", rec.Code)
	}
}

// GetPolicy is deliberately public — the signup/change-password form needs the rules before the
// caller is known to be anyone in particular. Not exercised here: it reaches services.GetPasswordPolicy
// -> getPolicyCfg, which calls db.Where on whatever config.DB() returns with no nil guard, so a call
// with no real database panics instead of returning a default. That is a pre-existing gap unrelated
// to the admin-gate this file is about — see this package's test report rather than a fix here.

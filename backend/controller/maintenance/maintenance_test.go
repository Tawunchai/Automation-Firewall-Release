package maintenance

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
	c.Request = httptest.NewRequest(method, "/maintenance", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

// GetStatus and Toggle both check user_role by hand (a type-asserted map lookup, not a shared
// helper), which is exactly the shape that drifts quietly when one call site is edited and the
// other is not — pinned here so that drift would fail a test instead of shipping.

func TestGetStatus_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodGet, "user", "")
	GetStatus(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin", rec.Code)
	}
}

func TestGetStatus_RefusesNoRoleAtAll(t *testing.T) {
	c, rec := newCtx(http.MethodGet, "", "")
	GetStatus(c)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 when the context carries no role at all (unauthenticated), "+
			"not 403 — GetStatus distinguishes the two cases on purpose", rec.Code)
	}
}

func TestToggle_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodPatch, "operator", "")
	Toggle(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator — maintenance mode affects every signed-in "+
			"user, not just device config, so this stays admin-only even for the role that can edit devices", rec.Code)
	}
}

func TestToggle_RefusesNoRoleAtAll(t *testing.T) {
	c, rec := newCtx(http.MethodPatch, "", "")
	Toggle(c)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 when the context carries no role at all", rec.Code)
	}
}

package changerequest

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// Review approves or rejects a Change Request — admin only; raising and reading one are open to
// anyone who can see the device (see the package doc comment in changerequest.go for why the three
// are split this way). requireAdmin runs before anything else in Review, including parsing the
// request body, so the refusal is testable with no body and no database.

func TestReview_RefusesANonAdmin(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-requests/1/review", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "user")

	Review(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin", rec.Code)
	}
}

func TestReview_RefusesAnOperator(t *testing.T) {
	// Operator (Phase A4) may raise a request like anyone else, but approving one is the mandatory
	// second pair of eyes the whole feature exists for — it stays admin-only even for a role that
	// can write device config directly elsewhere.
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-requests/1/review", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "operator")

	Review(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator", rec.Code)
	}
}

func TestReview_RefusesNoRoleAtAll(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-requests/1/review", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	Review(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when no role was set on the context", rec.Code)
	}
}

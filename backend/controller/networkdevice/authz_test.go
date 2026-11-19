package networkdevice

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Every write in this package is admin-only — see isAdmin's callers. These pin that each handler
// still checks it, rather than relying on ctxWithRole (device_response_test.go) ever being read by
// all of them by coincidence. None of these reach the database: every one of the five checks the
// role before touching config.DB(), so a non-admin call here never needs one.

func newAdminGateCtx(method, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/devices", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	return c, rec
}

func TestCreate_RefusesANonAdmin(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodPost, "operator", "")
	Create(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator — adding a device is an admin action", rec.Code)
	}
}

func TestUpdate_RefusesANonAdmin(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodPatch, "user", "")
	Update(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a user", rec.Code)
	}
}

func TestDelete_RefusesANonAdmin(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodDelete, "readonly", "")
	Delete(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a read-only account", rec.Code)
	}
}

func TestRotateCredKey_RefusesANonAdmin(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodPost, "operator", "")
	RotateCredKey(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — key rotation touches every stored credential in the app", rec.Code)
	}
}

func TestBulkCreate_RefusesANonAdmin(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodPost, "user", `{"devices":[]}`)
	BulkCreate(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a user — bulk onboarding is the same admin action as POST /devices, repeated", rec.Code)
	}
}

// No role at all (a context nothing ever stamped "user_role" on) must refuse exactly like an
// explicit non-admin role — isAdmin reads GetString, which returns "" for an absent key, and ""
// must never accidentally equal "admin".
func TestCreate_RefusesWhenNoRoleWasSet(t *testing.T) {
	c, rec := newAdminGateCtx(http.MethodPost, "", "")
	Create(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when the context carries no role at all", rec.Code)
	}
}

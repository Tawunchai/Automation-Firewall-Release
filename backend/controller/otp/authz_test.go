package otp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Handlers in this package gate on user_role == "admin" inline (no shared helper, unlike notify's
// requireAdmin), each before touching config.DB() — so the refusal path needs no database.
//
// ListSendEmail and UpdateSendEmailByID were flagged by an earlier pass of this file as missing
// their admin check entirely: ListSendEmail returned every row — including PassApp, which
// entity.SendEmail stores in PLAIN TEXT — to any signed-in caller, and UpdateSendEmailByID let any
// signed-in caller overwrite the system's OTP-sending SMTP credential. Both now check user_role
// before touching the database, same as CreateSendEmail, and are covered below.

func init() { gin.SetMode(gin.TestMode) }

func newAdminGateCtx(method, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/x", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

func TestOTPAdminHandlers_RefuseANonAdmin(t *testing.T) {
	handlers := map[string]func(*gin.Context){
		"Toggle2FA":         Toggle2FA,
		"GetSecurityConfig": GetSecurityConfig,
		"ToggleTwoStep":     ToggleTwoStep,
		"ToggleResetOTP":    ToggleResetOTP,
	}
	for _, role := range []string{"user", "operator", "readonly", ""} {
		for name, h := range handlers {
			t.Run(name+"/"+roleLabel(role), func(t *testing.T) {
				c, rec := newAdminGateCtx(http.MethodPatch, role, "{}")
				h(c)
				if rec.Code != http.StatusForbidden {
					t.Errorf("%s with role %q = %d, want 403", name, role, rec.Code)
				}
			})
		}
	}
}

// CreateSendEmail checks the caller is logged in before it checks admin, so a context with no
// user_id must be given one first — otherwise the 401 from getLoginAppUserID would mask whether the
// admin check works at all.
func TestCreateSendEmail_RefusesANonAdmin(t *testing.T) {
	for _, role := range []string{"user", "operator", "readonly", ""} {
		t.Run(roleLabel(role), func(t *testing.T) {
			c, rec := newAdminGateCtx(http.MethodPost, role, `{"email":"a@b.com","pass_app":"x"}`)
			c.Set("user_id", uint(1))
			CreateSendEmail(c)
			if rec.Code != http.StatusForbidden {
				t.Errorf("role %q = %d, want 403 — CreateSendEmail stores an SMTP app password", role, rec.Code)
			}
		})
	}
}

// ListSendEmail checks role before touching the database, so no caller setup beyond user_role
// is needed — the refusal path never reaches config.DB().
func TestListSendEmail_RefusesANonAdmin(t *testing.T) {
	for _, role := range []string{"user", "operator", "readonly", ""} {
		t.Run(roleLabel(role), func(t *testing.T) {
			c, rec := newAdminGateCtx(http.MethodGet, role, "")
			ListSendEmail(c)
			if rec.Code != http.StatusForbidden {
				t.Errorf("role %q = %d, want 403 — ListSendEmail returns every row's plaintext SMTP password", role, rec.Code)
			}
		})
	}
}

// UpdateSendEmailByID checks login, then role, before touching the database — so like
// CreateSendEmail, a context with no user_id must be given one first.
func TestUpdateSendEmailByID_RefusesANonAdmin(t *testing.T) {
	for _, role := range []string{"user", "operator", "readonly", ""} {
		t.Run(roleLabel(role), func(t *testing.T) {
			c, rec := newAdminGateCtx(http.MethodPut, role, `{"email":"a@b.com","pass_app":"x"}`)
			c.Set("user_id", uint(1))
			c.Params = gin.Params{{Key: "id", Value: "1"}}
			UpdateSendEmailByID(c)
			if rec.Code != http.StatusForbidden {
				t.Errorf("role %q = %d, want 403 — UpdateSendEmailByID overwrites the system's OTP-sending SMTP credential", role, rec.Code)
			}
		})
	}
}

func roleLabel(role string) string {
	if role == "" {
		return "no-role"
	}
	return role
}

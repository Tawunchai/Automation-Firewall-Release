package notify

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// "Every route is admin-only" is this package's own doc comment (see the top of channels.go) — a
// channel holds a LINE bot token, a rule decides who gets woken at 3am. This pins that every
// handler actually enforces it, in one table rather than eighteen near-identical Test functions,
// since every one of them is a plain func(*gin.Context) that returns before touching config.DB().
//
// ⚠️ rules.go's ListKinds is NOT in this table and is NOT admin-gated, despite the package doc
// comment above claiming every route is. It returns services.NotifyKinds and the poll interval —
// static catalogue data, no device or personal information — so the exposure is narrow, but it
// contradicts the package's own stated invariant and is worth a decision rather than silence.
// Reported, not fixed, here.

func init() { gin.SetMode(gin.TestMode) }

func newAdminGateCtx(method, role string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/notify/x", strings.NewReader("{}"))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	return c, rec
}

func TestNotifyHandlers_RefuseANonAdmin(t *testing.T) {
	handlers := map[string]func(*gin.Context){
		"ListChannels":    ListChannels,
		"CreateChannel":   CreateChannel,
		"UpdateChannel":   UpdateChannel,
		"DeleteChannel":   DeleteChannel,
		"TestChannel":     TestChannel,
		"ListRecipients":  ListRecipients,
		"CreateRecipient": CreateRecipient,
		"UpdateRecipient": UpdateRecipient,
		"DeleteRecipient": DeleteRecipient,
		"ListRules":       ListRules,
		"CreateRule":      CreateRule,
		"UpdateRule":      UpdateRule,
		"DeleteRule":      DeleteRule,
		"TestRule":        TestRule,
		"ListEvents":      ListEvents,
		"ClearEvents":     ClearEvents,
		"Overview":        Overview,
		"RunNow":          RunNow,
	}

	for _, role := range []string{"user", "operator", "readonly", ""} {
		for name, h := range handlers {
			t.Run(name+"/"+roleLabel(role), func(t *testing.T) {
				c, rec := newAdminGateCtx(http.MethodPost, role)
				h(c)
				if rec.Code != http.StatusForbidden {
					t.Errorf("%s with role %q = %d, want 403", name, role, rec.Code)
				}
			})
		}
	}
}

func roleLabel(role string) string {
	if role == "" {
		return "no-role"
	}
	return role
}

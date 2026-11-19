package siemexport

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
	c.Request = httptest.NewRequest(method, "/admin/siem-export", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

// All three handlers gate through the same requireAdmin(c) — one test per handler so a future
// handler that forgets to call it fails loudly instead of silently exposing where the Change Ledger
// is being forwarded, or letting anyone redirect it.

func TestGetPolicy_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodGet, "operator", "")
	GetPolicy(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator", rec.Code)
	}
}

func TestUpdatePolicy_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodPatch, "user", `{"enabled":true,"webhook_url":"https://example.com"}`)
	UpdatePolicy(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin — otherwise any signed-in user could redirect "+
			"every change this console makes to a webhook of their choosing", rec.Code)
	}
}

func TestTestWebhook_RefusesANonAdmin(t *testing.T) {
	c, rec := newCtx(http.MethodPost, "readonly", `{"webhook_url":"https://example.com"}`)
	TestWebhook(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a read-only account", rec.Code)
	}
}

func TestSIEMExportHandlers_RefuseNoRoleAtAll(t *testing.T) {
	for name, run := range map[string]func(*gin.Context){
		"GetPolicy":    GetPolicy,
		"UpdatePolicy": func(c *gin.Context) { UpdatePolicy(c) },
		"TestWebhook":  func(c *gin.Context) { TestWebhook(c) },
	} {
		c, rec := newCtx(http.MethodGet, "", "")
		run(c)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403 when no role was set on the context", name, rec.Code)
		}
	}
}

func TestValidWebhookURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://hooks.example.com/siem", true},
		{"http://10.0.0.5:8080/ingest", true},
		{"", false},
		{"not a url", false},
		{"ftp://example.com/x", false},
		{"javascript:alert(1)", false},
	}
	for _, c := range cases {
		if got := validWebhookURL(c.url); got != c.want {
			t.Errorf("validWebhookURL(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

package terminal

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// Shell bridges a browser WebSocket to the firewall's own CLI: whoever reaches it can type anything
// the mapped account can type, on a live device. The package was at 0% coverage.
//
// The guards all sit before the WebSocket upgrade, and they have to — once the connection is
// upgraded an HTTP status can no longer be sent, so a refusal after that point reaches the browser
// as an opaque socket close with no reason on it. The handler's own comment says this; nothing
// checked it.
//
// No database is configured in this binary, so config.DB() panics. A guard that moved below the
// device lookup would fail here by panicking rather than passing quietly — that ordering is the
// property under test.

func shellCtx(role, deviceID, query string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	url := "/terminal/" + deviceID + "/shell"
	if query != "" {
		url += "?" + query
	}
	c.Request = httptest.NewRequest(http.MethodGet, url, nil)
	if role != "" {
		c.Set("user_role", role)
	}
	c.Set("user_id", uint(7))
	c.Params = gin.Params{{Key: "deviceId", Value: deviceID}}
	return c, rec
}

func TestShellRefusesEveryoneButAnAdminBeforeUpgrading(t *testing.T) {
	for _, role := range []string{"user", "", "operator", "viewer", "Admin", "ADMIN", "admin ", "admins"} {
		t.Run("role="+role, func(t *testing.T) {
			c, rec := shellCtx(role, "1", "proto=ssh")
			Shell(c)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("role %q answered %d, want 403 — this opens a shell on a live firewall", role, rec.Code)
			}
			// A JSON body is only possible because the refusal came before the upgrade. If this
			// were empty the caller would be getting a bare socket close instead of a reason.
			if !strings.Contains(rec.Body.String(), "admin access required") {
				t.Errorf("role %q: body %q does not say why", role, rec.Body.String())
			}
		})
	}
}

func TestShellRejectsADeviceIDThatIsNotAPositiveInteger(t *testing.T) {
	for _, raw := range []string{"0", "-1", "abc", "", "1.5", "٣", "0x1", "9999999999999999999999"} {
		t.Run("id="+raw, func(t *testing.T) {
			c, rec := shellCtx("admin", raw, "proto=ssh")
			Shell(c)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("device id %q answered %d, want 400", raw, rec.Code)
			}
		})
	}
}

// An unknown protocol is refused before the device is loaded. Worth pinning because the value comes
// straight off the query string and decides which transport is dialled.
func TestShellRejectsAnUnknownProtocol(t *testing.T) {
	for _, proto := range []string{"rlogin", "http", "ssh2", "telnetd", "'; DROP TABLE", "ssh telnet"} {
		t.Run("proto="+proto, func(t *testing.T) {
			// Escaped, because these go through a real query string — an unescaped space makes
			// httptest.NewRequest reject the URL and tests nothing about the handler.
			c, rec := shellCtx("admin", "1", "proto="+url.QueryEscape(proto))
			Shell(c)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("proto %q answered %d, want 400", proto, rec.Code)
			}
			if !strings.Contains(rec.Body.String(), "unknown protocol") {
				t.Errorf("proto %q: body %q does not name the problem", proto, rec.Body.String())
			}
		})
	}
}

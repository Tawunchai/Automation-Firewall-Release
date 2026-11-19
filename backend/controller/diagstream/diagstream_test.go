package diagstream

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Everything this endpoint can refuse, it must refuse BEFORE the WebSocket upgrade.
//
// That is the whole point of these tests. After the upgrade there is no HTTP status left to send,
// so a check that runs late does not produce "admin access required" — it produces a socket that
// opens and closes with no explanation, which is indistinguishable from the firewall being
// unreachable. The handler is ordered role → tool → device id → target for exactly this reason, and
// every case below asserts a real status code came back rather than a 101.

func newRouter(role string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/diag-stream/:deviceId/:tool", func(c *gin.Context) {
		if role != "" {
			c.Set("user_role", role)
		}
		Stream(c)
	})
	return r
}

// A request that looks like a real WebSocket handshake, so a check that "passes" would actually
// reach the upgrader instead of failing for a missing header.
func wsRequest(url string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "x3JJHMbDL1EzLkh9GBhXDw==")
	return req
}

func TestStream_NonAdminIsRefusedBeforeTheUpgrade(t *testing.T) {
	for _, role := range []string{"user", "viewer", ""} {
		w := httptest.NewRecorder()
		newRouter(role).ServeHTTP(w, wsRequest("/diag-stream/1/ping?target=8.8.8.8"))

		if w.Code != http.StatusForbidden {
			t.Errorf("role %q: status = %d, want 403 — an SSH diagnostic must not be open to non-admins", role, w.Code)
		}
		if !strings.Contains(w.Body.String(), "admin") {
			t.Errorf("role %q: body = %q, want it to say why", role, w.Body.String())
		}
	}
}

func TestStream_RejectsUnknownTool(t *testing.T) {
	w := httptest.NewRecorder()
	newRouter("admin").ServeHTTP(w, wsRequest("/diag-stream/1/reboot?target=8.8.8.8"))

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 — only ping and traceroute exist", w.Code)
	}
}

// The target is pasted onto a command line on a live firewall. This is the last line of defence
// before the upgrade, and it must not be reachable by anything the validator rejects.
func TestStream_RejectsInjectionInTheTarget(t *testing.T) {
	bad := []string{
		"8.8.8.8%3B%20execute%20reboot", // "; execute reboot"
		"8.8.8.8%0Aexecute%20reboot",    // newline + a second command
		"host%20name",
		"", // absent entirely
	}
	for _, target := range bad {
		w := httptest.NewRecorder()
		newRouter("admin").ServeHTTP(w, wsRequest("/diag-stream/1/ping?target="+target))

		if w.Code != http.StatusBadRequest {
			t.Errorf("target %q: status = %d, want 400", target, w.Code)
		}
	}
}

func TestStream_RejectsBadDeviceID(t *testing.T) {
	for _, id := range []string{"0", "-1", "abc"} {
		w := httptest.NewRecorder()
		newRouter("admin").ServeHTTP(w, wsRequest("/diag-stream/"+id+"/ping?target=8.8.8.8"))

		if w.Code != http.StatusBadRequest {
			t.Errorf("device id %q: status = %d, want 400", id, w.Code)
		}
	}
}

// atoiOr backs the optional ping knobs. A junk value must fall back to the caller's default rather
// than becoming 0, which downstream would read as "unset" only by luck.
func TestAtoiOr(t *testing.T) {
	cases := []struct {
		in       string
		fallback int
		want     int
	}{
		{"5", 0, 5},
		{"", 0, 0},
		{"", 7, 7},
		{"abc", 3, 3},
		{"-2", 9, -2}, // negative is passed through; clampPingOptions is what rejects it
	}
	for _, c := range cases {
		if got := atoiOr(c.in, c.fallback); got != c.want {
			t.Errorf("atoiOr(%q, %d) = %d, want %d", c.in, c.fallback, got, c.want)
		}
	}
}

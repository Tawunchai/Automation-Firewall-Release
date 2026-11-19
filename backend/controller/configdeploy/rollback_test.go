package configdeploy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// Rollback restores a whole configuration file to a firewall, and the firewall REBOOTS into it. It
// is the most destructive thing this console can do to a device, and it was reachable through a
// package sitting at 6.6% coverage with nothing covering this file at all.
//
// Two things stand between a stray request and a rebooted production firewall — the role check and
// the explicit confirmation — and both happen before the backup is loaded, the file is inspected or
// the device is dialled. That ordering is what these tests hold: no database is configured in this
// binary, so a guard that moved below the first query would fail here by panicking rather than
// passing quietly.

func rollbackCtx(role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(http.MethodPost, "/backups/1/rollback", nil)
	} else {
		r = httptest.NewRequest(http.MethodPost, "/backups/1/rollback", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	c.Request = r
	if role != "" {
		c.Set("user_role", role)
	}
	c.Set("user_id", uint(7))
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	return c, rec
}

// A viewer must not be able to reboot a firewall. `operator` is allowed here alongside `admin` —
// deploying config is that role's job — so the test pins both halves: who is turned away, and who
// is not.
func TestRollbackRefusesAnyoneWhoCannotDeploy(t *testing.T) {
	for _, role := range []string{"user", "", "viewer", "Admin", "ADMIN", "Operator", "admins"} {
		t.Run("role="+role, func(t *testing.T) {
			c, rec := rollbackCtx(role, `{"confirm":true}`)
			Rollback(c)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("role %q answered %d, want 403 — this endpoint reboots a firewall", role, rec.Code)
			}
		})
	}
}

func TestRollbackAcceptsAdminAndOperatorPastTheRoleGate(t *testing.T) {
	// Past the role gate they hit the confirmation gate, which is a 400. Anything else — a 403, or
	// a panic from reaching the database — means the gates changed order or the role list changed.
	for _, role := range []string{"admin", "operator"} {
		t.Run("role="+role, func(t *testing.T) {
			c, rec := rollbackCtx(role, `{"confirm":false}`)
			Rollback(c)
			if rec.Code == http.StatusForbidden {
				t.Fatalf("role %q was refused; admin and operator are both meant to be able to roll back", role)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("role %q answered %d, want 400 from the confirmation gate", role, rec.Code)
			}
		})
	}
}

// The confirmation is not a formality: it is the only thing that distinguishes "the operator read
// the preview and accepted a reboot" from "something POSTed to this URL". An empty body, a missing
// field and an explicit false must all be refused — the default for a bool is false, and that is
// the safe direction here.
func TestRollbackRefusesAnythingButAnExplicitConfirmation(t *testing.T) {
	for name, body := range map[string]string{
		"no body at all":    "",
		"empty object":      `{}`,
		"confirm false":     `{"confirm":false}`,
		"only force":        `{"force":true}`,
		"malformed json":    `{"confirm":`,
		"confirm as string": `{"confirm":"true"}`,
		"confirm as number": `{"confirm":1}`,
	} {
		t.Run(name, func(t *testing.T) {
			c, rec := rollbackCtx("admin", body)
			Rollback(c)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s answered %d, want 400 — only {\"confirm\": true} may proceed", name, rec.Code)
			}
			if !strings.Contains(rec.Body.String(), "reboots the firewall") {
				t.Errorf("%s: body %q does not warn about the reboot", name, rec.Body.String())
			}
		})
	}
}

// `force` overrides the model/firmware mismatch warning. It must never substitute for the
// confirmation — restoring a config from a different model onto a device is exactly the case where
// somebody should have read the preview.
func TestForceDoesNotStandInForConfirm(t *testing.T) {
	c, rec := rollbackCtx("admin", `{"force":true,"confirm":false}`)
	Rollback(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("force with confirm:false answered %d, want 400", rec.Code)
	}
}

func TestCanDeployMatchesRolesExactly(t *testing.T) {
	for _, role := range []string{"admin", "operator"} {
		c, _ := rollbackCtx(role, "")
		if !canDeploy(c) {
			t.Errorf("role %q was refused", role)
		}
	}
	// The role string comes from a JWT claim; a loosened comparison would be invisible until
	// someone created a user whose role differed only in case or whitespace.
	for _, role := range []string{"Admin", "ADMIN", "admin ", " operator", "Operator", "user", "", "adminx"} {
		c, _ := rollbackCtx(role, "")
		if canDeploy(c) {
			t.Errorf("role %q was accepted", role)
		}
	}
}

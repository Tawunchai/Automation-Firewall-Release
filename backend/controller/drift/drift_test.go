package drift

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// This package was at 0% coverage, and one of its endpoints DELETES an object from a live firewall.
//
// UndoFinding's whole job is to remove something a drift analysis found on a device — by mkey, via
// services.UndoOutsideCreate. The services layer already pins the part that decides WHETHER a
// finding may be undone (drifttimeline_test.go: only a top-level create with a key qualifies, and
// the delete is always by key so it can never hit a collection URL). What nothing covered is this
// layer: who is allowed to ask, and whether the refusals happen before anything is touched.
//
// These tests need no database, and that is load-bearing rather than convenient. No connection is
// configured in this binary, so config.DB() panics — which means a guard that ran AFTER the first
// query would fail here by panicking instead of passing quietly. The ordering is the property.

// newCtx builds the context middleware.Authorizes would have stamped, plus gin's URL params.
func newCtx(role string, id uint, params gin.Params) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/drift/findings/1/undo", nil)
	if role != "" {
		c.Set("user_role", role)
	}
	if id != 0 {
		c.Set("user_id", id)
	}
	c.Params = params
	return c, rec
}

// The writes. Listing them by hand is the point: a new write added without a guard has to be added
// here too, and a reviewer sees the omission.
var writeHandlers = map[string]gin.HandlerFunc{
	"Analyse":     Analyse,
	"UndoFinding": UndoFinding,
}

func TestWritesRefuseANonAdminBeforeTouchingAnything(t *testing.T) {
	for name, h := range writeHandlers {
		for _, role := range []string{"user", "", "Admin", "ADMIN", "admin ", "administrator"} {
			t.Run(name+"/role="+role, func(t *testing.T) {
				c, rec := newCtx(role, 7, gin.Params{{Key: "id", Value: "1"}})
				h(c)

				if rec.Code != http.StatusForbidden {
					t.Fatalf("%s with role %q answered %d, want 403 — Analyse writes to a device's "+
						"history and UndoFinding deletes an object off the firewall itself",
						name, role, rec.Code)
				}
			})
		}
	}
}

// Reads are open to any signed-in user ON PURPOSE — the package comment says so, and the Change
// Ledger follows the same rule: knowing what happened to a firewall is not privileged.
//
// Asserted as "does not answer 403", because with no database these handlers panic on their first
// query. Getting as far as the panic IS the evidence: the caller was not turned away at the door.
func TestReadsAreNotAdminGated(t *testing.T) {
	reads := map[string]gin.HandlerFunc{
		"ListRuns": ListRuns,
		"GetRun":   GetRun,
		"Summary":  Summary,
	}
	for name, h := range reads {
		t.Run(name, func(t *testing.T) {
			c, rec := newCtx("user", 7, gin.Params{{Key: "id", Value: "1"}})
			func() {
				defer func() { _ = recover() }() // the DB panic is expected; the status is what matters
				h(c)
			}()
			if rec.Code == http.StatusForbidden {
				t.Fatalf("%s refused a signed-in user — reads are deliberately open here; if that "+
					"changed, the page's own permission model changed with it", name)
			}
		})
	}
}

// A malformed id must be rejected before the finding is looked up. Nothing here reaches a device,
// but the id is what selects WHICH object gets deleted, so it is worth pinning that the parse is
// strict rather than best-effort.
func TestUndoRejectsAnIDThatIsNotAPositiveInteger(t *testing.T) {
	// "٣" is an Arabic-Indic digit and "0x1" a hex literal — strconv.Atoi rejects both. The last
	// overflows an int. "0" and "-1" parse fine and are refused by the explicit id <= 0 check.
	for _, raw := range []string{"0", "-1", "abc", "", "1.5", "1 OR 1=1", "٣", "0x1", "9999999999999999999999"} {
		t.Run("id="+raw, func(t *testing.T) {
			c, rec := newCtx("admin", 1, gin.Params{{Key: "id", Value: raw}})
			UndoFinding(c)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("id %q answered %d, want 400", raw, rec.Code)
			}
			if !strings.Contains(rec.Body.String(), "invalid finding id") {
				t.Errorf("id %q: body %q does not say what was wrong", raw, rec.Body.String())
			}
		})
	}
}

// The two helpers the whole package leans on, matched exactly — the role string comes from a JWT
// claim, and a loosened comparison would be invisible until someone created a user whose role
// differed only in case.
func TestAdminIsMatchedExactly(t *testing.T) {
	c, _ := newCtx("admin", 1, nil)
	if !isAdmin(c) {
		t.Error(`role "admin" was not recognised`)
	}
	for _, role := range []string{"Admin", "ADMIN", "admin ", " admin", "admins", "user", ""} {
		c, _ := newCtx(role, 1, nil)
		if isAdmin(c) {
			t.Errorf("role %q was accepted as admin", role)
		}
	}
}

func TestAnEmptyContextIsNotAdmin(t *testing.T) {
	c, rec := newCtx("", 0, nil)
	if isAdmin(c) {
		t.Fatal("a context with no role read as admin")
	}
	if requireAdmin(c) {
		t.Fatal("requireAdmin let a context with no role through")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("requireAdmin answered %d, want 403", rec.Code)
	}
}

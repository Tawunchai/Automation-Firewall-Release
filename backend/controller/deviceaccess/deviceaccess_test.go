package deviceaccess

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// This package decides which firewalls each person may reach, so an endpoint here that a non-admin
// could call IS the privilege escalation the feature exists to prevent — a user could grant
// themselves every device in the inventory and the console would consider it legitimate.
//
// The package was at 0% coverage. What is covered here is the property that matters and can be
// checked without standing up Postgres: every handler refuses a non-admin BEFORE it touches the
// database. That ordering is not incidental — it is why these tests need no database at all, and a
// handler that started reading the DB first would fail here by panicking on the nil connection
// rather than passing quietly.

// newCtx builds a request context carrying what middleware.Authorizes would have stamped on it,
// plus the URL params gin would have parsed.
func newCtx(role string, id uint, params gin.Params) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if role != "" {
		c.Set("user_role", role)
	}
	if id != 0 {
		c.Set("user_id", id)
	}
	c.Params = params
	return c, rec
}

// handlers is every exported entry point in the package. Listing them by hand is the point: a new
// route added without a guard has to be added here too, and a reviewer sees the omission.
var handlers = map[string]gin.HandlerFunc{
	"ListForUser": ListForUser,
	"SetForUser":  SetForUser,
	"Summary":     Summary,
}

func TestEveryHandlerRefusesANonAdmin(t *testing.T) {
	for name, h := range handlers {
		for _, role := range []string{"user", "", "Admin", "administrator"} {
			t.Run(name+"/role="+role, func(t *testing.T) {
				c, rec := newCtx(role, 7, gin.Params{{Key: "id", Value: "7"}})
				// No database is configured in this test binary. Reaching one would panic, which is
				// the failure mode this asserts against just as much as a 200 would be.
				h(c)

				if rec.Code != http.StatusForbidden {
					t.Fatalf("%s with role %q answered %d, want 403 — this package grants access to "+
						"firewalls, so anything but a refusal here is an escalation", name, role, rec.Code)
				}
				if !strings.Contains(rec.Body.String(), "admin access required") {
					t.Errorf("%s: body %q does not say why", name, rec.Body.String())
				}
			})
		}
	}
}

// "admin" is matched exactly — case included. Worth pinning because the role string comes from a
// JWT claim, and a loosened comparison here would be invisible until someone created a user whose
// role happened to differ only in case.
func TestAdminIsMatchedExactly(t *testing.T) {
	c, _ := newCtx("admin", 1, nil)
	if !isAdmin(c) {
		t.Error(`role "admin" not recognised`)
	}
	for _, role := range []string{"Admin", "ADMIN", "admin ", " admin", "admins", "user"} {
		c, _ := newCtx(role, 1, nil)
		if isAdmin(c) {
			t.Errorf("role %q was accepted as admin", role)
		}
	}
}

// A context that somehow arrived with nothing stamped on it must read as unprivileged, never as a
// privileged caller — the direction a missing-middleware bug has to fail in.
func TestAnEmptyContextIsNotAdmin(t *testing.T) {
	c, _ := newCtx("", 0, nil)
	if isAdmin(c) {
		t.Fatal("a context with no role was treated as admin")
	}
	if requireAdmin(c) {
		t.Fatal("requireAdmin let a context with no role through")
	}
}

func TestPathUserIDRejectsAnythingButAPositiveInteger(t *testing.T) {
	// "٣" is an Arabic-Indic digit, "0x1" a hex literal, and the last one overflows an int —
	// strconv.Atoi rejects all three, which is the behaviour worth pinning rather than assuming.
	bad := []string{"0", "-1", "abc", "", "1.5", "1 OR 1=1", "٣", "0x1", "9999999999999999999999"}
	for _, raw := range bad {
		c, rec := newCtx("admin", 1, gin.Params{{Key: "id", Value: raw}})
		if _, ok := pathUserID(c); ok {
			t.Errorf("pathUserID accepted %q", raw)
		}
		if rec.Code != http.StatusBadRequest {
			t.Errorf("pathUserID(%q) answered %d, want 400", raw, rec.Code)
		}
	}

	c, _ := newCtx("admin", 1, gin.Params{{Key: "id", Value: "42"}})
	got, ok := pathUserID(c)
	if !ok || got != 42 {
		t.Errorf("pathUserID(\"42\") = %d, %v; want 42, true", got, ok)
	}

	// "+1" is accepted, and that is correct rather than an oversight: strconv.Atoi reads it as 1,
	// so the request resolves to the same real user and every check above it still applies. It is
	// an alias for a valid id, not a way past anything — recorded here so the next reader does not
	// have to re-derive that it is safe.
	c, _ = newCtx("admin", 1, gin.Params{{Key: "id", Value: "+1"}})
	if got, ok := pathUserID(c); !ok || got != 1 {
		t.Errorf("pathUserID(\"+1\") = %d, %v; want 1, true", got, ok)
	}
}

// The guard has to run before the id is parsed, or a non-admin learns which user ids are valid by
// reading the difference between 400 and 403.
func TestTheAdminCheckHappensBeforeTheIDIsParsed(t *testing.T) {
	c, rec := newCtx("user", 5, gin.Params{{Key: "id", Value: "not-a-number"}})
	ListForUser(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("answered %d for a non-admin with a malformed id, want 403 — a 400 would confirm "+
			"the request got past the guard", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "admin access required" {
		t.Errorf("error = %q, want the permission message rather than a parse complaint", body["error"])
	}
}

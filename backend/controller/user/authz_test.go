package user

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// newCtx builds a gin context carrying whatever middleware.Authorizes would have stamped on it.
// Passing role "" / id 0 models a request that somehow reached a handler without those set.
func newCtx(role string, id uint) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	if role != "" {
		c.Set("user_role", role)
	}
	if id != 0 {
		c.Set("user_id", id)
	}
	return c
}

func TestIsAdminAndCallerID(t *testing.T) {
	admin := newCtx("admin", 1)
	if !isAdmin(admin) {
		t.Error("admin context not recognised as admin")
	}
	if callerID(admin) != 1 {
		t.Errorf("callerID = %d, want 1", callerID(admin))
	}

	user := newCtx("user", 2)
	if isAdmin(user) {
		t.Error("non-admin context reported as admin")
	}

	// A context with nothing set (a misconfiguration) must read as not-admin, id 0 — never as a
	// privileged caller.
	empty := newCtx("", 0)
	if isAdmin(empty) || callerID(empty) != 0 {
		t.Error("empty context must be treated as an unprivileged, unknown caller")
	}
}

func TestRequireAdmin(t *testing.T) {
	admin := newCtx("admin", 1)
	if !requireAdmin(admin) {
		t.Error("requireAdmin blocked an admin")
	}
	if admin.Writer.Status() != http.StatusOK && admin.Writer.Written() {
		t.Error("requireAdmin wrote a response for an allowed admin")
	}

	rec := httptest.NewRecorder()
	user, _ := gin.CreateTestContext(rec)
	user.Set("user_role", "user")
	user.Set("user_id", uint(2))
	if requireAdmin(user) {
		t.Error("requireAdmin let a non-admin through")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

// The decision table behind PATCH /update-users/:id — the endpoint that used to allow both a
// cross-account edit (admin password takeover) and self-promotion via app_role_id.
func TestEditUserDecision(t *testing.T) {
	cases := []struct {
		name          string
		callerIsAdmin bool
		caller        uint
		target        uint
		wantsRole     bool
		want          editVerdict
	}{
		{"admin edits another user", true, 1, 2, false, editAllowed},
		{"admin changes another user's role", true, 1, 2, true, editAllowed},
		{"admin edits self", true, 1, 1, false, editAllowed},

		{"user edits own profile", false, 2, 2, false, editAllowed},
		{"user edits someone else — account takeover", false, 2, 1, false, editNotOwner},
		{"user changes another user's role", false, 2, 1, true, editNotOwner},
		{"user promotes self via role — escalation", false, 2, 2, true, editRoleForbidden},

		// A request with no identified caller must never be treated as the owner of any record.
		{"unknown caller targets user 0", false, 0, 0, false, editNotOwner},
		{"unknown caller targets a real user", false, 0, 2, false, editNotOwner},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := editUserDecision(tc.callerIsAdmin, tc.caller, tc.target, tc.wantsRole)
			if got != tc.want {
				t.Errorf("editUserDecision(admin=%v, caller=%d, target=%d, role=%v) = %d, want %d",
					tc.callerIsAdmin, tc.caller, tc.target, tc.wantsRole, got, tc.want)
			}
		})
	}
}

// The self-promotion case is the whole point of the role guard, so it gets its own assertion:
// a non-admin editing their OWN record is fine until they touch the role field.
func TestEditUserDecision_SelfEditIsFineUntilRole(t *testing.T) {
	if v := editUserDecision(false, 5, 5, false); v != editAllowed {
		t.Errorf("owner editing own profile = %d, want editAllowed", v)
	}
	if v := editUserDecision(false, 5, 5, true); v != editRoleForbidden {
		t.Errorf("owner setting own role = %d, want editRoleForbidden", v)
	}
}

// The decision behind GET /users/:id — it used to answer for anyone who merely had a session,
// which let any signed-in account page through ids and harvest the whole directory's PII.
func TestCanViewUser(t *testing.T) {
	cases := []struct {
		name          string
		callerIsAdmin bool
		caller        uint
		target        uint
		want          bool
	}{
		{"admin views another user", true, 1, 2, true},
		{"admin views self", true, 1, 1, true},
		{"user views own profile", false, 2, 2, true},
		{"user views someone else — PII harvest", false, 2, 1, false},
		{"unknown caller targets user 0", false, 0, 0, false},
		{"unknown caller targets a real user", false, 0, 2, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := canViewUser(tc.callerIsAdmin, tc.caller, tc.target); got != tc.want {
				t.Errorf("canViewUser(admin=%v, caller=%d, target=%d) = %v, want %v",
					tc.callerIsAdmin, tc.caller, tc.target, got, tc.want)
			}
		})
	}
}

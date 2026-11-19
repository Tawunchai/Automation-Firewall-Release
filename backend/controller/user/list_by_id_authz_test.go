package user

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// GET /users/:id checked only "is this session logged in", not "is this session allowed to see
// this record" — any signed-in account (including role "user"/"readonly") could walk every id
// and harvest email/phone/position/role for the whole directory. This holds the gate: a non-admin
// aimed at someone else's id must be refused before any database work runs.
func TestListUserByIDBlocksCrossAccountRead(t *testing.T) {
	cases := []struct {
		name   string
		role   string
		id     uint
		target string
	}{
		{"non-admin reading another account", "user", 2, "7"},
		{"readonly reading another account", "readonly", 2, "7"},
		{"no role, no id set at all", "", 0, "7"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/users/"+tc.target, nil)
			c.Params = gin.Params{{Key: "id", Value: tc.target}}
			if tc.role != "" {
				c.Set("user_role", tc.role)
			}
			if tc.id != 0 {
				c.Set("user_id", tc.id)
			}

			ListUserByID(c)

			if w.Code != http.StatusForbidden {
				t.Errorf("role=%q caller=%d target=%s got %d, want 403 — this endpoint must not "+
					"leak another account's PII to a caller who isn't that account's owner or an admin",
					tc.role, tc.id, tc.target, w.Code)
			}
			if body := w.Body.String(); strings.Contains(body, "@") || strings.Contains(body, "phone") {
				t.Errorf("request was refused but the response still carried user data: %s", body)
			}
		})
	}
}

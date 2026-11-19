package user

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// ListEmailAndPhoneNumber returns every account's address and phone number in one array.
//
// It was registered on the PUBLIC otp group, so an unauthenticated GET answered with the whole
// table: a ready-made list of valid login addresses, each with a phone number, served from the
// login page. ListUser right next to it in the same file has always required admin — the two
// disclose the same class of data through different gates, which is not a policy, it is an
// oversight that survived because nothing checked.
//
// routes/authz_test.go now holds the line that this needs a session at all. This holds the other
// half: a session is not enough, it has to be an admin's. The check runs before any database work,
// so a non-admin is refused without a query and this test needs no database either.
func TestListEmailAndPhoneNumberIsAdminOnly(t *testing.T) {
	for _, role := range []string{"user", ""} {
		name := role
		if name == "" {
			name = "(no role set)"
		}

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/email-phone-numbers", nil)
		if role != "" {
			c.Set("user_role", role)
		}

		ListEmailAndPhoneNumber(c)

		if w.Code != http.StatusForbidden {
			t.Errorf("role %s got %d, want 403.\n"+
				"This endpoint hands back every user's email and phone number; only an admin may "+
				"read it, and a request that somehow arrives with no role must fail closed.",
				name, w.Code)
		}
		if body := w.Body.String(); strings.Contains(body, "phone_number") || strings.Contains(body, "@") {
			t.Errorf("role %s was refused but the response still carried directory data: %s", name, body)
		}
	}
}

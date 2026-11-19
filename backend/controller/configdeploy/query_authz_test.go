package configdeploy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// POST /config-deploys/query had no authorization at all — no role check and no device check. It
// took a device_id out of the request body, loaded that device by primary key and ran up to ten
// commands on it over SSH. Its write-side sibling Create has always checked the role, and every
// device-proxy handler checks the grant; this one checked neither.
//
// Both refusals land before the handler reads anything, so they are testable with no database:
// canDeploy reads the role off the context, and services.UserCanAccessDevice answers "no" for a
// non-admin the moment it is handed a nil connection (a database error is not permission — see
// services/deviceaccess.go), and "yes" for an admin without querying at all.

func queryCtx(role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	r := httptest.NewRequest(http.MethodPost, "/config-deploys/query", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	c.Request = r
	c.Set("user_id", uint(9))
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

const readOnlyBody = `{"device_id":42,"command_text":"get system status"}`

// A plain signed-in account may not run commands on a firewall, even read-only ones: it is still
// an SSH login against a device that locks its admin account after three failures, and
// `show full-configuration` is the configuration.
func TestQueryRefusesARoleThatMayNotReachADevice(t *testing.T) {
	for _, role := range []string{"user", "viewer", ""} {
		name := role
		if name == "" {
			name = "no role at all"
		}
		t.Run(name, func(t *testing.T) {
			c, rec := queryCtx(role, readOnlyBody)

			Query(c)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403 for %q — Create gates on the same canDeploy", rec.Code, role)
			}
		})
	}
}

// An operator is allowed to address firewalls, but only the ones granted to them. With no grant,
// the answer is 404 and not 403, so the inventory cannot be enumerated by id.
func TestQueryRefusesADeviceTheCallerWasNotGranted(t *testing.T) {
	c, rec := queryCtx("operator", readOnlyBody)

	Query(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — an operator with no grant for device 42 must not reach it, "+
			"and 403 would confirm the device exists", rec.Code)
	}
}

// The other side: a caller who MAY have the device gets past both gates. An admin holds every
// device by the rule, and a deliberately disallowed command stops the request at the allow-list,
// which is the step after authorization — so a 400 here proves authorization let it through
// without the test needing a database or an SSH session.
func TestQueryLetsAGrantedCallerThroughToTheAllowList(t *testing.T) {
	c, rec := queryCtx("admin", `{"device_id":42,"command_text":"config firewall policy"}`)

	Query(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — an admin must get past the role and grant checks and be "+
			"stopped by the read-only allow-list instead", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "config firewall policy") {
		t.Fatalf("400 but not from the allow-list: %s", rec.Body.String())
	}
}

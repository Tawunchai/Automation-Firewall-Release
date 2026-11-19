package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// RequireApproval's routing decisions that do NOT need a database: whether a request is let
// straight through to the handler. The path that DOES touch the database — raising a request —
// is exercised live instead, same as the rest of the
// change-request state machine (see the note at the top of services/changerequest_test.go for why
// this codebase does not run those through an in-memory substitute for Postgres). The internal-apply
// secret that a genuine replay carries is generated per-process and unexported on purpose (so
// nothing outside services/changerequest_apply.go can mint one), which is also why only the
// REJECTION of a forged header — not the acceptance of a real one — can be tested from here.

// runApproval drives RequireApproval through a real gin router, the same way
// changerecorder_test.go's runResolve does, so :deviceId binds the way it does in production. The
// terminal handler flips `reached` so a test can tell "passed through" apart from "intercepted"
// without needing the database the intercepted path would otherwise require.
func runApproval(t *testing.T, method, path string, headers map[string]string) (reached bool, status int) {
	t.Helper()

	r := gin.New()
	r.Use(RequireApproval())
	terminal := func(c *gin.Context) {
		reached = true
		c.Status(http.StatusTeapot) // a status nothing else in this test produces
	}
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		r.Handle(m, "/policy/device/:deviceId/*rest", terminal)
	}

	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return reached, rec.Code
}

func TestRequireApproval_LetsReadsThrough(t *testing.T) {
	reached, status := runApproval(t, "GET", "/policy/device/1/firewall-policies", nil)
	if !reached || status != http.StatusTeapot {
		t.Fatalf("a GET was intercepted: reached=%v status=%d", reached, status)
	}
}

func TestRequireApproval_LetsUngatedWritesThrough(t *testing.T) {
	// Addresses are not in services.RequiresApproval's set — gating all ~150 device routes would
	// turn every routine edit into an approval request (see changerequest_gate.go).
	reached, status := runApproval(t, "PATCH", "/policy/device/1/addresses/LAN-host", nil)
	if !reached || status != http.StatusTeapot {
		t.Fatalf("a write to an ungated resource type was intercepted: reached=%v status=%d", reached, status)
	}
}

// TestRequireApproval_AdminWritesDirectly pins the product decision that an admin never waits on
// another admin: a gated write (firewall policy) from an admin passes straight through to the
// handler instead of becoming a pending Change Request. UserCanAccessDevice short-circuits to true
// for an admin, so the admin branch is reached without a database. A non-admin on the same route
// would be queued, which needs Postgres and is exercised live (see the note at the top of the file).
func TestRequireApproval_AdminWritesDirectly(t *testing.T) {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_role", "admin")
		c.Set("user_id", uint(1))
		c.Set("user_email", "admin@got.co.th")
	})
	r.Use(RequireApproval())
	reached := false
	terminal := func(c *gin.Context) {
		reached = true
		c.Status(http.StatusTeapot)
	}
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		r.Handle(m, "/policy/device/:deviceId/*rest", terminal)
	}

	req := httptest.NewRequest("POST", "/policy/device/1/firewall-policies", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if !reached || rec.Code != http.StatusTeapot {
		t.Fatalf("an admin's gated write did not pass straight through: reached=%v status=%d", reached, rec.Code)
	}
}

func TestRequireApproval_DoesNotTrustAForgedHeaderValue(t *testing.T) {
	reached, _ := runApproval(t, "PATCH", "/policy/device/1/firewall-policies/12", map[string]string{
		services.InternalApplyHeader: "not-the-real-secret",
	})
	if reached {
		t.Fatalf("a forged internal-apply header reached the handler without the real per-process secret")
	}
}

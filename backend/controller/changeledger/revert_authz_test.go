package changeledger

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// RevertChange rewrites a live firewall back to a previous state — admin only, same as every other
// device write. The role check runs before any database read, so the refusal is testable without
// one; the DB-dependent half (finding the record, replaying its inverse) is exercised live instead,
// same as the rest of this app's write paths.

func TestRevertChange_RefusesANonAdmin(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-ledger/1/revert", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "user")

	RevertChange(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a non-admin", rec.Code)
	}
}

func TestRevertChange_RefusesAnOperator(t *testing.T) {
	// Operator (Phase A4) may write device config going forward, but undoing a PAST change — maybe
	// someone else's — is a judgement call this app reserves for admin, same as the ledger's own
	// comment above RevertChange says.
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-ledger/1/revert", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_role", "operator")

	RevertChange(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for an operator", rec.Code)
	}
}

func TestRevertChange_RefusesNoRoleAtAll(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/change-ledger/1/revert", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}

	RevertChange(c)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 when no role was set on the context", rec.Code)
	}
}

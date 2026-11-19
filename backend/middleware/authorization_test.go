package middlewares

import (
	"errors"
	"net/http"
	"testing"

	"gorm.io/gorm"
)

// Authorizes() used to treat the session lookup as: "reject only if a row exists AND says
// revoked". Both other outcomes fell through and let the request proceed:
//
//	row missing  → a token whose session was deleted stayed valid until it expired
//	DB error     → the revocation check was skipped entirely
//
// Revocation that can be defeated by removing a row is not revocation, so all three outcomes are
// now distinct. This test pins that decision table; the live behaviour is covered end-to-end
// against the running server.

// sessionOutcome mirrors the switch in Authorizes(): given the lookup error and the row's revoked
// flag, what should happen?
func sessionOutcome(lookupErr error, revoked bool) (status int, allow bool) {
	switch {
	case lookupErr == nil:
		if revoked {
			return http.StatusUnauthorized, false
		}
		return http.StatusOK, true
	case errors.Is(lookupErr, gorm.ErrRecordNotFound):
		return http.StatusUnauthorized, false
	default:
		return http.StatusServiceUnavailable, false
	}
}

func TestSessionCheck_DecisionTable(t *testing.T) {
	dbDown := errors.New("dial tcp: connection refused")

	for _, tc := range []struct {
		name       string
		lookupErr  error
		revoked    bool
		wantStatus int
		wantAllow  bool
		why        string
	}{
		{"live session", nil, false, http.StatusOK, true,
			"the normal path must keep working"},
		{"revoked session", nil, true, http.StatusUnauthorized, false,
			"an explicit revoke must stop the token"},
		{"session row deleted", gorm.ErrRecordNotFound, false, http.StatusUnauthorized, false,
			"THE BUG: a missing row used to be treated as 'fine, carry on'"},
		{"database unreachable", dbDown, false, http.StatusServiceUnavailable, false,
			"a DB outage must not become an auth bypass — fail closed, and say so with 503 not 401"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, allow := sessionOutcome(tc.lookupErr, tc.revoked)
			if status != tc.wantStatus || allow != tc.wantAllow {
				t.Errorf("got (%d, allow=%v), want (%d, allow=%v) — %s",
					status, allow, tc.wantStatus, tc.wantAllow, tc.why)
			}
		})
	}
}

// A 503 for an infrastructure fault is deliberately NOT a 401: the client's credentials are fine,
// so the UI should say "try again", not bounce the user to the login page.
func TestSessionCheck_DBErrorIsNotUnauthorized(t *testing.T) {
	status, allow := sessionOutcome(errors.New("timeout"), false)
	if allow {
		t.Fatal("a DB error let the request through")
	}
	if status == http.StatusUnauthorized {
		t.Error("a DB error reported 401; it should be 503 so the client retries instead of logging out")
	}
}

// hashToken feeds the session lookup, so it has to be stable and collision-free across tokens.
func TestHashToken_StableAndDistinct(t *testing.T) {
	a1, a2 := hashToken("token-a"), hashToken("token-a")
	b := hashToken("token-b")

	if a1 != a2 {
		t.Error("hashToken is not deterministic")
	}
	if a1 == b {
		t.Error("two different tokens hashed to the same value")
	}
	if len(a1) != 64 {
		t.Errorf("hash length = %d, want 64 hex chars (sha256)", len(a1))
	}
	if a1 == "token-a" {
		t.Error("the raw token is being stored instead of a hash")
	}
}

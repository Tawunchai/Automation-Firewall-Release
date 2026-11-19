package platform

import (
	"testing"
)

// Sessions are keyed by sha256(token) under a UNIQUE index. The JWT claims for one user are
// otherwise identical within a second — iat/exp have one-second resolution — so before jti was
// added, two quick logins produced byte-identical tokens and the second session insert violated
// that index. The old code swallowed the failure, leaving a valid cookie with NO session row: a
// login that could never be revoked. Now it would fail the login outright, so token uniqueness is
// load-bearing, not cosmetic.

func TestGenerateJWT_TokensAreUniquePerCall(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-value-at-least-32-chars-long")

	const n = 50
	seen := make(map[string]bool, n)
	for i := 0; i < n; i++ {
		token, err := GenerateJWT(1, "admin@got.co.th", "admin")
		if err != nil {
			t.Fatalf("GenerateJWT: %v", err)
		}
		if seen[token] {
			t.Fatalf("call %d produced a duplicate token — identical claims collide without a jti", i)
		}
		seen[token] = true
	}
}

func TestGenerateJWT_CarriesAJTI(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-value-at-least-32-chars-long")

	token, err := GenerateJWT(7, "user@got.co.th", "user")
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}
	claims, err := ParseJWT(token)
	if err != nil {
		t.Fatalf("ParseJWT: %v", err)
	}

	if claims.ID == "" {
		t.Error("jti is empty; two logins in the same second would produce the same token")
	}
	if len(claims.ID) != 32 {
		t.Errorf("jti = %q (len %d), want 32 hex chars (128 bits)", claims.ID, len(claims.ID))
	}
	// The rest of the claims must survive the change.
	if claims.UserID != 7 || claims.Email != "user@got.co.th" || claims.Role != "user" {
		t.Errorf("claims = %+v, want the user's identity preserved", claims)
	}
}

// jti must be unpredictable, not a counter — it identifies a session.
func TestRandomTokenID_IsRandomAndHex(t *testing.T) {
	seen := make(map[string]bool, 100)
	for i := 0; i < 100; i++ {
		id, err := randomTokenID()
		if err != nil {
			t.Fatalf("randomTokenID: %v", err)
		}
		if len(id) != 32 {
			t.Fatalf("id = %q, want 32 hex chars", id)
		}
		for _, ch := range id {
			if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f') {
				t.Fatalf("id %q contains a non-hex character %q", id, ch)
			}
		}
		if seen[id] {
			t.Fatalf("duplicate id at iteration %d", i)
		}
		seen[id] = true
	}
}

// A token signed with a different secret must not validate.
func TestParseJWT_RejectsForeignSignature(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-value-at-least-32-chars-long")
	token, err := GenerateJWT(1, "admin@got.co.th", "admin")
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	t.Setenv("JWT_SECRET", "a-completely-different-secret-of-good-length")
	if _, err := ParseJWT(token); err == nil {
		t.Error("a token signed with another secret was accepted")
	}
}

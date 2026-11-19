package platform

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// A JWT names its own algorithm, and a parser that believes it is a parser that can be told the
// signature is fine. These claims carry user_id and role, so that is the whole session model.
func TestParseJWTRefusesAnyAlgorithmButTheOneWeSign(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-test-secret-that-is-long-enough-to-be-a-key")
	secret := []byte(GetJWTSecret())

	claims := JWTClaims{
		UserID: 1,
		Email:  "admin@example.com",
		Role:   "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}

	// The control: the token this app issues parses.
	good, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ParseJWT(good); err != nil {
		t.Fatalf("a token we signed ourselves was refused: %v", err)
	}

	// alg: none — the signature segment is empty and the claims are whatever the holder typed.
	none, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("build none-token: %v", err)
	}
	if _, err := ParseJWT(none); err == nil {
		t.Error("a token with alg:none was accepted — anybody could mint an admin session")
	}

	// A different HMAC strength is still not the one we sign with: accepting it widens the set of
	// tokens this process treats as its own for no reason.
	hs512, err := jwt.NewWithClaims(jwt.SigningMethodHS512, claims).SignedString(secret)
	if err != nil {
		t.Fatalf("sign hs512: %v", err)
	}
	if _, err := ParseJWT(hs512); err == nil {
		t.Error("a token signed with HS512 was accepted — the algorithm is not pinned")
	}

	// And the pin must name the algorithm we actually sign with, or every real session breaks.
	if alg := jwt.SigningMethodHS256.Alg(); !strings.EqualFold(alg, "HS256") {
		t.Fatalf("the signing method moved to %s — update the pin in ParseJWT with it", alg)
	}
}

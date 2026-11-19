package unit

import (
	"os"
	"testing"

	. "github.com/onsi/gomega"

	"network_automation/services/platform"
)

func init() {
	// Set a test JWT secret so GetJWTSecret() does not log.Fatal
	os.Setenv("JWT_SECRET", "test-secret-key-for-unit-tests-only")
}

// ── GenerateJWT / ParseJWT ────────────────────────────────────────────────────

func TestGenerateAndParseJWT(t *testing.T) {
	g := NewGomegaWithT(t)
	token, err := platform.GenerateJWT(1, "test@got.co.th", "admin")
	g.Expect(err).To(BeNil())
	g.Expect(token).ToNot(BeEmpty())

	claims, err := platform.ParseJWT(token)
	g.Expect(err).To(BeNil())
	g.Expect(claims.UserID).To(Equal(uint(1)))
	g.Expect(claims.Email).To(Equal("test@got.co.th"))
	g.Expect(claims.Role).To(Equal("admin"))
}

func TestParseJWTInvalidToken(t *testing.T) {
	g := NewGomegaWithT(t)
	_, err := platform.ParseJWT("this.is.not.valid")
	g.Expect(err).ToNot(BeNil())
}

func TestParseJWTTamperedToken(t *testing.T) {
	g := NewGomegaWithT(t)
	token, _ := platform.GenerateJWT(1, "test@got.co.th", "admin")
	tampered := token + "tampered"
	_, err := platform.ParseJWT(tampered)
	g.Expect(err).ToNot(BeNil())
}

// ── No reset-token tests, because there is no reset token ────────────────────
//
// GenerateResetToken / ParseResetToken were tested here and worked exactly as written. That was
// never the problem: the token was cryptographically sound and handed straight to whoever asked
// for it over an unauthenticated endpoint, which made "set any account's password" a two-call
// sequence. Both functions are gone (see services/platform/jwt.go), and a reset is proved by the OTP
// mailed to the address instead.

// ── GenerateTwoFAPendingToken / ParseTwoFAPendingToken ────────────────────────

func TestGenerateAndParseTwoFAPendingToken(t *testing.T) {
	g := NewGomegaWithT(t)
	token, err := platform.GenerateTwoFAPendingToken(5, "twofa@got.co.th")
	g.Expect(err).To(BeNil())
	g.Expect(token).ToNot(BeEmpty())

	claims, err := platform.ParseTwoFAPendingToken(token)
	g.Expect(err).To(BeNil())
	g.Expect(claims.UserID).To(Equal(uint(5)))
	g.Expect(claims.Email).To(Equal("twofa@got.co.th"))
	g.Expect(claims.Type).To(Equal("2fa_pending"))
}

func TestParseTwoFAPendingTokenWrongType(t *testing.T) {
	g := NewGomegaWithT(t)
	// A token of ANOTHER type must not pass as a 2FA pending token, even though both are signed
	// with the same secret and both parse. The `type` claim is the only thing separating a
	// half-finished login from a finished one, so a parser that ignored it would accept a full
	// session token at the second factor — turning 2FA into a formality.
	//
	// This used to be demonstrated with a password-reset token; that type no longer exists, so a
	// normal auth token stands in. The property under test is unchanged.
	authToken, _ := platform.GenerateJWT(1, "user@got.co.th", "user")
	_, err := platform.ParseTwoFAPendingToken(authToken)
	g.Expect(err).ToNot(BeNil())
}

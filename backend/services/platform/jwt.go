package platform

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type JWTClaims struct {
	UserID uint   `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type TwoFAPendingClaims struct {
	UserID uint   `json:"user_id"`
	Email  string `json:"email"`
	Type   string `json:"type"` // always "2fa_pending"
	jwt.RegisteredClaims
}

func GetJWTSecret() string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		log.Fatal("[FATAL] JWT_SECRET environment variable is not set. " +
			"Generate a strong secret (e.g. openssl rand -hex 32) and set it before starting the server.")
	}
	return secret
}

// GenerateJWT issues a login token.
//
// The ID (jti) is a random 128-bit value and it is what makes each token UNIQUE. Without it the
// claims are identical for the same user within the same second — iat/exp have one-second
// resolution — so two quick logins produced byte-identical tokens. Sessions are keyed by a hash of
// the token, so those two logins collided on one row: the second insert hit the unique index on
// user_sessions.token_hash and the login ended up with a cookie that had no session behind it.
func GenerateJWT(userID uint, email string, role string) (string, error) {
	jti, err := randomTokenID()
	if err != nil {
		return "", err
	}
	claims := JWTClaims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "starter-web",
			Subject:   email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(GetJWTSecret()))
}

// randomTokenID returns a hex-encoded 128-bit identifier for a JWT's jti claim.
func randomTokenID() (string, error) {
	return RandomHex(16)
}

// RandomHex returns n cryptographically random bytes, hex-encoded (so 2n characters).
//
// Shared because three unrelated things need an unguessable string and each had started to grow its
// own: a JWT's jti, a MIME boundary, and the filename of a report PDF that is briefly reachable over
// HTTP so LINE can link to it. The last one is the reason this uses crypto/rand rather than
// math/rand — a predictable name there would be a readable firewall report.
func RandomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("crypto/rand failed: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ParseJWT verifies a token this process issued and returns its claims.
//
// WithValidMethods pins the algorithm to the one GenerateJWT signs with (HS256, above). Without
// it, the library accepts whatever the TOKEN's own header asks for — and the two classic attacks
// on that are both reachable from a browser: `alg: none`, where the signature is empty and the
// claims are whatever the holder typed, and `alg: RS256` against an HMAC verifier, where the
// server's PUBLIC key is used as the HMAC secret. (github.com/golang-jwt/jwt v5 refuses "none" on
// its own, so this closes the second one and keeps the first closed if that ever regresses.)
//
// The cost of getting it wrong is the whole session model: these claims carry user_id and role.
func ParseJWT(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(GetJWTSecret()), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func GenerateTwoFAPendingToken(userID uint, email string) (string, error) {
	claims := TwoFAPendingClaims{
		UserID: userID,
		Email:  email,
		Type:   "2fa_pending",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(10 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(GetJWTSecret()))
}

func ParseTwoFAPendingToken(tokenString string) (*TwoFAPendingClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &TwoFAPendingClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(GetJWTSecret()), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*TwoFAPendingClaims)
	if !ok || !token.Valid || claims.Type != "2fa_pending" {
		return nil, errors.New("invalid 2FA pending token")
	}
	return claims, nil
}

// There is deliberately NO password-reset token type here.
//
// A signed 10-minute "password_reset" token used to live at this spot, minted by
// auth.CheckUserEmail and accepted by otp.ResetPasswordDirect as proof that the caller owned the
// address. It proved nothing: CheckUserEmail handed it to whoever asked for it, unauthenticated,
// so the pair amounted to "name an account, then set its password". Both are gone.
//
// Proof of ownership for a reset is the OTP code delivered to the mailbox (SaveOTP +
// SendOTPEmail), because that is the only thing in this system that a person who does not have
// the mailbox cannot obtain. If a reset path ever needs a token again, it must be delivered
// through the mailbox too — never returned in the response to the person requesting it.

// bcryptCost is deliberately one step above bcrypt.DefaultCost (10), which was chosen by the
// library years ago and has not moved since; 12 is roughly four times the work per guess for an
// attacker holding a dump of app_users.password, and a few tens of milliseconds for a login.
//
// Raising it is safe for everyone already stored. bcrypt writes its cost into the hash itself
// ("$2a$10$…"), and CompareHashAndPassword reads the parameters back out of the hash rather than
// from this constant, so every existing cost-10 hash keeps verifying; only passwords hashed from
// now on are written at 12.
const bcryptCost = 12

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}

func CheckPasswordHash(password, hashedPassword string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password)) == nil
}

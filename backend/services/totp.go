package services

import (
	"bytes"
	"encoding/base64"
	"image/png"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const totpIssuer = "WebApp"

// GenerateTOTPSetup creates a new TOTP secret for the user and returns the
// secret string and a base64-encoded PNG of the QR code for the authenticator app.
func GenerateTOTPSetup(email string) (secret string, qrBase64 string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      totpIssuer,
		AccountName: email,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return "", "", err
	}

	img, err := key.Image(200, 200)
	if err != nil {
		return "", "", err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", "", err
	}

	return key.Secret(), base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// ValidateTOTP used to live here, and is deliberately gone.
//
// It answered "does this code match?" and nothing else — no record that the code had been SPENT,
// which is exactly the hole AcceptTOTPCode (services/crypto_at_rest.go) now closes by identifying
// the time step and claiming it with a compare-and-set. Leaving a second, simpler function next to
// it would be leaving the replayable door open for the next person who only needs a yes or no.
//
// Both verify paths — enrolment confirm and sign-in — go through AcceptTOTPCode.

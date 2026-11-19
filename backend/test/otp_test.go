package unit

import (
	"testing"

	. "github.com/onsi/gomega"

	"github.com/asaskevich/govalidator"
	"network_automation/entity"
)

// ── OTP Entity ────────────────────────────────────────────────────────────────

func TestOTPValidInput(t *testing.T) {
	g := NewGomegaWithT(t)
	otp := entity.OTP{
		Email:     "user@got.co.th",
		Code:      "123456",
		ExpiresAt: 9999999999,
		Verified:  false,
		Attempts:  0,
	}
	ok, err := govalidator.ValidateStruct(otp)
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}

func TestOTPEmailRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	otp := entity.OTP{
		Email:     "",
		Code:      "123456",
		ExpiresAt: 9999999999,
	}
	ok, err := govalidator.ValidateStruct(otp)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("Email is required"))
}

func TestOTPEmailInvalidFormat(t *testing.T) {
	g := NewGomegaWithT(t)
	otp := entity.OTP{
		Email:     "not-an-email",
		Code:      "123456",
		ExpiresAt: 9999999999,
	}
	ok, err := govalidator.ValidateStruct(otp)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("Email is invalid"))
}

func TestOTPCodeRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	otp := entity.OTP{
		Email:     "user@got.co.th",
		Code:      "",
		ExpiresAt: 9999999999,
	}
	ok, err := govalidator.ValidateStruct(otp)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("Code is required"))
}

func TestOTPExpiresAtRequired(t *testing.T) {
	g := NewGomegaWithT(t)
	otp := entity.OTP{
		Email:     "user@got.co.th",
		Code:      "123456",
		ExpiresAt: 0,
	}
	ok, err := govalidator.ValidateStruct(otp)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("ExpiresAt is required"))
}

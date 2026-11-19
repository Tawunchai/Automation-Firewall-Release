package unit

import (
	"testing"

	. "github.com/onsi/gomega"

	"network_automation/services"
)

func policy(minLen int, upper, number, special bool) services.PasswordPolicy {
	return services.PasswordPolicy{
		MinLength:        minLen,
		RequireUppercase: upper,
		RequireNumber:    number,
		RequireSpecial:   special,
	}
}

func TestPasswordPolicyValidDefault(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("password1", policy(8, false, false, false))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyTooShort(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("abc", policy(8, false, false, false))
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("at least 8"))
}

func TestPasswordPolicyRequireUppercaseMissing(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("password1", policy(8, true, false, false))
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("uppercase"))
}

func TestPasswordPolicyRequireUppercasePresent(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("Password1", policy(8, true, false, false))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyRequireNumberMissing(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("Password!", policy(8, false, true, false))
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("number"))
}

func TestPasswordPolicyRequireNumberPresent(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("password1", policy(8, false, true, false))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyRequireSpecialMissing(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("Password1", policy(8, false, false, true))
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(ContainSubstring("special"))
}

func TestPasswordPolicyRequireSpecialPresent(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("Password1!", policy(8, false, false, true))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyAllRulesPass(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("Str0ng!Pass", policy(8, true, true, true))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyAllRulesFail(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("abc", policy(8, true, true, true))
	g.Expect(err).ToNot(BeNil())
}

func TestPasswordPolicyExactMinLength(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("12345678", policy(8, false, false, false))
	g.Expect(err).To(BeNil())
}

func TestPasswordPolicyBelowMinLength(t *testing.T) {
	g := NewGomegaWithT(t)
	err := services.ValidatePasswordPolicy("1234567", policy(8, false, false, false))
	g.Expect(err).ToNot(BeNil())
}

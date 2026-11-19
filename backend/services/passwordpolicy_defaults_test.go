package services

import (
	"strconv"
	"testing"
)

// policyFromDefaults builds a PasswordPolicy out of the fresh-install defaults WITHOUT a database,
// so what is asserted below is the policy a brand-new deployment actually enforces — not a
// restatement of the map.
func policyFromDefaults(t *testing.T) PasswordPolicy {
	t.Helper()
	cfg := DefaultPasswordPolicyConfig()
	atoi := func(key string) int {
		n, err := strconv.Atoi(cfg[key])
		if err != nil {
			t.Fatalf("default %s = %q, which is not a number: %v", key, cfg[key], err)
		}
		return n
	}
	return PasswordPolicy{
		MinLength:        atoi("password_min_length"),
		RequireUppercase: cfg["password_require_uppercase"] == "true",
		RequireNumber:    cfg["password_require_number"] == "true",
		RequireSpecial:   cfg["password_require_special"] == "true",
		ExpiryDays:       atoi("password_expiry_days"),
		HistoryCount:     atoi("password_history_count"),
	}
}

func TestDefaultPasswordPolicyIsNotJustLength8(t *testing.T) {
	p := policyFromDefaults(t)

	if p.MinLength < 12 {
		t.Errorf("default MinLength = %d, want at least 12", p.MinLength)
	}
	if !p.RequireUppercase {
		t.Error("default policy does not require an uppercase letter")
	}
	if !p.RequireNumber {
		t.Error("default policy does not require a number")
	}
	if !p.RequireSpecial {
		t.Error("default policy does not require a special character")
	}
	if p.HistoryCount < 2 {
		t.Errorf("default HistoryCount = %d, want more than one remembered password", p.HistoryCount)
	}
	if p.HistoryCount > MaxPasswordHistory {
		t.Errorf("default HistoryCount = %d exceeds MaxPasswordHistory %d", p.HistoryCount, MaxPasswordHistory)
	}
}

// The point of the defaults is which passwords they turn away. "12345678" is the one this project
// published in its own README, CONTRIBUTING.md, docker-compose.yml and seed, so it is the single most
// likely password on any deployment of it.
func TestDefaultPolicyRejectsThePublishedPasswords(t *testing.T) {
	p := policyFromDefaults(t)

	for _, pw := range []string{
		"12345678",     // the seeded login
		"password",     // length 8, no number, no upper, no special
		"Password1",    // length 9, no special
		"lowercase!12", // no uppercase
	} {
		if err := ValidatePasswordPolicy(pw, p); err == nil {
			t.Errorf("ValidatePasswordPolicy(%q) accepted it under the default policy", pw)
		}
	}

	if err := ValidatePasswordPolicy("Correct-Horse-7Battery", p); err != nil {
		t.Errorf("ValidatePasswordPolicy rejected a password that meets every default rule: %v", err)
	}
}

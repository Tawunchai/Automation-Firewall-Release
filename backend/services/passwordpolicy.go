package services

import (
	"errors"
	"fmt"
	"strconv"
	"unicode"

	"gorm.io/gorm"
	"network_automation/entity"
)

type PasswordPolicy struct {
	MinLength        int
	RequireUppercase bool
	RequireNumber    bool
	RequireSpecial   bool
	ExpiryDays       int
	// HistoryCount is how many of a user's previous passwords a new one may not repeat.
	// Always at least 1 — "reuse the password you just changed away from" is not a setting.
	HistoryCount int
}

// defaultPasswordPolicyConfig holds the system_configs values a FRESH install starts with.
//
// These are DEFAULTS, not the policy. getPolicyCfg reads the stored row first and only falls back
// here when the row is absent, and config.SeedDatabase creates each row only when it does not
// already exist — so an operator who has set a value, at /admin/password-policy or directly in the
// table, keeps it across this change.
//
// The previous defaults were length 8 with all three complexity rules off, which is not a policy:
// it accepted "12345678", which is exactly what this project's own seed and README handed out.
var defaultPasswordPolicyConfig = map[string]string{
	"password_min_length":        "12",
	"password_require_uppercase": "true",
	"password_require_number":    "true",
	"password_require_special":   "true",
	"password_expiry_days":       "0",
	"password_history_count":     "5",
}

// DefaultPasswordPolicyConfig returns a copy of the fresh-install defaults.
//
// config.SeedDatabase seeds the system_configs rows from this, so the seeded rows and the
// fallbacks used when a row is missing cannot drift apart — previously the same five values were
// written out twice, in two packages, and only one of them was the policy anyone saw.
func DefaultPasswordPolicyConfig() map[string]string {
	out := make(map[string]string, len(defaultPasswordPolicyConfig))
	for k, v := range defaultPasswordPolicyConfig {
		out[k] = v
	}
	return out
}

func policyDefault(key string) string { return defaultPasswordPolicyConfig[key] }

func policyDefaultInt(key string) int {
	n, _ := strconv.Atoi(defaultPasswordPolicyConfig[key])
	return n
}

func getPolicyCfg(db *gorm.DB, key, defaultVal string) string {
	var cfg entity.SystemConfig
	if err := db.Where("key = ?", key).First(&cfg).Error; err != nil {
		return defaultVal
	}
	return cfg.Value
}

func GetPasswordPolicy(db *gorm.DB) PasswordPolicy {
	minLen, _ := strconv.Atoi(getPolicyCfg(db, "password_min_length", policyDefault("password_min_length")))
	if minLen < 1 {
		minLen = policyDefaultInt("password_min_length")
	}
	expiryDays, _ := strconv.Atoi(getPolicyCfg(db, "password_expiry_days", policyDefault("password_expiry_days")))

	history, _ := strconv.Atoi(getPolicyCfg(db, "password_history_count", policyDefault("password_history_count")))
	if history < 1 {
		history = 1
	}
	if history > MaxPasswordHistory {
		history = MaxPasswordHistory
	}

	return PasswordPolicy{
		MinLength:        minLen,
		RequireUppercase: getPolicyCfg(db, "password_require_uppercase", policyDefault("password_require_uppercase")) == "true",
		RequireNumber:    getPolicyCfg(db, "password_require_number", policyDefault("password_require_number")) == "true",
		RequireSpecial:   getPolicyCfg(db, "password_require_special", policyDefault("password_require_special")) == "true",
		ExpiryDays:       expiryDays,
		HistoryCount:     history,
	}
}

func ValidatePasswordPolicy(password string, policy PasswordPolicy) error {
	if len(password) < policy.MinLength {
		return fmt.Errorf("password must be at least %d characters", policy.MinLength)
	}

	if policy.RequireUppercase {
		found := false
		for _, r := range password {
			if unicode.IsUpper(r) {
				found = true
				break
			}
		}
		if !found {
			return errors.New("password must contain at least one uppercase letter")
		}
	}

	if policy.RequireNumber {
		found := false
		for _, r := range password {
			if unicode.IsDigit(r) {
				found = true
				break
			}
		}
		if !found {
			return errors.New("password must contain at least one number")
		}
	}

	if policy.RequireSpecial {
		found := false
		for _, r := range password {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
				found = true
				break
			}
		}
		if !found {
			return errors.New("password must contain at least one special character")
		}
	}

	return nil
}

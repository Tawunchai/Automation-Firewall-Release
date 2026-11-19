package entity

import "gorm.io/gorm"

// UserTOTP stores the TOTP authenticator configuration for a user.
// Secret is never returned to the client after setup — only the QR image is shown once.
// IsEnabled lets users pause TOTP without losing their setup (secret stays intact).
//
// Secret is stored ENCRYPTED (AES-256-GCM, the versioned "vN:" format from services/crypto.go).
// Read it through services.TOTPSecret and write it through services.SetTOTPSecret — never touch
// the field directly, or a seed enrolled before this change will be handed to the validator still
// wrapped, or a new one will be written in the clear. The accessors live in services because
// entity may not import it.
type UserTOTP struct {
	gorm.Model
	AppUserID  uint     `gorm:"uniqueIndex;not null" json:"app_user_id"`
	AppUser    *AppUser `gorm:"foreignKey:AppUserID" json:"-"`
	Secret     string   `gorm:"not null" json:"-"`
	IsVerified bool     `gorm:"default:false" json:"is_verified"`
	IsEnabled  bool     `gorm:"default:true" json:"is_enabled"`

	// LastTOTPStep is the TOTP time step (unix seconds / 30) of the most recently accepted code.
	//
	// A code stays valid for its own step plus one either side — about 90 seconds — and nothing
	// recorded that it had been spent, so an intercepted code worked a second time. A verifier
	// refuses any step at or below this one, which is what RFC 6238 §5.2 asks for.
	//
	// Persisted rather than kept in memory so it survives a restart and is shared by every backend
	// replica. 0 means "no code has been accepted yet" — step 0 is 1970, so it is a safe sentinel.
	//
	// WRITE IT WITH AN EXPLICIT COLUMN (db.Model(&row).Update("last_totp_step", step)). GORM omits
	// zero-value fields from an INSERT/Save when the field carries a `default` tag, and the default
	// then wins — this repo has been bitten by that twice.
	LastTOTPStep int64 `gorm:"column:last_totp_step;not null;default:0" json:"-"`
}

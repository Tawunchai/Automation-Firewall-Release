package entity

import "gorm.io/gorm"

type SendEmail struct {
	gorm.Model

	Email string `json:"email" valid:"required~Email is required,email~Email is invalid"`
	// PassAppEnc holds services.EncryptSecret(app password) — "Enc" suffix is this repo's
	// convention for an encrypted-at-rest column (see NetworkDevice.PasswordEnc,
	// DeviceCredential.PasswordEnc, NotifyChannel.SecretEnc) and is what lets
	// TestRotationCoversEveryEncryptedColumn find it automatically. Column name is pinned to the
	// pre-existing "pass_app" rather than left to GORM's naming convention, which would otherwise
	// derive "pass_app_enc" and silently orphan every row already stored under "pass_app".
	PassAppEnc       string `json:"pass_app" gorm:"column:pass_app" valid:"required~PassApp is required"`
	TwoFactorEnabled bool   `gorm:"default:false" json:"two_factor_enabled" valid:"-"`

	AppUserID uint     `json:"app_user_id" valid:"-"`
	AppUser   *AppUser `gorm:"foreignKey:AppUserID" valid:"-"`
}

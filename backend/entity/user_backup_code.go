package entity

import (
	"time"

	"gorm.io/gorm"
)

// UserBackupCode stores single-use recovery codes for TOTP login.
// Each code is hashed with bcrypt and invalidated after one use.
type UserBackupCode struct {
	gorm.Model
	AppUserID uint       `gorm:"not null;index" json:"app_user_id"`
	CodeHash  string     `gorm:"not null" json:"-"`
	UsedAt    *time.Time `json:"used_at"`
}

package entity

import "gorm.io/gorm"

// PasswordHistory stores the most recent hashed password for each user.
// Only the last password is kept — used to prevent immediate reuse.
type PasswordHistory struct {
	gorm.Model
	AppUserID uint     `gorm:"not null;uniqueIndex" json:"app_user_id"`
	Password  string   `gorm:"not null" json:"-"`
	AppUser   *AppUser `gorm:"foreignKey:AppUserID" json:"-"`
}

package entity

import "gorm.io/gorm"

type ActivityLog struct {
	gorm.Model
	AppUserID uint     `gorm:"not null;index"`
	Action    string   `gorm:"not null"` // "login" | "logout" | "password_change"
	AppUser   *AppUser `gorm:"foreignKey:AppUserID"`
}

package entity

import (
	"time"

	"gorm.io/gorm"
)

type UserSession struct {
	gorm.Model
	AppUserID uint      `gorm:"not null;index"`
	TokenHash string    `gorm:"not null;uniqueIndex;size:64"`
	IPAddress string    `gorm:"size:64"`
	UserAgent string    `gorm:"type:text"`
	LastSeen  time.Time `gorm:"not null"`
	IsRevoked bool      `gorm:"default:false;index"`
	AppUser   *AppUser  `gorm:"foreignKey:AppUserID"`
}

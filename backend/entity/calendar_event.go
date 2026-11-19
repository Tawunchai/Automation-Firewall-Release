package entity

import (
	"time"

	"gorm.io/gorm"
)

type CalendarEvent struct {
	gorm.Model
	Title       string    `gorm:"not null" valid:"required~Title is required,stringlength(1|255)~Title must be between 1 and 255 characters"`
	Description string    `valid:"-"`
	StartDate   time.Time `gorm:"not null" valid:"required~StartDate is required"`
	EndDate     time.Time `gorm:"not null" valid:"required~EndDate is required"`
	AllDay      bool      `gorm:"default:false" valid:"-"`
	Category    string    `gorm:"not null;default:'calendar'" valid:"required~Category is required,in(calendar|birthday|holiday|office|other|festival|timeline)~Invalid category"`
	Color       string    `gorm:"default:'#7C3AED'" valid:"-"`
	AppUserID   uint      `gorm:"not null;index" valid:"required~AppUserID is required"`
	AppUser     *AppUser  `gorm:"foreignKey:AppUserID" valid:"-"`
}

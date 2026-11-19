package entity

import "gorm.io/gorm"

type OTP struct {
	gorm.Model
	Email     string `json:"email"      gorm:"index"       valid:"required~Email is required,email~Email is invalid"`
	Code      string `json:"code"                           valid:"required~Code is required"`
	ExpiresAt int64  `json:"expires_at"                     valid:"required~ExpiresAt is required"`
	Verified  bool   `json:"verified"                       valid:"-"`
	Attempts  int    `json:"attempts"   gorm:"default:0"    valid:"-"`
}

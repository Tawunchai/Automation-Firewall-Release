package entity

import (
	"time"

	"gorm.io/gorm"
)

type Backup struct {
	gorm.Model
	OriginalID uint   `json:"original_id" gorm:"index"`
	Email      string `json:"email"`
	// The deleted account's bcrypt hash, kept so Restore can put the account back exactly as it
	// was — never serialised. It used to go out as "password" on every Recycle Bin response:
	// an offline cracking target handed to the browser, for an account nobody is watching any
	// more. Every other secret in this schema already carries this tag.
	Password    string     `json:"-"`
	FirstName   string     `json:"first_name"`
	LastName    string     `json:"last_name"`
	Profile     string     `json:"profile" gorm:"type:text"`
	PhoneNumber string     `json:"phone_number"`
	Location    string     `json:"location"`
	Position    string     `json:"position"`
	RoleName    string     `json:"role_name"`
	AppRoleID   uint       `json:"app_role_id"`
	DeletedByID uint       `json:"deleted_by_id"`
	RestoredAt  *time.Time `json:"restored_at"`
}

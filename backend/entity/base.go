package entity

import (
	"time"

	"gorm.io/gorm"
)

// Base replaces gorm.Model with proper json tags so "id" (lowercase) is
// returned in API responses. gorm.Model has no json tags, causing ID to
// serialize as "ID" which breaks frontend lookups of request.id.
type Base struct {
	ID        uint           `gorm:"primarykey;autoIncrement" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index"                   json:"-"`
}

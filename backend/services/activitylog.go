package services

import (
	"gorm.io/gorm"
	"network_automation/entity"
)

func LogActivity(db *gorm.DB, userID uint, action string) {
	db.Create(&entity.ActivityLog{
		AppUserID: userID,
		Action:    action,
	})
}

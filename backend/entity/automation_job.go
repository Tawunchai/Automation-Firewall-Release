package entity

import "time"

// AutomationJob = งาน automation 1 ครั้ง (backup / deploy / audit ...)
// บันทึกลง DB จริงทุกครั้ง — frontend poll สถานะจากตรงนี้
// (จุดที่ระบบเดิม Example_Network_Automation ขาด: ไม่เคยเขียน job ลง DB)
type AutomationJob struct {
	Base
	Type            string     `gorm:"not null;index" json:"type"`   // backup | deploy | audit ...
	Status          string     `gorm:"not null;index" json:"status"` // QUEUED | RUNNING | SUCCESS | FAILED
	NetworkDeviceID uint       `gorm:"index" json:"network_device_id"`
	TriggeredBy     string     `json:"triggered_by"`            // email ของผู้สั่งงาน
	Result          string     `gorm:"type:text" json:"result"` // ข้อความสรุป/error
	StartedAt       *time.Time `json:"started_at"`
	FinishedAt      *time.Time `json:"finished_at"`

	NetworkDevice *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"device,omitempty"`
}

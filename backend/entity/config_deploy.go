package entity

import "time"

// ConfigDeploy = การสั่ง push config 1 ครั้ง ไปยังอุปกรณ์ "หลายตัวพร้อมกัน" (งานแม่)
//
// MIGRATION NOTE: ฟิลด์ ApprovalStatus/ApprovedBy/ApprovedAt (approval workflow) ถูกถอดออกแล้ว
// คอลัมน์เดิมในฐานข้อมูล (ถ้ามี) จะเหลืออยู่แบบ unused — GORM AutoMigrate ไม่ลบคอลัมน์ให้อัตโนมัติ
// 1 ConfigDeploy → หลาย ConfigDeployResult (งานลูก, ผลรายอุปกรณ์)
//
// flow:
//
//	user เลือกหลาย device + กรอก CLI lines → สร้าง ConfigDeploy(QUEUED) + ลูกต่อ device
//	→ enqueue 1 ข้อความเข้า Redis (queue 'automation:config')
//	→ worker หยิบไป fan-out ยิงขนานด้วย ThreadPoolExecutor
//	→ รายงานผล "รายอุปกรณ์" กลับ → backend รวมสถานะแม่อัตโนมัติ
type ConfigDeploy struct {
	Base
	CommandText  string `gorm:"type:text;not null" json:"command_text"` // CLI lines ที่จะส่ง (ผู้ใช้กรอก)
	Mode         string `gorm:"default:'config';index" json:"mode"`     // config = push/rollback (เขียนอุปกรณ์) | query = อ่านอย่างเดียว (get/show/diagnose)
	Status       string `gorm:"index;not null" json:"status"`           // QUEUED|RUNNING|SUCCESS|FAILED|PARTIAL
	TriggeredBy  string `json:"triggered_by"`                           // email ผู้สั่ง
	TotalDevices int    `json:"total_devices"`
	SuccessCount int    `json:"success_count"`
	FailedCount  int    `json:"failed_count"`

	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`

	Results []ConfigDeployResult `gorm:"foreignKey:ConfigDeployID" json:"results,omitempty"`
}

// ConfigDeployResult = ผลการ push config ของ "1 อุปกรณ์" ภายใน 1 ConfigDeploy (งานลูก)
type ConfigDeployResult struct {
	Base
	ConfigDeployID  uint   `gorm:"index;not null" json:"config_deploy_id"`
	NetworkDeviceID uint   `gorm:"index" json:"network_device_id"`
	DeviceName      string `json:"device_name"`                  // snapshot ชื่อ ณ เวลาสั่ง
	Status          string `gorm:"index;not null" json:"status"` // QUEUED|RUNNING|SUCCESS|FAILED
	Output          string `gorm:"type:text" json:"output"`      // output จากอุปกรณ์ (สำเร็จ)
	Error           string `gorm:"type:text" json:"error"`       // ข้อความ error (ล้มเหลว)

	// ── เฟส 3: diff/preview + rollback point ──────────────────────────────────
	Diff           string `gorm:"type:text" json:"diff"`         // unified diff ของ config ก่อน→หลัง push
	Changed        bool   `json:"changed"`                       // apply แล้ว config เปลี่ยนจริงไหม
	BeforeBackupID uint   `gorm:"index" json:"before_backup_id"` // ConfigBackup ของ config "ก่อน push" = จุด rollback

	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

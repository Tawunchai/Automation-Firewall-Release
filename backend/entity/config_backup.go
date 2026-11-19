package entity

// ConfigBackup = metadata + เนื้อ config ของ backup 1 ครั้ง
// เก็บ Content ลง DB ด้วย เพื่อให้หน้าเว็บ "ดู / ดาวน์โหลด" ได้
//
// Content is stored ENCRYPTED (AES-256-GCM, the versioned "vN:" format from services/crypto.go):
// it is the device's entire `show full-configuration`, which carries IPsec pre-shared keys, SNMP
// communities, RADIUS secrets and administrator password hashes — everything the encrypted
// password_enc column of the SAME device row was already protecting.
//
// Read it through services.BackupContent and write it through services.SetBackupContent. Never
// read the field directly: rows taken before this change are plaintext, the accessor is what knows
// both forms, and a configuration restore that received a still-encrypted (or empty) string would
// brick the firewall. The accessors live in services because entity may not import it.
type ConfigBackup struct {
	Base
	NetworkDeviceID uint   `gorm:"index;not null" json:"network_device_id"`
	AutomationJobID uint   `gorm:"index" json:"automation_job_id"`
	GitCommit       string `json:"git_commit"`
	Sha256          string `json:"sha256"`
	Path            string `json:"path"`
	SizeBytes       int    `json:"size_bytes"`
	Lines           int    `json:"lines"`
	DiffSummary     string `gorm:"type:text" json:"diff_summary"` // "+N/-N lines\n<unified diff>" เทียบกับ backup ก่อนหน้า
	Content         string `gorm:"type:text" json:"-"`            // เนื้อ config เต็ม (เข้ารหัสไว้) — ดึงผ่าน services.BackupContent
}

package entity

import "time"

// NetworkDevice = อุปกรณ์เครือข่ายที่ระบบจัดการ (Firewall / Switch / Router)
// credential (username/password) เก็บแบบเข้ารหัส AES-GCM ไม่ใช่ plaintext
// — ดู services/crypto.go (EncryptSecret/DecryptSecret)
type NetworkDevice struct {
	Base
	Name     string `gorm:"not null;index" json:"name"`             // ชื่ออุปกรณ์ เช่น FortiGate-80E
	Vendor   string `gorm:"not null" json:"vendor"`                 // fortinet | cisco | juniper ...
	Platform string `gorm:"not null" json:"platform"`               // netmiko device_type เช่น fortinet, cisco_ios
	MgmtIP   string `gorm:"column:mgmt_ip;not null" json:"mgmt_ip"` // IP ที่ใช้ SSH เข้า
	Port     int    `gorm:"default:22" json:"port"`                 // SSH port
	// APIPort = port ที่ FortiGate admin HTTPS/REST API ฟังอยู่ (ไม่ใช่ SSH port ด้านบน)
	// ปกติคือ 443 แต่หลายหน่วยงานย้าย admin GUI ไป port อื่นเพื่อความปลอดภัย (เช่น 13361) — ถ้า hardcode
	// services.DefaultAPIPort (443) ไว้ทุกที่ อุปกรณ์แบบนี้จะ login ไม่ติดเลยไม่ว่ารหัสผ่านจะถูกแค่ไหน
	APIPort int    `gorm:"column:api_port;default:443" json:"api_port"`
	Site    string `json:"site"`                           // สถานที่/สาขา (optional)
	Role    string `json:"role"`                           // firewall | core-switch ... (optional)
	Status  string `gorm:"default:'active'" json:"status"` // active | inactive | maintenance

	// ── บัญชีที่ใช้เข้าอุปกรณ์ ────────────────────────────────────────────────
	//
	// สองช่องนี้คือ credential "ของกลาง" แบบเดิม **ฟอร์ม Devices ไม่ถามมันแล้ว** — คนที่กดปุ่มเข้า
	// อุปกรณ์ด้วยบัญชีของตัวเอง (Profile ▸ Device Credentials, ดู [DeviceCredential]) และงาน
	// เบื้องหลังใช้ AutomationCredentialID ข้างล่าง
	//
	// ยังไม่ลบทิ้ง เพราะอุปกรณ์ที่ถูกเพิ่มไว้ก่อนการเปลี่ยนนี้เก็บบัญชีไว้ตรงนี้ และมันคือทางเดียวที่
	// auto backup ของอุปกรณ์เหล่านั้นยังทำงานต่อได้จนกว่าจะมีคนเสนอบัญชีให้ (ดู
	// services.ResolveAutomationLogin ข้อ 2) อุปกรณ์ที่เพิ่มใหม่จะปล่อยว่างไว้
	//
	// ไม่ส่งออก JSON เด็ดขาด (json:"-")
	Username    string `json:"-"`
	PasswordEnc string `gorm:"type:text" json:"-"` // AES-GCM ciphertext (base64)

	// AutomationCredentialID = แถวใน device_credentials ที่งาน "ไม่มีคนกด" จะใช้ล็อกอิน
	// (auto backup / compliance / sweep แจ้งเตือน) 0 = ยังไม่มีใครเสนอบัญชีให้
	//
	// เก็บเป็น **ตัวชี้ ไม่ใช่สำเนา** โดยตั้งใจ: รหัสผ่านมีอยู่ที่เดียวคือแถว credential ของเจ้าของ
	// เจ้าของเปลี่ยนรหัสผ่านเมื่อไหร่ งานเบื้องหลังตามไปเองทันที และไม่มีสำเนาที่ค่อย ๆ เก่าจนพัง
	// ตอนตีสาม ตั้งค่าที่ Profile ▸ Device Credentials ("use for scheduled work")
	AutomationCredentialID uint `gorm:"index" json:"automation_credential_id"`

	// ── Scheduled backup (auto) ───────────────────────────────────────────────
	BackupEnabled bool       `gorm:"default:false" json:"backup_enabled"` // เปิด auto backup
	BackupCron    string     `json:"backup_cron"`                         // cron spec เช่น "0 2 * * *"
	NextBackupAt  *time.Time `gorm:"index" json:"next_backup_at"`         // เวลารันรอบถัดไป (scheduler ใช้)
	LastBackupAt  *time.Time `json:"last_backup_at"`                      // เวลา backup สำเร็จล่าสุด

	// has-many: ประวัติ backup ของอุปกรณ์นี้
	ConfigBackups []ConfigBackup `gorm:"foreignKey:NetworkDeviceID" json:"-"`
}

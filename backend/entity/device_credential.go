package entity

import "time"

// DeviceCredential = บัญชีของ "คนคนหนึ่ง" บนอุปกรณ์ "ตัวหนึ่ง"
//
// ── ทำไมต้องมีตารางนี้ ───────────────────────────────────────────────────────
// เดิมทั้งระบบเข้า FortiGate ด้วย credential ตัวเดียวที่เก็บไว้บน NetworkDevice (ปกติคือ `admin`)
// ผลคือ log ฝั่งอุปกรณ์ — event log, `diagnose sys admin list`, ช่อง "Administrator" บน dashboard —
// บอกได้แค่ว่า "admin ทำ" ทั้งที่คนกดจริงอาจเป็นใครก็ได้ในบรรดาผู้ใช้ของคอนโซล
//
// แถวในตารางนี้คือการผูก "ผู้ใช้คอนโซล 1 คน ↔ อุปกรณ์ 1 ตัว ↔ บัญชีบนอุปกรณ์ของเขาเอง"
// เมื่อผูกไว้แล้ว ทุกการกระทำที่ "คนคนนั้นสั่ง" จะล็อกอินเข้าอุปกรณ์ด้วยบัญชีของเขา ไม่ใช่ของกลาง
// ตัวอุปกรณ์จึงบันทึกชื่อจริงของคนที่ทำ และเราไล่ย้อนได้ว่าใครเข้าไปแตะอะไร
//
// ไม่มีแถว = ตกกลับไปใช้ credential ของกลางบน NetworkDevice เหมือนเดิม (ระบบไม่พังถ้าไม่มีใครผูก)
//
// ── ขอบเขต: เฉพาะสิ่งที่ "ผู้ใช้สั่งเอง" ──────────────────────────────────────
// งานเบื้องหลัง (auto backup / compliance / scheduler) ยังใช้ credential ของกลางเสมอ — งานพวกนั้น
// ไม่มี "คน" อยู่เบื้องหลัง การไปยืมบัญชีของใครสักคนมารันจะทำให้ log โกหกยิ่งกว่าเดิม
type DeviceCredential struct {
	Base

	// เจ้าของ + อุปกรณ์ = คีย์ธรรมชาติของแถวนี้ ผูกได้บัญชีเดียวต่ออุปกรณ์ต่อคน
	//
	// ⚠️ uniqueIndex ตัวนี้ **ไม่รวม deleted_at** แปลว่าแถวที่ถูก soft delete ยังจองคู่ (user, device)
	// อยู่ และการผูกใหม่จะชน 23505 ตัวลบจึงต้องเป็น hard delete (`Unscoped().Delete`) เสมอ —
	// ดู devicecredential.Delete ซึ่งทำแบบนั้นและมีเทสคุมไว้
	AppUserID       uint `gorm:"not null;uniqueIndex:idx_device_cred_owner,priority:1" json:"app_user_id"`
	NetworkDeviceID uint `gorm:"not null;uniqueIndex:idx_device_cred_owner,priority:2" json:"network_device_id"`

	// Username = ชื่อผู้ใช้ "บนอุปกรณ์" (บัญชี admin ของ FortiGate) ไม่ใช่อีเมลที่ล็อกอินคอนโซล
	Username string `gorm:"not null" json:"username"`

	// PasswordEnc = AES-256-GCM ciphertext แบบเดียวกับ NetworkDevice.PasswordEnc
	// (services.EncryptSecret/DecryptSecret รองรับ key rotation) — ห้ามส่งออก JSON เด็ดขาด
	PasswordEnc string `gorm:"type:text" json:"-"`

	// LastUsedAt = ครั้งล่าสุดที่ credential นี้ถูกใช้ล็อกอินเข้าอุปกรณ์จริง
	// เขียนแบบหน่วง (ดู services.TouchDeviceCredential) — ทุก request ที่คุยกับอุปกรณ์ไม่ควรกลายเป็น
	// UPDATE หนึ่งครั้ง
	LastUsedAt *time.Time `json:"last_used_at"`

	// ผลการกดปุ่ม "ทดสอบ" ครั้งล่าสุด
	//
	// เก็บไว้เพราะ credential ที่ผิดจะไม่แสดงอาการตอนบันทึก แต่จะไปพังตอนเปิดหน้า Firewall Policy
	// ในอีกสามวัน — และเนื่องจากอุปกรณ์ล็อกบัญชีหลังล็อกอินพลาด 3 ครั้ง ความผิดนั้นแพงกว่าปกติ
	LastTestedAt   *time.Time `json:"last_tested_at"`
	LastTestStatus string     `json:"last_test_status"` // "" (ยังไม่เคยทดสอบ) | ok | fail
	LastTestError  string     `gorm:"type:text" json:"last_test_error"`

	AppUser       AppUser       `gorm:"foreignKey:AppUserID"       json:"-"`
	NetworkDevice NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"-"`
}

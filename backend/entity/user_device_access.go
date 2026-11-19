package entity

// UserDeviceAccess = "this console user may work on this firewall".
//
// ── ทำไมต้องมีตารางนี้ ───────────────────────────────────────────────────────
// เดิมผู้ใช้คอนโซลทุกคน "เห็นและแตะได้ทุกอุปกรณ์" ในคลัง — /devices คืนทั้งหมด และ
// /policy/device/:id/… รับ id อะไรก็ได้ที่มีอยู่จริง สิทธิ์เดียวที่มีคือ admin กับ user
// ซึ่งแยกว่า "ทำอะไรได้" ไม่ได้แยกว่า "ทำกับเครื่องไหนได้"
//
// แถวในตารางนี้คือการมอบสิทธิ์: admin เลือกว่าผู้ใช้คนนี้เข้าถึง firewall ตัวไหนได้บ้าง
// จากนั้นผู้ใช้ค่อยไปผูก **บัญชีบนอุปกรณ์ของตัวเอง** ที่ Profile ▸ Device Credentials
// (ดู [DeviceCredential]) — สองชั้นนี้คนละเรื่องกันและต้องมีครบทั้งคู่ถึงจะได้ประโยชน์เต็ม:
//
//	UserDeviceAccess  = "เข้าถึงเครื่องนี้ได้ไหม"        (admin เป็นคนให้)
//	DeviceCredential  = "เข้าไปในนามของใคร"             (เจ้าตัวเป็นคนใส่)
//
// ── ขอบเขตการบังคับใช้ ──────────────────────────────────────────────────────
// admin ข้ามการตรวจนี้เสมอ (ดู services.UserCanAccessDevice) — คนที่เพิ่มอุปกรณ์เข้าคลังได้
// ย่อมเข้าถึงมันได้อยู่แล้ว การกันตัวเองออกจากอุปกรณ์ที่ตัวเองเพิ่มไม่ได้ให้ความปลอดภัยอะไร
// มีแต่จะทำให้ระบบล็อกตัวเอง
//
// ⚠️ uniqueIndex ตัวนี้ **ไม่รวม deleted_at** เหมือน DeviceCredential — แถวที่ถูก soft delete
// ยังจองคู่ (user, device) อยู่ การถอนสิทธิ์จึงต้องเป็น hard delete (`Unscoped().Delete`)
// เสมอ ไม่งั้นมอบสิทธิ์ซ้ำจะชน 23505 โดยที่หน้าจออธิบายไม่ได้
type UserDeviceAccess struct {
	Base

	AppUserID       uint `gorm:"not null;uniqueIndex:idx_user_device_access,priority:1" json:"app_user_id"`
	NetworkDeviceID uint `gorm:"not null;uniqueIndex:idx_user_device_access,priority:2" json:"network_device_id"`

	// GrantedByID = admin ที่กดให้สิทธิ์ เก็บไว้เพื่อตอบคำถาม "ใครเปิดให้เขาเข้าเครื่องนี้"
	// 0 = มาจาก migration ตอนอัปเกรด (ดู config.SeedDeviceAccess)
	GrantedByID uint   `json:"granted_by_id"`
	Note        string `json:"note"`

	AppUser       AppUser       `gorm:"foreignKey:AppUserID"       json:"-"`
	NetworkDevice NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"-"`
}

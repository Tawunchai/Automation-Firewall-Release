package entity

import (
	"time"

	"gorm.io/gorm"
)

type AppUser struct {
	gorm.Model
	// No `uniqueIndex` tag here on purpose — the real constraint is a PARTIAL unique index
	// (`idx_app_users_email ... WHERE deleted_at IS NULL`, created in config/db.go's
	// fixAppUserEmailUniqueIndex) that a plain `uniqueIndex` tag cannot express. A soft-deleted row
	// keeps its email, so a plain unique index on this column blocks both Recycle Bin's Restore and
	// a brand-new signup from ever reusing a deleted address — found live as a 100%-reproducible
	// 500 on every Restore attempt.
	Email string `gorm:"not null" valid:"required~Email is required,email~Email is invalid"`
	// ความยาวขั้นต่ำไม่ได้ตรึงไว้ที่ 8 อีกแล้ว — **Password Policy คือเจ้าของกฎเพียงคนเดียว**
	// (services.ValidatePasswordPolicy) ถ้าฝังเลข 8 ไว้ตรงนี้ด้วย การตั้ง min_length เป็น 6
	// ที่หน้า /admin/password-policy จะไม่มีผลจริง แล้วผู้ใช้จะเจอ error ที่ไม่ตรงกับกฎที่หน้าจอบอก
	// json:"-" because this struct has no json tags at all: anything that marshals an AppUser
	// directly would emit the bcrypt hash under "Password". The handlers all answer through
	// services.MapUserResponse today, which is the reason this has never leaked — but a DTO is
	// a convention and this is the field refusing to leave the process.
	Password  string `json:"-" valid:"required~Password is required"`
	FirstName string `valid:"required~FirstName is required"`
	LastName  string `valid:"required~LastName is required"`
	Profile   string `gorm:"type:text" valid:"-"` // avatar image URL — optional (uploaded separately, defaults empty)
	// สามช่องนี้เป็นข้อมูลโปรไฟล์เสริม ไม่ใช่ข้อมูลที่ต้องมีตั้งแต่วันแรก:
	// ฟอร์มสร้างผู้ใช้ (admin) เก็บแค่ ชื่อ/นามสกุล/อีเมล/รหัสผ่าน/role ตามที่ออกแบบไว้
	// การบังคับ required ตรงนี้ทำให้ **สร้างผู้ใช้จากหน้าเว็บไม่สำเร็จเลยสักครั้ง**
	// (400 PhoneNumber/Location/Position failed on the 'required' tag) — เติมทีหลังได้ที่หน้า Edit
	PhoneNumber       string      `valid:"-"`
	Location          string      `valid:"-"`
	Position          string      `valid:"-"`
	AuthProvider      string      `gorm:"default:'local'" valid:"-"`
	ProviderID        string      `valid:"-"`
	PasswordChangedAt *time.Time  `valid:"-"`
	SendEmail         []SendEmail `gorm:"foreignKey:AppUserID" valid:"-"`
	ThemeMode         string      `gorm:"default:'System'" valid:"-"`
	ThemeColor        string      `gorm:"default:'#F97316'" valid:"-"`

	AppRoleID uint     `valid:"required~AppRoleID is required"`
	AppRole   *AppRole `gorm:"foreignKey:AppRoleID" valid:"-"`
}

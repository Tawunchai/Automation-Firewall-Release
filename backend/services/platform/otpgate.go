package platform

import (
	"network_automation/entity"

	"gorm.io/gorm"
)

// OTP master switch + per-flow triggers.
//
// หน้า /admin/service มีสวิตช์ใหญ่ "Two-Step Verification" อยู่ข้างบน แล้วมีรายการ
// "OTP Trigger Settings" อยู่ข้างล่าง — ถ้าสวิตช์ใหญ่เป็นแค่การ **เทาปุ่มบนหน้าจอ**
// แต่ server ยังอ่านค่ารายตัวตรงไปตรงมา สวิตช์นั้นก็โกหก: ผู้ใช้ปิด Two-Step แล้ว
// ระบบยังส่ง OTP ตอน reset password อยู่ดี (สภาพที่เห็นในหน้าจอจริงก่อนแก้ —
// หัวข้อเขียนว่า "Email OTP verification is disabled" แต่ Reset Password OTP ติด ON)
//
// กฎเดียวของไฟล์นี้: **สวิตช์ใหญ่ปิด = ทุก flow ที่ใช้ email OTP ปิดหมด** และทุกที่
// ในระบบที่ตัดสินใจเรื่อง OTP ต้องถามผ่าน gate ตัวนี้ ห้ามอ่าน key ตรง ๆ อีก

const (
	CfgTwoStepEnabled = "two_step_enabled" // สวิตช์ใหญ่ของ email OTP ทั้งระบบ
	CfgResetOTP       = "reset_otp_enabled"
)

// OTPGate = ค่าดิบจากฐานข้อมูล ยังไม่ผ่านกฎของสวิตช์ใหญ่
type OTPGate struct {
	TwoStep  bool // สวิตช์ใหญ่
	LoginOTP bool // SendEmail.two_factor_enabled
	ResetOTP bool // system_configs["reset_otp_enabled"]
}

// effectiveOTPFlows ใช้กฎของสวิตช์ใหญ่กับค่ารายตัว
//
// แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสได้โดยไม่ต้องมีฐานข้อมูล — นี่คือกฎความปลอดภัย
// ที่ต้องเหมือนกันทุกจุดเรียกใช้ ถ้ามันเพี้ยนที่จุดใดจุดหนึ่ง ผลคือ "ปิดแล้วแต่ยังส่ง OTP"
// หรือแย่กว่านั้นคือ "เปิดแล้วแต่ไม่ส่ง"
func effectiveOTPFlows(twoStep, loginOTP, resetOTP bool) (login, reset bool) {
	if !twoStep {
		return false, false
	}
	return loginOTP, resetOTP
}

// LoginOTPActive — ต้องส่ง OTP ทางอีเมลตอน login ไหม
func (g OTPGate) LoginOTPActive() bool {
	login, _ := effectiveOTPFlows(g.TwoStep, g.LoginOTP, g.ResetOTP)
	return login
}

// ResetOTPActive — ต้องยืนยัน OTP ตอน reset password ไหม
//
// ค่านี้ยังคุมทางกลับด้วย: `ResetPasswordDirect` อนุญาตให้ตั้งรหัสใหม่โดยไม่ต้องมี OTP
// **เฉพาะตอนที่ reset OTP ปิด** ถ้าสวิตช์ใหญ่ปิดแล้วแต่จุดนั้นยังอ่าน key ดิบอยู่
// ทั้งสองทางจะถูกปิดพร้อมกัน = ไม่มีใครรีเซ็ตรหัสผ่านได้เลย
func (g OTPGate) ResetOTPActive() bool {
	_, reset := effectiveOTPFlows(g.TwoStep, g.LoginOTP, g.ResetOTP)
	return reset
}

// LoadOTPGate อ่านสถานะทั้งสามจากฐานข้อมูล
func LoadOTPGate(db *gorm.DB) OTPGate {
	g := OTPGate{
		TwoStep:  ReadSystemConfigBool(db, CfgTwoStepEnabled, true),
		ResetOTP: ReadSystemConfigBool(db, CfgResetOTP, true),
	}
	var se entity.SendEmail
	if db.First(&se).Error == nil {
		g.LoginOTP = se.TwoFactorEnabled
	}
	return g
}

// ReadSystemConfigBool — helper กลางสำหรับ system_configs ที่เก็บ "true"/"false"
func ReadSystemConfigBool(db *gorm.DB, key string, def bool) bool {
	var cfg entity.SystemConfig
	if db.Where("key = ?", key).First(&cfg).Error != nil {
		return def
	}
	return cfg.Value == "true"
}

// WriteSystemConfigBool — upsert ค่า bool ลง system_configs
func WriteSystemConfigBool(db *gorm.DB, key string, value bool) {
	val := "false"
	if value {
		val = "true"
	}
	var cfg entity.SystemConfig
	if db.Where("key = ?", key).First(&cfg).Error != nil {
		db.Create(&entity.SystemConfig{Key: key, Value: val})
		return
	}
	db.Model(&cfg).Update("value", val)
}

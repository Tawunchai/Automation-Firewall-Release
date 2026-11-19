package otp

import (
	"net/http"

	"network_automation/config"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

// GET /security-config — สถานะสวิตช์ใหญ่ + trigger รายตัว (admin เท่านั้น)
//
// คืนทั้งค่าดิบ (login_2fa / reset_otp) และค่าที่มีผลจริงหลังผ่านสวิตช์ใหญ่
// (login_2fa_effective / reset_otp_effective) เพื่อให้หน้าเว็บแสดง checkbox ที่ผู้ใช้
// ตั้งไว้ได้ตามเดิม โดยไม่ต้องเดาเองว่าตอนนี้ flow ไหน "ทำงานอยู่จริง"
func GetSecurityConfig(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	g := platform.LoadOTPGate(config.DB())

	c.JSON(http.StatusOK, gin.H{
		"two_step":            g.TwoStep,
		"login_2fa":           g.LoginOTP,
		"reset_otp":           g.ResetOTP,
		"login_2fa_effective": g.LoginOTPActive(),
		"reset_otp_effective": g.ResetOTPActive(),
	})
}

// PATCH /toggle-two-step — สวิตช์ใหญ่ของ email OTP ทั้งระบบ (admin เท่านั้น)
//
// ปิดตัวนี้ = ปิดทุก flow ที่ใช้ email OTP จริง ๆ ที่ฝั่ง server ไม่ใช่แค่เทาปุ่มบนหน้าจอ
// ค่ารายตัวที่ผู้ใช้เคยติ๊กไว้ยังถูกเก็บไว้ เปิดสวิตช์ใหญ่กลับมาแล้วได้ค่าเดิมคืน
func ToggleTwoStep(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()
	newValue := !platform.ReadSystemConfigBool(db, platform.CfgTwoStepEnabled, true)
	platform.WriteSystemConfigBool(db, platform.CfgTwoStepEnabled, newValue)

	g := platform.LoadOTPGate(db)
	c.JSON(http.StatusOK, gin.H{
		"two_step_enabled":    newValue,
		"login_2fa_effective": g.LoginOTPActive(),
		"reset_otp_effective": g.ResetOTPActive(),
		"message":             "Two-step verification setting updated",
	})
}

// PATCH /toggle-reset-otp — เปิด/ปิด OTP ตอน reset password (admin เท่านั้น)
//
// ต้องเปิดสวิตช์ใหญ่ก่อน ไม่งั้นการติ๊กช่องนี้จะไม่มีผลอะไรเลย แล้วผู้ใช้จะเข้าใจว่า
// ตั้งค่าสำเร็จแล้วทั้งที่ไม่ได้ตั้ง — ปฏิเสธไปตรง ๆ ชัดกว่า
func ToggleResetOTP(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()
	if !platform.ReadSystemConfigBool(db, platform.CfgTwoStepEnabled, true) {
		c.JSON(http.StatusConflict, gin.H{"error": "turn Two-Step Verification on before setting an OTP trigger"})
		return
	}

	newValue := !platform.ReadSystemConfigBool(db, platform.CfgResetOTP, true)
	platform.WriteSystemConfigBool(db, platform.CfgResetOTP, newValue)

	c.JSON(http.StatusOK, gin.H{
		"reset_otp_enabled": newValue,
		"message":           "Reset OTP setting updated",
	})
}

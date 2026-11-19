package otp

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// revokeAllUserSessions marks every active session for the given user as revoked.
//
// Called after a password reset, and it is the ONLY thing that ejects whoever prompted the reset.
// Changing the password does not invalidate a token that was already issued — middleware.Authorizes
// checks the session row, not the password — so if this write does not land, the person who took
// the account keeps their session for the rest of its 24 hours while the owner believes they have
// just locked them out.
//
// Which is why it returns its error and the caller waits for it. It used to be started with `go`
// and its result dropped: the response said "password updated successfully" before anyone knew
// whether the old sessions were gone.
func revokeAllUserSessions(db *gorm.DB, userID uint) error {
	return db.Model(&entity.UserSession{}).
		Where("app_user_id = ? AND is_revoked = false", userID).
		Update("is_revoked", true).Error
}

// ── Send OTP ──────────────────────────────────────────────────────────────────

type SendOTPRequest struct {
	Email string `json:"email" binding:"required,email"`
}

func SendOTP(c *gin.Context) {
	var req SendOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}

	db := config.DB()

	// Check if reset OTP is enabled
	// ผ่านสวิตช์ใหญ่เสมอ — ปิด Two-Step Verification แล้วต้องไม่มี OTP ทางอีเมลหลุดออกไป
	// จาก flow ไหนเลย ไม่ใช่แค่ปุ่มบนหน้าจอเป็นสีเทา
	if !platform.LoadOTPGate(db).ResetOTPActive() {
		c.JSON(http.StatusForbidden, gin.H{"error": "OTP password reset is disabled"})
		return
	}

	// Normalize response — don't reveal whether email exists
	var user entity.AppUser
	if err := db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "if your email is registered, an OTP has been sent"})
		return
	}

	code, err := platform.SaveOTP(db, req.Email)
	if err != nil {
		log.Printf("[ERROR] could not store an OTP: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not send the code, please try again"})
		return
	}

	err = platform.SendOTPEmail(db, platform.OTPEmailParams{
		ToEmail:      req.Email,
		TemplateType: "otp_reset",
		OTPCode:      code,
		Username:     user.FirstName,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send OTP"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "OTP sent to email"})
}

// ── Verify OTP + Update Password ──────────────────────────────────────────────

type VerifyOTPRequest struct {
	Email       string `json:"email" binding:"required,email"`
	OTP         string `json:"otp" binding:"required,len=6"`
	NewPassword string `json:"new_password" binding:"required,min=8"`
}

func VerifyOTPAddUpdatePassword(c *gin.Context) {
	var req VerifyOTPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request data"})
		return
	}

	db := config.DB()

	// Validate OTP — check attempts BEFORE expiry so the limit is always enforced
	var otp entity.OTP
	if err := db.Where("email = ? AND code = ?", req.Email, req.OTP).First(&otp).Error; err != nil {
		db.Model(&entity.OTP{}).Where("email = ? AND verified = false", req.Email).
			UpdateColumn("attempts", gorm.Expr("attempts + 1"))
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid OTP"})
		return
	}
	if otp.Attempts >= platform.OTPMaxAttempts {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many incorrect OTP attempts, please request a new OTP"})
		return
	}
	if otp.Verified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OTP already used"})
		return
	}
	if time.Now().Unix() > otp.ExpiresAt {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OTP expired"})
		return
	}

	var user entity.AppUser
	if err := db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	policy := services.GetPasswordPolicy(db)
	if err := services.ValidatePasswordPolicy(req.NewPassword, policy); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Password History: block reuse of the most recent password
	if services.IsPasswordReused(db, user.ID, req.NewPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be different from your current password"})
		return
	}

	hashedPassword, err := platform.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	// Transaction: mark OTP used + update password + clear all OTPs for email
	tx := db.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction failed"})
		return
	}

	otp.Verified = true
	if err := tx.Save(&otp).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update OTP status"})
		return
	}

	now := time.Now()
	user.Password = hashedPassword
	user.PasswordChangedAt = &now
	if err := tx.Save(&user).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
		return
	}

	// Unscoped: GORM's default Delete only sets deleted_at, so the row — and the Code that just
	// authorised a password change — would stay in the table and stay readable forever. Same fix,
	// same reason, as services/otp.go; found while that one was being made.
	if err := tx.Unscoped().Where("email = ?", req.Email).Delete(&entity.OTP{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear OTPs"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
		return
	}

	// Synchronous, and its failure is the caller's problem — see revokeAllUserSessions. The other
	// two are history, and a lost line of history is not worth failing a completed reset over.
	if err := revokeAllUserSessions(db, user.ID); err != nil {
		log.Printf("[ERROR] password reset for user %d could not revoke old sessions: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "your password was changed, but existing sessions could not be signed out — sign out everywhere and contact an administrator",
		})
		return
	}
	go services.SavePasswordHistory(db, user.ID, hashedPassword)
	go services.LogActivity(db, user.ID, "password_change")

	c.JSON(http.StatusOK, gin.H{"message": "password updated successfully"})
}

// ── Why there is no password reset without OTP ───────────────────────────────
//
// There used to be a POST /reset-password-direct here, open when email OTP was switched off. It
// accepted {email, new_password, reset_token} — and the token came from GET /check-user-email,
// which handed it to whoever asked. Naming an address was therefore the whole of the proof: two
// unauthenticated calls set any account's password, the admin's included, and from there every
// device-proxy write on every firewall.
//
// It existed to answer a real worry, recorded in services/otpgate.go: turning the Two-Step master
// switch off must not leave a system nobody can get back into. But the answer was wrong, because
// the fallback it reached for was no check at all. The right one was already in the codebase:
// PATCH /admin/users/:id lets an admin set any user's password, so an operator locked out by a
// disabled mailer has a way back that does not involve trusting an anonymous caller.
//
// So the rule is now simply: self-service reset requires the OTP, because the code delivered to
// the mailbox is the only thing here that can actually prove ownership of the address. With OTP
// off, resets are an admin action. TestOTPGate_SelfServiceResetRequiresOTP holds that line.

// ── Toggle system-wide 2FA (admin only) ──────────────────────────────────────

func Toggle2FA(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()

	// Login OTP เป็น trigger ตัวหนึ่งใต้สวิตช์ใหญ่ — ติ๊กตอนสวิตช์ใหญ่ปิดแล้วไม่มีผลอะไร
	// ปฏิเสธไปตรง ๆ ดีกว่าตอบ 200 ให้การตั้งค่าที่ไม่ได้ตั้ง
	if !platform.ReadSystemConfigBool(db, platform.CfgTwoStepEnabled, true) {
		c.JSON(http.StatusConflict, gin.H{"error": "turn Two-Step Verification on before setting an OTP trigger"})
		return
	}

	var config_record entity.SendEmail
	if err := db.First(&config_record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "email service not configured"})
		return
	}

	config_record.TwoFactorEnabled = !config_record.TwoFactorEnabled
	if err := db.Model(&config_record).Update("two_factor_enabled", config_record.TwoFactorEnabled).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"two_factor_enabled": config_record.TwoFactorEnabled,
		"message":            "2FA setting updated",
	})
}

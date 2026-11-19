package totp

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// ── helpers ───────────────────────────────────────────────────────────────────

func getUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	switch val := v.(type) {
	case uint:
		return val, val > 0
	case int:
		return uint(val), val > 0
	case float64:
		return uint(val), val > 0
	}
	return 0, false
}

func getTOTPGlobalEnabled() bool {
	db := config.DB()
	var cfg entity.SystemConfig
	if err := db.Where("key = ?", "totp_global_enabled").First(&cfg).Error; err != nil {
		return false
	}
	return cfg.Value == "true"
}

// ── GET /totp/status ──────────────────────────────────────────────────────────
// Returns the current user's TOTP setup status.

type TOTPStatusResponse struct {
	IsVerified    bool `json:"is_verified"`
	IsEnabled     bool `json:"is_enabled"`
	GlobalEnabled bool `json:"global_enabled"`
}

func GetStatus(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	db := config.DB()
	var userTOTP entity.UserTOTP
	isVerified := false
	isEnabled := false
	if err := db.Where("app_user_id = ?", userID).First(&userTOTP).Error; err == nil {
		isVerified = userTOTP.IsVerified
		isEnabled = userTOTP.IsEnabled
	}

	c.JSON(http.StatusOK, TOTPStatusResponse{
		IsVerified:    isVerified,
		IsEnabled:     isEnabled,
		GlobalEnabled: getTOTPGlobalEnabled(),
	})
}

// ── GET /totp/setup-init ──────────────────────────────────────────────────────
// Creates (or re-creates) an unverified TOTP record and returns the QR image.

type SetupInitResponse struct {
	QRImage string `json:"qr_image"` // base64 PNG
}

func SetupInit(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	db := config.DB()

	var user entity.AppUser
	if err := db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	secret, qrBase64, err := services.GenerateTOTPSetup(user.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate TOTP secret"})
		return
	}

	// Delete any existing (possibly unverified) TOTP record for this user.
	//
	// ต้อง Unscoped: UserTOTP ฝัง gorm.Model จึงเป็น soft delete — แถวเดิมยังอยู่ในตาราง
	// พร้อม deleted_at และยัง **กิน uniqueIndex ของ app_user_id อยู่** บรรทัด Create ข้างล่าง
	// จึงชน unique constraint แล้วตอบ 500 "failed to save TOTP setup"
	// ผลคือ setup-init ใช้ได้ครั้งเดียวต่อผู้ใช้หนึ่งคนตลอดกาล ครั้งที่สองเป็นต้นไปพังเงียบ ๆ
	// (เจอตอนทำให้ modal เปิดมายิง setup-init เอง — ของเดิมต้องกดปุ่มก่อน bug เลยถูกซ่อนไว้)
	// และ record ที่ถูกทิ้งคือ TOTP secret เก่า ซึ่งไม่ควรค้างในฐานข้อมูลอยู่แล้ว
	db.Unscoped().Where("app_user_id = ?", userID).Delete(&entity.UserTOTP{})

	// Save the new unverified record — IsEnabled defaults to true via DB tag
	userTOTP := entity.UserTOTP{
		AppUserID:  userID,
		IsVerified: false,
		IsEnabled:  true,
	}
	// The seed is encrypted at rest — see entity.UserTOTP. It goes through SetTOTPSecret and never
	// into the field directly: anyone who can read this column can mint this account's second
	// factor forever, and unlike a password a TOTP seed is never rotated.
	if err := platform.SetTOTPSecret(&userTOTP, secret); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to secure the TOTP secret"})
		return
	}
	if err := db.Create(&userTOTP).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save TOTP setup"})
		return
	}

	c.JSON(http.StatusOK, SetupInitResponse{QRImage: qrBase64})
}

// ── POST /totp/setup-verify ───────────────────────────────────────────────────
// Verifies the first TOTP code from the app and marks the record as verified.

type SetupVerifyInput struct {
	Code string `json:"code" binding:"required,len=6"`
}

func SetupVerify(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input SetupVerifyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code must be 6 digits"})
		return
	}

	db := config.DB()

	var userTOTP entity.UserTOTP
	if err := db.Where("app_user_id = ?", userID).First(&userTOTP).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "TOTP setup not initiated"})
		return
	}

	// Validates the code AND spends its time step, so the six digits that confirmed the enrolment
	// cannot then be replayed at the sign-in endpoint — both paths claim out of the same column.
	// A wrong code and a replayed one answer identically on purpose: see services.AcceptTOTPCode.
	accepted, err := platform.AcceptTOTPCode(db, &userTOTP, input.Code, time.Now())
	if err != nil {
		// The seed could not be decrypted, or the step could not be recorded. Either way this
		// enrolment must not be activated — a record whose codes cannot be spent has no replay
		// protection at all.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not verify the code: " + err.Error()})
		return
	}
	if !accepted {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code — check your authenticator app"})
		return
	}

	if err := db.Model(&userTOTP).Updates(map[string]interface{}{
		"is_verified": true,
		"is_enabled":  true,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to activate TOTP"})
		return
	}

	// คืนสถานะที่ตั้งไว้จริงกลับไปด้วย เพื่อให้ฝั่ง client ไม่ต้องเดา (แล้วเดาผิด)
	c.JSON(http.StatusOK, gin.H{
		"message":     "TOTP enabled successfully",
		"is_verified": true,
		"is_enabled":  true,
	})
}

// ── PATCH /totp/toggle-enabled ────────────────────────────────────────────────
// Sets IsEnabled on the user's verified TOTP record.
// The secret is preserved — user can re-enable without rescanning the QR code.

// ตั้งค่าตรง ๆ ได้ด้วย body {"enabled": true|false} · ไม่ส่ง body = สลับค่าเดิม (ของเดิม)
type toggleEnabledInput struct {
	Enabled *bool `json:"enabled"`
}

func ToggleEnabled(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input toggleEnabledInput
	_ = c.ShouldBindJSON(&input) // body ว่างได้ — ถือว่าเป็นการสลับค่าแบบเดิม

	db := config.DB()

	var userTOTP entity.UserTOTP
	if err := db.Where("app_user_id = ? AND is_verified = true", userID).First(&userTOTP).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "TOTP not set up"})
		return
	}

	// ปุ่มบนหน้าจอเขียนว่า "Enable" หรือ "Disable" — มันต้อง **ทำตามที่เขียน** ไม่ใช่สลับ
	// ค่าที่อยู่ใน DB ตอนนั้น
	//
	// บั๊กที่เจอจริง: หลัง setup-verify สำเร็จ ฝั่ง client ตั้งแค่ totpVerified=true แต่ลืมตั้ง
	// totpIsEnabled=true (ทั้งที่ server ตั้งให้ทั้งคู่) หน้าจอจึงขึ้นว่า "TOTP Disabled"
	// ทันทีหลังตั้งค่าเสร็จ ผู้ใช้กดปุ่ม "Enable TOTP" ตามที่เห็น → endpoint สลับค่าจริง
	// จาก true เป็น **false** → TOTP ถูกปิดจริง ๆ และ login ก็ไม่ถาม TOTP อีกเลย
	// (สภาพที่เจอในฐานข้อมูล: is_verified=t, is_enabled=f)
	newEnabled := !userTOTP.IsEnabled
	if input.Enabled != nil {
		newEnabled = *input.Enabled
	}
	if err := db.Model(&userTOTP).Update("is_enabled", newEnabled).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update TOTP"})
		return
	}

	msg := "TOTP disabled (secret kept — you can re-enable anytime)"
	if newEnabled {
		msg = "TOTP enabled"
	}
	c.JSON(http.StatusOK, gin.H{
		"is_enabled": newEnabled,
		"message":    msg,
	})
}

// ── DELETE /totp/disable ──────────────────────────────────────────────────────
// Permanently removes the user's TOTP record (deletes secret — requires QR rescan to set up again).

func Disable(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	db := config.DB()
	// Unscoped ด้วยเหตุผลเดียวกับ SetupInit: soft delete ทิ้งแถวไว้กิน uniqueIndex
	// ของ app_user_id ผู้ใช้ที่กด "Remove" แล้วจะตั้ง TOTP ใหม่ไม่ได้อีกเลย
	// อีกเหตุผลคือหน้าที่ของ endpoint นี้เขียนไว้ชัดว่า "deletes secret" — soft delete
	// ไม่ได้ลบ secret จริง มันยังนอนอยู่ในตารางเต็ม ๆ
	if err := db.Unscoped().Where("app_user_id = ?", userID).Delete(&entity.UserTOTP{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove TOTP"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "TOTP removed"})
}

// ── GET /totp/global ──────────────────────────────────────────────────────────
// Returns the global TOTP-required setting (admin only).

func GetGlobal(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": getTOTPGlobalEnabled()})
}

// ── PATCH /totp/global-toggle ─────────────────────────────────────────────────
// Toggles the global TOTP requirement (admin only).

func ToggleGlobal(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()
	current := getTOTPGlobalEnabled()
	newValue := strconv.FormatBool(!current)

	var cfg entity.SystemConfig
	if err := db.Where("key = ?", "totp_global_enabled").First(&cfg).Error; err != nil {
		cfg = entity.SystemConfig{Key: "totp_global_enabled", Value: newValue}
		db.Create(&cfg)
	} else {
		db.Model(&cfg).Update("value", newValue)
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled": !current,
		"message": "TOTP global setting updated",
	})
}

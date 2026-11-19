package backupcodes

import (
	"crypto/rand"
	"math/big"
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // exclude 0,O,I,1 to avoid confusion
const codeLen = 8
const codeCount = 8

func generateCode() (string, error) {
	b := make([]byte, codeLen)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		b[i] = charset[n.Int64()]
	}
	return string(b), nil
}

func getUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	switch val := v.(type) {
	case uint:
		return val, val > 0
	case float64:
		return uint(val), val > 0
	}
	return 0, false
}

// POST /backup-codes/generate
// Generates 8 new backup codes (invalidates all previous ones).
// TOTP must be verified before codes can be generated.
func Generate(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	db := config.DB()

	var userTOTP entity.UserTOTP
	if err := db.Where("app_user_id = ? AND is_verified = true", userID).First(&userTOTP).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "TOTP must be enabled before generating backup codes"})
		return
	}

	// Purge existing codes
	db.Where("app_user_id = ?", userID).Delete(&entity.UserBackupCode{})

	plainCodes := make([]string, codeCount)
	for i := 0; i < codeCount; i++ {
		raw, err := generateCode()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate codes"})
			return
		}

		hashed, err := platform.HashPassword(raw)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash code"})
			return
		}

		if err := db.Create(&entity.UserBackupCode{
			AppUserID: userID,
			CodeHash:  hashed,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save code"})
			return
		}

		// Format for display: XXXX-XXXX
		plainCodes[i] = raw[:4] + "-" + raw[4:]
	}

	go services.LogActivity(db, userID, "backup_codes_generated")

	c.JSON(http.StatusOK, gin.H{
		"codes":   plainCodes,
		"message": "store these codes safely — they will not be shown again",
	})
}

// GET /backup-codes/status
func GetStatus(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	db := config.DB()

	var total, used int64
	db.Model(&entity.UserBackupCode{}).Where("app_user_id = ?", userID).Count(&total)
	db.Model(&entity.UserBackupCode{}).Where("app_user_id = ? AND used_at IS NOT NULL", userID).Count(&used)

	c.JSON(http.StatusOK, gin.H{
		"total":     total,
		"used":      used,
		"remaining": total - used,
	})
}

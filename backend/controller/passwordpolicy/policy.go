package passwordpolicy

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

type PolicyResponse struct {
	MinLength        int  `json:"min_length"`
	RequireUppercase bool `json:"require_uppercase"`
	RequireNumber    bool `json:"require_number"`
	RequireSpecial   bool `json:"require_special"`
	ExpiryDays       int  `json:"expiry_days"`
}

func mapPolicy(p services.PasswordPolicy) PolicyResponse {
	return PolicyResponse{
		MinLength:        p.MinLength,
		RequireUppercase: p.RequireUppercase,
		RequireNumber:    p.RequireNumber,
		RequireSpecial:   p.RequireSpecial,
		ExpiryDays:       p.ExpiryDays,
	}
}

// GET /password-policy — ดึง policy ปัจจุบัน (public เพื่อ frontend ใช้ validate)
func GetPolicy(c *gin.Context) {
	db := config.DB()
	c.JSON(http.StatusOK, mapPolicy(services.GetPasswordPolicy(db)))
}

type UpdatePolicyInput struct {
	MinLength        *int  `json:"min_length"`
	RequireUppercase *bool `json:"require_uppercase"`
	RequireNumber    *bool `json:"require_number"`
	RequireSpecial   *bool `json:"require_special"`
	ExpiryDays       *int  `json:"expiry_days"`
}

// PATCH /password-policy — อัปเดต policy (admin only)
func UpdatePolicy(c *gin.Context) {
	if role, _ := c.Get("user_role"); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	var input UpdatePolicyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db := config.DB()

	if input.MinLength != nil {
		v := *input.MinLength
		if v < 6 {
			v = 6
		}
		if v > 128 {
			v = 128
		}
		upsertConfig(db, "password_min_length", strconv.Itoa(v))
	}
	if input.RequireUppercase != nil {
		upsertConfig(db, "password_require_uppercase", boolStr(*input.RequireUppercase))
	}
	if input.RequireNumber != nil {
		upsertConfig(db, "password_require_number", boolStr(*input.RequireNumber))
	}
	if input.RequireSpecial != nil {
		upsertConfig(db, "password_require_special", boolStr(*input.RequireSpecial))
	}
	if input.ExpiryDays != nil {
		v := *input.ExpiryDays
		if v < 0 {
			v = 0
		}
		upsertConfig(db, "password_expiry_days", strconv.Itoa(v))
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "policy updated",
		"data":    mapPolicy(services.GetPasswordPolicy(db)),
	})
}

func upsertConfig(db *gorm.DB, key, value string) {
	var cfg entity.SystemConfig
	if err := db.Where("key = ?", key).First(&cfg).Error; err != nil {
		db.Create(&entity.SystemConfig{Key: key, Value: value})
	} else {
		db.Model(&cfg).Update("value", value)
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

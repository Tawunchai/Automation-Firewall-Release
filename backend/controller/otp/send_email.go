package otp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

type SendEmailResponse struct {
	ID    uint   `json:"id"`
	Email string `json:"email"`
	// PassAppSet replaces the plaintext app password in the response: the backend now stores it
	// encrypted (platform.EncryptSecret) and never echoes a stored secret back to the browser,
	// the same convention device credentials already follow.
	PassAppSet       bool `json:"pass_app_set"`
	AppUserID        uint `json:"app_user_id"`
	TwoFactorEnabled bool `json:"two_factor_enabled"`
}

type UpdateSendEmailInput struct {
	Email   string `json:"email"`
	PassApp string `json:"pass_app"`
}

func mapSendEmailResponse(s entity.SendEmail) SendEmailResponse {
	return SendEmailResponse{
		ID:               s.ID,
		Email:            s.Email,
		PassAppSet:       strings.TrimSpace(s.PassAppEnc) != "",
		AppUserID:        s.AppUserID,
		TwoFactorEnabled: s.TwoFactorEnabled,
	}
}

func getLoginAppUserID(c *gin.Context) (uint, bool) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}

	switch v := userIDValue.(type) {
	case uint:
		if v == 0 {
			return 0, false
		}
		return v, true

	case int:
		if v <= 0 {
			return 0, false
		}
		return uint(v), true

	case float64:
		if v <= 0 {
			return 0, false
		}
		return uint(v), true

	default:
		return 0, false
	}
}

// GET /send-emails
//
// Admin-only: every row carries another account's SMTP app password in plaintext
// (pass_app), the same credential CreateSendEmail already requires admin to set.
func ListSendEmail(c *gin.Context) {
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	var sendEmails []entity.SendEmail

	db := config.DB()

	results := db.Preload("AppUser").Find(&sendEmails)
	if results.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": results.Error.Error(),
		})
		return
	}

	response := make([]SendEmailResponse, 0, len(sendEmails))
	for _, item := range sendEmails {
		response = append(response, mapSendEmailResponse(item))
	}

	c.JSON(http.StatusOK, response)
}

// POST /send-email
func CreateSendEmail(c *gin.Context) {
	loginAppUserID, ok := getLoginAppUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized: user not found in context"})
		return
	}

	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	var input UpdateSendEmailInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if strings.TrimSpace(input.Email) == "" || strings.TrimSpace(input.PassApp) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email and pass_app are required"})
		return
	}

	encPassApp, err := platform.EncryptSecret(strings.TrimSpace(input.PassApp))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to secure the app password"})
		return
	}

	db := config.DB()

	send := entity.SendEmail{
		Email:            strings.TrimSpace(input.Email),
		PassAppEnc:       encPassApp,
		AppUserID:        loginAppUserID,
		TwoFactorEnabled: false,
	}

	if err := db.Create(&send).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create send email"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "created send email successfully",
		"data":    mapSendEmailResponse(send),
	})
}

// PUT /send-email/:id
//
// Admin-only, same as CreateSendEmail — this writes the system's OTP-sending SMTP
// credential, not a row the caller owns.
func UpdateSendEmailByID(c *gin.Context) {
	loginAppUserID, ok := getLoginAppUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "unauthorized: user not found in context",
		})
		return
	}

	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	idParam := c.Param("id")

	id, err := strconv.Atoi(idParam)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid id",
		})
		return
	}

	var input UpdateSendEmailInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	db := config.DB()

	var sendEmail entity.SendEmail
	if err := db.First(&sendEmail, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "send email record not found",
		})
		return
	}

	var appUser entity.AppUser
	if err := db.First(&appUser, loginAppUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "login app user not found",
		})
		return
	}

	updateData := map[string]interface{}{}

	if strings.TrimSpace(input.Email) != "" {
		updateData["email"] = strings.TrimSpace(input.Email)
	}

	if strings.TrimSpace(input.PassApp) != "" {
		encPassApp, encErr := platform.EncryptSecret(strings.TrimSpace(input.PassApp))
		if encErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to secure the app password"})
			return
		}
		updateData["pass_app"] = encPassApp
	}

	updateData["app_user_id"] = loginAppUserID

	if len(updateData) == 1 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "no data to update",
		})
		return
	}

	if err := db.Model(&sendEmail).Updates(updateData).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to update send email",
		})
		return
	}

	if err := db.Preload("AppUser").First(&sendEmail, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to fetch updated send email",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "update send email successfully",
		"data":    mapSendEmailResponse(sendEmail),
	})
}

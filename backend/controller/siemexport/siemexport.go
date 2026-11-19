// Package siemexport serves the Phase C1 setting: streaming the Change Ledger to an external
// webhook as it happens. See services/siemexport.go for why this is a webhook rather than syslog,
// and why it is not built on top of Notify's channel/rule model.
package siemexport

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

func requireAdmin(c *gin.Context) bool {
	if c.GetString("user_role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

type policyResponse struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhook_url"`
}

// GET /admin/siem-export
func GetPolicy(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	cfg := services.GetSIEMExportConfig(config.DB())
	c.JSON(http.StatusOK, policyResponse{Enabled: cfg.Enabled, WebhookURL: cfg.WebhookURL})
}

type updateInput struct {
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhook_url"`
}

// validWebhookURL checks the shape AND where the address points — a URL an admin types here is
// fetched by this server, from inside the network, so "is it a URL" was never the whole question.
// services.ValidateWebhookURL explains which destinations are refused and why a private LAN
// address is NOT one of them.
func validWebhookURL(raw string) bool {
	return services.ValidateWebhookURLShape(raw) == nil
}

// PATCH /admin/siem-export
func UpdatePolicy(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var in updateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.WebhookURL = strings.TrimSpace(in.WebhookURL)
	if in.Enabled && !validWebhookURL(in.WebhookURL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a valid http(s) webhook URL is required to enable SIEM export"})
		return
	}

	db := config.DB()
	if err := services.SetSIEMExportConfig(db, in.Enabled, in.WebhookURL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "SIEM export settings updated",
		"data":    policyResponse(in),
	})
}

// POST /admin/siem-export/test — sends one sample event to the configured URL right now, the same
// shape a real Change Ledger row produces, so "Send test event" proves the destination is reachable
// without waiting for an actual device write.
func TestWebhook(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var in struct {
		WebhookURL string `json:"webhook_url"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.WebhookURL = strings.TrimSpace(in.WebhookURL)
	if !validWebhookURL(in.WebhookURL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a valid http(s) webhook URL is required"})
		return
	}

	email := c.GetString("user_email")
	sample := services.BuildSIEMEvent(entity.ChangeRecord{
		NetworkDeviceID: 0,
		UserEmail:       email,
		Action:          "update",
		ResourceType:    "test-event",
		ResourceKey:     "siem-export-test",
		Method:          "POST",
		Path:            "/admin/siem-export/test",
		Status:          "applied",
	}, "(test — no device)")
	sample.Timestamp = time.Now()

	if err := services.SendSIEMEvent(in.WebhookURL, sample); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "the webhook did not accept the test event: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "test event sent"})
}

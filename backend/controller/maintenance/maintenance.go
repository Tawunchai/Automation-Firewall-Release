package maintenance

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/controller/sse"
	"network_automation/entity"
	"network_automation/services"
)

// The two config keys live in services alongside the cache that reads them, so the middleware,
// this controller and the cache can never disagree about their names.
const (
	maintenanceKey         = services.MaintenanceKey
	maintenanceActiveAtKey = services.MaintenanceActiveAtKey
	gracePeriodSeconds     = 60
)

// PublicStatus godoc
// GET /maintenance/status — public endpoint, no auth required.
// Returns enabled flag and how many seconds remain before blocking starts.
//
// Unauthenticated and polled by the login page, so it reads through the same cache the auth
// middleware uses rather than issuing two queries per caller.
func PublicStatus(c *gin.Context) {
	state, err := services.MaintenanceStatus(config.DB())
	if err != nil || !state.Enabled {
		c.JSON(http.StatusOK, gin.H{"enabled": false, "seconds_remaining": 0})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":           true,
		"seconds_remaining": state.GraceSecondsRemaining(time.Now()),
	})
}

// GetStatus godoc
// GET /maintenance — returns current maintenance mode status.
// Admin only.
func GetStatus(c *gin.Context) {
	roleValue, exists := c.Get("user_role")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	role, ok := roleValue.(string)
	if !ok || role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()

	var cfg entity.SystemConfig
	err := db.Where("key = ?", maintenanceKey).First(&cfg).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"enabled": false})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch maintenance status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"enabled": cfg.Value == "true"})
}

// Toggle godoc
// PATCH /maintenance/toggle — flips the maintenance_mode flag.
// Admin only. Broadcasts SSE event to all connected clients.
// When enabling: stores a grace-period timestamp so the middleware allows
// requests for the next 60 s before starting to return 503.
func Toggle(c *gin.Context) {
	roleValue, exists := c.Get("user_role")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	role, ok := roleValue.(string)
	if !ok || role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	db := config.DB()

	var cfg entity.SystemConfig
	err := db.Where("key = ?", maintenanceKey).First(&cfg).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		cfg = entity.SystemConfig{Key: maintenanceKey, Value: "true"}
		if err := db.Create(&cfg).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enable maintenance mode"})
			return
		}
		upsertActiveAt(db)
		// Drop the cached flag AFTER the grace timestamp is written, so the next request cannot
		// observe "enabled" without the grace period that goes with it and block early.
		services.InvalidateMaintenanceCache()
		go sse.Bus.Broadcast("maintenance:on")
		c.JSON(http.StatusOK, gin.H{"enabled": true, "message": "maintenance mode enabled"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch maintenance status"})
		return
	}

	newValue := "true"
	if cfg.Value == "true" {
		newValue = "false"
	}

	if err := db.Model(&cfg).Update("value", newValue).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle maintenance mode"})
		return
	}

	if newValue == "true" {
		upsertActiveAt(db)
		services.InvalidateMaintenanceCache()
		go sse.Bus.Broadcast("maintenance:on")
	} else {
		services.InvalidateMaintenanceCache()
		go sse.Bus.Broadcast("maintenance:off")
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled": newValue == "true",
		"message": "maintenance mode updated",
	})
}

// upsertActiveAt writes/updates the Unix timestamp at which the middleware
// should start blocking (now + gracePeriodSeconds).
func upsertActiveAt(db *gorm.DB) {
	activeAt := strconv.FormatInt(time.Now().Add(gracePeriodSeconds*time.Second).Unix(), 10)

	var activeCfg entity.SystemConfig
	err := db.Where("key = ?", maintenanceActiveAtKey).First(&activeCfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		db.Create(&entity.SystemConfig{Key: maintenanceActiveAtKey, Value: activeAt})
	} else if err == nil {
		db.Model(&activeCfg).Update("value", activeAt)
	}
}

package activitylog

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
)

type ActivityLogResponse struct {
	ID        uint   `json:"id"`
	Action    string `json:"action"`
	CreatedAt string `json:"created_at"`
}

type AdminActivityLogResponse struct {
	ID        uint   `json:"id"`
	Action    string `json:"action"`
	CreatedAt string `json:"created_at"`
	UserID    uint   `json:"user_id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
}

// GET /activity-logs?limit=50&page=1
func ListMyActivityLogs(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if page < 1 {
		page = 1
	}

	db := config.DB()

	var logs []entity.ActivityLog
	if err := db.Where("app_user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Offset((page - 1) * limit).
		Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch logs"})
		return
	}

	result := make([]ActivityLogResponse, 0, len(logs))
	for _, l := range logs {
		result = append(result, ActivityLogResponse{
			ID:        l.ID,
			Action:    l.Action,
			CreatedAt: l.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// GET /admin/activity-logs?limit=100&page=1
func ListAllActivityLogs(c *gin.Context) {
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

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if limit < 1 || limit > 500 {
		limit = 100
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	db := config.DB()

	type row struct {
		ID        uint   `gorm:"column:id"`
		Action    string `gorm:"column:action"`
		CreatedAt string `gorm:"column:created_at"`
		UserID    uint   `gorm:"column:user_id"`
		FirstName string `gorm:"column:first_name"`
		LastName  string `gorm:"column:last_name"`
		Email     string `gorm:"column:email"`
	}

	var rows []row
	err := db.Raw(`
		SELECT
			al.id,
			al.action,
			to_char(al.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
			au.id   AS user_id,
			au.first_name,
			au.last_name,
			au.email
		FROM activity_logs al
		JOIN app_users au ON au.id = al.app_user_id
		WHERE al.deleted_at IS NULL
		ORDER BY al.created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset).Scan(&rows).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch activity logs"})
		return
	}

	result := make([]AdminActivityLogResponse, 0, len(rows))
	for _, r := range rows {
		// A conversion, not a field-by-field literal: the two structs are the same shape by
		// design — `row` exists only to carry gorm column tags, AdminActivityLogResponse only to
		// carry json ones. Converting makes the compiler enforce that. The literal it replaces did
		// not: a field added to `row` and forgotten here would have serialised as a zero value.
		result = append(result, AdminActivityLogResponse(r))
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

package calendar

import (
	"net/http"
	"strconv"
	"time"

	"github.com/asaskevich/govalidator"
	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
)

type EventRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	StartDate   string `json:"start_date" binding:"required"`
	EndDate     string `json:"end_date" binding:"required"`
	AllDay      bool   `json:"all_day"`
	Category    string `json:"category" binding:"required"`
	Color       string `json:"color"`
}

type EventResponse struct {
	ID          uint   `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
	AllDay      bool   `json:"all_day"`
	Category    string `json:"category"`
	Color       string `json:"color"`
	CreatedAt   string `json:"created_at"`
}

func getUserID(c *gin.Context) (uint, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func parseDate(s string) (time.Time, error) {
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, &time.ParseError{Value: s}
}

func toResponse(e entity.CalendarEvent) EventResponse {
	return EventResponse{
		ID:          e.ID,
		Title:       e.Title,
		Description: e.Description,
		StartDate:   e.StartDate.Format(time.RFC3339),
		EndDate:     e.EndDate.Format(time.RFC3339),
		AllDay:      e.AllDay,
		Category:    e.Category,
		Color:       e.Color,
		CreatedAt:   e.CreatedAt.Format(time.RFC3339),
	}
}

func ListEvents(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var events []entity.CalendarEvent
	if err := config.DB().Where("app_user_id = ?", userID).
		Order("start_date ASC").
		Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch events"})
		return
	}

	result := make([]EventResponse, 0, len(events))
	for _, e := range events {
		result = append(result, toResponse(e))
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func CreateEvent(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	startDate, err := parseDate(req.StartDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format"})
		return
	}
	endDate, err := parseDate(req.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date format"})
		return
	}

	color := req.Color
	if color == "" {
		color = "#7C3AED"
	}

	event := entity.CalendarEvent{
		Title:       req.Title,
		Description: req.Description,
		StartDate:   startDate,
		EndDate:     endDate,
		AllDay:      req.AllDay,
		Category:    req.Category,
		Color:       color,
		AppUserID:   userID,
	}

	if ok, err := govalidator.ValidateStruct(event); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := config.DB().Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create event"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": toResponse(event)})
}

func UpdateEvent(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	db := config.DB()
	var event entity.CalendarEvent
	if err := db.Where("id = ? AND app_user_id = ?", id, userID).First(&event).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	startDate, err := parseDate(req.StartDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date format"})
		return
	}
	endDate, err := parseDate(req.EndDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date format"})
		return
	}

	event.Title = req.Title
	event.Description = req.Description
	event.StartDate = startDate
	event.EndDate = endDate
	event.AllDay = req.AllDay
	event.Category = req.Category
	if req.Color != "" {
		event.Color = req.Color
	}

	if err := db.Save(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": toResponse(event)})
}

func DeleteEvent(c *gin.Context) {
	userID, ok := getUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	db := config.DB()
	var event entity.CalendarEvent
	if err := db.Where("id = ? AND app_user_id = ?", id, userID).First(&event).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "event not found"})
		return
	}

	if err := db.Delete(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "event deleted"})
}

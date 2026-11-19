package policyobject

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Firewall Schedules — device-proxy CRUD over the three FortiOS schedule tables
// (firewall.schedule/{recurring,onetime,group}). Mirrors the FortiGate GUI's
// Policy & Objects > Schedules page: a Schedules tab (recurring + onetime) and a
// Schedule groups tab, each with Create / Edit / Delete.

// scheduleInput is the GUI-shaped create/update body. Which fields matter depends on Type.
type scheduleInput struct {
	Name           string   `json:"name"`
	Type           string   `json:"type"` // recurring | onetime | group
	Start          string   `json:"start"`
	End            string   `json:"end"`
	Day            []string `json:"day"`
	ExpirationDays int      `json:"expiration_days"`
	Member         []string `json:"member"`
	Color          int      `json:"color"`
}

var validWeekdays = map[string]bool{
	"sunday": true, "monday": true, "tuesday": true, "wednesday": true,
	"thursday": true, "friday": true, "saturday": true,
}

// validateSchedule enforces the same rules the FortiGate form does, so a bad body fails here
// with a clear message instead of coming back as an opaque FortiOS CLI parser error.
func validateSchedule(inp scheduleInput) (services.FGScheduleFull, error) {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return services.FGScheduleFull{}, errMsg("name is required")
	}
	if !services.IsValidScheduleType(inp.Type) {
		return services.FGScheduleFull{}, errMsg("type must be recurring, onetime, or group")
	}
	if inp.Color < 0 || inp.Color > 32 {
		return services.FGScheduleFull{}, errMsg("color must be 0-32")
	}

	s := services.FGScheduleFull{Name: name, Type: inp.Type, Color: inp.Color}
	switch inp.Type {
	case "recurring":
		for _, d := range inp.Day {
			if !validWeekdays[strings.ToLower(d)] {
				return s, errMsg("invalid weekday: " + d)
			}
		}
		if len(inp.Day) == 0 {
			return s, errMsg("select at least one day")
		}
		// "All day" = both empty/00:00. "Specify" = a real hh:mm span; the API stores 24h times.
		s.Start = defaultTime(inp.Start)
		s.End = defaultTime(inp.End)
		if !validHHMM(s.Start) || !validHHMM(s.End) {
			return s, errMsg("start/end must be in hh:mm 24-hour format")
		}
		s.Day = lowerAll(inp.Day)
	case "onetime":
		if !validOnetimeStamp(inp.Start) || !validOnetimeStamp(inp.End) {
			return s, errMsg("start/end must be in 'hh:mm yyyy/mm/dd' format")
		}
		if inp.ExpirationDays < 0 || inp.ExpirationDays > 100 {
			return s, errMsg("pre-expiration days must be 0-100")
		}
		s.Start = inp.Start
		s.End = inp.End
		s.ExpirationDays = inp.ExpirationDays
	case "group":
		if len(inp.Member) == 0 {
			return s, errMsg("a schedule group needs at least one member")
		}
		s.Member = inp.Member
	}
	return s, nil
}

// GET /policy/device/:deviceId/schedules
func DeviceListSchedules(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	items, err := fc.GetSchedulesAll()
	if err != nil {
		respondDeviceError(c, err, "schedule")
		return
	}

	// Attach the built-in flag so the UI can grey out Edit/Delete on "always"/"none".
	type row struct {
		services.FGScheduleFull
		Builtin bool `json:"builtin"`
	}
	out := make([]row, 0, len(items))
	for _, s := range items {
		out = append(out, row{FGScheduleFull: s, Builtin: services.IsBuiltinSchedule(s.Name)})
	}
	c.JSON(http.StatusOK, out)
}

// GET /policy/device/:deviceId/schedules/:type/:name
func DeviceGetSchedule(c *gin.Context) {
	fgType := c.Param("type")
	if !services.IsValidScheduleType(fgType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown schedule type"})
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	s, err := fc.GetSchedule(fgType, c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

// POST /policy/device/:deviceId/schedules
func DeviceCreateSchedule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp scheduleInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if services.IsBuiltinSchedule(strings.TrimSpace(inp.Name)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "that name is reserved by a built-in schedule"})
		return
	}
	s, err := validateSchedule(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateSchedule(s); err != nil {
		respondDeviceError(c, err, "schedule")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "schedule created on device"})
}

// PUT /policy/device/:deviceId/schedules/:type/:name
func DeviceUpdateSchedule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	fgType := c.Param("type")
	name := c.Param("name")
	if services.IsBuiltinSchedule(name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "built-in schedules cannot be modified"})
		return
	}

	var inp scheduleInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The edit form can't change a schedule's type (it lives in a different table), so pin it.
	inp.Type = fgType
	s, err := validateSchedule(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateSchedule(fgType, name, s); err != nil {
		respondDeviceError(c, err, "schedule")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "schedule updated on device"})
}

// DELETE /policy/device/:deviceId/schedules/:type/:name
func DeviceDeleteSchedule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	fgType := c.Param("type")
	name := c.Param("name")
	if !services.IsValidScheduleType(fgType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown schedule type"})
		return
	}
	if services.IsBuiltinSchedule(name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "built-in schedules cannot be deleted"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteSchedule(fgType, name); err != nil {
		respondDeviceError(c, err, "schedule")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "schedule deleted from device"})
}

// ── small helpers ─────────────────────────────────────────────────────────────

type scheduleError string

func (e scheduleError) Error() string { return string(e) }
func errMsg(s string) error           { return scheduleError(s) }

func defaultTime(s string) string {
	if strings.TrimSpace(s) == "" {
		return "00:00"
	}
	return strings.TrimSpace(s)
}

func lowerAll(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = strings.ToLower(s)
	}
	return out
}

// validHHMM checks a 24-hour "hh:mm" clock time (00:00–23:59).
func validHHMM(s string) bool {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return false
	}
	h, ok1 := atoiRange(parts[0], 0, 23)
	m, ok2 := atoiRange(parts[1], 0, 59)
	return ok1 && ok2 && h >= 0 && m >= 0
}

// validOnetimeStamp checks the FortiOS one-time format "hh:mm yyyy/mm/dd".
func validOnetimeStamp(s string) bool {
	fields := strings.Fields(s)
	if len(fields) != 2 || !validHHMM(fields[0]) {
		return false
	}
	date := strings.Split(fields[1], "/")
	if len(date) != 3 {
		return false
	}
	_, y := atoiRange(date[0], 1970, 2100)
	_, mo := atoiRange(date[1], 1, 12)
	_, da := atoiRange(date[2], 1, 31)
	return y && mo && da
}

func atoiRange(s string, lo, hi int) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
	}
	return n, n >= lo && n <= hi
}

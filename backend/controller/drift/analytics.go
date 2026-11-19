package drift

import (
	"net/http"
	"network_automation/services/drift"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/services"
)

// Window sizes the page offers. Anything else is clamped rather than rejected — a hand-edited URL
// should still draw a chart — but the ceiling is real: past a year the per-day columns stop being
// readable and the ledger read stops being cheap.
const (
	defaultAnalyticsDays = 30
	maxAnalyticsDays     = 365
	// A real UTC offset is within ±14h. The bound is what keeps a nonsense value from pushing every
	// timestamp into another day.
	maxOffsetMinutes = 14 * 60
)

// ── GET /drift/analytics?days=30&device_id=1&tz_offset=420 ───────────────────

// Analytics feeds the stat tiles and the two charts on the Configuration Drift page: what changed
// through this console and what changed outside it, per day and per FortiOS table.
//
// Read-only and open to any user who can see the device, like the ledger and the drift runs it
// counts. The scope is applied inside services.BuildDriftAnalytics, once, to every read it makes.
//
// tz_offset is the viewer's UTC offset in minutes, east positive. It decides where a day starts, so
// the bar labelled "Sep 3" counts what the ledger below it lists under Sep 3 in the same browser.
// Omitted, the server's own zone is used.
func Analytics(c *gin.Context) {
	now := time.Now()

	days := defaultAnalyticsDays
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			days = min(n, maxAnalyticsDays)
		}
	}

	_, serverOffset := now.Zone()
	offset := serverOffset / 60
	if raw := strings.TrimSpace(c.Query("tz_offset")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= -maxOffsetMinutes && n <= maxOffsetMinutes {
			offset = n
		}
	}

	var deviceID uint
	if raw := strings.TrimSpace(c.Query("device_id")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			deviceID = uint(n)
		}
	}

	uid, _ := c.Get("user_id")
	out, err := drift.BuildDriftAnalytics(config.DB(), drift.DriftAnalyticsQuery{
		UserID:        services.UserIDOf(uid),
		IsAdmin:       isAdmin(c),
		DeviceID:      deviceID,
		Days:          days,
		OffsetMinutes: offset,
		Now:           now,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not compute change analytics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

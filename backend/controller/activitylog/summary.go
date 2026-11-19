package activitylog

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
)

// GET /activity-logs/summary?days=14 — aggregate counts for the charts on the Users page.
//
// WHY THIS EXISTS
// The two panels there were drawn from /activity-logs, which is PAGINATED: the frontend asked for
// it with no parameters, so it received the 50 most recent rows. The panels then labelled what
// they computed from those 50 rows "Login / Logout — all time" and "my events — last 14 days".
// Both statements were false for any account with more than 50 events — the "Total" was really
// "total within your last 50", and a busy fortnight silently fell off the left of the timeline.
//
// Raising the page size would not have fixed it, only moved the lie further out. Counting is a
// database job: GROUP BY answers exactly, in one indexed pass, and the response stays the same
// size whether the account has fifty events or five million.
//
// Both queries are scoped to the calling user and lean on idx_activity_logs_user_created
// (app_user_id, created_at DESC) — see config.performanceIndexes.

// ActionCount is one bar of the Action Breakdown panel.
type ActionCount struct {
	Action string `json:"action"`
	Count  int    `json:"count"`
}

// DayCount is one point of the Activity Timeline. Date is YYYY-MM-DD in UTC, matching the date
// the frontend derives from created_at everywhere else in the app.
type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type ActivitySummaryResponse struct {
	// Total counts EVERY event the user has, with no window and no page — this is the number the
	// panel means by "all time".
	Total int `json:"total"`
	// Actions is every distinct action with its all-time count, most frequent first. The frontend
	// decides which ones it charts; the API does not assume it knows.
	Actions []ActionCount `json:"actions"`
	// Days is one entry per day in the requested window, INCLUDING days with no events, oldest
	// first — so the chart has no gaps to interpolate across.
	Days []DayCount `json:"days"`
	// WindowDays echoes the window actually used, so the panel's own label can be generated from
	// the answer rather than hard-coded next to it.
	WindowDays int `json:"window_days"`
}

const (
	defaultSummaryDays = 14
	maxSummaryDays     = 365
)

func ActivitySummary(c *gin.Context) {
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

	days := parseWindowDays(c.Query("days"))
	db := config.DB()

	// ── All-time counts per action ────────────────────────────────────────────
	var actionRows []struct {
		Action string
		Count  int
	}
	if err := db.Raw(`
		SELECT action, COUNT(*) AS count
		  FROM activity_logs
		 WHERE app_user_id = ? AND deleted_at IS NULL
		 GROUP BY action
		 ORDER BY count DESC, action ASC
	`, userID).Scan(&actionRows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to summarise activity"})
		return
	}

	out := ActivitySummaryResponse{
		Actions:    make([]ActionCount, 0, len(actionRows)),
		WindowDays: days,
	}
	for _, r := range actionRows {
		out.Actions = append(out.Actions, ActionCount{Action: r.Action, Count: r.Count})
		out.Total += r.Count
	}

	// ── Per-day counts across the window ──────────────────────────────────────
	start := windowStart(time.Now(), days)

	var dayRows []struct {
		Day   time.Time
		Count int
	}
	if err := db.Raw(`
		SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*) AS count
		  FROM activity_logs
		 WHERE app_user_id = ? AND deleted_at IS NULL AND created_at >= ?
		 GROUP BY day
		 ORDER BY day ASC
	`, userID, start).Scan(&dayRows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to summarise activity"})
		return
	}

	byDay := make(map[string]int, len(dayRows))
	for _, r := range dayRows {
		byDay[r.Day.UTC().Format(dayFormat)] = r.Count
	}
	out.Days = fillWindow(start, days, byDay)

	c.JSON(http.StatusOK, gin.H{"data": out})
}

const dayFormat = "2006-01-02"

// windowStart is midnight UTC of the FIRST day in the window.
//
// Deliberately not "now minus N×24h": the panel plots calendar days, so a request at 14:30 must
// still include everything that happened on the morning of the first day. Truncating first also
// makes the answer stable for the whole day — two requests an hour apart return the same window,
// which is what lets the response be cached or compared.
func windowStart(now time.Time, days int) time.Time {
	return now.UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
}

// fillWindow emits one entry per day of the window, including the days with no events.
//
// The client must never have to invent the gaps: an area chart with missing days interpolates
// across them, which silently turns a quiet Tuesday into a slope between Monday and Wednesday.
// Emitting the zeros here is what makes the chart honest, and it costs a fixed `days` entries
// however much history the account has.
func fillWindow(start time.Time, days int, byDay map[string]int) []DayCount {
	out := make([]DayCount, 0, days)
	for i := 0; i < days; i++ {
		d := start.AddDate(0, 0, i).Format(dayFormat)
		out = append(out, DayCount{Date: d, Count: byDay[d]})
	}
	return out
}

// parseWindowDays clamps the window. An unparseable or out-of-range value falls back to the
// default rather than erroring: this drives a chart, and a broken query string should not turn the
// panel into an error card.
func parseWindowDays(raw string) int {
	if raw == "" {
		return defaultSummaryDays
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > maxSummaryDays {
		return defaultSummaryDays
	}
	return n
}

package notify

import (
	"net/http"
	"network_automation/services/notify"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// Alert history and the page's summary tiles.
//
// The history is deliberately the record of what this platform DECIDED and what became of the
// send — including the sends that failed. A notification page that only lists successes reads as
// quiet for the same reason a disconnected smoke alarm does.

const (
	defaultEventLimit = 50
	maxEventLimit     = 200
)

// GET /notify/events?state=&kind=&device_id=&limit=&offset=
func ListEvents(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	q := db.Model(&entity.NotifyEvent{})
	if v := strings.TrimSpace(c.Query("state")); v != "" {
		q = q.Where("state = ?", v)
	}
	if v := strings.TrimSpace(c.Query("kind")); v != "" {
		q = q.Where("kind = ?", v)
	}
	if v := strings.TrimSpace(c.Query("severity")); v != "" {
		q = q.Where("severity = ?", v)
	}
	if v := strings.TrimSpace(c.Query("device_id")); v != "" {
		if id, err := strconv.Atoi(v); err == nil && id > 0 {
			q = q.Where("network_device_id = ?", id)
		}
	}

	var total int64
	q.Count(&total)

	limit := defaultEventLimit
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > maxEventLimit {
		limit = maxEventLimit
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	var rows []entity.NotifyEvent
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the alert history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": rows, "total": total, "limit": limit, "offset": offset,
	})
}

// DELETE /notify/events?before_days=N — clear old history.
//
// before_days rather than "delete everything": a history page with a button that empties the record
// in one click is a button somebody presses by accident. The default keeps the last week.
func ClearEvents(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	days := 7
	if v, err := strconv.Atoi(c.Query("before_days")); err == nil && v >= 0 {
		days = v
	}
	cutoff := time.Now().AddDate(0, 0, -days)

	res := config.DB().Unscoped().Where("created_at < ?", cutoff).Delete(&entity.NotifyEvent{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear the history"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": res.RowsAffected, "before_days": days})
}

// GET /notify/overview — the tiles at the top of the page.
type overview struct {
	Rules        int64 `json:"rules"`
	RulesEnabled int64 `json:"rules_enabled"`
	Firing       int64 `json:"firing"`
	Channels     int64 `json:"channels"`
	Recipients   int64 `json:"recipients"`

	Events24h   int64 `json:"events_24h"`
	Failed24h   int64 `json:"failed_24h"`
	PollSeconds int   `json:"poll_seconds"`

	// SMTPReady and LINEReady are what the page uses to say, plainly, whether anything could
	// actually be delivered right now. A rules list that looks healthy while no channel can send is
	// the failure mode this whole page exists to avoid.
	SMTPReady bool   `json:"smtp_ready"`
	SMTPError string `json:"smtp_error,omitempty"`
	LINEReady bool   `json:"line_ready"`
}

func Overview(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()
	var o overview
	o.PollSeconds = int(notify.NotifyPollInterval.Seconds())

	db.Model(&entity.NotifyRule{}).Count(&o.Rules)
	db.Model(&entity.NotifyRule{}).Where("enabled = ?", true).Count(&o.RulesEnabled)
	db.Model(&entity.NotifyRuleState{}).Where("firing = ?", true).Count(&o.Firing)
	db.Model(&entity.NotifyChannel{}).Count(&o.Channels)
	db.Model(&entity.NotifyRecipient{}).Count(&o.Recipients)

	since := time.Now().Add(-24 * time.Hour)
	db.Model(&entity.NotifyEvent{}).Where("created_at >= ?", since).Count(&o.Events24h)
	db.Model(&entity.NotifyEvent{}).
		Where("created_at >= ? AND delivery_status IN ?", since,
			[]string{entity.NotifyDeliveryFailed, entity.NotifyDeliveryPartial, entity.NotifyDeliveryNoRecipients}).
		Count(&o.Failed24h)

	if _, err := platform.SMTPSender(db); err != nil {
		o.SMTPError = err.Error()
	} else {
		o.SMTPReady = true
	}

	var lineReady int64
	db.Model(&entity.NotifyChannel{}).
		Where("type = ? AND enabled = ? AND secret_enc <> ''", entity.NotifyChannelLINE, true).
		Count(&lineReady)
	o.LINEReady = lineReady > 0

	c.JSON(http.StatusOK, gin.H{"data": o})
}

// POST /notify/run — run one sweep now, instead of waiting for the scheduler.
//
// Not a debugging leftover: after writing a rule the honest question is "does this fire on what my
// firewall is doing right now", and the alternative to this button is waiting up to a minute and
// then guessing why nothing happened.
func RunNow(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	res := notify.RunNotifySweep(config.DB(), time.Now())
	c.JSON(http.StatusOK, gin.H{"data": res})
}

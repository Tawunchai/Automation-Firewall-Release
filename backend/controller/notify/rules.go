package notify

import (
	"net/http"
	"network_automation/services/notify"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"network_automation/config"
	"network_automation/entity"
)

// Alert rules — the CRUD, plus the two things that make a rule page honest: a catalogue endpoint so
// the form is built from what the poller can actually measure, and a "test this rule" that sends a
// real message through the real channel.

// GET /notify/kinds — what can be watched, and what each threshold means.
func ListKinds(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"data": notify.NotifyKinds,
		// The interval is on the response because it is what a "sustained for N polls" setting is
		// counted in. A form that says "2 polls" without saying how long a poll is has not told the
		// user anything.
		"poll_seconds": int(notify.NotifyPollInterval.Seconds()),
	})
}

// ── views ────────────────────────────────────────────────────────────────────

type ruleView struct {
	ID      uint   `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Enabled bool   `json:"enabled"`

	NetworkDeviceID uint   `json:"network_device_id"`
	DeviceName      string `json:"device_name"`

	Subjects        string  `json:"subjects"`
	Threshold       float64 `json:"threshold"`
	SustainedPolls  int     `json:"sustained_polls"`
	CooldownMinutes int     `json:"cooldown_minutes"`
	NotifyOnResolve bool    `json:"notify_on_resolve"`
	Severity        string  `json:"severity"`

	RecipientIDs []uint          `json:"recipient_ids"`
	Recipients   []recipientView `json:"recipients"`

	// Firing is how many subjects this rule is currently in alarm on — the state table, surfaced.
	// It is what turns the rules list into a status board rather than a settings page.
	Firing    int       `json:"firing"`
	CreatedAt time.Time `json:"created_at"`
}

func toRuleView(r entity.NotifyRule, deviceName string, channels map[uint]entity.NotifyChannel, firing int) ruleView {
	v := ruleView{
		ID: r.ID, Name: r.Name, Kind: r.Kind, Enabled: r.Enabled,
		NetworkDeviceID: r.NetworkDeviceID, DeviceName: deviceName,
		Subjects: r.Subjects, Threshold: r.Threshold,
		SustainedPolls: r.SustainedPolls, CooldownMinutes: r.CooldownMinutes,
		NotifyOnResolve: r.NotifyOnResolve, Severity: r.Severity,
		RecipientIDs: make([]uint, 0, len(r.Recipients)),
		Recipients:   make([]recipientView, 0, len(r.Recipients)),
		Firing:       firing, CreatedAt: r.CreatedAt,
	}
	for _, rec := range r.Recipients {
		v.RecipientIDs = append(v.RecipientIDs, rec.ID)
		v.Recipients = append(v.Recipients, toRecipientView(rec, channels[rec.NotifyChannelID]))
	}
	return v
}

// GET /notify/rules
func ListRules(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	var rules []entity.NotifyRule
	if err := db.Preload("Recipients").Order("id ASC").Find(&rules).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the alert rules"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": buildRuleViews(db, rules)})
}

func buildRuleViews(db *gorm.DB, rules []entity.NotifyRule) []ruleView {
	channels := notify.LoadNotifyChannelMap(db)

	deviceNames := map[uint]string{}
	var devices []entity.NetworkDevice
	db.Find(&devices)
	for _, d := range devices {
		deviceNames[d.ID] = d.Name + " (" + d.MgmtIP + ")"
	}

	firing := map[uint]int{}
	var counts []struct {
		NotifyRuleID uint
		N            int
	}
	db.Model(&entity.NotifyRuleState{}).
		Select("notify_rule_id, COUNT(*) AS n").
		Where("firing = ?", true).
		Group("notify_rule_id").Scan(&counts)
	for _, row := range counts {
		firing[row.NotifyRuleID] = row.N
	}

	out := make([]ruleView, 0, len(rules))
	for _, r := range rules {
		name := "All devices"
		if r.NetworkDeviceID > 0 {
			name = deviceNames[r.NetworkDeviceID]
			if name == "" {
				name = "(deleted device)"
			}
		}
		out = append(out, toRuleView(r, name, channels, firing[r.ID]))
	}
	return out
}

// ── create / update ──────────────────────────────────────────────────────────

type ruleInput struct {
	Name            string   `json:"name"`
	Kind            string   `json:"kind"`
	Enabled         *bool    `json:"enabled"`
	NetworkDeviceID *uint    `json:"network_device_id"`
	Subjects        *string  `json:"subjects"`
	Threshold       *float64 `json:"threshold"`
	SustainedPolls  *int     `json:"sustained_polls"`
	CooldownMinutes *int     `json:"cooldown_minutes"`
	NotifyOnResolve *bool    `json:"notify_on_resolve"`
	Severity        *string  `json:"severity"`
	RecipientIDs    []uint   `json:"recipient_ids"`
}

// normaliseRule clamps the numbers a rule can be given.
//
// The caps are not arbitrary. SustainedPolls above 60 means an hour before anyone is told; cooldown
// above a day means one message per outage, which is indistinguishable from a broken rule. Both are
// far outside anything useful and inside the range a fat finger can produce.
func normaliseRule(r *entity.NotifyRule, kind notify.NotifyKindInfo) {
	if r.SustainedPolls < 1 {
		r.SustainedPolls = 1
	}
	if r.SustainedPolls > 60 {
		r.SustainedPolls = 60
	}
	if r.CooldownMinutes < 0 {
		r.CooldownMinutes = 0
	}
	if r.CooldownMinutes > 1440 {
		r.CooldownMinutes = 1440
	}
	if !kind.HasThreshold {
		r.Threshold = 0
	} else {
		if r.Threshold <= 0 {
			r.Threshold = kind.ThresholdDefault
		}
		if kind.ThresholdMin > 0 && r.Threshold < kind.ThresholdMin {
			r.Threshold = kind.ThresholdMin
		}
		if kind.ThresholdMax > 0 && r.Threshold > kind.ThresholdMax {
			r.Threshold = kind.ThresholdMax
		}
	}
	if !kind.HasSubjects {
		r.Subjects = ""
	}
	if !notify.IsValidNotifySeverity(r.Severity) {
		r.Severity = kind.DefaultSeverity
	}
}

// POST /notify/rules
func CreateRule(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var in ruleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	kind, ok := notify.NotifyKindByName(strings.TrimSpace(in.Kind))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown alert type"})
		return
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = kind.Title
	}

	db := config.DB()
	rule := entity.NotifyRule{
		Name: name, Kind: kind.Kind,
		Enabled:         in.Enabled == nil || *in.Enabled,
		SustainedPolls:  2,
		CooldownMinutes: 30,
		NotifyOnResolve: true,
		Severity:        kind.DefaultSeverity,
		Threshold:       kind.ThresholdDefault,
	}
	applyRuleInput(&rule, in)

	if rule.NetworkDeviceID > 0 {
		var d entity.NetworkDevice
		if err := db.First(&d, rule.NetworkDeviceID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device not found"})
			return
		}
	}
	normaliseRule(&rule, kind)

	recipients, err := loadRecipients(db, in.RecipientIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule.Recipients = recipients

	if err := db.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the rule"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": firstOrEmpty(buildRuleViews(db, []entity.NotifyRule{rule}))})
}

func applyRuleInput(rule *entity.NotifyRule, in ruleInput) {
	if in.NetworkDeviceID != nil {
		rule.NetworkDeviceID = *in.NetworkDeviceID
	}
	if in.Subjects != nil {
		// Re-joined from the parsed list so the stored value is always "a,b,c" — the poller
		// compares against it, and " a , b " would silently never match a port called "a".
		rule.Subjects = strings.Join(notify.ParseNotifySubjects(*in.Subjects), ",")
	}
	if in.Threshold != nil {
		rule.Threshold = *in.Threshold
	}
	if in.SustainedPolls != nil {
		rule.SustainedPolls = *in.SustainedPolls
	}
	if in.CooldownMinutes != nil {
		rule.CooldownMinutes = *in.CooldownMinutes
	}
	if in.NotifyOnResolve != nil {
		rule.NotifyOnResolve = *in.NotifyOnResolve
	}
	if in.Severity != nil {
		rule.Severity = strings.TrimSpace(*in.Severity)
	}
}

// PATCH /notify/rules/:id
func UpdateRule(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}
	var in ruleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	db := config.DB()
	var rule entity.NotifyRule
	if err := db.Preload("Recipients").First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	// The kind is fixed after creation. Its threshold, its subjects and its stored state all mean
	// different things per kind, so "change the kind" is "delete and recreate" wearing a disguise.
	kind, _ := notify.NotifyKindByName(rule.Kind)

	before := rule
	if name := strings.TrimSpace(in.Name); name != "" {
		rule.Name = name
	}
	if in.Enabled != nil {
		rule.Enabled = *in.Enabled
	}
	applyRuleInput(&rule, in)

	if rule.NetworkDeviceID > 0 && rule.NetworkDeviceID != before.NetworkDeviceID {
		var d entity.NetworkDevice
		if err := db.First(&d, rule.NetworkDeviceID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device not found"})
			return
		}
	}
	normaliseRule(&rule, kind)

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&entity.NotifyRule{}).Where("id = ?", rule.ID).Updates(map[string]any{
			"name":              rule.Name,
			"enabled":           rule.Enabled,
			"network_device_id": rule.NetworkDeviceID,
			"subjects":          rule.Subjects,
			"threshold":         rule.Threshold,
			"sustained_polls":   rule.SustainedPolls,
			"cooldown_minutes":  rule.CooldownMinutes,
			"notify_on_resolve": rule.NotifyOnResolve,
			"severity":          rule.Severity,
		}).Error; err != nil {
			return err
		}
		if in.RecipientIDs == nil {
			return nil
		}
		recipients, err := loadRecipients(tx, in.RecipientIDs)
		if err != nil {
			return err
		}
		return tx.Model(&entity.NotifyRule{Base: entity.Base{ID: rule.ID}}).
			Association("Recipients").Replace(recipients)
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Anything that changes what the rule MEANS invalidates its memory. Without this, raising a CPU
	// threshold from 70% to 95% leaves the rule marked as firing, and the next healthy poll
	// announces a recovery from an alert that no longer exists.
	if before.Threshold != rule.Threshold ||
		before.NetworkDeviceID != rule.NetworkDeviceID ||
		before.Subjects != rule.Subjects ||
		(before.Enabled && !rule.Enabled) {
		notify.PurgeNotifyStateForRule(db, rule.ID)
	}

	db.Preload("Recipients").First(&rule, id)
	c.JSON(http.StatusOK, gin.H{"data": firstOrEmpty(buildRuleViews(db, []entity.NotifyRule{rule}))})
}

// DELETE /notify/rules/:id
func DeleteRule(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	var rule entity.NotifyRule
	if err := db.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM notify_rule_recipients WHERE notify_rule_id = ?", rule.ID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&entity.NotifyRule{}, rule.ID).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove the rule"})
		return
	}
	// The history rows stay: what was sent is a record, and a record that disappears when somebody
	// tidies up the rules is not one. Only the live state goes.
	notify.PurgeNotifyStateForRule(db, rule.ID)

	c.JSON(http.StatusOK, gin.H{"message": "rule removed"})
}

// POST /notify/rules/:id/test
//
// Sends the rule's own message text, marked as a test, to the rule's own recipients. It answers the
// question the channel test cannot: "will THIS rule reach anyone", which depends on the recipients
// attached to it, not merely on the channel being alive.
func TestRule(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	var rule entity.NotifyRule
	if err := db.Preload("Recipients").First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	channels := notify.LoadNotifyChannelMap(db)
	targets := notify.ResolveNotifyTargets(rule.Recipients, channels)
	if len(targets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "this rule has no enabled recipient on an enabled channel — nothing would be sent",
		})
		return
	}

	kind, _ := notify.NotifyKindByName(rule.Kind)
	title := "🧪 Test — " + rule.Name
	lines := []string{
		"This is a test of an alert rule. Nothing is wrong.",
		"Check: " + kind.Title,
		"Severity: " + rule.Severity,
		"Fires after " + strconv.Itoa(rule.SustainedPolls) + " consecutive polls (" +
			strconv.Itoa(rule.SustainedPolls*int(notify.NotifyPollInterval.Seconds())) + "s)",
		"Sent by: " + c.GetString("user_email"),
		"Time: " + time.Now().Format("2006-01-02 15:04:05 MST"),
	}

	sent, failed := 0, 0
	var firstErr string
	for _, t := range targets {
		var ch entity.NotifyChannel
		if err := db.First(&ch, t.ChannelID).Error; err != nil {
			failed++
			continue
		}
		var rec entity.NotifyRecipient
		if err := db.First(&rec, t.RecipientID).Error; err != nil {
			failed++
			continue
		}
		if err := notify.SendNotifyToRecipient(db, ch, rec, title, lines); err != nil {
			failed++
			if firstErr == "" {
				firstErr = err.Error()
			}
			continue
		}
		sent++
	}

	c.JSON(http.StatusOK, gin.H{
		"status": notify.SummariseDelivery(len(targets), failed),
		"sent":   sent, "failed": failed, "error": firstErr,
	})
}

// ── helpers ──────────────────────────────────────────────────────────────────

// loadRecipients resolves the ids a rule was given, refusing any that do not exist.
//
// Silently dropping an unknown id would produce a rule the admin believes reaches five people and
// which actually reaches four — the failure would only surface during an incident.
func loadRecipients(db *gorm.DB, ids []uint) ([]entity.NotifyRecipient, error) {
	out := []entity.NotifyRecipient{}
	clean := []uint{}
	seen := map[uint]bool{}
	for _, id := range ids {
		if id == 0 || seen[id] {
			continue
		}
		seen[id] = true
		clean = append(clean, id)
	}
	if len(clean) == 0 {
		return out, nil
	}
	if err := db.Where("id IN ?", clean).Find(&out).Error; err != nil {
		return nil, err
	}
	if len(out) != len(clean) {
		return nil, errRecipientMissing
	}
	return out, nil
}

var errRecipientMissing = &recipientMissingError{}

type recipientMissingError struct{}

func (e *recipientMissingError) Error() string {
	return "one of the selected recipients no longer exists — reopen the rule and pick again"
}

func firstOrEmpty(views []ruleView) any {
	if len(views) == 0 {
		return nil
	}
	return views[0]
}

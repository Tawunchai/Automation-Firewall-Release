// Package notify is the API behind /admin/notify — Notify Management.
//
// Every route is admin-only. Two reasons, and the second is the real one: a channel holds a LINE bot
// token, which can post as the bot to everyone who ever added it; and a rule decides who gets woken
// up at 3am, which is an operational decision, not a personal preference.
package notify

import (
	"errors"
	"net/http"
	"net/mail"
	"network_automation/services/notify"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

func requireAdmin(c *gin.Context) bool {
	if c.GetString("user_role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

func pathID(c *gin.Context) (uint, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return 0, false
	}
	return uint(id), true
}

// ── views ────────────────────────────────────────────────────────────────────

// channelView is the shape sent to the browser. Note what is absent: the access token never leaves
// this process once it has been stored. HasToken is what the form uses to show "configured" without
// ever putting the secret back in an input the browser can read.
type channelView struct {
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Enabled     bool   `json:"enabled"`
	Description string `json:"description"`
	HasToken    bool   `json:"has_token"`

	LastTestedAt   *time.Time `json:"last_tested_at"`
	LastTestStatus string     `json:"last_test_status"`
	LastTestError  string     `json:"last_test_error"`

	RecipientCount int             `json:"recipient_count"`
	Recipients     []recipientView `json:"recipients"`
	CreatedAt      time.Time       `json:"created_at"`
}

type recipientView struct {
	ID              uint   `json:"id"`
	NotifyChannelID uint   `json:"notify_channel_id"`
	ChannelName     string `json:"channel_name"`
	ChannelType     string `json:"channel_type"`
	Name            string `json:"name"`
	Target          string `json:"target"`
	IsGroup         bool   `json:"is_group"`
	Enabled         bool   `json:"enabled"`
}

func toRecipientView(r entity.NotifyRecipient, ch entity.NotifyChannel) recipientView {
	return recipientView{
		ID: r.ID, NotifyChannelID: r.NotifyChannelID,
		ChannelName: ch.Name, ChannelType: ch.Type,
		Name: r.Name, Target: r.Target, IsGroup: r.IsGroup, Enabled: r.Enabled,
	}
}

func toChannelView(ch entity.NotifyChannel) channelView {
	v := channelView{
		ID: ch.ID, Name: ch.Name, Type: ch.Type, Enabled: ch.Enabled,
		Description: ch.Description, HasToken: strings.TrimSpace(ch.SecretEnc) != "",
		LastTestedAt: ch.LastTestedAt, LastTestStatus: ch.LastTestStatus, LastTestError: ch.LastTestError,
		RecipientCount: len(ch.Recipients), CreatedAt: ch.CreatedAt,
		Recipients: make([]recipientView, 0, len(ch.Recipients)),
	}
	for _, r := range ch.Recipients {
		v.Recipients = append(v.Recipients, toRecipientView(r, ch))
	}
	return v
}

// ── channels ─────────────────────────────────────────────────────────────────

// GET /notify/channels
func ListChannels(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var rows []entity.NotifyChannel
	if err := config.DB().Preload("Recipients", func(db *gorm.DB) *gorm.DB {
		return db.Order("name ASC")
	}).Order("id ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the notification channels"})
		return
	}
	out := make([]channelView, 0, len(rows))
	for _, ch := range rows {
		out = append(out, toChannelView(ch))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type channelInput struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Enabled     *bool  `json:"enabled"`
	// Token is write-only. On an update, empty means "leave the stored one alone" — the browser
	// never had it to send back, so demanding it would make renaming a channel impossible without
	// re-issuing the bot token.
	Token string `json:"token"`
}

// POST /notify/channels
func CreateChannel(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var in channelInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	in.Type = strings.ToLower(strings.TrimSpace(in.Type))
	in.Token = strings.TrimSpace(in.Token)

	if in.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "give the channel a name"})
		return
	}
	if in.Type != entity.NotifyChannelLINE && in.Type != entity.NotifyChannelEmail {
		c.JSON(http.StatusBadRequest, gin.H{"error": `type must be "line" or "email"`})
		return
	}
	if in.Type == entity.NotifyChannelLINE && in.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a LINE channel needs its Messaging API access token"})
		return
	}

	db := config.DB()
	if in.Type == entity.NotifyChannelEmail {
		// Fail here rather than at 3am. An email channel sends through the console's own SMTP
		// account, and creating one before that exists produces a channel that looks configured and
		// silently delivers nothing.
		if _, err := platform.SMTPSender(db); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	ch := entity.NotifyChannel{
		Name: in.Name, Type: in.Type, Description: strings.TrimSpace(in.Description),
		Enabled: in.Enabled == nil || *in.Enabled,
	}
	if in.Token != "" {
		enc, err := platform.EncryptSecret(in.Token)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not encrypt the access token"})
			return
		}
		ch.SecretEnc = enc
	}

	if err := db.Create(&ch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the channel"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": toChannelView(ch)})
}

// PATCH /notify/channels/:id
func UpdateChannel(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}
	var in channelInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	db := config.DB()
	var ch entity.NotifyChannel
	if err := db.First(&ch, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	updates := map[string]any{}
	if name := strings.TrimSpace(in.Name); name != "" {
		updates["name"] = name
	}
	if in.Description != "" || in.Name != "" {
		updates["description"] = strings.TrimSpace(in.Description)
	}
	if in.Enabled != nil {
		updates["enabled"] = *in.Enabled
	}
	// The type is fixed once created: recipients hang off it and an email address is not a LINE id,
	// so flipping it would leave every recipient undeliverable while still looking valid.
	if token := strings.TrimSpace(in.Token); token != "" {
		enc, err := platform.EncryptSecret(token)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not encrypt the access token"})
			return
		}
		updates["secret_enc"] = enc
		// A rotated token invalidates what the last test proved.
		updates["last_test_status"] = ""
		updates["last_test_error"] = ""
		updates["last_tested_at"] = nil
	}

	if len(updates) > 0 {
		if err := db.Model(&entity.NotifyChannel{}).Where("id = ?", ch.ID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the channel"})
			return
		}
	}

	db.Preload("Recipients").First(&ch, id)
	c.JSON(http.StatusOK, gin.H{"data": toChannelView(ch)})
}

// DELETE /notify/channels/:id
func DeleteChannel(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	var ch entity.NotifyChannel
	if err := db.First(&ch, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	// Recipients belong to the channel and are meaningless without it, so they go too — including
	// their rows in the rule join table, which would otherwise leave rules pointing at recipients
	// that no longer exist and reporting "no-recipients" without saying why.
	var recipientIDs []uint
	db.Model(&entity.NotifyRecipient{}).Where("notify_channel_id = ?", id).Pluck("id", &recipientIDs)

	err := db.Transaction(func(tx *gorm.DB) error {
		if len(recipientIDs) > 0 {
			if err := tx.Exec("DELETE FROM notify_rule_recipients WHERE notify_recipient_id IN ?", recipientIDs).Error; err != nil {
				return err
			}
		}
		if err := tx.Unscoped().Where("notify_channel_id = ?", id).Delete(&entity.NotifyRecipient{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&entity.NotifyChannel{}, id).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove the channel"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "channel removed"})
}

// ── recipients ───────────────────────────────────────────────────────────────

// GET /notify/recipients
func ListRecipients(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	var channels []entity.NotifyChannel
	db.Find(&channels)
	byID := make(map[uint]entity.NotifyChannel, len(channels))
	for _, ch := range channels {
		byID[ch.ID] = ch
	}

	var rows []entity.NotifyRecipient
	if err := db.Order("notify_channel_id ASC, name ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the recipients"})
		return
	}
	out := make([]recipientView, 0, len(rows))
	for _, r := range rows {
		out = append(out, toRecipientView(r, byID[r.NotifyChannelID]))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type recipientInput struct {
	NotifyChannelID uint   `json:"notify_channel_id"`
	Name            string `json:"name"`
	Target          string `json:"target"`
	IsGroup         *bool  `json:"is_group"`
	Enabled         *bool  `json:"enabled"`
}

// ValidateRecipientTarget checks a destination against its channel type.
//
// Exported, and pure, because this is the check that decides whether an alert has anywhere to go —
// and the failure it prevents (a LINE display name pasted into the id field) produces a 400 from
// LINE months later, in the middle of the outage the alert was meant to report.
func ValidateRecipientTarget(channelType, target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return errors.New("a destination is required")
	}
	switch channelType {
	case entity.NotifyChannelEmail:
		if _, err := mail.ParseAddress(target); err != nil {
			return errors.New("that is not a valid email address")
		}
	case entity.NotifyChannelLINE:
		if !platform.LooksLikeLineTarget(target) {
			return errors.New(`a LINE destination is a userId, groupId or roomId — "U…", "C…" or "R…" followed by 32 hex characters, not a display name`)
		}
	default:
		return errors.New("unknown channel type")
	}
	return nil
}

// POST /notify/recipients
func CreateRecipient(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var in recipientInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	db := config.DB()
	var ch entity.NotifyChannel
	if err := db.First(&ch, in.NotifyChannelID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "choose a channel first"})
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	in.Target = strings.TrimSpace(in.Target)
	if in.Name == "" {
		in.Name = in.Target
	}
	if err := ValidateRecipientTarget(ch.Type, in.Target); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	r := entity.NotifyRecipient{
		NotifyChannelID: ch.ID, Name: in.Name, Target: in.Target,
		IsGroup: in.IsGroup != nil && *in.IsGroup,
		Enabled: in.Enabled == nil || *in.Enabled,
	}
	if err := db.Create(&r).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the recipient"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": toRecipientView(r, ch)})
}

// PATCH /notify/recipients/:id
func UpdateRecipient(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}
	var in recipientInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	db := config.DB()
	var r entity.NotifyRecipient
	if err := db.First(&r, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
		return
	}
	var ch entity.NotifyChannel
	if err := db.First(&ch, r.NotifyChannelID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the channel this recipient belongs to is gone"})
		return
	}

	updates := map[string]any{}
	if name := strings.TrimSpace(in.Name); name != "" {
		updates["name"] = name
	}
	if target := strings.TrimSpace(in.Target); target != "" {
		if err := ValidateRecipientTarget(ch.Type, target); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updates["target"] = target
	}
	if in.IsGroup != nil {
		updates["is_group"] = *in.IsGroup
	}
	if in.Enabled != nil {
		updates["enabled"] = *in.Enabled
	}

	if len(updates) > 0 {
		if err := db.Model(&entity.NotifyRecipient{}).Where("id = ?", r.ID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the recipient"})
			return
		}
	}
	db.First(&r, id)
	c.JSON(http.StatusOK, gin.H{"data": toRecipientView(r, ch)})
}

// DELETE /notify/recipients/:id
func DeleteRecipient(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}
	db := config.DB()
	var r entity.NotifyRecipient
	if err := db.First(&r, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
		return
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM notify_rule_recipients WHERE notify_recipient_id = ?", r.ID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&entity.NotifyRecipient{}, r.ID).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove the recipient"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "recipient removed"})
}

// ── test send ────────────────────────────────────────────────────────────────

// POST /notify/channels/:id/test — send a real message to every enabled recipient of one channel.
//
// The whole point is that it is REAL: it uses the stored token, the stored SMTP account and the
// stored destinations. A test that stubbed any of those would pass on exactly the configurations
// that fail in production.
func TestChannel(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	var ch entity.NotifyChannel
	if err := db.Preload("Recipients").First(&ch, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}

	enabled := make([]entity.NotifyRecipient, 0, len(ch.Recipients))
	for _, r := range ch.Recipients {
		if r.Enabled {
			enabled = append(enabled, r)
		}
	}
	if len(enabled) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this channel has no enabled recipient to send to"})
		return
	}

	title := "✅ Notify test — FortiGate automation console"
	lines := []string{
		"This is a test message from Notify Management.",
		"Channel: " + ch.Name,
		"Sent by: " + c.GetString("user_email"),
		"Time: " + time.Now().Format("2006-01-02 15:04:05 MST"),
	}

	type result struct {
		Recipient string `json:"recipient"`
		OK        bool   `json:"ok"`
		Error     string `json:"error,omitempty"`
	}
	results := make([]result, 0, len(enabled))
	failed := 0
	var firstErr string
	for _, r := range enabled {
		err := notify.SendNotifyToRecipient(db, ch, r, title, lines)
		if err != nil {
			failed++
			if firstErr == "" {
				firstErr = err.Error()
			}
			results = append(results, result{Recipient: r.Name, OK: false, Error: err.Error()})
			continue
		}
		results = append(results, result{Recipient: r.Name, OK: true})
	}

	now := time.Now()
	status := "ok"
	if failed > 0 {
		status = "fail"
	}
	db.Model(&entity.NotifyChannel{}).Where("id = ?", ch.ID).Updates(map[string]any{
		"last_tested_at":   &now,
		"last_test_status": status,
		"last_test_error":  platform.TruncateUTF8(firstErr, 500),
	})

	c.JSON(http.StatusOK, gin.H{
		"status":  notify.SummariseDelivery(len(enabled), failed),
		"sent":    len(enabled) - failed,
		"failed":  failed,
		"results": results,
	})
}

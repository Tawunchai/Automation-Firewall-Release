package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// SIEM export (Phase C1) — streaming every Change Ledger row to an external webhook as it is
// written, so a security team's own SIEM (Splunk, QRadar, Elastic, …) has a copy of this console's
// audit trail that survives this app's own database being unavailable or tampered with.
//
// ── Why a webhook, not syslog ─────────────────────────────────────────────────
//
// Syslog (RFC 5424 / CEF) is the format most SIEMs expect natively, and it was the first option
// considered. It was set aside for v1 for a concrete reason: syslog is UDP-first, has no delivery
// acknowledgement, and the common CEF/LEEF framing is a format most SIEMs CAN also ingest via a
// generic HTTP/webhook collector (Splunk HEC, Elastic's HTTP input, Sentinel's Logic App connector,
// a plain log-shipper like Fluentd in front of anything else) — so a JSON POST reaches the same
// destinations with a response code to detect failure, at a fraction of the implementation and
// testing cost of a correct syslog framer. A syslog/CEF sender is a reasonable follow-up once a real
// SIEM is named to test against; shipping a webhook nobody can verify works is worse than not
// shipping syslog yet.
//
// ── Why this is not a Notify channel ──────────────────────────────────────────
//
// Notify (controller/notify) already has an external-destination concept — channels, recipients,
// rules — and reusing it was the first design considered. It does not fit: a Notify RULE is
// evaluated periodically against device STATE ("is this port down right now") and fires an alert
// when a condition holds. SIEM export is not a condition — it is every ledger row, unconditionally,
// as it happens. Bending the rule/recipient model to mean "always true, fire continuously" would
// make Notify's own rules harder to read for the one shape they already handle well. A separate,
// much smaller setting (enabled + one URL) says what this is more honestly than forcing it through
// a bigger system built for a different question.

// SIEMExportConfig is the whole of the setting: a destination and whether it is live.
type SIEMExportConfig struct {
	Enabled    bool
	WebhookURL string
}

func GetSIEMExportConfig(db *gorm.DB) SIEMExportConfig {
	if db == nil {
		return SIEMExportConfig{}
	}
	return SIEMExportConfig{
		Enabled:    getPolicyCfg(db, "siem_export_enabled", "false") == "true",
		WebhookURL: getPolicyCfg(db, "siem_export_webhook_url", ""),
	}
}

// SetSIEMExportConfig stores the setting. Turning it on with no URL is refused by the controller,
// not here — this just writes what it is given, the same split every other SystemConfig-backed
// setting in this codebase uses (see password-policy, retention.go's SetAuditRetentionDays).
func SetSIEMExportConfig(db *gorm.DB, enabled bool, webhookURL string) error {
	enabledStr := "false"
	if enabled {
		enabledStr = "true"
	}
	if err := upsertSystemConfig(db, "siem_export_enabled", enabledStr); err != nil {
		return err
	}
	return upsertSystemConfig(db, "siem_export_webhook_url", webhookURL)
}

func upsertSystemConfig(db *gorm.DB, key, value string) error {
	var cfg entity.SystemConfig
	if err := db.Where("key = ?", key).First(&cfg).Error; err != nil {
		return db.Create(&entity.SystemConfig{Key: key, Value: value}).Error
	}
	return db.Model(&cfg).Update("value", value).Error
}

// SIEMEvent is one Change Ledger row, shaped for an external reader that has never seen this
// app's schema — field names spelled out rather than reused from entity.ChangeRecord's JSON tags,
// so a later rename of the internal column never silently changes what a SIEM's parser expects.
type SIEMEvent struct {
	EventType    string    `json:"event_type"` // constant "fortigate_console.change" — lets one webhook endpoint carry other event types later
	Timestamp    time.Time `json:"timestamp"`
	DeviceID     uint      `json:"device_id"`
	DeviceName   string    `json:"device_name"`
	UserEmail    string    `json:"user_email"`
	Action       string    `json:"action"`        // create | update | delete
	ResourceType string    `json:"resource_type"` // e.g. "firewall-policy"
	ResourceKey  string    `json:"resource_key"`
	Method       string    `json:"method"`
	Path         string    `json:"path"`
	Status       string    `json:"status"` // applied | failed — a failed write is sent too; a rejected change attempt is itself a security-relevant fact
	ErrorText    string    `json:"error_text,omitempty"`
}

// BuildSIEMEvent is the pure half — no network, no database — so the shape sent out is tested
// without a live webhook.
func BuildSIEMEvent(rec entity.ChangeRecord, deviceName string) SIEMEvent {
	return SIEMEvent{
		EventType:    "fortigate_console.change",
		Timestamp:    rec.CreatedAt,
		DeviceID:     rec.NetworkDeviceID,
		DeviceName:   deviceName,
		UserEmail:    rec.UserEmail,
		Action:       rec.Action,
		ResourceType: rec.ResourceType,
		ResourceKey:  rec.ResourceKey,
		Method:       rec.Method,
		Path:         rec.Path,
		Status:       rec.Status,
		ErrorText:    rec.ErrorText,
	}
}

// siemHTTPClient has a short timeout: this is a fire-and-forget export running in its own
// goroutine, but "forget" still has to mean "give up" rather than "hang a goroutine forever" on a
// webhook receiver that never answers.
var siemHTTPClient = &http.Client{Timeout: 5 * time.Second}

// webhookDestinationCheck is a var for one reason: httptest binds to 127.0.0.1, which this check
// refuses by design, so the tests that exercise the POST itself replace it. The rule it stands for
// has its own tests in webhookurl_test.go — the seam does not weaken it, it keeps the two
// questions ("does the POST work" and "where may it point") from having to be asked together.
var webhookDestinationCheck = func(raw string) error { return ValidateWebhookURL(raw, nil) }

// SendSIEMEvent POSTs one event as JSON and treats any non-2xx as a failure the caller should log.
//
// The destination is re-checked HERE, not only where the setting was saved: the host is resolved
// at send time, so a name that passed validation when an admin typed it cannot point at the
// instance metadata service by the time this fires. See services/webhookurl.go.
func SendSIEMEvent(webhookURL string, event SIEMEvent) error {
	if err := webhookDestinationCheck(webhookURL); err != nil {
		return err
	}
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("could not encode the event: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := siemHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ExportChangeRecordAsync fires the webhook for one just-written ledger row, if export is on.
//
// Called from middleware.writeRecord right after the row is created. Async and best-effort on
// purpose: a SIEM endpoint that is slow or down must never add latency to a device write, and must
// never turn a successful firewall change into a failed console response — the same reasoning the
// ledger write itself already follows ("the change already happened; losing the record of it is bad,
// failing the response would be worse").
func ExportChangeRecordAsync(db *gorm.DB, rec entity.ChangeRecord) {
	cfg := GetSIEMExportConfig(db)
	if !cfg.Enabled || cfg.WebhookURL == "" {
		return
	}

	var dev entity.NetworkDevice
	deviceName := ""
	if db.First(&dev, rec.NetworkDeviceID).Error == nil {
		deviceName = dev.Name
	}
	event := BuildSIEMEvent(rec, deviceName)

	go func() {
		if err := SendSIEMEvent(cfg.WebhookURL, event); err != nil {
			log.Printf("[siem-export] change %d: %v", rec.ID, err)
		}
	}()
}

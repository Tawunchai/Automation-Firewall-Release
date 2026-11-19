package entity

import "time"

// Notify Management — the alerting side of the console.
//
// Five tables, and each one exists because the other four cannot do its job:
//
//	NotifyChannel    where a message can go      (a LINE bot, or the console's own SMTP account)
//	NotifyRecipient  who inside that channel     (a LINE userId/groupId, or an email address)
//	NotifyRule       what is worth saying        (port down, CPU over 85%, …) + who hears it
//	NotifyRuleState  what we said last time      (so a firewall that is down for a week is one
//	                                              message, not 10,080)
//	NotifyEvent      what was actually sent      (the history page, and the proof it went out)
//
// The split between Rule and RuleState is the important one. Everything else here is CRUD; the
// state table is what makes an alert honest. Without it the poller has no memory across ticks, so
// it can only ever say "this is true right now" — which on a 60-second loop means a flapping port
// pages you sixty times an hour and a resolved one never tells you it recovered.

// ⚠️ NO `gorm:"default:…"` ON ANY BOOL OR INT BELOW.
//
// GORM skips a zero-valued struct field on Create and lets the column default fill it in, so a
// field carrying `default:true` can never be created as false. That is not a theoretical problem
// here — it silently broke three settings at once:
//
//	enabled:false           → the rule was created ENABLED and started paging people
//	cooldown_minutes:0      → stored as 30; "repeat on every check" was unreachable
//	notify_on_resolve:false → stored as true
//
// The defaults live in the controller instead (see notify.CreateRule / CreateChannel /
// CreateRecipient, which apply them when the field is absent from the request rather than when it
// happens to be zero). TestNotifyEntities_HaveNoZeroValueDefaults pins this.

// ── delivery ─────────────────────────────────────────────────────────────────

// Channel types.
const (
	NotifyChannelLINE  = "line"
	NotifyChannelEmail = "email"
)

// NotifyChannel is one way out of the building.
//
// A LINE channel carries its own Messaging API access token. An email channel carries no secret at
// all: it sends through the SMTP account already configured under Service ▸ Email, because a second
// place to type a mail password is a second place for it to be wrong.
type NotifyChannel struct {
	Base

	Name        string `gorm:"not null"        json:"name"`
	Type        string `gorm:"not null;index"  json:"type"` // line | email
	Enabled     bool   `json:"enabled"`
	Description string `gorm:"type:text"       json:"description"`

	// SecretEnc = LINE channel access token, AES-256-GCM (services.EncryptSecret), never in JSON.
	// A long-lived bot token can post as the bot to every user who ever added it, so it is stored
	// exactly like a firewall's admin password rather than as a settings string.
	SecretEnc string `gorm:"type:text" json:"-"`

	// The result of the last "Send test message". Kept for the same reason DeviceCredential keeps
	// one: a token that has been revoked shows no symptom until the night something breaks and the
	// alert silently does not arrive.
	LastTestedAt   *time.Time `json:"last_tested_at"`
	LastTestStatus string     `json:"last_test_status"` // "" (never) | ok | fail
	LastTestError  string     `gorm:"type:text" json:"last_test_error"`

	Recipients []NotifyRecipient `gorm:"foreignKey:NotifyChannelID" json:"recipients,omitempty"`
}

// NotifyRecipient is one destination inside a channel.
type NotifyRecipient struct {
	Base

	NotifyChannelID uint `gorm:"not null;index" json:"notify_channel_id"`

	Name string `gorm:"not null" json:"name"`
	// Target is a LINE userId / groupId / roomId for a line channel, and an email address for an
	// email one. Validated per channel type on the way in — see controller/notify.
	Target  string `gorm:"not null" json:"target"`
	IsGroup bool   `json:"is_group"`
	Enabled bool   `json:"enabled"`

	NotifyChannel *NotifyChannel `gorm:"foreignKey:NotifyChannelID" json:"channel,omitempty"`
}

// ── rules ────────────────────────────────────────────────────────────────────

// Rule kinds. These are the two families the platform polls for: link/reachability, and resource
// thresholds. Each one is a separate constant rather than a flag on one "threshold rule" because
// they read different things off the device and phrase their message differently.
const (
	NotifyKindInterfaceLink     = "interface-link"     // a port's link went down / came back
	NotifyKindDeviceUnreachable = "device-unreachable" // the firewall stopped answering the API
	NotifyKindLicenseExpiry     = "license-expiry"     // a FortiGuard entitlement is running out
	NotifyKindCPUPeak           = "cpu-peak"           // CPU at or above the threshold
	NotifyKindMemoryPeak        = "memory-peak"        // memory at or above the threshold
	NotifyKindSessionSpike      = "session-spike"      // concurrent sessions at or above threshold
	NotifyKindDiskUsage         = "disk-usage"         // log disk at or above the threshold

	// NotifyKindConfigDrift is the odd one out: it reads this platform's OWN database rather than
	// the device. It fires when a backup showed a configuration change that the Change Ledger
	// cannot account for — somebody edited the firewall outside this console. Threshold is the
	// number of outside changes still in place it takes to fire (0 or 1 = any).
	NotifyKindConfigDrift = "config-drift"
)

// Severities, in the order the UI colours them.
const (
	NotifySeverityInfo     = "info"
	NotifySeverityWarning  = "warning"
	NotifySeverityCritical = "critical"
)

// NotifyRule is one thing worth being told about, on one device or on all of them.
type NotifyRule struct {
	Base

	Name    string `gorm:"not null"       json:"name"`
	Kind    string `gorm:"not null;index" json:"kind"`
	Enabled bool   `json:"enabled"`

	// 0 = every FortiGate in the inventory, including ones added after the rule was written. That
	// is the useful default for "tell me when a port goes down": a new branch firewall should be
	// covered the moment it is added, not the moment somebody remembers to edit the rule.
	NetworkDeviceID uint `gorm:"index" json:"network_device_id"`

	// Subjects narrows a rule that produces one signal per thing. For interface-link it is a
	// comma-separated list of port names ("port1,wan1"); empty means every port the device reports
	// a link state for. Ignored by the whole-device kinds.
	Subjects string `json:"subjects"`

	// Threshold's unit depends on the kind: percent for cpu/memory/disk, a session count for
	// session-spike, days remaining for license-expiry. Ignored by the two state kinds.
	Threshold float64 `json:"threshold"`

	// SustainedPolls is how many consecutive breaching polls it takes to fire. This is the setting
	// that separates "the CPU touched 90% for one second while a backup ran" from "the CPU has been
	// pinned for three minutes". 1 = fire on the first breach.
	SustainedPolls int `json:"sustained_polls"`

	// CooldownMinutes is the floor between two FIRING messages for the same subject. It does not
	// suppress the resolve message — being told it came back is never spam.
	CooldownMinutes int `json:"cooldown_minutes"`

	NotifyOnResolve bool   `json:"notify_on_resolve"`
	Severity        string `json:"severity"`

	Recipients []NotifyRecipient `gorm:"many2many:notify_rule_recipients;" json:"recipients,omitempty"`
}

// NotifyRuleState is the poller's memory for one (rule, device, subject).
//
// It lives in the database rather than in the poller's own map so a restart does not re-announce
// every port that is currently down — which is exactly what a `docker compose up -d --build` used
// to be worth in alert noise on systems that got this wrong.
type NotifyRuleState struct {
	Base

	NotifyRuleID    uint   `gorm:"not null;uniqueIndex:idx_notify_rule_state,priority:1" json:"notify_rule_id"`
	NetworkDeviceID uint   `gorm:"not null;uniqueIndex:idx_notify_rule_state,priority:2" json:"network_device_id"`
	Subject         string `gorm:"not null;size:128;uniqueIndex:idx_notify_rule_state,priority:3" json:"subject"`

	// Firing is the announced state, not the instantaneous one: it flips only once a breach has
	// survived SustainedPolls, and back only once the recovery has.
	Firing      bool    `json:"firing"`
	Streak      int     `json:"streak"`       // consecutive breaching polls
	ClearStreak int     `json:"clear_streak"` // consecutive healthy polls
	LastValue   float64 `json:"last_value"`
	LastDetail  string  `json:"last_detail"`

	LastFiredAt *time.Time `json:"last_fired_at"`
	LastSeenAt  *time.Time `json:"last_seen_at"`
}

// ── history ──────────────────────────────────────────────────────────────────

// Event states.
const (
	NotifyStateFiring   = "firing"
	NotifyStateResolved = "resolved"
)

// Delivery outcomes.
const (
	NotifyDeliverySent         = "sent"
	NotifyDeliveryPartial      = "partial"
	NotifyDeliveryFailed       = "failed"
	NotifyDeliveryNoRecipients = "no-recipients"
)

// NotifyEvent is one message this platform decided to send, and what became of it.
//
// The device and rule names are copied in rather than joined at read time: an alert history that
// loses its subject when a rule is renamed or a device is deleted is not a history.
type NotifyEvent struct {
	Base

	NotifyRuleID uint   `gorm:"index" json:"notify_rule_id"`
	RuleName     string `json:"rule_name"`
	Kind         string `gorm:"index" json:"kind"`

	NetworkDeviceID uint   `gorm:"index" json:"network_device_id"`
	DeviceName      string `json:"device_name"`

	Subject  string  `json:"subject"`
	Severity string  `json:"severity"`
	State    string  `gorm:"index" json:"state"` // firing | resolved
	Title    string  `json:"title"`
	Message  string  `gorm:"type:text" json:"message"`
	Value    float64 `json:"value"`

	DeliveryStatus string `json:"delivery_status"`
	Delivered      int    `json:"delivered"`
	Failed         int    `json:"failed"`
	DeliveryDetail string `gorm:"type:text" json:"delivery_detail"`
}

package entity

import "time"

// DriftRun is one comparison of a device's newest backup against the one before it.
//
// A run is written even when it finds nothing. That is deliberate: "we checked at 02:07 and the
// configuration was exactly what we last saw" is the evidence an auditor asks for, and a table
// that only holds bad news cannot distinguish a quiet firewall from a detector that stopped
// running. It is the same reason NotifyEvent records deliveries that failed.
type DriftRun struct {
	Base

	NetworkDeviceID uint           `gorm:"index;not null" json:"network_device_id"`
	NetworkDevice   *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"network_device,omitempty"`

	// The two backups compared. FromBackupID is 0 for a device's first-ever backup, which has
	// nothing to compare against and is recorded as a baseline rather than as a clean run.
	FromBackupID uint `gorm:"index" json:"from_backup_id"`
	ToBackupID   uint `gorm:"index;not null" json:"to_backup_id"`

	// Status: baseline | clean | drift | error.
	Status string `gorm:"index;not null" json:"status"`

	LinesAdded   int `json:"lines_added"`
	LinesRemoved int `json:"lines_removed"`

	// TotalChanges = AttributedCount + DriftCount, at OBJECT granularity (not lines).
	TotalChanges    int `json:"total_changes"`
	AttributedCount int `json:"attributed_count"`
	DriftCount      int `json:"drift_count"`

	Summary   string `json:"summary"`
	ErrorText string `gorm:"type:text" json:"error_text,omitempty"`

	// TriggeredBy is the email of whoever asked for an on-demand run, or "" for the automatic one
	// that follows a backup.
	TriggeredBy string `json:"triggered_by,omitempty"`

	Findings []DriftFinding `gorm:"foreignKey:DriftRunID" json:"findings,omitempty"`
}

// DriftFinding is one object that differed between the two backups.
//
// Attributed rows are stored alongside the unattributed ones rather than discarded, because the
// question people actually ask on an incident is "what changed on this firewall last night", and
// the answer is more useful when it also says which parts were us.
type DriftFinding struct {
	Base

	DriftRunID      uint `gorm:"index;not null" json:"drift_run_id"`
	NetworkDeviceID uint `gorm:"index;not null" json:"network_device_id"`

	// Table is the CLI path as the config file writes it ("firewall address"); CMDBPath is the
	// canonical REST spelling used to join against ChangeRecord.
	Table       string `gorm:"index" json:"table"`
	CMDBPath    string `json:"cmdb_path"`
	ResourceKey string `gorm:"index" json:"resource_key"`

	// Action: created | deleted | modified.
	Action string `gorm:"index;not null" json:"action"`

	// Detail is the ±lines for this object, already trimmed. Not the whole file: a finding is read
	// on a list page and the point is to see the change, not the configuration.
	Detail string `gorm:"type:text" json:"detail"`

	Attributed   bool   `gorm:"index" json:"attributed"`
	AttributedTo string `json:"attributed_to,omitempty"`

	// ── Closed, or still standing ─────────────────────────────────────────────
	//
	// These four used to be a triage flag a person could set: "I looked at this and it is fine."
	// That review workflow was removed, and with it the only way a human could close a finding.
	//
	// The columns stay, and they still mean "this change no longer stands on the firewall" — but
	// they are written in exactly one place now, services.markFindingUndone, when the console takes
	// the change back. `AcknowledgedBy` is therefore whoever pressed Undo, never a reviewer, and
	// `AcknowledgeNote` is what the undo did. They are not serialised to the page any more; the
	// page reads UndoChangeID. Nothing sets them by hand — do not reintroduce a route that does
	// without deciding again whether an unaccounted-for change should be dismissible.
	Acknowledged    bool       `gorm:"index" json:"acknowledged"`
	AcknowledgedBy  string     `json:"acknowledged_by,omitempty"`
	AcknowledgedAt  *time.Time `json:"acknowledged_at,omitempty"`
	AcknowledgeNote string     `json:"acknowledge_note,omitempty"`

	// UndoChangeID is the Change Ledger row that undid this change from the console (an object
	// created outside it, deleted again with Undo). Set only when a delete was actually written —
	// an object that had already vanished closes the finding without one.
	UndoChangeID *uint `gorm:"index" json:"undo_change_id,omitempty"`
}

// Drift run statuses.
const (
	DriftStatusBaseline = "baseline" // first backup for this device; nothing to compare against
	DriftStatusClean    = "clean"    // changes, if any, are all accounted for by the ledger
	DriftStatusDrift    = "drift"    // at least one change this console cannot account for
	DriftStatusError    = "error"    // the comparison itself failed
)

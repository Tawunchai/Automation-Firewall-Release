package entity

import "time"

// AuditRun is one Audit / Review scan, kept so the console can answer "is this firewall getting
// better or worse?" — the question a customer asks at the second meeting, and the one a single
// point-in-time report can never answer.
//
// WHY NOT EVERY SCAN. The Audit page scans automatically whenever a device is selected, so storing
// every call would fill the table with identical rows and turn a trend line into a flat smear of
// duplicates. Fingerprint is a hash of the finding set: a run is stored only when the result
// actually differs from the last one, or when enough time has passed that "still the same" is
// itself worth recording. See services.RecordAuditRun.
//
// The findings themselves are deliberately NOT stored. They name policies and addresses on a
// customer's firewall, they go stale the moment someone edits a rule, and nothing in the trend
// needs them — the counts and the per-framework gaps are what a graph is drawn from. What IS kept
// is the device identity of the moment (serial, firmware), because a trend that silently spans a
// hardware replacement or a firmware upgrade is misleading.
type AuditRun struct {
	Base

	NetworkDeviceID uint           `gorm:"index;not null" json:"network_device_id"`
	NetworkDevice   *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"-"`

	// AppUserID / UserEmail name whoever ran it. Denormalised for the same reason ChangeRecord
	// does it: an evidence trail that disappears when an account is deleted is not one.
	AppUserID uint   `gorm:"index" json:"app_user_id"`
	UserEmail string `json:"user_email"`

	ScannedAt time.Time `gorm:"index;not null" json:"scanned_at"`

	High   int `json:"high"`
	Medium int `json:"medium"`
	Low    int `json:"low"`
	Total  int `json:"total"`

	// Gaps / Indeterminate / Evidenced / Observations are summed across every framework, which is
	// what a headline trend needs. Standards holds the per-framework breakdown as JSON for the
	// detail view.
	Gaps          int `json:"gaps"`
	Indeterminate int `json:"indeterminate"`
	Evidenced     int `json:"evidenced"`
	Observations  int `json:"observations"`
	// NotAssessed and InScope are the denominator. Stored rather than derived because the catalogue
	// grows: without them, a run recorded under an older, smaller universe is indistinguishable
	// from a device that used to be cleaner.
	NotAssessed int    `json:"not_assessed"`
	InScope     int    `json:"in_scope"`
	Standards   string `gorm:"type:text" json:"standards,omitempty"`

	// CatalogueVersion records which mapping produced those numbers. Without it, a trend that
	// crosses a catalogue revision looks like the firewall changed when only our interpretation did.
	//
	// It used to be filled with the catalogue STATUS ("draft"), which never moves when the mapping
	// does — so the safeguard did not work. Status is now its own column.
	CatalogueVersion string `json:"catalogue_version"`
	CatalogueStatus  string `json:"catalogue_status"`

	DeviceSerial   string `json:"device_serial,omitempty"`
	DeviceFirmware string `json:"device_firmware,omitempty"`

	// ConfigRevision is the fingerprint of the DEVICE's configuration at the moment of the scan —
	// distinct from Fingerprint below, which hashes what the scan FOUND. Two runs with the same
	// Fingerprint and different ConfigRevisions mean the configuration moved without changing any
	// finding, which is exactly the window in which an unrecorded change hides.
	ConfigRevision string `json:"config_revision,omitempty"`

	// Fingerprint is a hash of the finding set. Equal fingerprints mean nothing changed.
	Fingerprint string `gorm:"index" json:"-"`
}

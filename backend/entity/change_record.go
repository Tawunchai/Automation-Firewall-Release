package entity

import "time"

// ChangeRecord is one write that reached a real firewall.
//
// Before this table existed the app had 40-odd device-proxy handlers that rewrote a production rule
// base with no trace of who did it, when, or what the object looked like beforehand — the app's
// ActivityLog only ever recorded login/logout/password_change. That is the gap this closes: it is
// both the audit answer (ISO 27001 A.12.1.2 / PCI-DSS 10.2 want exactly these fields) and the
// mechanism behind one-click revert.
//
// Before/After hold the raw FortiOS CMDB object as JSON, not a rendered description, because that
// is what a revert has to replay. An update stores both; a create has no Before; a delete has no
// After.
type ChangeRecord struct {
	Base

	NetworkDeviceID uint           `gorm:"index;not null" json:"network_device_id"`
	NetworkDevice   *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"network_device,omitempty"`

	// AppUserID is 0 only for a change made by an internal job; every interactive change carries
	// the signed-in user. Email is denormalised so the ledger still names the actor after the
	// account is deleted — an audit trail that can be erased by deleting the user is not one.
	AppUserID uint   `gorm:"index" json:"app_user_id"`
	UserEmail string `json:"user_email"`

	// Action is create | update | delete. Move and toggle are recorded as update: both rewrite an
	// existing object, and both revert by replaying the Before snapshot.
	Action string `gorm:"index;not null" json:"action"`

	// ResourceType is the app's own name for the object class ("firewall-policy", "address",
	// "security-profile:antivirus"). CMDBPath is the FortiOS table it lives in — stored rather than
	// re-derived so a revert still works after the route table is refactored.
	ResourceType string `gorm:"index;not null" json:"resource_type"`
	CMDBPath     string `gorm:"not null" json:"cmdb_path"`
	// ResourceKey is the FortiOS mkey: a policy id, or an object name.
	ResourceKey string `gorm:"index" json:"resource_key"`

	Method string `json:"method"`
	Path   string `json:"path"`

	Before string `gorm:"type:text" json:"before,omitempty"`
	After  string `gorm:"type:text" json:"after,omitempty"`

	// Status is applied | failed | reverted.
	Status    string `gorm:"index;not null" json:"status"`
	ErrorText string `gorm:"type:text" json:"error_text,omitempty"`

	RevertedAt *time.Time `json:"reverted_at,omitempty"`
	RevertedBy string     `json:"reverted_by,omitempty"`
	// RevertOfID points at the record this one undid, so the timeline can pair them up and a
	// revert is never itself offered for revert twice.
	RevertOfID *uint `gorm:"index" json:"revert_of_id,omitempty"`
}

// Change actions.
const (
	ChangeActionCreate = "create"
	ChangeActionUpdate = "update"
	ChangeActionDelete = "delete"
)

// Change statuses.
const (
	ChangeStatusApplied  = "applied"
	ChangeStatusFailed   = "failed"
	ChangeStatusReverted = "reverted"
)

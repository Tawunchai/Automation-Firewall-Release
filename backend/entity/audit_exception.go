package entity

import "time"

// AuditException is a finding somebody has formally decided to live with.
//
// Every audit produces findings that will not be fixed: a wide-open rule that a legacy application
// genuinely needs, a "never used" policy kept for a disaster-recovery path. Without somewhere to
// record that decision, the same rows come back on every report and people learn to ignore the
// report — which is the failure mode that makes audit tools shelfware.
//
// It is deliberately NOT a mute button. An accepted finding stays in the report, stays visible, and
// carries the name of whoever accepted it and the date the acceptance runs out. That is what an
// assessor asks for ("show me the compensating control and who signed it"), and hiding the row
// instead would turn the tool into a way of making problems disappear.
//
// Scope is one finding on one device: the check plus the subject it names ("policy #5 Test-DMZ").
// Not the whole check — accepting "all any/any/any rules forever" is exactly the decision nobody
// should be able to make in one click.
type AuditException struct {
	Base

	NetworkDeviceID uint           `gorm:"index;not null" json:"network_device_id"`
	NetworkDevice   *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"-"`

	// Check + Subject together identify the finding. Subject is the same string the report shows,
	// so a row can be matched without re-deriving anything.
	Check   string `gorm:"index;not null" json:"check"`
	Subject string `gorm:"index;not null" json:"subject"`

	// Reason is required. An exception with no stated reason is worth nothing to an assessor, so
	// the handler rejects an empty one rather than storing a blank.
	Reason string `gorm:"type:text;not null" json:"reason"`

	// ApprovedByID / ApprovedBy name the person accepting the risk. Denormalised for the same
	// reason the ledger does it — a sign-off that vanishes with the account is not a sign-off.
	ApprovedByID uint      `gorm:"index" json:"approved_by_id"`
	ApprovedBy   string    `gorm:"not null" json:"approved_by"`
	ApprovedAt   time.Time `gorm:"not null" json:"approved_at"`

	// ExpiresAt is required and bounded by the handler. An exception that never expires is a
	// decision nobody ever revisits, which is how a temporary workaround becomes permanent.
	ExpiresAt time.Time `gorm:"index;not null" json:"expires_at"`

	// RevokedAt is set when someone withdraws the acceptance early. The row is kept rather than
	// deleted: "this was accepted between March and July" is itself part of the audit trail.
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
	RevokedBy   string     `json:"revoked_by,omitempty"`
	CreatedByID uint       `gorm:"index" json:"created_by_id"`
	CreatedBy   string     `json:"created_by"`
}

// Active reports whether the exception applies at time t.
func (e AuditException) Active(t time.Time) bool {
	if e.RevokedAt != nil {
		return false
	}
	return t.Before(e.ExpiresAt)
}

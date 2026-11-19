package entity

import "time"

// ChangeRequest is a write to a firewall that has NOT happened yet.
//
// ── What this closes ─────────────────────────────────────────────────────────
//
// Every device-proxy handler in this app rewrites a live rule base the moment an admin presses
// Save. The Change Ledger records it, the Drift page notices it, Report Studio can put it in a PDF
// — all of them AFTERWARDS. Nothing in the console stands between "I think this rule is right" and
// a production firewall enforcing it, and on a first-match rule base the gap between those two is
// where the outage lives.
//
// So this is the other half: a proposal, a second pair of eyes, and only then the write.
//
// ── Why it stores the REQUEST and not the object ─────────────────────────────
//
// Method, Path and Body are the exact HTTP request the console would have sent. Applying a request
// replays it through this app's own router, which means the apply goes down the SAME code path as
// a direct write: the same validation, the same per-user device-access check, the same Change
// Ledger middleware, the same FortiOS error handling. A second applier that spoke to the device
// itself would be a second place to forget any one of those, and the one it would forget is
// always the permission check.
//
// It also means a request stays honest across a refactor. Storing a finished CMDB object would
// pin the proposal to whatever the mapping looked like on the day it was written; storing the
// request means the proposal is re-interpreted by today's code, and if the shape has changed
// enough to matter the apply fails loudly rather than writing something nobody proposed.
//
// ── The one thing it deliberately does NOT do ────────────────────────────────
//
// It does not snapshot the device at proposal time and apply that snapshot later. The firewall can
// change between proposal and approval — by another operator, by a wizard, or on the device
// itself — and replaying a stale "after" would silently undo whatever happened in between. The
// diff an approver reads is computed LIVE, against the device as it is at the moment they look.
type ChangeRequest struct {
	Base

	NetworkDeviceID uint           `gorm:"index;not null" json:"network_device_id"`
	NetworkDevice   *NetworkDevice `gorm:"foreignKey:NetworkDeviceID" json:"network_device,omitempty"`

	// ── The proposal ──────────────────────────────────────────────────────────

	// Title is what the queue lists. Free text from the requester; it is the only part of a
	// request a reviewer reads before deciding whether to open it.
	Title string `gorm:"not null" json:"title"`
	// Reason is WHY. Required, because "approved" means nothing if the approver could not see
	// what they were approving it for.
	Reason string `gorm:"type:text" json:"reason"`

	// The request to replay. Path is the app's own route ("/policy/device/1/firewall-policies"),
	// not a FortiOS URL.
	Method string `gorm:"not null" json:"method"`
	Path   string `gorm:"not null" json:"path"`
	Body   string `gorm:"type:text" json:"body"`

	// What it touches, for the queue's summary line and for grouping. Derived from Path at
	// creation and stored, so the list does not have to re-parse a route on every render.
	ResourceType string `gorm:"index" json:"resource_type"`
	ResourceKey  string `gorm:"index" json:"resource_key"`

	// ── Who ───────────────────────────────────────────────────────────────────

	RequestedByID uint      `gorm:"index;not null" json:"requested_by_id"`
	RequestedBy   string    `gorm:"not null" json:"requested_by"`
	RequestedAt   time.Time `gorm:"index;not null" json:"requested_at"`

	// Denormalised like the ledger's UserEmail, and for the same reason: an approval trail that
	// can be erased by deleting the approver's account is not a trail.
	ReviewedByID uint       `gorm:"index" json:"reviewed_by_id,omitempty"`
	ReviewedBy   string     `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	ReviewNote   string     `gorm:"type:text" json:"review_note,omitempty"`

	// ── State ─────────────────────────────────────────────────────────────────

	Status string `gorm:"index;not null" json:"status"`

	// ScheduledFor holds an approved request until its maintenance window. Nil means "apply as
	// soon as it is approved".
	ScheduledFor *time.Time `gorm:"index" json:"scheduled_for,omitempty"`

	// ExpiresAt is when an un-reviewed request stops being applicable. A proposal written against
	// a firewall as it looked three weeks ago is a proposal about a different firewall, and the
	// reviewer has no way to tell. Expiry is what stops the queue from becoming a pile of
	// approvals nobody dares grant.
	ExpiresAt time.Time `gorm:"index;not null" json:"expires_at"`

	AppliedAt *time.Time `json:"applied_at,omitempty"`
	// ChangeRecordID links to the ledger row the apply produced, so "what did this request
	// actually do to the device" is one hop away and revert is the ledger's existing button.
	ChangeRecordID *uint  `gorm:"index" json:"change_record_id,omitempty"`
	ErrorText      string `gorm:"type:text" json:"error_text,omitempty"`

	// SelfApproved is true when the approver and the requester are the same person. Nothing sets
	// it any more: it was written by a sole-admin auto-approval path that middleware.RequireApproval
	// made unreachable (every admin is now let straight through), and the ordinary Review endpoint
	// has always refused self-approval outright. The column stays because rows written while that
	// path was live still carry it, and stored rather than inferred from
	// RequestedByID == ReviewedByID so such a row keeps saying what happened even if accounts are
	// later added, renamed or deleted.
	SelfApproved bool `gorm:"default:false" json:"self_approved"`
}

// Change request statuses.
//
// The set is deliberately small. Every extra state is another transition somebody has to reason
// about, and the questions that actually get asked are "is it waiting on me", "did it go in", and
// "why not".
const (
	// Waiting for a reviewer.
	CRStatusPending = "pending"
	// Approved and either applied at once or waiting for its window.
	CRStatusApproved = "approved"
	// On the device. Terminal.
	CRStatusApplied = "applied"
	// A reviewer said no. Terminal, and keeps the note.
	CRStatusRejected = "rejected"
	// The requester took it back. Terminal.
	CRStatusWithdrawn = "withdrawn"
	// Approved, applied, and the device refused. Terminal — it is NOT retried automatically,
	// because a failed write to a live firewall is a thing a person has to look at.
	CRStatusFailed = "failed"
	// Never reviewed in time. Terminal.
	CRStatusExpired = "expired"
)

// IsOpen reports whether the request can still turn into a write.
func (r ChangeRequest) IsOpen() bool {
	return r.Status == CRStatusPending || r.Status == CRStatusApproved
}

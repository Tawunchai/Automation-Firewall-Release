package services

import (
	"errors"
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

// The change-request rules.
//
// They are tested here as PURE functions, without a database, because that is where they live —
// see the note on PrepareChangeRequest for why. The DB half is one insert and one conditional
// UPDATE; what a conditional UPDATE guarantees is a property of the SQL, and a test that ran it
// through an in-memory SQLite would be asserting SQLite's behaviour rather than Postgres's.

func proposal(over func(*entity.ChangeRequest)) *entity.ChangeRequest {
	r := &entity.ChangeRequest{
		Title: "Open HTTPS for the branch", Reason: "ticket NET-412",
		Method: "POST", Path: "/policy/device/1/firewall-policies", Body: `{"name":"x"}`,
		RequestedByID: 7, RequestedBy: "alice@example.com",
	}
	if over != nil {
		over(r)
	}
	return r
}

// ─── what a request may carry ────────────────────────────────────────────────

// ⚠️ The stored path is replayed with an ADMIN's identity attached. If it could name anything but
// a device write, the queue would be a privilege-escalation channel with an approval workflow on
// top of it.
func TestValidateRequestPath_OnlyDeviceWrites(t *testing.T) {
	for _, p := range []string{
		"/policy/device/1/firewall-policies",
		"/policy/device/12/address-groups/LAN-set",
		"/policy/device/3/firewall-policies/bulk/delete",
	} {
		if _, err := ValidateRequestPath("POST", p); err != nil {
			t.Errorf("%s was rejected: %v", p, err)
		}
	}

	for _, p := range []string{
		"/users/1/devices",               // the device-access table itself
		"/users/device-access/summary",   //
		"/change-requests/1/review",      // approving one's own request through a request
		"/notify/channels",               // a LINE bot token
		"/policy/device/abc/addresses",   // no device id
		"/policy/device/0/addresses",     // device 0
		"/policy/device/1",               // no resource
		"../policy/device/1/addresses",   // traversal
		"/policy/device/1/addresses?x=1", // a query the reviewed diff would not show
		"/policy/device/1/addresses#f",   //
		// Phase 2: the queue may not carry a write an admin must not be talked into making.
		"/policy/device/1/admin-users",          // an account ON the firewall, outside this console
		"/policy/device/1/ldap-servers",         // the directory the firewall trusts
		"/policy/device/1/radius-servers/Corp",  //
		"/policy/device/1/exchange-connectors",  //
		"/policy/device/1/not-a-resource/thing", // nothing this console can classify, diff or revert
	} {
		if _, err := ValidateRequestPath("POST", p); err == nil {
			t.Errorf("%s was accepted as a change request", p)
		}
	}

	for _, m := range []string{"GET", "HEAD", "OPTIONS"} {
		if _, err := ValidateRequestPath(m, "/policy/device/1/firewall-policies"); err == nil {
			t.Errorf("%s was accepted — a read is not a change", m)
		}
	}
}

func TestValidateRequestPath_ReturnsTheDeviceID(t *testing.T) {
	id, err := ValidateRequestPath("PATCH", "/policy/device/42/addresses/LAN")
	if err != nil || id != 42 {
		t.Fatalf("id = %d, err = %v", id, err)
	}
}

// ─── preparing a proposal ────────────────────────────────────────────────────

// The title is no longer asked of the requester — it is derived from what the request DOES
// (see changerequest_title_test.go for why) — so a blank one is fine and is filled in. The reason
// is still required: it is the only part a human writes, and an approval without one means nothing.
func TestPrepareChangeRequest_DemandsAReasonAndSuppliesTheTitle(t *testing.T) {
	now := time.Now()

	untitled := proposal(func(r *entity.ChangeRequest) { r.Title = "  " })
	if err := PrepareChangeRequest(untitled, 0, now); err != nil {
		t.Errorf("a request with no title was refused: %v", err)
	}
	if untitled.Title == "" || strings.TrimSpace(untitled.Title) == "" {
		t.Error("nothing filled the title in — the queue would list a blank row")
	}

	if err := PrepareChangeRequest(proposal(func(r *entity.ChangeRequest) { r.Reason = "" }), 0, now); err == nil {
		t.Error("a request with no reason was accepted — an approval means nothing without one")
	}
}

// A body that is not JSON would fail at apply time — AFTER somebody approved it.
func TestPrepareChangeRequest_RejectsAMalformedBody(t *testing.T) {
	err := PrepareChangeRequest(proposal(func(r *entity.ChangeRequest) { r.Body = "{not json" }), 0, time.Now())
	if err == nil {
		t.Error("a body that is not JSON was accepted")
	}
}

func TestPrepareChangeRequest_FillsInTheDerivedFields(t *testing.T) {
	now := time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)
	r := proposal(func(x *entity.ChangeRequest) { x.Path = "/policy/device/5/address-groups/LAN-set" })
	if err := PrepareChangeRequest(r, 0, now); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if r.NetworkDeviceID != 5 {
		t.Errorf("device id = %d, want the one in the path", r.NetworkDeviceID)
	}
	// The canonical name the Change Ledger uses for the same write, not the URL segment: one
	// vocabulary across the queue, the ledger and the approval gate.
	if r.ResourceType != "address-group" || r.ResourceKey != "LAN-set" {
		t.Errorf("resource = %q/%q", r.ResourceType, r.ResourceKey)
	}
	if r.Status != entity.CRStatusPending {
		t.Errorf("status = %q, want pending", r.Status)
	}
	if !r.ExpiresAt.Equal(now.Add(DefaultRequestTTL)) {
		t.Errorf("expires at %v", r.ExpiresAt)
	}
}

// The device in the path is authoritative: a body claiming another one would make the reviewed
// request and the applied request name different firewalls.
func TestPrepareChangeRequest_RefusesADeviceThatContradictsThePath(t *testing.T) {
	r := proposal(func(x *entity.ChangeRequest) { x.NetworkDeviceID = 9 })
	err := PrepareChangeRequest(r, 0, time.Now())
	if err == nil || !strings.Contains(err.Error(), "names device 1") {
		t.Errorf("err = %v", err)
	}
}

func TestPrepareChangeRequest_TTLIsCappedButMayBeShorter(t *testing.T) {
	now := time.Now()

	long := proposal(nil)
	_ = PrepareChangeRequest(long, 30*24*time.Hour, now)
	if long.ExpiresAt.After(now.Add(DefaultRequestTTL)) {
		t.Errorf("a request outlived the cap: %v", long.ExpiresAt.Sub(now))
	}

	short := proposal(nil)
	_ = PrepareChangeRequest(short, 2*time.Hour, now)
	if got := short.ExpiresAt.Sub(now); got != 2*time.Hour {
		t.Errorf("a shorter TTL was ignored: %v", got)
	}
}

// ─── who may review, and when ────────────────────────────────────────────────

// ⚠️ The reason the queue exists. On the decision, not in the UI — a UI check is a suggestion.
func TestCanReview_RequesterCannotApproveTheirOwn(t *testing.T) {
	r := proposal(nil)
	_ = PrepareChangeRequest(r, 0, time.Now())

	if err := CanReview(*r, true, 7, time.Now()); !errors.Is(err, ErrSelfApproval) {
		t.Errorf("the requester approved their own request: %v", err)
	}
	if err := CanReview(*r, true, 9, time.Now()); err != nil {
		t.Errorf("another admin was blocked: %v", err)
	}
}

// Rejecting one's own is withdrawing it by another name; blocking that would only mean the
// requester has to ask somebody else to close their own mistake.
func TestCanReview_RequesterMayRejectTheirOwn(t *testing.T) {
	r := proposal(nil)
	_ = PrepareChangeRequest(r, 0, time.Now())
	if err := CanReview(*r, false, 7, time.Now()); err != nil {
		t.Errorf("the requester could not reject their own request: %v", err)
	}
}

// ⚠️ A proposal written against last month's firewall is a proposal about a different firewall,
// and nothing on screen tells the reviewer that.
func TestCanReview_ExpiredCannotBeApproved(t *testing.T) {
	now := time.Now()
	r := proposal(nil)
	_ = PrepareChangeRequest(r, 0, now)

	late := now.Add(DefaultRequestTTL + time.Minute)
	if err := CanReview(*r, true, 9, late); !errors.Is(err, ErrExpired) {
		t.Errorf("an expired request was approved: %v", err)
	}
	// Rejecting an expired one is tidying up, and stays allowed.
	if err := CanReview(*r, false, 9, late); err != nil {
		t.Errorf("an expired request could not be rejected: %v", err)
	}
}

func TestCanReview_OnlyAPendingRequestIsReviewable(t *testing.T) {
	for _, st := range []string{
		entity.CRStatusApproved, entity.CRStatusApplied, entity.CRStatusRejected,
		entity.CRStatusWithdrawn, entity.CRStatusFailed, entity.CRStatusExpired,
	} {
		r := proposal(nil)
		_ = PrepareChangeRequest(r, 0, time.Now())
		r.Status = st
		if err := CanReview(*r, true, 9, time.Now()); !errors.Is(err, ErrNotPending) {
			t.Errorf("a %s request was reviewable: %v", st, err)
		}
	}
}

func TestIsOpen(t *testing.T) {
	open := map[string]bool{
		entity.CRStatusPending: true, entity.CRStatusApproved: true,
		entity.CRStatusApplied: false, entity.CRStatusRejected: false,
		entity.CRStatusWithdrawn: false, entity.CRStatusFailed: false,
		entity.CRStatusExpired: false,
	}
	for st, want := range open {
		if got := (entity.ChangeRequest{Status: st}).IsOpen(); got != want {
			t.Errorf("IsOpen(%s) = %v", st, got)
		}
	}
}

// ─── the replay credential ───────────────────────────────────────────────────

// ⚠️ The replay headers are only trusted with a secret that exists in this process's memory.
// Anything else — empty, a guess, a same-length wrong value — must not identify a caller, because
// what these headers buy is an admin's identity on a write to a live firewall.
func TestTrustedInternalApply(t *testing.T) {
	secret := internalApplySecret()
	if len(secret) < 32 {
		t.Fatalf("the replay secret is only %d characters", len(secret))
	}

	if !TrustedInternalApply(map[string][]string{InternalApplyHeader: {secret}}) {
		t.Fatal("this process's own replay credential was rejected")
	}

	for _, bad := range []string{"", "x", secret + "x", secret[:len(secret)-1]} {
		if TrustedInternalApply(map[string][]string{InternalApplyHeader: {bad}}) {
			t.Errorf("%q was accepted as the replay credential", bad)
		}
	}
	// Same length, one bit different — the case a naive prefix compare would let through.
	wrong := []byte(secret)
	wrong[0] ^= 0xff
	if TrustedInternalApply(map[string][]string{InternalApplyHeader: {string(wrong)}}) {
		t.Error("a same-length wrong secret was accepted")
	}
	if TrustedInternalApply(map[string][]string{}) {
		t.Error("a request with no header was accepted")
	}
}

// The applier must refuse anything that has not been approved, whatever the caller passes.
func TestApplyChangeRequest_RefusesAnythingNotApproved(t *testing.T) {
	for _, st := range []string{
		entity.CRStatusPending, entity.CRStatusApplied, entity.CRStatusRejected,
		entity.CRStatusWithdrawn, entity.CRStatusFailed, entity.CRStatusExpired,
	} {
		_, err := ApplyChangeRequest(nil, entity.ChangeRequest{Status: st}, ApplyIdentity{}, time.Now())
		if !errors.Is(err, ErrNotApproved) {
			t.Errorf("a %s request was applied: %v", st, err)
		}
	}
}

package services

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"network_automation/services/platform"
	"strings"
	"sync"
	"time"

	"network_automation/entity"

	"gorm.io/gorm"
)

// Applying an approved request, by replaying it through this app's own router.
//
// ── Why a replay and not a device call ───────────────────────────────────────
//
// The obvious implementation is to read the request's body and POST it to the FortiGate. It is
// also wrong, and the reason is worth stating plainly: the device-proxy handlers are not thin. Each
// one validates its input, resolves which firewall account to log in as, checks the requester's
// access to that device, converts a GUI shape into a CMDB shape, and is wrapped by the Change
// Ledger middleware. A second applier would re-implement all of that, and the piece it would
// re-implement wrongly is always the access check — the one that has no visible symptom when it
// is missing.
//
// So the applier builds the HTTP request the console would have sent, attaches the identity of the
// person who APPROVED it, and serves it against the same gin engine that serves the browser. The
// write then goes down the identical path, including the ledger row, and the applier's only job is
// to read the status code.
//
// ── Whose identity, and why ──────────────────────────────────────────────────
//
// The approver's, not the requester's. The approver is who decided this happens, and the firewall's
// own event log should name the person who made that call. It also means a request cannot be used
// to launder a write past a device the requester may not touch: the access check runs against the
// approver, who had to be able to see the device to review it.
//
// ── What it does not do ──────────────────────────────────────────────────────
//
// It never retries. A device write that came back 5xx may or may not have landed, and re-sending
// it is how one proposed change becomes two rules. A failed apply is terminal and says so.

// replayer is the gin engine, handed over at boot. A package variable rather than a parameter
// because the scheduler's sweep has no request to carry it on, and the alternative — a second
// engine built for replay — would be a second routing table that could drift from the real one.
var (
	replayMu     sync.RWMutex
	replayEngine http.Handler
)

// SetChangeRequestReplayer is called once from main, after the routes are registered.
func SetChangeRequestReplayer(h http.Handler) {
	replayMu.Lock()
	defer replayMu.Unlock()
	replayEngine = h
}

func replayer() http.Handler {
	replayMu.RLock()
	defer replayMu.RUnlock()
	return replayEngine
}

// ApplyIdentity is who the replayed write runs as.
type ApplyIdentity struct {
	UserID uint
	Email  string
	Role   string
}

// ReplayResult is what the replay produced.
type ReplayResult struct {
	Status int
	Body   string
	// ChangeRecordID is the ledger row the write produced, when one was written. The ledger is
	// populated by middleware during the replay, so it is found afterwards rather than returned.
	ChangeRecordID *uint
}

// applyTimeout caps one replayed write. A device call through the pooled client is well under a
// second warm and a few seconds cold; a minute is "the firewall stopped answering", and a sweep
// that blocks forever on one request would stop applying every other one behind it.
const applyTimeout = 60 * time.Second

// ReplayDeviceRequest sends one device-proxy request through this app's own router under the given
// identity — a synthesised request with no session, carrying the internal-apply credential instead
// of a cookie (see middleware/auth's handling of one). Pulled out of ApplyChangeRequest so Fleet
// Apply (controller/policyobject/fleet_apply.go) can replay a write the same way without going
// through the Change Request table, which exists for mandatory review — not needed for a resource
// type RequiresApproval already waves through.
func ReplayDeviceRequest(method, path, body string, as ApplyIdentity) (*ReplayResult, error) {
	h := replayer()
	if h == nil {
		return nil, fmt.Errorf("the request replayer is not wired up — SetChangeRequestReplayer was never called")
	}

	ctx, cancel := context.WithTimeout(context.Background(), applyTimeout)
	defer cancel()

	var bodyReader *strings.Reader
	if body == "" {
		bodyReader = strings.NewReader("")
	} else {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(InternalApplyHeader, internalApplySecret())
	req.Header.Set(InternalApplyUserID, fmt.Sprintf("%d", as.UserID))
	req.Header.Set(InternalApplyEmail, as.Email)
	req.Header.Set(InternalApplyRole, as.Role)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return &ReplayResult{Status: rec.Code, Body: rec.Body.String()}, nil
}

// ApplyChangeRequest replays one approved request and records the outcome.
//
// `as` is the approver. The caller has already established that they may act — this function does
// not re-check authorisation, because the replayed request does, which is the entire point.
func ApplyChangeRequest(
	db *gorm.DB, r entity.ChangeRequest, as ApplyIdentity, now time.Time,
) (*ReplayResult, error) {
	if r.Status != entity.CRStatusApproved {
		return nil, ErrNotApproved
	}

	// The highest ledger id before the write, so the row this replay produced can be identified
	// afterwards. Reading "the newest row" without this would attribute a concurrent operator's
	// change to the request.
	var beforeID uint
	var last entity.ChangeRecord
	if err := db.Order("id desc").First(&last).Error; err == nil {
		beforeID = last.ID
	}

	res, err := ReplayDeviceRequest(r.Method, r.Path, r.Body, as)
	if err != nil {
		return nil, err
	}

	var produced entity.ChangeRecord
	if err := db.Where("id > ?", beforeID).
		Where("network_device_id = ?", r.NetworkDeviceID).
		Order("id desc").First(&produced).Error; err == nil {
		id := produced.ID
		res.ChangeRecordID = &id
	}

	if res.Status >= 200 && res.Status < 300 {
		if err := MarkApplied(db, r.ID, res.ChangeRecordID, now); err != nil {
			log.Printf("[change-request] applied %d on the device but could not close the request: %v", r.ID, err)
		}
		return res, nil
	}

	// TruncateUTF8, not detail[:2000]: a FortiGate refusal is routinely Thai, three bytes per
	// character, so a byte slice cuts mid-character and Postgres rejects the whole UPDATE. MarkFailed
	// then fails, the request is never closed, and it sits in `approved` forever — re-applied by
	// every later sweep — with only a log line to say why.
	detail := platform.TruncateUTF8(strings.TrimSpace(res.Body), 2000)
	if detail == "" {
		detail = fmt.Sprintf("the write returned HTTP %d with no message", res.Status)
	}
	if err := MarkFailed(db, r.ID, detail, now); err != nil {
		log.Printf("[change-request] %d failed and the failure could not be recorded: %v", r.ID, err)
	}
	return res, nil
}

// RunChangeRequestSweep applies every approved request whose window has arrived, and expires the
// pending ones that ran out of time. Called once a minute by the scheduler.
//
// Requests are applied one at a time, in the order they were raised. Concurrency here would mean
// several writes landing on one firewall in an order nobody chose — and on a first-match rule base
// the order two rules arrive in is part of what they mean.
func RunChangeRequestSweep(db *gorm.DB, now time.Time) (applied, failed, expired int) {
	if db == nil {
		return 0, 0, 0
	}
	expired = int(ExpireStaleRequests(db, now))

	due, err := DueRequests(db, now, 20)
	if err != nil {
		log.Printf("[change-request] could not read the due list: %v", err)
		return 0, 0, expired
	}
	for _, r := range due {
		// The approver is who the write runs as — see the note at the top of this file.
		as := ApplyIdentity{UserID: r.ReviewedByID, Email: r.ReviewedBy, Role: "admin"}
		res, err := ApplyChangeRequest(db, r, as, now)
		switch {
		case err != nil:
			log.Printf("[change-request] %d could not be applied: %v", r.ID, err)
			_ = MarkFailed(db, r.ID, err.Error(), now)
			failed++
		case res.Status >= 200 && res.Status < 300:
			applied++
		default:
			failed++
		}
	}
	return applied, failed, expired
}

// ── The internal-replay credential ───────────────────────────────────────────
//
// A replayed request carries no cookie, so the auth middleware needs another way to know who it
// is. The headers below are that way, and the secret is what stops them from being a login: the
// values are only trusted when the shared secret matches, and the secret is generated at boot and
// never leaves the process. An attacker who could set these headers from outside would need a
// value that exists only in this process's memory.

const (
	InternalApplyHeader = "X-Internal-Apply"
	InternalApplyUserID = "X-Internal-Apply-User"
	InternalApplyEmail  = "X-Internal-Apply-Email"
	InternalApplyRole   = "X-Internal-Apply-Role"
)

var (
	applySecretOnce sync.Once
	applySecret     string
)

func internalApplySecret() string {
	applySecretOnce.Do(func() {
		tok, err := platform.RandomHex(32)
		if err != nil {
			// crypto/rand failing is not a condition to degrade through: a predictable replay
			// credential would make the headers below a login. Panic at boot beats a quiet
			// fallback nobody would notice.
			panic("change-request replay secret: " + err.Error())
		}
		applySecret = tok
	})
	return applySecret
}

// TrustedInternalApply reports whether a request carries this process's replay credential.
// Middleware calls it; nothing else should.
func TrustedInternalApply(h http.Header) bool {
	got := h.Get(InternalApplyHeader)
	if got == "" {
		return false
	}
	// Constant-time compare on equal-length secrets; the lengths are fixed so a length check
	// leaks nothing.
	want := internalApplySecret()
	if len(got) != len(want) {
		return false
	}
	var diff byte
	for i := 0; i < len(want); i++ {
		diff |= got[i] ^ want[i]
	}
	return diff == 0
}

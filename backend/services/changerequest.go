package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"network_automation/entity"

	"gorm.io/gorm"
)

// The rules a change request has to obey, kept away from the HTTP layer so they can be tested
// without a router and so there is exactly one place each of them is enforced.
//
// Three of them are the whole point of the feature, and all three are easy to write a version of
// that looks right and is not:
//
//  1. SEPARATION OF DUTIES. The approver may not be the requester. Not "should not" — the check
//     is here, on the transition, not in the UI, because a UI check is a suggestion.
//
//  2. ONE REVIEW. A request leaves `pending` exactly once. Two admins opening the queue at the
//     same time and both pressing Approve must produce one approval and one "already reviewed",
//     which means the transition is a conditional UPDATE, not a read-then-write.
//
//  3. EXPIRY. A proposal written against last month's firewall is a proposal about a different
//     firewall, and nothing on screen tells the reviewer that. Requests expire.

var (
	ErrNotPending      = errors.New("this request is no longer waiting for review — somebody has already reviewed it")
	ErrSelfApproval    = errors.New("a change request cannot be approved by the person who raised it — that is the point of the queue")
	ErrNotApproved     = errors.New("only an approved request can be applied")
	ErrExpired         = errors.New("this request has expired: it was written against the firewall as it was then, and nobody can see what has changed since")
	ErrNotRequester    = errors.New("only the person who raised a request may withdraw it")
	ErrUnsupportedPath = errors.New("a change request may only carry a device write")
)

// DefaultRequestTTL is how long an unreviewed request stays applicable.
//
// Seven days is a working week: long enough that a request raised on Friday survives the weekend,
// short enough that a reviewer is deciding about a firewall they could still recognise. It is a
// default, not a limit — the requester may ask for less.
const DefaultRequestTTL = 7 * 24 * time.Hour

// devicePathRe matches the only routes a request may carry: a write under the device proxy.
//
// Anchored and explicit rather than a prefix check. The stored path is replayed through this app's
// own router with an admin's identity attached, so it is the one string in the system that must
// not be able to name anything except a device write — a request that could carry
// "/users/1/devices" would be a privilege-escalation queue with an approval workflow on top.
var devicePathRe = regexp.MustCompile(`^/policy/device/(\d+)/[A-Za-z0-9._\-/%]+$`)

// privilegedResources are the resource types a change request may never carry, whatever title is
// put on it.
//
// A request is replayed with the APPROVER's identity (services.ApplyChangeRequest attaches an
// admin's), so anything in the queue is something an admin will eventually execute on behalf of
// somebody who could not execute it themselves. That is the point of the feature — and it is also
// why the queue must not be able to carry the handful of writes that are refused to non-admins
// precisely BECAUSE an admin doing them hands over the console's own authority:
//
//   - an LDAP or RADIUS server, or an Exchange connector, each of which names the directory the
//     firewall trusts and carries the credential it binds with. "Point authentication at my
//     server" approved as "fix the staff login timeout" is the whole confused-deputy shape.
//
// The firewall's own administrator accounts are refused one step earlier and do not need a line
// here: /policy/device/:id/admin-users does not resolve to a CMDB coordinate at all (it is absent
// from deviceProxySegment), so requireResolvableTarget below rejects it. TestAdminUsersCannotBe
// Queued pins that, because the reason is indirect enough to be lost in a later refactor.
//
// controller/policyobject/authz.go refuses the same families to an operator over the direct route
// (requireAdminStrict); this is the other door into them.
var privilegedResources = map[string]string{
	"ldap-server":        "an LDAP server names the directory the firewall authenticates against, and carries the credential it binds with",
	"radius-server":      "a RADIUS server names the directory the firewall authenticates against, and carries its shared secret",
	"exchange-connector": "an Exchange connector carries a service account's credential",
}

// ErrPrivilegedPath is returned for a path that names one of those.
var ErrPrivilegedPath = errors.New("this kind of object cannot go through the change queue")

// resolveRequestTarget validates a proposal's method and path and says what it would actually do.
//
// This is the function that decides what may enter the queue. It answers three questions, in this
// order, and all three matter:
//
//  1. is it a write to a device-proxy route (the shape check devicePathRe has always done);
//  2. does that route resolve to a REAL CMDB coordinate — i.e. is it something this app can
//     classify, snapshot and revert? Anything it cannot classify, it also cannot show an approver
//     a diff for, which would leave them approving a URL;
//  3. is the thing it names one an admin must not be talked into writing (privilegedResources).
//
// Returning the target, rather than just the device id, is what lets the caller describe the
// request in the system's own words instead of the requester's — see PrepareChangeRequest.
func resolveRequestTarget(method, path string) (uint, ChangeTarget, error) {
	switch method {
	case "POST", "PUT", "PATCH", "DELETE":
	default:
		return 0, ChangeTarget{}, fmt.Errorf("%w: %s is not a write", ErrUnsupportedPath, method)
	}
	// A query string would let the stored request differ from the reviewed one in a way the diff
	// does not show. Anything the write needs belongs in the body.
	if strings.ContainsAny(path, "?#") {
		return 0, ChangeTarget{}, fmt.Errorf("%w: the path may not carry a query string", ErrUnsupportedPath)
	}
	m := devicePathRe.FindStringSubmatch(path)
	if m == nil {
		return 0, ChangeTarget{}, fmt.Errorf("%w: %q is not a /policy/device/… route", ErrUnsupportedPath, path)
	}
	id, err := strconv.ParseUint(m[1], 10, 64)
	if err != nil || id == 0 {
		return 0, ChangeTarget{}, fmt.Errorf("%w: no device id in %q", ErrUnsupportedPath, path)
	}

	tail := strings.TrimPrefix(path, "/policy/device/"+m[1]+"/")
	target, ok := ResolveChangeTarget(method, tail)
	if !ok {
		return 0, ChangeTarget{}, fmt.Errorf(
			"%w: %q is not a device object this console can queue — only writes it can classify, "+
				"diff and revert may go through review", ErrUnsupportedPath, path)
	}
	if why, refused := privilegedResources[target.ResourceType]; refused {
		return 0, ChangeTarget{}, fmt.Errorf("%w: %s", ErrPrivilegedPath, why)
	}
	return uint(id), target, nil
}

// ValidateRequestPath checks the path is a device write and returns the device id it names.
func ValidateRequestPath(method, path string) (uint, error) {
	id, _, err := resolveRequestTarget(method, path)
	return id, err
}

// PrepareChangeRequest validates a proposal and fills in everything derived from it.
//
// Pure, and separate from the insert on purpose: these are the rules, and rules that can only be
// exercised through a database are rules that get tested rarely and then not at all. The DB half
// below is three lines and one conditional UPDATE.
func PrepareChangeRequest(r *entity.ChangeRequest, ttl time.Duration, now time.Time) error {
	if strings.TrimSpace(r.Reason) == "" {
		return errors.New("a change request needs a reason — an approval means nothing if the approver could not see what it was for")
	}
	deviceID, target, err := resolveRequestTarget(r.Method, r.Path)
	if err != nil {
		return err
	}
	if r.NetworkDeviceID != 0 && r.NetworkDeviceID != deviceID {
		return fmt.Errorf("%w: the path names device %d, not %d", ErrUnsupportedPath, deviceID, r.NetworkDeviceID)
	}
	r.NetworkDeviceID = deviceID

	if r.Body != "" && !json.Valid([]byte(r.Body)) {
		return errors.New("the request body is not valid JSON")
	}

	// ── The title is the SYSTEM's, not the requester's ────────────────────────
	//
	// It used to be free text from whoever raised the request, and it is the one line a reviewer
	// reads before deciding whether to open anything. That is a confused deputy with a form: the
	// requester chooses the words, the approver supplies the rights, and "add the office printer's
	// address" can carry a policy that opens the firewall. Nothing stopped the two from describing
	// different changes, because nothing ever compared them.
	//
	// So the stored title is now derived from what the request WILL DO — the verb, the resource
	// type and the key, in the same words the Change Ledger uses for the same write. The
	// requester's own wording is not thrown away; it moves into the Reason, labelled as theirs,
	// where it reads as what it is: an explanation, not a description.
	theirs := strings.TrimSpace(r.Title)
	r.Title = DescribeApprovalTitle(r.Method, target)
	if theirs != "" && theirs != r.Title {
		r.Reason = "Requester's own title: " + strconv.Quote(theirs) + "\n\n" + r.Reason
	}

	r.ResourceType, r.ResourceKey = target.ResourceType, target.MKey
	r.Status = entity.CRStatusPending
	r.RequestedAt = now
	if ttl <= 0 || ttl > DefaultRequestTTL {
		ttl = DefaultRequestTTL
	}
	r.ExpiresAt = now.Add(ttl)
	return nil
}

// CreateChangeRequest stores a proposal.
func CreateChangeRequest(db *gorm.DB, r *entity.ChangeRequest, ttl time.Duration) error {
	if err := PrepareChangeRequest(r, ttl, time.Now()); err != nil {
		return err
	}
	return db.Create(r).Error
}

// CanReview answers whether this person may take this decision on this request, right now.
//
// The three rules the whole feature rests on, as ONE pure function so each is enforced in exactly
// one place and can be tested without a database:
//
//   - the request is still waiting (a second reviewer arriving late is told so, not silently
//     allowed to overwrite the first decision);
//   - an APPROVAL may not come from the requester — separation of duties, which is the reason the
//     queue exists;
//   - an approval may not come after the request has expired, because a proposal written against
//     last month's firewall is a proposal about a different firewall.
//
// A REJECTION is exempt from the last two: rejecting one's own request is withdrawing it by
// another name, and rejecting an expired one is tidying up.
func CanReview(r entity.ChangeRequest, approve bool, reviewerID uint, now time.Time) error {
	if r.Status != entity.CRStatusPending {
		return ErrNotPending
	}
	if !approve {
		return nil
	}
	if r.RequestedByID == reviewerID {
		return ErrSelfApproval
	}
	if now.After(r.ExpiresAt) {
		return ErrExpired
	}
	return nil
}

// ReviewChangeRequest approves or rejects, and is the transition the whole feature rests on.
//
// The status change is a CONDITIONAL update — `WHERE status = 'pending'` — rather than a read, a
// check and a write. Two reviewers pressing Approve at the same moment is not a rare case on a
// queue that exists to be watched by several people, and the read-then-write version lets both of
// them win: two approvals, and, if apply follows approval, two writes to the firewall.
func ReviewChangeRequest(
	db *gorm.DB, id uint, approve bool, reviewerID uint, reviewerEmail, note string, now time.Time,
) (*entity.ChangeRequest, error) {
	var r entity.ChangeRequest
	if err := db.First(&r, id).Error; err != nil {
		return nil, err
	}
	if err := CanReview(r, approve, reviewerID, now); err != nil {
		if errors.Is(err, ErrExpired) {
			// Marked expired here rather than left pending: a reviewer who has just been told "no"
			// is owed the real reason, and the queue should not offer it again tomorrow.
			db.Model(&entity.ChangeRequest{}).
				Where("id = ? AND status = ?", id, entity.CRStatusPending).
				Update("status", entity.CRStatusExpired)
		}
		return nil, err
	}

	status := entity.CRStatusRejected
	if approve {
		status = entity.CRStatusApproved
	}
	res := db.Model(&entity.ChangeRequest{}).
		Where("id = ? AND status = ?", id, entity.CRStatusPending).
		Updates(map[string]any{
			"status":         status,
			"reviewed_by_id": reviewerID,
			"reviewed_by":    reviewerEmail,
			"reviewed_at":    now,
			"review_note":    note,
		})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		// Somebody else got there between the read and the update. That is exactly the race this
		// shape exists to lose safely.
		return nil, ErrNotPending
	}
	if err := db.First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// WithdrawChangeRequest lets the requester take their own proposal back.
//
// Only while it is still pending: once a reviewer has approved it, withdrawing is a change of mind
// that the reviewer should see, so it goes through a new request rather than a quiet retraction.
func WithdrawChangeRequest(db *gorm.DB, id, userID uint) error {
	var r entity.ChangeRequest
	if err := db.First(&r, id).Error; err != nil {
		return err
	}
	if r.RequestedByID != userID {
		return ErrNotRequester
	}
	res := db.Model(&entity.ChangeRequest{}).
		Where("id = ? AND status = ?", id, entity.CRStatusPending).
		Update("status", entity.CRStatusWithdrawn)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotPending
	}
	return nil
}

// ExpireStaleRequests marks every pending request whose time is up. Called by the scheduler.
//
// It touches only `pending`: an APPROVED request that is waiting for its maintenance window has
// been reviewed by a person, and taking that decision away from them because a clock ran out would
// be the console overruling the approver.
func ExpireStaleRequests(db *gorm.DB, now time.Time) int64 {
	res := db.Model(&entity.ChangeRequest{}).
		Where("status = ? AND expires_at < ?", entity.CRStatusPending, now).
		Update("status", entity.CRStatusExpired)
	if res.Error != nil {
		return 0
	}
	return res.RowsAffected
}

// DueRequests returns approved requests whose window has arrived, oldest first.
//
// A request with no ScheduledFor is due the moment it is approved; one with a window waits for it.
func DueRequests(db *gorm.DB, now time.Time, limit int) ([]entity.ChangeRequest, error) {
	var out []entity.ChangeRequest
	err := db.Where("status = ?", entity.CRStatusApproved).
		Where("scheduled_for IS NULL OR scheduled_for <= ?", now).
		Order("requested_at asc").
		Limit(limit).
		Find(&out).Error
	return out, err
}

// MarkApplied and MarkFailed close a request out after the replay.
func MarkApplied(db *gorm.DB, id uint, changeRecordID *uint, now time.Time) error {
	return db.Model(&entity.ChangeRequest{}).
		Where("id = ? AND status = ?", id, entity.CRStatusApproved).
		Updates(map[string]any{
			"status":           entity.CRStatusApplied,
			"applied_at":       now,
			"change_record_id": changeRecordID,
			"error_text":       "",
		}).Error
}

func MarkFailed(db *gorm.DB, id uint, detail string, now time.Time) error {
	return db.Model(&entity.ChangeRequest{}).
		Where("id = ? AND status = ?", id, entity.CRStatusApproved).
		Updates(map[string]any{
			"status":     entity.CRStatusFailed,
			"applied_at": now,
			"error_text": detail,
		}).Error
}

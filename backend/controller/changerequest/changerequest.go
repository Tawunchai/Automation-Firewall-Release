package changerequest

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Change Requests — the queue between "I think this rule is right" and a production firewall
// enforcing it.
//
// ── Who may do what, and why it is split this way ────────────────────────────
//
//	raise      any signed-in user who can see the device. This is the point: a change request is
//	           how somebody who may NOT write to a firewall proposes a change to it. Gating the
//	           raise behind admin would leave the queue a thing admins use to talk to each other.
//	review     admin only, and never the requester (enforced in services, on the transition).
//	apply      happens automatically once approved, or at the scheduled window. There is no
//	           separate "apply" button for a third party — an approval IS the decision to apply,
//	           and splitting them would create a state where a change is approved and nobody is
//	           responsible for it.
//	withdraw   the requester, while it is still pending.
//
// The state machine and its races live in services/changerequest.go; this file is the HTTP shape.

// requireAdmin gates review. Raising and reading are open.
func requireAdmin(c *gin.Context) bool {
	if role, _ := c.Get("user_role"); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

func actor(c *gin.Context) (uint, string, bool) {
	id, _ := c.Get("user_id")
	email, _ := c.Get("user_email")
	role, _ := c.Get("user_role")
	uid, _ := id.(uint)
	mail, _ := email.(string)
	return uid, mail, role == "admin"
}

type createInput struct {
	Title  string `json:"title"`
	Reason string `json:"reason"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Body   string `json:"body"`
	/** Optional maintenance window; applied as soon as approved when absent. */
	ScheduledFor *time.Time `json:"scheduled_for"`
	/** Hours until it expires, capped by services.DefaultRequestTTL. */
	ExpiresInHours int `json:"expires_in_hours"`
}

// POST /change-requests
//
// `title` on the wire is the requester's own wording. It is kept — as part of the reason, labelled
// as theirs — but it is NOT what the queue lists: services.PrepareChangeRequest derives the stored
// title from the method and path, so the line an approver reads describes the write rather than
// the requester's account of it.
func Create(c *gin.Context) {
	var inp createInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, email, isAdmin := actor(c)

	deviceID, err := services.ValidateRequestPath(inp.Method, inp.Path)
	if err != nil {
		// A privileged resource is not a malformed request — it is a refusal, and saying so with
		// 400 would read as "try again with better input". See services.privilegedResources: these
		// are the writes an approver must not be able to be talked into making on someone's
		// behalf, and the console refuses them at both entrances to the queue.
		if errors.Is(err, services.ErrPrivilegedPath) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The requester has to be able to SEE the device they are proposing a change to. Without this
	// the queue would be a way to describe a firewall you cannot reach — and, once approved, to
	// have somebody else write to it on your behalf.
	if !services.UserCanAccessDevice(config.DB(), uid, isAdmin, deviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	req := &entity.ChangeRequest{
		NetworkDeviceID: deviceID,
		Title:           inp.Title,
		Reason:          inp.Reason,
		Method:          inp.Method,
		Path:            inp.Path,
		Body:            inp.Body,
		RequestedByID:   uid,
		RequestedBy:     email,
		ScheduledFor:    inp.ScheduledFor,
	}
	ttl := time.Duration(inp.ExpiresInHours) * time.Hour
	if err := services.CreateChangeRequest(config.DB(), req, ttl); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, req)
}

// GET /change-requests?status=pending
//
// Scoped to the devices the caller may see, like every other device-shaped list in this app. A
// queue that showed a change to a firewall you cannot reach would leak the fact that it exists.
func List(c *gin.Context) {
	uid, _, isAdmin := actor(c)

	q := config.DB().Model(&entity.ChangeRequest{}).
		Preload("NetworkDevice").
		Order("requested_at desc")

	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if c.Query("mine") == "true" {
		q = q.Where("requested_by_id = ?", uid)
	}
	if !isAdmin {
		ids, err := services.AccessibleDeviceIDs(config.DB(), uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read your device access"})
			return
		}
		if len(ids) == 0 {
			c.JSON(http.StatusOK, []entity.ChangeRequest{})
			return
		}
		q = q.Where("network_device_id IN ?", ids)
	}

	var out []entity.ChangeRequest
	if err := q.Limit(500).Find(&out).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// GET /change-requests/:id
func Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}
	var r entity.ChangeRequest
	if err := config.DB().Preload("NetworkDevice").First(&r, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change request not found"})
		return
	}
	uid, _, isAdmin := actor(c)
	if !services.UserCanAccessDevice(config.DB(), uid, isAdmin, r.NetworkDeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "change request not found"})
		return
	}
	c.JSON(http.StatusOK, r)
}

type reviewInput struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note"`
	/** Apply at this time instead of immediately. Ignored on a rejection. */
	ScheduledFor *time.Time `json:"scheduled_for"`
}

// POST /change-requests/:id/review
//
// One call does both outcomes, because they are one decision. Approving applies straight away
// unless a window was set — see the note at the top of this file for why there is no third button.
func Review(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}
	var inp reviewInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, email, _ := actor(c)
	now := time.Now()

	r, err := services.ReviewChangeRequest(config.DB(), uint(id), inp.Approve, uid, email, inp.Note, now)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			// Reviewing an id nobody has is a 404. It used to fall through to 500, which told the
			// reviewer the server had broken when the truth is that the request is gone — withdrawn,
			// or never there. Get and Withdraw already answer 404 for the same id; this makes the
			// third door agree with them.
			c.JSON(http.StatusNotFound, gin.H{"error": "change request not found"})
		case errors.Is(err, services.ErrSelfApproval), errors.Is(err, services.ErrNotPending), errors.Is(err, services.ErrExpired):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if !inp.Approve {
		c.JSON(http.StatusOK, gin.H{"message": "change request rejected", "data": r})
		return
	}

	// A window means the scheduler applies it, not this request.
	if inp.ScheduledFor != nil && inp.ScheduledFor.After(now) {
		if err := config.DB().Model(r).Update("scheduled_for", inp.ScheduledFor).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		r.ScheduledFor = inp.ScheduledFor
		c.JSON(http.StatusOK, gin.H{
			"message": "change request approved — it will be applied in its window",
			"data":    r,
		})
		return
	}
	if r.ScheduledFor != nil && r.ScheduledFor.After(now) {
		c.JSON(http.StatusOK, gin.H{
			"message": "change request approved — it will be applied in its window",
			"data":    r,
		})
		return
	}

	res, err := services.ApplyChangeRequest(config.DB(), *r, services.ApplyIdentity{
		UserID: uid, Email: email, Role: "admin",
	}, now)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "approved, but it could not be applied: " + err.Error(),
			"data":  r,
		})
		return
	}
	_ = config.DB().First(r, r.ID).Error

	if res.Status < 200 || res.Status >= 300 {
		// 207: the review DID happen and is recorded; the write did not. Answering 4xx/5xx here
		// would read as "your approval failed", and the operator would press it again.
		c.JSON(http.StatusMultiStatus, gin.H{
			"message": "change request approved, but the device refused the write",
			"detail":  res.Body,
			"data":    r,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "change request approved and applied", "data": r})
}

// POST /change-requests/:id/withdraw
func Withdraw(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}
	uid, _, _ := actor(c)
	if err := services.WithdrawChangeRequest(config.DB(), uint(id), uid); err != nil {
		switch {
		case errors.Is(err, services.ErrNotRequester):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case errors.Is(err, services.ErrNotPending):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "change request not found"})
		default:
			// Everything else here is the database failing, not a missing row. Reporting that as
			// 404 told the requester their request had vanished and hid the real fault.
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "change request withdrawn"})
}

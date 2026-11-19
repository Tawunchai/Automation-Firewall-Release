package policyobject

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

// Audit governance: the trend behind the scans, and the record of what somebody decided to live
// with. Both sit beside the scan rather than inside it — RunAudit stays a pure function of the
// firewall's configuration and knows nothing about databases or sign-offs.

// GET /policy/device/:deviceId/audit/history
//
// The stored scans, oldest first. Not every scan is stored — see services.RecordAuditRun.
func DeviceAuditHistory(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))

	points, err := services.AuditTrend(config.DB(), di.Device.ID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the scan history"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"points": points})
}

// GET /policy/device/:deviceId/posture-score
//
// One headline number (services.ComputePostureScore) plus the same number applied to every stored
// scan, for a trend sparkline — both computed from rows AuditTrend already returns, so this adds no
// new scan and no new opinion about what counts as a gap. Reads the LATEST STORED run rather than
// triggering a fresh scan: a dashboard tile that forced a full policy/object scan on every page
// load would make "how secure am I" the most expensive number on the page, for a figure that only
// changes when someone actually edits the firewall or re-opens Audit / Review.
//
// Open to any signed-in user who can see the device, the same as /audit/history — the score is a
// read of history, not the live management-plane scan that made /audit itself admin-only.
func DeviceGetPostureScore(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))

	points, err := services.AuditTrend(config.DB(), di.Device.ID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the scan history"})
		return
	}

	trend := make([]gin.H, 0, len(points))
	for _, p := range points {
		s := services.ComputePostureScore(auditTrendPointToCounts(p))
		trend = append(trend, gin.H{"scanned_at": p.ScannedAt, "score": s.Score, "grade": s.Grade})
	}

	if len(points) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"assessed_at": nil,
			"current":     nil,
			"trend":       trend,
			"note":        "this device has not been scanned yet — open Audit / Review once to start scoring it",
		})
		return
	}

	latest := points[len(points)-1]
	c.JSON(http.StatusOK, gin.H{
		"assessed_at": latest.ScannedAt,
		"current":     services.ComputePostureScore(auditTrendPointToCounts(latest)),
		"trend":       trend,
	})
}

// auditTrendPointToCounts lifts the fields ComputePostureScore needs out of one stored run — kept
// as one named conversion rather than inlined twice above, so the field mapping is checked in one
// place if AuditTrendPoint's shape ever changes.
//
// No Accepted here: a stored run captures the finding counts as they were scanned, not the
// exceptions table — an acceptance can be granted or revoked long after the scan it applied to, so
// there is nothing fixed-in-time to snapshot. Only the LIVE score (via AuditReport.Standards)
// could carry it; a historical trend point necessarily scores every accepted risk as still open.
func auditTrendPointToCounts(p services.AuditTrendPoint) services.PostureCounts {
	return services.PostureCounts{
		Gaps: p.Gaps, Evidenced: p.Evidenced, Indeterminate: p.Indeterminate, Observations: p.Observations,
		High: p.High, Medium: p.Medium, Low: p.Low,
	}
}

// GET /policy/device/:deviceId/audit/exceptions
//
// Every acceptance ever recorded for the device, including expired and revoked ones: "this was
// accepted between March and July" is part of the audit trail, so nothing is filtered out here.
func DeviceListAuditExceptions(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var rows []entity.AuditException
	if err := config.DB().Where("network_device_id = ?", di.Device.ID).
		Order("created_at DESC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the accepted findings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"exceptions": rows, "max_days": services.MaxExceptionDays})
}

type acceptRequest struct {
	Check   string `json:"check"`
	Subject string `json:"subject"`
	Reason  string `json:"reason"`
	// Days the acceptance runs for. Bounded — see services.MaxExceptionDays.
	Days int `json:"days"`
}

// POST /policy/device/:deviceId/audit/exceptions
//
// Records a decision to live with one finding. Admin-only: accepting a risk is a sign-off, and a
// sign-off from an account that cannot change anything else on the firewall is not worth having.
func DeviceCreateAuditException(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	if !requireAdminPO(c) {
		return
	}

	var req acceptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read the request"})
		return
	}
	req.Check = strings.TrimSpace(req.Check)
	req.Subject = strings.TrimSpace(req.Subject)
	req.Reason = strings.TrimSpace(req.Reason)

	if req.Check == "" || req.Subject == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an acceptance must name the finding it covers"})
		return
	}
	// A blank reason is refused rather than stored. An acceptance with no stated justification is
	// worth nothing to an assessor, and storing one would let the feature be used as a mute button.
	if len(req.Reason) < 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "give a reason of at least 10 characters — this is what an assessor will read"})
		return
	}
	if req.Days <= 0 || req.Days > services.MaxExceptionDays {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "an acceptance must expire within " + strconv.Itoa(services.MaxExceptionDays) + " days",
		})
		return
	}

	uid, _ := c.Get("user_id")
	userID, _ := uid.(uint)
	email := c.GetString("user_email")

	now := time.Now().UTC()
	row := entity.AuditException{
		NetworkDeviceID: di.Device.ID,
		Check:           req.Check,
		Subject:         req.Subject,
		Reason:          req.Reason,
		ApprovedByID:    userID,
		ApprovedBy:      email,
		ApprovedAt:      now,
		ExpiresAt:       now.AddDate(0, 0, req.Days),
		CreatedByID:     userID,
		CreatedBy:       email,
	}
	if err := config.DB().Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not record the acceptance"})
		return
	}
	c.JSON(http.StatusCreated, row)
}

// DELETE /policy/device/:deviceId/audit/exceptions/:id
//
// Withdraws an acceptance. The row is revoked, never deleted — the fact that a risk was accepted
// for a period is itself part of the trail, and a trail that can be erased is not one.
func DeviceRevokeAuditException(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	if !requireAdminPO(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid exception id"})
		return
	}

	var row entity.AuditException
	if err := config.DB().Where("id = ? AND network_device_id = ?", id, di.Device.ID).First(&row).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "acceptance not found"})
		return
	}
	if row.RevokedAt != nil {
		c.JSON(http.StatusOK, row)
		return
	}

	now := time.Now().UTC()
	row.RevokedAt = &now
	row.RevokedBy = c.GetString("user_email")
	if err := config.DB().Save(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not withdraw the acceptance"})
		return
	}
	c.JSON(http.StatusOK, row)
}

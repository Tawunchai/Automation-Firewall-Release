package drift

import (
	"errors"
	"net/http"
	"network_automation/services/drift"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

const (
	defaultTimelineLimit = 50
	maxTimelineLimit     = 200
)

// ── GET /drift/timeline?device_id=&filter=all|console|outside|review|failed&limit=&offset= ──

// Timeline is the page's main list: every change to the firewall, from the Change Ledger and from
// backup comparison, newest first, each saying where it came from and how it can be taken back.
// See services.BuildTimeline.
//
// Read-only and open to any user who can see the device, like the two sources it merges.
func Timeline(c *gin.Context) {
	limit := defaultTimelineLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, maxTimelineLimit)
		}
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			offset = n
		}
	}
	filter := strings.TrimSpace(c.Query("filter"))
	if filter == "" {
		filter = drift.TimelineAll
	}
	if !drift.ValidTimelineFilter(filter) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown filter"})
		return
	}
	var deviceID uint
	if raw := strings.TrimSpace(c.Query("device_id")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			deviceID = uint(n)
		}
	}

	uid, _ := c.Get("user_id")
	out, err := drift.BuildTimeline(config.DB(), drift.TimelineQuery{
		UserID: services.UserIDOf(uid), IsAdmin: isAdmin(c),
		DeviceID: deviceID, Filter: filter, Limit: limit, Offset: offset,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the change history"})
		return
	}
	c.JSON(http.StatusOK, out)
}

// ── GET /drift/findings/:id ──────────────────────────────────────────────────

// GetFinding returns one finding with its ±lines — what a timeline row loads when it is opened. The
// list leaves the diff out: a certificate finding carries kilobytes of it.
func GetFinding(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid finding id"})
		return
	}
	var f entity.DriftFinding
	if err := scopeRef(c, config.DB().Model(&entity.DriftFinding{})).
		Where("id = ?", id).First(&f).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "finding not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": f})
}

// ── POST /drift/findings/:id/undo ────────────────────────────────────────────

// UndoFinding takes back an object that was created outside the console, by deleting it from the
// firewall. Admin-only: it is a write to a live device.
//
// Only that one kind of outside change qualifies (services.OutsideUndoPlan); the rest answer 409
// with the reason, which the page already shows beside the row. The device is reached as the person
// who pressed the button, so the firewall's own log names them.
func UndoFinding(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid finding id"})
		return
	}

	db := config.DB()
	var f entity.DriftFinding
	if err := scopeRef(c, db.Model(&entity.DriftFinding{})).Where("id = ?", id).First(&f).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "finding not found"})
		return
	}
	if plan := drift.OutsideUndoPlan(f); plan.Path == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "this change cannot be undone on its own: " + plan.Reason})
		return
	}

	var device entity.NetworkDevice
	if err := db.First(&device, f.NetworkDeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the device this change was found on no longer exists"})
		return
	}
	callerID := c.GetUint("user_id")
	login, err := services.ResolveDeviceLogin(db, callerID, &device)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fc, err := services.AcquireFortiClient(device.ID, device.MgmtIP, device.APIPort, login)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "FortiGate login failed: " + err.Error()})
		return
	}

	res, err := drift.UndoOutsideCreate(db, fc, f, entity.ChangeRecord{
		AppUserID: callerID,
		UserEmail: c.GetString("user_email"),
		Path:      c.Request.URL.Path,
	})
	services.LogActivity(db, callerID, "drift_undo: finding="+strconv.Itoa(id)+
		" table="+f.Table+" key="+f.ResourceKey+" ok="+strconv.FormatBool(err == nil))

	switch {
	case errors.Is(err, drift.ErrOutsideObjectInUse):
		c.JSON(http.StatusConflict, gin.H{"error": "The firewall refused to delete " + f.Table + " \"" + f.ResourceKey +
			"\": something still uses it. Remove that reference first, then Undo again."})
		return
	case err != nil:
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	case res.AlreadyGone:
		c.JSON(http.StatusOK, gin.H{"message": "Already gone from the firewall — marked as handled", "already_gone": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted from the firewall", "change_id": res.Change.ID})
}

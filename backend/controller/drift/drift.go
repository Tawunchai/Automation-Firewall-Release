// Package drift serves the Configuration Drift page: what changed on a firewall that this
// console did not do.
//
// Reads are open to any signed-in user who can see the device — the same rule the Change Ledger
// follows, and for the same reason: knowing what happened to a firewall is not a privileged
// operation. Running an analysis and undoing a change are writes, and are admin-gated.
package drift

import (
	"net/http"
	"network_automation/services/drift"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

const (
	defaultPageSize = 25
	maxPageSize     = 200
)

func isAdmin(c *gin.Context) bool { return c.GetString("user_role") == "admin" }

func requireAdmin(c *gin.Context) bool {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return false
	}
	return true
}

// Scoping uses the platform's own helpers rather than a local copy.
//
// A drift finding quotes configuration lines out of a firewall, so a query that forgot the scope
// would show one customer's rule base to another. services.ScopeDeviceRefToUser /
// ScopeDevicesToUser already encode the rule — including the part that is easy to get wrong, which
// is that a DATABASE ERROR must match nothing rather than everything (see scopeFromGrants). A
// second implementation here would be a second chance to get that backwards.
func scopeRef(c *gin.Context, q *gorm.DB) *gorm.DB {
	uid, _ := c.Get("user_id")
	return services.ScopeDeviceRefToUser(q, config.DB(), services.UserIDOf(uid), isAdmin(c))
}

func scopeDevices(c *gin.Context, q *gorm.DB) *gorm.DB {
	uid, _ := c.Get("user_id")
	return services.ScopeDevicesToUser(q, config.DB(), services.UserIDOf(uid), isAdmin(c))
}

// ── GET /drift/runs ──────────────────────────────────────────────────────────

// ListRuns returns the analysis history, newest first.
//
// Query: ?device_id= &status= &page= &page_size=
func ListRuns(c *gin.Context) {
	db := config.DB()
	q := db.Model(&entity.DriftRun{})

	if v := strings.TrimSpace(c.Query("device_id")); v != "" {
		if id, err := strconv.Atoi(v); err == nil && id > 0 {
			q = q.Where("network_device_id = ?", id)
		}
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status = ?", v)
	}

	q = scopeRef(c, q)

	var total int64
	q.Count(&total)

	page, size := paging(c)
	var runs []entity.DriftRun
	if err := q.Preload("NetworkDevice").
		Order("id DESC").Limit(size).Offset((page - 1) * size).
		Find(&runs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read drift runs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": runs, "total": total, "page": page, "page_size": size,
	})
}

func paging(c *gin.Context) (page, size int) {
	page, _ = strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	size, _ = strconv.Atoi(c.Query("page_size"))
	if size < 1 {
		size = defaultPageSize
	}
	if size > maxPageSize {
		size = maxPageSize
	}
	return page, size
}

// ── GET /drift/runs/:id ──────────────────────────────────────────────────────

// GetRun returns one run with its findings.
func GetRun(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid run id"})
		return
	}

	db := config.DB()
	q := scopeRef(c, db.Model(&entity.DriftRun{}))

	var run entity.DriftRun
	if err := q.Preload("NetworkDevice").
		// Unaccounted-for changes first — the same order the analysis produced, so the reason the
		// page was opened is the first thing on it.
		Preload("Findings", func(d *gorm.DB) *gorm.DB {
			return d.Order("attributed ASC, \"table\" ASC, resource_key ASC")
		}).
		Where("id = ?", id).First(&run).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "drift run not found"})
		return
	}
	c.JSON(http.StatusOK, run)
}

// ── GET /drift/summary ───────────────────────────────────────────────────────

// DeviceDriftSummary is one row of the overview: where each firewall stands right now.
type DeviceDriftSummary struct {
	NetworkDeviceID uint   `json:"network_device_id"`
	DeviceName      string `json:"device_name"`
	MgmtIP          string `json:"mgmt_ip"`

	// Status is the newest run's status, or "never" when the device has never been analysed.
	Status    string     `json:"status"`
	LastRunID uint       `json:"last_run_id,omitempty"`
	LastRunAt *time.Time `json:"last_run_at,omitempty"`
	Summary   string     `json:"summary,omitempty"`
	// OpenDrift counts the outside changes still standing on this firewall — unattributed findings
	// that no undo has taken back. There is no sign-off any more, so this only falls when a change
	// is actually reversed.
	OpenDrift  int64 `json:"open_drift"`
	BackupSeen bool  `json:"backup_seen"`
}

// Summary is what the page's header renders: one row per firewall the caller can see.
func Summary(c *gin.Context) {
	db := config.DB()

	q := scopeDevices(c, db.Model(&entity.NetworkDevice{}))
	var devices []entity.NetworkDevice
	if err := q.Order("name ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read devices"})
		return
	}

	// Three grouped reads for the whole fleet instead of three per device — see
	// services.LatestDriftRuns. The page's first paint waits on this handler.
	ids := make([]uint, len(devices))
	for i, d := range devices {
		ids[i] = d.ID
	}
	latest := drift.LatestDriftRuns(db, ids)
	open := drift.OpenDriftCounts(db, ids)
	backups := drift.BackupCounts(db, ids)

	out := make([]DeviceDriftSummary, 0, len(devices))
	totalOpen := int64(0)
	for _, d := range devices {
		row := DeviceDriftSummary{
			NetworkDeviceID: d.ID, DeviceName: d.Name, MgmtIP: d.MgmtIP, Status: "never",
			BackupSeen: backups[d.ID] > 0,
			OpenDrift:  open[d.ID],
		}
		if run, found := latest[d.ID]; found {
			at := run.CreatedAt
			row.Status = run.Status
			row.LastRunID = run.ID
			row.LastRunAt = &at
			row.Summary = run.Summary
		}
		totalOpen += row.OpenDrift
		out = append(out, row)
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "open_drift_total": totalOpen})
}

// ── POST /drift/analyse ──────────────────────────────────────────────────────

// Analyse runs the comparison now, against the device's two newest backups.
//
// On-demand rather than only after a backup, because the first thing anyone does with this page is
// press the button — and because a device whose backup schedule is off would otherwise never be
// analysed at all.
func Analyse(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	var body struct {
		DeviceID uint `json:"device_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.DeviceID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id is required"})
		return
	}

	var device entity.NetworkDevice
	if err := scopeDevices(c, config.DB().Model(&entity.NetworkDevice{})).
		Where("id = ?", body.DeviceID).First(&device).Error; err != nil {
		// 404 rather than 403 for a device outside the caller's grant — same as the device proxy,
		// so the response does not confirm that a firewall they cannot see exists.
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	run, err := drift.AnalyseAndStoreDrift(config.DB(), device.ID, 0, c.GetString("user_email"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"),
		"drift_analyse: device="+strconv.Itoa(int(device.ID))+" status="+run.Status)

	c.JSON(http.StatusOK, gin.H{"data": run})
}

package changeledger

import (
	"encoding/json"
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

// Change Audit Ledger — the read + revert API.
//
// Reading the ledger is open to any signed-in user: knowing what changed is not a privileged
// operation, and hiding it from operators defeats the point. Reverting is not — it rewrites a live
// firewall — so it goes through the same admin gate as every other device write.

const defaultLedgerLimit = 50
const maxLedgerLimit = 200

// ── list ─────────────────────────────────────────────────────────────────────

// changeRow is the ledger row as the timeline renders it.
//
// Before/After are shipped as parsed JSON rather than strings so the UI can diff them directly
// instead of re-parsing on every render.
type changeRow struct {
	ID           uint            `json:"id"`
	CreatedAt    time.Time       `json:"created_at"`
	DeviceID     uint            `json:"device_id"`
	DeviceName   string          `json:"device_name,omitempty"`
	UserEmail    string          `json:"user_email"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resource_type"`
	ResourceKey  string          `json:"resource_key"`
	Method       string          `json:"method"`
	Path         string          `json:"path"`
	Status       string          `json:"status"`
	ErrorText    string          `json:"error_text,omitempty"`
	Before       json.RawMessage `json:"before,omitempty"`
	After        json.RawMessage `json:"after,omitempty"`

	// HasBefore/HasAfter say whether a snapshot exists without shipping it. The list leaves the
	// snapshots out (see ListChanges) and the page fetches them one row at a time on expand.
	HasBefore bool `json:"has_before"`
	HasAfter  bool `json:"has_after"`

	RevertedAt *time.Time `json:"reverted_at,omitempty"`
	RevertedBy string     `json:"reverted_by,omitempty"`
	RevertOfID *uint      `json:"revert_of_id,omitempty"`

	// Revertible is the single flag the Revert button binds to. Computed here rather than in the
	// browser so the rules live next to the engine that enforces them.
	Revertible bool   `json:"revertible"`
	RevertNote string `json:"revert_note,omitempty"`
}

// scopedLedger starts a change_records query already narrowed to the devices the caller may see.
//
// Both read endpoints go through it, because they used to go through nothing. "Reading the ledger
// is open to any signed-in user" was the stated rule and it is still right — knowing what changed
// is not privileged — but it was implemented as no filter at all, and the ledger is per-device.
// A user granted one customer's firewall could read the full configuration history of every other
// one: policies, subnets, remote gateways, the shape of somebody else's network.
//
// Password fields are not part of that exposure — the snapshots come back from the device, which
// returns them as `ENC …` — so this is about which firewalls a person can see, not about secrets.
//
// Admins are unfiltered, exactly as they are on every device route.
func scopedLedger(c *gin.Context, db *gorm.DB) *gorm.DB {
	uid, _ := c.Get("user_id")
	return services.ScopeDeviceRefToUser(
		db.Model(&entity.ChangeRecord{}),
		db,
		services.UserIDOf(uid),
		c.GetString("user_role") == "admin",
	)
}

// GET /change-ledger?device_id=&action=&resource_type=&status=&limit=&offset=
func ListChanges(c *gin.Context) {
	db := config.DB()

	limit := defaultLedgerLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= maxLedgerLimit {
			limit = n
		}
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			offset = n
		}
	}

	q := scopedLedger(c, db)
	if raw := strings.TrimSpace(c.Query("device_id")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			q = q.Where("network_device_id = ?", n)
		}
	}
	for _, f := range []struct{ param, column string }{
		{"action", "action"},
		{"resource_type", "resource_type"},
		{"status", "status"},
	} {
		if v := strings.TrimSpace(c.Query(f.param)); v != "" {
			q = q.Where(f.column+" = ?", v)
		}
	}

	var total int64
	q.Session(&gorm.Session{}).Count(&total)

	// The list does not read the snapshot columns. Before/After are whole FortiOS objects — a
	// policy with its profiles is kilobytes — and on the lab ledger they were 140 KB of a 50-row
	// page that nobody reads until a row is opened. Two booleans computed in SQL say whether each
	// exists, which is all the list and the Revert rules need; GET /change-ledger/:id serves the
	// bodies for the one row being opened.
	var rows []ledgerListRow
	if err := q.Session(&gorm.Session{}).
		Select(ledgerListColumns).
		Order("created_at DESC, id DESC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read the change ledger"})
		return
	}

	names := deviceNames(db, rows)
	out := make([]changeRow, 0, len(rows))
	for _, r := range rows {
		row := toChangeRowWith(r.ChangeRecord, r.HasBefore, r.HasAfter)
		row.DeviceName = names[r.NetworkDeviceID]
		out = append(out, row)
	}

	c.JSON(http.StatusOK, gin.H{"data": out, "total": total, "limit": limit, "offset": offset})
}

// ledgerListRow is a change_records row without its snapshot bodies.
type ledgerListRow struct {
	entity.ChangeRecord
	HasBefore bool
	HasAfter  bool
}

// ledgerListColumns is every change_records column except before/after, plus their presence.
// `before`/`after` are quoted because both are keywords in SQL, even where Postgres allows them bare.
const ledgerListColumns = `id, created_at, updated_at, network_device_id, app_user_id, user_email,
	action, resource_type, cmdb_path, resource_key, method, path, status, error_text,
	reverted_at, reverted_by, revert_of_id,
	COALESCE("before", '') <> '' AS has_before,
	COALESCE("after", '') <> '' AS has_after`

// deviceNames resolves the page's device ids to names in one query (what Preload did, without
// needing the full ChangeRecord model to hang it on).
func deviceNames(db *gorm.DB, rows []ledgerListRow) map[uint]string {
	seen := map[uint]bool{}
	ids := make([]uint, 0, 4)
	for _, r := range rows {
		if !seen[r.NetworkDeviceID] {
			seen[r.NetworkDeviceID] = true
			ids = append(ids, r.NetworkDeviceID)
		}
	}
	out := make(map[uint]string, len(ids))
	if len(ids) == 0 {
		return out
	}
	var devices []entity.NetworkDevice
	db.Select("id, name").Where("id IN ?", ids).Find(&devices)
	for _, d := range devices {
		out[d.ID] = d.Name
	}
	return out
}

// ── one entry ────────────────────────────────────────────────────────────────

// GET /change-ledger/:id — one entry with its before/after snapshots.
//
// Scoped exactly like the list: a user who may not see a device may not read its history by
// guessing an id either. 404 for both "no such row" and "not yours", so an id outside the grant is
// indistinguishable from one that does not exist.
func GetChange(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid change id"})
		return
	}
	db := config.DB()
	var rec entity.ChangeRecord
	if err := scopedLedger(c, db).Preload("NetworkDevice").Where("id = ?", id).First(&rec).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": toChangeRow(rec)})
}

func toChangeRow(r entity.ChangeRecord) changeRow {
	row := toChangeRowWith(r, r.Before != "", r.After != "")
	row.Before = rawOrNil(r.Before)
	row.After = rawOrNil(r.After)
	if r.NetworkDevice != nil {
		row.DeviceName = r.NetworkDevice.Name
	}
	return row
}

// toChangeRowWith builds a row from a record whose snapshot bodies may not have been read — the
// list's case — using the presence flags instead.
func toChangeRowWith(r entity.ChangeRecord, hasBefore, hasAfter bool) changeRow {
	row := changeRow{
		ID:           r.ID,
		CreatedAt:    r.CreatedAt,
		DeviceID:     r.NetworkDeviceID,
		UserEmail:    r.UserEmail,
		Action:       r.Action,
		ResourceType: r.ResourceType,
		ResourceKey:  r.ResourceKey,
		Method:       r.Method,
		Path:         r.Path,
		Status:       r.Status,
		ErrorText:    r.ErrorText,
		HasBefore:    hasBefore,
		HasAfter:     hasAfter,
		RevertedAt:   r.RevertedAt,
		RevertedBy:   r.RevertedBy,
		RevertOfID:   r.RevertOfID,
	}
	row.Revertible, row.RevertNote = revertabilityWith(r, hasBefore)
	return row
}

// rawOrNil keeps invalid or empty snapshots out of the response instead of emitting a JSON syntax
// error into the middle of the payload.
func rawOrNil(s string) json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

// revertability decides whether the Revert button is offered, and says why when it is not.
//
// The rules live in services.LedgerRevertability now — the Configuration Drift timeline offers the
// same Undo from a second place, and two copies of "may this be undone" would drift apart. These
// thin wrappers keep this package's call sites and tests reading as before.
func revertability(r entity.ChangeRecord) (bool, string) {
	return drift.LedgerRevertability(r, r.Before != "")
}

// revertabilityWith is revertability for a row read without its snapshot bodies: hasBefore stands
// in for `r.Before != ""`, which is the only thing the rules ever asked of the body.
func revertabilityWith(r entity.ChangeRecord, hasBefore bool) (bool, string) {
	return drift.LedgerRevertability(r, hasBefore)
}

// ── revert ───────────────────────────────────────────────────────────────────

// POST /change-ledger/:id/revert  (admin only)
//
// Applies the inverse of one recorded change to the device and writes a second ledger row for the
// revert itself, so undoing a change is as auditable as making one.
func RevertChange(c *gin.Context) {
	if role, _ := c.Get("user_role"); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid change id"})
		return
	}

	db := config.DB()
	var rec entity.ChangeRecord
	if err := db.First(&rec, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}

	if ok, why := revertability(rec); !ok {
		c.JSON(http.StatusConflict, gin.H{"error": "this change cannot be reverted: " + why})
		return
	}

	var device entity.NetworkDevice
	if err := db.First(&device, rec.NetworkDeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the device this change was made on no longer exists"})
		return
	}
	callerID := c.GetUint("user_id")
	// Reverting is a WRITE to a live firewall, so it must reach the device as the person who
	// pressed the button — the whole point of the ledger is that both halves of a change are
	// attributable. It used to use the device's shared account.
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

	// A move is put back by moving the policy next to its old neighbour; everything else by
	// replaying the recorded before-state. See services/changeledger_move.go.
	var revertErr error
	if services.IsPolicyMoveRecord(rec) {
		revertErr = fc.RevertPolicyMove(rec)
	} else {
		revertErr = fc.ExecuteRevert(rec.Action, rec.CMDBPath, rec.ResourceKey, json.RawMessage(rec.Before))
	}

	// The revert is itself a change to a live firewall, so it gets its own ledger row — including
	// when it fails. The middleware does not see this route (it is not a device-proxy path), so the
	// row is written here.
	userID, _ := c.Get("user_id")
	uid, _ := userID.(uint)
	mirror := entity.ChangeRecord{
		NetworkDeviceID: rec.NetworkDeviceID,
		AppUserID:       uid,
		UserEmail:       c.GetString("user_email"),
		Action:          inverseAction(rec.Action),
		ResourceType:    rec.ResourceType,
		CMDBPath:        rec.CMDBPath,
		ResourceKey:     rec.ResourceKey,
		Method:          "POST",
		Path:            c.Request.URL.Path,
		Before:          rec.After,
		After:           rec.Before,
		Status:          entity.ChangeStatusApplied,
		RevertOfID:      &rec.ID,
	}
	if revertErr != nil {
		mirror.Status = entity.ChangeStatusFailed
		mirror.ErrorText = revertErr.Error()
	}
	db.Create(&mirror)

	if revertErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": revertErr.Error()})
		return
	}

	now := time.Now()
	rec.Status = entity.ChangeStatusReverted
	rec.RevertedAt = &now
	rec.RevertedBy = c.GetString("user_email")
	db.Save(&rec)

	c.JSON(http.StatusOK, gin.H{
		"message":   "change reverted on the device",
		"change_id": rec.ID,
		"revert_id": mirror.ID,
	})
}

// inverseAction names what the revert did, from the ledger's point of view: undoing a create is a
// delete, undoing a delete is a create, and undoing an update is another update.
func inverseAction(action string) string {
	switch action {
	case entity.ChangeActionCreate:
		return entity.ChangeActionDelete
	case entity.ChangeActionDelete:
		return entity.ChangeActionCreate
	default:
		return entity.ChangeActionUpdate
	}
}

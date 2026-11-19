package policyobject

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

// Audit / Review ▸ applying a remediation, and taking it back.
//
// This is the only place in the audit feature that writes to a firewall, and it is arranged so that
// the write is the least interesting thing about it:
//
//	POST .../audit/remediation/preview   what would be written, and what must be answered first
//	POST .../audit/remediation/apply     do it, snapshotting each object into the change ledger
//	POST .../audit/remediation/undo      replay those snapshots, newest first
//
// THE PREVIEW IS NOT OPTIONAL. Apply recomputes it server-side from a fresh scan and refuses to
// write anything the preview did not name — a client cannot post a list of attributes and have them
// written. What the operator confirmed and what reaches the device are the same computation.
//
// EVERY WRITE IS A LEDGER ROW. Not as bookkeeping: the ledger's Before snapshot IS the undo. The
// same ExecuteRevert the Change Ledger page uses puts the object back, so this feature inherits a
// revert path the project already relies on rather than inventing a second one.
//
// ORDER MATTERS ON THE WAY OUT. Undo replays newest first. Applying A then B and undoing in the
// same order would put A back and leave B, which is not the state anybody asked for.

type applyRequest struct {
	ControlID string `json:"control_id"`
	// Answers maps question id → value, for the fixes whose value this console will not invent.
	Answers map[string]string `json:"answers"`
	// AcknowledgeUnverified must be true to write a step whose command the device did not confirm.
	// A separate flag rather than part of the confirmation, because it is a different decision:
	// "yes, change my firewall" and "yes, even though we could not check this command".
	AcknowledgeUnverified bool `json:"acknowledge_unverified"`
}

// buildApplyPlanFor re-runs the scan and recomputes the plan, so a preview and an apply are the
// same computation over the same freshly-read device.
func buildApplyPlanFor(c *gin.Context, req applyRequest) (deviceClient, services.RemediationPlan, services.ApplyPlan, bool) {
	fc, report, ok := runAuditForRemediation(c)
	if !ok {
		return nil, services.RemediationPlan{}, services.ApplyPlan{}, false
	}
	plan, err := services.BuildRemediationPlan(fc, report.Findings, report.UndecidedChecks, req.ControlID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return nil, services.RemediationPlan{}, services.ApplyPlan{}, false
	}
	apply := services.BuildApplyPlan(plan, req.Answers)
	services.SortQuestions(apply.Questions)
	return fc, plan, apply, true
}

// POST /policy/device/:deviceId/audit/remediation/preview
func DeviceAuditRemediationPreview(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req applyRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ControlID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "control_id is required"})
		return
	}
	req.ControlID = strings.TrimSpace(req.ControlID)

	_, plan, apply, ok := buildApplyPlanFor(c, req)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"preview": apply, "plan": plan})
}

// POST /policy/device/:deviceId/audit/remediation/apply
//
// Writes. Admin only, confirmed by the caller, and every object snapshotted first.
func DeviceAuditRemediationApply(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req applyRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ControlID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "control_id is required"})
		return
	}
	req.ControlID = strings.TrimSpace(req.ControlID)

	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	fc, _, apply, ok := buildApplyPlanFor(c, req)
	if !ok {
		return
	}
	if !apply.Ready {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "this plan still needs answers before it can be applied",
			"preview": apply,
		})
		return
	}
	// A command the firmware could not confirm is exactly the one that may not do what it says.
	// Writing it takes a second, separate decision.
	if !req.AcknowledgeUnverified {
		for _, w := range apply.Writes {
			switch w.Verified {
			case services.FixAttrUnknown, services.FixValueUnlisted, services.FixUnreadable:
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "this device did not confirm the command for " + w.Check +
						". Acknowledge that before applying it.",
					"preview": apply,
				})
				return
			}
		}
	}

	db := config.DB()
	userID := c.GetUint("user_id")
	email := c.GetString("user_email")

	results := make([]services.ApplyResult, 0, len(apply.Writes))
	var applyErr error

	for _, w := range apply.Writes {
		ledgerPath := services.LedgerPath(w.Path)

		// Before, first. A write with no snapshot is a write with no way back, so the snapshot is
		// taken even though a failure to take one does not stop the change — the ledger's own rule.
		//
		// A single-object table (system global, log setting) has no mkey, and the ledger's snapshot
		// helper correctly refuses a keyless read — for a collection that would be a table-wide
		// operation. Those tables are snapshotted by their own path instead. Found the hard way:
		// the first live apply set fwpolicy-implicit-log and then could not put it back.
		var before json.RawMessage
		if services.IsSingleObjectTable(w.Path) {
			before, _ = fc.SnapshotCMDBTable(w.Path)
		} else {
			before, _ = fc.SnapshotCMDBObject(ledgerPath, w.MKey)
		}

		// Schema-aware, best-effort: a table/datasource attribute (service, member lists, …) needs
		// the [{"name":"x"}] shape FortiOS's CMDB API expects, not the quoted CLI text a fix writes
		// it as — see CoerceCMDBAttrValue. If the schema itself cannot be read, fall back to the
		// plain coercion rather than failing the whole write over it.
		schema, schemaErr := fc.GetCMDBSchema(w.Path)
		attrs := make(map[string]any, len(w.Attrs))
		for k, v := range w.Attrs {
			if schemaErr == nil {
				attrs[k] = services.CoerceCMDBAttrValue(schema, k, v)
			} else {
				attrs[k] = services.CoerceCMDBValue(v)
			}
		}
		err := fc.UpdateCMDBAttrs(w.Path, w.MKey, attrs)

		// The backstop: FortiOS answering "success" is not proof a table-typed attribute actually
		// changed (this is exactly how the bug this guards against was found — a service list PUT
		// that reported success while the device kept the old value). Re-read the object and refuse
		// to call it applied if what was intended is not actually there.
		var after json.RawMessage
		if err == nil {
			if services.IsSingleObjectTable(w.Path) {
				after, _ = fc.SnapshotCMDBTable(w.Path)
			} else {
				after, _ = fc.SnapshotCMDBObject(ledgerPath, w.MKey)
			}
			if missing := services.MissingListMembers(attrs, after); len(missing) > 0 {
				err = fmt.Errorf("the device accepted the write but did not apply it: %s", strings.Join(missing, "; "))
			}
		}

		rec := entity.ChangeRecord{
			NetworkDeviceID: di.Device.ID,
			AppUserID:       userID,
			UserEmail:       email,
			Action:          entity.ChangeActionUpdate,
			ResourceType:    "audit-remediation:" + w.Check,
			CMDBPath:        ledgerPath,
			ResourceKey:     w.MKey,
			Method:          http.MethodPut,
			Path:            ledgerPath,
			Before:          string(before),
			Status:          entity.ChangeStatusApplied,
		}
		// The real post-write state when it could be read — honest, and what makes the check above
		// possible — falling back to what was sent only when no snapshot could be taken at all.
		if after != nil {
			rec.After = string(after)
		} else if body, mErr := json.Marshal(w.Attrs); mErr == nil {
			rec.After = string(body)
		}
		res := services.ApplyResult{Check: w.Check, Path: w.Path, MKey: w.MKey, Attrs: w.Attrs, OK: err == nil}
		if err != nil {
			rec.Status = entity.ChangeStatusFailed
			rec.ErrorText = err.Error()
			res.Error = err.Error()
			applyErr = err
		}
		if dbErr := db.Create(&rec).Error; dbErr == nil {
			res.ChangeID = rec.ID
		}
		results = append(results, res)
		if err != nil {
			// Stop at the first failure. Carrying on leaves the firewall in a state neither the
			// plan nor the operator described; what did land is in results, with its change ids.
			break
		}
	}

	status := http.StatusOK
	body := gin.H{"results": results, "applied": len(results)}
	if applyErr != nil {
		status = http.StatusBadGateway
		body["error"] = applyErr.Error()
	}
	c.JSON(status, body)
}

// deviceFacts collects the few lines of this firewall's own configuration that a suggested value
// could legitimately be drawn from.
//
// Interfaces and address objects, and nothing else: those are what the placeholders in the fix CLI
// ask for — a management subnet, a destination address. Capped, because this goes into a prompt and
// a hundred address objects would cost more than they inform.
func deviceFacts(fc deviceClient) []string {
	var out []string
	if ifaces, err := fc.GetInterfaces(); err == nil {
		for _, i := range ifaces {
			if strings.TrimSpace(i.IP) == "" || strings.HasPrefix(i.IP, "0.0.0.0") {
				continue
			}
			out = append(out, fmt.Sprintf("interface %s carries %s", i.Name, i.IP))
			if len(out) >= 12 {
				break
			}
		}
	}
	if addrs, err := fc.GetAddresses(); err == nil {
		n := 0
		for _, a := range addrs {
			if strings.TrimSpace(a.Subnet) == "" {
				continue
			}
			out = append(out, fmt.Sprintf("address object %q is %s", a.Name, a.Subnet))
			if n++; n >= 12 {
				break
			}
		}
	}
	return out
}

type undoRequest struct {
	ChangeIDs []uint `json:"change_ids"`
}

// POST /policy/device/:deviceId/audit/remediation/undo
//
// Puts back what an apply wrote, newest first, using the ledger's own snapshots.
func DeviceAuditRemediationUndo(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req undoRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.ChangeIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "change_ids is required"})
		return
	}
	di, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	db := config.DB()
	userID := c.GetUint("user_id")
	email := c.GetString("user_email")

	type undoResult struct {
		ChangeID uint   `json:"change_id"`
		OK       bool   `json:"ok"`
		Error    string `json:"error,omitempty"`
	}
	out := make([]undoResult, 0, len(req.ChangeIDs))

	// Newest first. Applying A then B and undoing in the same order would put A back and leave B,
	// which is a state nobody asked for.
	for i := len(req.ChangeIDs) - 1; i >= 0; i-- {
		id := req.ChangeIDs[i]
		res := undoResult{ChangeID: id}

		var rec entity.ChangeRecord
		// Scoped to this device: an id from another firewall must not be revertible through here.
		if err := db.Where("id = ? AND network_device_id = ?", id, di.Device.ID).First(&rec).Error; err != nil {
			res.Error = "no such change on this device"
			out = append(out, res)
			continue
		}
		if rec.Status != entity.ChangeStatusApplied {
			res.Error = "this change is " + rec.Status + " and cannot be undone again"
			out = append(out, res)
			continue
		}
		if strings.TrimSpace(rec.Before) == "" {
			res.Error = "no snapshot was taken of this object, so there is nothing to put back"
			out = append(out, res)
			continue
		}

		// A single-object table goes back by its own path; everything else through the ledger's own
		// revert, which is the machinery the Change Ledger page uses and this feature inherits.
		var revertErr error
		if tablePath := strings.TrimPrefix(rec.CMDBPath, "/api/v2/cmdb/"); services.IsSingleObjectTable(tablePath) {
			revertErr = fc.RestoreCMDBTable(tablePath, json.RawMessage(rec.Before))
		} else {
			revertErr = fc.ExecuteRevert(rec.Action, rec.CMDBPath, rec.ResourceKey, json.RawMessage(rec.Before))
		}
		if revertErr != nil {
			res.Error = revertErr.Error()
			out = append(out, res)
			continue
		}

		now := time.Now().UTC()
		rec.Status = entity.ChangeStatusReverted
		rec.RevertedAt = &now
		rec.RevertedBy = email
		db.Save(&rec)

		// The undo is itself a write to a live firewall and gets its own row, pointing at what it
		// undid — the same shape the Change Ledger page produces.
		mirror := entity.ChangeRecord{
			NetworkDeviceID: rec.NetworkDeviceID,
			AppUserID:       userID,
			UserEmail:       email,
			Action:          entity.ChangeActionUpdate,
			ResourceType:    rec.ResourceType,
			CMDBPath:        rec.CMDBPath,
			ResourceKey:     rec.ResourceKey,
			Method:          http.MethodPut,
			Path:            rec.CMDBPath,
			Before:          rec.After,
			After:           rec.Before,
			Status:          entity.ChangeStatusApplied,
			RevertOfID:      &rec.ID,
		}
		db.Create(&mirror)

		res.OK = true
		out = append(out, res)
	}
	c.JSON(http.StatusOK, gin.H{"results": out})
}

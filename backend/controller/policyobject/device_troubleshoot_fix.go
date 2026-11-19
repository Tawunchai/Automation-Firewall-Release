package policyobject

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

// Troubleshoot ▸ fix it — what-if, apply and undo for the plans a trace offers.
//
// The split is the one the rest of this package draws. Previewing is a simulation over reads (the
// same CMDB and monitor GETs the trace makes) and writes nothing, so it is open to anyone who can
// see the device. Applying and undoing rewrite a live rule base and are admin-only.
//
// NOTHING THE BROWSER SENDS IS WRITTEN. The request carries the question (the 5-tuple) and the id of
// the plan the operator looked at. The server traces again from fresh reads, builds the plans again,
// and applies the one with that id — refusing when its fingerprint no longer matches the one that
// was previewed, because the firewall changed and the operator has not seen what would now be
// written. The same rule the audit remediation endpoints follow (device_audit_apply.go).
//
// Every write lands in the change ledger under "troubleshoot-fix:<op>", with a before that is only
// what the step changed, so undo — here or from the Change history — puts back exactly that.

// fixLedgerPrefix marks the ledger rows this feature writes; undo here only touches those.
const fixLedgerPrefix = "troubleshoot-fix:"

// traceFixRequest is the question and the plan the page previewed.
type traceFixRequest struct {
	Src         string `json:"src"`
	Dst         string `json:"dst"`
	Protocol    string `json:"protocol"`
	Port        int    `json:"port"`
	SrcIntf     string `json:"src_intf"`
	FixID       string `json:"fix_id"`
	Fingerprint string `json:"fingerprint"`
}

// traceProtocol maps what the form sends ("tcp", "6", "icmp") to an IP protocol number.
func traceProtocol(raw string) (int, bool) {
	protocol := strings.ToLower(strings.TrimSpace(raw))
	if protocol == "" {
		protocol = "tcp"
	}
	if n, ok := protocolNumber[protocol]; ok {
		return n, true
	}
	// A raw protocol number is the only way to trace GRE/ESP/OSPF.
	n, err := strconv.Atoi(protocol)
	if err != nil || n < 1 || n > 255 {
		return 0, false
	}
	return n, true
}

func (r traceFixRequest) query() (services.FGTraceQuery, bool) {
	proto, ok := traceProtocol(r.Protocol)
	if !ok {
		return services.FGTraceQuery{}, false
	}
	return services.FGTraceQuery{
		SrcIP: strings.TrimSpace(r.Src), DstIP: strings.TrimSpace(r.Dst),
		Protocol: proto, DstPort: r.Port, SrcIntf: strings.TrimSpace(r.SrcIntf),
	}, true
}

// bindTraceFix reads the request, answering the caller itself when it cannot be used.
func bindTraceFix(c *gin.Context) (traceFixRequest, services.FGTraceQuery, bool) {
	var req traceFixRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.FixID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the trace (src, dst, protocol, port) and fix_id are required"})
		return req, services.FGTraceQuery{}, false
	}
	q, ok := req.query()
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "protocol must be tcp, udp, icmp, sctp or an IP protocol number 1-255"})
		return req, q, false
	}
	// The page sends the address it traced, but a host name is accepted the same way the trace
	// accepts one. A name behind a CDN may resolve differently now than at preview time — then the
	// plan differs and apply's fingerprint check refuses it, which is the right answer.
	dst, _, _, err := resolveTraceDestination(c.Request.Context(), q.DstIP)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return req, q, false
	}
	q.DstIP = dst
	return req, q, true
}

// traceFixError maps a planner failure to a status: a bad tuple is the caller's (400), a plan that
// is no longer on offer is a conflict with the device's current state (409), anything else is the
// device (502).
func traceFixError(c *gin.Context, err error) {
	status := http.StatusBadGateway
	switch {
	case isTraceInputError(err):
		status = http.StatusBadRequest
	case errors.Is(err, services.ErrFixUnavailable):
		status = http.StatusConflict
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

// POST /policy/device/:deviceId/policy-trace/what-if
//
// The trace as it stands, the plan, and the trace as it would be. Writes nothing.
func DeviceSimulateTraceFix(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	req, q, ok := bindTraceFix(c)
	if !ok {
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	preview, err := fc.PreviewTraceFix(q, strings.TrimSpace(req.FixID))
	if err != nil {
		traceFixError(c, err)
		return
	}
	c.JSON(http.StatusOK, preview)
}

// traceFixResult is one step's outcome, as the page shows it.
type traceFixResult struct {
	Step     services.FGFixStep `json:"step"`
	OK       bool               `json:"ok"`
	Reused   bool               `json:"reused,omitempty"`
	Error    string             `json:"error,omitempty"`
	ChangeID uint               `json:"change_id,omitempty"`
}

// POST /policy/device/:deviceId/policy-trace/fix
//
// Writes the plan, step by step, recording each in the change ledger; stops at the first failure;
// then traces again from the live device, so the page shows what the firewall now does rather than
// what the simulation said it would.
func DeviceApplyTraceFix(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	req, q, ok := bindTraceFix(c)
	if !ok {
		return
	}
	if strings.TrimSpace(req.Fingerprint) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "fingerprint is required — preview the fix before applying it"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	plan, policies, err := fc.PlanTraceFix(q, strings.TrimSpace(req.FixID))
	if err != nil {
		traceFixError(c, err)
		return
	}
	if plan.Fingerprint != strings.TrimSpace(req.Fingerprint) {
		c.JSON(http.StatusConflict, gin.H{
			"error": "the firewall changed since this fix was previewed — review it again before applying",
			"plan":  plan,
		})
		return
	}

	db := config.DB()
	userID := c.GetUint("user_id")
	email := c.GetString("user_email")

	results := make([]traceFixResult, 0, len(plan.Steps))
	changeIDs := make([]uint, 0, len(plan.Steps))
	var applyErr error
	newPolicyID := 0

	for _, step := range plan.Steps {
		out, err := fc.ExecuteFixStep(step, newPolicyID, policies)
		if out.PolicyID > 0 {
			newPolicyID = out.PolicyID
		}
		res := traceFixResult{Step: step, OK: err == nil, Reused: out.Reused}

		// Reused: the object was already exactly as planned and nothing was written. No ledger row,
		// because an undo of it would delete something this fix did not add.
		if !out.Reused && out.CMDBPath != "" {
			rec := entity.ChangeRecord{
				NetworkDeviceID: di.Device.ID,
				AppUserID:       userID,
				UserEmail:       email,
				Action:          out.Action,
				ResourceType:    services.FixLedgerType(step),
				CMDBPath:        out.CMDBPath,
				ResourceKey:     out.MKey,
				Method:          http.MethodPut,
				Path:            out.CMDBPath,
				Before:          string(out.Before),
				After:           string(out.After),
				Status:          entity.ChangeStatusApplied,
			}
			if out.Action == services.ChangeActionCreate {
				rec.Method = http.MethodPost
			}
			if err != nil {
				rec.Status = entity.ChangeStatusFailed
				rec.ErrorText = platform.TruncateUTF8(err.Error(), 2000)
			}
			if dbErr := db.Create(&rec).Error; dbErr == nil {
				res.ChangeID = rec.ID
				if err == nil {
					changeIDs = append(changeIDs, rec.ID)
				}
			}
		}
		if err != nil {
			res.Error = err.Error()
			applyErr = err
		}
		results = append(results, res)
		if err != nil {
			// Stop at the first failure: carrying on would leave the firewall in a state neither the
			// plan nor the operator described. What did land is listed, with its change ids, so the
			// page can offer to undo it.
			break
		}
	}

	body := gin.H{"results": results, "change_ids": changeIDs, "plan": plan}
	// The live answer, not the simulated one. Best-effort: the writes stand whether or not the
	// device answers the re-trace.
	if after, err := fc.TracePolicyPath(q); err == nil {
		body["after"] = after
	}
	if applyErr != nil {
		body["error"] = applyErr.Error()
		c.JSON(http.StatusBadGateway, body)
		return
	}
	c.JSON(http.StatusOK, body)
}

type traceFixUndoRequest struct {
	ChangeIDs []uint `json:"change_ids"`
}

// POST /policy/device/:deviceId/policy-trace/fix/undo
//
// Puts back what an apply wrote, newest first: a moved policy goes back next to its old neighbour,
// a written attribute gets its old value, a created object is deleted by its key.
func DeviceUndoTraceFix(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req traceFixUndoRequest
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

	// Newest first. The policy change is undone before the address it references is deleted —
	// the other way round, FortiOS refuses the delete because the object is still in use.
	for i := len(req.ChangeIDs) - 1; i >= 0; i-- {
		id := req.ChangeIDs[i]
		res := undoResult{ChangeID: id}

		var rec entity.ChangeRecord
		// Scoped to this device AND to this feature's own rows: this endpoint is not a second door
		// into reverting anything in the ledger.
		if err := db.Where("id = ? AND network_device_id = ?", id, di.Device.ID).First(&rec).Error; err != nil ||
			!strings.HasPrefix(rec.ResourceType, fixLedgerPrefix) {
			res.Error = "no such troubleshooting fix on this device"
			out = append(out, res)
			continue
		}
		if rec.Status != entity.ChangeStatusApplied {
			res.Error = "this change is " + rec.Status + " and cannot be undone again"
			out = append(out, res)
			continue
		}

		var err error
		switch rec.ResourceType {
		case services.LedgerTypeFixPlaceNew:
			// Nothing of its own: it placed the policy this fix created, and undoing that create —
			// an older row, reached next — deletes the policy.
		case services.LedgerTypeFixMove:
			// Back next to its old neighbour — the same revert the Change history uses for a move.
			err = fc.RevertPolicyMove(rec)
		default:
			err = fc.ExecuteRevert(rec.Action, rec.CMDBPath, rec.ResourceKey, json.RawMessage(rec.Before))
			// Already gone is the state an undo of a create wants.
			if err != nil && rec.Action == services.ChangeActionCreate && services.IsObjectGoneError(err) {
				err = nil
			}
		}
		if err != nil {
			res.Error = err.Error()
			out = append(out, res)
			continue
		}

		now := time.Now().UTC()
		rec.Status = entity.ChangeStatusReverted
		rec.RevertedAt = &now
		rec.RevertedBy = email
		db.Save(&rec)

		// The undo is itself a write to a live firewall and gets its own row, pointing at what it
		// undid — the same shape the Change history produces.
		// Undoing a create is a delete; everything else is an update back to the old value.
		mirrorAction, mirrorMethod := entity.ChangeActionUpdate, http.MethodPut
		if rec.Action == services.ChangeActionCreate {
			mirrorAction, mirrorMethod = entity.ChangeActionDelete, http.MethodDelete
		}
		db.Create(&entity.ChangeRecord{
			NetworkDeviceID: rec.NetworkDeviceID,
			AppUserID:       userID,
			UserEmail:       email,
			Action:          mirrorAction,
			ResourceType:    rec.ResourceType,
			CMDBPath:        rec.CMDBPath,
			ResourceKey:     rec.ResourceKey,
			Method:          mirrorMethod,
			Path:            rec.CMDBPath,
			Before:          rec.After,
			After:           rec.Before,
			Status:          entity.ChangeStatusApplied,
			RevertOfID:      &rec.ID,
		})

		res.OK = true
		out = append(out, res)
	}
	c.JSON(http.StatusOK, gin.H{"results": out})
}

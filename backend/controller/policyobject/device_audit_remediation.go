package policyobject

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/services"
)

// Audit / Review ▸ how to close a control, and what closing it would change.
//
// Three endpoints, and the split between them is the point:
//
//	GET  /policy/audit/reference                       static reading material, no device
//	POST /policy/device/:deviceId/audit/remediation    computed plan + projection, no model
//	POST /policy/device/:deviceId/audit/remediation/ai the model's execution advice
//
// The first has no device in its path because it has no device in its answer: it is NIST's
// published control text plus this console's correspondence to Annex A, identical for every caller
// and every firewall. Hanging it off a device id would have implied it was scanned from one.
//
// The second RE-RUNS THE SCAN rather than accepting findings from the browser. That is deliberate
// and it is a security property, not a performance choice: a projection computed from a body the
// caller supplied is a projection the caller can dictate, and this page's whole purpose is to be
// the thing a customer shows an assessor. The plan describes the firewall as the server just read
// it, or it describes nothing.
//
// The third is the only one that spends a model call, and it is a separate request so the page can
// render the computed plan immediately and let the operator decide whether they also want the
// sequencing advice.

// GET /policy/audit/reference
//
// Open to any signed-in user: it is public-domain standards text and a mapping this console
// publishes on its own page. Nothing about any device is in it.
func AuditReference(c *gin.Context) {
	c.JSON(http.StatusOK, services.BuildReferenceCatalogue())
}

type remediationRequest struct {
	// ControlID is the Annex A control to plan for, e.g. "A.8.15".
	ControlID string `json:"control_id"`
}

// runAuditForRemediation re-reads the device and applies the same two layers the Audit page does,
// so a plan is computed against exactly the report the user is looking at.
//
// It repeats DeviceAudit's body rather than calling it because that handler writes the response and
// records a trend point; a remediation request is not a scan the user asked for and must not appear
// in the history as one.
func runAuditForRemediation(c *gin.Context) (deviceClient, services.AuditReport, bool) {
	di, fc, ok := deviceSession(c)
	if !ok {
		return nil, services.AuditReport{}, false
	}
	report, err := fc.RunAudit()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return nil, services.AuditReport{}, false
	}
	services.ApplyAuditRecords(config.DB(), di.Device.ID, &report, time.Now().UTC())
	// The client is returned as well: it is the session that can ask this device's own
	// ?action=schema whether the commands in the plan are ones its firmware accepts, and it already
	// holds the schema cache for the paths the plan touches.
	return fc, report, true
}

// stampSchemaSource records which device and firmware answered the command checks. A verdict with
// no provenance is exactly the kind of unsourced claim this page exists to remove.
func stampSchemaSource(c *gin.Context, plan *services.RemediationPlan, report services.AuditReport) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	plan.SchemaSource = &services.SchemaSource{
		Device:   di.Device.Name,
		Serial:   report.DeviceSerial,
		Firmware: report.DeviceFirmware,
		Method:   "GET /api/v2/cmdb/<path>?action=schema",
	}
}

// POST /policy/device/:deviceId/audit/remediation
//
// Admin only, for the same reason DeviceAudit is: the plan names administrator accounts, their
// trusted-host restrictions and the management protocols the device answers on.
func DeviceAuditRemediation(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req remediationRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ControlID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "control_id is required"})
		return
	}
	fc, report, ok := runAuditForRemediation(c)
	if !ok {
		return
	}
	plan, err := services.BuildRemediationPlan(
		fc, report.Findings, report.UndecidedChecks, strings.TrimSpace(req.ControlID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	stampSchemaSource(c, &plan, report)
	c.JSON(http.StatusOK, plan)
}

// POST /policy/device/:deviceId/audit/remediation/ai
//
// The same plan, plus the model's view of how to run it. Kept separate so the page never blocks on
// a model call to show what it already computed, and so a deployment with no API key still gets the
// whole feature minus the advice.
func DeviceAuditRemediationAdvice(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var req remediationRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ControlID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "control_id is required"})
		return
	}
	req.ControlID = strings.TrimSpace(req.ControlID)
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	fc, report, ok := runAuditForRemediation(c)
	if !ok {
		return
	}
	plan, err := services.BuildRemediationPlan(
		fc, report.Findings, report.UndecidedChecks, strings.TrimSpace(req.ControlID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	stampSchemaSource(c, &plan, report)

	// Reuse an answer already produced for this device, this control and THIS CONFIGURATION.
	//
	// Keyed on the configuration fingerprint rather than on a clock: the advice stops being valid
	// exactly when the firewall changes, which is what the fingerprint tracks. Reopening the panel,
	// or showing it to a colleague tomorrow, is then free instead of another 25 seconds and another
	// couple of thousand tokens. The hit is declared in the response, never hidden.
	if cached, at, ok := services.CachedAdvice(di.Device.ID, req.ControlID, report.ConfigFingerprint); ok {
		c.JSON(http.StatusOK, gin.H{"plan": plan, "advice": cached, "cached": true, "cached_at": at})
		return
	}

	// The questions the apply cannot answer for itself, and the device's own configuration to
	// answer them FROM. Without the facts the model would suggest a plausible-looking subnet that
	// exists nowhere on this network — which is exactly the value that locks an administrator out.
	questions := services.BuildApplyPlan(plan, nil).Questions
	services.SortQuestions(questions)
	advice, err := services.AuditRemediationAdvice(c.Request.Context(), di.Device.Name, plan, questions, deviceFacts(fc))
	if err != nil {
		// A missing key or a model outage must not read as "this control cannot be fixed". The
		// computed plan is still the answer; the advice is the extra.
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	services.StoreAdvice(di.Device.ID, req.ControlID, report.ConfigFingerprint, *advice)
	c.JSON(http.StatusOK, gin.H{"plan": plan, "advice": advice, "cached": false})
}

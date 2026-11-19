package routes

import (
	"github.com/gin-gonic/gin"
	"network_automation/controller/changeledger"
	"network_automation/controller/diagstream"
	"network_automation/controller/drift"
	po "network_automation/controller/policyobject"
	middlewares "network_automation/middleware"
)

// The pages that read a firewall and work something out: Troubleshoot, hit counts and rule
// lifecycle, Audit / Review, the traffic log, the change ledger and configuration drift.
//
// They are grouped by what they are FOR rather than by which table they read, because that is how
// someone arrives at them: "why is this rule not matching", "what is wrong with this firewall",
// "who changed this".
func registerAnalytics(protected *gin.RouterGroup) {
	// ── Troubleshoot: "why can't A reach B?" ─────────────────────────────
	// Walks the policy table for one 5-tuple and reports the matching policy plus the reason
	// every policy above it was passed over. Read-only — CMDB + monitor GETs, no SSH, no AI.
	protected.GET("/policy/device/:deviceId/policy-trace", po.DeviceTracePolicyPath)
	// Fix it: the trace's plans, simulated (open, writes nothing) and applied / undone (admin).
	// The server re-plans from fresh reads every time — the body names a plan, it never supplies
	// what to write. Recorded in the ledger by the handlers, not by ChangeRecorder: the route
	// tail is not one CMDB object. See controller device_troubleshoot_fix.go.
	protected.POST("/policy/device/:deviceId/policy-trace/what-if", po.DeviceSimulateTraceFix)
	protected.POST("/policy/device/:deviceId/policy-trace/fix", po.DeviceApplyTraceFix)
	protected.POST("/policy/device/:deviceId/policy-trace/fix/undo", po.DeviceUndoTraceFix)

	// ── Policy Hit-Count & Rule Lifecycle ─────────────────────────────────
	// Joins the CMDB policy table to the live per-policy hit counters and classifies each rule
	// as active / idle / stale / never-used. Read-only; the "remove" advice is a badge, not an
	// action.
	protected.GET("/policy/device/:deviceId/policy-stats", po.DeviceGetPolicyUsage)

	// Stored history — the ONE device route that never reaches the device. Everything it
	// answers with was sampled by the scheduler, because a FortiGate keeps twenty-four hours of
	// CPU and no history of anything else at all. See services/metrics.go.
	protected.GET("/policy/device/:deviceId/metrics", po.DeviceMetricHistory)

	// Who made the changes Configuration Drift could not account for, read from the firewall's
	// own event log. Separate from /drift/timeline on purpose: that one answers from our
	// database and survives an unreachable device, this one cannot. See the controller.
	protected.GET("/policy/device/:deviceId/drift-attribution", po.DeviceGetDriftAttribution)

	// ── Audit / Review: "what is wrong with this firewall?" ──────────────
	// Shadowed rules, any/any/any, uninspected internet egress, dead policies, orphan objects.
	// All computed — no AI in the scan itself. Read-only; each finding carries fix CLI as text.
	protected.GET("/policy/device/:deviceId/audit", po.DeviceAudit)

	// There is no /security-rating route any more. It relayed the device's own posture report,
	// which carries Fortinet's FSBP and PCI control ids, and its only reader was the Audit
	// page's Device Rating tab — removed when the page was narrowed to ISO/IEC 27001.

	// Audit governance: the trend behind the scans, and the record of what somebody signed off
	// on. Reading is open to any user who can see the device; accepting a risk is admin-only,
	// and an acceptance is revoked rather than deleted so the trail survives.
	protected.GET("/policy/device/:deviceId/audit/history", po.DeviceAuditHistory)
	// One headline grade distilled from the same stored scans — see DeviceGetPostureScore.
	protected.GET("/policy/device/:deviceId/posture-score", po.DeviceGetPostureScore)
	protected.GET("/policy/device/:deviceId/audit/exceptions", po.DeviceListAuditExceptions)
	protected.POST("/policy/device/:deviceId/audit/exceptions", po.DeviceCreateAuditException)
	protected.DELETE("/policy/device/:deviceId/audit/exceptions/:id", po.DeviceRevokeAuditException)

	// "How do I close this control, and what would closing it change?"
	//
	// The reference catalogue is static public-domain standards text and carries no device id
	// because it describes no device — see controller device_audit_remediation.go. The two
	// remediation endpoints re-run the scan server-side rather than trusting findings posted
	// from a browser: a projection computed from a caller-supplied body is a projection the
	// caller can dictate, and this page exists to be shown to an assessor. POST rather than GET
	// because each one costs a live read of the firewall, and the second also a model call.
	protected.GET("/policy/audit/reference", po.AuditReference)
	protected.POST("/policy/device/:deviceId/audit/remediation", po.DeviceAuditRemediation)
	protected.POST("/policy/device/:deviceId/audit/remediation/ai", po.DeviceAuditRemediationAdvice)

	// The only part of the audit feature that WRITES. Preview is what would be sent; apply
	// sends it, snapshotting every object into the change ledger first; undo replays those
	// snapshots newest first. All three are admin-only and all three recompute the plan
	// server-side from a fresh scan — a caller cannot post a list of attributes and have them
	// written. See controller device_audit_apply.go.
	protected.POST("/policy/device/:deviceId/audit/remediation/preview", po.DeviceAuditRemediationPreview)
	protected.POST("/policy/device/:deviceId/audit/remediation/apply", po.DeviceAuditRemediationApply)
	protected.POST("/policy/device/:deviceId/audit/remediation/undo", po.DeviceAuditRemediationUndo)

	// ── Diagnostics ───────────────────────────────────────────────────────
	//
	// Split by what a call costs the firewall rather than by read vs write.
	//
	// What is left here is REST-only. network-settings is four monitor/CMDB GETs, ip-info and
	// ip-geo are computed on this box, and none of the three opens an SSH session — so all
	// three are open to any signed-in user, like Troubleshoot and Audit, and none of them
	// carries DiagLimiter.
	//
	// The SSH-backed diagnostics are no longer in this package. Ping and traceroute stream over
	// the WebSocket at /diag-stream below (controller/diagstream, admin-gated before the
	// upgrade); their POST siblings, the session table and the support bundle were deleted with
	// Session Monitor's live tab. DiagLimiter now sits where the SSH logins actually happen —
	// /diag-stream and the two device-credential routes that verify a login — and NOT here. If
	// an SSH-backed tool ever comes back to this section, it needs the limiter AND an admin
	// gate in its handler, because every call is a login and the device locks an admin account
	// after 3 failed ones.
	protected.GET("/policy/device/:deviceId/diag/network-settings", po.DeviceCheckNetworkSettings)

	// Trace Route hop detail — local rDNS + address-kind + cross-reference against the device's
	// own interfaces/routes and the fleet. No third-party geolocation; reads only.
	protected.GET("/policy/device/:deviceId/ip-info", po.DeviceLookupIPInfo)
	// The batch, geo-only sibling of ip-info: one call enriches every hop of a traceroute at
	// once, from the local GeoLite2 files, so the hop strip does not fire one ip-info (two CMDB
	// reads + a 2s rDNS lookup) per hop. Same gate and same middleware as ip-info — it reaches
	// getDeviceInfo for the per-user device-access check and then talks to nothing.
	//
	// This line is the one the routes/handler-coverage test exists for: the handler shipped,
	// the frontend called it (api/diagnostics.ts), and nobody registered it, so every hop
	// lookup 404'd silently.
	protected.GET("/policy/device/:deviceId/ip-geo", po.DeviceLookupIPGeo)

	// ── Log & Report ▸ Local Traffic ──────────────────────────────────────
	//
	// The device's own traffic log, out of whichever backend it keeps one in (memory /
	// FortiGate Cloud / disk / FortiAnalyzer — the picker is built from what the unit reports,
	// not from a hard-coded list). These are plain GETs against a third API namespace,
	// /api/v2/log/…, which is neither the CMDB nor the monitor API; see services/fortigate_log.go.
	//
	// Admin-gated in the handlers, unlike the rest of this proxy where reads are open: a
	// traffic log names internal addresses, users and their devices, so it is data about
	// people rather than configuration. The sidebar hides the page to match.
	//
	// No DiagLimiter: nothing here opens an SSH session, so none of it can spend an attempt
	// against the device's admin-lockout threshold.
	//
	// `export` is a child path rather than a ".csv" suffix because gin matches a wildcard
	// segment whole — ":subcategory" would capture "local.csv" and the two could not coexist.
	protected.GET("/policy/device/:deviceId/logs/sources", po.DeviceGetLogSources)
	protected.GET("/policy/device/:deviceId/logs/traffic/:subcategory", po.DeviceGetTrafficLog)
	protected.GET("/policy/device/:deviceId/logs/traffic/:subcategory/export", po.DeviceDownloadTrafficLog)
	// The AI's reading of the same entries. Same admin gate, same filters, one extra device
	// read — see controller/policyobject/device_log_explain.go for why it re-reads.
	protected.GET("/policy/device/:deviceId/logs/traffic/:subcategory/explain", po.DeviceExplainTrafficLog)

	// Live ping / traceroute over a WebSocket. Same commands as the two POST endpoints above,
	// delivered as the device prints them — FortiOS emits ping replies 1s apart and traceroute
	// hops as they resolve, and a 31s traceroute returned in one lump is a frozen page.
	//
	// It sits at its own top-level path rather than under /policy/device/… because nginx has to
	// set `Connection: upgrade` for it, and that header would break SSE and keep-alive for
	// every other route sharing the prefix (see frontend/nginx/common.conf).
	// Admin-gated inside the handler, before the upgrade — afterwards there is no HTTP status
	// left to send.
	//
	// DiagLimiter (10/min per session) is the front door to the app's SSH surface: every
	// accepted connection here is a login against a unit with admin-lockout-threshold 3. The
	// per-device gate in services/fortigate_diagexec.go serialises them and trips a breaker on
	// failure; this stops a held-down refresh key queueing a minute of traceroutes before that
	// gate ever sees them. It runs BEFORE the upgrade, so a throttled caller gets a plain 429
	// rather than a socket that opens and dies.
	protected.GET("/diag-stream/:deviceId/:tool", middlewares.DiagLimiter.Middleware(), diagstream.Stream)

	// ── Change Audit Ledger + One-Click Rollback ──────────────────────────
	// Reading the ledger is open to any signed-in user — knowing what changed is not a
	// privileged operation. Reverting rewrites a live firewall and is admin-gated in the
	// handler, like every other device write.
	// ── Configuration Drift ───────────────────────────────────────────────
	//
	// The other half of the Change Ledger below: the ledger says what THIS console did to a
	// firewall, and these say what changed on it that the ledger cannot account for. Reads are
	// open to any user who can see the device (and scoped to that); running an analysis and
	// signing a finding off are admin.
	protected.GET("/drift/summary", drift.Summary)
	// "Are these two firewalls consistent?" — reads two devices' latest backups, no :deviceId
	// in the path since it takes two. See controller/drift/compare.go.
	protected.GET("/drift/compare", drift.Compare)
	// Stat tiles + the two charts: console changes vs changes made outside it, per day and per
	// FortiOS table. Grouped in SQL — see services/driftanalytics.go.
	protected.GET("/drift/analytics", drift.Analytics)
	protected.GET("/drift/runs", drift.ListRuns)
	protected.GET("/drift/runs/:id", drift.GetRun)
	protected.POST("/drift/analyse", drift.Analyse)
	// The page's one list: ledger rows + unattributed findings, merged and paged in SQL. A
	// finding's diff loads on open; Undo (admin) deletes an object created outside the
	// console, by mkey, and records it in the ledger. See services/drifttimeline.go.
	protected.GET("/drift/timeline", drift.Timeline)
	protected.GET("/drift/findings/:id", drift.GetFinding)
	protected.POST("/drift/findings/:id/undo", drift.UndoFinding)

	//
	// The ledger has no page of its own any more: its timeline is the "Change Ledger" tab of
	// Configuration Drift, beside the drift findings it is the other half of. The list is lean
	// (no before/after bodies); /:id serves one entry's snapshots when a row is opened.
	protected.GET("/change-ledger", changeledger.ListChanges)
	protected.GET("/change-ledger/:id", changeledger.GetChange)
	protected.POST("/change-ledger/:id/revert", changeledger.RevertChange)
}

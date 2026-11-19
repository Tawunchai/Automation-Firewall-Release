package routes

import (
	"github.com/gin-gonic/gin"
	"network_automation/controller/activitylog"
	"network_automation/controller/auth"
	"network_automation/controller/automationjob"
	"network_automation/controller/backupcodes"
	calendar "network_automation/controller/calendar"
	"network_automation/controller/configdeploy"
	"network_automation/controller/deviceaccess"
	"network_automation/controller/devicecredential"
	"network_automation/controller/health"
	"network_automation/controller/hostpin"
	"network_automation/controller/maintenance"
	"network_automation/controller/networkdevice"
	"network_automation/controller/otp"
	"network_automation/controller/passwordpolicy"
	"network_automation/controller/sse"
	"network_automation/controller/terminal"
	"network_automation/controller/topologydevice"
	totpctrl "network_automation/controller/totp"
	"network_automation/controller/user"
	middlewares "network_automation/middleware"
)

// The console's own surface: who you are, which firewalls you may touch, the credentials you
// reach them with, and the jobs and backups the worker runs for you.
//
// Nothing here talks to a FortiGate directly — these are this application's own records. The
// routes that do are in routes_device_objects.go and routes_device_system.go.
func registerApp(protected *gin.RouterGroup) {
	protected.GET("/auth/me", auth.Me)

	// ── My device credentials (Profile ▸ Device Credentials) ──────────────
	//
	// A person's own firewall account, mapped to a device, so that everything they do through
	// the console reaches the device as THEM and lands in its event log under their name
	// instead of the one shared `admin` (services/devicecred.go).
	//
	// Open to every signed-in user and scoped to the caller in every query — there is no admin
	// view of somebody else's rows, because an endpoint that could rewrite another person's
	// credential would undo the attribution this exists to create. Not admin-gated for the same
	// reason: it grants nothing. Whatever the mapped account may do on the firewall, it could
	// already do over SSH without this console.
	//
	// The three write paths carry DiagLimiter (10/min per session) even though they grant
	// nothing, because each one VERIFIES the account it is given — Create, Update and Test all
	// reach services.VerifyDeviceLogin, which is a real login against the firewall. The lab
	// unit's admin-lockout-threshold is 3: a form submitted in a loop with a wrong password
	// locks the account for everyone, console and CLI alike. List and Delete touch only this
	// database and stay unthrottled beyond GeneralLimiter.
	protected.GET("/me/device-credentials", devicecredential.List)
	protected.POST("/me/device-credentials", middlewares.DiagLimiter.Middleware(), devicecredential.Create)
	protected.PUT("/me/device-credentials/:id", middlewares.DiagLimiter.Middleware(), devicecredential.Update)
	protected.POST("/me/device-credentials/:id/test", middlewares.DiagLimiter.Middleware(), devicecredential.Test)
	protected.DELETE("/me/device-credentials/:id", devicecredential.Delete)

	// ── Network Automation: Devices + Jobs + Backups ──────────────────────
	protected.GET("/devices", networkdevice.List)
	protected.GET("/devices/:id", networkdevice.GetByID)
	protected.POST("/devices", networkdevice.Create)
	// Bulk onboarding (Phase C4) — several device rows in one request, each with its own
	// created/failed result (see controller/networkdevice/bulk.go). Creates rows only; reaching
	// a device for the first time still happens the existing way, one at a time, afterwards.
	protected.POST("/devices/bulk", networkdevice.BulkCreate)
	protected.PATCH("/devices/:id", networkdevice.Update)
	protected.DELETE("/devices/:id", networkdevice.Delete)
	protected.GET("/devices/:id/ping", networkdevice.PingDevice)
	protected.POST("/devices/batch-backup", automationjob.BackupBatch)
	protected.POST("/devices/:id/backup", automationjob.TriggerBackup)
	protected.GET("/devices/:id/backups", automationjob.ListDeviceBackups)
	protected.GET("/backups/:id/content", automationjob.GetBackupContent)
	protected.GET("/backups/:id/download", automationjob.DownloadBackup)
	protected.DELETE("/backups/:id", automationjob.DeleteBackup)
	protected.GET("/jobs", automationjob.ListJobs)
	protected.GET("/jobs/:id", automationjob.GetJob)
	protected.POST("/jobs/:id/reset", automationjob.ResetJob)
	protected.GET("/worker/health", automationjob.WorkerHealth)
	// The app's OWN health — request volume, error rate, latency, pooled FortiGate sessions —
	// as opposed to a device's. Admin-only, because unlike /healthz and /readyz this is a page
	// a person opens rather than a probe an orchestrator polls. See controller/health/appmetrics.go.
	protected.GET("/admin/system-metrics", health.AppMetrics)
	protected.GET("/network/overview", automationjob.NetworkOverview)

	// ── Config deploy (push config หลายอุปกรณ์พร้อมกัน) ──────────────────
	protected.POST("/config-deploys", configdeploy.Create)
	protected.GET("/config-deploys", configdeploy.List)
	protected.POST("/config-deploys/query", configdeploy.Query)
	protected.GET("/config-deploys/:id", configdeploy.Get)
	// Restore a whole configuration onto a firewall. Two steps on purpose: the preview
	// reports what would happen (and whether the file even matches the unit), and the POST
	// refuses to run without an explicit confirm — a FortiOS config restore reboots.
	protected.GET("/backups/:id/rollback-preview", configdeploy.RollbackPreview)
	protected.POST("/backups/:id/rollback", configdeploy.Rollback)

	// ── Credential key rotation (admin) ───────────────────────────────────
	protected.POST("/admin/rotate-cred-key", networkdevice.RotateCredKey)

	// ── Pinned device identities ──────────────────────────────────────
	//
	// What this console believes each firewall IS: the SSH host keys and the HTTPS certificate
	// it pinned on first contact (services/sshhostkey.go, services/tlspin.go). Both checks
	// refuse a changed identity every time and have no "accept the new one" branch, so a
	// legitimate re-key or a replaced certificate needs a deliberate clear — this is it.
	// Admin-only, enforced in the handlers.
	//
	// These two have NO page any more. The owner removed System ▸ Device Identities
	// (/admin/host-pins) on 2026-11-19 as a screen no user needs; the pinning itself was not
	// touched, so the lockout these endpoints exist to undo can still happen — a FortiOS upgrade
	// that regenerates the host key, or a replaced HTTPS certificate, and every connection to that
	// device is refused until its pin is gone.
	//
	// So they stay, as the recovery path. Signed in as an admin, against this API — and with the
	// cookie jar OUTSIDE the repository, which the repo's own hook will insist on:
	//
	//	JAR="${TMPDIR:-/tmp}/na-cookies.txt"
	//	curl -s -c "$JAR" -X POST localhost:9000/auth/login -H 'Content-Type: application/json' \
	//	     -d '{"email":"…","password":"…"}'
	//	curl -s -b "$JAR" localhost:9000/host-pins
	//	curl -s -b "$JAR" -X DELETE localhost:9000/host-pins/ssh/<id>   # kind = ssh | tls
	//	rm -f "$JAR"
	//
	// Compare the fingerprint the error names with the one on the device's own console BEFORE
	// clearing: the next connection pins whatever answers. Deleting the row straight out of
	// Postgres is NOT the same thing — a soft delete leaves the row holding its unique index and
	// the device stays unreachable, which is why hostpin.Delete is a hard delete.
	protected.GET("/host-pins", hostpin.List)
	protected.DELETE("/host-pins/:kind/:id", hostpin.Delete)

	protected.GET("/users/stats", user.GetStats)
	protected.GET("/users", user.ListUser)
	// Every user's address and phone number in one array. Admin-only, and gated in the handler
	// like the rest of this block — it was public until now, which made the login page an
	// unauthenticated directory of everyone who works here.
	protected.GET("/email-phone-numbers", user.ListEmailAndPhoneNumber)
	protected.GET("/users/:id", user.ListUserByID)
	protected.PATCH("/update-users/:id", user.UpdateUserByID)
	protected.DELETE("/delete-users/:id", user.DeleteUserByID)
	protected.POST("/create-users", user.CreateUser)
	protected.POST("/users/bulk-delete", user.BulkDeleteUsers)
	protected.PATCH("/users/bulk-role", user.BulkChangeRole)
	protected.GET("/roles", user.ListRoles)
	protected.PATCH("/admin/users/:id", user.UpdateUserIDByAdmin)
	protected.PATCH("/theme-preference", user.UpdateThemePreference)

	// ── Per-user device access (admin) ────────────────────────────────────
	//
	// "Which firewalls may this person work on." Admin-only, because this is the table every
	// other access check reads — an endpoint a user could call would be the escalation it
	// exists to prevent.
	//
	// There is no read endpoint for one's OWN access: GET /devices above is already scoped to
	// the caller, so "what can I reach" is answered by the inventory itself rather than by a
	// second list that could disagree with it.
	//
	// The static /users/device-access/summary must be registered BEFORE /users/:id/devices —
	// gin would otherwise try to bind "device-access" as an :id.
	protected.GET("/users/device-access/summary", deviceaccess.Summary)
	protected.GET("/users/:id/devices", deviceaccess.ListForUser)
	protected.PUT("/users/:id/devices", deviceaccess.SetForUser)

	protected.GET("/send-emails", otp.ListSendEmail)
	protected.POST("/send-email", otp.CreateSendEmail)
	protected.PUT("/send-email/:id", otp.UpdateSendEmailByID)

	// Activity logs
	protected.GET("/activity-logs", activitylog.ListMyActivityLogs)
	// Aggregate counts for the Users page charts. Separate from the list above because that
	// one is paginated: the panels were drawing "all time" totals from a 50-row page.
	protected.GET("/activity-logs/summary", activitylog.ActivitySummary)
	protected.GET("/admin/activity-logs", activitylog.ListAllActivityLogs)

	// Security config — system-wide 2FA/OTP toggles (admin only)
	protected.GET("/security-config", otp.GetSecurityConfig)
	protected.PATCH("/toggle-two-step", otp.ToggleTwoStep) // สวิตช์ใหญ่ ต้องเปิดก่อนสองบรรทัดล่างถึงมีผล
	protected.PATCH("/toggle-2fa", otp.Toggle2FA)
	protected.PATCH("/toggle-reset-otp", otp.ToggleResetOTP)

	// Calendar Events
	protected.GET("/calendar-events", calendar.ListEvents)
	protected.POST("/calendar-events", calendar.CreateEvent)
	protected.PATCH("/calendar-events/:id", calendar.UpdateEvent)
	protected.DELETE("/calendar-events/:id", calendar.DeleteEvent)

	// Topology ▸ pinned devices — the user's own auxiliary devices on the 3D map, pinged by a
	// firewall on a schedule. Per-user (owner-scoped) inside each handler; the ping path reaches
	// a device only through the shared diag gate and automation login.
	protected.GET("/topology-devices", topologydevice.List)
	protected.POST("/topology-devices", topologydevice.Create)
	protected.PATCH("/topology-devices/:id", topologydevice.Update)
	protected.DELETE("/topology-devices/:id", topologydevice.Delete)
	protected.POST("/topology-devices/:id/check", topologydevice.CheckNow)
	// Re-ping ALL of the caller's pinned devices at once (optional ?device_id= scopes to the
	// firewall in view). The Topology page fires this on open so the map confirms live up/down
	// instead of showing a status left over from the last scheduled sweep. Its own path parent
	// (/topology/…, not /topology-devices/:id/…) so gin's POST tree keeps the static segment clear
	// of the :id param above. See controller topologydevice.CheckAll.
	protected.POST("/topology/recheck", topologydevice.CheckAll)

	// ── Config Deploy: the interactive terminal ───────────────────────────
	// A WebSocket carrying one live SSH or telnet shell. Admin-gated inside the handler,
	// before the upgrade — after it there is no way to send an HTTP status. The batch
	// /config-deploys endpoints above are the other half of that page and still queue through
	// Redis + the Python worker, which is right for pushing a script to many devices; this is
	// for typing at a prompt, which a queue cannot do.
	protected.GET("/terminal/:deviceId/shell", terminal.Shell)

	// NOTE: the Session Management page and its four endpoints were removed on request. The
	// user_sessions TABLE stays — it is not that page's data, it is how a token is revoked:
	// auth.issueSessionCookie writes a row per login, auth.Logout and otp's password reset
	// revoke rows, and middleware.Authorizes rejects any request whose row is missing or
	// revoked. Dropping it would silently turn logout and post-reset invalidation into no-ops.

	// Maintenance mode (admin only)
	protected.GET("/maintenance", maintenance.GetStatus)
	protected.PATCH("/maintenance/toggle", maintenance.Toggle)
	protected.PATCH("/password-policy", passwordpolicy.UpdatePolicy)
	// SSE — real-time server push
	protected.GET("/events", sse.Handler)

	// TOTP — per-user setup
	protected.GET("/totp/status", totpctrl.GetStatus)
	protected.GET("/totp/setup-init", totpctrl.SetupInit)
	protected.POST("/totp/setup-verify", totpctrl.SetupVerify)
	protected.PATCH("/totp/toggle-enabled", totpctrl.ToggleEnabled)
	protected.DELETE("/totp/disable", totpctrl.Disable)
	// TOTP — admin global toggle
	protected.GET("/totp/global", totpctrl.GetGlobal)
	protected.PATCH("/totp/global-toggle", totpctrl.ToggleGlobal)

	// Backup recovery codes
	protected.POST("/backup-codes/generate", backupcodes.Generate)
	protected.GET("/backup-codes/status", backupcodes.GetStatus)
}

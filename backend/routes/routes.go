package routes

import (
	"github.com/gin-gonic/gin"
	"network_automation/controller/auth"
	"network_automation/controller/automationjob"
	"network_automation/controller/configdeploy"
	"network_automation/controller/health"
	"network_automation/controller/maintenance"
	"network_automation/controller/otp"
	"network_automation/controller/passwordpolicy"
	"network_automation/controller/workercred"
	middlewares "network_automation/middleware"
)

func Setup(r *gin.Engine) {
	// ── Health ─────────────────────────────────────────────────────────────────
	//
	// `/` is kept as it was: a human hitting the port wants to see something, and several notes in
	// this repo tell people to curl it. The two probes below are the ones with a contract — see
	// controller/health for why liveness and readiness cannot be the same endpoint, and why
	// neither says more than ok/fail.
	r.GET("/", func(c *gin.Context) {
		c.String(200, "API RUNNING")
	})
	r.GET("/healthz", health.Live)
	r.GET("/readyz", health.Ready)

	// ── Public auth ────────────────────────────────────────────────────────────
	r.POST("/auth/login", middlewares.LoginLimiter.Middleware(), auth.Login)
	r.POST("/auth/logout", auth.Logout)

	// OAuth — redirect to provider
	r.GET("/auth/google", auth.OAuthGoogleRedirect)
	r.GET("/auth/github", auth.OAuthGithubRedirect)
	r.GET("/auth/line", auth.OAuthLineRedirect)
	// OAuth — provider callbacks
	r.GET("/auth/google/callback", auth.OAuthGoogleCallback)
	r.GET("/auth/github/callback", auth.OAuthGithubCallback)
	r.GET("/auth/line/callback", auth.OAuthLineCallback)
	r.GET("/maintenance/status", maintenance.PublicStatus)
	r.GET("/password-policy", passwordpolicy.GetPolicy)

	// ── Worker callbacks (internal — auth ด้วย X-Worker-Secret ไม่ใช่ cookie) ──
	r.POST("/internal/jobs/:id/start", automationjob.WorkerStart)
	r.POST("/internal/jobs/:id/result", automationjob.WorkerResult)
	r.POST("/internal/config-deploys/:id/start", configdeploy.WorkerStart)
	r.POST("/internal/config-deploys/:id/device-result", configdeploy.WorkerDeviceResult)
	// The worker exchanges a queued job's single-use token for that device's login here, instead
	// of the job message carrying the decrypted password through Redis (services/jobcredential.go).
	r.POST("/internal/job-credentials", workercred.Redeem)
	// And checks the device's SSH host key against the same pins the Go side uses, so the worker
	// and the console cannot disagree about which firewall they have met before.
	r.POST("/internal/ssh-host-key", workercred.CheckHostKey)

	// ── Second factor ─────────────────────────────────────────────────────────
	//
	// No limiter middleware here, deliberately, and it is not an oversight: the thing worth
	// counting is the ACCOUNT, and the account is only known after the pending token in the body
	// has been parsed — which a route middleware cannot do. So the two TOTP endpoints charge
	// middlewares.TwoFactorAccountLimiter from inside the handler (5 failures / 15 min / account,
	// shared between them, cleared on success), the same shape auth.Login uses for
	// LoginAccountLimiter.
	//
	// Counting attempts per address instead would have bought nothing: /auth/login does not charge
	// a successful password check, so anyone holding the password could mint pending tokens at will
	// and spray six-digit codes from as many addresses as they liked.
	//
	// 2-step verification via email OTP. This one carries its own counter already — the attempt
	// count and the "verified" flag live on the OTP row itself (services.OTPMaxAttempts), which
	// also makes it single-use.
	r.POST("/auth/verify-2fa", auth.Verify2FA)
	// TOTP login verification — also refuses a code that has already been accepted inside its ~90s
	// window (controller/auth/totp_verify.go).
	r.POST("/auth/verify-totp", auth.VerifyTOTP)
	// Backup code login verification — single-use by construction (the row is burned)
	r.POST("/auth/verify-backup-code", auth.VerifyBackupCode)

	// ── Forgot password (unauthenticated, rate limited) ───────────────────────
	//
	// These three are the WHOLE public surface after login: a person who has lost their password
	// names their address, receives a code in the mailbox, and sets a new one with it. Nothing here
	// may disclose whether an address is registered, and nothing here may accept anything but that
	// mailed code as proof of ownership — see auth.CheckUserEmail for what used to be here instead.
	//
	// ไม่มี self-registration ในระบบนี้ — บัญชีถูกสร้างโดย admin ผ่าน /users เท่านั้น
	// เส้นทาง /register, /send-otp-signup, /verify-otp-signup ถูกถอดออกแล้ว: มันเปิด
	// public และ /register จะ "สร้างบัญชีให้ใครก็ได้" ทันทีที่ signup_otp_enabled เป็น false
	// ซึ่งเป็นสวิตช์ที่ไม่มีหน้าจอไหนควบคุมอีกต่อไป
	//
	// /email-phone-numbers used to sit in this group. It is a dump of every user's address and
	// phone number and it needed no cookie at all — the one page that calls it is the admin-only
	// Create/Edit User dialog, so it now lives with the other admin routes below.
	otpGroup := r.Group("")
	otpGroup.Use(middlewares.OTPLimiter.Middleware())
	{
		otpGroup.POST("/check-user-email", auth.CheckUserEmail)
		otpGroup.POST("/send-otp", otp.SendOTP)
		otpGroup.POST("/verify-otp-password", otp.VerifyOTPAddUpdatePassword)
	}

	// ── Protected ─────────────────────────────────────────────────────────────
	protected := r.Group("")
	protected.Use(middlewares.Authorizes())
	// Mandatory approval gate for the three resource types that decide what a firewall allows
	// through it (firewall policies, virtual IPs, security profiles — services.RequiresApproval).
	// Registered BEFORE the ledger recorder and every route below: an intercepted write is queued
	// as a Change Request and never reaches the handler, so there is nothing yet for the ledger to
	// record. See middleware/requireapproval.go.
	protected.Use(middlewares.RequireApproval())
	// Change Audit Ledger. Registered here, before any route below, because gin binds group
	// middleware at registration time — moving it lower would silently stop auditing everything
	// declared above it. It is a no-op for anything that is not a write to /policy/device/…, so a
	// read pays one prefix check.
	protected.Use(middlewares.ChangeRecorder())

	// The protected surface, in five registrars. They are called in order and every one of them
	// registers onto THIS group, after the three Use() calls above — gin binds group middleware at
	// registration time, so a route declared before them would be served with no authorisation, no
	// approval gate and no ledger entry. That is the one thing to keep in mind when adding a file
	// here: register onto the group you are given, never onto the engine.
	registerApp(protected)
	registerDeviceObjects(protected)
	registerDeviceSystem(protected)
	registerAnalytics(protected)
	registerAutomation(protected)
}

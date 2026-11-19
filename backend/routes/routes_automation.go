package routes

import (
	"github.com/gin-gonic/gin"
	"network_automation/controller/ai"
	"network_automation/controller/changerequest"
	"network_automation/controller/notify"
	"network_automation/controller/siemexport"
	middlewares "network_automation/middleware"
)

// The parts that act on their own or in front of a firewall: the AI Assistant, the change-request
// queue a write may have to pass through, alerting, and the SIEM export.
func registerAutomation(protected *gin.RouterGroup) {
	// ── AI Assistant: คำขอภาษาธรรมดา → คำสั่ง config (Claude) ─────────────
	// Streamed, because the console renders the answer while the model writes it. A buffered twin
	// of this route existed and was removed on 2026-11-19: no client ever called it.
	protected.POST("/ai/generate-config/stream", middlewares.AILimiter.Middleware(), ai.GenerateConfigStream)
	protected.POST("/ai/diagnose-job", middlewares.AILimiter.Middleware(), ai.DiagnoseJob)

	// ── Change Requests: the queue in front of a live firewall ────────────
	//
	// Everything else in this app writes the moment an admin presses Save, and the Change
	// Ledger records it AFTERWARDS. This is the other half: a proposal, a second pair of eyes,
	// and only then the write.
	//
	// Raising is open to any signed-in user who can see the device — that is the point, since a
	// request is how somebody who may NOT write to a firewall proposes a change to it. Review
	// is admin-only and can never be the requester (enforced on the transition, in
	// services/changerequest.go). There is no separate apply endpoint: approving IS the
	// decision to apply, and the approved write is replayed through this same router so it goes
	// down the identical path as a direct one, ledger row and all.
	protected.GET("/change-requests", changerequest.List)
	protected.POST("/change-requests", changerequest.Create)
	protected.GET("/change-requests/:id", changerequest.Get)
	protected.POST("/change-requests/:id/review", changerequest.Review)
	protected.POST("/change-requests/:id/withdraw", changerequest.Withdraw)

	// ── Notify Management ─────────────────────────────────────────────────
	//
	// Admin-only, enforced in every handler rather than by a group: a channel holds a LINE bot
	// token, and a rule decides who gets woken at 3am. Neither is a personal preference.
	//
	// The alerts themselves are produced by a background sweep (scheduler →
	// services.RunNotifySweep), not by anything here; /notify/run just triggers one early so a
	// freshly written rule can be checked against what the firewall is doing right now.
	// ── SIEM Export (Phase C1) ─────────────────────────────────────────────
	// Streams the Change Ledger to an external webhook as it happens — a sibling of Notify, not
	// built on it, since a Notify rule fires on a condition and this fires on every row. See
	// services/siemexport.go.
	protected.GET("/admin/siem-export", siemexport.GetPolicy)
	protected.PATCH("/admin/siem-export", siemexport.UpdatePolicy)
	protected.POST("/admin/siem-export/test", siemexport.TestWebhook)

	protected.GET("/notify/kinds", notify.ListKinds)
	protected.GET("/notify/overview", notify.Overview)
	protected.POST("/notify/run", notify.RunNow)

	protected.GET("/notify/channels", notify.ListChannels)
	protected.POST("/notify/channels", notify.CreateChannel)
	protected.PATCH("/notify/channels/:id", notify.UpdateChannel)
	protected.DELETE("/notify/channels/:id", notify.DeleteChannel)
	protected.POST("/notify/channels/:id/test", notify.TestChannel)

	protected.GET("/notify/recipients", notify.ListRecipients)
	protected.POST("/notify/recipients", notify.CreateRecipient)
	protected.PATCH("/notify/recipients/:id", notify.UpdateRecipient)
	protected.DELETE("/notify/recipients/:id", notify.DeleteRecipient)

	protected.GET("/notify/rules", notify.ListRules)
	protected.POST("/notify/rules", notify.CreateRule)
	protected.PATCH("/notify/rules/:id", notify.UpdateRule)
	protected.DELETE("/notify/rules/:id", notify.DeleteRule)
	protected.POST("/notify/rules/:id/test", notify.TestRule)

	protected.GET("/notify/events", notify.ListEvents)
	protected.DELETE("/notify/events", notify.ClearEvents)
}

package health

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// AppMetrics answers "is this backend itself healthy" — request volume, error rate, latency and
// how many FortiGate sessions are pooled — as opposed to Live/Ready above, which answer only
// up/down. Unlike those two this is NOT a probe an orchestrator calls every few seconds, so it may
// say more and does not need to stay cheap: it is a page a person opens, the same way they would
// open a dashboard, which is also why it is admin-gated rather than public like Live/Ready.
//
// requireAdmin is a small local check rather than a shared middleware, matching every other
// admin-only endpoint in this codebase (controller/changerequest, controller/drift, …) — see
// controller/user/authz.go's doc comment for why that convention exists.
func requireAdmin(c *gin.Context) bool {
	if c.GetString("user_role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

// AppMetrics serves the counters services.RecordRequest has kept since this process started.
func AppMetrics(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	c.JSON(http.StatusOK, services.AppMetricsSnapshot())
}

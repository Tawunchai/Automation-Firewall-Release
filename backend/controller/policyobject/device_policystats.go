package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Policy Hit-Count & Rule Lifecycle — the device-proxy side.
//
// Read-only: CMDB GET for the policy table plus two monitor GETs for the counters and the device
// clock. Nothing here writes to the firewall, so the route is safe for any authenticated user; the
// "remove" advice it returns is a recommendation the Firewall Policy page renders as a badge, not
// an action.

// maxStaleDays bounds the threshold a caller may ask for. Ten years is well past any audit window
// and stops a nonsense value from silently classifying every rule as active.
const maxStaleDays = 3650

// GET /policy/device/:deviceId/policy-stats[?stale_days=90]
func DeviceGetPolicyUsage(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	staleDays := 0 // 0 = let the service apply its default
	if raw := strings.TrimSpace(c.Query("stale_days")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxStaleDays {
			c.JSON(http.StatusBadRequest, gin.H{"error": "stale_days must be a number between 1 and 3650"})
			return
		}
		staleDays = n
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	report, err := fc.GetPolicyUsage(staleDays)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, report)
}

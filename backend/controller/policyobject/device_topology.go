package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// GET /policy/device/:deviceId/topology-live
//
// The fast half of Network ▸ Topology — link state and measured per-interface throughput, plus
// IPsec tunnel health, meant to be polled every few seconds to animate a diagram the slow CMDB
// reads already drew. See services.GetTopologyLive for why this stays a separate, cheap call
// rather than re-reading the whole config on a timer.
//
// Open to any signed-in user who can see the device — same as every other read in this proxy; it
// carries no more than the live dashboard and SD-WAN pages already expose.
func DeviceGetTopologyLive(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, fc.GetTopologyLive())
}

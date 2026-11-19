package policyobject

import (
	"net/http"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// "What uses this object?" — one read-only endpoint behind every Used-by panel and every delete
// confirmation in Policy & Objects.
//
// Open to any signed-in user who can see the device, like the rest of the reads in this package:
// it answers a question about configuration, it writes nothing, and a user who can already list
// the policy table can work the same answer out by hand. The engine and its honesty rules are in
// services/fortigate_usage.go.

// GET /policy/device/:deviceId/usage/:kind/:name
func DeviceObjectUsage(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	kind := c.Param("kind")
	if !services.IsUsageKind(kind) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown object kind " + kind})
		return
	}
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "object name is required"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	rep, err := fc.FindUsage(kind, name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rep)
}

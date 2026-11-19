package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// The device's virtual domains.
//
// Read-only, and open to any signed-in user who can see the device: it is the list of tenants that
// exist, and every other read on this device is already scoped by the ?vdom= this feeds.
//
// There is no CREATE. Making a VDOM changes the unit's whole configuration model — on FortiOS it
// restarts services and moves every existing object into the management domain — and it is not a
// thing to offer from a web console beside an Addresses page. The console reads the split somebody
// else made and works within it.
//
// GET /policy/device/:deviceId/vdoms
func DeviceListVDOMs(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	vdoms, err := fc.GetVDOMs()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, vdoms)
}

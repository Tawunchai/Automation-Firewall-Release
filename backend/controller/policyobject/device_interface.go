package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Network > Interfaces is READ-ONLY by design: the page shows what the firewall has, and
// interfaces are changed on the device itself. Only the list endpoint lives here.
//
// The create/update/delete handlers, their ~200-line form-payload mapper (interfaceInput,
// intfInputToWrite, normaliseMode) and the /interface-options datasource endpoint were removed
// with the editor UI they existed to serve — nothing called them, and a write path to a device's
// interfaces is not something to leave standing unused.

// GET /policy/device/:deviceId/system-interfaces — full interface list for the
// Network > Interfaces page (grouped by type in the GUI).
func DeviceListSystemInterfaces(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	ifaces, err := fc.GetSystemInterfaces()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ifaces)
}

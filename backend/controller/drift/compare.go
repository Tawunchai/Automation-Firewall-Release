package drift

import (
	"errors"
	"net/http"
	"network_automation/services/drift"
	"strconv"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/services"
)

// GET /drift/compare?device_a=1&device_b=2
//
// "Are these two firewalls consistent?" — reads each device's LATEST BACKUP and diffs them object
// by object, reusing the same comparator same-device drift uses (drift.CompareDevices). Read
// access only, like the rest of this package's GETs: the caller must be able to see BOTH devices,
// checked individually because the two ids rarely share one device-group grant.
func Compare(c *gin.Context) {
	aID, aErr := strconv.ParseUint(c.Query("device_a"), 10, 64)
	bID, bErr := strconv.ParseUint(c.Query("device_b"), 10, 64)
	if aErr != nil || bErr != nil || aID == 0 || bID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_a and device_b are required"})
		return
	}

	uid, _ := c.Get("user_id")
	admin := isAdmin(c)
	db := config.DB()

	// 404 rather than 403 — see networkdevice.GetByID's note: which firewalls exist is not
	// something an unauthorised caller should be able to probe for.
	if !services.UserCanAccessDevice(db, services.UserIDOf(uid), admin, uint(aID)) ||
		!services.UserCanAccessDevice(db, services.UserIDOf(uid), admin, uint(bID)) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	result, err := drift.CompareDevices(db, uint(aID), uint(bID))
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, drift.ErrNoBackupYet):
			status = http.StatusConflict
		case errors.Is(err, drift.ErrDeviceNotFound):
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

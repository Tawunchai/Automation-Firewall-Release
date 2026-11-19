package policyobject

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/services"
)

// Fleet Apply — "push this address/group/pool to all these branches", with a preview of which
// devices already have an object by that name before anything is sent. See services/fleetapply.go
// for which five resource types qualify and why, and for how a push actually reaches the device
// (a replay through this app's own router, not a direct device call — same validation, same ledger
// row, same per-device access check a single click through the normal page would get).
//
// Both endpoints loop over device_ids rather than taking one :deviceId, which is the one thing that
// makes them different from the ~137 routes elsewhere in this package: each device gets its OWN
// access check, OWN credential and OWN result, via resolveDeviceInfoByID and buildClientOrErr — the
// explicit-id siblings of getDeviceInfo and buildClient, so a login failure on one device in the
// batch becomes that device's row instead of aborting the other nine.

type fleetInput struct {
	ResourceType string         `json:"resource_type" binding:"required"`
	Name         string         `json:"name" binding:"required"`
	Body         map[string]any `json:"body" binding:"required"`
	DeviceIDs    []uint         `json:"device_ids" binding:"required"`
}

type fleetPreviewRow struct {
	DeviceID   uint            `json:"device_id"`
	DeviceName string          `json:"device_name,omitempty"`
	Exists     bool            `json:"exists"`
	Existing   json.RawMessage `json:"existing,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// mergedFleetBody folds `name` into the body before it is replayed. The create/update endpoints
// this replays into read `name` from the body itself — it is a field on addressInput, serviceInput,
// … like every other field — but Fleet Apply's own request shape carries Name separately, since the
// preview step uses it as a lookup key without needing the rest of the object at all. Without this,
// a replayed create is missing the one field every one of the five types requires.
func mergedFleetBody(name string, body map[string]any) map[string]any {
	out := make(map[string]any, len(body)+1)
	for k, v := range body {
		out[k] = v
	}
	out["name"] = name
	return out
}

func bindFleetInput(c *gin.Context) (fleetInput, string, string, bool) {
	var in fleetInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return in, "", "", false
	}
	routeSegment, cmdbPath, ok := services.FleetSpec(in.ResourceType)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this resource type cannot be pushed to several devices at once"})
		return in, "", "", false
	}
	if len(in.DeviceIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pick at least one device"})
		return in, "", "", false
	}
	return in, routeSegment, cmdbPath, true
}

// POST /fleet/preview
func FleetPreview(c *gin.Context) {
	in, _, cmdbPath, ok := bindFleetInput(c)
	if !ok {
		return
	}

	uidVal, _ := c.Get("user_id")
	uid := services.UserIDOf(uidVal)
	role := c.GetString("user_role")
	db := config.DB()

	out := make([]fleetPreviewRow, 0, len(in.DeviceIDs))
	for _, id := range in.DeviceIDs {
		row := fleetPreviewRow{DeviceID: id}

		di, err := resolveDeviceInfoByID(db, uid, role, id, false) // a preview only reads
		if err != nil {
			row.Error = err.Error()
			out = append(out, row)
			continue
		}
		row.DeviceName = di.Device.Name

		fc, err := buildClientOrErr(c, di)
		if err != nil {
			row.Error = "could not reach this device: " + err.Error()
			out = append(out, row)
			continue
		}

		existing, _ := fc.SnapshotCMDBObject(cmdbPath, in.Name)
		row.Exists = existing != nil
		row.Existing = existing
		out = append(out, row)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type fleetApplyInput struct {
	fleetInput
	// Overwrite replaces an object that already exists on a device. Without it, a device where the
	// name already exists is skipped rather than silently overwritten — the preview told the caller
	// it was there, and pushing to "the ones that don't have it yet" is the common case.
	Overwrite bool `json:"overwrite"`
}

type fleetApplyRow struct {
	DeviceID   uint   `json:"device_id"`
	DeviceName string `json:"device_name,omitempty"`
	// Status is one of: created, updated, skipped, failed, error.
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// POST /fleet/apply
func FleetApply(c *gin.Context) {
	var in fleetApplyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	routeSegment, cmdbPath, ok := services.FleetSpec(in.ResourceType)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this resource type cannot be pushed to several devices at once"})
		return
	}
	if len(in.DeviceIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pick at least one device"})
		return
	}

	body, err := json.Marshal(mergedFleetBody(in.Name, in.Body))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the object body is not valid JSON"})
		return
	}

	uidVal, _ := c.Get("user_id")
	uid := services.UserIDOf(uidVal)
	email := c.GetString("user_email")
	role := c.GetString("user_role")
	db := config.DB()

	// Applied one device at a time, in the order given — the same reasoning
	// services.RunChangeRequestSweep uses: several writes landing on one connection pool in an
	// order nobody chose is worse than this taking a few seconds longer.
	out := make([]fleetApplyRow, 0, len(in.DeviceIDs))
	for _, id := range in.DeviceIDs {
		row := fleetApplyRow{DeviceID: id}

		di, err := resolveDeviceInfoByID(db, uid, role, id, true) // this IS the write
		if err != nil {
			row.Status = "error"
			row.Message = err.Error()
			out = append(out, row)
			continue
		}
		row.DeviceName = di.Device.Name

		fc, err := buildClientOrErr(c, di)
		if err != nil {
			row.Status = "error"
			row.Message = "could not reach this device: " + err.Error()
			out = append(out, row)
			continue
		}

		existing, _ := fc.SnapshotCMDBObject(cmdbPath, in.Name)
		action := "created"
		var replayErr error
		var res *services.ReplayResult
		switch {
		case existing == nil:
			res, replayErr = services.ReplayDeviceRequest(
				"POST", services.FleetCreatePath(id, routeSegment), string(body),
				services.ApplyIdentity{UserID: uid, Email: email, Role: role},
			)
		case !in.Overwrite:
			row.Status = "skipped"
			row.Message = "an object with this name already exists on this device"
			out = append(out, row)
			continue
		default:
			action = "updated"
			res, replayErr = services.ReplayDeviceRequest(
				"PATCH", services.FleetUpdatePath(id, routeSegment, in.Name), string(body),
				services.ApplyIdentity{UserID: uid, Email: email, Role: role},
			)
		}

		if replayErr != nil {
			row.Status = "error"
			row.Message = replayErr.Error()
			out = append(out, row)
			continue
		}
		if res.Status < 200 || res.Status >= 300 {
			row.Status = "failed"
			row.Message = res.Body
			out = append(out, row)
			continue
		}
		row.Status = action
		out = append(out, row)
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

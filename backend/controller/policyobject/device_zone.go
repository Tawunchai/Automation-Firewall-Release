package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Network ▸ Zones — the device proxy for system/zone.
//
// Note what this does NOT do. Network ▸ Interfaces is deliberately read-only in this console
// (interfaces are changed on the device itself), and zones are the one exception: a zone is a
// grouping the operator invents, not a property of the hardware, and writing one changes no port's
// configuration. Adding a port to a zone can still break rules that name that port directly, which
// is what the usage scan in front of the form is for.

type zoneInput struct {
	Name        string   `json:"name"`
	Interfaces  []string `json:"interfaces"`
	Intrazone   string   `json:"intrazone"` // allow | deny
	Description string   `json:"description"`
}

// validateZone. The interesting rule is the empty one: FortiOS accepts a zone with no interfaces,
// and a policy that names it then matches nothing — the same silent no-op an empty address group
// produces, so it is refused for the same reason.
func validateZone(inp zoneInput) string {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return "name is required"
	}
	if len(name) > 35 {
		return "zone names are limited to 35 characters"
	}
	if inp.Intrazone != "" && inp.Intrazone != "allow" && inp.Intrazone != "deny" {
		return "intra-zone traffic must be allow or deny"
	}
	if len(inp.Interfaces) == 0 {
		return "a zone needs at least one interface — an empty zone matches nothing, so a policy " +
			"that uses it would silently pass no traffic"
	}
	seen := map[string]bool{}
	for _, i := range inp.Interfaces {
		n := strings.TrimSpace(i)
		if n == "" {
			return "an interface name is empty"
		}
		if seen[strings.ToLower(n)] {
			return "interface " + n + " is listed twice"
		}
		seen[strings.ToLower(n)] = true
	}
	return ""
}

func zoneFrom(inp zoneInput) services.FGZone {
	return services.FGZone{
		Name:        strings.TrimSpace(inp.Name),
		Interfaces:  inp.Interfaces,
		Intrazone:   inp.Intrazone,
		Description: inp.Description,
	}
}

// GET /policy/device/:deviceId/zones
func DeviceListZones(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	zones, err := fc.GetZones()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, zones)
}

// GET /policy/device/:deviceId/zones/:name
func DeviceGetZone(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	z, err := fc.GetZone(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, z)
}

// POST /policy/device/:deviceId/zones
func DeviceCreateZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp zoneInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateZone(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateZone(zoneFrom(inp)); err != nil {
		// The device's own refusal is passed through whole. It is the only thing that can say
		// WHICH interface is already in a zone or already named by a policy — see the schema note
		// in services/fortigate_zone.go.
		respondDeviceError(c, err, "zone")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "zone created on device"})
}

// PATCH /policy/device/:deviceId/zones/:name
func DeviceUpdateZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp zoneInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateZone(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateZone(c.Param("name"), zoneFrom(inp)); err != nil {
		respondDeviceError(c, err, "zone")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "zone updated on device"})
}

// DELETE /policy/device/:deviceId/zones/:name
func DeviceDeleteZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	if err := fc.DeleteZone(c.Param("name")); err != nil {
		respondDeviceError(c, err, "zone")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "zone deleted from device"})
}

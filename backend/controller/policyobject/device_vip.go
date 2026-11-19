package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// GET /policy/device/:deviceId/virtual-ips
func DeviceListVirtualIPs(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	vips, err := fc.GetVirtualIPs()
	if err != nil {
		respondDeviceError(c, err, "virtual IP")
		return
	}
	c.JSON(http.StatusOK, vips)
}

// GET /policy/device/:deviceId/virtual-ips/:name
func DeviceGetVirtualIP(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	v, err := fc.GetVirtualIP(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// POST /policy/device/:deviceId/virtual-ips
func DeviceCreateVirtualIP(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var v services.FGVirtualIP
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.ValidateVirtualIP(v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateVirtualIP(v); err != nil {
		respondDeviceError(c, err, "virtual IP")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "virtual IP created on device", "name": v.Name})
}

// PATCH /policy/device/:deviceId/virtual-ips/:name
func DeviceUpdateVirtualIP(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	var v services.FGVirtualIP
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The object being edited is the one in the URL; the payload's name may be absent.
	if strings.TrimSpace(v.Name) == "" {
		v.Name = name
	}
	if err := services.ValidateVirtualIP(v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateVirtualIP(name, v); err != nil {
		respondDeviceError(c, err, "virtual IP")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "virtual IP updated on device"})
}

// DELETE /policy/device/:deviceId/virtual-ips/:name
func DeviceDeleteVirtualIP(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteVirtualIP(c.Param("name")); err != nil {
		respondDeviceError(c, err, "virtual IP")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "virtual IP deleted from device"})
}

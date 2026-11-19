package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// routeInput is the create/update payload from the Static Routes form.
type routeInput struct {
	DstType         string `json:"dst_type"` // subnet | internet-service
	Dst             string `json:"dst"`      // CIDR or "ip mask" (subnet)
	DstAddr         string `json:"dstaddr"`  // named address / group (advanced)
	Gateway         string `json:"gateway"`
	Device          string `json:"device"` // interface name; "" for blackhole
	Blackhole       bool   `json:"blackhole"`
	InternetService *int   `json:"internet_service"`
	Distance        *int   `json:"distance"`
	Priority        *int   `json:"priority"`
	Weight          *int   `json:"weight"`
	Enabled         *bool  `json:"enabled"`
	Comment         string `json:"comment"`
}

func routeInputToWrite(inp routeInput) services.FGStaticRouteWrite {
	status := "enable"
	if inp.Enabled != nil && !*inp.Enabled {
		status = "disable"
	}
	dstType := inp.DstType
	if dstType == "" {
		dstType = "subnet"
	}
	// The "Blackhole" pseudo-interface selection arrives either as Blackhole=true or the
	// sentinel device name "blackhole".
	blackhole := inp.Blackhole || strings.EqualFold(inp.Device, "blackhole")
	device := inp.Device
	if strings.EqualFold(device, "blackhole") {
		device = ""
	}
	dst := inp.Dst
	if dst != "" {
		dst = services.CIDRToFGSubnet(dst)
	}
	return services.FGStaticRouteWrite{
		VDOM:            "root",
		DstType:         dstType,
		Dst:             dst,
		DstAddr:         inp.DstAddr,
		Gateway:         inp.Gateway,
		Device:          device,
		Blackhole:       blackhole,
		InternetService: inp.InternetService,
		Distance:        inp.Distance,
		Priority:        inp.Priority,
		Weight:          inp.Weight,
		Status:          status,
		Comment:         inp.Comment,
	}
}

// GET /policy/device/:deviceId/static-routes
func DeviceListStaticRoutes(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	routes, err := fc.GetStaticRoutes()
	if err != nil {
		respondDeviceError(c, err, "static route")
		return
	}
	c.JSON(http.StatusOK, routes)
}

// GET /policy/device/:deviceId/static-routes/:seq
func DeviceGetStaticRoute(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	r, err := fc.GetStaticRoute(seq)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// POST /policy/device/:deviceId/static-routes
func DeviceCreateStaticRoute(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp routeInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateRoute(inp); err != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": err})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	seq, err := fc.CreateStaticRoute(routeInputToWrite(inp))
	if err != nil {
		respondDeviceError(c, err, "static route")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "static route created on device", "seq_num": seq})
}

// PATCH /policy/device/:deviceId/static-routes/:seq
func DeviceUpdateStaticRoute(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}
	var inp routeInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errMsg := validateRoute(inp); errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateStaticRoute(seq, routeInputToWrite(inp)); err != nil {
		respondDeviceError(c, err, "static route")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "static route updated on device"})
}

// DELETE /policy/device/:deviceId/static-routes/:seq
func DeviceDeleteStaticRoute(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid route id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteStaticRoute(seq); err != nil {
		respondDeviceError(c, err, "static route")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "static route deleted from device"})
}

// GET /policy/device/:deviceId/internet-services — datasource for the "Internet Service"
// destination dropdown (~1600 id+name entries).
func DeviceListInternetServices(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	svcs, err := fc.GetInternetServices()
	if err != nil {
		respondDeviceError(c, err, "internet service")
		return
	}
	c.JSON(http.StatusOK, svcs)
}

// GET /policy/device/:deviceId/route-interfaces — datasource for the Static Route
// "Interface" picker. Narrower/curated set that matches the FortiGate GUI exactly
// (see services.GetRouteInterfaces), NOT the full Network > Interfaces CMDB dump.
func DeviceListRouteInterfaces(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	ifaces, err := fc.GetRouteInterfaces()
	if err != nil {
		respondDeviceError(c, err, "interface")
		return
	}
	c.JSON(http.StatusOK, ifaces)
}

// validateRoute returns a non-empty error message when the input is invalid.
func validateRoute(inp routeInput) string {
	blackhole := inp.Blackhole || strings.EqualFold(inp.Device, "blackhole")
	if inp.DstType == "internet-service" {
		if inp.InternetService == nil || *inp.InternetService <= 0 {
			return "an Internet Service must be selected"
		}
		if strings.TrimSpace(inp.Gateway) == "" {
			return "gateway address is required"
		}
		return ""
	}
	// subnet
	if strings.TrimSpace(inp.Dst) == "" && strings.TrimSpace(inp.DstAddr) == "" {
		return "destination subnet is required"
	}
	if !blackhole && strings.TrimSpace(inp.Gateway) == "" {
		return "gateway address is required"
	}
	return ""
}

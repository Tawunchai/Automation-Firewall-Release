package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Policy & Objects ▸ Traffic Shaping — the device proxy for shapers and shaping policies.
// The per-policy trap and why a shaper needs a shaping policy: services/fortigate_shaper.go.

type shaperInput struct {
	Name          string `json:"name"`
	Guaranteed    int    `json:"guaranteed_bandwidth"`
	Maximum       int    `json:"maximum_bandwidth"`
	BandwidthUnit string `json:"bandwidth_unit"`
	Priority      string `json:"priority"`
	PerPolicy     bool   `json:"per_policy"`
	DiffServ      bool   `json:"diffserv"`
	DiffServCode  string `json:"diffservcode"`
}

var shaperUnits = map[string]bool{"kbps": true, "mbps": true, "gbps": true}
var shaperPriorities = map[string]bool{"low": true, "medium": true, "high": true}

// validateShaper catches the numbers that make a shaper do nothing, or do the opposite.
func validateShaper(inp shaperInput) string {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return "name is required"
	}
	if len(name) > 35 {
		return "shaper names are limited to 35 characters"
	}
	if inp.BandwidthUnit != "" && !shaperUnits[inp.BandwidthUnit] {
		return "bandwidth unit must be kbps, mbps or gbps"
	}
	if inp.Priority != "" && !shaperPriorities[inp.Priority] {
		return "priority must be low, medium or high"
	}
	if inp.Maximum < 0 || inp.Guaranteed < 0 {
		return "bandwidth cannot be negative"
	}
	// A maximum of 0 means unlimited on FortiOS. That is legal and is usually a typo in a form
	// whose whole purpose is to impose a limit, so it is refused rather than stored as "no limit".
	if inp.Maximum == 0 {
		return "a maximum of 0 means UNLIMITED on FortiOS — set a real ceiling, or delete the " +
			"shaper if no limit is what you want"
	}
	// The guarantee is a floor and the maximum is a ceiling. A floor above the ceiling is not a
	// tight limit; it is a contradiction the device stores without comment.
	if inp.Guaranteed > inp.Maximum {
		return "the guaranteed bandwidth is higher than the maximum — the floor cannot be above " +
			"the ceiling"
	}
	if inp.DiffServ && strings.TrimSpace(inp.DiffServCode) == "" {
		return "DiffServ marking is on but no code is set"
	}
	return ""
}

func shaperFrom(inp shaperInput) services.FGTrafficShaper {
	return services.FGTrafficShaper{
		Name: strings.TrimSpace(inp.Name), Guaranteed: inp.Guaranteed, Maximum: inp.Maximum,
		BandwidthUnit: inp.BandwidthUnit, Priority: inp.Priority,
		PerPolicy: inp.PerPolicy, DiffServ: inp.DiffServ, DiffServCode: inp.DiffServCode,
	}
}

// GET /policy/device/:deviceId/traffic-shapers
func DeviceListTrafficShapers(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	shapers, err := fc.GetTrafficShapers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shapers)
}

// GET /policy/device/:deviceId/traffic-shapers/:name
func DeviceGetTrafficShaper(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	s, err := fc.GetTrafficShaper(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

// POST /policy/device/:deviceId/traffic-shapers
func DeviceCreateTrafficShaper(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp shaperInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateShaper(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateTrafficShaper(shaperFrom(inp)); err != nil {
		respondDeviceError(c, err, "traffic shaper")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "traffic shaper created on device"})
}

// PATCH /policy/device/:deviceId/traffic-shapers/:name
func DeviceUpdateTrafficShaper(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp shaperInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateShaper(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateTrafficShaper(c.Param("name"), shaperFrom(inp)); err != nil {
		respondDeviceError(c, err, "traffic shaper")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "traffic shaper updated on device"})
}

// DELETE /policy/device/:deviceId/traffic-shapers/:name
func DeviceDeleteTrafficShaper(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	if err := fc.DeleteTrafficShaper(c.Param("name")); err != nil {
		respondDeviceError(c, err, "traffic shaper")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "traffic shaper deleted from device"})
}

// ── Shaping policies ─────────────────────────────────────────────────────────

type shapingPolicyInput struct {
	Name                 string   `json:"name"`
	Status               *bool    `json:"status"`
	Comment              string   `json:"comment"`
	SrcAddr              []string `json:"srcaddr"`
	DstAddr              []string `json:"dstaddr"`
	SrcIntf              []string `json:"srcintf"`
	DstIntf              []string `json:"dstintf"`
	Service              []string `json:"service"`
	TrafficShaper        string   `json:"traffic_shaper"`
	TrafficShaperReverse string   `json:"traffic_shaper_reverse"`
	PerIPShaper          string   `json:"per_ip_shaper"`
}

func validateShapingPolicy(inp shapingPolicyInput) string {
	if strings.TrimSpace(inp.Name) == "" {
		return "name is required"
	}
	if len(inp.SrcAddr) == 0 || len(inp.DstAddr) == 0 {
		return "a shaping policy needs a source and a destination address"
	}
	if len(inp.Service) == 0 {
		return "a shaping policy needs at least one service"
	}
	// A shaping policy with no shaper matches traffic and does nothing to it — a rule that exists
	// only to be confusing. FortiOS stores it.
	if strings.TrimSpace(inp.TrafficShaper) == "" &&
		strings.TrimSpace(inp.TrafficShaperReverse) == "" &&
		strings.TrimSpace(inp.PerIPShaper) == "" {
		return "this policy would match traffic and shape none of it — set a shaper in at least " +
			"one direction"
	}
	return ""
}

func shapingPolicyFrom(inp shapingPolicyInput) services.FGShapingPolicy {
	status := true
	if inp.Status != nil {
		status = *inp.Status
	}
	return services.FGShapingPolicy{
		Name: strings.TrimSpace(inp.Name), Status: status, Comment: inp.Comment,
		SrcAddr: inp.SrcAddr, DstAddr: inp.DstAddr,
		SrcIntf: inp.SrcIntf, DstIntf: inp.DstIntf, Service: inp.Service,
		TrafficShaper: inp.TrafficShaper, TrafficShaperReverse: inp.TrafficShaperReverse,
		PerIPShaper: inp.PerIPShaper,
	}
}

// GET /policy/device/:deviceId/shaping-policies
func DeviceListShapingPolicies(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	ps, err := fc.GetShapingPolicies()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ps)
}

// POST /policy/device/:deviceId/shaping-policies
func DeviceCreateShapingPolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp shapingPolicyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateShapingPolicy(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateShapingPolicy(shapingPolicyFrom(inp)); err != nil {
		respondDeviceError(c, err, "shaping policy")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "shaping policy created on device"})
}

// PATCH /policy/device/:deviceId/shaping-policies/:id
func DeviceUpdateShapingPolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shaping policy id"})
		return
	}
	var inp shapingPolicyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateShapingPolicy(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateShapingPolicy(id, shapingPolicyFrom(inp)); err != nil {
		respondDeviceError(c, err, "shaping policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "shaping policy updated on device"})
}

// DELETE /policy/device/:deviceId/shaping-policies/:id
func DeviceDeleteShapingPolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shaping policy id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.DeleteShapingPolicy(id); err != nil {
		respondDeviceError(c, err, "shaping policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "shaping policy deleted from device"})
}

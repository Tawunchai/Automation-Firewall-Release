package policyobject

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Policy & Objects ▸ Firewall Policies — the rules themselves.
//
// What used to be this whole layer in one file. Addresses, services and the form metadata are in
// device_address.go, device_service.go and device_meta.go; what is left here is the policy table,
// its ordering (a policy's position IS its precedence) and the enable/disable toggle.

// ── Firewall Policies ─────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/firewall-policies
func DeviceListPolicies(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	policies, err := fc.GetPolicies()
	if err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}

	// Convert to our frontend format
	type PolicyFE struct {
		PolicyID    int      `json:"id"`
		SeqNum      int      `json:"seq_num"`
		Name        string   `json:"name"`
		SrcIntf     string   `json:"src_intf"`
		DstIntf     string   `json:"dst_intf"`
		SrcIntfList []string `json:"src_intf_list"`
		DstIntfList []string `json:"dst_intf_list"`
		SrcAddrList []string `json:"src_addr_list"`
		DstAddrList []string `json:"dst_addr_list"`
		ServiceList []string `json:"service_list"`
		Schedule    string   `json:"schedule"`
		Action      string   `json:"action"`
		NAT         bool     `json:"nat"`
		LogTraffic  string   `json:"log_traffic"`
		Enabled     bool     `json:"enabled"`
		Comments    string   `json:"comments"`

		IPPool                 bool     `json:"ippool"`
		PoolNameList           []string `json:"poolname"`
		FixedPort              bool     `json:"fixedport"`
		ProtocolOptions        string   `json:"protocol_options"`
		AVProfile              string   `json:"av_profile"`
		WebFilterProfile       string   `json:"webfilter_profile"`
		DNSFilterProfile       string   `json:"dnsfilter_profile"`
		AppControl             string   `json:"app_control"`
		IPSSensor              string   `json:"ips_sensor"`
		FileFilterProfile      string   `json:"file_filter_profile"`
		SSLSSHProfile          string   `json:"ssl_ssh_profile"`
		DecryptedTrafficMirror string   `json:"decrypted_traffic_mirror"`
	}

	result := make([]PolicyFE, 0, len(policies))
	for i, p := range policies {
		srcIntfList := services.FGNamesToStrings(p.SrcIntf)
		dstIntfList := services.FGNamesToStrings(p.DstIntf)
		srcIntf := ""
		if len(srcIntfList) > 0 {
			srcIntf = srcIntfList[0]
		}
		dstIntf := ""
		if len(dstIntfList) > 0 {
			dstIntf = dstIntfList[0]
		}
		logTraffic := p.LogTraffic
		if logTraffic == "" {
			logTraffic = "disable"
		}
		result = append(result, PolicyFE{
			PolicyID:    p.PolicyID,
			SeqNum:      i + 1,
			Name:        p.Name,
			SrcIntf:     srcIntf,
			DstIntf:     dstIntf,
			SrcIntfList: srcIntfList,
			DstIntfList: dstIntfList,
			SrcAddrList: services.FGNamesToStrings(p.SrcAddr),
			DstAddrList: services.FGNamesToStrings(p.DstAddr),
			ServiceList: services.FGNamesToStrings(p.Service),
			Schedule:    p.Schedule,
			Action:      p.Action,
			NAT:         services.FGStringToBool(p.NAT),
			LogTraffic:  logTraffic,
			Enabled:     p.Status != "disable",
			Comments:    p.Comments,

			IPPool:                 services.FGStringToBool(p.IPPool),
			PoolNameList:           services.FGNamesToStrings(p.PoolName),
			FixedPort:              services.FGStringToBool(p.FixedPort),
			ProtocolOptions:        p.ProfileProtocolOptions,
			AVProfile:              p.AVProfile,
			WebFilterProfile:       p.WebFilterProfile,
			DNSFilterProfile:       p.DNSFilterProfile,
			AppControl:             p.AppList,
			IPSSensor:              p.IPSSensor,
			FileFilterProfile:      p.FileFilterProfile,
			SSLSSHProfile:          p.SSLSSHProfile,
			DecryptedTrafficMirror: p.DecryptedTrafficMirror,
		})
	}
	c.JSON(http.StatusOK, result)
}

// POST /policy/device/:deviceId/firewall-policies
func DeviceCreatePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	var inp policyInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if inp.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "policy name is required"})
		return
	}
	if inp.SrcIntf == "" || inp.DstIntf == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source and destination interfaces are required"})
		return
	}
	if len(inp.SrcAddr) == 0 || len(inp.DstAddr) == 0 || len(inp.Service) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source address, destination address, and service are required"})
		return
	}

	fgPolicy := policyInputToFGPolicy(inp)

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	created, err := fc.CreatePolicy(fgPolicy)
	if err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "policy created on device", "data": created})
}

// policyInputToFGPolicy builds a FULL policy object from a request — the shape a real create
// always wants, and the shape Impact Preview's synthetic "what if this existed" policy wants too
// (device_impact_preview.go). NOT used by the PATCH handler, which needs the opposite: only the
// fields the caller actually sent — see buildPolicyUpdateAttrs in device_policy_update.go for why a
// full-object build is exactly the bug that handler exists to avoid.
func policyInputToFGPolicy(inp policyInput) services.FGPolicy {
	srcAddr := inp.SrcAddr
	if len(srcAddr) == 0 {
		srcAddr = []string{"all"}
	}
	dstAddr := inp.DstAddr
	if len(dstAddr) == 0 {
		dstAddr = []string{"all"}
	}
	svc := inp.Service
	if len(svc) == 0 {
		svc = []string{"ALL"}
	}

	action := inp.Action
	if action == "" {
		action = "accept"
	}
	schedule := inp.Schedule
	if schedule == "" {
		schedule = "always"
	}
	logTraffic := inp.LogTraffic
	if logTraffic == "" {
		logTraffic = "disable"
	}

	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}

	fgPolicy := services.FGPolicy{
		Name:       inp.Name,
		SrcIntf:    services.NamesToFGNames(intfListOrSingle(inp.SrcIntfList, inp.SrcIntf)),
		DstIntf:    services.NamesToFGNames(intfListOrSingle(inp.DstIntfList, inp.DstIntf)),
		SrcAddr:    services.NamesToFGNames(srcAddr),
		DstAddr:    services.NamesToFGNames(dstAddr),
		Service:    services.NamesToFGNames(svc),
		Schedule:   schedule,
		Action:     action,
		NAT:        services.FGBoolToString(inp.NAT),
		LogTraffic: logTraffic,
		Status:     services.FGBoolToString(enabled),
		Comments:   inp.Comments,
	}
	applyPolicyProfiles(&fgPolicy, inp)
	return fgPolicy
}

// DeviceUpdatePolicy (PATCH .../firewall-policies/:policyId) and the attrs-building helper it uses
// live in device_policy_update.go — split out on their own because a true partial update needs the
// raw request body's key set, not just the bound struct, and that is enough extra machinery to be
// its own file rather than growing this one further.

// PATCH /policy/device/:deviceId/firewall-policies/:policyId/toggle
func DeviceTogglePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	policyID, err := strconv.Atoi(c.Param("policyId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
		return
	}
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.TogglePolicyStatus(policyID, body.Enabled); err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "policy status updated", "enabled": body.Enabled})
}

// PUT /policy/device/:deviceId/firewall-policies/:policyId/move
// body: { "position": "before"|"after", "ref_id": <policyid> }
func DeviceMovePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	policyID, err := strconv.Atoi(c.Param("policyId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
		return
	}
	var body struct {
		Position string `json:"position"`
		RefID    int    `json:"ref_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.RefID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ref_id is required"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.MovePolicy(policyID, body.Position, body.RefID); err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "policy moved"})
}

// DELETE /policy/device/:deviceId/firewall-policies/:policyId
func DeviceDeletePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	policyID, err := strconv.Atoi(c.Param("policyId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeletePolicy(policyID); err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "policy deleted from device"})
}

// intfListOrSingle prefers the multi-interface list (sent by the new full-page
// firewall-policy form) and falls back to the single legacy field.
func intfListOrSingle(list []string, single string) []string {
	if len(list) > 0 {
		return list
	}
	if single != "" {
		return []string{single}
	}
	return nil
}

// applyPolicyProfiles copies the optional NAT/security-profile fields from policyInput
// onto an FGPolicy, auto-enabling utm-status when any profile is set.
func applyPolicyProfiles(fg *services.FGPolicy, inp policyInput) {
	fg.IPPool = services.FGBoolToString(inp.IPPool)
	fg.PoolName = services.NamesToFGNames(inp.PoolName)
	fg.FixedPort = services.FGBoolToString(inp.FixedPort)
	fg.ProfileProtocolOptions = inp.ProtocolOptions

	fg.AVProfile = inp.AVProfile
	fg.WebFilterProfile = inp.WebFilterProfile
	fg.DNSFilterProfile = inp.DNSFilterProfile
	fg.AppList = inp.AppControl
	fg.IPSSensor = inp.IPSSensor
	fg.FileFilterProfile = inp.FileFilterProfile
	fg.SSLSSHProfile = inp.SSLSSHProfile
	fg.DecryptedTrafficMirror = inp.DecryptedTrafficMirror

	anyProfile := inp.AVProfile != "" || inp.WebFilterProfile != "" || inp.DNSFilterProfile != "" ||
		inp.AppControl != "" || inp.IPSSensor != "" || inp.FileFilterProfile != ""
	fg.UTMStatus = services.FGBoolToString(anyProfile)
}

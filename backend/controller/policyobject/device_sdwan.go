package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// SD-WAN — device-proxy handlers for Network ▸ SD-WAN.
//
// Zones (zone + members) and Rules (service) have full CRUD here; Performance SLAs (health-check)
// has its own file, device_sdwan_health.go.
//
// The rule validator below is longer than the others for one reason: `system/sdwan/service` accepts
// fields that do not belong to the chosen mode with a 200 and then throws them away (see
// services/fortigate_sdwan_rule.go). Catching that here means the user is told which strategy their
// setting needs, instead of watching it vanish on the next read.

// ── Zones tab ────────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/sdwan
func DeviceGetSDWAN(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	overview, err := fc.GetSDWAN()
	if err != nil {
		respondDeviceError(c, err, "SD-WAN configuration")
		return
	}
	c.JSON(http.StatusOK, overview)
}

// GET /policy/device/:deviceId/sdwan/rules — every rule plus the implicit fallback row.
func DeviceListSDWANRules(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	list, err := fc.GetSDWANRuleList()
	if err != nil {
		respondDeviceError(c, err, "SD-WAN rule")
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /policy/device/:deviceId/sdwan/rules/:id
func DeviceGetSDWANRule(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule id"})
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	rule, err := fc.GetSDWANRule(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rule)
}

// GET /policy/device/:deviceId/sdwan/performance-slas — the whole tab. The writes live in
// device_sdwan_health.go, with the device behaviours that shape them.
func DeviceListSDWANHealthChecks(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	checks, err := fc.GetSDWANHealthChecks()
	if err != nil {
		respondDeviceError(c, err, "SD-WAN performance SLA")
		return
	}
	c.JSON(http.StatusOK, checks)
}

// ── Zone writes ──────────────────────────────────────────────────────────────

type sdwanZoneInput struct {
	Name               string `json:"name"`
	ServiceSLATieBreak string `json:"service_sla_tie_break"`
}

// validTieBreaks are the option values system/sdwan/zone.service-sla-tie-break accepts
// (read from the device's own schema).
var validTieBreaks = map[string]bool{
	"cfg-order": true, "fib-best-match": true, "input-device": true,
}

func validateSDWANZone(inp sdwanZoneInput) (services.SDWANZone, error) {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return services.SDWANZone{}, errMsg("a zone name is required")
	}
	if len(name) > 35 {
		return services.SDWANZone{}, errMsg("the zone name is limited to 35 characters")
	}
	tb := strings.TrimSpace(inp.ServiceSLATieBreak)
	if tb != "" && !validTieBreaks[tb] {
		return services.SDWANZone{}, errMsg("tie-break must be cfg-order, fib-best-match, or input-device")
	}
	return services.SDWANZone{Name: name, ServiceSLATieBreak: tb}, nil
}

// POST /policy/device/:deviceId/sdwan/zones
func DeviceCreateSDWANZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp sdwanZoneInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	z, err := validateSDWANZone(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateSDWANZone(z); err != nil {
		respondDeviceError(c, err, "SD-WAN zone")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "SD-WAN zone created on device"})
}

// PUT /policy/device/:deviceId/sdwan/zones/:name
func DeviceUpdateSDWANZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp sdwanZoneInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	z, err := validateSDWANZone(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateSDWANZone(c.Param("name"), z); err != nil {
		respondDeviceError(c, err, "SD-WAN zone")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN zone updated on device"})
}

// DELETE /policy/device/:deviceId/sdwan/zones/:name
//
// A zone still holding members is refused HERE rather than left to the device, so the answer is a
// sentence instead of a CLI parser code — and so the check happens before anything is removed.
func DeviceDeleteSDWANZone(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a zone name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if overview, err := fc.GetSDWAN(); err == nil {
		for _, m := range overview.Members {
			if m.Zone == name {
				c.JSON(http.StatusConflict, gin.H{
					"error": "this zone still has interface members — remove them first",
				})
				return
			}
		}
	}

	if err := fc.DeleteSDWANZone(name); err != nil {
		respondDeviceError(c, err, "SD-WAN zone")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN zone deleted from device"})
}

// ── Member writes ────────────────────────────────────────────────────────────

type sdwanMemberInput struct {
	SeqNum      int    `json:"seq_num"`
	Interface   string `json:"interface"`
	Zone        string `json:"zone"`
	Gateway     string `json:"gateway"`
	Source      string `json:"source"`
	Cost        int    `json:"cost"`
	Weight      int    `json:"weight"`
	Priority    int    `json:"priority"`
	VolumeRatio int    `json:"volume_ratio"`
	Status      *bool  `json:"status"`
	Comment     string `json:"comment"`
}

// validateSDWANMember mirrors what the "New SD-WAN Member" dialog enforces.
//
// The ranges come from the device's schema, and checking them here is what turns "Command fail.
// Return code -3" into something a person can act on. Gateway is NOT required — the dialog offers
// 0.0.0.0 as its default and the device accepts it (verified live), because a member on a DHCP or
// PPPoE interface learns its gateway rather than being told one.
func validateSDWANMember(inp sdwanMemberInput) (services.SDWANMember, error) {
	iface := strings.TrimSpace(inp.Interface)
	if iface == "" {
		return services.SDWANMember{}, errMsg("choose an interface")
	}
	zone := strings.TrimSpace(inp.Zone)
	if zone == "" {
		return services.SDWANMember{}, errMsg("choose an SD-WAN zone")
	}
	if inp.SeqNum < 0 {
		return services.SDWANMember{}, errMsg("the sequence number cannot be negative")
	}
	if inp.Cost < 0 || inp.Cost > 65535 {
		return services.SDWANMember{}, errMsg("cost must be 0-65535")
	}
	// The device's own floor for priority is 1, not 0 — confirmed live: a member created with
	// priority 0 is refused with a raw "Return code -61". An omitted priority is treated as "use
	// the default" the same way every other field here is (Cost, Weight, Status, ...) rather than
	// rejected, since the manual "New SD-WAN Member" dialog (member-form.tsx) always sends an
	// explicit value anyway; a GENUINELY negative value still fails below. This is the field the AI
	// Assistant's SD-WAN wizard left defaulted to 0, which the device would otherwise reject with
	// that same unreadable code.
	priority := inp.Priority
	if priority == 0 {
		priority = 1
	}
	if priority < 1 || priority > 65535 {
		return services.SDWANMember{}, errMsg("priority must be 1-65535")
	}
	if inp.Weight < 0 || inp.Weight > 255 {
		return services.SDWANMember{}, errMsg("weight must be 0-255")
	}
	if inp.VolumeRatio < 0 || inp.VolumeRatio > 255 {
		return services.SDWANMember{}, errMsg("volume ratio must be 0-255")
	}
	if gw := strings.TrimSpace(inp.Gateway); gw != "" && !isIPv4Literal(gw) {
		return services.SDWANMember{}, errMsg("gateway must be an IPv4 address")
	}
	if src := strings.TrimSpace(inp.Source); src != "" && !isIPv4Literal(src) {
		return services.SDWANMember{}, errMsg("source must be an IPv4 address")
	}

	// The dialog's Status defaults to Enabled, matching the CMDB default.
	status := true
	if inp.Status != nil {
		status = *inp.Status
	}

	return services.SDWANMember{
		SeqNum: inp.SeqNum, Interface: iface, Zone: zone,
		Gateway: strings.TrimSpace(inp.Gateway), Source: strings.TrimSpace(inp.Source),
		Cost: inp.Cost, Weight: inp.Weight, Priority: priority,
		VolumeRatio: inp.VolumeRatio, Status: status,
		Comment: strings.TrimSpace(inp.Comment),
	}, nil
}

// isIPv4Literal accepts exactly four dotted decimal octets. Deliberately not net.ParseIP, which
// also accepts IPv6 — the two CMDB fields this guards are typed ipv4-address.
func isIPv4Literal(s string) bool {
	parts := strings.Split(s, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if p == "" || len(p) > 3 {
			return false
		}
		n := 0
		for _, r := range p {
			if r < '0' || r > '9' {
				return false
			}
			n = n*10 + int(r-'0')
		}
		if n > 255 {
			return false
		}
	}
	return true
}

// sdwanMemberError translates the one refusal this endpoint produces constantly into a sentence.
//
// FortiGate will not let an interface join SD-WAN while a firewall policy still names it as a
// srcintf or dstintf, and the answer it gives is «entry not found in datasource … Return code -3» —
// which reads as "there is no such interface" and sends people looking for a typo. Measured on the
// lab device: wan1, lan, dmz and port1 (all named by policies) were refused; wan2 and ha, named by
// none, were accepted. Same message for a DHCP server or an IPsec phase 1 holding the interface.
func sdwanMemberError(iface string, err error) string {
	raw := err.Error()
	// Compare the NUMBER the device sent, not a substring of the message — Contains(raw, "-3")
	// also matches -30..-39, -300..-399, and any cli_error that happens to quote an interface
	// name or port range containing "-3". services.DeviceErrorCode unwraps the typed code when
	// the error carries one, falling back to the text pattern only when it doesn't.
	if code, ok := services.DeviceErrorCode(err); ok && code == -3 {
		return "FortiGate refused to add \"" + iface + "\" to SD-WAN. An interface cannot become an " +
			"SD-WAN member while something else still holds it — most often a firewall policy naming it " +
			"as its incoming or outgoing interface, or a DHCP server on it. Repoint those at the SD-WAN " +
			"zone first, then add the member. (Device said: " + raw + ")"
	}
	return "FortiGate error: " + raw
}

// POST /policy/device/:deviceId/sdwan/members
func DeviceCreateSDWANMember(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp sdwanMemberInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := validateSDWANMember(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateSDWANMember(m); err != nil {
		// The override: sdwanMemberError writes the -3 sentence this endpoint needs — an interface
		// cannot join SD-WAN while a firewall policy or a DHCP server still holds it — which the
		// generic line cannot say. The helper still decides the HTTP status and sets fortios_code.
		respondDeviceErrorMsg(c, err, "SD-WAN member", sdwanMemberError(m.Interface, err))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "SD-WAN member created on device"})
}

// PUT /policy/device/:deviceId/sdwan/members/:seq
func DeviceUpdateSDWANMember(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil || seq <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member sequence number"})
		return
	}

	var inp sdwanMemberInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The sequence number is the mkey; the body cannot move it.
	inp.SeqNum = seq
	m, err := validateSDWANMember(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateSDWANMember(seq, m); err != nil {
		respondDeviceError(c, err, "SD-WAN member")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN member updated on device"})
}

// DELETE /policy/device/:deviceId/sdwan/members/:seq
func DeviceDeleteSDWANMember(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	seq, err := strconv.Atoi(c.Param("seq"))
	if err != nil || seq <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member sequence number"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteSDWANMember(seq); err != nil {
		respondDeviceError(c, err, "SD-WAN member")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN member deleted from device"})
}

// ── Rule writes ──────────────────────────────────────────────────────────────

type sdwanRuleSLAInput struct {
	HealthCheck string `json:"health_check"`
	ID          int    `json:"id"`
}

type sdwanRuleInput struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Status *bool  `json:"status"`

	Source     []string `json:"source"`
	UserGroups []string `json:"user_groups"`
	Users      []string `json:"users"`

	Destination          []string `json:"destination"`
	RouteTag             int      `json:"route_tag"`
	InternetService      bool     `json:"internet_service"`
	InternetServiceNames []string `json:"internet_service_names"`

	Mode                string              `json:"mode"`
	InterfacePreference []int               `json:"interface_preference"`
	ZonePreference      []string            `json:"zone_preference"`
	MeasuredSLA         []string            `json:"measured_sla"`
	RequiredSLATargets  []sdwanRuleSLAInput `json:"required_sla_targets"`
	QualityCriteria     string              `json:"quality_criteria"`
	HashMode            string              `json:"hash_mode"`
	ForwardDSCP         bool                `json:"forward_dscp"`
	ForwardDSCPTag      string              `json:"forward_dscp_tag"`
	ReverseDSCP         bool                `json:"reverse_dscp"`
	ReverseDSCPTag      string              `json:"reverse_dscp_tag"`

	Protocol  int `json:"protocol"`
	StartPort int `json:"start_port"`
	EndPort   int `json:"end_port"`
}

// The option values below all come from the device's own schema, read live.
var (
	validRuleModes = map[string]bool{
		"manual": true, "priority": true, "sla": true, "load-balance": true, "auto": true,
	}
	validQualityCriteria = map[string]bool{
		"latency": true, "jitter": true, "packet-loss": true,
		"inbandwidth": true, "outbandwidth": true, "bibandwidth": true, "custom-profile-1": true,
	}
	validHashModes = map[string]bool{
		"round-robin": true, "source-ip-based": true, "source-dest-ip-based": true,
		"inbandwidth": true, "outbandwidth": true, "bibandwidth": true,
	}
)

// modeNeedsSLATargets reports whether the chosen strategy is one of the two that select on SLA.
func modeNeedsSLATargets(mode string) bool { return mode == "sla" || mode == "load-balance" }

// validateSDWANRule enforces the Priority Rule dialog's rules, plus the per-mode ones the device
// enforces only by silently discarding what does not apply.
func validateSDWANRule(inp sdwanRuleInput) (services.SDWANRuleFull, error) {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return services.SDWANRuleFull{}, errMsg("a rule name is required")
	}
	if len(name) > 35 {
		return services.SDWANRuleFull{}, errMsg("the rule name is limited to 35 characters")
	}

	mode := strings.TrimSpace(inp.Mode)
	if mode == "" {
		mode = "manual"
	}
	if !validRuleModes[mode] {
		return services.SDWANRuleFull{}, errMsg("unknown interface selection strategy")
	}

	// An outgoing interface is the point of a rule. Without one the device has nothing to steer
	// traffic to, and the rule silently does nothing.
	if len(inp.InterfacePreference) == 0 && len(inp.ZonePreference) == 0 {
		return services.SDWANRuleFull{}, errMsg("choose at least one outgoing interface or zone")
	}

	// A destination is required, and Internet Service REPLACES the address list rather than adding
	// to it — the device stores one or the other.
	if inp.InternetService {
		if len(inp.InternetServiceNames) == 0 {
			return services.SDWANRuleFull{}, errMsg("choose at least one internet service")
		}
	} else if len(inp.Destination) == 0 {
		return services.SDWANRuleFull{}, errMsg("choose a destination address, or select an internet service")
	}

	switch mode {
	case "priority":
		if len(inp.MeasuredSLA) == 0 {
			return services.SDWANRuleFull{}, errMsg("Best quality needs a measured SLA")
		}
		if inp.QualityCriteria != "" && !validQualityCriteria[inp.QualityCriteria] {
			return services.SDWANRuleFull{}, errMsg("unknown quality criteria")
		}
	case "sla", "load-balance":
		// The device will not let the LAST SLA target be removed once a rule has one, so an empty
		// list here is a request it cannot honour. Saying so beats saving and quietly disagreeing.
		if len(inp.RequiredSLATargets) == 0 {
			return services.SDWANRuleFull{}, errMsg("this strategy needs at least one required SLA target")
		}
		for _, t := range inp.RequiredSLATargets {
			if strings.TrimSpace(t.HealthCheck) == "" {
				return services.SDWANRuleFull{}, errMsg("an SLA target needs a performance SLA")
			}
			if t.ID <= 0 {
				return services.SDWANRuleFull{}, errMsg("an SLA target needs an SLA number")
			}
		}
		if mode == "load-balance" && inp.HashMode != "" && !validHashModes[inp.HashMode] {
			return services.SDWANRuleFull{}, errMsg("unknown load-balancing hash mode")
		}
	}

	if inp.RouteTag < 0 {
		return services.SDWANRuleFull{}, errMsg("route tag cannot be negative")
	}
	if inp.Protocol < 0 || inp.Protocol > 255 {
		return services.SDWANRuleFull{}, errMsg("protocol must be 0-255")
	}
	// Ports only apply to TCP (6) and UDP (17); the device rejects a range on anything else.
	if inp.Protocol == 6 || inp.Protocol == 17 {
		if inp.StartPort < 1 || inp.StartPort > 65535 || inp.EndPort < 1 || inp.EndPort > 65535 {
			return services.SDWANRuleFull{}, errMsg("ports must be 1-65535")
		}
		if inp.StartPort > inp.EndPort {
			return services.SDWANRuleFull{}, errMsg("the start port cannot be above the end port")
		}
	}
	if inp.ForwardDSCP && strings.TrimSpace(inp.ForwardDSCPTag) == "" {
		return services.SDWANRuleFull{}, errMsg("forward DSCP is on but no tag was given")
	}
	if inp.ReverseDSCP && strings.TrimSpace(inp.ReverseDSCPTag) == "" {
		return services.SDWANRuleFull{}, errMsg("reverse DSCP is on but no tag was given")
	}

	status := true
	if inp.Status != nil {
		status = *inp.Status
	}

	targets := make([]services.SDWANRuleSLATarget, 0, len(inp.RequiredSLATargets))
	for _, t := range inp.RequiredSLATargets {
		targets = append(targets, services.SDWANRuleSLATarget{
			HealthCheck: strings.TrimSpace(t.HealthCheck), ID: t.ID,
		})
	}

	rule := services.SDWANRuleFull{
		ID: inp.ID, Name: name, Status: status, Mode: mode,
		Source: inp.Source, UserGroups: inp.UserGroups, Users: inp.Users,
		Destination: inp.Destination, RouteTag: inp.RouteTag,
		InternetService: inp.InternetService, InternetServiceNames: inp.InternetServiceNames,
		InterfacePreference: inp.InterfacePreference, ZonePreference: inp.ZonePreference,
		MeasuredSLA: inp.MeasuredSLA, RequiredSLATargets: targets,
		QualityCriteria: inp.QualityCriteria, HashMode: inp.HashMode,
		ForwardDSCP: inp.ForwardDSCP, ForwardDSCPTag: strings.TrimSpace(inp.ForwardDSCPTag),
		ReverseDSCP: inp.ReverseDSCP, ReverseDSCPTag: strings.TrimSpace(inp.ReverseDSCPTag),
		Protocol: inp.Protocol, StartPort: inp.StartPort, EndPort: inp.EndPort,
	}
	// Drop settings that belong to a strategy other than the chosen one, so the saved rule is
	// exactly what the form showed rather than carrying invisible leftovers.
	if mode != "priority" {
		rule.MeasuredSLA = nil
		rule.QualityCriteria = ""
	}
	if !modeNeedsSLATargets(mode) {
		rule.RequiredSLATargets = nil
	}
	if mode != "load-balance" {
		rule.HashMode = ""
	}
	return rule, nil
}

// POST /policy/device/:deviceId/sdwan/rules
func DeviceCreateSDWANRule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp sdwanRuleInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule, err := validateSDWANRule(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateSDWANRule(rule); err != nil {
		respondDeviceError(c, err, "SD-WAN rule")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "SD-WAN rule created on device"})
}

// PUT /policy/device/:deviceId/sdwan/rules/:id
func DeviceUpdateSDWANRule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule id"})
		return
	}

	var inp sdwanRuleInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inp.ID = id // the id is the mkey; the body cannot move it
	rule, err := validateSDWANRule(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateSDWANRule(id, rule); err != nil {
		respondDeviceError(c, err, "SD-WAN rule")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN rule updated on device"})
}

// DELETE /policy/device/:deviceId/sdwan/rules/:id
func DeviceDeleteSDWANRule(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule id"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteSDWANRule(id); err != nil {
		respondDeviceError(c, err, "SD-WAN rule")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SD-WAN rule deleted from device"})
}

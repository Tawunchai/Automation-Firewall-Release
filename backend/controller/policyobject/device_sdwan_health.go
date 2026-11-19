package policyobject

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Performance SLAs — device-proxy handlers for the SD-WAN tab of the same name.
//
// The validator here is doing real work rather than restating the schema. Two of the rules exist
// because the DEVICE will not tell the user what went wrong:
//
//   - `server` is mandatory on create outside passive mode, and the device's answer is
//     "Attribute 'server' MUST be set. … Return code -56" — accurate, and useless in a form.
//   - Passive mode discards the Link Status fields with a 200, so a form that offered them there
//     would report a save that never happened. The form hides them; this refuses them.
//
// The rest mirrors the ranges in the device's own schema so a typo comes back as a sentence
// instead of "Command fail. Return code -61".

// The option values below are the device's, read from its schema. The protocol list is narrower
// than the CMDB's on purpose: the FortiGate dialog offers Ping, HTTP and DNS, and offering
// tcp-echo/twamp/ftp in a form with no fields to configure them would create checks that cannot be
// edited back.
var (
	validProbeModes = map[string]bool{
		"active": true, "passive": true, "prefer-passive": true,
	}
	validProbeProtocols = map[string]bool{
		"ping": true, "http": true, "dns": true,
	}
	validLinkCostFactors = map[string]bool{
		"latency": true, "jitter": true, "packet-loss": true, "mos": true,
	}
)

// maxSLAServers is the device's own ceiling on the `server` multi-value field: a third entry is
// refused with "too many argument to set 3, 2".
const maxSLAServers = 2

// reservedSLANameChars are the characters this CMDB table refuses in an mkey. Probed one by one on
// the real device, because none of it is in the schema:
//
//	a hyphen       → "char(-) is reserved. node_check_object fail!" / -651
//	< > ' " # ( )  → "The string contains XSS vulnerability characters" / -173
//
// A hyphen is the surprise: it is the most natural separator for a name like "Voice-SLA", it is
// legal in almost every other FortiOS table, and the six checks the device ships with all use
// underscores instead. Everything else tried — _ . space + @ : / & % ; , * ? ! $ = ~ [ ] — was
// accepted.
const reservedSLANameChars = `<>'"#()`

// checkSLAName reports why the device would refuse this name, or "" when it would not.
func checkSLAName(name string) string {
	if strings.Contains(name, "-") {
		return "a performance SLA name cannot contain a hyphen — the firewall reserves it (try an underscore)"
	}
	if i := strings.IndexAny(name, reservedSLANameChars); i >= 0 {
		return "a performance SLA name cannot contain " + string(name[i])
	}
	return ""
}

type sdwanSLARowInput struct {
	ID                  int      `json:"id"`
	LinkCostFactor      []string `json:"link_cost_factor"`
	LatencyThreshold    int      `json:"latency_threshold"`
	JitterThreshold     int      `json:"jitter_threshold"`
	PacketLossThreshold int      `json:"packetloss_threshold"`
	MOSThreshold        string   `json:"mos_threshold"`
}

type sdwanHealthCheckInput struct {
	Name       string   `json:"name"`
	DetectMode string   `json:"detect_mode"`
	Protocol   string   `json:"protocol"`
	Servers    []string `json:"servers"`
	SystemDNS  bool     `json:"system_dns"`

	Members []int `json:"members"`

	SLA []sdwanSLARowInput `json:"sla"`

	Interval     int `json:"interval"`
	Failtime     int `json:"failtime"`
	Recoverytime int `json:"recoverytime"`

	// A pointer so the form's default (on, matching the CMDB default) survives a body that omits
	// it, while an explicit false still turns it off.
	UpdateStaticRoute *bool `json:"update_static_route"`
}

// validateSDWANHealthCheck turns the "New Performance SLA" dialog into a device payload.
//
// `create` matters for exactly one rule: `server` is required when the check is first written and
// may be left alone on an update, because an empty server is a no-op on this field rather than a
// clear (see services/fortigate_sdwan_health.go).
func validateSDWANHealthCheck(inp sdwanHealthCheckInput, create bool) (services.SDWANHealthCheck, error) {
	name := strings.TrimSpace(inp.Name)
	if create {
		if name == "" {
			return services.SDWANHealthCheck{}, errMsg("a performance SLA name is required")
		}
		if len(name) > 35 {
			return services.SDWANHealthCheck{}, errMsg("the name is limited to 35 characters")
		}
		if why := checkSLAName(name); why != "" {
			return services.SDWANHealthCheck{}, errMsg(why)
		}
	}

	mode := strings.TrimSpace(inp.DetectMode)
	if mode == "" {
		mode = "active"
	}
	if !validProbeModes[mode] {
		return services.SDWANHealthCheck{}, errMsg("probe mode must be Active, Passive, or Prefer Passive")
	}
	passive := mode == "passive"

	protocol := strings.TrimSpace(inp.Protocol)
	if protocol == "" {
		protocol = "ping"
	}
	if !passive && !validProbeProtocols[protocol] {
		return services.SDWANHealthCheck{}, errMsg("protocol must be Ping, HTTP, or DNS")
	}

	servers := make([]string, 0, len(inp.Servers))
	for _, s := range inp.Servers {
		if s = strings.TrimSpace(s); s != "" {
			servers = append(servers, s)
		}
	}
	if len(servers) > maxSLAServers {
		return services.SDWANHealthCheck{}, errMsg("a performance SLA accepts at most two servers")
	}
	for _, s := range servers {
		if len(s) > 79 {
			return services.SDWANHealthCheck{}, errMsg("a server address is limited to 79 characters")
		}
		if strings.ContainsAny(s, " \"") {
			// The CMDB packs the list into one quoted string, so a value carrying a space or a
			// quote would come back split or mangled.
			return services.SDWANHealthCheck{}, errMsg("a server address cannot contain spaces or quotes")
		}
	}

	// System DNS supplies the probe target, so it is the one way to have no server of your own.
	usesSystemDNS := protocol == "dns" && inp.SystemDNS
	if create && !passive && len(servers) == 0 && !usesSystemDNS {
		return services.SDWANHealthCheck{}, errMsg("enter a server to probe, or choose DNS with Same as System DNS")
	}

	for _, seq := range inp.Members {
		if seq <= 0 {
			return services.SDWANHealthCheck{}, errMsg("a participant must be a real SD-WAN member")
		}
	}

	slas := make([]services.SDWANSLARow, 0, len(inp.SLA))
	usedIDs := map[int]bool{}
	for _, s := range inp.SLA {
		if s.ID < 1 || s.ID > 32 {
			return services.SDWANHealthCheck{}, errMsg("an SLA number must be 1-32")
		}
		if usedIDs[s.ID] {
			return services.SDWANHealthCheck{}, errMsg("two SLA targets cannot share the same number")
		}
		usedIDs[s.ID] = true

		factors := make([]string, 0, len(s.LinkCostFactor))
		for _, f := range s.LinkCostFactor {
			f = strings.TrimSpace(f)
			if f == "" {
				continue
			}
			if !validLinkCostFactors[f] {
				return services.SDWANHealthCheck{}, errMsg("unknown SLA criterion: " + f)
			}
			factors = append(factors, f)
		}
		// An SLA target with no criterion is a target that measures nothing. The device would
		// store it happily and every member would pass it, which is worse than saying so.
		if len(factors) == 0 {
			return services.SDWANHealthCheck{}, errMsg("an SLA target needs at least one threshold turned on")
		}
		if s.LatencyThreshold < 0 || s.LatencyThreshold > 10000000 {
			return services.SDWANHealthCheck{}, errMsg("the latency threshold must be 0-10000000 ms")
		}
		if s.JitterThreshold < 0 || s.JitterThreshold > 10000000 {
			return services.SDWANHealthCheck{}, errMsg("the jitter threshold must be 0-10000000 ms")
		}
		if s.PacketLossThreshold < 0 || s.PacketLossThreshold > 100 {
			return services.SDWANHealthCheck{}, errMsg("the packet loss threshold must be 0-100%")
		}
		slas = append(slas, services.SDWANSLARow{
			ID:                  s.ID,
			LinkCostFactor:      factors,
			LatencyThreshold:    s.LatencyThreshold,
			JitterThreshold:     s.JitterThreshold,
			PacketLossThreshold: s.PacketLossThreshold,
			MOSThreshold:        strings.TrimSpace(s.MOSThreshold),
		})
	}

	out := services.SDWANHealthCheck{
		Name:       name,
		DetectMode: mode,
		Protocol:   protocol,
		Servers:    servers,
		SystemDNS:  usesSystemDNS,
		Members:    inp.Members,
		SLA:        slas,
	}

	if passive {
		// Nothing below applies: the device discards it and the dialog does not show it.
		return out, nil
	}

	interval, failtime, recovery := inp.Interval, inp.Failtime, inp.Recoverytime
	if interval == 0 {
		interval = 500
	}
	if failtime == 0 {
		failtime = 5
	}
	if recovery == 0 {
		recovery = 5
	}
	if interval < 20 || interval > 3600000 {
		return services.SDWANHealthCheck{}, errMsg("the check interval must be 20-3600000 ms")
	}
	if failtime < 1 || failtime > 3600 {
		return services.SDWANHealthCheck{}, errMsg("failures before inactive must be 1-3600")
	}
	if recovery < 1 || recovery > 3600 {
		return services.SDWANHealthCheck{}, errMsg("restore link after must be 1-3600 checks")
	}

	updateRoute := true
	if inp.UpdateStaticRoute != nil {
		updateRoute = *inp.UpdateStaticRoute
	}

	out.Interval = interval
	out.Failtime = failtime
	out.Recoverytime = recovery
	out.UpdateStaticRoute = updateRoute
	return out, nil
}

// serverAlreadyProbed reports the check that is already probing one of `servers`, if any.
//
// The device enforces this and nothing documents it: two health checks may not name the same
// server. The second one is refused with
//
//	Server 1.1.1.1 is duplicated in the New_SLA and Existing_SLA
//	object set operator error, -7 discard the setting
//
// which is a good message wrapped in three layers of transport. Asking first turns it into a
// sentence, and — because a -7 abandons the whole write — means the user is told before they lose
// the rest of the form.
//
// Best-effort: if the list cannot be read, the write still goes ahead and the device decides. A
// pre-flight check that cannot run is not a reason to refuse a legitimate change.
func serverAlreadyProbed(fc deviceClient, self string, servers []string) (server, owner string) {
	if len(servers) == 0 {
		return "", ""
	}
	existing, err := fc.SDWANHealthCheckServers()
	if err != nil {
		return "", ""
	}
	for name, theirs := range existing {
		if name == self {
			continue // the check being edited may of course keep its own server
		}
		for _, mine := range servers {
			for _, t := range theirs {
				if strings.EqualFold(mine, t) {
					return mine, name
				}
			}
		}
	}
	return "", ""
}

// GET /policy/device/:deviceId/sdwan/performance-slas/:name
func DeviceGetSDWANHealthCheck(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a performance SLA name is required"})
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	check, err := fc.GetSDWANHealthCheck(name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, check)
}

// POST /policy/device/:deviceId/sdwan/performance-slas
func DeviceCreateSDWANHealthCheck(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp sdwanHealthCheckInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if server, owner := serverAlreadyProbed(fc, "", h.Servers); server != "" {
		c.JSON(http.StatusConflict, gin.H{
			"error": "\"" + owner + "\" already probes " + server +
				" — the firewall allows one performance SLA per server",
		})
		return
	}

	if err := fc.CreateSDWANHealthCheck(h); err != nil {
		respondDeviceError(c, err, "SD-WAN performance SLA")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "performance SLA created on device"})
}

// PUT /policy/device/:deviceId/sdwan/performance-slas/:name
func DeviceUpdateSDWANHealthCheck(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a performance SLA name is required"})
		return
	}

	var inp sdwanHealthCheckInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The name is the mkey and travels in the URL; the body cannot move it.
	inp.Name = name
	h, err := validateSDWANHealthCheck(inp, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if server, owner := serverAlreadyProbed(fc, name, h.Servers); server != "" {
		c.JSON(http.StatusConflict, gin.H{
			"error": "\"" + owner + "\" already probes " + server +
				" — the firewall allows one performance SLA per server",
		})
		return
	}

	if err := fc.UpdateSDWANHealthCheck(name, h); err != nil {
		respondDeviceError(c, err, "SD-WAN performance SLA")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "performance SLA updated on device"})
}

// DELETE /policy/device/:deviceId/sdwan/performance-slas/:name
//
// A check an SD-WAN rule still selects on is refused HERE. The device's own answer to that is a
// CLI return code, and by the time it arrives the user has no idea which rule objected.
func DeviceDeleteSDWANHealthCheck(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a performance SLA name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if list, err := fc.GetSDWANRuleList(); err == nil {
		for _, r := range list.Rules {
			if sdwanRuleUsesHealthCheck(r, name) {
				c.JSON(http.StatusConflict, gin.H{
					"error": "SD-WAN rule \"" + r.Name + "\" still selects on this performance SLA — change that rule first",
				})
				return
			}
		}
	}

	if err := fc.DeleteSDWANHealthCheck(name); err != nil {
		respondDeviceError(c, err, "SD-WAN performance SLA")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "performance SLA deleted from device"})
}

// sdwanRuleUsesHealthCheck reports whether a rule references the named check, either way a rule
// can: as a Measured SLA (mode=priority) or as a Required SLA target (mode=sla|load-balance).
func sdwanRuleUsesHealthCheck(r services.SDWANRuleFull, name string) bool {
	for _, m := range r.MeasuredSLA {
		if m == name {
			return true
		}
	}
	for _, t := range r.RequiredSLATargets {
		if t.HealthCheck == name {
			return true
		}
	}
	return false
}

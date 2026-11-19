package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Policy & Objects ▸ Services — the protocol/port definitions a policy matches on.
//
// Split out of device_proxy.go. The one thing worth knowing before editing it: FortiOS spells this
// table two different ways across firmware versions, which services/fortigate_object.go handles by
// trying both — see servicePrimaryTable / serviceFallbackTable.

// ── Services ──────────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/services
func DeviceListServices(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	svcs, err := fc.GetServices()
	if err != nil {
		respondDeviceError(c, err, "service")
		return
	}

	// Count how many firewall policies reference each service (accurate ref count).
	// q_ref from the CMDB response is unreliable across FortiOS versions.
	svcRefCount := make(map[string]int)
	if policies, pErr := fc.GetPolicies(); pErr == nil {
		for _, p := range policies {
			for _, svcName := range services.FGNamesToStrings(p.Service) {
				svcRefCount[svcName]++
			}
		}
	}

	type SvcFE struct {
		Name      string `json:"name"`
		Protocol  string `json:"protocol"`
		TCPPorts  string `json:"tcp_ports"`
		UDPPorts  string `json:"udp_ports"`
		SCTPPorts string `json:"sctp_ports"`
		IPProto   int    `json:"ip_proto"`
		ICMPType  int    `json:"icmp_type"`
		ICMPCode  int    `json:"icmp_code"`
		Category  string `json:"category"`
		Comment   string `json:"comment"`
		Color     int    `json:"color"`
		IPFQDN    string `json:"ip_fqdn"`
		Builtin   bool   `json:"builtin"`
		Details   string `json:"details"`
		RefCount  int    `json:"ref_count"`
	}

	result := make([]SvcFE, 0, len(svcs))
	for _, s := range svcs {
		proto := s.Protocol
		if proto == "ICMP6" {
			proto = "ICMPv6"
		}
		cat := ""
		if len(s.Category) > 0 {
			cat = s.Category[0].Name
		}
		if cat == "" {
			cat = "Uncategorized"
		}
		icmpType := -1
		if s.ICMPType != nil {
			icmpType = *s.ICMPType
		}
		icmpCode := -1
		if s.ICMPCode != nil {
			icmpCode = *s.ICMPCode
		}
		// IP/FQDN: prefer explicit fqdn, fall back to iprange
		ipFQDN := s.FQDN
		if ipFQDN == "" {
			ipFQDN = s.IPRange
		}

		result = append(result, SvcFE{
			Name:      s.Name,
			Protocol:  proto,
			TCPPorts:  s.TCPPortRange,
			UDPPorts:  s.UDPPortRange,
			SCTPPorts: s.SCTPPortRange,
			IPProto:   s.ProtocolNum,
			ICMPType:  icmpType,
			ICMPCode:  icmpCode,
			Category:  cat,
			Comment:   s.Comment,
			Color:     s.Color,
			IPFQDN:    ipFQDN,
			Builtin:   false,
			Details:   services.ServiceDetailsFromFG(s),
			RefCount:  svcRefCount[s.Name],
		})
	}
	c.JSON(http.StatusOK, result)
}

// POST /policy/device/:deviceId/services
func DeviceCreateService(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp serviceInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateServiceInput(inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fgSvc := svcInputToFG(inp)

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateService(fgSvc); err != nil {
		respondDeviceError(c, err, "service")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "service created on device"})
}

// PATCH /policy/device/:deviceId/services/:name
func DeviceUpdateService(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	var inp serviceInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fgSvc := svcInputToFG(inp)

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateService(name, fgSvc); err != nil {
		respondDeviceError(c, err, "service")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "service updated on device"})
}

// DELETE /policy/device/:deviceId/services/:name
func DeviceDeleteService(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteService(name); err != nil {
		respondDeviceError(c, err, "service")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "service deleted from device"})
}

func svcInputToFG(inp serviceInput) services.FGService {
	// Normalize protocol: ICMPv6 → ICMP6 (FortiOS internal name)
	proto := inp.Protocol
	if proto == "ICMPv6" {
		proto = "ICMP6"
	}
	s := services.FGService{
		Name:          inp.Name,
		Protocol:      proto,
		TCPPortRange:  inp.TCPPorts,
		UDPPortRange:  inp.UDPPorts,
		SCTPPortRange: inp.SCTPPorts,
		Comment:       inp.Comment,
		Color:         inp.Color,
		FQDN:          inp.FQDN,
		IPRange:       inp.IPRange,
	}
	if inp.IPProto != nil {
		s.ProtocolNum = *inp.IPProto
	}
	if inp.ICMPType != nil {
		s.ICMPType = inp.ICMPType
	}
	if inp.ICMPCode != nil {
		s.ICMPCode = inp.ICMPCode
	}
	// Category is passed as a plain string via Category field of FGService
	// — the toServiceWrite() conversion will extract it correctly for write operations.
	if inp.Category != "" && inp.Category != "Uncategorized" {
		s.Category = []services.FGName{{Name: inp.Category}}
	}
	return s
}

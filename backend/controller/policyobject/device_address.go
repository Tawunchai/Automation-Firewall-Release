package policyobject

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Policy & Objects ▸ Addresses — the named subnets, ranges, FQDNs and the rest that a policy
// matches on.
//
// Split out of device_proxy.go, which held the policy, address and service handlers together and
// had grown past the size this repo tracks in backend/test/layout-budget.json. The mapping traps
// live in services/fortigate_object.go and in addrInputToFG below; the session, the access check
// and the error contract are all in device_session.go, as they are for every handler here.

// ── Addresses ─────────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/addresses
func DeviceListAddresses(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	addrs, err := fc.GetAddresses()
	if err != nil {
		respondDeviceError(c, err, "address")
		return
	}

	// Count address references from firewall policies (src + dst)
	addrRefCount := make(map[string]int)
	if policies, pErr := fc.GetPolicies(); pErr == nil {
		for _, p := range policies {
			for _, n := range services.FGNamesToStrings(p.SrcAddr) {
				addrRefCount[n]++
			}
			for _, n := range services.FGNamesToStrings(p.DstAddr) {
				addrRefCount[n]++
			}
		}
	}

	type AddrFE struct {
		Name         string   `json:"name"`
		Type         string   `json:"type"`
		Subnet       string   `json:"subnet"`
		StartIP      string   `json:"start_ip"`
		EndIP        string   `json:"end_ip"`
		Interface    string   `json:"interface"`
		Comment      string   `json:"comment"`
		Color        int      `json:"color"`
		Country      string   `json:"country"`
		MacAddrs     []string `json:"mac_addrs"`
		AllowRouting bool     `json:"allow_routing"`
		SubType      string   `json:"sub_type"`
		SDN          string   `json:"sdn"`
		SDNAddrType  string   `json:"sdn_addr_type"`
		Builtin      bool     `json:"builtin"`
		RefCount     int      `json:"ref_count"`
	}

	builtins := map[string]bool{"all": true, "none": true, "FABRIC_DEVICE": true, "FIREWALL_AUTH_PORTAL_ADDRESS": true}

	result := make([]AddrFE, 0, len(addrs))
	for _, a := range addrs {
		// A wildcard FQDN ("*.example.com") is stored on the device as a plain
		// type "fqdn" object — the frontend renders both under the "FQDN" type.
		subnet := ""
		switch a.Type {
		case "ipmask", "interface-subnet":
			subnet = services.FGSubnetToCIDR(a.Subnet)
		case "fqdn":
			subnet = a.FQDN
		}
		// Build MAC address string list
		macAddrs := make([]string, 0, len(a.MACAddrs))
		for _, m := range a.MACAddrs {
			if m.MAC != "" {
				macAddrs = append(macAddrs, m.MAC)
			}
		}

		result = append(result, AddrFE{
			Name:         a.Name,
			Type:         a.Type,
			Subnet:       subnet,
			StartIP:      a.StartIP,
			EndIP:        a.EndIP,
			Interface:    a.Interface,
			Comment:      a.Comment,
			Color:        a.Color,
			Country:      a.Country,
			MacAddrs:     macAddrs,
			AllowRouting: services.FGStringToBool(a.AllowRouting),
			SubType:      a.SubType,
			SDN:          a.SDN,
			SDNAddrType:  a.SDNAddrType,
			Builtin:      builtins[a.Name],
			RefCount:     addrRefCount[a.Name],
		})
	}
	c.JSON(http.StatusOK, result)
}

// POST /policy/device/:deviceId/addresses
func DeviceCreateAddress(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp addressInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateAddressInput(inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fgAddr, err := addrInputToFG(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateAddress(fgAddr); err != nil {
		respondDeviceError(c, err, "address")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "address created on device"})
}

// PATCH /policy/device/:deviceId/addresses/:name
func DeviceUpdateAddress(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")

	var inp addressInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fgAddr, err := addrInputToFG(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateAddress(name, fgAddr); err != nil {
		respondDeviceError(c, err, "address")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "address updated on device"})
}

// DELETE /policy/device/:deviceId/addresses/:name
func DeviceDeleteAddress(c *gin.Context) {
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

	if err := fc.DeleteAddress(name); err != nil {
		respondDeviceError(c, err, "address")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "address deleted from device"})
}

func addrInputToFG(inp addressInput) (services.FGAddress, error) {
	a := services.FGAddress{
		Name:      inp.Name,
		Type:      inp.Type,
		Interface: inp.Interface,
		Comment:   inp.Comment,
		Color:     inp.Color,
	}
	switch inp.Type {
	case "ipmask":
		a.Subnet = services.CIDRToFGSubnet(inp.Subnet)
		a.AllowRouting = services.FGBoolToString(inp.AllowRouting)
	case "iprange":
		a.StartIP = inp.StartIP
		a.EndIP = inp.EndIP
	case "fqdn", "wildcard-fqdn":
		// FortiOS stores a wildcard FQDN ("*.example.com") as a normal type "fqdn"
		// object; the "*" simply lives inside the fqdn string. There is no separate
		// wildcard-fqdn address type on the device.
		a.Type = "fqdn"
		a.FQDN = inp.Subnet
		a.AllowRouting = services.FGBoolToString(inp.AllowRouting)
	case "interface-subnet":
		a.Subnet = services.CIDRToFGSubnet(inp.Subnet)
	case "geography":
		a.Country = inp.Country
	case "mac":
		for _, m := range inp.MacAddrs {
			if m != "" {
				a.MACAddrs = append(a.MACAddrs, services.FGMACAddr{MAC: m})
			}
		}
	case "dynamic":
		subType := inp.SubType
		if subType == "" {
			subType = "sdn" // GUI default: "Fabric Connector Address"
		}
		a.SubType = subType
		if subType == "sdn" {
			if strings.TrimSpace(inp.SDN) == "" {
				return a, fmt.Errorf("SDN connector is required for a Fabric Connector Address")
			}
			a.SDN = inp.SDN
			addrType := inp.SDNAddrType
			if addrType == "" {
				addrType = "private"
			}
			a.SDNAddrType = addrType
		}
	default:
		return a, fmt.Errorf("unsupported address type: %s", inp.Type)
	}
	return a, nil
}

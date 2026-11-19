package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Network ▸ DHCP Servers. See services/fortigate_dhcp.go for the schema and its traps.

// dhcpRangeInput is one address range from the form.
type dhcpRangeInput struct {
	ID      int    `json:"id"`
	StartIP string `json:"start_ip"`
	EndIP   string `json:"end_ip"`
}

type dhcpReservationInput struct {
	ID          int    `json:"id"`
	MAC         string `json:"mac"`
	IP          string `json:"ip"`
	Action      string `json:"action"`
	Description string `json:"description"`
}

type dhcpServerInput struct {
	Enabled        *bool                  `json:"enabled"`
	Interface      string                 `json:"interface"`
	IPRanges       []dhcpRangeInput       `json:"ip_ranges"`
	ExcludeRanges  []dhcpRangeInput       `json:"exclude_ranges"`
	Netmask        string                 `json:"netmask"`
	DefaultGateway string                 `json:"default_gateway"`
	DNSService     string                 `json:"dns_service"`
	DNSServers     []string               `json:"dns_servers"`
	NTPService     string                 `json:"ntp_service"`
	NTPServers     []string               `json:"ntp_servers"`
	LeaseTime      int                    `json:"lease_time"`
	Domain         string                 `json:"domain"`
	Reservations   []dhcpReservationInput `json:"reservations"`
}

func toServiceRanges(in []dhcpRangeInput) []services.FGDHCPRange {
	out := make([]services.FGDHCPRange, 0, len(in))
	for _, r := range in {
		out = append(out, services.FGDHCPRange{
			ID:      r.ID,
			StartIP: strings.TrimSpace(r.StartIP),
			EndIP:   strings.TrimSpace(r.EndIP),
		})
	}
	return out
}

func dhcpInputToServer(inp dhcpServerInput) services.FGDHCPServer {
	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}
	reservations := make([]services.FGDHCPReservation, 0, len(inp.Reservations))
	for _, r := range inp.Reservations {
		reservations = append(reservations, services.FGDHCPReservation{
			ID:          r.ID,
			MAC:         strings.TrimSpace(r.MAC),
			IP:          strings.TrimSpace(r.IP),
			Action:      r.Action,
			Description: r.Description,
		})
	}
	return services.FGDHCPServer{
		Status:         enabled,
		Interface:      strings.TrimSpace(inp.Interface),
		IPRanges:       toServiceRanges(inp.IPRanges),
		ExcludeRanges:  toServiceRanges(inp.ExcludeRanges),
		Netmask:        strings.TrimSpace(inp.Netmask),
		DefaultGateway: strings.TrimSpace(inp.DefaultGateway),
		DNSService:     inp.DNSService,
		DNSServers:     inp.DNSServers,
		NTPService:     inp.NTPService,
		NTPServers:     inp.NTPServers,
		LeaseTime:      inp.LeaseTime,
		Domain:         strings.TrimSpace(inp.Domain),
		Reservations:   reservations,
	}
}

// validateDHCPServer returns a non-empty message when the form cannot produce a working server.
//
// The checks that matter are the ones the device does NOT make. FortiOS accepts a DHCP server with
// no address range and with a range that runs backwards; both answer 200 and then hand out no
// leases, which looks on screen exactly like a server that is working.
func validateDHCPServer(inp dhcpServerInput) string {
	if strings.TrimSpace(inp.Interface) == "" {
		return "an interface is required"
	}
	live := 0
	for _, r := range inp.IPRanges {
		s, e := strings.TrimSpace(r.StartIP), strings.TrimSpace(r.EndIP)
		if s == "" && e == "" {
			continue
		}
		if s == "" || e == "" {
			return "an address range needs both a start and an end address"
		}
		if !ipLessOrEqual(s, e) {
			return "an address range ends before it starts: " + s + " – " + e
		}
		live++
	}
	if live == 0 {
		return "at least one address range is required"
	}
	if strings.TrimSpace(inp.Netmask) == "" {
		return "a netmask is required"
	}
	if inp.DNSService == "specify" && len(nonEmpty(inp.DNSServers)) == 0 {
		return "DNS mode Specify needs at least one DNS server"
	}
	for _, r := range inp.Reservations {
		if strings.TrimSpace(r.MAC) == "" {
			continue
		}
		if r.Action != "block" && strings.TrimSpace(r.IP) == "" {
			return "a reserved address needs an IP for MAC " + r.MAC
		}
	}
	return ""
}

func nonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

// ipLessOrEqual compares two dotted-quad addresses numerically.
//
// String comparison is what this replaces, and it is wrong in a way that looks right in testing:
// "192.168.1.9" > "192.168.1.10" as text, so the one range order an operator is most likely to
// type would be rejected.
func ipLessOrEqual(a, b string) bool {
	av, aok := ipToUint(a)
	bv, bok := ipToUint(b)
	if !aok || !bok {
		return true // not an address we can compare — let the device be the judge
	}
	return av <= bv
}

func ipToUint(s string) (uint32, bool) {
	parts := strings.Split(strings.TrimSpace(s), ".")
	if len(parts) != 4 {
		return 0, false
	}
	var v uint32
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 255 {
			return 0, false
		}
		v = v<<8 | uint32(n)
	}
	return v, true
}

// GET /policy/device/:deviceId/dhcp-servers
func DeviceListDHCPServers(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	servers, err := fc.GetDHCPServers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, servers)
}

// GET /policy/device/:deviceId/dhcp-servers/:id
func DeviceGetDHCPServer(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid DHCP server id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	s, err := fc.GetDHCPServer(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

// POST /policy/device/:deviceId/dhcp-servers
func DeviceCreateDHCPServer(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp dhcpServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateDHCPServer(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	id, err := fc.CreateDHCPServer(dhcpInputToServer(inp))
	if err != nil {
		respondDeviceError(c, err, "DHCP server")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "DHCP server created on device", "id": id})
}

// PATCH /policy/device/:deviceId/dhcp-servers/:id
func DeviceUpdateDHCPServer(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid DHCP server id"})
		return
	}
	var inp dhcpServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateDHCPServer(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// The domain cannot be CLEARED over the REST API on FortiOS 7.2.10.
	//
	// Probed against the lab FGT80E: setting and changing it works, but an empty string, a single
	// space and a JSON null are all answered 200 and then discarded — the previous domain is still
	// there on read-back. Only the CLI's `unset domain` removes it.
	//
	// So this refuses the edit instead of performing it. Writing the other fields and reporting
	// success would leave the operator believing the domain is gone from every lease the server
	// hands out, and nothing on the screen would say otherwise. Nothing is written, which is why
	// the check runs before the update rather than comparing after it.
	if strings.TrimSpace(inp.Domain) == "" {
		if cur, err := fc.GetDHCPServer(id); err == nil && strings.TrimSpace(cur.Domain) != "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "FortiOS cannot clear a DHCP domain over the API — it keeps \"" +
					cur.Domain + "\". Nothing was changed. Remove it on the device with " +
					"`config system dhcp server / edit " + strconv.Itoa(id) + " / unset domain`, " +
					"or replace it with a different domain here.",
			})
			return
		}
	}

	if err := fc.UpdateDHCPServer(id, dhcpInputToServer(inp)); err != nil {
		respondDeviceError(c, err, "DHCP server")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "DHCP server updated on device"})
}

// DELETE /policy/device/:deviceId/dhcp-servers/:id
func DeviceDeleteDHCPServer(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid DHCP server id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteDHCPServer(id); err != nil {
		respondDeviceError(c, err, "DHCP server")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "DHCP server deleted from device"})
}

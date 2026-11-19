package policyobject

import (
	"net"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Policy & Objects ▸ IP Pools — the device proxy for firewall/ippool.
// Schema and the per-type field rules live in services/fortigate_ippool.go.

type ipPoolInput struct {
	Name                string `json:"name"`
	Type                string `json:"type"`
	StartIP             string `json:"start_ip"`
	EndIP               string `json:"end_ip"`
	SourceStartIP       string `json:"source_start_ip"`
	SourceEndIP         string `json:"source_end_ip"`
	BlockSize           int    `json:"block_size"`
	NumBlocksPerUser    int    `json:"num_blocks_per_user"`
	ARPReply            *bool  `json:"arp_reply"`
	ARPInterface        string `json:"arp_interface"`
	AssociatedInterface string `json:"associated_interface"`
	PermitAnyHost       bool   `json:"permit_any_host"`
	Comments            string `json:"comments"`
}

var ipPoolTypes = map[string]bool{
	"overload": true, "one-to-one": true, "fixed-port-range": true, "port-block-allocation": true,
}

// v4 reports whether s parses as an IPv4 address. FortiOS takes IPv4 only in these fields — an
// IPv6 string is accepted by the parser and refused by the device with a code, so it is caught
// here where there is room to say why.
func v4(s string) bool {
	ip := net.ParseIP(strings.TrimSpace(s))
	return ip != nil && ip.To4() != nil
}

// rangeOrdered reports whether start <= end, comparing the two as 4-byte addresses.
func rangeOrdered(start, end string) bool {
	a := net.ParseIP(strings.TrimSpace(start)).To4()
	b := net.ParseIP(strings.TrimSpace(end)).To4()
	if a == nil || b == nil {
		return false
	}
	for i := 0; i < 4; i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return true // equal is a legitimate one-address pool
}

// rangeSize counts the addresses in an inclusive IPv4 range, capped so a /8 typo cannot produce a
// number nobody meant to compute.
func rangeSize(start, end string) int64 {
	a := net.ParseIP(strings.TrimSpace(start)).To4()
	b := net.ParseIP(strings.TrimSpace(end)).To4()
	if a == nil || b == nil {
		return 0
	}
	toN := func(ip net.IP) int64 {
		return int64(ip[0])<<24 | int64(ip[1])<<16 | int64(ip[2])<<8 | int64(ip[3])
	}
	return toN(b) - toN(a) + 1
}

// validateIPPool catches the mistakes that produce a pool the device accepts and traffic does not
// survive.
//
// The fixed-port-range check is the one worth having. That type preserves the source port, so
// every internal address needs its own external address — if the internal range is larger than
// the external one, the hosts past the end simply stop being translated. FortiOS accepts the
// mismatch without comment.
func validateIPPool(inp ipPoolInput) string {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return "name is required"
	}
	if len(name) > 79 {
		return "name is too long — FortiOS allows 79 characters"
	}
	typ := inp.Type
	if typ == "" {
		typ = "overload"
	}
	if !ipPoolTypes[typ] {
		return "unknown pool type " + typ
	}
	if !v4(inp.StartIP) || !v4(inp.EndIP) {
		return "external IP range needs two IPv4 addresses"
	}
	if !rangeOrdered(inp.StartIP, inp.EndIP) {
		return "external range ends before it starts"
	}

	switch typ {
	case "fixed-port-range":
		if !v4(inp.SourceStartIP) || !v4(inp.SourceEndIP) {
			return "fixed-port-range needs an internal IP range as well as an external one"
		}
		if !rangeOrdered(inp.SourceStartIP, inp.SourceEndIP) {
			return "internal range ends before it starts"
		}
		if rangeSize(inp.SourceStartIP, inp.SourceEndIP) > rangeSize(inp.StartIP, inp.EndIP) {
			return "fixed-port-range keeps the source port, so it needs at least as many external " +
				"addresses as internal ones — this internal range is larger, and the hosts past " +
				"the end of the external range would not be translated at all"
		}
	case "port-block-allocation":
		if inp.BlockSize <= 0 {
			return "port-block-allocation needs a block size"
		}
		if inp.NumBlocksPerUser <= 0 {
			return "port-block-allocation needs a number of blocks per user"
		}
		// 64,512 usable ports per address (1024-65535). Asking for more than that per user means
		// exactly one user fits, which is never what the operator meant to configure.
		if int64(inp.BlockSize)*int64(inp.NumBlocksPerUser) > 64512 {
			return "block size × blocks per user exceeds the 64,512 usable ports on one address"
		}
	}

	if inp.ARPInterface != "" && (inp.ARPReply == nil || !*inp.ARPReply) {
		return "an ARP interface only applies when ARP reply is on"
	}
	return ""
}

func ipPoolFrom(inp ipPoolInput) services.FGIPPool {
	// arp-reply defaults to ENABLE on the device, and a pool with it off is unreachable unless
	// something else answers ARP for the range. An absent field means "leave it on".
	arp := true
	if inp.ARPReply != nil {
		arp = *inp.ARPReply
	}
	typ := inp.Type
	if typ == "" {
		typ = "overload"
	}
	return services.FGIPPool{
		Name:                strings.TrimSpace(inp.Name),
		Type:                typ,
		StartIP:             strings.TrimSpace(inp.StartIP),
		EndIP:               strings.TrimSpace(inp.EndIP),
		SourceStartIP:       strings.TrimSpace(inp.SourceStartIP),
		SourceEndIP:         strings.TrimSpace(inp.SourceEndIP),
		BlockSize:           inp.BlockSize,
		NumBlocksPerUser:    inp.NumBlocksPerUser,
		ARPReply:            arp,
		ARPInterface:        inp.ARPInterface,
		AssociatedInterface: inp.AssociatedInterface,
		PermitAnyHost:       inp.PermitAnyHost,
		Comments:            inp.Comments,
	}
}

// GET /policy/device/:deviceId/ip-pools
func DeviceListIPPools(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	pools, err := fc.GetIPPoolsFull()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, pools)
}

// GET /policy/device/:deviceId/ip-pools/:name
func DeviceGetIPPool(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	p, err := fc.GetIPPool(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// POST /policy/device/:deviceId/ip-pools
func DeviceCreateIPPool(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp ipPoolInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateIPPool(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.CreateIPPool(ipPoolFrom(inp)); err != nil {
		respondDeviceError(c, err, "IP pool")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "IP pool created on device"})
}

// PATCH /policy/device/:deviceId/ip-pools/:name
func DeviceUpdateIPPool(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp ipPoolInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateIPPool(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	if err := fc.UpdateIPPool(c.Param("name"), ipPoolFrom(inp)); err != nil {
		respondDeviceError(c, err, "IP pool")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "IP pool updated on device"})
}

// DELETE /policy/device/:deviceId/ip-pools/:name
func DeviceDeleteIPPool(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	if err := fc.DeleteIPPool(c.Param("name")); err != nil {
		respondDeviceError(c, err, "IP pool")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "IP pool deleted from device"})
}

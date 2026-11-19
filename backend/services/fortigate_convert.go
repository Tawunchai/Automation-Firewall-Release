package services

import (
	"fmt"
	"net"
	"strings"
)

// Between FortiOS's spellings and the console's.
//
// FortiOS writes a subnet as "10.0.0.0 255.255.255.0", a boolean as "enable"/"disable", and a
// member list as a table of objects with one key. None of those is wrong — they are just not what
// a form or a JSON API wants, and every domain file would otherwise convert them its own way.
//
// Split out of fortigate.go. Every function here is pure: no client, no request, nothing to mock,
// which is why the tests for them (fortigate_convert_test.go and the domain tests) need no device.

// FGSubnetToCIDR converts "10.10.10.0 255.255.255.0" → "10.10.10.0/24".
func FGSubnetToCIDR(fgSubnet string) string {
	parts := strings.Fields(fgSubnet)
	if len(parts) != 2 {
		return fgSubnet
	}
	ip := net.ParseIP(parts[0])
	mask := net.ParseIP(parts[1])
	if ip == nil || mask == nil {
		return fgSubnet
	}
	ip4 := ip.To4()
	mask4 := mask.To4()
	if ip4 == nil || mask4 == nil {
		return fgSubnet
	}
	bits, _ := net.IPMask(mask4).Size()
	return fmt.Sprintf("%s/%d", ip4.String(), bits)
}

// CIDRToFGSubnet converts an IP/mask expression to FortiGate subnet format "ip mask".
// Handles three input forms:
//
//	"10.0.0.0/24"              → "10.0.0.0 255.255.255.0"   (CIDR)
//	"10.0.0.0 255.255.255.0"   → "10.0.0.0 255.255.255.0"   (already FG format — pass through)
//	"10.0.0.1"                 → "10.0.0.1 255.255.255.255"  (host address)
func CIDRToFGSubnet(cidr string) string {
	cidr = strings.TrimSpace(cidr)

	// Already in FortiGate format: "ip mask" (two space-separated IPv4 addresses)
	parts := strings.Fields(cidr)
	if len(parts) == 2 && net.ParseIP(parts[0]) != nil && net.ParseIP(parts[1]) != nil {
		return cidr
	}

	// Host address with no mask
	if !strings.Contains(cidr, "/") {
		if net.ParseIP(cidr) != nil {
			return cidr + " 255.255.255.255"
		}
		return cidr
	}

	// CIDR notation
	ip, ipnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return cidr
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return cidr
	}
	m := ipnet.Mask
	return fmt.Sprintf("%s %d.%d.%d.%d", ip4.String(), m[0], m[1], m[2], m[3])
}

// FGBoolToString converts FortiGate "enable"/"disable" → bool.
func FGBoolToString(b bool) string {
	if b {
		return "enable"
	}
	return "disable"
}

// FGStringToBool converts "enable" → true.
func FGStringToBool(s string) bool {
	return strings.ToLower(s) == "enable"
}

// NamesToFGNames converts []string → []FGName.
func NamesToFGNames(names []string) []FGName {
	out := make([]FGName, 0, len(names))
	for _, n := range names {
		out = append(out, FGName{Name: n})
	}
	return out
}

// FGNamesToStrings converts []FGName → []string.
func FGNamesToStrings(fgNames []FGName) []string {
	out := make([]string, 0, len(fgNames))
	for _, n := range fgNames {
		out = append(out, n.Name)
	}
	return out
}

// ServiceDetailsFromFG builds a human-readable details string from FGService.
// Matches the format shown in FortiGate GUI: "TCP/80", "UDP/53", "IP/50", "ICMP/ANY", etc.
func ServiceDetailsFromFG(s FGService) string {
	parts := []string{}

	addPorts := func(portRange, prefix string) {
		for _, p := range strings.Fields(portRange) {
			// Strip source-port suffix (e.g. "80:1024" → "80") — GUI never shows src ports
			dst := strings.SplitN(p, ":", 2)[0]
			if dst != "" {
				parts = append(parts, prefix+dst)
			}
		}
	}
	addPorts(s.TCPPortRange, "TCP/")
	addPorts(s.UDPPortRange, "UDP/")
	addPorts(s.SCTPPortRange, "SCTP/")

	switch s.Protocol {
	case "IP":
		if s.ProtocolNum == 0 {
			return "ANY" // protocol-number 0 = all protocols (e.g. "ALL" service)
		}
		return fmt.Sprintf("IP/%d", s.ProtocolNum)
	case "ICMP", "ICMP6":
		if s.ICMPType == nil {
			return "ANY" // no icmptype configured at all
		}
		if *s.ICMPType < 0 {
			return "ICMP/ANY" // icmptype = -1 means any type
		}
		if s.ICMPCode == nil || *s.ICMPCode < 0 {
			return fmt.Sprintf("ICMP/%d", *s.ICMPType)
		}
		return fmt.Sprintf("ICMP/%d/%d", *s.ICMPType, *s.ICMPCode)
	}

	if len(parts) == 0 {
		return "ANY"
	}
	return strings.Join(parts, " ")
}

package services

import "net"

// IPClass is what KIND of address a Trace Route hop is — computed locally, no third-party lookup.
// It tells the operator whether a hop is their own network (private), their ISP's shared space
// (CGNAT), or a real public address out on the internet, which is the first thing "where is this
// IP" actually means.
type IPClass struct {
	Kind  string `json:"kind"`  // public | private | cgnat | loopback | link-local | multicast | unspecified | reserved | unknown
	Label string `json:"label"` // human-readable
}

// 100.64.0.0/10 — carrier-grade NAT (RFC 6598). net.IP has no helper for it, so parse it once.
var cgnatNet = func() *net.IPNet {
	_, n, _ := net.ParseCIDR("100.64.0.0/10")
	return n
}()

// ClassifyIP sorts an address into one bucket. Order matters: the most specific special-use range
// wins, and "public" is only what is left after every private/reserved range is ruled out.
func ClassifyIP(ip net.IP) IPClass {
	switch {
	case ip == nil:
		return IPClass{"unknown", "Unknown"}
	case ip.IsUnspecified():
		return IPClass{"unspecified", "Unspecified address"}
	case ip.IsLoopback():
		return IPClass{"loopback", "Loopback"}
	case ip.IsLinkLocalUnicast(), ip.IsLinkLocalMulticast():
		return IPClass{"link-local", "Link-local"}
	case ip.IsMulticast():
		return IPClass{"multicast", "Multicast"}
	case cgnatNet.Contains(ip):
		return IPClass{"cgnat", "Carrier-grade NAT (100.64.0.0/10)"}
	case ip.IsPrivate():
		return IPClass{"private", "Private (RFC 1918)"}
	default:
		return IPClass{"public", "Public — routable on the internet"}
	}
}

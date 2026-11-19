package policyobject

import (
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"network_automation/services"
	"network_automation/services/platform"
)

// GET /policy/device/:deviceId/ip-geo?ips=a,b,c
//
// The BATCH, geo-only sibling of ip-info. Trace Route enriches every hop at once — to colour the path
// by who owns each segment (ASN/org) and to show a flag inline without the operator clicking each hop
// — and doing that through the single ip-info endpoint would repeat its two CMDB reads (interfaces +
// routes) and a 2s rDNS lookup once per hop. None of that is needed to answer "whose network is this
// hop on?": the address kind is computed locally and the ASN/geo come from the local GeoLite2 files.
//
// So this handler deliberately does NOT call buildClient — it never talks to the firewall. It still
// starts at getDeviceInfo, which is the permission chokepoint (per-user device access); the per-hop
// rDNS + internal-role detail stays on the single ip-info endpoint, fetched on demand when a hop is
// expanded. Read-only, offline, nothing about a hop leaves this box.
func DeviceLookupIPGeo(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	_ = di // permission + device existence checked; no device I/O needed for a local geo lookup.

	out := gin.H{}
	for _, s := range parseIPBatch(c.Query("ips"), maxGeoIPs) {
		ip := net.ParseIP(s) // parseIPBatch already dropped anything that will not parse
		class := services.ClassifyIP(ip)
		entry := gin.H{"ip": s, "kind": class.Kind, "kind_label": class.Label}
		// Geolocation + ASN only for public hops — a private/CGNAT/loopback hop has none, and the
		// database is only ever asked about addresses out on the internet.
		if class.Kind == "public" {
			if g := platform.LookupGeo(ip); g != nil {
				entry["geo"] = g
			}
		}
		out[s] = entry
	}

	c.JSON(http.StatusOK, gin.H{"enabled": platform.GeoIPEnabled(), "ips": out})
}

// maxGeoIPs caps the batch so a crafted query cannot ask for an unbounded list. A traceroute is at
// most 32 hops, so this is generous headroom, not a limit anyone hits in practice.
const maxGeoIPs = 64

// parseIPBatch turns the comma-separated ?ips= query into a clean, de-duplicated list of parseable
// IP strings, trimmed and capped at max. Blanks, duplicates and anything that is not an IP are
// dropped here so the handler loop can assume every entry parses.
func parseIPBatch(raw string, max int) []string {
	parts := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(parts))
	out := make([]string, 0, len(parts))
	for _, r := range parts {
		s := strings.TrimSpace(r)
		if s == "" {
			continue
		}
		if _, dup := seen[s]; dup {
			continue
		}
		if net.ParseIP(s) == nil {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
		if len(out) >= max {
			break
		}
	}
	return out
}

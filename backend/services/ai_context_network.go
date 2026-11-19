package services

import (
	"fmt"
	"strings"
)

// The two prompt sections that answer "which interface faces the Internet?".
//
// They live together because neither is complete alone: the INTERFACES list is where the model
// looks when it fills srcintf/dstintf, and the ROUTING TABLE is what actually decides which of
// those interfaces traffic leaves by. Keeping them in one file is what made it obvious that the
// answer belongs ON the interface row rather than in a second list further down the prompt.

// defaultRouteIfaces is the set of interfaces a 0.0.0.0/0 route points out of — the device's real
// way to the Internet, which is NOT reliably the one with role=wan.
//
// On the lab FGT80E the two disagree, and that disagreement is what made a correct AI answer look
// wrong: "port1" is role=lan, aliased "External", and carries the only default route, while "wan1"
// is role=wan with no route out at all. A request that says just "WAN" has two defensible answers
// there, so the model has to be told which interface actually carries traffic rather than inferring
// it from a role field somebody set years ago.
//
// A disabled or blackhole route is not a way out and never counts.
func defaultRouteIfaces(routes []FGStaticRoute) map[string]bool {
	out := map[string]bool{}
	for _, r := range routes {
		if !r.Enabled || r.Blackhole || r.DstType != "subnet" || r.Device == "" {
			continue
		}
		if dst := strings.TrimSpace(r.Dst); dst == "0.0.0.0/0" || dst == "0.0.0.0" {
			out[r.Device] = true
		}
	}
	return out
}

// interfacesContext lists the device's interfaces. NAME first — srcintf/dstintf in CLI must use
// the interface NAME, never the alias.
//
// The last column is the important one, and it is not a device field: it marks which interface holds
// the default route. That fact lived only in the STATIC ROUTES section further down the prompt, so
// choosing an egress interface meant joining two lists thousands of tokens apart — and INTERFACES is
// the block that sits BEFORE the inventory truncation, so on a busy device the routes could be the
// half that survived while the interfaces were cut, or the reverse. Putting the answer on the row
// itself removes the join.
//
// Pure (it takes the fetched lists rather than the client) so the marker is testable without a
// device, which is the only part of this file that has ever changed an answer.
func interfacesContext(ifs []FGSystemInterface, defaultOut map[string]bool) string {
	var b strings.Builder
	if len(ifs) > 0 {
		// NAME first — srcintf/dstintf in CLI must use the interface NAME, never the alias.
		b.WriteString("INTERFACES (use the NAME in srcintf/dstintf — name | alias | role | ip):\n")
		n := 0
		for _, i := range ifs {
			if i.Type == "tunnel" {
				continue
			}
			ip := i.IP
			if ip == "" {
				ip = "-"
			}
			alias := i.Alias
			if alias == "" {
				alias = "-"
			}
			mark := ""
			if defaultOut[i.Name] {
				mark = "  <- DEFAULT ROUTE (this device's way to the Internet)"
			}
			b.WriteString(fmt.Sprintf("  - %s | %s | %s | %s%s\n", i.Name, alias, i.Role, ip, mark))
			if n++; n >= 30 {
				break
			}
		}
		if len(defaultOut) == 0 {
			b.WriteString("  (no enabled default route on this device, so no interface is tagged as the way out.\n" +
				"   Do NOT infer one from the role field — say so and ask which interface faces the Internet.)\n")
		}
	}
	return b.String()
}

// staticRoutesContext lists the routing table, so the AI does not propose a route that already
// exists (FortiGate happily accepts a duplicate destination as a SECOND route — no error, but a
// pointless/ambiguous entry the user then has to hunt down).
func staticRoutesContext(routes []FGStaticRoute) string {
	if len(routes) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nSTATIC ROUTES ALREADY ON THE DEVICE (dst | gateway | interface | distance):\n")
	for _, r := range routes {
		dst := r.Dst
		if r.DstType == "internet-service" {
			dst = "internet-service:" + r.InternetServiceName
		}
		gw := r.Gateway
		if r.Blackhole {
			gw = "blackhole"
		}
		b.WriteString(fmt.Sprintf("  - %s | %s | %s | %d\n", dst, gw, r.Device, r.Distance))
	}
	b.WriteString("  (0.0.0.0/0 = the default route. If the requested destination+gateway is ALREADY here,\n" +
		"   do NOT emit it again — say it exists and return commands = [].)\n")
	return b.String()
}

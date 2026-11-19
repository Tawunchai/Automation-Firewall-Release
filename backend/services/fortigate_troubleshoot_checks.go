package services

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// Every criterion of every policy, not just the first one that failed.
//
// The walk used to stop at a policy's first mismatch and keep one sentence about it. That answers
// "why was this rule skipped" but not the two questions that come right after it:
//
//   - "which rule was CLOSEST?" — when nothing matches, the rule that fails on one criterion is
//     almost always the rule somebody meant to write, and the criterion is the fix;
//   - "which rules BELOW would also have matched?" — first match wins, so a correct rule under a
//     broader one never runs. That is the classic rule-order bug, and a walk that stops at the
//     first match cannot see it.
//
// So each policy gets a row of checks — interface, interface, address, address, service, schedule —
// each passed or failed with the values it compared. The first failed check is still the policy's
// Reason, so everything that read Reason reads the same thing it always did.

// Check fields, in the order a person checks a rule: is it on, then interfaces, addresses,
// service, schedule.
const (
	CheckStatus   = "status"
	CheckSrcIntf  = "srcintf"
	CheckDstIntf  = "dstintf"
	CheckSrcAddr  = "srcaddr"
	CheckDstAddr  = "dstaddr"
	CheckService  = "service"
	CheckSchedule = "schedule"
)

// FGTraceCheck is one criterion of one policy, against the traced packet.
type FGTraceCheck struct {
	Field string `json:"field"`
	OK    bool   `json:"ok"`
	// Want is what the policy lists for this field; Got is what the packet has. The UI builds its
	// own sentence from these, so it can be translated; Detail is the English one for the API.
	Want   []string `json:"want"`
	Got    string   `json:"got"`
	Detail string   `json:"detail"`
	// Unsure is set when the answer could not be decided from configuration alone (an FQDN
	// address, a dynamic one) — reported, never silently counted as a match or a miss.
	Unsure string `json:"unsure,omitempty"`
}

// policyChecks evaluates every criterion of p for the traced packet.
func policyChecks(
	p FGPolicy, q FGTraceQuery, srcIP, dstIP net.IP, ingress, egress string,
	am *addrMatcher, sm *svcMatcher, zones map[string][]string,
	schedules map[string]fgScheduleDetail, now time.Time,
) []FGTraceCheck {
	checks := make([]FGTraceCheck, 0, 7)

	if strings.EqualFold(p.Status, "disable") {
		checks = append(checks, FGTraceCheck{Field: CheckStatus, OK: false, Want: []string{"enable"}, Got: "disable",
			Detail: "the policy is disabled"})
	} else {
		checks = append(checks, FGTraceCheck{Field: CheckStatus, OK: true, Want: []string{"enable"}, Got: "enable",
			Detail: "the policy is enabled"})
	}

	src := fgNames(p.SrcIntf)
	switch {
	case ingress == "":
		checks = append(checks, FGTraceCheck{Field: CheckSrcIntf, OK: true, Want: src, Got: "",
			Detail: "the ingress interface is unknown, so srcintf was not checked"})
	case anyIntfMatches(p.SrcIntf, ingress, zones):
		checks = append(checks, FGTraceCheck{Field: CheckSrcIntf, OK: true, Want: src, Got: ingress,
			Detail: fmt.Sprintf("srcintf %s includes the ingress interface %q", quoteList(src), ingress)})
	default:
		checks = append(checks, FGTraceCheck{Field: CheckSrcIntf, OK: false, Want: src, Got: ingress,
			Detail: fmt.Sprintf("srcintf %s does not include the ingress interface %q", quoteList(src), ingress)})
	}

	dst := fgNames(p.DstIntf)
	if anyIntfMatches(p.DstIntf, egress, zones) {
		checks = append(checks, FGTraceCheck{Field: CheckDstIntf, OK: true, Want: dst, Got: egress,
			Detail: fmt.Sprintf("dstintf %s includes the egress interface %q", quoteList(dst), egress)})
	} else {
		checks = append(checks, FGTraceCheck{Field: CheckDstIntf, OK: false, Want: dst, Got: egress,
			Detail: fmt.Sprintf("dstintf %s does not include the egress interface %q", quoteList(dst), egress)})
	}

	checks = append(checks, addrCheck(CheckSrcAddr, am, p.SrcAddr, srcIP))
	checks = append(checks, addrCheck(CheckDstAddr, am, p.DstAddr, dstIP))

	svc := fgNames(p.Service)
	label := protoPortLabel(q.Protocol, q.DstPort)
	matched, unsure := false, ""
	for _, s := range p.Service {
		ok, u := sm.matchService(s.Name, q.Protocol, q.DstPort, 0)
		if u != "" && unsure == "" {
			unsure = u
		}
		if ok {
			matched = true
			break
		}
	}
	if matched {
		checks = append(checks, FGTraceCheck{Field: CheckService, OK: true, Want: svc, Got: label, Unsure: unsure,
			Detail: fmt.Sprintf("service %s covers %s", quoteList(svc), label)})
	} else {
		checks = append(checks, FGTraceCheck{Field: CheckService, OK: false, Want: svc, Got: label, Unsure: unsure,
			Detail: fmt.Sprintf("service %s does not cover %s", quoteList(svc), label)})
	}

	clock := now.Format("Mon 15:04")
	if active, n := scheduleActive(p.Schedule, schedules, now, 0); active {
		checks = append(checks, FGTraceCheck{Field: CheckSchedule, OK: true, Want: []string{p.Schedule}, Got: clock, Unsure: n,
			Detail: fmt.Sprintf("schedule %q is active now", p.Schedule)})
	} else {
		checks = append(checks, FGTraceCheck{Field: CheckSchedule, OK: false, Want: []string{p.Schedule}, Got: clock, Unsure: n,
			Detail: fmt.Sprintf("schedule %q is not active now (device time %s)", p.Schedule, clock)})
	}
	return checks
}

func addrCheck(field string, am *addrMatcher, entries []FGName, ip net.IP) FGTraceCheck {
	names := fgNames(entries)
	ok, unsure := anyAddrMatches(am, entries, ip)
	c := FGTraceCheck{Field: field, OK: ok, Want: names, Got: ip.String()}
	if len(unsure) > 0 {
		c.Unsure = unsure[0]
	}
	if ok {
		c.Detail = fmt.Sprintf("%s %s contains %s", field, quoteList(names), ip)
	} else {
		c.Detail = fmt.Sprintf("%s %s does not contain %s", field, quoteList(names), ip)
	}
	return c
}

// failedChecks counts the criteria a policy fails.
func failedChecks(checks []FGTraceCheck) int {
	n := 0
	for _, c := range checks {
		if !c.OK {
			n++
		}
	}
	return n
}

// firstFailure is the policy's Reason: the first failed check, in checking order.
func firstFailure(checks []FGTraceCheck) (reason string, unsure []string) {
	for _, c := range checks {
		if c.Unsure != "" {
			unsure = append(unsure, c.Unsure)
		}
		if !c.OK {
			return c.Detail, unsure
		}
	}
	return "", unsure
}

// ── NAT ──────────────────────────────────────────────────────────────────────

// FGTraceSNAT is what the source address becomes on the way out, when the matched policy NATs.
type FGTraceSNAT struct {
	// "interface" — the egress interface's own address; "pool" — one of the policy's IP pools.
	Mode  string   `json:"mode"`
	IP    string   `json:"ip,omitempty"`
	Pools []string `json:"pools,omitempty"`
}

// FGTraceDNAT is a Virtual IP that rewrites the destination, when the matched policy's dstaddr is
// one and it covers the traced address.
type FGTraceDNAT struct {
	VIP         string `json:"vip"`
	ExtIP       string `json:"ext_ip"`
	MappedIP    string `json:"mapped_ip"`
	PortForward bool   `json:"port_forward"`
	ExtPort     string `json:"ext_port,omitempty"`
	MappedPort  string `json:"mapped_port,omitempty"`
}

// traceSNAT describes the source translation of an accepting, NAT-enabled policy.
func traceSNAT(p FGPolicy, egressIP string) *FGTraceSNAT {
	if !strings.EqualFold(p.Action, "accept") || !strings.EqualFold(p.NAT, "enable") {
		return nil
	}
	if strings.EqualFold(p.IPPool, "enable") && len(p.PoolName) > 0 {
		return &FGTraceSNAT{Mode: "pool", Pools: fgNames(p.PoolName)}
	}
	return &FGTraceSNAT{Mode: "interface", IP: egressIP}
}

// interfaceAddress is the IPv4 address configured on an interface in the CMDB, or "" when it has
// none ("0.0.0.0 0.0.0.0" is how FortiOS writes "no address").
//
// It exists for the address source NAT rewrites to. That address used to come only from
// monitor/system/interface, which has no row at all for a hardware switch — the lab's `lan` — so
// every trace leaving through one reported SNAT with no address and the page had nothing honest to
// print. The CMDB has the address whatever the interface type.
func interfaceAddress(intfs []FGInterface, name string) string {
	for _, i := range intfs {
		if i.Name != name {
			continue
		}
		f := strings.Fields(i.IP)
		if len(f) == 0 || f[0] == "0.0.0.0" {
			return ""
		}
		return f[0]
	}
	return ""
}

// traceDNAT finds the VIP in the matched policy's dstaddr that the destination was addressed to.
func traceDNAT(p FGPolicy, dstIP net.IP, vips map[string]FGVirtualIP) *FGTraceDNAT {
	for _, n := range p.DstAddr {
		v, ok := vips[n.Name]
		if !ok || !ipInRangeSpec(v.ExtIP, dstIP) {
			continue
		}
		return &FGTraceDNAT{
			VIP: v.Name, ExtIP: v.ExtIP, MappedIP: v.MappedIP,
			PortForward: v.PortForward, ExtPort: v.ExtPort, MappedPort: v.MappedPort,
		}
	}
	return nil
}

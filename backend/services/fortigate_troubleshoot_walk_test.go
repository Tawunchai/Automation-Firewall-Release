package services

import (
	"strings"
	"testing"
	"time"
)

// The walk past the first match, on the lab's own policy table (labPolicies, verified live).
//
// What these pin is what the Troubleshooting page now shows beyond "which rule matched": every
// criterion of every rule, the rules below the match that would ALSO match but never run (the
// rule-order bug), and — when nothing matches — the rule that came closest.

func traceLab(t *testing.T, policies []FGPolicy, q FGTraceQuery, ingress, egress string) FGTraceResult {
	t.Helper()
	res := FGTraceResult{Query: q, Ingress: ingress, Egress: egress, Routable: true,
		EgressLink: &FGInterfaceLink{Name: egress, IP: "10.0.99.201", Link: true}}
	walkPolicyTable(&res, policies, traceInputs{
		q: q, srcIP: ip(q.SrcIP), dstIP: ip(q.DstIP),
		am: labAddrMatcher(), sm: labSvcMatcher(),
		zones: map[string][]string{}, schedules: map[string]fgScheduleDetail{},
		now:  time.Date(2026, 8, 5, 14, 30, 0, 0, time.UTC),
		vips: map[string]FGVirtualIP{"Web_Server_VIP": {Name: "Web_Server_VIP", ExtIP: "10.0.99.80", MappedIP: "192.168.1.80", PortForward: true, ExtPort: "8080", MappedPort: "80"}},
	})
	return res
}

func TestWalk_ChecksEveryCriterionNotJustTheFirst(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res := traceLab(t, labPolicies(), q, "lan", "port1")

	guest := res.Evaluated[1] // Guest-WiFi-Access: dmz → port1, srcaddr Guest-WiFi-Subnet
	if len(guest.Checks) != 7 {
		t.Fatalf("got %d checks, want all 7 criteria", len(guest.Checks))
	}
	// It fails on srcintf AND srcaddr — both must be visible, and the Reason is still the first.
	failed := map[string]bool{}
	for _, c := range guest.Checks {
		if !c.OK {
			failed[c.Field] = true
		}
	}
	if !failed[CheckSrcIntf] || !failed[CheckSrcAddr] || guest.Failed != 2 {
		t.Fatalf("failed = %v (%d), want srcintf + srcaddr", failed, guest.Failed)
	}
	if !strings.HasPrefix(guest.Reason, "srcintf") {
		t.Fatalf("reason %q should still be the first failure", guest.Reason)
	}
}

func TestWalk_ReportsTheRuleBelowThatWouldAlsoMatch(t *testing.T) {
	// From the host policy 7 is written for, 7 wins — and "default" (policy 1) below it would
	// ALSO match. That is the rule-order picture the page draws.
	q := FGTraceQuery{SrcIP: "192.168.10.100", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res := traceLab(t, labPolicies(), q, "lan", "port1")
	if res.Matched == nil || res.Matched.PolicyID != 7 {
		t.Fatalf("expected policy 7, got %+v", res.Matched)
	}
	if len(res.Shadowed) != 1 || res.Shadowed[0].PolicyID != 1 {
		t.Fatalf("shadowed = %+v, want policy 1", res.Shadowed)
	}
	if !strings.Contains(res.Shadowed[0].Reason, "never reached") {
		t.Fatalf("shadowed reason %q", res.Shadowed[0].Reason)
	}
}

func TestWalk_NamesTheClosestRuleWhenNothingMatches(t *testing.T) {
	policies := labPolicies()
	for i := range policies {
		if policies[i].PolicyID == 1 {
			policies[i].Status = "disable" // "default" would match if it were on
		}
	}
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res := traceLab(t, policies, q, "lan", "port1")
	if res.Verdict != "implicit-deny" {
		t.Fatalf("verdict %q", res.Verdict)
	}
	// Four rules each miss by one criterion. The likeliest fix leads: policy 1 is only DISABLED,
	// policy 7 misses on its srcaddr (an address object), and policy 2 on dstintf — a rule written
	// for another path, so last. Policy 5 (srcintf) falls past the cap of three.
	got := []int{}
	for _, c := range res.Closest {
		got = append(got, c.PolicyID)
	}
	if len(got) != 3 || got[0] != 1 || got[1] != 7 || got[2] != 2 {
		t.Fatalf("closest = %v, want [1 7 2]", got)
	}
	for _, c := range res.Closest {
		if c.Failed != 1 {
			t.Fatalf("policy %d failed %d, want 1", c.PolicyID, c.Failed)
		}
	}
}

func TestWalk_NoClosestWhenEveryRuleIsFarOff(t *testing.T) {
	// A packet from a network no rule is written for, on a service none carries: nothing is one or
	// two criteria away, and offering a "closest" rule would be a guess dressed as an answer.
	q := FGTraceQuery{SrcIP: "172.31.0.9", DstIP: "8.8.8.8", Protocol: 17, DstPort: 9999}
	policies := []FGPolicy{labPolicies()[1]} // Guest-WiFi-Access only
	res := traceLab(t, policies, q, "wan2", "port1")
	if len(res.Closest) != 0 {
		t.Fatalf("closest = %+v, want none", res.Closest)
	}
}

func TestWalk_DescribesSourceNATOnTheWayOut(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res := traceLab(t, labPolicies(), q, "lan", "port1")
	if res.SNAT == nil || res.SNAT.Mode != "interface" || res.SNAT.IP != "10.0.99.201" {
		t.Fatalf("snat = %+v, want the egress interface's address", res.SNAT)
	}
}

// The lab's `lan` is a hardware switch: monitor/system/interface has no row for it, so a trace
// leaving through it has no EgressLink. Policy 4 (port1 → lan, NAT on) then reported SNAT with no
// address — the page printed the interface NAME where an address belongs. The CMDB address fills it.
func TestWalk_SourceNATThroughAHardwareSwitchUsesTheConfiguredAddress(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res := FGTraceResult{Query: q, Ingress: "lan", Egress: "port1", Routable: true} // no EgressLink
	walkPolicyTable(&res, labPolicies(), traceInputs{
		q: q, srcIP: ip(q.SrcIP), dstIP: ip(q.DstIP), am: labAddrMatcher(), sm: labSvcMatcher(),
		zones: map[string][]string{}, schedules: map[string]fgScheduleDetail{},
		now:      time.Date(2026, 8, 5, 14, 30, 0, 0, time.UTC),
		egressIP: "10.0.99.201",
	})
	if res.SNAT == nil || res.SNAT.IP != "10.0.99.201" {
		t.Fatalf("snat = %+v, want the configured address when the link table has none", res.SNAT)
	}

	// And the live link still wins when it has one — it is what the interface holds right now.
	live := traceLab(t, labPolicies(), q, "lan", "port1")
	if live.SNAT == nil || live.SNAT.IP != "10.0.99.201" {
		t.Fatalf("snat = %+v, want the live link's address", live.SNAT)
	}
}

func TestInterfaceAddress_ReadsTheCMDBAddress(t *testing.T) {
	intfs := []FGInterface{
		{Name: "lan", IP: "192.168.1.99 255.255.255.0", Type: "hard-switch"},
		{Name: "wan1", IP: "0.0.0.0 0.0.0.0", Type: "physical"},
	}
	if got := interfaceAddress(intfs, "lan"); got != "192.168.1.99" {
		t.Fatalf("lan = %q, want 192.168.1.99", got)
	}
	if got := interfaceAddress(intfs, "wan1"); got != "" {
		t.Fatalf("wan1 = %q, want empty — 0.0.0.0 is FortiOS for no address", got)
	}
	if got := interfaceAddress(intfs, "dmz"); got != "" {
		t.Fatalf("dmz = %q, want empty for an interface that is not there", got)
	}
}

func TestTraceDNAT_FindsTheVIPTheDestinationWasAddressedTo(t *testing.T) {
	p := FGPolicy{Action: "accept", DstAddr: []FGName{{Name: "all"}, {Name: "Web_Server_VIP"}}}
	vips := map[string]FGVirtualIP{"Web_Server_VIP": {Name: "Web_Server_VIP", ExtIP: "10.0.99.80", MappedIP: "192.168.1.80"}}
	d := traceDNAT(p, ip("10.0.99.80"), vips)
	if d == nil || d.MappedIP != "192.168.1.80" {
		t.Fatalf("dnat = %+v", d)
	}
	if traceDNAT(p, ip("10.0.99.81"), vips) != nil {
		t.Fatal("a destination outside the VIP's external address is not DNATed")
	}
}

func TestTraceSNAT_PoolWinsOverTheInterfaceAddress(t *testing.T) {
	p := FGPolicy{Action: "accept", NAT: "enable", IPPool: "enable", PoolName: []FGName{{Name: "Pool-A"}}}
	if s := traceSNAT(p, "10.0.99.201"); s == nil || s.Mode != "pool" || s.Pools[0] != "Pool-A" {
		t.Fatalf("snat = %+v", s)
	}
	if traceSNAT(FGPolicy{Action: "deny", NAT: "enable"}, "x") != nil {
		t.Fatal("a deny rule translates nothing")
	}
}

// A VIP is translated before the route lookup, so the trace routes toward the MAPPED server.
// (Lab: Web_Server_VIP 203.150.100.10 → 192.168.1.100 on port1, used by policy 4 port1 → lan.)
func TestVIPForDestination_HonoursTheExternalInterface(t *testing.T) {
	vips := []FGVirtualIP{{Name: "Web_Server_VIP", ExtIP: "203.150.100.10", MappedIP: "192.168.1.100", Interface: "port1"}}
	if v := vipForDestination(vips, ip("203.150.100.10"), "port1"); v == nil || firstOfRange(v.MappedIP) != "192.168.1.100" {
		t.Fatalf("got %+v, want the VIP", v)
	}
	if vipForDestination(vips, ip("203.150.100.10"), "dmz") != nil {
		t.Fatal("a VIP bound to port1 does not apply to traffic arriving on dmz")
	}
	if vipForDestination(vips, ip("203.150.100.11"), "port1") != nil {
		t.Fatal("an address outside the VIP is not translated")
	}
	if firstOfRange("10.0.0.5-10.0.0.9") != "10.0.0.5" {
		t.Fatal("a mapped range routes toward its first address")
	}
}

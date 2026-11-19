package services

import (
	"strings"
	"testing"
	"time"
)

// The "fix it" planner and its simulation, on the lab's own tables.
//
// What these pin: a fix is only offered when walking the table with it applied lets the packet
// through; objects are reused only when they are EXACTLY what is needed; every plan carries its own
// create steps; the narrow fix comes first and a broad one says it is broad; and simulating never
// touches the table the verdict came from.

var labVIP = FGVirtualIP{Name: "Web_Server_VIP", ExtIP: "10.0.99.80", MappedIP: "192.168.1.80",
	PortForward: true, ExtPort: "8080", MappedPort: "80", Interface: "port1"}

// labFixEnv traces q over the given table and returns the verdict with its fixes, plus the
// environment the planner and the simulation work from. tweak may add objects or zones; it must
// keep env.addresses and the matcher in step (use addLabAddress).
func labFixEnv(t *testing.T, policies []FGPolicy, q FGTraceQuery, ingress, egress string, tweak func(*traceEnv)) (FGTraceResult, *traceEnv) {
	t.Helper()
	am, sm := labAddrMatcher(), labSvcMatcher()
	env := &traceEnv{policies: policies, vipList: []FGVirtualIP{labVIP}}
	for _, a := range am.addrs {
		env.addresses = append(env.addresses, a)
	}
	for _, s := range sm.services {
		env.services = append(env.services, s)
	}
	env.in = traceInputs{
		q: q, srcIP: ip(q.SrcIP), dstIP: ip(q.DstIP), am: am, sm: sm,
		zones: map[string][]string{}, schedules: map[string]fgScheduleDetail{},
		now:  time.Date(2026, 8, 5, 14, 30, 0, 0, time.UTC), // a Wednesday afternoon
		vips: map[string]FGVirtualIP{labVIP.Name: labVIP},
	}
	if tweak != nil {
		tweak(env)
	}
	res := FGTraceResult{Query: q, Ingress: ingress, Egress: egress, Routable: true, RouteTo: q.DstIP,
		EgressLink: &FGInterfaceLink{Name: egress, IP: "10.0.99.201", Link: true}}
	walkPolicyTable(&res, env.policies, env.in)
	res.Fixes = planFixes(res, env)
	return res, env
}

func addLabAddress(env *traceEnv, a FGAddress) {
	env.addresses = append(env.addresses, a)
	env.in.am.addrs[a.Name] = a
}

func fixByID(t *testing.T, res FGTraceResult, id string) FGFixPlan {
	t.Helper()
	for _, f := range res.Fixes {
		if f.ID == id {
			return f
		}
	}
	ids := make([]string, len(res.Fixes))
	for i, f := range res.Fixes {
		ids[i] = f.ID
	}
	t.Fatalf("no fix %q; got %v", id, ids)
	return FGFixPlan{}
}

func stepOps(p FGFixPlan) string {
	ops := make([]string, len(p.Steps))
	for i, s := range p.Steps {
		ops[i] = s.Op + ":" + s.Name
	}
	return strings.Join(ops, " ")
}

// The lab's own blocked trace: 192.168.1.50 → 192.168.1.60 RDP, lan → lan. Nothing matches; the
// closest are #2 and #1, each missing only the outgoing interface.
var rdpLanToLan = FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "192.168.1.60", Protocol: 6, DstPort: 3389}

func TestFix_ImplicitDenyOffersTheNarrowNewPolicyFirst(t *testing.T) {
	res, env := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", nil)
	if res.Verdict != "implicit-deny" {
		t.Fatalf("verdict = %s, want implicit-deny", res.Verdict)
	}
	if len(res.Fixes) == 0 || res.Fixes[0].ID != FixKindCreate {
		t.Fatalf("the first fix should be the new policy, got %+v", res.Fixes)
	}
	create := res.Fixes[0]
	want := "create-address:Host-192.168.1.50 create-address:Host-192.168.1.60 create-service:TCP-3389 create-policy:new"
	if got := stepOps(create); got != want {
		t.Fatalf("steps = %s\nwant    %s", got, want)
	}
	pol := create.Steps[3].policy
	if pol.NAT != "disable" {
		t.Errorf("an internal destination must not be source-NATed, got nat %s", pol.NAT)
	}
	if pol.Name != "TS-192.168.1.50-192.168.1.60" || pol.LogTraffic != "all" {
		t.Errorf("policy = %+v", pol)
	}
	if create.Scope.Broad {
		t.Error("a policy for exactly this connection is not broad")
	}

	after := simulateFix(res, env, create)
	if after.Verdict != "allowed" || after.Matched == nil || after.Matched.Name != pol.Name || after.Matched.PolicyID != 0 {
		t.Fatalf("after = %s %+v, want allowed by the new (id 0) policy", after.Verdict, after.Matched)
	}

	// And nothing it did leaked into the table the verdict came from.
	if len(env.policies) != len(labPolicies()) {
		t.Error("simulation added a policy to the real table")
	}
	if _, ok := env.in.am.addrs["Host-192.168.1.50"]; ok {
		t.Error("simulation added an address to the real matcher")
	}
}

func TestFix_AdjustingAClosestPolicyIsOfferedAndSaysItIsBroad(t *testing.T) {
	res, env := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", nil)
	for _, id := range []string{"adjust-2", "adjust-1"} {
		p := fixByID(t, res, id)
		if got := stepOps(p); !strings.HasPrefix(got, "add-member:") || len(p.Steps) != 1 {
			t.Fatalf("%s steps = %s, want one add-member", id, got)
		}
		if p.Steps[0].Field != CheckDstIntf || p.Steps[0].Value != "lan" {
			t.Fatalf("%s should add lan to dstintf, got %+v", id, p.Steps[0])
		}
		if !p.Scope.Broad {
			t.Errorf("%s: adding lan to an all/all/ALL policy opens everything on lan→lan — Broad must say so", id)
		}
		if simulateFix(res, env, p).Verdict != "allowed" {
			t.Errorf("%s does not let the packet through in simulation", id)
		}
	}
}

// The bug a shared planner caused: the second plan named an address the first plan had "planned"
// without creating it. Each plan is applied on its own, so each must create what it uses.
func TestFix_EveryPlanCreatesTheObjectsItUses(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	only7 := []FGPolicy{labPolicies()[3]} // Host-10100-to-Internet: lan → port1, one host as source
	res, _ := labFixEnv(t, only7, q, "lan", "port1", nil)

	create := fixByID(t, res, FixKindCreate)
	adjust := fixByID(t, res, "adjust-7")
	for _, p := range []FGFixPlan{create, adjust} {
		if !strings.Contains(stepOps(p), "create-address:Host-192.168.1.50") {
			t.Errorf("%s uses Host-192.168.1.50 without creating it: %s", p.ID, stepOps(p))
		}
	}
	// A public destination through a routed WAN: the new policy source-NATs.
	if create.Steps[len(create.Steps)-1].policy.NAT != "enable" {
		t.Error("a new policy to the internet should NAT")
	}
}

func TestFix_ReusesOnlyAnExactHostObject(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.10.100", DstIP: "192.168.1.60", Protocol: 6, DstPort: 443}
	res, _ := labFixEnv(t, labPolicies(), q, "lan", "lan", nil)
	create := fixByID(t, res, FixKindCreate)

	pol := create.Steps[len(create.Steps)-1].policy
	if pol.SrcAddr[0].Name != "Host-192.168.10.100" {
		t.Errorf("the device's own /32 for the source should be reused, got %s", pol.SrcAddr[0].Name)
	}
	// LAN-Network (192.168.1.0/24) contains the destination but is NOT reused: it would open the
	// whole subnet.
	if pol.DstAddr[0].Name != "Host-192.168.1.60" {
		t.Errorf("dstaddr = %s, want a new host object, never the /24 that happens to contain it", pol.DstAddr[0].Name)
	}
	if pol.Service[0].Name != "HTTPS" {
		t.Errorf("service = %s, want the existing HTTPS", pol.Service[0].Name)
	}
	if got := stepOps(create); strings.Contains(got, "create-service") || strings.Contains(got, "Host-192.168.10.100") {
		t.Errorf("reused objects must not be created again: %s", got)
	}
}

func TestFix_NameCollisionsAndInterfaceBoundAddresses(t *testing.T) {
	res, _ := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", func(env *traceEnv) {
		// Same name, different host: the name is taken, so the new one gets a suffix.
		addLabAddress(env, FGAddress{Name: "Host-192.168.1.60", Type: "ipmask", Subnet: "10.9.9.9 255.255.255.255"})
		// The right host, but bound to dmz: unusable in a lan policy (FortiOS -3).
		addLabAddress(env, FGAddress{Name: "DMZ-Bound-50", Type: "ipmask", Subnet: "192.168.1.50 255.255.255.255", Interface: "dmz"})
	})
	pol := fixByID(t, res, FixKindCreate).Steps
	got := stepOps(FGFixPlan{Steps: pol})
	if !strings.Contains(got, "create-address:Host-192.168.1.60-2") {
		t.Errorf("a taken name should get a suffix: %s", got)
	}
	if !strings.Contains(got, "create-address:Host-192.168.1.50") {
		t.Errorf("an address bound to another interface must not be reused: %s", got)
	}
}

func TestExactService(t *testing.T) {
	svcs := make([]FGService, 0)
	for _, s := range labSvcMatcher().services {
		svcs = append(svcs, s)
	}
	cases := []struct {
		proto, port int
		want        string
	}{
		{6, 443, "HTTPS"},
		{6, 3389, ""}, // ALL_TCP covers it, but as a range — reusing it would open every port
		{6, 53, ""},   // DNS is TCP AND UDP 53 — reusing it would also open UDP
		{17, 5000, "App-Voice"},
		{1, 0, "ALL_ICMP"},
		{47, 0, "GRE"},
	}
	for _, c := range cases {
		if got := exactService(svcs, c.proto, c.port); got != c.want {
			t.Errorf("exactService(%d, %d) = %q, want %q", c.proto, c.port, got, c.want)
		}
	}
}

func TestFix_DeniedTrafficMovesTheAllowingPolicyAboveTheDeny(t *testing.T) {
	deny := FGPolicy{PolicyID: 10, Name: "Block-LAN-Out", Status: "enable",
		SrcIntf: []FGName{{Name: "lan"}}, DstIntf: []FGName{{Name: "port1"}},
		SrcAddr: []FGName{{Name: "all"}}, DstAddr: []FGName{{Name: "all"}}, Service: []FGName{{Name: "ALL"}},
		Action: "deny", Schedule: "always"}
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res, env := labFixEnv(t, append([]FGPolicy{deny}, labPolicies()...), q, "lan", "port1", nil)
	if res.Verdict != "denied" || res.Matched.PolicyID != 10 {
		t.Fatalf("verdict = %s by %+v, want denied by #10", res.Verdict, res.Matched)
	}

	move := res.Fixes[0]
	if move.ID != "move-1" || move.RefID != 10 || stepOps(move) != "move-policy:1" {
		t.Fatalf("first fix = %s %s, want default (#1) moved above #10", move.ID, stepOps(move))
	}
	if after := simulateFix(res, env, move); after.Verdict != "allowed" || after.Matched.PolicyID != 1 {
		t.Fatalf("after the move = %s by %+v, want allowed by #1", after.Verdict, after.Matched)
	}

	create := fixByID(t, res, FixKindCreate)
	last := create.Steps[len(create.Steps)-1]
	if last.Op != FixOpMovePolicy || last.Name != newPolicyRef || last.refID != 10 {
		t.Fatalf("a new policy must be placed above the deny, last step = %+v", last)
	}
	if after := simulateFix(res, env, create); after.Verdict != "allowed" || after.Matched.PolicyID != 0 {
		t.Fatalf("after create+move = %s by %+v, want allowed by the new policy", after.Verdict, after.Matched)
	}
}

func TestFix_AScheduleMissIsNotOneClick(t *testing.T) {
	night := FGPolicy{PolicyID: 20, Name: "Night-Only", Status: "enable",
		SrcIntf: []FGName{{Name: "lan"}}, DstIntf: []FGName{{Name: "lan"}},
		SrcAddr: []FGName{{Name: "all"}}, DstAddr: []FGName{{Name: "all"}}, Service: []FGName{{Name: "ALL"}},
		Action: "accept", Schedule: "Night"}
	res, _ := labFixEnv(t, []FGPolicy{night}, rdpLanToLan, "lan", "lan", func(env *traceEnv) {
		env.in.schedules["Night"] = fgScheduleDetail{Name: "Night", Type: "recurring", Start: "01:00", End: "02:00"}
	})
	if len(res.Closest) != 1 || res.Closest[0].PolicyID != 20 {
		t.Fatalf("closest = %+v, want #20 missing only its schedule", res.Closest)
	}
	for _, f := range res.Fixes {
		if f.ID == "adjust-20" {
			t.Fatal("which hours to add to a schedule is not something to guess — no one-click fix")
		}
	}
}

func TestFix_ADisabledPolicyIsTurnedOn(t *testing.T) {
	off := FGPolicy{PolicyID: 30, Name: "LAN-Internal", Status: "disable",
		SrcIntf: []FGName{{Name: "lan"}}, DstIntf: []FGName{{Name: "lan"}},
		SrcAddr: []FGName{{Name: "LAN-Network"}}, DstAddr: []FGName{{Name: "LAN-Network"}}, Service: []FGName{{Name: "ALL"}},
		Action: "accept", Schedule: "always"}
	res, env := labFixEnv(t, []FGPolicy{off}, rdpLanToLan, "lan", "lan", nil)
	p := fixByID(t, res, "adjust-30")
	if stepOps(p) != "enable-policy:30" {
		t.Fatalf("steps = %s, want only enable-policy", stepOps(p))
	}
	if simulateFix(res, env, p).Verdict != "allowed" {
		t.Error("enabling the policy should let the packet through")
	}
}

func TestFix_AVirtualIPIsNamedNotAHostAddress(t *testing.T) {
	q := FGTraceQuery{SrcIP: "8.8.4.4", DstIP: "10.0.99.80", Protocol: 6, DstPort: 8080}
	res, env := labFixEnv(t, labPolicies(), q, "port1", "lan", nil)
	create := fixByID(t, res, FixKindCreate)
	pol := create.Steps[len(create.Steps)-1].policy
	if pol.DstAddr[0].Name != labVIP.Name {
		t.Fatalf("dstaddr = %s, want the VIP — a host address for the external IP would never be translated", pol.DstAddr[0].Name)
	}
	if strings.Contains(stepOps(create), "Host-10.0.99.80") {
		t.Error("no host object may be created for a VIP's external address")
	}
	if pol.NAT != "disable" {
		t.Error("DNAT traffic must keep the real client address")
	}
	after := simulateFix(res, env, create)
	if after.Verdict != "allowed" || after.DNAT == nil || after.DNAT.MappedIP != "192.168.1.80" {
		t.Fatalf("after = %s dnat %+v, want allowed and translated to the mapped server", after.Verdict, after.DNAT)
	}
}

func TestFix_AZoneMemberIsNamedByItsZone(t *testing.T) {
	res, env := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", func(env *traceEnv) {
		env.in.zones["LAN-Zone"] = []string{"lan"}
	})
	create := fixByID(t, res, FixKindCreate)
	pol := create.Steps[len(create.Steps)-1].policy
	if pol.SrcIntf[0].Name != "LAN-Zone" || pol.DstIntf[0].Name != "LAN-Zone" {
		t.Fatalf("interfaces = %v → %v, want the zone the port belongs to", pol.SrcIntf, pol.DstIntf)
	}
	if simulateFix(res, env, create).Verdict != "allowed" {
		t.Error("a policy on the zone should match traffic on its member")
	}
}

func TestFix_NothingIsOfferedForAllowedTraffic(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	res, _ := labFixEnv(t, labPolicies(), q, "lan", "port1", nil)
	if res.Verdict != "allowed" || len(res.Fixes) != 0 {
		t.Fatalf("verdict %s with %d fixes, want allowed and none", res.Verdict, len(res.Fixes))
	}
	if planFixes(FGTraceResult{Verdict: "no-route"}, &traceEnv{}) != nil {
		t.Error("no route: which gateway to add is not something to guess")
	}
}

func TestFixFingerprint_FollowsWhatWouldBeWritten(t *testing.T) {
	res, _ := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", nil)
	a := fixByID(t, res, FixKindCreate)
	res2, _ := labFixEnv(t, labPolicies(), rdpLanToLan, "lan", "lan", nil)
	if b := fixByID(t, res2, FixKindCreate); a.Fingerprint != b.Fingerprint || a.Fingerprint == "" {
		t.Fatalf("the same plan must hash the same: %q vs %q", a.Fingerprint, b.Fingerprint)
	}
	changed := a
	changed.Steps = append([]FGFixStep(nil), a.Steps...)
	changed.Steps[0].Value = "192.168.1.51/32"
	if fixFingerprint(changed) == a.Fingerprint {
		t.Error("a different value must change the fingerprint")
	}
}

func TestNeighbourOf_IsWhereAMoveIsUndoneTo(t *testing.T) {
	table := labPolicies() // 2, 6, 5, 7, 1
	if got := neighbourOf(table, 5); got == nil || *got != (FixMovePlace{Position: "before", Ref: 7}) {
		t.Errorf("#5 sits before #7, got %+v", got)
	}
	if got := neighbourOf(table, 1); got == nil || *got != (FixMovePlace{Position: "after", Ref: 7}) {
		t.Errorf("#1 is last, so it sits after #7, got %+v", got)
	}
	if neighbourOf(table, 99) != nil {
		t.Error("a policy that is not there has no place")
	}
}

func TestUniqueName_StaysInsideTheLimit(t *testing.T) {
	// The suffix is made room for, not appended past the limit.
	if got := uniqueName(map[string]bool{"abcdefghij": true}, "abcdefghijk", 10); got != "abcdefgh-2" {
		t.Fatalf("got %q, want the base cut to fit the suffix inside 10", got)
	}
	// A policy that is already there (an earlier fix for the same pair) gets -2, case-insensitively.
	taken := map[string]bool{"ts-192.168.1.50-192.168.1.60": true}
	if got := uniqueName(taken, "TS-192.168.1.50-192.168.1.60", 35); got != "TS-192.168.1.50-192.168.1.60-2" {
		t.Fatalf("got %q", got)
	}
	// The longest IPv4 pair fits FortiOS's 35-character policy name as it is.
	if n := len("TS-255.255.255.255-255.255.255.255"); n > 35 {
		t.Fatalf("longest IPv4 policy name is %d characters", n)
	}
}

func TestIsPrivateIP(t *testing.T) {
	for addr, want := range map[string]bool{
		"10.1.2.3": true, "172.16.0.1": true, "192.168.1.1": true, "100.64.0.1": true,
		"100.128.0.1": false, "8.8.8.8": false, "203.150.100.10": false,
	} {
		if got := isPrivateIP(ip(addr)); got != want {
			t.Errorf("isPrivateIP(%s) = %v, want %v", addr, got, want)
		}
	}
}

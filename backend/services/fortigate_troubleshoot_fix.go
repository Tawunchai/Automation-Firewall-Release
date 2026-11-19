package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"network_automation/services/platform"
	"strconv"
	"strings"
)

// ── Troubleshoot ▸ "fix it": what would let this packet through, and what that would do ─────────
//
// The trace used to stop at advice — "policy #1 would match if you add lan to its outgoing
// interfaces" — and leave the operator to go and make that edit somewhere else, trusting that it
// would work. This file turns each piece of advice into a concrete PLAN (the exact objects to
// create and attributes to write), SIMULATES it by walking the same policy table with the change
// applied in memory, and only offers the plans whose simulation actually lets the packet through.
//
// Three kinds, offered narrowest first:
//
//	create   a new policy for exactly this connection — this source, this destination, this service,
//	         on this interface pair. Placed above the deny that claims the packet, if one does.
//	move     an allowing policy that already matches, but sits below the deny that claims the packet
//	         first (the rule-order bug the walk reports as "shadowed").
//	adjust   an existing accept policy that misses by one or two criteria — turn it on, or add the
//	         missing interface / address / service. Broad by nature: the policy then lets through
//	         everything ELSE it lists as well, and the plan's Scope says so.
//
// WHAT IS NOT OFFERED. A missing route (which gateway?) and a schedule (which hours?) are decisions
// only a person can make; the page keeps its written advice for those. So is anything the
// simulation does not confirm: a plan that would not flip the verdict is not a fix.
//
// REUSE BEFORE CREATE. An address or service object that already says exactly what is needed is
// used as it is — FortiOS rejects a duplicate name with -5, and a second object for the same host
// is clutter somebody has to clean up. Only an exact match counts: a /24 that happens to contain the
// host would silently widen the rule to the whole subnet.
//
// UNDO. Every step records what it changed in the shape the change ledger stores, narrow enough to
// put back exactly that: a create is undone by deleting that one object by its key, an attribute
// write by writing the old value of that one attribute, a move by moving the policy back next to
// the neighbour it had. The executor never reads-modifies-writes a whole policy.

// Fix kinds.
const (
	FixKindCreate = "create"
	FixKindMove   = "move"
	FixKindAdjust = "adjust"
)

// Step operations.
const (
	FixOpCreateAddress = "create-address"
	FixOpCreateService = "create-service"
	FixOpEnablePolicy  = "enable-policy"
	FixOpAddMember     = "add-member"
	FixOpMovePolicy    = "move-policy"
	FixOpCreatePolicy  = "create-policy"
)

// newPolicyRef is the Name of a step that acts on the policy the plan itself creates — its id is
// only known once the device assigns one.
const newPolicyRef = "new"

// FGFixStep is one write the plan would make.
type FGFixStep struct {
	Op string `json:"op"`
	// Table is the CMDB table written ("firewall/policy", "firewall/address").
	Table string `json:"table"`
	// Name is the object: an address or service name, a policy id — or "new" for the policy this
	// plan creates.
	Name string `json:"name"`
	// Field is the policy attribute an add-member step extends (srcintf, dstaddr, service …).
	Field string `json:"field,omitempty"`
	// Value is what is written: the member added, an address's subnet, a service's "TCP/3389", the
	// policy a move is placed before.
	Value string `json:"value,omitempty"`
	// CLI is the same change as FortiOS CLI, shown to the operator and copyable.
	CLI string `json:"cli"`

	// The bodies a create step posts. Never sent to the browser: apply rebuilds the plan from a
	// fresh read, so the browser cannot choose what is written.
	address *FGAddress
	service *FGService
	policy  *FGPolicy
	// refID is a move's anchor: the step places its policy before this one.
	refID int
}

// FGFixScope is what the policy that carries this connection accepts once the plan is applied.
type FGFixScope struct {
	PolicyID   int      `json:"policy_id"` // 0 for a policy the plan creates
	PolicyName string   `json:"policy_name"`
	SrcIntf    []string `json:"src_intf"`
	DstIntf    []string `json:"dst_intf"`
	SrcAddr    []string `json:"src_addr"`
	DstAddr    []string `json:"dst_addr"`
	Service    []string `json:"service"`
	// Broad is set when that policy accepts much more than the traced connection: one of its
	// address or service lists is a catch-all. The page puts a warning on it.
	Broad bool `json:"broad"`
}

// FGFixPlan is one way to let the traced packet through.
type FGFixPlan struct {
	// ID names the plan within one trace: "create", "move-5", "adjust-1". Apply resolves it against
	// a fresh trace, never against anything the browser sends back.
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// PolicyID is the existing policy the plan changes (adjust, move); RefID the one a move — or a
	// created policy — is placed above.
	PolicyID   int    `json:"policy_id,omitempty"`
	PolicyName string `json:"policy_name,omitempty"`
	RefID      int    `json:"ref_id,omitempty"`

	Steps []FGFixStep `json:"steps"`
	Scope FGFixScope  `json:"scope"`

	// Fingerprint hashes the steps. The page sends back the one it previewed, and apply refuses when
	// the fresh plan differs — the firewall changed, and the operator has not seen what would now be
	// written.
	Fingerprint string `json:"fingerprint"`
}

// FGFixPreview is a what-if: the trace as it stands, the plan, and the trace after it.
type FGFixPreview struct {
	Before FGTraceResult `json:"before"`
	Plan   FGFixPlan     `json:"plan"`
	After  FGTraceResult `json:"after"`
}

// ── Planning ─────────────────────────────────────────────────────────────────

// planFixes lists the plans that would let the traced packet through, each confirmed by simulation.
func planFixes(res FGTraceResult, env *traceEnv) []FGFixPlan {
	if env == nil || !res.Routable {
		return nil
	}
	// A fresh planner per plan, on purpose: each plan is applied ON ITS OWN, so each must carry its
	// own create steps. A shared planner remembered "Host-192.168.1.50 is planned" from the first
	// plan and let the second one name that address without creating it — applying the second plan
	// alone would then point a policy at an object that does not exist.
	planner := func() *fixPlanner { return newFixPlanner(res, env) }

	var plans []FGFixPlan
	switch res.Verdict {
	case "denied":
		if res.Matched == nil {
			return nil
		}
		// An allowing policy that already matches, below the deny: reordering is the whole fix.
		for _, s := range res.Shadowed {
			if strings.EqualFold(s.Action, "accept") {
				plans = append(plans, planner().movePlan(s.PolicyID, res.Matched.PolicyID))
				break
			}
		}
		if plan, ok := planner().createPlan(res.Matched.PolicyID); ok {
			plans = append(plans, plan)
		}
	case "implicit-deny":
		if plan, ok := planner().createPlan(0); ok {
			plans = append(plans, plan)
		}
		for _, c := range res.Closest {
			if plan, ok := planner().adjustPlan(c); ok {
				plans = append(plans, plan)
			}
		}
	}

	out := make([]FGFixPlan, 0, len(plans))
	for _, plan := range plans {
		if simulateFix(res, env, plan).Verdict != "allowed" {
			continue
		}
		plan.Fingerprint = fixFingerprint(plan)
		out = append(out, plan)
	}
	return out
}

// fixPlanner carries what the plans are built from, and the names already taken on the device.
type fixPlanner struct {
	res         FGTraceResult
	env         *traceEnv
	addrNames   map[string]bool
	svcNames    map[string]bool
	policyNames map[string]bool
	plannedAddr map[string]string // ip → name, so one plan never creates the same host twice
}

func newFixPlanner(res FGTraceResult, env *traceEnv) *fixPlanner {
	p := &fixPlanner{
		res: res, env: env,
		addrNames: map[string]bool{}, svcNames: map[string]bool{}, policyNames: map[string]bool{},
		plannedAddr: map[string]string{},
	}
	// Addresses, VIPs and address groups share one namespace on FortiOS.
	for _, a := range env.addresses {
		p.addrNames[strings.ToLower(a.Name)] = true
	}
	for _, v := range env.vipList {
		p.addrNames[strings.ToLower(v.Name)] = true
	}
	if env.in.am != nil {
		for g := range env.in.am.groups {
			p.addrNames[strings.ToLower(g)] = true
		}
	}
	for _, s := range env.services {
		p.svcNames[strings.ToLower(s.Name)] = true
	}
	if env.in.sm != nil {
		for g := range env.in.sm.groups {
			p.svcNames[strings.ToLower(g)] = true
		}
	}
	for _, pol := range env.policies {
		if pol.Name != "" {
			p.policyNames[strings.ToLower(pol.Name)] = true
		}
	}
	return p
}

// createPlan is a new accept policy for exactly the traced connection. beforeID > 0 places it
// above that policy (the deny that would otherwise claim it); 0 leaves it at the bottom, which is
// enough when nothing above matched.
func (p *fixPlanner) createPlan(beforeID int) (FGFixPlan, bool) {
	q := p.res.Query
	if p.res.Ingress == "" || p.res.Egress == "" {
		return FGFixPlan{}, false
	}
	var steps []FGFixStep
	srcIntf := p.policyIntf(p.res.Ingress)
	dstIntf := p.policyIntf(p.res.Egress)

	srcAddr, st := p.hostAddress(q.SrcIP, p.res.Ingress)
	steps = append(steps, st...)
	dstAddr, st := p.destinationAddress()
	steps = append(steps, st...)
	svc, st := p.serviceFor()
	steps = append(steps, st...)

	name := p.uniquePolicyName(q.SrcIP, q.DstIP)
	// Source NAT for a public destination, which is what a LAN reaching the internet needs; none
	// for an internal one or a Virtual IP, where rewriting the source would hide the real client.
	nat := "disable"
	if p.dstVIP() == "" && !isPrivateIP(net.ParseIP(p.res.RouteTo)) && !isPrivateIP(net.ParseIP(q.DstIP)) {
		nat = "enable"
	}
	pol := &FGPolicy{
		Name:    name,
		SrcIntf: []FGName{{Name: srcIntf}}, DstIntf: []FGName{{Name: dstIntf}},
		SrcAddr: []FGName{{Name: srcAddr}}, DstAddr: []FGName{{Name: dstAddr}},
		Service:  []FGName{{Name: svc}},
		Schedule: "always", Action: "accept", NAT: nat, Status: "enable",
		// Log every session, so the next trace's "is this traffic arriving?" has an answer.
		LogTraffic: "all",
		Comments:   platform.TruncateUTF8(fmt.Sprintf("Troubleshooting: allow %s to %s %s", q.SrcIP, q.DstIP, protoPortLabel(q.Protocol, q.DstPort)), 1023),
	}
	steps = append(steps, FGFixStep{
		Op: FixOpCreatePolicy, Table: "firewall/policy", Name: newPolicyRef, Value: name,
		CLI: policyCLI(pol), policy: pol,
	})
	if beforeID > 0 {
		steps = append(steps, FGFixStep{
			Op: FixOpMovePolicy, Table: "firewall/policy", Name: newPolicyRef, Value: strconv.Itoa(beforeID),
			CLI:   fmt.Sprintf("config firewall policy\n    move <new policy id> before %d\nend", beforeID),
			refID: beforeID,
		})
	}

	return FGFixPlan{
		ID: FixKindCreate, Kind: FixKindCreate, RefID: beforeID, Steps: steps,
		Scope: FGFixScope{
			PolicyName: name,
			SrcIntf:    []string{srcIntf}, DstIntf: []string{dstIntf},
			SrcAddr: []string{srcAddr}, DstAddr: []string{dstAddr}, Service: []string{svc},
		},
	}, true
}

// movePlan places an allowing policy above the deny that claims the packet first.
func (p *fixPlanner) movePlan(policyID, beforeID int) FGFixPlan {
	pol, _ := p.policy(policyID)
	return FGFixPlan{
		ID: fmt.Sprintf("move-%d", policyID), Kind: FixKindMove,
		PolicyID: policyID, PolicyName: pol.Name, RefID: beforeID,
		Steps: []FGFixStep{{
			Op: FixOpMovePolicy, Table: "firewall/policy", Name: strconv.Itoa(policyID), Value: strconv.Itoa(beforeID),
			CLI:   fmt.Sprintf("config firewall policy\n    move %d before %d\nend", policyID, beforeID),
			refID: beforeID,
		}},
		Scope: scopeOf(pol),
	}
}

// adjustPlan fills in the one or two criteria a closest policy misses. A schedule miss makes the
// whole plan unavailable: which hours to add is not something to guess.
func (p *fixPlanner) adjustPlan(v FGPolicyVerdict) (FGFixPlan, bool) {
	pol, ok := p.policy(v.PolicyID)
	if !ok {
		return FGFixPlan{}, false
	}
	after := clonePolicy(pol)
	var creates, edits []FGFixStep
	addMember := func(field, member string) {
		edits = append(edits, FGFixStep{
			Op: FixOpAddMember, Table: "firewall/policy", Name: strconv.Itoa(pol.PolicyID), Field: field, Value: member,
			CLI: fmt.Sprintf("config firewall policy\n    edit %d\n        append %s %q\n    next\nend", pol.PolicyID, field, member),
		})
		appendMember(&after, field, member)
	}

	for _, c := range v.Checks {
		if c.OK {
			continue
		}
		switch c.Field {
		case CheckStatus:
			edits = append(edits, FGFixStep{
				Op: FixOpEnablePolicy, Table: "firewall/policy", Name: strconv.Itoa(pol.PolicyID), Value: "enable",
				CLI: fmt.Sprintf("config firewall policy\n    edit %d\n        set status enable\n    next\nend", pol.PolicyID),
			})
			after.Status = "enable"
		case CheckSrcIntf:
			if p.res.Ingress == "" {
				return FGFixPlan{}, false
			}
			addMember(CheckSrcIntf, p.policyIntf(p.res.Ingress))
		case CheckDstIntf:
			addMember(CheckDstIntf, p.policyIntf(p.res.Egress))
		case CheckSrcAddr:
			name, st := p.hostAddress(p.res.Query.SrcIP, p.res.Ingress)
			creates = append(creates, st...)
			addMember(CheckSrcAddr, name)
		case CheckDstAddr:
			name, st := p.destinationAddress()
			creates = append(creates, st...)
			addMember(CheckDstAddr, name)
		case CheckService:
			name, st := p.serviceFor()
			creates = append(creates, st...)
			addMember(CheckService, name)
		default: // schedule, or anything this planner does not know how to change
			return FGFixPlan{}, false
		}
	}
	if len(edits) == 0 {
		return FGFixPlan{}, false
	}
	return FGFixPlan{
		ID: fmt.Sprintf("adjust-%d", pol.PolicyID), Kind: FixKindAdjust,
		PolicyID: pol.PolicyID, PolicyName: pol.Name,
		Steps: append(creates, edits...),
		Scope: scopeOf(after),
	}, true
}

func (p *fixPlanner) policy(id int) (FGPolicy, bool) {
	for _, pol := range p.env.policies {
		if pol.PolicyID == id {
			return pol, true
		}
	}
	return FGPolicy{}, false
}

// policyIntf is the name a policy must use for an interface: its zone when it is a zone member —
// FortiOS will not accept a member port in a policy once the port belongs to a zone.
func (p *fixPlanner) policyIntf(intf string) string {
	for zone, members := range p.env.in.zones {
		for _, m := range members {
			if strings.EqualFold(m, intf) {
				return zone
			}
		}
	}
	return intf
}

// dstVIP is the Virtual IP the destination is addressed to, if any. A policy for DNAT traffic has
// to name the VIP — a host address for the external IP would match nothing FortiOS translates.
func (p *fixPlanner) dstVIP() string {
	if v := vipForDestination(p.env.vipList, net.ParseIP(p.res.Query.DstIP), p.res.Ingress); v != nil {
		return v.Name
	}
	return ""
}

func (p *fixPlanner) destinationAddress() (string, []FGFixStep) {
	if vip := p.dstVIP(); vip != "" {
		return vip, nil
	}
	return p.hostAddress(p.res.Query.DstIP, p.res.Egress)
}

// hostAddress is an address object that is exactly this one host: an existing one when the device
// has it, otherwise a planned "Host-<ip>" — the naming the lab's own objects already use.
func (p *fixPlanner) hostAddress(ip, intf string) (string, []FGFixStep) {
	host := net.ParseIP(strings.TrimSpace(ip))
	if host == nil || host.To4() == nil {
		// IPv6 lives in firewall/address6 and a different policy table; not planned here.
		return "all", nil
	}
	want := host.To4().String() + " 255.255.255.255"
	if name, ok := p.plannedAddr[want]; ok {
		return name, nil
	}
	for _, a := range p.env.addresses {
		if a.Type != "" && a.Type != "ipmask" {
			continue
		}
		if strings.Join(strings.Fields(a.Subnet), " ") != want {
			continue
		}
		// An interface-bound address is only valid in a policy on that interface (error -3).
		if a.Interface != "" && !strings.EqualFold(a.Interface, intf) {
			continue
		}
		return a.Name, nil
	}
	name := uniqueName(p.addrNames, "Host-"+host.To4().String(), 79)
	p.addrNames[strings.ToLower(name)] = true
	p.plannedAddr[want] = name
	addr := &FGAddress{Name: name, Type: "ipmask", Subnet: want, Comment: "Created by Troubleshooting"}
	return name, []FGFixStep{{
		Op: FixOpCreateAddress, Table: "firewall/address", Name: name, Value: host.To4().String() + "/32",
		CLI: fmt.Sprintf("config firewall address\n    edit %q\n        set subnet %s\n        set comment %q\n    next\nend",
			name, want, addr.Comment),
		address: addr,
	}}
}

// serviceFor is a service object for exactly the traced protocol and port.
func (p *fixPlanner) serviceFor() (string, []FGFixStep) {
	q := p.res.Query
	if name := exactService(p.env.services, q.Protocol, q.DstPort); name != "" {
		return name, nil
	}
	svc := &FGService{Comment: "Created by Troubleshooting"}
	var set string
	switch q.Protocol {
	case 6, 17, 132:
		proto := map[int]string{6: "TCP", 17: "UDP", 132: "SCTP"}[q.Protocol]
		svc.Name = uniqueName(p.svcNames, fmt.Sprintf("%s-%d", proto, q.DstPort), 79)
		svc.Protocol = "TCP/UDP/SCTP"
		port := strconv.Itoa(q.DstPort)
		switch q.Protocol {
		case 6:
			svc.TCPPortRange = port
		case 17:
			svc.UDPPortRange = port
		default:
			svc.SCTPPortRange = port
		}
		set = fmt.Sprintf("set %s-portrange %d", strings.ToLower(proto), q.DstPort)
	case 1:
		svc.Name = uniqueName(p.svcNames, "ICMP-any", 79)
		svc.Protocol = "ICMP"
		set = "set protocol ICMP"
	default:
		svc.Name = uniqueName(p.svcNames, fmt.Sprintf("IP-%d", q.Protocol), 79)
		svc.Protocol = "IP"
		svc.ProtocolNum = q.Protocol
		set = fmt.Sprintf("set protocol IP\n        set protocol-number %d", q.Protocol)
	}
	p.svcNames[strings.ToLower(svc.Name)] = true
	return svc.Name, []FGFixStep{{
		Op: FixOpCreateService, Table: "firewall.service/custom", Name: svc.Name,
		Value: protoPortLabel(q.Protocol, q.DstPort),
		CLI: fmt.Sprintf("config firewall service custom\n    edit %q\n        %s\n        set comment %q\n    next\nend",
			svc.Name, set, svc.Comment),
		service: svc,
	}}
}

// exactService finds a service that is exactly this protocol and port — not a range that happens to
// include it, which would open every other port in the range along with it.
func exactService(svcs []FGService, protocol, port int) string {
	for _, s := range svcs {
		switch strings.ToUpper(s.Protocol) {
		case "TCP/UDP/SCTP":
			ranges := map[int]string{6: s.TCPPortRange, 17: s.UDPPortRange, 132: s.SCTPPortRange}
			mine, ok := ranges[protocol]
			if !ok || strings.TrimSpace(mine) != strconv.Itoa(port) {
				continue
			}
			others := 0
			for proto, r := range ranges {
				if proto != protocol && strings.TrimSpace(r) != "" {
					others++
				}
			}
			if others == 0 {
				return s.Name
			}
		case "ICMP":
			// The trace matches ICMP on the protocol alone, so any ICMP service is an exact answer.
			if protocol == 1 {
				return s.Name
			}
		case "IP":
			if s.ProtocolNum == protocol && protocol != 0 {
				return s.Name
			}
		}
	}
	return ""
}

// uniquePolicyName is "TS-<src>-<dst>", made unique among the device's policy names and kept inside
// FortiOS's 35-character limit.
func (p *fixPlanner) uniquePolicyName(src, dst string) string {
	name := uniqueName(p.policyNames, fmt.Sprintf("TS-%s-%s", src, dst), 35)
	p.policyNames[strings.ToLower(name)] = true
	return name
}

// uniqueName returns base, or base-2, base-3 … — the first one not in taken, at most max runes.
func uniqueName(taken map[string]bool, base string, max int) string {
	fit := func(s, suffix string) string {
		r := []rune(s)
		if len(r)+len([]rune(suffix)) > max {
			r = r[:max-len([]rune(suffix))]
		}
		return string(r) + suffix
	}
	name := fit(base, "")
	for i := 2; taken[strings.ToLower(name)]; i++ {
		name = fit(base, fmt.Sprintf("-%d", i))
	}
	return name
}

// ── Scope ────────────────────────────────────────────────────────────────────

func scopeOf(p FGPolicy) FGFixScope {
	s := FGFixScope{
		PolicyID: p.PolicyID, PolicyName: p.Name,
		SrcIntf: fgNames(p.SrcIntf), DstIntf: fgNames(p.DstIntf),
		SrcAddr: fgNames(p.SrcAddr), DstAddr: fgNames(p.DstAddr), Service: fgNames(p.Service),
	}
	for _, list := range [][]string{s.SrcAddr, s.DstAddr, s.Service} {
		for _, n := range list {
			switch strings.ToLower(n) {
			case "all", "any", "all_tcp", "all_udp":
				s.Broad = true
			}
		}
	}
	return s
}

func clonePolicy(p FGPolicy) FGPolicy {
	c := p
	c.SrcIntf = append([]FGName(nil), p.SrcIntf...)
	c.DstIntf = append([]FGName(nil), p.DstIntf...)
	c.SrcAddr = append([]FGName(nil), p.SrcAddr...)
	c.DstAddr = append([]FGName(nil), p.DstAddr...)
	c.Service = append([]FGName(nil), p.Service...)
	return c
}

// appendMember adds a member to one of a policy's lists, once.
func appendMember(p *FGPolicy, field, member string) {
	var list *[]FGName
	switch field {
	case CheckSrcIntf:
		list = &p.SrcIntf
	case CheckDstIntf:
		list = &p.DstIntf
	case CheckSrcAddr:
		list = &p.SrcAddr
	case CheckDstAddr:
		list = &p.DstAddr
	case CheckService:
		list = &p.Service
	default:
		return
	}
	for _, n := range *list {
		if strings.EqualFold(n.Name, member) {
			return
		}
	}
	*list = append(*list, FGName{Name: member})
}

// ── Simulation ───────────────────────────────────────────────────────────────

// simulateFix walks the policy table again with the plan applied in memory — the same walk, the
// same matchers, the same clock — and returns the trace as it would be. Nothing is written.
func simulateFix(res FGTraceResult, env *traceEnv, plan FGFixPlan) FGTraceResult {
	policies := make([]FGPolicy, len(env.policies))
	for i, p := range env.policies {
		policies[i] = clonePolicy(p)
	}

	in := env.in
	am := &addrMatcher{addrs: make(map[string]FGAddress, len(in.am.addrs)+2), groups: in.am.groups, vips: in.am.vips}
	for k, v := range in.am.addrs {
		am.addrs[k] = v
	}
	sm := &svcMatcher{services: make(map[string]FGService, len(in.sm.services)+1), groups: in.sm.groups}
	for k, v := range in.sm.services {
		sm.services[k] = v
	}
	in.am, in.sm = am, sm
	// The created policy has no counters of its own; without this it would borrow the implicit
	// deny's row, which the monitor API reports as policy 0.
	in.stats = map[int]FGPolicyStats{}
	for k, v := range env.in.stats {
		if k > 0 {
			in.stats[k] = v
		}
	}

	index := func(id int) int {
		for i := range policies {
			if policies[i].PolicyID == id {
				return i
			}
		}
		return -1
	}
	created := -1 // index of the policy this plan creates, once created

	for _, st := range plan.Steps {
		switch st.Op {
		case FixOpCreateAddress:
			am.addrs[st.address.Name] = *st.address
		case FixOpCreateService:
			sm.services[st.service.Name] = *st.service
		case FixOpCreatePolicy:
			np := clonePolicy(*st.policy)
			np.PolicyID = 0 // the device assigns the real one
			policies = append(policies, np)
			created = len(policies) - 1
		case FixOpEnablePolicy:
			if i := index(atoiOr0(st.Name)); i >= 0 {
				policies[i].Status = "enable"
			}
		case FixOpAddMember:
			if i := index(atoiOr0(st.Name)); i >= 0 {
				appendMember(&policies[i], st.Field, st.Value)
			}
		case FixOpMovePolicy:
			from := created
			if st.Name != newPolicyRef {
				from = index(atoiOr0(st.Name))
			}
			to := index(st.refID)
			if from < 0 || to < 0 || from == to {
				continue
			}
			// `created` is an INDEX into this slice, so every splice that shifts elements past it
			// has to shift it too — the same bookkeeping buildImpactTable does in
			// fortigate_impact_preview.go, which is where the shape below comes from.
			//
			// Without it, a plan that creates a policy and then moves a DIFFERENT policy out from
			// underneath it leaves `created` pointing one row too far down the table: the next
			// `move <new policy> before …` step then relocates whichever rule happens to sit there,
			// and the simulation the user is shown is of a change nobody asked for.
			movedIsCreated := created >= 0 && from == created
			moved := policies[from]
			policies = append(policies[:from], policies[from+1:]...)
			if created > from {
				created-- // everything below the removed row shifted up one
			}
			if from < to {
				to--
			}
			policies = append(policies[:to], append([]FGPolicy{moved}, policies[to:]...)...)
			switch {
			case movedIsCreated:
				created = to
			case created >= to:
				created++ // the insertion pushed everything from `to` down one
			}
		}
	}

	out := FGTraceResult{
		Query: res.Query, Ingress: res.Ingress, IngressVia: res.IngressVia, IngressRoute: res.IngressRoute,
		Egress: res.Egress, EgressRoute: res.EgressRoute, RouteTo: res.RouteTo, Routable: res.Routable,
		IngressLink: res.IngressLink, EgressLink: res.EgressLink,
		Notes: append([]string(nil), res.Notes...),
	}
	seen := map[string]bool{}
	for _, n := range out.Notes {
		seen[n] = true
	}
	in.note = func(s string) {
		if s != "" && !seen[s] {
			seen[s] = true
			out.Notes = append(out.Notes, s)
		}
	}
	walkPolicyTable(&out, policies, in)
	out.Total = len(policies)
	return out
}

// isPrivateIP reports whether an address lives inside a network rather than on the internet:
// RFC 1918 / ULA, loopback, link-local and CGNAT (100.64/10). A nil address counts as internal —
// the safe default for the one decision it feeds (whether a new policy should source-NAT).
func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1]&0xC0 == 64 {
		return true
	}
	return false
}

func atoiOr0(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

// fixFingerprint hashes what a plan would write — ops, targets and values, in order.
func fixFingerprint(plan FGFixPlan) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%d|%d\n", plan.Kind, plan.PolicyID, plan.RefID)
	for _, s := range plan.Steps {
		fmt.Fprintf(h, "%s|%s|%s|%s|%s\n", s.Op, s.Table, s.Name, s.Field, s.Value)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// PreviewTraceFix traces the query afresh, finds the plan by id and simulates it.
func (f *FortiClient) PreviewTraceFix(q FGTraceQuery, fixID string) (FGFixPreview, error) {
	res, env, err := f.traceWithEnv(q)
	if err != nil {
		return FGFixPreview{}, err
	}
	res.Fixes = planFixes(res, env)
	for _, plan := range res.Fixes {
		if plan.ID == fixID {
			return FGFixPreview{Before: res, Plan: plan, After: simulateFix(res, env, plan)}, nil
		}
	}
	return FGFixPreview{Before: res}, fmt.Errorf("%w: %q is not a fix for this trace any more", ErrFixUnavailable, fixID)
}

// ErrFixUnavailable means the plan asked for is not among the ones a fresh trace offers — the
// firewall changed, or the id never was a plan for this connection.
var ErrFixUnavailable = errors.New("fix unavailable")

// ── Applying ─────────────────────────────────────────────────────────────────

// FixOutcome is what one applied step did, in the shape the change ledger stores it.
type FixOutcome struct {
	Action   string // create | update
	CMDBPath string // the ledger form, "/api/v2/cmdb/firewall/policy"
	MKey     string
	// Before is only what the step changed ({"status":"disable"}), so undoing it puts back exactly
	// that. Nil for a create, whose undo is a delete.
	Before json.RawMessage
	After  json.RawMessage
	// Reused is set when the object was already on the device exactly as planned: nothing was written
	// and there is nothing to undo — deleting it later would remove something this fix did not add.
	Reused bool
	// PolicyID is the id the device assigned to a created policy.
	PolicyID int
}

// FixMoveRecord is a move step's After: where the policy went and where it came from. A move has
// no body to replay, so the ledger's generic revert cannot undo it — Before stays empty so that
// revert refuses rather than rewriting the policy to no effect, and the troubleshoot undo reads this.
type FixMoveRecord struct {
	Position string        `json:"position"`
	Ref      int           `json:"ref"`
	Restore  *FixMovePlace `json:"restore"`
}

// FixMovePlace is one place in the table: before or after a neighbour.
type FixMovePlace struct {
	Position string `json:"position"`
	Ref      int    `json:"ref"`
}

// ExecuteFixStep writes one step. newPolicyID is the policy an earlier step of the same plan
// created (for a move that places it); policies is the table as it was before this plan ran.
func (f *FortiClient) ExecuteFixStep(st FGFixStep, newPolicyID int, policies []FGPolicy) (FixOutcome, error) {
	ledger := LedgerPath(st.Table)
	marshal := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

	switch st.Op {
	case FixOpCreateAddress:
		out := FixOutcome{Action: ChangeActionCreate, CMDBPath: ledger, MKey: st.address.Name, After: marshal(st.address)}
		err := f.CreateAddress(*st.address)
		if err != nil && IsDuplicateObjectError(err) {
			// Somebody made it between the plan and now. Fine if it is the same host; otherwise the
			// name now means something else and writing the policy against it would be wrong.
			if existing, ok := f.findAddress(st.address.Name); ok &&
				strings.Join(strings.Fields(existing.Subnet), " ") == st.address.Subnet {
				out.Reused = true
				return out, nil
			}
			return out, fmt.Errorf("an address named %q already exists with a different value", st.address.Name)
		}
		return out, err

	case FixOpCreateService:
		out := FixOutcome{Action: ChangeActionCreate, CMDBPath: ledger, MKey: st.service.Name, After: marshal(st.service)}
		err := f.CreateService(*st.service)
		if err != nil && IsDuplicateObjectError(err) {
			return out, fmt.Errorf("a service named %q already exists — trace again to plan around it", st.service.Name)
		}
		return out, err

	case FixOpEnablePolicy:
		id := atoiOr0(st.Name)
		out := FixOutcome{Action: ChangeActionUpdate, CMDBPath: ledger, MKey: st.Name,
			Before: marshal(map[string]string{"status": "disable"}), After: marshal(map[string]string{"status": "enable"})}
		return out, f.UpdateCMDBAttrs(st.Table, strconv.Itoa(id), map[string]any{"status": "enable"})

	case FixOpAddMember:
		// The CURRENT list, read now: the list the plan saw may already be stale, and writing it
		// back would drop whatever was added since.
		snap, _ := f.SnapshotCMDBObject(ledger, st.Name)
		var obj map[string]json.RawMessage
		if len(snap) == 0 || json.Unmarshal(snap, &obj) != nil {
			return FixOutcome{}, fmt.Errorf("policy %s could not be read before changing it", st.Name)
		}
		var current []FGName
		_ = json.Unmarshal(obj[st.Field], &current)
		next := make([]FGName, 0, len(current)+1)
		for _, n := range current {
			if strings.EqualFold(n.Name, st.Value) {
				return FixOutcome{Action: ChangeActionUpdate, CMDBPath: ledger, MKey: st.Name, Reused: true}, nil
			}
			next = append(next, FGName{Name: n.Name})
		}
		next = append(next, FGName{Name: st.Value})
		before := make([]FGName, len(current))
		for i, n := range current {
			before[i] = FGName{Name: n.Name}
		}
		out := FixOutcome{Action: ChangeActionUpdate, CMDBPath: ledger, MKey: st.Name,
			Before: marshal(map[string]any{st.Field: before}), After: marshal(map[string]any{st.Field: next})}
		return out, f.UpdateCMDBAttrs(st.Table, st.Name, map[string]any{st.Field: next})

	case FixOpCreatePolicy:
		created, err := f.CreatePolicy(*st.policy)
		if err != nil {
			return FixOutcome{Action: ChangeActionCreate, CMDBPath: ledger}, err
		}
		if created == nil || created.PolicyID == 0 {
			return FixOutcome{Action: ChangeActionCreate, CMDBPath: ledger},
				fmt.Errorf("the device did not report the new policy's id, so it cannot be undone by key")
		}
		return FixOutcome{Action: ChangeActionCreate, CMDBPath: ledger, MKey: strconv.Itoa(created.PolicyID),
			After: marshal(st.policy), PolicyID: created.PolicyID}, nil

	case FixOpMovePolicy:
		id := atoiOr0(st.Name)
		rec := FixMoveRecord{Position: "before", Ref: st.refID}
		if st.Name == newPolicyRef {
			// Undoing the plan deletes the policy it created; moving it back first would be a
			// wasted write, so there is nothing to restore.
			id = newPolicyID
		} else {
			rec.Restore = neighbourOf(policies, id)
		}
		if id == 0 {
			return FixOutcome{}, fmt.Errorf("no policy to move")
		}
		out := FixOutcome{Action: ChangeActionUpdate, CMDBPath: ledger, MKey: strconv.Itoa(id), After: marshal(rec)}
		return out, f.MovePolicy(id, "before", st.refID)
	}
	return FixOutcome{}, fmt.Errorf("unknown fix step %q", st.Op)
}

// FixLedgerType is the change-ledger resource type a step is recorded under. Placing the policy the
// same plan created is its own type: undoing the plan deletes that policy, so the placement has
// nothing of its own to undo, and the Change history must not offer a Revert for it.
func FixLedgerType(st FGFixStep) string {
	if st.Op == FixOpMovePolicy && st.Name == newPolicyRef {
		return LedgerTypeFixPlaceNew
	}
	return "troubleshoot-fix:" + st.Op
}

// neighbourOf is where a policy sits: before the one that follows it, or after the one before it
// when it is last. Moving it back to that place undoes a move.
func neighbourOf(policies []FGPolicy, id int) *FixMovePlace {
	order := make([]int, len(policies))
	for i, p := range policies {
		order[i] = p.PolicyID
	}
	return neighbourOfIDs(order, id)
}

func (f *FortiClient) findAddress(name string) (FGAddress, bool) {
	addrs, err := f.GetAddresses()
	if err != nil {
		return FGAddress{}, false
	}
	for _, a := range addrs {
		if a.Name == name {
			return a, true
		}
	}
	return FGAddress{}, false
}

// PlanTraceFix is apply's half of the preview: a fresh trace, the plan by id, and the policy table
// as it stands — everything ExecuteFixStep needs, and nothing the browser supplied.
func (f *FortiClient) PlanTraceFix(q FGTraceQuery, fixID string) (FGFixPlan, []FGPolicy, error) {
	res, env, err := f.traceWithEnv(q)
	if err != nil {
		return FGFixPlan{}, nil, err
	}
	for _, plan := range planFixes(res, env) {
		if plan.ID == fixID {
			return plan, env.policies, nil
		}
	}
	return FGFixPlan{}, nil, fmt.Errorf("%w: %q is not a fix for this trace any more", ErrFixUnavailable, fixID)
}

// ── CLI rendering ────────────────────────────────────────────────────────────

func policyCLI(p *FGPolicy) string {
	list := func(ns []FGName) string {
		q := make([]string, len(ns))
		for i, n := range ns {
			q[i] = strconv.Quote(n.Name)
		}
		return strings.Join(q, " ")
	}
	return strings.Join([]string{
		"config firewall policy",
		"    edit 0",
		fmt.Sprintf("        set name %q", p.Name),
		"        set srcintf " + list(p.SrcIntf),
		"        set dstintf " + list(p.DstIntf),
		"        set srcaddr " + list(p.SrcAddr),
		"        set dstaddr " + list(p.DstAddr),
		"        set action accept",
		`        set schedule "always"`,
		"        set service " + list(p.Service),
		"        set nat " + p.NAT,
		"        set logtraffic all",
		fmt.Sprintf("        set comments %q", p.Comments),
		"    next",
		"end",
	}, "\n")
}

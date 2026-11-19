package services

import (
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ── Troubleshoot: "why can't 10.0.1.5 reach 8.8.8.8?" ────────────────────────
//
// This answers the question the way an engineer would: find the interface the packet arrives on,
// the interface it would leave by, then walk the policy table top-down and say which policy claims
// it — and, for every policy above that one, WHY it did not.
//
// WHY THIS IS COMPUTED HERE AND NOT ASKED OF THE DEVICE
// FortiOS has a monitor endpoint for this, /api/v2/monitor/firewall/policy-lookup. On the lab
// device (FortiGate 80E, FortiOS 7.2.10) it answers 424 "failed dependency" to every parameter
// combination tried — with and without ipVersion, srcIntf, sourceIp, sourcePort, GET and POST. The
// underlying machinery is fine (`diagnose firewall iprope lookup` over SSH answers correctly), so
// the endpoint is simply not usable on this firmware.
//
// Computing it here is also strictly more useful than the device's answer would be: the device
// returns the matching policy id and nothing else, while a user asking "why can't I reach it"
// needs the REJECTED policies and the reason for each. That is the actual answer.
//
// Everything below is derived from CMDB reads plus one monitor call for hit counters. No SSH job,
// no AI, no writes.

// ── Query ────────────────────────────────────────────────────────────────────

// FGTraceQuery is the 5-tuple to trace. SrcIntf may be empty — the device's own routing table is
// asked which interface the source address would arrive on.
type FGTraceQuery struct {
	SrcIP    string `json:"src_ip"`
	DstIP    string `json:"dst_ip"`
	Protocol int    `json:"protocol"` // 6 TCP · 17 UDP · 1 ICMP · any IP protocol number
	DstPort  int    `json:"dst_port"` // ignored for ICMP
	SrcIntf  string `json:"src_intf"` // optional override
}

// ── Result ───────────────────────────────────────────────────────────────────

// FGPolicyVerdict is one row of the walk: a policy, and whether the packet matched it.
type FGPolicyVerdict struct {
	PolicyID int    `json:"policy_id"`
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`
	Action   string `json:"action"` // accept | deny
	Matched  bool   `json:"matched"`

	// Why the packet did NOT match. Empty on the matching policy. This is the column the user
	// actually reads — "dstaddr 'Guest-WiFi-Subnet' does not contain 8.8.8.8".
	Reason string `json:"reason,omitempty"`

	SrcIntf []string `json:"src_intf"`
	DstIntf []string `json:"dst_intf"`
	SrcAddr []string `json:"src_addr"`
	DstAddr []string `json:"dst_addr"`
	Service []string `json:"service"`

	Schedule string   `json:"schedule"`
	NAT      bool     `json:"nat"`
	UTM      bool     `json:"utm"`
	Profiles []string `json:"profiles,omitempty"` // the security profiles this policy applies

	// Live counters from monitor/firewall/policy — "this policy has never passed a packet" is
	// often the answer to "is my traffic really going here?".
	Bytes          int64 `json:"bytes"`
	Packets        int64 `json:"packets"`
	ActiveSessions int64 `json:"active_sessions"`

	// Every criterion, passed or failed — see fortigate_troubleshoot_checks.go. Reason is the
	// first failed one.
	Checks []FGTraceCheck `json:"checks"`
	// Failed is how many of Checks failed: 0 on a policy that matches.
	Failed int `json:"failed"`
}

// FGTraceResult is the whole answer.
type FGTraceResult struct {
	Query FGTraceQuery `json:"query"`

	// Ingress is where the source address would come in (routing lookup on the SOURCE, which is
	// what a reverse-path check does), Egress where the destination is reached.
	Ingress      string        `json:"ingress"`
	IngressVia   string        `json:"ingress_via"` // "route" | "user" — how Ingress was decided
	IngressRoute FGRouteLookup `json:"ingress_route"`
	Egress       string        `json:"egress"`
	EgressRoute  FGRouteLookup `json:"egress_route"`
	// RouteTo is the address the egress lookup was made for: the destination, or — when it is a
	// Virtual IP — the mapped server it is translated to first.
	RouteTo  string `json:"route_to"`
	Routable bool   `json:"routable"`

	// Whether the cable is up on each side — a correct rule on a down link passes nothing.
	IngressLink *FGInterfaceLink `json:"ingress_link,omitempty"`
	EgressLink  *FGInterfaceLink `json:"egress_link,omitempty"`

	// Verdict is the outcome: "allowed" · "denied" · "no-route" · "implicit-deny".
	Verdict   string            `json:"verdict"`
	Summary   string            `json:"summary"`
	Matched   *FGPolicyVerdict  `json:"matched"`
	Evaluated []FGPolicyVerdict `json:"evaluated"`

	// Below counts the policies never reached because an earlier one matched — first match wins,
	// and users regularly forget that a rule further down "should have" applied.
	Below int `json:"below"`
	// Total is the size of the policy table walked.
	Total int `json:"total"`

	// Shadowed are the policies BELOW the match that would have matched too, but are never reached:
	// the rule-order bug, visible only if the walk looks past the first match.
	Shadowed []FGPolicyVerdict `json:"shadowed,omitempty"`
	// Closest are, when nothing matched, the accepting policies that failed the fewest criteria —
	// usually the rule somebody meant to write. Every rule tied at that count is listed (up to
	// three, in table order): choosing one would hide an equally good answer. Only offered when
	// they miss by one or two.
	Closest []FGPolicyVerdict `json:"closest,omitempty"`

	// What the matched policy does to the addresses on the way through.
	SNAT *FGTraceSNAT `json:"snat,omitempty"`
	DNAT *FGTraceDNAT `json:"dnat,omitempty"`

	// Notes carry everything the walk could not decide for certain (an FQDN address that would
	// need DNS, a dynamic SDN address, a wildcard). They are warnings, not errors: the verdict is
	// still the best available answer, and hiding the uncertainty would be worse than showing it.
	Notes []string `json:"notes,omitempty"`

	// ResolvedFrom is the hostname the destination was typed as, when it was not an address; the
	// trace ran on ResolvedIPs[0]. Resolved by the console's DNS, which is not the firewall's — the
	// page says so, because a CDN can answer each of them with a different address.
	ResolvedFrom string   `json:"resolved_from,omitempty"`
	ResolvedIPs  []string `json:"resolved_ips,omitempty"`

	// Fixes are the concrete changes that would let this packet through, each one simulated before
	// it is offered — see fortigate_troubleshoot_fix.go. Empty when the traffic is already allowed,
	// or when nothing short of a decision only a person can make (a route, a schedule) would help.
	Fixes []FGFixPlan `json:"fixes,omitempty"`
}

// ── Address resolution ───────────────────────────────────────────────────────

// addrMatcher decides whether one address object (or group, or VIP) covers an IP.
type addrMatcher struct {
	addrs  map[string]FGAddress
	groups map[string][]string // addrgrp name → member names
	vips   map[string]string   // vip name → external IP / range, so a DNAT destination resolves
}

// matchAddr reports whether `name` covers ip. `unsure` is set when the object's membership cannot
// be decided from configuration alone (an FQDN needs DNS, a geography address needs the FortiGuard
// database, a dynamic address needs a live connector). Those are reported, never silently treated
// as a match or a miss.
func (m *addrMatcher) matchAddr(name string, ip net.IP, depth int) (matched bool, unsure string) {
	if depth > 8 { // a group cycle would otherwise recurse forever
		return false, ""
	}
	if members, ok := m.groups[name]; ok {
		for _, member := range members {
			ok, u := m.matchAddr(member, ip, depth+1)
			if ok {
				return true, ""
			}
			if u != "" && unsure == "" {
				unsure = u
			}
		}
		return false, unsure
	}
	if extIP, ok := m.vips[name]; ok {
		// A VIP in dstaddr means DNAT: the packet is addressed to the VIP's EXTERNAL address.
		return ipInRangeSpec(extIP, ip), ""
	}
	a, ok := m.addrs[name]
	if !ok {
		return false, fmt.Sprintf("address %q is not on the device", name)
	}
	switch strings.ToLower(a.Type) {
	case "ipmask", "interface-subnet":
		return ipInFGSubnet(a.Subnet, ip), ""
	case "iprange":
		return ipBetween(a.StartIP, a.EndIP, ip), ""
	case "fqdn":
		// Includes wildcard FQDN — FortiOS keeps "*.google.com" as type fqdn.
		return false, fmt.Sprintf("address %q is an FQDN (%s); matching it needs DNS, so it was treated as no-match", a.Name, a.FQDN)
	case "geography":
		return false, fmt.Sprintf("address %q is a geography object (%s); it was treated as no-match", a.Name, a.Country)
	case "dynamic":
		return false, fmt.Sprintf("address %q is a dynamic/fabric address; its members are not in the config, so it was treated as no-match", a.Name)
	case "mac":
		return false, "" // a MAC address never matches an IP tuple — not uncertainty, just a miss
	default:
		return false, fmt.Sprintf("address %q has unsupported type %q; it was treated as no-match", a.Name, a.Type)
	}
}

// ipInFGSubnet matches FortiOS's "10.0.1.0 255.255.255.0" (and the "10.0.1.0/24" the API sometimes
// returns instead).
func ipInFGSubnet(spec string, ip net.IP) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return false
	}
	if strings.Contains(spec, "/") {
		_, n, err := net.ParseCIDR(spec)
		return err == nil && n.Contains(ip)
	}
	parts := strings.Fields(spec)
	if len(parts) != 2 {
		return false
	}
	base := net.ParseIP(parts[0]).To4()
	mask := net.ParseIP(parts[1]).To4()
	v4 := ip.To4()
	if base == nil || mask == nil || v4 == nil {
		return false
	}
	for i := 0; i < 4; i++ {
		if base[i]&mask[i] != v4[i]&mask[i] {
			return false
		}
	}
	return true
}

func ipBetween(startIP, endIP string, ip net.IP) bool {
	s, e, v := net.ParseIP(strings.TrimSpace(startIP)).To4(), net.ParseIP(strings.TrimSpace(endIP)).To4(), ip.To4()
	if s == nil || v == nil {
		return false
	}
	if e == nil {
		e = s
	}
	return bytesCompare(v, s) >= 0 && bytesCompare(v, e) <= 0
}

// ipInRangeSpec matches a VIP's external address, which FortiOS writes either as a single IP or as
// "first-last".
func ipInRangeSpec(spec string, ip net.IP) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return false
	}
	if lo, hi, found := strings.Cut(spec, "-"); found {
		return ipBetween(lo, hi, ip)
	}
	return ipBetween(spec, spec, ip)
}

func bytesCompare(a, b net.IP) int {
	for i := range a {
		switch {
		case a[i] < b[i]:
			return -1
		case a[i] > b[i]:
			return 1
		}
	}
	return 0
}

// ── Service resolution ───────────────────────────────────────────────────────

type svcMatcher struct {
	services map[string]FGService
	groups   map[string][]string
}

// matchService reports whether `name` covers this protocol/port.
func (m *svcMatcher) matchService(name string, protocol, port int, depth int) (bool, string) {
	if depth > 8 {
		return false, ""
	}
	if members, ok := m.groups[name]; ok {
		for _, member := range members {
			if ok, _ := m.matchService(member, protocol, port, depth+1); ok {
				return true, ""
			}
		}
		return false, ""
	}
	s, ok := m.services[name]
	if !ok {
		return false, fmt.Sprintf("service %q is not on the device", name)
	}
	switch strings.ToUpper(s.Protocol) {
	case "IP":
		// protocol-number 0 is the "ALL" service: every IP protocol.
		return s.ProtocolNum == 0 || s.ProtocolNum == protocol, ""
	case "TCP/UDP/SCTP":
		switch protocol {
		case 6:
			return portInRanges(s.TCPPortRange, port), ""
		case 17:
			return portInRanges(s.UDPPortRange, port), ""
		case 132:
			return portInRanges(s.SCTPPortRange, port), ""
		}
		return false, ""
	case "ICMP":
		return protocol == 1, ""
	case "ICMP6":
		return protocol == 58, ""
	default:
		return false, fmt.Sprintf("service %q has unsupported protocol %q", name, s.Protocol)
	}
}

// portInRanges matches FortiOS's port-range syntax: space-separated entries, each "80", "80-90",
// or "dst:src" ("443:1024-65535") where only the destination side is compared here.
func portInRanges(spec string, port int) bool {
	for _, entry := range strings.Fields(spec) {
		dst, _, _ := strings.Cut(entry, ":")
		lo, hi, found := strings.Cut(dst, "-")
		low, err := strconv.Atoi(strings.TrimSpace(lo))
		if err != nil {
			continue
		}
		high := low
		if found {
			if h, err := strconv.Atoi(strings.TrimSpace(hi)); err == nil {
				high = h
			}
		}
		if port >= low && port <= high {
			return true
		}
	}
	return false
}

// ── Interface / zone resolution ──────────────────────────────────────────────

// intfMatches reports whether a policy's interface entry covers the real interface `actual`.
// "any" matches everything, and a zone matches when `actual` is one of its members.
func intfMatches(entry, actual string, zones map[string][]string) bool {
	if strings.EqualFold(entry, "any") || entry == "" {
		return true
	}
	if strings.EqualFold(entry, actual) {
		return true
	}
	for _, member := range zones[entry] {
		if strings.EqualFold(member, actual) {
			return true
		}
	}
	return false
}

// ── Schedule resolution ──────────────────────────────────────────────────────

type fgScheduleDetail struct {
	Name    string   `json:"name"`
	Type    string   // filled by the loader
	Start   string   `json:"start"`
	End     string   `json:"end"`
	Day     string   `json:"day"`
	Members []FGName `json:"member"`
}

// scheduleActive reports whether a policy's schedule permits traffic at `now` (device local time).
// A schedule that cannot be evaluated returns active=true with a note: refusing to match on an
// unreadable schedule would produce a confidently wrong "no policy matched".
func scheduleActive(name string, table map[string]fgScheduleDetail, now time.Time, depth int) (bool, string) {
	if name == "" || strings.EqualFold(name, "always") || depth > 4 {
		return true, ""
	}
	s, ok := table[name]
	if !ok {
		return true, fmt.Sprintf("schedule %q could not be read; it was treated as active", name)
	}
	switch s.Type {
	case "recurring":
		if s.Day != "" && !strings.Contains(strings.ToLower(s.Day), strings.ToLower(now.Format("Monday"))) {
			return false, ""
		}
		return withinClock(s.Start, s.End, now), ""
	case "onetime":
		start, err1 := time.ParseInLocation("15:04 2006/01/02", s.Start, now.Location())
		end, err2 := time.ParseInLocation("15:04 2006/01/02", s.End, now.Location())
		if err1 != nil || err2 != nil {
			return true, fmt.Sprintf("one-time schedule %q has an unreadable start/end; it was treated as active", name)
		}
		return !now.Before(start) && !now.After(end), ""
	case "group":
		var note string
		for _, m := range s.Members {
			active, n := scheduleActive(m.Name, table, now, depth+1)
			if active {
				return true, ""
			}
			if n != "" && note == "" {
				note = n
			}
		}
		return false, note
	}
	return true, ""
}

// withinClock compares "hh:mm" bounds, handling a window that crosses midnight (start > end).
func withinClock(start, end string, now time.Time) bool {
	toMin := func(s string) (int, bool) {
		h, m, ok := strings.Cut(strings.TrimSpace(s), ":")
		if !ok {
			return 0, false
		}
		hh, err1 := strconv.Atoi(h)
		mm, err2 := strconv.Atoi(m)
		if err1 != nil || err2 != nil {
			return 0, false
		}
		return hh*60 + mm, true
	}
	s, ok1 := toMin(start)
	e, ok2 := toMin(end)
	if !ok1 || !ok2 {
		return true
	}
	cur := now.Hour()*60 + now.Minute()
	if s <= e {
		return cur >= s && cur <= e
	}
	return cur >= s || cur <= e // wraps midnight
}

// ── Loaders ──────────────────────────────────────────────────────────────────

func (f *FortiClient) addressGroups() map[string][]string {
	out := map[string][]string{}
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/addrgrp?fields=name,member", nil)
	if err != nil {
		return out
	}
	var rows []struct {
		Name   string   `json:"name"`
		Member []FGName `json:"member"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		names := make([]string, 0, len(r.Member))
		for _, m := range r.Member {
			names = append(names, m.Name)
		}
		out[r.Name] = names
	}
	return out
}

func (f *FortiClient) serviceGroups() map[string][]string {
	out := map[string][]string{}
	resp, err := f.do("GET", "/api/v2/cmdb/firewall.service/group?fields=name,member", nil)
	if err != nil {
		return out
	}
	var rows []struct {
		Name   string   `json:"name"`
		Member []FGName `json:"member"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		names := make([]string, 0, len(r.Member))
		for _, m := range r.Member {
			names = append(names, m.Name)
		}
		out[r.Name] = names
	}
	return out
}

// zoneMembers maps a zone name to the interfaces it contains. A device with no zones (the lab
// unit) simply yields an empty map and every policy names a real interface.
func (f *FortiClient) zoneMembers() map[string][]string {
	out := map[string][]string{}
	resp, err := f.do("GET", "/api/v2/cmdb/system/zone?fields=name,interface", nil)
	if err != nil {
		return out
	}
	var rows []struct {
		Name      string   `json:"name"`
		Interface []FGName `json:"interface"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		names := make([]string, 0, len(r.Interface))
		for _, m := range r.Interface {
			names = append(names, m.Name)
		}
		out[r.Name] = names
	}
	return out
}

// vipExternalIPs maps each Virtual IP to its external address. The trace reads the full VIP list
// instead (it needs the mapped side for DNAT); the audit only needs this much.
func (f *FortiClient) vipExternalIPs() map[string]string {
	out := map[string]string{}
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/vip?fields=name,extip", nil)
	if err != nil {
		return out
	}
	var rows []struct {
		Name  string `json:"name"`
		ExtIP string `json:"extip"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		out[r.Name] = r.ExtIP
	}
	return out
}

// scheduleTable loads all three schedule tables into one map keyed by name.
func (f *FortiClient) scheduleTable() map[string]fgScheduleDetail {
	out := map[string]fgScheduleDetail{}
	for _, t := range []struct{ kind, path string }{
		{"recurring", "/api/v2/cmdb/firewall.schedule/recurring"},
		{"onetime", "/api/v2/cmdb/firewall.schedule/onetime"},
		{"group", "/api/v2/cmdb/firewall.schedule/group"},
	} {
		resp, err := f.do("GET", t.path, nil)
		if err != nil {
			continue
		}
		var rows []fgScheduleDetail
		if json.Unmarshal(resp.Results, &rows) != nil {
			continue
		}
		for _, r := range rows {
			r.Type = t.kind
			out[r.Name] = r
		}
	}
	return out
}

// DeviceLocalTime returns the firewall's own wall-clock time, which is what a schedule is measured
// against. monitor/system/time is a real UTC epoch (not local), so the CMDB timezone id has to be
// resolved and applied — see the timezone notes in fortigate_monitor.go.
func (f *FortiClient) DeviceLocalTime() time.Time {
	resp, err := f.do("GET", "/api/v2/monitor/system/time", nil)
	if err != nil {
		return time.Now().UTC()
	}
	var r struct {
		Time int64 `json:"time"`
	}
	if json.Unmarshal(resp.Results, &r) != nil || r.Time == 0 {
		return time.Now().UTC()
	}
	offset := 0
	if tzResp, err := f.do("GET", "/api/v2/cmdb/system/global?fields=timezone", nil); err == nil {
		var g struct {
			Timezone string `json:"timezone"`
		}
		if json.Unmarshal(tzResp.Results, &g) == nil {
			if _, secs, ok := f.resolveTimezone(g.Timezone); ok {
				offset = secs
			}
		}
	}
	return time.Unix(r.Time, 0).UTC().Add(time.Duration(offset) * time.Second)
}

// ── The trace ────────────────────────────────────────────────────────────────

// TracePolicyPath walks the firewall's policy table for one 5-tuple and reports which policy would
// claim the packet, plus why every policy above it did not — and, when it is blocked, the changes
// that would let it through (each one already simulated against the same table).
func (f *FortiClient) TracePolicyPath(q FGTraceQuery) (FGTraceResult, error) {
	res, env, err := f.traceWithEnv(q)
	if err == nil && env != nil {
		res.Fixes = planFixes(res, env)
	}
	return res, err
}

// traceEnv is everything one trace read off the device, kept so the fix planner and the what-if can
// work from the SAME reads as the verdict they are fixing, instead of reading the firewall again and
// possibly answering about a table that changed in between.
type traceEnv struct {
	policies  []FGPolicy
	addresses []FGAddress
	services  []FGService
	vipList   []FGVirtualIP
	in        traceInputs
}

// traceWithEnv is the trace itself. env is nil when the walk never ran (a bad tuple, no route).
func (f *FortiClient) traceWithEnv(q FGTraceQuery) (FGTraceResult, *traceEnv, error) {
	res := FGTraceResult{Query: q}

	srcIP := net.ParseIP(strings.TrimSpace(q.SrcIP))
	dstIP := net.ParseIP(strings.TrimSpace(q.DstIP))
	if srcIP == nil {
		return res, nil, fmt.Errorf("%q is not a valid source IP address", q.SrcIP)
	}
	if dstIP == nil {
		return res, nil, fmt.Errorf("%q is not a valid destination IP address", q.DstIP)
	}
	if q.Protocol <= 0 || q.Protocol > 255 {
		return res, nil, fmt.Errorf("protocol must be an IP protocol number between 1 and 255")
	}
	if (q.Protocol == 6 || q.Protocol == 17) && (q.DstPort < 1 || q.DstPort > 65535) {
		return res, nil, fmt.Errorf("destination port must be between 1 and 65535 for TCP/UDP")
	}

	// ── Where does it come in, where does it go out? ──
	//
	// The return path first: which interface the SOURCE is reached through, which is also where its
	// packets arrive — what a reverse-path check compares against.
	if in, err := f.RouterLookup(srcIP.String()); err == nil {
		res.IngressRoute = in
	}
	res.Ingress, res.IngressVia = strings.TrimSpace(q.SrcIntf), "user"
	if res.Ingress == "" {
		res.IngressVia = "route"
		res.Ingress = res.IngressRoute.Interface
	}

	// A Virtual IP is translated BEFORE the route lookup: FortiOS rewrites the destination to the
	// mapped server and routes toward that, so a VIP policy's dstintf is the server's interface.
	// Routing on the external address instead reported every inbound DNAT as "no policy matches"
	// (lab: 203.150.100.10:8080 → 192.168.1.100:80 on lan, policy 4 port1 → lan).
	// Best-effort: without the VIP list the trace routes on the address as given.
	vipList, _ := f.GetVirtualIPs()
	routeTo := dstIP
	if v := vipForDestination(vipList, dstIP, res.Ingress); v != nil {
		if mapped := net.ParseIP(firstOfRange(v.MappedIP)); mapped != nil {
			routeTo = mapped
			res.Notes = append(res.Notes, fmt.Sprintf(
				"%s is Virtual IP %s. The FortiGate translates it to %s before routing, so the outgoing interface is the one toward %s.",
				dstIP, v.Name, mapped, mapped))
		}
	}

	// Egress is the device's own routing answer; a guess computed from interface subnets is wrong
	// whenever a link is down (see RouterLookup's note).
	egress, err := f.RouterLookup(routeTo.String())
	if err != nil {
		return res, nil, fmt.Errorf("route lookup for %s failed: %w", routeTo, err)
	}
	res.EgressRoute = egress
	res.RouteTo = routeTo.String()
	res.Egress = egress.Interface
	res.Routable = egress.Success && egress.Interface != ""

	if !res.Routable {
		res.Verdict = "no-route"
		res.Summary = fmt.Sprintf("There is no route to %s — the packet is dropped at routing, before any policy is checked.", dstIP)
		return res, nil, nil
	}
	if res.Ingress == "" {
		res.Notes = append(res.Notes,
			fmt.Sprintf("The ingress interface of %s is not in the routing table — the policies' srcintf was not checked.", srcIP))
	}

	// ── Everything the walk compares against ──
	//
	// Ten independent reads, issued together. None of them feeds another — the walk below is what
	// combines them — so running them one at a time only made the user wait. The route lookups
	// above stay where they are: the "no-route" verdict returns before any of this, and fetching
	// the policy table for a packet that never reaches the policy engine would be wasted work.
	var (
		policies                     []FGPolicy
		addresses                    []FGAddress
		svcs                         []FGService
		policiesErr, addrErr, svcErr error
		addrGroups, svcGroups, zones map[string][]string
		links                        []FGInterfaceLink
		intfs                        []FGInterface
		schedules                    map[string]fgScheduleDetail
		stats                        map[int]FGPolicyStats
		now                          time.Time
	)
	Parallel(
		func() { policies, policiesErr = f.GetPolicies() },
		func() { addresses, addrErr = f.GetAddresses() },
		func() { svcs, svcErr = f.GetServices() },
		func() { addrGroups = f.addressGroups() },
		// Absent link state makes the answer less complete, not wrong — it is best-effort.
		func() { links, _ = f.InterfaceLinks() },
		// The CMDB's addresses, for the one the link table cannot give: a hardware switch has no
		// monitor row. Best-effort like the links — without it SNAT just carries no address.
		func() { intfs, _ = f.GetInterfaces() },
		func() { svcGroups = f.serviceGroups() },
		func() { zones = f.zoneMembers() },
		func() { schedules = f.scheduleTable() },
		func() { stats = f.GetPolicyStats() },
		func() { now = f.DeviceLocalTime() },
	)
	for _, err := range []error{policiesErr, addrErr, svcErr} {
		if err != nil {
			return res, nil, err
		}
	}

	vips := make(map[string]string, len(vipList))
	vipByName := make(map[string]FGVirtualIP, len(vipList))
	for _, v := range vipList {
		vips[v.Name] = v.ExtIP
		vipByName[v.Name] = v
	}
	am := &addrMatcher{addrs: map[string]FGAddress{}, groups: addrGroups, vips: vips}

	res.Total = len(policies)
	for i := range links {
		if links[i].Name == res.Ingress {
			res.IngressLink = &links[i]
		}
		if links[i].Name == res.Egress {
			res.EgressLink = &links[i]
		}
	}
	if res.IngressLink != nil && !res.IngressLink.Link {
		res.Notes = append(res.Notes, fmt.Sprintf("The ingress interface %q has no link (cable or port down).", res.Ingress))
	}
	if res.EgressLink != nil && !res.EgressLink.Link {
		res.Notes = append(res.Notes, fmt.Sprintf("The egress interface %q has no link (cable or port down).", res.Egress))
	}
	for _, a := range addresses {
		am.addrs[a.Name] = a
	}
	sm := &svcMatcher{services: map[string]FGService{}, groups: svcGroups}
	for _, s := range svcs {
		sm.services[s.Name] = s
	}

	seenNote := map[string]bool{}
	note := func(s string) {
		if s == "" || seenNote[s] {
			return
		}
		seenNote[s] = true
		res.Notes = append(res.Notes, s)
	}

	in := traceInputs{
		q: q, srcIP: srcIP, dstIP: dstIP, am: am, sm: sm, zones: zones, schedules: schedules,
		now: now, stats: stats, vips: vipByName, note: note,
		egressIP: interfaceAddress(intfs, res.Egress),
	}
	walkPolicyTable(&res, policies, in)
	// The note hook appends to THIS res; a later walk over the same inputs brings its own.
	in.note = nil
	return res, &traceEnv{policies: policies, addresses: addresses, services: svcs, vipList: vipList, in: in}, nil
}

// traceInputs is everything the walk compares a policy against, already read from the device.
type traceInputs struct {
	q            FGTraceQuery
	srcIP, dstIP net.IP
	am           *addrMatcher
	sm           *svcMatcher
	zones        map[string][]string
	schedules    map[string]fgScheduleDetail
	now          time.Time
	stats        map[int]FGPolicyStats
	vips         map[string]FGVirtualIP
	note         func(string)
	// egressIP is the egress interface's configured address from the CMDB — the fallback for the
	// SNAT address when the link table has no row for that interface (a hardware switch).
	egressIP string
}

// walkPolicyTable is the walk itself: FortiOS evaluates the table top-down and the FIRST match
// wins. Pure over its inputs, so the verdict, the shadowed rules and the closest rule are tested
// against the lab's own policy table without a device.
//
// Every policy is checked in full, including the ones below the match: the verdict is still the
// first match's, but the ones below are what can show a rule-order problem (see Shadowed).
func walkPolicyTable(res *FGTraceResult, policies []FGPolicy, in traceInputs) {
	note := in.note
	if note == nil {
		note = func(string) {}
	}
	matchIndex := -1
	var near []FGPolicyVerdict
	for i, p := range policies {
		v := FGPolicyVerdict{
			PolicyID: p.PolicyID, Name: p.Name, Action: p.Action,
			Enabled: !strings.EqualFold(p.Status, "disable"),
			SrcIntf: fgNames(p.SrcIntf), DstIntf: fgNames(p.DstIntf),
			SrcAddr: fgNames(p.SrcAddr), DstAddr: fgNames(p.DstAddr),
			Service:  fgNames(p.Service),
			Schedule: p.Schedule,
			NAT:      strings.EqualFold(p.NAT, "enable"),
			UTM:      strings.EqualFold(p.UTMStatus, "enable"),
			Profiles: policyProfiles(p),
		}
		if st, ok := in.stats[p.PolicyID]; ok {
			v.Bytes, v.Packets, v.ActiveSessions = st.Bytes, st.Packets, st.ActiveSessions
		}
		v.Checks = policyChecks(p, in.q, in.srcIP, in.dstIP, res.Ingress, res.Egress, in.am, in.sm, in.zones, in.schedules, in.now)
		v.Failed = failedChecks(v.Checks)

		if matchIndex >= 0 {
			// Past the match: only worth reporting if it would ALSO have matched.
			if v.Failed == 0 {
				v.Reason = fmt.Sprintf("never reached — policy %d above it matches first", res.Matched.PolicyID)
				res.Shadowed = append(res.Shadowed, v)
			}
			continue
		}

		reason, unsure := firstFailure(v.Checks)
		for _, u := range unsure {
			note(u)
		}
		if reason != "" {
			v.Reason = reason
			res.Evaluated = append(res.Evaluated, v)
			if strings.EqualFold(p.Action, "accept") {
				near = append(near, v)
			}
			continue
		}

		v.Matched = true
		res.Evaluated = append(res.Evaluated, v)
		matched := v
		res.Matched = &matched
		matchIndex = i
		res.Below = len(policies) - i - 1
		// The live link's address first — it is what the interface holds right now, DHCP included —
		// and the configured one when the link table has no row for it.
		egressIP := in.egressIP
		if res.EgressLink != nil && res.EgressLink.IP != "" {
			egressIP = res.EgressLink.IP
		}
		if strings.EqualFold(p.Action, "accept") {
			res.Verdict = "allowed"
			res.SNAT = traceSNAT(p, egressIP)
			res.DNAT = traceDNAT(p, in.dstIP, in.vips)
			res.Summary = fmt.Sprintf("Policy %d (%s) allows it, leaving through %s%s.",
				p.PolicyID, p.Name, res.Egress, natSuffix(v.NAT))
		} else {
			res.Verdict = "denied"
			res.Summary = fmt.Sprintf("Policy %d (%s) blocks it.", p.PolicyID, p.Name)
		}
	}
	if matchIndex >= 0 {
		return
	}

	// Nothing claimed the packet: FortiOS drops it on the implicit deny at the bottom of the table.
	res.Verdict = "implicit-deny"
	res.Below = 0
	res.Closest = closestPolicies(near, 2, 3)
	res.Summary = fmt.Sprintf("No policy matches %s → %s leaving through %s, so the implicit deny at the bottom of the table drops it.",
		in.srcIP, in.dstIP, res.Egress)
}

// fixWeight ranks a failed criterion by how plausible "that is the fix" is. Turning a disabled rule
// on is the likeliest answer; a service or schedule is a small edit; an address object usually
// means a missing member; a different interface pair means the rule was written for another path
// entirely, so it ranks last.
var fixWeight = map[string]int{
	CheckStatus: 0, CheckService: 1, CheckSchedule: 1, CheckDstAddr: 2, CheckSrcAddr: 2,
	CheckDstIntf: 3, CheckSrcIntf: 3,
}

func fixCost(v FGPolicyVerdict) int {
	n := 0
	for _, c := range v.Checks {
		if !c.OK {
			n += fixWeight[c.Field]
		}
	}
	return n
}

// closestPolicies keeps the candidates tied at the fewest failed checks, if that is at most
// maxFailed — ordered by how plausible each fix is, then table order — capped at limit.
func closestPolicies(candidates []FGPolicyVerdict, maxFailed, limit int) []FGPolicyVerdict {
	best := maxFailed + 1
	for _, c := range candidates {
		if c.Failed < best {
			best = c.Failed
		}
	}
	if best > maxFailed {
		return nil
	}
	var tied []FGPolicyVerdict
	for _, c := range candidates {
		if c.Failed == best {
			tied = append(tied, c)
		}
	}
	sort.SliceStable(tied, func(i, j int) bool { return fixCost(tied[i]) < fixCost(tied[j]) })
	if len(tied) > limit {
		tied = tied[:limit]
	}
	return tied
}

// vipForDestination finds the Virtual IP a packet to dst is addressed to, honouring the VIP's
// external interface when it names one and the ingress is known.
func vipForDestination(vips []FGVirtualIP, dst net.IP, ingress string) *FGVirtualIP {
	for i := range vips {
		v := &vips[i]
		if v.ExtIP == "" || !ipInRangeSpec(v.ExtIP, dst) {
			continue
		}
		extIntf := strings.TrimSpace(v.Interface)
		if extIntf != "" && extIntf != "any" && ingress != "" && extIntf != ingress {
			continue
		}
		return v
	}
	return nil
}

// firstOfRange is the first address of "a-b", or the address itself.
func firstOfRange(spec string) string {
	if i := strings.Index(spec, "-"); i > 0 {
		return strings.TrimSpace(spec[:i])
	}
	return strings.TrimSpace(spec)
}

func natSuffix(nat bool) string {
	if nat {
		return " with source NAT"
	}
	return " without NAT"
}

// policyMismatch returns the FIRST reason this policy does not claim the packet, or "" if it does.
// It is the first failed check of policyChecks, so the order is how a person checks a rule: is it
// even on, then interfaces, then addresses, then service, then schedule.
func policyMismatch(
	p FGPolicy, q FGTraceQuery, srcIP, dstIP net.IP, ingress, egress string,
	am *addrMatcher, sm *svcMatcher, zones map[string][]string,
	schedules map[string]fgScheduleDetail, now time.Time,
) (reason string, unsure []string) {
	return firstFailure(policyChecks(p, q, srcIP, dstIP, ingress, egress, am, sm, zones, schedules, now))
}

func anyIntfMatches(entries []FGName, actual string, zones map[string][]string) bool {
	for _, e := range entries {
		if intfMatches(e.Name, actual, zones) {
			return true
		}
	}
	return len(entries) == 0
}

func anyAddrMatches(am *addrMatcher, entries []FGName, ip net.IP) (bool, []string) {
	var unsure []string
	for _, e := range entries {
		ok, u := am.matchAddr(e.Name, ip, 0)
		if u != "" {
			unsure = append(unsure, u)
		}
		if ok {
			return true, unsure
		}
	}
	return false, unsure
}

func fgNames(list []FGName) []string {
	out := make([]string, 0, len(list))
	for _, n := range list {
		out = append(out, n.Name)
	}
	return out
}

func quoteList(names []string) string {
	if len(names) == 0 {
		return "(empty)"
	}
	quoted := make([]string, len(names))
	for i, n := range names {
		quoted[i] = strconv.Quote(n)
	}
	return strings.Join(quoted, ", ")
}

func protoPortLabel(protocol, port int) string {
	switch protocol {
	case 1:
		return "ICMP"
	case 6:
		return fmt.Sprintf("TCP/%d", port)
	case 17:
		return fmt.Sprintf("UDP/%d", port)
	case 58:
		return "ICMPv6"
	default:
		return fmt.Sprintf("IP protocol %d", protocol)
	}
}

// policyProfiles lists the security profiles a policy applies, so the trace can say "allowed, and
// inspected by these" — or, more usefully, "allowed with no inspection at all".
func policyProfiles(p FGPolicy) []string {
	if !strings.EqualFold(p.UTMStatus, "enable") {
		return nil
	}
	// Listed in the order the FortiGate GUI shows them, not map order — the trace renders this
	// verbatim and a shuffling list would look like the config kept changing.
	pairs := []struct{ label, name string }{
		{"AntiVirus", p.AVProfile}, {"Web Filter", p.WebFilterProfile}, {"DNS Filter", p.DNSFilterProfile},
		{"App Control", p.AppList}, {"IPS", p.IPSSensor}, {"File Filter", p.FileFilterProfile},
		{"SSL/SSH", p.SSLSSHProfile},
	}
	var out []string
	for _, p := range pairs {
		if p.name != "" {
			out = append(out, p.label+": "+p.name)
		}
	}
	return out
}

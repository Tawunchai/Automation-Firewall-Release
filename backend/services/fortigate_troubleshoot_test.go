package services

import (
	"net"
	"strings"
	"testing"
	"time"
)

// The policy trace tells a user whether their traffic is allowed. Every rule it applies is pinned
// here, because a matcher that is subtly wrong is worse than no matcher: it answers confidently.
//
// The fixtures are the LAB DEVICE's real tables (FortiGate 80E, FortiOS 7.2.10) — the same address,
// service and policy objects the live verification runs against, so a change that breaks the real
// answer breaks a test here too.

func ip(s string) net.IP { return net.ParseIP(s) }

// ── Address matching ─────────────────────────────────────────────────────────

func TestIPInFGSubnet(t *testing.T) {
	cases := []struct {
		spec, addr string
		want       bool
	}{
		// FortiOS's native "network mask" form.
		{"192.168.1.0 255.255.255.0", "192.168.1.50", true},
		{"192.168.1.0 255.255.255.0", "192.168.2.50", false},
		{"192.168.10.100 255.255.255.255", "192.168.10.100", true},
		{"192.168.10.100 255.255.255.255", "192.168.10.101", false},
		// "all" — the object every policy defaults to.
		{"0.0.0.0 0.0.0.0", "8.8.8.8", true},
		{"0.0.0.0 0.0.0.0", "10.0.0.1", true},
		// The API sometimes hands back CIDR instead; both have to work.
		{"10.0.1.0/24", "10.0.1.5", true},
		{"10.0.1.0/24", "10.0.2.5", false},
		{"", "10.0.1.5", false},
		{"garbage", "10.0.1.5", false},
	}
	for _, c := range cases {
		if got := ipInFGSubnet(c.spec, ip(c.addr)); got != c.want {
			t.Errorf("ipInFGSubnet(%q, %s) = %v, want %v", c.spec, c.addr, got, c.want)
		}
	}
}

func TestIPBetweenAndRangeSpec(t *testing.T) {
	// SSLVPN_TUNNEL_ADDR1 on the lab device.
	if !ipBetween("10.212.134.200", "10.212.134.210", ip("10.212.134.205")) {
		t.Error("address inside an iprange should match")
	}
	if ipBetween("10.212.134.200", "10.212.134.210", ip("10.212.134.211")) {
		t.Error("address past the end of an iprange must not match")
	}
	// A VIP's external address is either a single IP or "first-last".
	if !ipInRangeSpec("10.0.99.50", ip("10.0.99.50")) {
		t.Error("single-IP VIP should match itself")
	}
	if !ipInRangeSpec("10.0.99.50-10.0.99.60", ip("10.0.99.55")) {
		t.Error("VIP range should match an address inside it")
	}
	if ipInRangeSpec("10.0.99.50-10.0.99.60", ip("10.0.99.61")) {
		t.Error("VIP range must not match an address outside it")
	}
}

func labAddrMatcher() *addrMatcher {
	return &addrMatcher{
		addrs: map[string]FGAddress{
			"all":                 {Name: "all", Type: "ipmask", Subnet: "0.0.0.0 0.0.0.0"},
			"LAN-Network":         {Name: "LAN-Network", Type: "ipmask", Subnet: "192.168.1.0 255.255.255.0"},
			"Guest-WiFi-Subnet":   {Name: "Guest-WiFi-Subnet", Type: "ipmask", Subnet: "10.10.20.0 255.255.255.0"},
			"Host-192.168.10.100": {Name: "Host-192.168.10.100", Type: "ipmask", Subnet: "192.168.10.100 255.255.255.255"},
			"lan":                 {Name: "lan", Type: "interface-subnet", Subnet: "192.168.1.0 255.255.255.0"},
			"SSLVPN_TUNNEL_ADDR1": {Name: "SSLVPN_TUNNEL_ADDR1", Type: "iprange", StartIP: "10.212.134.200", EndIP: "10.212.134.210"},
			"wildcard.google.com": {Name: "wildcard.google.com", Type: "fqdn", FQDN: "*.google.com"},
			"gmail.com":           {Name: "gmail.com", Type: "fqdn", FQDN: "gmail.com"},
			"EMS_ALL_UNKNOWN":     {Name: "EMS_ALL_UNKNOWN", Type: "dynamic"},
		},
		groups: map[string][]string{
			"G Suite": {"gmail.com", "wildcard.google.com"},
			"Mixed":   {"gmail.com", "LAN-Network"},
		},
		vips: map[string]string{"Web_Server_VIP": "10.0.99.80"},
	}
}

func TestMatchAddr(t *testing.T) {
	m := labAddrMatcher()

	t.Run("subnet and host objects", func(t *testing.T) {
		if ok, _ := m.matchAddr("LAN-Network", ip("192.168.1.50"), 0); !ok {
			t.Error("192.168.1.50 should be inside LAN-Network")
		}
		if ok, _ := m.matchAddr("Host-192.168.10.100", ip("192.168.1.50"), 0); ok {
			t.Error("a /32 host object must not match a different address")
		}
		if ok, _ := m.matchAddr("all", ip("8.8.8.8"), 0); !ok {
			t.Error(`"all" must match everything`)
		}
	})

	t.Run("interface-subnet behaves like ipmask", func(t *testing.T) {
		if ok, _ := m.matchAddr("lan", ip("192.168.1.9"), 0); !ok {
			t.Error("interface-subnet should match inside its network")
		}
	})

	t.Run("a group matches when any member does", func(t *testing.T) {
		if ok, _ := m.matchAddr("Mixed", ip("192.168.1.50"), 0); !ok {
			t.Error("group should match through its LAN-Network member")
		}
	})

	// An FQDN cannot be resolved from configuration, and quietly calling it "no match" would let the
	// trace claim a policy does not apply when it might. The uncertainty is surfaced instead.
	t.Run("an FQDN is reported as undecidable, not silently missed", func(t *testing.T) {
		ok, unsure := m.matchAddr("wildcard.google.com", ip("142.250.0.1"), 0)
		if ok {
			t.Error("an FQDN must not be claimed as a match")
		}
		if unsure == "" {
			t.Error("an FQDN must produce a note explaining why it was skipped")
		}
	})

	t.Run("a dynamic/fabric address is reported the same way", func(t *testing.T) {
		if _, unsure := m.matchAddr("EMS_ALL_UNKNOWN", ip("10.0.0.1"), 0); unsure == "" {
			t.Error("a dynamic address must produce a note")
		}
	})

	// A VIP is a DNAT object, and it is the DESTINATION a policy names for inbound traffic. The lab
	// device's "Web-Server" policy does exactly this — ignoring VIPs would report "no policy
	// matched" for every port forward on the box.
	t.Run("a VIP matches on its external address", func(t *testing.T) {
		if ok, _ := m.matchAddr("Web_Server_VIP", ip("10.0.99.80"), 0); !ok {
			t.Error("a VIP should match traffic addressed to its external IP")
		}
		if ok, _ := m.matchAddr("Web_Server_VIP", ip("10.0.99.81"), 0); ok {
			t.Error("a VIP must not match a different address")
		}
	})

	t.Run("an unknown name is reported rather than assumed", func(t *testing.T) {
		ok, unsure := m.matchAddr("Not-On-Device", ip("10.0.0.1"), 0)
		if ok || unsure == "" {
			t.Error("an address the device does not have should be a miss WITH a note")
		}
	})

	// A group that contains itself would otherwise recurse until the stack gives out.
	t.Run("a group cycle terminates", func(t *testing.T) {
		cyc := &addrMatcher{
			addrs:  map[string]FGAddress{},
			groups: map[string][]string{"A": {"B"}, "B": {"A"}},
			vips:   map[string]string{},
		}
		done := make(chan bool, 1)
		go func() {
			cyc.matchAddr("A", ip("10.0.0.1"), 0)
			done <- true
		}()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("matchAddr did not terminate on a cyclic group")
		}
	})
}

// ── Service matching ─────────────────────────────────────────────────────────

func TestPortInRanges(t *testing.T) {
	cases := []struct {
		spec string
		port int
		want bool
	}{
		{"443", 443, true},
		{"443", 80, false},
		{"80 443 8080-8090", 8085, true},
		{"80 443 8080-8090", 8091, false},
		{"1-65535", 12345, true},
		{"", 443, false},
		// FortiOS may write "dst:src" — only the destination side is compared.
		{"443:1024-65535", 443, true},
		{"443:1024-65535", 1024, false},
	}
	for _, c := range cases {
		if got := portInRanges(c.spec, c.port); got != c.want {
			t.Errorf("portInRanges(%q, %d) = %v, want %v", c.spec, c.port, got, c.want)
		}
	}
}

func labSvcMatcher() *svcMatcher {
	return &svcMatcher{
		services: map[string]FGService{
			// The lab device's real definitions.
			"ALL":       {Name: "ALL", Protocol: "IP", ProtocolNum: 0},
			"HTTP":      {Name: "HTTP", Protocol: "TCP/UDP/SCTP", TCPPortRange: "80"},
			"HTTPS":     {Name: "HTTPS", Protocol: "TCP/UDP/SCTP", TCPPortRange: "443"},
			"DNS":       {Name: "DNS", Protocol: "TCP/UDP/SCTP", TCPPortRange: "53", UDPPortRange: "53"},
			"ALL_TCP":   {Name: "ALL_TCP", Protocol: "TCP/UDP/SCTP", TCPPortRange: "1-65535"},
			"ALL_ICMP":  {Name: "ALL_ICMP", Protocol: "ICMP"},
			"App-Voice": {Name: "App-Voice", Protocol: "TCP/UDP/SCTP", UDPPortRange: "5000"},
			"GRE":       {Name: "GRE", Protocol: "IP", ProtocolNum: 47},
		},
		groups: map[string][]string{"Email Access": {"DNS", "IMAP"}},
	}
}

func TestMatchService(t *testing.T) {
	m := labSvcMatcher()

	// "ALL" is protocol IP with protocol-number 0, which means every protocol — not "TCP any port".
	t.Run("ALL covers every protocol", func(t *testing.T) {
		for _, proto := range []int{1, 6, 17, 47} {
			if ok, _ := m.matchService("ALL", proto, 443, 0); !ok {
				t.Errorf("ALL should cover protocol %d", proto)
			}
		}
	})

	t.Run("an IP service with a protocol number covers only that protocol", func(t *testing.T) {
		if ok, _ := m.matchService("GRE", 47, 0, 0); !ok {
			t.Error("GRE should match protocol 47")
		}
		if ok, _ := m.matchService("GRE", 6, 443, 0); ok {
			t.Error("GRE must not match TCP")
		}
	})

	t.Run("TCP and UDP sides are kept apart", func(t *testing.T) {
		if ok, _ := m.matchService("HTTPS", 6, 443, 0); !ok {
			t.Error("HTTPS should match TCP/443")
		}
		if ok, _ := m.matchService("HTTPS", 17, 443, 0); ok {
			t.Error("HTTPS has no UDP ports, so UDP/443 must not match")
		}
		if ok, _ := m.matchService("DNS", 17, 53, 0); !ok {
			t.Error("DNS should match UDP/53")
		}
		if ok, _ := m.matchService("App-Voice", 17, 5000, 0); !ok {
			t.Error("App-Voice should match UDP/5000")
		}
		if ok, _ := m.matchService("App-Voice", 6, 5000, 0); ok {
			t.Error("App-Voice has no TCP ports, so TCP/5000 must not match")
		}
	})

	t.Run("ICMP services ignore ports", func(t *testing.T) {
		if ok, _ := m.matchService("ALL_ICMP", 1, 0, 0); !ok {
			t.Error("ALL_ICMP should match protocol 1")
		}
		if ok, _ := m.matchService("ALL_ICMP", 6, 443, 0); ok {
			t.Error("ALL_ICMP must not match TCP")
		}
	})

	t.Run("a service group matches through its members", func(t *testing.T) {
		if ok, _ := m.matchService("Email Access", 17, 53, 0); !ok {
			t.Error("group should match through DNS")
		}
		if ok, _ := m.matchService("Email Access", 6, 8080, 0); ok {
			t.Error("group must not match a port none of its members carries")
		}
	})

	t.Run("an unknown service is reported", func(t *testing.T) {
		if ok, note := m.matchService("Nope", 6, 443, 0); ok || note == "" {
			t.Error("an unknown service should be a miss with a note")
		}
	})
}

// ── Interface / zone matching ────────────────────────────────────────────────

func TestIntfMatches(t *testing.T) {
	zones := map[string][]string{"internal": {"lan", "dmz"}}
	cases := []struct {
		entry, actual string
		want          bool
	}{
		{"lan", "lan", true},
		{"lan", "port1", false},
		{"any", "anything", true},
		{"", "anything", true},
		{"LAN", "lan", true}, // FortiOS interface names are matched case-insensitively here
		{"internal", "dmz", true},
		{"internal", "port1", false},
	}
	for _, c := range cases {
		if got := intfMatches(c.entry, c.actual, zones); got != c.want {
			t.Errorf("intfMatches(%q, %q) = %v, want %v", c.entry, c.actual, got, c.want)
		}
	}
}

// ── Schedules ────────────────────────────────────────────────────────────────

func TestScheduleActive(t *testing.T) {
	// Wednesday 2026-08-05, 14:30 device local.
	now := time.Date(2026, 8, 5, 14, 30, 0, 0, time.UTC)
	table := map[string]fgScheduleDetail{
		"office-hours": {Name: "office-hours", Type: "recurring", Day: "monday tuesday wednesday thursday friday", Start: "08:00", End: "17:00"},
		"weekend":      {Name: "weekend", Type: "recurring", Day: "saturday sunday", Start: "00:00", End: "23:59"},
		"night":        {Name: "night", Type: "recurring", Day: "wednesday", Start: "22:00", End: "06:00"},
		"maintenance":  {Name: "maintenance", Type: "onetime", Start: "00:00 2026/08/01", End: "23:59 2026/08/31"},
		"expired":      {Name: "expired", Type: "onetime", Start: "00:00 2020/01/01", End: "23:59 2020/01/02"},
		"either":       {Name: "either", Type: "group", Members: []FGName{{Name: "weekend"}, {Name: "office-hours"}}},
		"neither":      {Name: "neither", Type: "group", Members: []FGName{{Name: "weekend"}, {Name: "expired"}}},
	}

	check := func(name string, want bool) {
		t.Helper()
		if got, _ := scheduleActive(name, table, now, 0); got != want {
			t.Errorf("scheduleActive(%q) = %v, want %v", name, got, want)
		}
	}

	check("", true)       // no schedule set
	check("always", true) // the built-in
	check("office-hours", true)
	check("weekend", false) // right time, wrong day
	check("maintenance", true)
	check("expired", false)
	check("either", true)
	check("neither", false)

	// A window that crosses midnight (22:00–06:00) must not be read as "22:00 to 06:00 the same
	// morning", which would make it permanently inactive.
	check("night", false) // 14:30 is outside
	lateNight := time.Date(2026, 8, 5, 23, 30, 0, 0, time.UTC)
	if got, _ := scheduleActive("night", table, lateNight, 0); !got {
		t.Error("a schedule crossing midnight should be active at 23:30")
	}

	// An unreadable schedule must NOT silently block the match — that would produce a confident
	// "no policy matched" for a policy that actually applies.
	active, note := scheduleActive("does-not-exist", table, now, 0)
	if !active || note == "" {
		t.Error("an unknown schedule should be treated as active AND explained")
	}
}

func TestWithinClock(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 8, 5, h, m, 0, 0, time.UTC) }
	if !withinClock("08:00", "17:00", at(8, 0)) {
		t.Error("the start boundary should be inside the window")
	}
	if !withinClock("08:00", "17:00", at(17, 0)) {
		t.Error("the end boundary should be inside the window")
	}
	if withinClock("08:00", "17:00", at(17, 1)) {
		t.Error("one minute past the end should be outside")
	}
	if !withinClock("garbage", "17:00", at(3, 0)) {
		t.Error("an unparsable window should fail open, not block everything")
	}
}

// ── The walk ─────────────────────────────────────────────────────────────────

// labPolicies is the lab device's real table, in its real order (verified live).
func labPolicies() []FGPolicy {
	n := func(names ...string) []FGName {
		out := make([]FGName, len(names))
		for i, s := range names {
			out[i] = FGName{Name: s}
		}
		return out
	}
	return []FGPolicy{
		{PolicyID: 2, Name: "Testing-Policy-Object", Status: "enable", SrcIntf: n("lan"), DstIntf: n("wan1"),
			SrcAddr: n("all"), DstAddr: n("all"), Service: n("ALL"), Action: "accept", NAT: "enable", Schedule: "always"},
		{PolicyID: 6, Name: "Guest-WiFi-Access", Status: "enable", SrcIntf: n("dmz"), DstIntf: n("port1"),
			SrcAddr: n("Guest-WiFi-Subnet"), DstAddr: n("all"), Service: n("HTTP", "HTTPS", "DNS", "App-Voice"),
			Action: "accept", NAT: "enable", Schedule: "always", UTMStatus: "enable", AVProfile: "default"},
		{PolicyID: 5, Name: "Test-DMZ-to-WAN", Status: "enable", SrcIntf: n("dmz"), DstIntf: n("port1"),
			SrcAddr: n("all"), DstAddr: n("all"), Service: n("ALL"), Action: "accept", NAT: "enable", Schedule: "always"},
		{PolicyID: 7, Name: "Host-10100-to-Internet", Status: "enable", SrcIntf: n("lan"), DstIntf: n("port1"),
			SrcAddr: n("Host-192.168.10.100"), DstAddr: n("all"), Service: n("ALL"), Action: "accept", NAT: "enable", Schedule: "always"},
		{PolicyID: 1, Name: "default", Status: "enable", SrcIntf: n("lan"), DstIntf: n("port1"),
			SrcAddr: n("all"), DstAddr: n("all"), Service: n("ALL"), Action: "accept", NAT: "enable", Schedule: "always"},
	}
}

func walk(t *testing.T, policies []FGPolicy, q FGTraceQuery, ingress, egress string) (matched *FGPolicy, reasons map[int]string) {
	t.Helper()
	am, sm := labAddrMatcher(), labSvcMatcher()
	zones := map[string][]string{}
	schedules := map[string]fgScheduleDetail{}
	now := time.Date(2026, 8, 5, 14, 30, 0, 0, time.UTC)
	reasons = map[int]string{}
	for i := range policies {
		p := policies[i]
		reason, _ := policyMismatch(p, q, ip(q.SrcIP), ip(q.DstIP), ingress, egress, am, sm, zones, schedules, now)
		if reason == "" {
			return &p, reasons
		}
		reasons[p.PolicyID] = reason
	}
	return nil, reasons
}

// ⚠️ THE ORACLE. `diagnose firewall iprope lookup 192.168.1.50 1024 8.8.8.8 443 6 lan` on the lab
// device answers "matches policy id: 1". Anything else here means this matcher disagrees with the
// firewall it is supposed to explain.
func TestTraceMatchesTheDeviceAnswer(t *testing.T) {
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	matched, reasons := walk(t, labPolicies(), q, "lan", "port1")
	if matched == nil {
		t.Fatalf("expected policy 1 to match, got no match. reasons: %v", reasons)
	}
	if matched.PolicyID != 1 {
		t.Fatalf("expected policy 1 (the device's own answer), got %d (%s)", matched.PolicyID, matched.Name)
	}

	// And the reasons the earlier policies were passed over must be the real ones — this is the
	// column the user reads.
	if reasons[2] == "" {
		t.Error("policy 2 (lan→wan1) should be rejected: the egress is port1, not wan1")
	}
	if reasons[6] == "" || reasons[5] == "" {
		t.Error("the dmz policies should be rejected on srcintf")
	}
	if reasons[7] == "" {
		t.Error("policy 7 should be rejected: its srcaddr is a single host, not 192.168.1.50")
	}
}

func TestTraceFirstMatchWins(t *testing.T) {
	// From the host the narrow policy 7 is written for, policy 7 claims the packet — not the broad
	// "default" below it. That is the whole point of a top-down table.
	q := FGTraceQuery{SrcIP: "192.168.10.100", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	matched, _ := walk(t, labPolicies(), q, "lan", "port1")
	if matched == nil || matched.PolicyID != 7 {
		t.Fatalf("expected the narrower policy 7 to win, got %v", matched)
	}
}

func TestTraceDisabledPolicyIsSkipped(t *testing.T) {
	policies := labPolicies()
	for i := range policies {
		if policies[i].PolicyID == 1 {
			policies[i].Status = "disable"
		}
	}
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	matched, reasons := walk(t, policies, q, "lan", "port1")
	if matched != nil {
		t.Fatalf("with policy 1 disabled nothing should match, got %d", matched.PolicyID)
	}
	if reasons[1] == "" {
		t.Error("a disabled policy should be reported as such, not silently dropped")
	}
}

func TestTraceServiceMismatchIsExplained(t *testing.T) {
	// Guest subnet on UDP/9999: policy 6 lists it by interface and address but not by service.
	q := FGTraceQuery{SrcIP: "10.10.20.5", DstIP: "8.8.8.8", Protocol: 17, DstPort: 9999}
	policies := []FGPolicy{labPolicies()[1]} // just Guest-WiFi-Access
	matched, reasons := walk(t, policies, q, "dmz", "port1")
	if matched != nil {
		t.Fatal("UDP/9999 is not in HTTP/HTTPS/DNS/App-Voice, so nothing should match")
	}
	if reasons[6] == "" {
		t.Error("the service mismatch should be the stated reason")
	}
}

func TestTraceUsesTheRightRejectionReason(t *testing.T) {
	// The order of checks matters: a policy that fails on BOTH interface and address should be
	// reported on the interface, because that is what the engineer looks at first.
	q := FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443}
	am, sm := labAddrMatcher(), labSvcMatcher()
	guest := labPolicies()[1] // dmz → port1, srcaddr Guest-WiFi-Subnet
	reason, _ := policyMismatch(guest, q, ip(q.SrcIP), ip(q.DstIP), "lan", "port1",
		am, sm, map[string][]string{}, map[string]fgScheduleDetail{}, time.Now())
	if reason == "" {
		t.Fatal("expected a rejection")
	}
	if !strings.Contains(reason, "srcintf") {
		t.Errorf("expected the interface to be blamed first, got %q", reason)
	}
}

func TestPolicyProfilesOnlyWhenUTMIsOn(t *testing.T) {
	p := FGPolicy{UTMStatus: "disable", AVProfile: "default", WebFilterProfile: "monitor-all"}
	if got := policyProfiles(p); got != nil {
		t.Errorf("a policy with utm-status disable applies no profiles, got %v", got)
	}
	p.UTMStatus = "enable"
	got := policyProfiles(p)
	if len(got) != 2 || got[0] != "AntiVirus: default" || got[1] != "Web Filter: monitor-all" {
		t.Errorf("profiles should be listed in GUI order, got %v", got)
	}
}

func TestProtoPortLabel(t *testing.T) {
	cases := map[string]string{
		protoPortLabel(6, 443): "TCP/443",
		protoPortLabel(17, 53): "UDP/53",
		protoPortLabel(1, 0):   "ICMP",
		protoPortLabel(47, 0):  "IP protocol 47",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}

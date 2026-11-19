package services

import (
	"testing"
)

// The audit tells an admin their firewall has a hole. A false positive costs trust and gets the
// whole feature ignored; a false negative is a hole nobody looks at. Both directions are pinned.

func names(ns ...string) []FGName {
	out := make([]FGName, len(ns))
	for i, n := range ns {
		out[i] = FGName{Name: n}
	}
	return out
}

// ── IP range arithmetic ──────────────────────────────────────────────────────

func TestFGSubnetRange(t *testing.T) {
	r, ok := fgSubnetRange("192.168.1.0 255.255.255.0")
	if !ok {
		t.Fatal("a mask-form subnet should parse")
	}
	lo, _ := ipToU32(ip("192.168.1.0"))
	hi, _ := ipToU32(ip("192.168.1.255"))
	if r.Lo != lo || r.Hi != hi {
		t.Errorf("got %v-%v, want %v-%v", r.Lo, r.Hi, lo, hi)
	}

	// "all" — the object almost every policy uses.
	all, ok := fgSubnetRange("0.0.0.0 0.0.0.0")
	if !ok || all.Lo != 0 || all.Hi != ^uint32(0) {
		t.Errorf(`"all" should expand to the whole IPv4 space, got %v`, all)
	}

	// A /32 host is a one-address range, not an error.
	h, ok := fgSubnetRange("10.0.0.5 255.255.255.255")
	if !ok || h.Lo != h.Hi {
		t.Errorf("a /32 should be a single address, got %v", h)
	}

	if _, ok := fgSubnetRange("nonsense"); ok {
		t.Error("garbage must not parse as a subnet")
	}
}

func TestMergeRanges(t *testing.T) {
	u := func(s string) uint32 { v, _ := ipToU32(ip(s)); return v }

	// Two adjacent /24s are one /23 in practice. Failing to merge them would miss a real shadow.
	merged := mergeRanges([]ipRange{
		{u("10.0.1.0"), u("10.0.1.255")},
		{u("10.0.0.0"), u("10.0.0.255")},
	})
	if len(merged) != 1 || merged[0].Lo != u("10.0.0.0") || merged[0].Hi != u("10.0.1.255") {
		t.Errorf("adjacent ranges should coalesce, got %v", merged)
	}

	// Disjoint ranges must stay apart, or everything would look shadowed.
	sep := mergeRanges([]ipRange{
		{u("10.0.0.0"), u("10.0.0.255")},
		{u("192.168.1.0"), u("192.168.1.255")},
	})
	if len(sep) != 2 {
		t.Errorf("disjoint ranges must not merge, got %v", sep)
	}

	if mergeRanges(nil) != nil {
		t.Error("merging nothing should yield nothing")
	}
}

func TestRangesCover(t *testing.T) {
	u := func(s string) uint32 { v, _ := ipToU32(ip(s)); return v }
	all := []ipRange{{0, ^uint32(0)}}
	lan := []ipRange{{u("192.168.1.0"), u("192.168.1.255")}}
	host := []ipRange{{u("192.168.1.50"), u("192.168.1.50")}}

	if !rangesCover(all, lan) {
		t.Error("all should cover a subnet")
	}
	if !rangesCover(lan, host) {
		t.Error("a subnet should cover a host inside it")
	}
	if rangesCover(host, lan) {
		t.Error("a host must not cover the subnet around it")
	}
	if rangesCover(lan, all) {
		t.Error("a subnet must not cover everything")
	}
	// An empty inner set means "we could not work out what this policy covers" — that must never
	// read as "covered", or an undecidable policy would be declared dead.
	if rangesCover(all, nil) {
		t.Error("an empty inner set must not count as covered")
	}
}

func TestAddrRangesDecidability(t *testing.T) {
	am := labAddrMatcher()

	if _, ok := addrRanges(am, []string{"LAN-Network"}, 0); !ok {
		t.Error("a plain subnet object is decidable")
	}
	if _, ok := addrRanges(am, []string{"Mixed"}, 0); ok {
		t.Error("a group containing an FQDN must be reported as undecidable")
	}
	// ⚠️ This is what stops the audit inventing a "this rule is dead" finding for a policy whose
	// address it cannot expand. Getting it wrong on a live firewall is worse than staying quiet.
	for _, name := range []string{"wildcard.google.com", "EMS_ALL_UNKNOWN", "Not-On-Device"} {
		if _, ok := addrRanges(am, []string{name}, 0); ok {
			t.Errorf("%s should be undecidable", name)
		}
	}
	if r, ok := addrRanges(am, []string{"Web_Server_VIP"}, 0); !ok || len(r) != 1 {
		t.Error("a VIP's external address should expand to one range")
	}
}

// ── Service coverage ─────────────────────────────────────────────────────────

func TestSvcRangesAndCover(t *testing.T) {
	sm := labSvcMatcher()

	all, _ := svcRanges(sm, []string{"ALL"}, 0)
	https, _ := svcRanges(sm, []string{"HTTPS"}, 0)
	web, _ := svcRanges(sm, []string{"HTTP", "HTTPS"}, 0)
	allTCP, _ := svcRanges(sm, []string{"ALL_TCP"}, 0)
	icmp, _ := svcRanges(sm, []string{"ALL_ICMP"}, 0)

	if !svcCover(all, https) {
		t.Error("ALL should cover HTTPS")
	}
	if !svcCover(all, icmp) {
		t.Error("ALL should cover ICMP too — it is every protocol, not just TCP")
	}
	if !svcCover(web, https) {
		t.Error("HTTP+HTTPS should cover HTTPS")
	}
	if svcCover(https, web) {
		t.Error("HTTPS alone must not cover HTTP")
	}
	if !svcCover(allTCP, https) {
		t.Error("ALL_TCP (1-65535) should cover TCP/443")
	}
	// The trap: ALL_TCP is every TCP port but NOT every protocol.
	if svcCover(allTCP, icmp) {
		t.Error("ALL_TCP must not cover ICMP")
	}
	if svcCover(allTCP, all) {
		t.Error("only ALL can cover ALL")
	}
	if svcCover(all, nil) {
		t.Error("an empty inner set must not count as covered")
	}
}

func TestParsePortSpans(t *testing.T) {
	spans := parsePortSpans("80 443 8080-8090", 6)
	if len(spans) != 3 {
		t.Fatalf("expected 3 spans, got %v", spans)
	}
	if spans[0].Lo != 80 || spans[0].Hi != 80 {
		t.Errorf("a bare port should be a one-port span, got %v", spans[0])
	}
	if spans[2].Lo != 8080 || spans[2].Hi != 8090 {
		t.Errorf("a range should keep both ends, got %v", spans[2])
	}
	if len(parsePortSpans("", 6)) != 0 {
		t.Error("an empty port range yields no spans")
	}
}

// ── Interface coverage ───────────────────────────────────────────────────────

func TestIntfCover(t *testing.T) {
	zones := map[string][]string{"internal": {"lan", "dmz"}}
	anyList := names("any")

	if !intfCover(anyList, true, names("lan"), false, zones) {
		t.Error(`"any" should cover a named interface`)
	}
	if intfCover(names("lan"), false, anyList, true, zones) {
		t.Error(`a named interface must not cover "any"`)
	}
	if !intfCover(names("lan", "dmz"), false, names("lan"), false, zones) {
		t.Error("a superset should cover a subset")
	}
	if intfCover(names("lan"), false, names("lan", "dmz"), false, zones) {
		t.Error("a subset must not cover a superset")
	}
	if !intfCover(names("internal"), false, names("dmz"), false, zones) {
		t.Error("a zone should cover its member")
	}
	if intfCover(names("lan"), false, nil, false, zones) {
		t.Error("an empty inner set must not count as covered")
	}
}

// ── Factory objects ──────────────────────────────────────────────────────────

// "Delete this unused object" must never be said about something FortiOS ships and the GUI will
// not let you remove — one wrong row like that and the whole report looks unreliable.
func TestIsFactoryAddress(t *testing.T) {
	ifaces := map[string]bool{"lan": true, "port1": true, "dmz": true}

	factory := []FGAddress{
		{Name: "all", Type: "ipmask"},
		{Name: "none", Type: "ipmask"},
		{Name: "FABRIC_DEVICE", Type: "ipmask"},
		{Name: "FIREWALL_AUTH_PORTAL_ADDRESS", Type: "ipmask"},
		{Name: "SSLVPN_TUNNEL_ADDR1", Type: "iprange"},
		{Name: "EMS_ALL_UNKNOWN_CLIENTS", Type: "dynamic"},
		{Name: "FCTEMS_ALL_FORTICLOUD_SERVERS", Type: "dynamic"},
		{Name: "lan", Type: "interface-subnet"},
		{Name: "port1 address", Type: "interface-subnet"},
	}
	for _, a := range factory {
		if !isFactoryAddress(a, ifaces) {
			t.Errorf("%q should be treated as a factory object, not clutter", a.Name)
		}
	}

	// And a genuinely orphaned user object must still be reported — that is the whole point.
	user := []FGAddress{
		{Name: "LAN-192.168.50.0", Type: "ipmask", Subnet: "192.168.50.0 255.255.255.0"},
		{Name: "wildcard.dropbox.com", Type: "fqdn", FQDN: "*.dropbox.com"},
	}
	for _, a := range user {
		if isFactoryAddress(a, ifaces) {
			t.Errorf("%q is a user-created object and should be reportable", a.Name)
		}
	}
}

// ── Report shaping ───────────────────────────────────────────────────────────

func TestSortFindings(t *testing.T) {
	f := []AuditFinding{
		{Check: "policy-no-traffic", Severity: SeverityLow, PolicyID: 9},
		{Check: "policy-any-any", Severity: SeverityHigh, PolicyID: 5},
		{Check: "policy-no-inspection", Severity: SeverityMedium, PolicyID: 2},
		{Check: "policy-any-any", Severity: SeverityHigh, PolicyID: 1},
	}
	sortFindings(f)
	if f[0].Severity != SeverityHigh || f[0].PolicyID != 1 {
		t.Errorf("high severity should come first, lowest policy id first within a check: %+v", f[0])
	}
	if f[1].PolicyID != 5 || f[2].Severity != SeverityMedium || f[3].Severity != SeverityLow {
		t.Errorf("findings are out of order: %+v", f)
	}
}

func TestCoversEverythingAndHasAllService(t *testing.T) {
	u := func(s string) uint32 { v, _ := ipToU32(ip(s)); return v }
	if !coversEverything([]ipRange{{0, ^uint32(0)}}) {
		t.Error(`"all" covers everything`)
	}
	if coversEverything([]ipRange{{u("10.0.0.0"), u("10.0.0.255")}}) {
		t.Error("a single subnet does not cover everything")
	}
	// Two halves that together span the whole space DO cover everything — merging has to notice.
	if !coversEverything([]ipRange{{0, u("127.255.255.255")}, {u("128.0.0.0"), ^uint32(0)}}) {
		t.Error("two adjacent halves should merge into full coverage")
	}
	if !hasAllService([]svcRange{{Proto: 6, Lo: 443, Hi: 443}, {Proto: -1}}) {
		t.Error("an ALL entry anywhere in the list counts")
	}
	if hasAllService([]svcRange{{Proto: 6, Lo: 1, Hi: 65535}}) {
		t.Error("every TCP port is not the ALL service")
	}
}

func TestScheduleAlwaysOn(t *testing.T) {
	for _, s := range []string{"", "always", "ALWAYS"} {
		if !scheduleAlwaysOn(s) {
			t.Errorf("%q should count as always on", s)
		}
	}
	if scheduleAlwaysOn("office-hours") {
		t.Error("a named schedule narrows a policy and must not count as always on")
	}
}

func TestIntfListHas(t *testing.T) {
	zones := map[string][]string{"internal": {"lan", "dmz"}}
	if !intfListHas(names("port1"), "port1", zones) {
		t.Error("a direct name should match")
	}
	if !intfListHas(names("any"), "port1", zones) {
		t.Error(`"any" includes every interface`)
	}
	if !intfListHas(names("internal"), "dmz", zones) {
		t.Error("a zone includes its members")
	}
	if intfListHas(names("lan"), "port1", zones) {
		t.Error("an unrelated interface must not match")
	}
}

func TestPolicySubject(t *testing.T) {
	if got := policySubject(FGPolicy{PolicyID: 7, Name: "Host-to-Internet"}); got != "policy #7 Host-to-Internet" {
		t.Errorf("got %q", got)
	}
	if got := policySubject(FGPolicy{PolicyID: 3}); got != "policy #3" {
		t.Errorf("an unnamed policy should still be identifiable, got %q", got)
	}
}

// ── Cleartext protocols (policy-insecure-service) ───────────────────────────
//
// The check's whole reliability is the narrowness rule. A rule whose service is ALL technically
// permits Telnet, but calling that "this rule deliberately allows Telnet" is wrong twice over: it
// is not the decision the author made, and the real problem with that rule is its width, which
// policy-any-any already reports.

func TestInsecureServicesInNamesWhatIsPermitted(t *testing.T) {
	cases := []struct {
		name   string
		ranges []svcRange
		want   []string
	}{
		{"telnet alone", []svcRange{{Proto: 6, Lo: 23, Hi: 23}}, []string{"Telnet"}},
		{"ftp alone", []svcRange{{Proto: 6, Lo: 21, Hi: 21}}, []string{"FTP"}},
		{"tftp is udp", []svcRange{{Proto: 17, Lo: 69, Hi: 69}}, []string{"TFTP"}},
		{"snmp is udp, not tcp", []svcRange{{Proto: 6, Lo: 161, Hi: 161}}, nil},
		{"several at once", []svcRange{{Proto: 6, Lo: 21, Hi: 23}}, []string{"Telnet", "FTP"}},
		{"https is fine", []svcRange{{Proto: 6, Lo: 443, Hi: 443}}, nil},
		{"ssh is fine", []svcRange{{Proto: 6, Lo: 22, Hi: 22}}, nil},
		{"a hand-written block still counts", []svcRange{{Proto: 6, Lo: 20, Hi: 1000}}, []string{"Telnet", "FTP", "POP3 without TLS", "IMAP without TLS", "LDAP without TLS", "rlogin", "rsh / rexec"}},
	}
	for _, tc := range cases {
		got := insecureServicesIn(tc.ranges)
		if len(got) != len(tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
				break
			}
		}
	}
}

// The two shapes that must stay silent, because reporting them would drown the finding that
// matters under one row per egress rule.
func TestInsecureServicesInIgnoresWideOpenServiceSets(t *testing.T) {
	if got := insecureServicesIn([]svcRange{{Proto: -1}}); len(got) != 0 {
		t.Errorf(`service "ALL" reported %v - width is policy-any-any's finding, not this one`, got)
	}
	if got := insecureServicesIn([]svcRange{{Proto: 6, Lo: 1, Hi: 65535}}); len(got) != 0 {
		t.Errorf("TCP/1-65535 reported %v - a range that wide was not a decision to allow those protocols", got)
	}
	// Exactly at the edge, and one past it.
	narrow := []svcRange{{Proto: 6, Lo: 23, Hi: 23 + maxNarrowServiceSpan - 1}}
	if got := insecureServicesIn(narrow); len(got) == 0 {
		t.Errorf("a span of exactly %d ports was ignored - the boundary is off by one", maxNarrowServiceSpan)
	}
	wide := []svcRange{{Proto: 6, Lo: 23, Hi: 23 + maxNarrowServiceSpan}}
	if got := insecureServicesIn(wide); len(got) != 0 {
		t.Errorf("a span of %d ports reported %v - the boundary is off by one", maxNarrowServiceSpan+1, got)
	}
}

// Every cleartext protocol in the table has to be reachable by the check, and none of them may be
// a protocol the check is documented as deliberately leaving alone.
func TestInsecureServiceTableIsCoherent(t *testing.T) {
	seen := map[string]bool{}
	for _, ins := range insecureServices {
		if ins.Label == "" {
			t.Error("a cleartext protocol has no label")
		}
		if seen[ins.Label] {
			t.Errorf("%q appears twice - it would be reported twice on one policy", ins.Label)
		}
		seen[ins.Label] = true
		if ins.Proto != 6 && ins.Proto != 17 {
			t.Errorf("%s has protocol %d - only TCP (6) and UDP (17) carry ports", ins.Label, ins.Proto)
		}
		if ins.Port <= 0 || ins.Port > 65535 {
			t.Errorf("%s has port %d", ins.Label, ins.Port)
		}
		// Documented exclusions. If either reappears, the check starts firing on ordinary web
		// traffic and ordinary file sharing.
		if ins.Proto == 6 && (ins.Port == 80 || ins.Port == 445) {
			t.Errorf("%s (tcp/%d) is in the table - HTTP and SMB are excluded on purpose", ins.Label, ins.Port)
		}
		if got := insecureServicesIn([]svcRange{{Proto: ins.Proto, Lo: ins.Port, Hi: ins.Port}}); len(got) != 1 || got[0] != ins.Label {
			t.Errorf("%s is in the table but the check does not report it: %v", ins.Label, got)
		}
	}
}

// The advisory set decides which findings may open a gap. Getting it wrong in either direction is
// the difference between a scorecard driven by exposure and one driven by clutter.
func TestOnlyHygieneChecksAreAdvisory(t *testing.T) {
	want := map[string]bool{
		"policy-no-traffic": true,
		"policy-disabled":   true,
		"object-unused":     true,
	}
	for _, c := range AuditChecks {
		if IsAdvisoryCheck(c) != want[c] {
			t.Errorf("check %q: advisory=%v, expected %v", c, IsAdvisoryCheck(c), want[c])
		}
	}
}

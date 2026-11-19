package services

import "testing"

// The rule payload is where this feature can go wrong invisibly: the device accepts fields that do
// not belong to the chosen mode with a 200 and then discards them. These tests pin the mapping that
// keeps the form honest.

// fgNamesOf unwraps a payload field back into plain strings. Named for this file — `names` is
// already taken by audit_test.go in the same package.
func fgNamesOf(v interface{}) []string {
	rows, ok := v.([]FGName)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Name)
	}
	return out
}

func TestRulePayload_SendsOnlyTheChosenModesFields(t *testing.T) {
	// Verified live: `health-check` with mode=sla reads back empty, and `link-cost-factor: jitter`
	// with mode=sla reads back `latency`. Sending them anyway would show the user a saved setting
	// the firewall threw away.
	base := SDWANRuleFull{
		Name: "r", Destination: []string{"all"}, ZonePreference: []string{"virtual-wan-link"},
		MeasuredSLA: []string{"Default_DNS"}, QualityCriteria: "jitter", HashMode: "source-ip-based",
		RequiredSLATargets: []SDWANRuleSLATarget{{HealthCheck: "Default_DNS", ID: 1}},
	}

	manual := base
	manual.Mode = "manual"
	p := buildSDWANRulePayload(manual)
	for _, k := range []string{"health-check", "link-cost-factor", "sla", "hash-mode"} {
		if _, present := p[k]; present {
			t.Fatalf("mode=manual must not send %q", k)
		}
	}

	priority := base
	priority.Mode = "priority"
	p = buildSDWANRulePayload(priority)
	if got := fgNamesOf(p["health-check"]); len(got) != 1 || got[0] != "Default_DNS" {
		t.Fatalf("mode=priority must send health-check, got %v", p["health-check"])
	}
	if p["link-cost-factor"] != "jitter" {
		t.Fatalf("mode=priority must send link-cost-factor, got %v", p["link-cost-factor"])
	}
	if _, present := p["sla"]; present {
		t.Fatal("mode=priority must not send sla")
	}

	sla := base
	sla.Mode = "sla"
	p = buildSDWANRulePayload(sla)
	if _, present := p["sla"]; !present {
		t.Fatal("mode=sla must send sla")
	}
	if _, present := p["health-check"]; present {
		t.Fatal("mode=sla must not send health-check — the device discards it")
	}
	if _, present := p["hash-mode"]; present {
		t.Fatal("mode=sla must not send hash-mode")
	}

	lb := base
	lb.Mode = "load-balance"
	p = buildSDWANRulePayload(lb)
	if _, present := p["sla"]; !present {
		t.Fatal("mode=load-balance must send sla")
	}
	if p["hash-mode"] != "source-ip-based" {
		t.Fatalf("mode=load-balance must send hash-mode, got %v", p["hash-mode"])
	}
}

func TestRulePayload_InternetServiceReplacesTheDestination(t *testing.T) {
	// The device stores one or the other. Sending both leaves a rule matching traffic nobody asked
	// for, and the surviving field is not the one the form showed.
	r := SDWANRuleFull{
		Name: "r", Mode: "manual", ZonePreference: []string{"z"},
		Destination:          []string{"all"},
		InternetService:      true,
		InternetServiceNames: []string{"Microsoft-Office365"},
	}
	p := buildSDWANRulePayload(r)
	if _, present := p["dst"]; present {
		t.Fatal("dst must be dropped when internet-service is on")
	}
	if p["internet-service"] != "enable" {
		t.Fatalf("internet-service should be enable, got %v", p["internet-service"])
	}
	if got := fgNamesOf(p["internet-service-name"]); len(got) != 1 {
		t.Fatalf("internet service names not carried: %v", p["internet-service-name"])
	}

	r.InternetService = false
	p = buildSDWANRulePayload(r)
	if got := fgNamesOf(p["dst"]); len(got) != 1 || got[0] != "all" {
		t.Fatalf("dst must be sent when internet-service is off, got %v", p["dst"])
	}
	if p["internet-service"] != "disable" {
		t.Fatalf("internet-service should be disable, got %v", p["internet-service"])
	}
}

func TestRulePayload_PortsOnlyForTCPAndUDP(t *testing.T) {
	// The device rejects a port range on a protocol that has no ports.
	r := SDWANRuleFull{
		Name: "r", Mode: "manual", ZonePreference: []string{"z"}, Destination: []string{"all"},
		StartPort: 80, EndPort: 443,
	}
	r.Protocol = 1 // ICMP
	p := buildSDWANRulePayload(r)
	if _, present := p["start-port"]; present {
		t.Fatal("ICMP must not carry a port range")
	}
	r.Protocol = 6 // TCP
	p = buildSDWANRulePayload(r)
	if p["start-port"] != 80 || p["end-port"] != 443 {
		t.Fatalf("TCP must carry its port range, got %v-%v", p["start-port"], p["end-port"])
	}
	r.Protocol = 17 // UDP
	p = buildSDWANRulePayload(r)
	if _, present := p["start-port"]; !present {
		t.Fatal("UDP must carry a port range")
	}
}

func TestRulePayload_OmitsIDOnCreateAndDSCPTagsWhenOff(t *testing.T) {
	r := SDWANRuleFull{Name: "r", Mode: "manual", ZonePreference: []string{"z"}, Destination: []string{"all"}}
	p := buildSDWANRulePayload(r)
	if _, present := p["id"]; present {
		t.Fatal("a create must let the device allocate the rule id")
	}
	for _, k := range []string{"dscp-forward-tag", "dscp-reverse-tag"} {
		if _, present := p[k]; present {
			t.Fatalf("%s must not be sent while its toggle is off", k)
		}
	}
	if p["dscp-forward"] != "disable" || p["dscp-reverse"] != "disable" {
		t.Fatal("the DSCP toggles must still be sent, so turning one off actually clears it")
	}

	r.ID = 5
	r.ForwardDSCP = true
	r.ForwardDSCPTag = "000010"
	p = buildSDWANRulePayload(r)
	if p["id"] != 5 {
		t.Fatalf("an explicit id must be sent, got %v", p["id"])
	}
	if p["dscp-forward-tag"] != "000010" {
		t.Fatalf("the forward DSCP tag must be sent when the toggle is on, got %v", p["dscp-forward-tag"])
	}
}

func TestRulePayload_PriorityMembersAndZonesAlwaysGo(t *testing.T) {
	// The outgoing interfaces are the point of a rule, and the dialog shows them under all four
	// strategies — so they must never be gated behind a mode.
	for _, mode := range []string{"manual", "priority", "sla", "load-balance"} {
		r := SDWANRuleFull{
			Name: "r", Mode: mode, Destination: []string{"all"},
			InterfacePreference: []int{1, 2}, ZonePreference: []string{"virtual-wan-link"},
			MeasuredSLA:        []string{"Default_DNS"},
			RequiredSLATargets: []SDWANRuleSLATarget{{HealthCheck: "Default_DNS", ID: 1}},
		}
		p := buildSDWANRulePayload(r)
		members, ok := p["priority-members"].([]map[string]interface{})
		if !ok || len(members) != 2 || members[0]["seq-num"] != 1 {
			t.Fatalf("mode=%s: priority-members wrong: %v", mode, p["priority-members"])
		}
		if got := fgNamesOf(p["priority-zone"]); len(got) != 1 {
			t.Fatalf("mode=%s: priority-zone wrong: %v", mode, p["priority-zone"])
		}
	}
}

func TestLoadBalanceCriteria_LabelsAndFallback(t *testing.T) {
	// The label the implicit row shows. An unmapped value must fall through to the raw string
	// rather than being given a guessed name.
	if got := loadBalanceCriteria("source-ip-based"); got != "Source IP" {
		t.Fatalf("got %q", got)
	}
	if got := loadBalanceCriteria("source-dest-ip-based"); got != "Source-Destination IP" {
		t.Fatalf("got %q", got)
	}
	if got := loadBalanceCriteria("something-new"); got != "something-new" {
		t.Fatalf("an unknown mode must pass through, got %q", got)
	}
	if got := loadBalanceCriteria(""); got != "" {
		t.Fatalf("empty must stay empty, got %q", got)
	}
}

func TestSLASetComparison(t *testing.T) {
	// reconcileRuleSLA decides whether to re-send on this. Order must not matter — the device
	// returns the table in its own order.
	a := []SDWANRuleSLATarget{{HealthCheck: "DNS", ID: 1}, {HealthCheck: "AWS", ID: 2}}
	b := []SDWANRuleSLATarget{{HealthCheck: "AWS", ID: 2}, {HealthCheck: "DNS", ID: 1}}
	if !sameSLASet(slaKeySet(a), slaKeySet(b)) {
		t.Fatal("the same targets in a different order must compare equal")
	}

	// The exact drift the double-PUT exists to catch: one extra row left behind by the merge.
	c := append(append([]SDWANRuleSLATarget{}, a...), SDWANRuleSLATarget{HealthCheck: "Gmail", ID: 1})
	if sameSLASet(slaKeySet(a), slaKeySet(c)) {
		t.Fatal("a leftover row must NOT compare equal — that is the merge this reconciles")
	}

	// Same health check, different SLA number, is a different target.
	d := []SDWANRuleSLATarget{{HealthCheck: "DNS", ID: 2}}
	e := []SDWANRuleSLATarget{{HealthCheck: "DNS", ID: 1}}
	if sameSLASet(slaKeySet(d), slaKeySet(e)) {
		t.Fatal("the SLA number is part of the identity")
	}
}

func TestDeleteSDWANRule_RefusesWithoutAnID(t *testing.T) {
	// Same rule as everywhere else: a DELETE with no mkey would hit the collection URL and empty
	// the whole rule table.
	fc := &FortiClient{BaseURL: "https://example.invalid"}
	if err := fc.DeleteSDWANRule(0); err == nil {
		t.Fatal("DeleteSDWANRule must refuse id 0")
	}
	if err := fc.DeleteSDWANRule(-1); err == nil {
		t.Fatal("DeleteSDWANRule must refuse a negative id")
	}
}

func TestResolveChangeTarget_SDWANRules(t *testing.T) {
	got, ok := ResolveChangeTarget("PUT", "sdwan/rules/3")
	if !ok || got.CMDBPath != "/api/v2/cmdb/system/sdwan/service" || got.MKey != "3" ||
		got.ResourceType != "sdwan-rule" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	if got, ok = ResolveChangeTarget("POST", "sdwan/rules"); !ok || got.MKey != "" {
		t.Fatalf("a create carries no mkey yet: %+v ok=%v", got, ok)
	}
}

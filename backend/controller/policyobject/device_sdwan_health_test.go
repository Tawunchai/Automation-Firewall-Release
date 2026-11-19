package policyobject

import (
	"reflect"
	"strings"
	"testing"

	"network_automation/services"
)

// The Performance SLA validator. Each case below stands in for a device answer that is technically
// correct and completely unhelpful — the point of validating here is that the user gets a sentence
// instead of "Command fail. Return code -56".

func goodCheck() sdwanHealthCheckInput {
	return sdwanHealthCheckInput{
		// Underscored, like the device's own Default_AWS: this table refuses a hyphen in the mkey.
		Name: "Corp_SLA", DetectMode: "active", Protocol: "ping",
		Servers: []string{"1.1.1.1"}, Interval: 500, Failtime: 5, Recoverytime: 5,
	}
}

func TestValidateHealthCheck_NameRulesApplyOnCreateOnly(t *testing.T) {
	inp := goodCheck()
	inp.Name = "  "
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a create without a name must be refused")
	}
	// On an update the mkey comes from the URL, so the body's name is not the authority.
	if _, err := validateSDWANHealthCheck(inp, false); err != nil {
		t.Errorf("an update must not require a name in the body: %v", err)
	}

	inp.Name = strings.Repeat("x", 36)
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a 36-character name must be refused (the field is 35)")
	}
}

func TestValidateHealthCheck_NameCharactersTheDeviceReserves(t *testing.T) {
	// Probed character by character on the real device, because none of it is in the schema:
	//   "-"            → "char(-) is reserved. node_check_object fail!"       / -651
	//   < > ' " # ( )  → "The string contains XSS vulnerability characters"   / -173
	// The hyphen is the surprise, and it is exactly why the six checks the FortiGate ships with are
	// called Default_AWS rather than Default-AWS.
	for _, bad := range []string{"Voice-SLA", "Voice#SLA", "Voice(1)", "a<b", "it's"} {
		inp := goodCheck()
		inp.Name = bad
		if _, err := validateSDWANHealthCheck(inp, true); err == nil {
			t.Errorf("%q must be refused before it reaches the firewall", bad)
		}
	}

	// Everything else that was tried on the device was accepted, and must not be refused here.
	for _, ok := range []string{"Corp_SLA", "Default_Google Search", "SLA.v2+eu@east", "a&b", "50%"} {
		inp := goodCheck()
		inp.Name = ok
		if _, err := validateSDWANHealthCheck(inp, true); err != nil {
			t.Errorf("%q is accepted by the device and must be accepted here: %v", ok, err)
		}
	}

	// On an update the mkey comes from the URL, so a name the device already holds — however odd —
	// must not block an edit.
	inp := goodCheck()
	inp.Name = "Voice-SLA"
	if _, err := validateSDWANHealthCheck(inp, false); err != nil {
		t.Errorf("an update must not re-check the name: %v", err)
	}
}

func TestValidateHealthCheck_ServerRequiredOnCreate(t *testing.T) {
	// The device's own answer is "Attribute 'server' MUST be set. … Return code -56" — accurate,
	// and meaningless inside a form.
	inp := goodCheck()
	inp.Servers = nil
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("an active create with no server must be refused")
	}

	// DNS with "Same as System DNS" is the one way to have no server of your own — verified live:
	// POST {"protocol":"dns","system-dns":"enable"} with no server succeeds.
	inp.Protocol = "dns"
	inp.SystemDNS = true
	if _, err := validateSDWANHealthCheck(inp, true); err != nil {
		t.Errorf("DNS + system DNS needs no server: %v", err)
	}

	// Passive never sends a packet: the device neither requires a server nor keeps one.
	inp = goodCheck()
	inp.Servers = nil
	inp.DetectMode = "passive"
	if _, err := validateSDWANHealthCheck(inp, true); err != nil {
		t.Errorf("a passive create needs no server: %v", err)
	}

	// An update may leave the servers alone — an empty `server` is a no-op on the device, so
	// refusing here would block every edit that does not retype the address.
	inp = goodCheck()
	inp.Servers = nil
	if _, err := validateSDWANHealthCheck(inp, false); err != nil {
		t.Errorf("an update must not demand a server: %v", err)
	}
}

func TestValidateHealthCheck_AtMostTwoServers(t *testing.T) {
	// The field's own ceiling: a third entry is refused with "too many argument to set 3, 2".
	inp := goodCheck()
	inp.Servers = []string{"1.1.1.1", "8.8.8.8", "9.9.9.9"}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("three servers must be refused")
	}

	inp.Servers = []string{"1.1.1.1", " ", "8.8.8.8"}
	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("two servers plus a blank row should pass: %v", err)
	}
	if !reflect.DeepEqual(got.Servers, []string{"1.1.1.1", "8.8.8.8"}) {
		t.Fatalf("blank rows should be dropped, got %#v", got.Servers)
	}

	// The CMDB packs the list into one space-separated quoted string, so a value carrying either
	// would come back split or mangled.
	inp.Servers = []string{"one two"}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a server address with a space must be refused")
	}
}

func TestValidateHealthCheck_PassiveDropsLinkStatus(t *testing.T) {
	// With detect-mode passive the device accepts these with a 200 and reads them back unchanged.
	// The result must carry the defaults, not the numbers the caller hoped for.
	inp := goodCheck()
	inp.DetectMode = "passive"
	inp.Interval, inp.Failtime, inp.Recoverytime = 900, 3, 7
	on := true
	inp.UpdateStaticRoute = &on

	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("passive should validate: %v", err)
	}
	if got.Interval != 0 || got.Failtime != 0 || got.Recoverytime != 0 || got.UpdateStaticRoute {
		t.Fatalf("passive must not carry link status settings, got %+v", got)
	}
}

func TestValidateHealthCheck_PreferPassiveKeepsLinkStatus(t *testing.T) {
	inp := goodCheck()
	inp.DetectMode = "prefer-passive"
	inp.Interval, inp.Failtime, inp.Recoverytime = 900, 3, 7

	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("prefer-passive should validate: %v", err)
	}
	if got.Interval != 900 || got.Failtime != 3 || got.Recoverytime != 7 {
		t.Fatalf("prefer-passive must keep link status, got %+v", got)
	}
}

func TestValidateHealthCheck_LinkStatusRanges(t *testing.T) {
	// The schema's ranges. Checking them here turns "Return code -61" into a sentence.
	for _, c := range []struct {
		what string
		mut  func(*sdwanHealthCheckInput)
	}{
		{"interval below 20", func(i *sdwanHealthCheckInput) { i.Interval = 19 }},
		{"interval above 3600000", func(i *sdwanHealthCheckInput) { i.Interval = 3600001 }},
		{"failtime above 3600", func(i *sdwanHealthCheckInput) { i.Failtime = 3601 }},
		{"recoverytime above 3600", func(i *sdwanHealthCheckInput) { i.Recoverytime = 3601 }},
		{"negative failtime", func(i *sdwanHealthCheckInput) { i.Failtime = -1 }},
	} {
		inp := goodCheck()
		c.mut(&inp)
		if _, err := validateSDWANHealthCheck(inp, true); err == nil {
			t.Errorf("%s must be refused", c.what)
		}
	}

	// Zero means "the caller did not say", so the CMDB defaults stand rather than a 0 the device
	// would reject.
	inp := goodCheck()
	inp.Interval, inp.Failtime, inp.Recoverytime = 0, 0, 0
	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("unset link status should fall back to defaults: %v", err)
	}
	if got.Interval != 500 || got.Failtime != 5 || got.Recoverytime != 5 {
		t.Fatalf("defaults not applied, got %+v", got)
	}
}

func TestValidateHealthCheck_UpdateStaticRouteDefaultsOn(t *testing.T) {
	// The CMDB default is enable and so is the dialog's toggle; a body that omits the field must
	// not silently turn routing updates off.
	got, _ := validateSDWANHealthCheck(goodCheck(), true)
	if !got.UpdateStaticRoute {
		t.Error("update-static-route should default to on")
	}

	off := false
	inp := goodCheck()
	inp.UpdateStaticRoute = &off
	got, _ = validateSDWANHealthCheck(inp, true)
	if got.UpdateStaticRoute {
		t.Error("an explicit false must turn it off")
	}
}

func TestValidateHealthCheck_ProbeModeAndProtocol(t *testing.T) {
	inp := goodCheck()
	inp.DetectMode = "remote" // in the CMDB schema, but not in the dialog
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a probe mode the form cannot render must be refused")
	}

	inp = goodCheck()
	inp.Protocol = "twamp" // ditto: no fields exist to configure it
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a protocol the form cannot render must be refused")
	}

	// An unset mode/protocol takes the device's own defaults.
	inp = goodCheck()
	inp.DetectMode, inp.Protocol = "", ""
	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("defaults should validate: %v", err)
	}
	if got.DetectMode != "active" || got.Protocol != "ping" {
		t.Fatalf("defaults = %q / %q", got.DetectMode, got.Protocol)
	}
}

func TestValidateHealthCheck_SystemDNSOnlyMeansAnythingForDNS(t *testing.T) {
	inp := goodCheck()
	inp.Protocol = "ping"
	inp.SystemDNS = true
	got, _ := validateSDWANHealthCheck(inp, true)
	if got.SystemDNS {
		t.Error("system DNS is a DNS-probe setting and must not survive a Ping probe")
	}
}

func TestValidateHealthCheck_SLATargets(t *testing.T) {
	base := goodCheck()

	// An SLA target with no criterion measures nothing: the device stores it and every member
	// passes it, which looks like an SLA that is working.
	inp := base
	inp.SLA = []sdwanSLARowInput{{ID: 1}}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("an SLA target with no threshold turned on must be refused")
	}

	inp.SLA = []sdwanSLARowInput{{ID: 0, LinkCostFactor: []string{"latency"}}}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("SLA number 0 must be refused (the field is 1-32)")
	}
	inp.SLA = []sdwanSLARowInput{{ID: 33, LinkCostFactor: []string{"latency"}}}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("SLA number 33 must be refused")
	}

	// Two rows sharing a number: the device keeps the last silently, so the form would show a
	// target the firewall does not have.
	inp.SLA = []sdwanSLARowInput{
		{ID: 1, LinkCostFactor: []string{"latency"}},
		{ID: 1, LinkCostFactor: []string{"jitter"}},
	}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("duplicate SLA numbers must be refused")
	}

	inp.SLA = []sdwanSLARowInput{{ID: 1, LinkCostFactor: []string{"bandwidth"}}}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("an unknown criterion must be refused")
	}

	inp.SLA = []sdwanSLARowInput{{ID: 1, LinkCostFactor: []string{"packet-loss"}, PacketLossThreshold: 101}}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("a packet loss threshold above 100% must be refused")
	}

	// The happy path, and the shape the payload builder expects.
	inp.SLA = []sdwanSLARowInput{{
		ID: 1, LinkCostFactor: []string{"latency", "jitter", "packet-loss"},
		LatencyThreshold: 250, JitterThreshold: 50, PacketLossThreshold: 5,
	}}
	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("a well-formed SLA target should pass: %v", err)
	}
	if len(got.SLA) != 1 || !reflect.DeepEqual(got.SLA[0].LinkCostFactor,
		[]string{"latency", "jitter", "packet-loss"}) {
		t.Fatalf("SLA row not carried: %+v", got.SLA)
	}

	// SLA Target off is an empty table, and on this child table that really does clear it.
	inp.SLA = nil
	got, _ = validateSDWANHealthCheck(inp, true)
	if len(got.SLA) != 0 {
		t.Fatalf("no SLA targets should stay empty, got %+v", got.SLA)
	}
}

func TestValidateHealthCheck_ParticipantsAreSequenceNumbers(t *testing.T) {
	// The child table's mkey is seq-num; 0 is not a member, it is the absence of one, and the
	// device answers a bad reference with "entry not found in datasource / -3".
	inp := goodCheck()
	inp.Members = []int{0}
	if _, err := validateSDWANHealthCheck(inp, true); err == nil {
		t.Error("participant 0 must be refused")
	}

	inp.Members = []int{2, 5}
	got, err := validateSDWANHealthCheck(inp, true)
	if err != nil {
		t.Fatalf("real participants should pass: %v", err)
	}
	if !reflect.DeepEqual(got.Members, []int{2, 5}) {
		t.Fatalf("participants = %#v", got.Members)
	}
}

func TestSDWANRuleUsesHealthCheck(t *testing.T) {
	// Both ways a rule can depend on a check. Missing either one turns a friendly refusal into a
	// delete that the device rejects with a code, or worse, accepts and leaves a rule pointing at
	// nothing.
	measured := services.SDWANRuleFull{Name: "to-cloud", MeasuredSLA: []string{"Default_AWS"}}
	if !sdwanRuleUsesHealthCheck(measured, "Default_AWS") {
		t.Error("a Measured SLA reference must count")
	}
	required := services.SDWANRuleFull{
		Name:               "voice",
		RequiredSLATargets: []services.SDWANRuleSLATarget{{HealthCheck: "Default_Gmail", ID: 1}},
	}
	if !sdwanRuleUsesHealthCheck(required, "Default_Gmail") {
		t.Error("a Required SLA target reference must count")
	}
	if sdwanRuleUsesHealthCheck(required, "Default_AWS") {
		t.Error("an unrelated check must not match")
	}
}

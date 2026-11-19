package policyobject

import "testing"

// The rule validator carries more weight than the others because the device does not push back on
// most of what it rejects — it accepts the request, keeps what fits the chosen strategy, and
// discards the rest without a word. These tests pin the checks that turn that silence into a
// message the user can act on.

func okRule() sdwanRuleInput {
	return sdwanRuleInput{
		Name:           "to-cloud",
		Mode:           "manual",
		Destination:    []string{"all"},
		ZonePreference: []string{"virtual-wan-link"},
	}
}

func TestValidateSDWANRule_Basics(t *testing.T) {
	if _, err := validateSDWANRule(sdwanRuleInput{}); err == nil {
		t.Fatal("a name must be required")
	}

	long := okRule()
	long.Name = "abcdefghijklmnopqrstuvwxyz0123456789xxxx"
	if _, err := validateSDWANRule(long); err == nil {
		t.Fatal("a name over 35 characters must be rejected")
	}

	bad := okRule()
	bad.Mode = "sideways"
	if _, err := validateSDWANRule(bad); err == nil {
		t.Fatal("an unknown strategy must be rejected")
	}

	// An omitted mode is Manual, which is what the dialog opens on.
	blank := okRule()
	blank.Mode = ""
	r, err := validateSDWANRule(blank)
	if err != nil {
		t.Fatal(err)
	}
	if r.Mode != "manual" {
		t.Fatalf("mode should default to manual, got %q", r.Mode)
	}
	if !r.Status {
		t.Fatal("status must default to enabled, matching the dialog")
	}
}

func TestValidateSDWANRule_NeedsAnOutgoingInterface(t *testing.T) {
	// Without one the device has nothing to steer traffic to and the rule silently does nothing —
	// the worst kind of saved config, because it looks configured.
	in := okRule()
	in.ZonePreference = nil
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("a rule with neither interface nor zone preference must be rejected")
	}

	in.InterfacePreference = []int{1}
	if _, err := validateSDWANRule(in); err != nil {
		t.Fatalf("an interface preference alone is enough: %v", err)
	}
}

func TestValidateSDWANRule_DestinationOrInternetService(t *testing.T) {
	// The two are alternatives on the device, so one of them has to be present.
	in := okRule()
	in.Destination = nil
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("a rule needs a destination or an internet service")
	}

	in.InternetService = true
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("internet-service on with no services chosen must be rejected")
	}

	in.InternetServiceNames = []string{"Microsoft-Office365"}
	if _, err := validateSDWANRule(in); err != nil {
		t.Fatalf("internet service with names should pass: %v", err)
	}
}

func TestValidateSDWANRule_PerModeRequirements(t *testing.T) {
	// Best quality selects on a measured SLA, so it needs one.
	bq := okRule()
	bq.Mode = "priority"
	if _, err := validateSDWANRule(bq); err == nil {
		t.Fatal("Best quality must require a measured SLA")
	}
	bq.MeasuredSLA = []string{"Default_DNS"}
	bq.QualityCriteria = "nonsense"
	if _, err := validateSDWANRule(bq); err == nil {
		t.Fatal("an unknown quality criteria must be rejected")
	}
	bq.QualityCriteria = "jitter"
	if _, err := validateSDWANRule(bq); err != nil {
		t.Fatalf("Best quality with an SLA and a valid criteria should pass: %v", err)
	}

	// The two SLA strategies need a target — and the device will not let the LAST one be removed,
	// so an empty list is a request it cannot honour.
	for _, mode := range []string{"sla", "load-balance"} {
		in := okRule()
		in.Mode = mode
		if _, err := validateSDWANRule(in); err == nil {
			t.Fatalf("mode=%s must require an SLA target", mode)
		}
		in.RequiredSLATargets = []sdwanRuleSLAInput{{HealthCheck: "", ID: 1}}
		if _, err := validateSDWANRule(in); err == nil {
			t.Fatalf("mode=%s: an SLA target needs a performance SLA name", mode)
		}
		in.RequiredSLATargets = []sdwanRuleSLAInput{{HealthCheck: "Default_DNS", ID: 0}}
		if _, err := validateSDWANRule(in); err == nil {
			t.Fatalf("mode=%s: an SLA target needs an SLA number", mode)
		}
		in.RequiredSLATargets = []sdwanRuleSLAInput{{HealthCheck: "Default_DNS", ID: 1}}
		if _, err := validateSDWANRule(in); err != nil {
			t.Fatalf("mode=%s with a complete target should pass: %v", mode, err)
		}
	}

	lb := okRule()
	lb.Mode = "load-balance"
	lb.RequiredSLATargets = []sdwanRuleSLAInput{{HealthCheck: "Default_DNS", ID: 1}}
	lb.HashMode = "not-a-mode"
	if _, err := validateSDWANRule(lb); err == nil {
		t.Fatal("an unknown hash mode must be rejected")
	}
}

func TestValidateSDWANRule_StripsSettingsFromOtherStrategies(t *testing.T) {
	// The user switches Best quality → Manual and saves. The measured SLA must not travel with the
	// rule: the device would drop it anyway, and keeping it here would mean the object we saved is
	// not the object the form showed.
	in := okRule()
	in.Mode = "manual"
	in.MeasuredSLA = []string{"Default_DNS"}
	in.QualityCriteria = "jitter"
	in.HashMode = "round-robin"
	in.RequiredSLATargets = []sdwanRuleSLAInput{{HealthCheck: "Default_DNS", ID: 1}}

	r, err := validateSDWANRule(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.MeasuredSLA) != 0 || r.QualityCriteria != "" {
		t.Fatalf("manual must not carry Best quality settings: %+v", r)
	}
	if len(r.RequiredSLATargets) != 0 {
		t.Fatal("manual must not carry SLA targets")
	}
	if r.HashMode != "" {
		t.Fatal("manual must not carry a hash mode")
	}

	// Lowest cost keeps its targets but still drops the Best-quality pair.
	in.Mode = "sla"
	r, err = validateSDWANRule(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.RequiredSLATargets) != 1 {
		t.Fatal("mode=sla must keep its SLA targets")
	}
	if len(r.MeasuredSLA) != 0 || r.QualityCriteria != "" || r.HashMode != "" {
		t.Fatalf("mode=sla must drop the other strategies' settings: %+v", r)
	}
}

func TestValidateSDWANRule_PortsAndProtocol(t *testing.T) {
	in := okRule()
	in.Protocol = 300
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("protocol above 255 must be rejected")
	}

	in = okRule()
	in.Protocol = 6
	in.StartPort = 443
	in.EndPort = 80
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("a start port above the end port must be rejected")
	}

	in.StartPort = 0
	in.EndPort = 80
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("port 0 must be rejected")
	}

	// A protocol with no ports must not be dragged into the port check.
	in = okRule()
	in.Protocol = 1
	in.StartPort = 0
	in.EndPort = 0
	if _, err := validateSDWANRule(in); err != nil {
		t.Fatalf("ICMP with no ports should pass: %v", err)
	}
}

func TestValidateSDWANRule_DSCPNeedsATag(t *testing.T) {
	// A toggle on with no tag saves a rule that tags nothing, which looks like it works.
	in := okRule()
	in.ForwardDSCP = true
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("forward DSCP on with no tag must be rejected")
	}
	in.ForwardDSCPTag = "000010"
	if _, err := validateSDWANRule(in); err != nil {
		t.Fatalf("forward DSCP with a tag should pass: %v", err)
	}

	in.ReverseDSCP = true
	if _, err := validateSDWANRule(in); err == nil {
		t.Fatal("reverse DSCP on with no tag must be rejected")
	}
}

func TestModeNeedsSLATargets(t *testing.T) {
	if !modeNeedsSLATargets("sla") || !modeNeedsSLATargets("load-balance") {
		t.Fatal("the two SLA strategies need targets")
	}
	if modeNeedsSLATargets("manual") || modeNeedsSLATargets("priority") {
		t.Fatal("manual and priority do not")
	}
}

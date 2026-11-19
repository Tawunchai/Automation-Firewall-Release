package policyobject

import (
	"strings"
	"testing"

	"network_automation/services"
)

// The validators are the layer that turns a bad form into a sentence instead of a FortiOS parser
// code, so they are worth pinning here rather than discovering against a firewall.

func TestValidateSDWANMember_RequiredFields(t *testing.T) {
	if _, err := validateSDWANMember(sdwanMemberInput{Zone: "virtual-wan-link"}); err == nil {
		t.Fatal("an interface must be required")
	}
	if _, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2"}); err == nil {
		t.Fatal("a zone must be required")
	}
}

func TestValidateSDWANMember_GatewayIsOptional(t *testing.T) {
	// A member on a DHCP or PPPoE interface learns its gateway. The dialog's default is 0.0.0.0
	// and the device accepts it, so demanding one here would block a legitimate configuration.
	m, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "virtual-wan-link"})
	if err != nil {
		t.Fatalf("a blank gateway must be accepted: %v", err)
	}
	if m.Gateway != "" {
		t.Fatalf("blank gateway should stay blank until the payload defaults it, got %q", m.Gateway)
	}
}

func TestValidateSDWANMember_StatusDefaultsToEnabled(t *testing.T) {
	// Matches both the dialog and the CMDB default. A missing key must not read as "disabled".
	m, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "z"})
	if err != nil {
		t.Fatal(err)
	}
	if !m.Status {
		t.Fatal("status must default to enabled when the body omits it")
	}

	off := false
	m, err = validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "z", Status: &off})
	if err != nil {
		t.Fatal(err)
	}
	if m.Status {
		t.Fatal("an explicit false must be honoured")
	}
}

func TestValidateSDWANMember_Ranges(t *testing.T) {
	base := func() sdwanMemberInput {
		return sdwanMemberInput{Interface: "wan2", Zone: "virtual-wan-link"}
	}
	cases := []struct {
		name  string
		mutID func(*sdwanMemberInput)
	}{
		{"cost too high", func(i *sdwanMemberInput) { i.Cost = 65536 }},
		{"cost negative", func(i *sdwanMemberInput) { i.Cost = -1 }},
		{"priority too high", func(i *sdwanMemberInput) { i.Priority = 70000 }},
		{"weight too high", func(i *sdwanMemberInput) { i.Weight = 256 }},
		{"volume ratio too high", func(i *sdwanMemberInput) { i.VolumeRatio = 300 }},
		{"negative seq-num", func(i *sdwanMemberInput) { i.SeqNum = -3 }},
	}
	for _, c := range cases {
		in := base()
		c.mutID(&in)
		if _, err := validateSDWANMember(in); err == nil {
			t.Fatalf("%s: expected a rejection", c.name)
		}
	}
}

func TestValidateSDWANMember_RejectsNonIPv4(t *testing.T) {
	// The two fields are typed ipv4-address on the device; an IPv6 literal or a hostname reaching
	// it comes back as an opaque CLI error.
	for _, bad := range []string{"10.0.0", "10.0.0.256", "::1", "gateway", "10.0.0.1.5", "10.0.0.a"} {
		in := sdwanMemberInput{Interface: "wan2", Zone: "z", Gateway: bad}
		if _, err := validateSDWANMember(in); err == nil {
			t.Fatalf("gateway %q should have been rejected", bad)
		}
	}
	for _, good := range []string{"0.0.0.0", "10.0.99.1", "255.255.255.255"} {
		in := sdwanMemberInput{Interface: "wan2", Zone: "z", Gateway: good}
		if _, err := validateSDWANMember(in); err != nil {
			t.Fatalf("gateway %q should be accepted: %v", good, err)
		}
	}
}

func TestValidateSDWANZone(t *testing.T) {
	if _, err := validateSDWANZone(sdwanZoneInput{}); err == nil {
		t.Fatal("a zone name must be required")
	}
	if _, err := validateSDWANZone(sdwanZoneInput{Name: "z", ServiceSLATieBreak: "nonsense"}); err == nil {
		t.Fatal("an unknown tie-break must be rejected — the device only accepts three values")
	}
	z, err := validateSDWANZone(sdwanZoneInput{Name: "  sales  ", ServiceSLATieBreak: "input-device"})
	if err != nil {
		t.Fatal(err)
	}
	if z.Name != "sales" {
		t.Fatalf("name should be trimmed, got %q", z.Name)
	}
	// Every value in the device's own schema must pass.
	for _, tb := range []string{"cfg-order", "fib-best-match", "input-device", ""} {
		if _, err := validateSDWANZone(sdwanZoneInput{Name: "z", ServiceSLATieBreak: tb}); err != nil {
			t.Fatalf("tie-break %q should be accepted: %v", tb, err)
		}
	}
}

func TestIsIPv4Literal(t *testing.T) {
	// Deliberately NOT net.ParseIP, which also accepts IPv6.
	if isIPv4Literal("::1") {
		t.Fatal("an IPv6 literal must not pass an ipv4-address check")
	}
	if !isIPv4Literal("192.168.1.1") {
		t.Fatal("a plain IPv4 address must pass")
	}
	if isIPv4Literal("") || isIPv4Literal("1.2.3.") {
		t.Fatal("empty and short forms must fail")
	}
}

func TestSDWANMemberError_ExplainsTheDatasourceRefusal(t *testing.T) {
	// The device's own answer to "add wan1 to SD-WAN while a policy still names it" is
	// «entry not found in datasource … Return code -3», which reads as "there is no such interface"
	// and sends people hunting for a typo. Measured live: wan1/lan/dmz/port1 (named by policies)
	// were refused; wan2 and ha, named by none, were accepted.
	// Built as the typed *services.DeviceError that f.do/doOnce actually returns in production —
	// not a plain string — so this exercises the numeric Code comparison sdwanMemberError makes,
	// the same path that used to substring-match "-3" and so also matched -30..-39 and -300..-399.
	msg := sdwanMemberError("wan1", &services.DeviceError{
		Code: -3, HTTPStatus: 500,
		Text: "entry not found in datasource value parse error before 'wan1' Command fail. Return code -3",
	})
	if !strings.Contains(msg, "wan1") {
		t.Error("the message must name the interface the user chose")
	}
	if !strings.Contains(msg, "firewall policy") {
		t.Errorf("the message must say what actually holds the interface, got %q", msg)
	}
	// The device's own text is kept: it is the only thing that can be pasted into a support case.
	if !strings.Contains(msg, "Return code -3") {
		t.Error("the device's own wording must be preserved")
	}

	// Anything else is passed through rather than being dressed up as a policy problem.
	other := sdwanMemberError("wan2", &services.DeviceError{Code: -5, HTTPStatus: 500, Text: "error code -5"})
	if strings.Contains(other, "firewall policy") {
		t.Errorf("an unrelated failure must not be explained as a policy reference, got %q", other)
	}
	if !strings.Contains(other, "-5") {
		t.Error("an unrelated failure must still carry the device's answer")
	}

	// A code in the same family as -3 (e.g. -30, -300) must NOT be explained as the datasource
	// refusal — this is exactly the false-positive the old strings.Contains(raw, "-3") produced.
	family := sdwanMemberError("wan3", &services.DeviceError{Code: -30, HTTPStatus: 500, Text: "error code -30"})
	if strings.Contains(family, "firewall policy") {
		t.Errorf("-30 must not be read as -3's datasource refusal, got %q", family)
	}
}

// A live test found that the AI Assistant's SD-WAN wizard defaults a new member's priority input
// to 0, which this validator used to accept (its range check was 0-65535) and the real device then
// refused with a raw "Return code -61" — the exact unreadable-error problem this file exists to
// prevent. FortiOS's actual floor is 1.
func TestValidateSDWANMember_PriorityZeroDefaultsToOne(t *testing.T) {
	// 0 is treated as "not specified" — the same way every other field here (Cost, Weight, Status)
	// falls back to a sensible default rather than erroring — not rejected outright, because the
	// manual dialog always sends an explicit value and there is nothing wrong with a caller that
	// just left it out.
	m, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "z", Priority: 0})
	if err != nil {
		t.Fatalf("priority 0 must be defaulted, not rejected: %v", err)
	}
	if m.Priority != 1 {
		t.Errorf("expected priority to default to 1, got %d", m.Priority)
	}
}

func TestValidateSDWANMember_ExplicitPriorityIsHonoured(t *testing.T) {
	m, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "z", Priority: 42})
	if err != nil {
		t.Fatal(err)
	}
	if m.Priority != 42 {
		t.Errorf("expected priority 42 to pass through unchanged, got %d", m.Priority)
	}
}

func TestValidateSDWANMember_NegativePriorityIsStillRejected(t *testing.T) {
	// Only 0 is a default-me sentinel; an actual negative value is still a mistake.
	if _, err := validateSDWANMember(sdwanMemberInput{Interface: "wan2", Zone: "z", Priority: -5}); err == nil {
		t.Fatal("a negative priority was accepted")
	}
}

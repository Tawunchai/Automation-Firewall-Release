package services

import "testing"

// The mandatory-approval gate's pure rules — see changerequest_gate.go. The rest of the
// change-request state machine needs a real database and is exercised live instead (see the note
// at the top of changerequest_test.go).

func TestRequiresApproval_GatesOnlyTheThreeResourceTypes(t *testing.T) {
	gated := []string{
		"firewall-policy", "virtual-ip",
		"security-profile:antivirus", "security-profile:webfilter", "security-profile:ips-sensor",
	}
	for _, rt := range gated {
		if !RequiresApproval(rt) {
			t.Errorf("RequiresApproval(%q) = false, want true", rt)
		}
	}

	ungated := []string{
		"address", "service", "static-route", "schedule", "sdwan-zone", "ldap-server",
		"local-user", "web-rating-override", "", "security-profile",
	}
	for _, rt := range ungated {
		if RequiresApproval(rt) {
			t.Errorf("RequiresApproval(%q) = true, want false — gating this too would turn every "+
				"routine edit into an approval request", rt)
		}
	}
}

func TestDescribeApprovalTitle(t *testing.T) {
	cases := []struct {
		method string
		target ChangeTarget
		want   string
	}{
		{"POST", ChangeTarget{ResourceType: "firewall-policy"}, `Create firewall-policy`},
		{"PATCH", ChangeTarget{ResourceType: "firewall-policy", MKey: "12"}, `Update firewall-policy "12"`},
		{"DELETE", ChangeTarget{ResourceType: "virtual-ip", MKey: "web-dnat"}, `Delete virtual-ip "web-dnat"`},
		{"PUT", ChangeTarget{ResourceType: "security-profile:antivirus", MKey: "Corp-AV"}, `Update security-profile:antivirus "Corp-AV"`},
	}
	for _, c := range cases {
		if got := DescribeApprovalTitle(c.method, c.target); got != c.want {
			t.Errorf("DescribeApprovalTitle(%q, %+v) = %q, want %q", c.method, c.target, got, c.want)
		}
	}
}

func TestAutoApprovalReason_IsNeverEmpty(t *testing.T) {
	// PrepareChangeRequest refuses an empty Reason — this is what RequireApproval fills it with
	// when the caller never typed one, so it must never itself be blank.
	if got := AutoApprovalReason("PATCH", "/policy/device/1/firewall-policies/12"); got == "" {
		t.Error("AutoApprovalReason returned an empty string — CreateChangeRequest would refuse it")
	}
}

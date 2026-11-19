package services

import "testing"

func TestFleetSpec_OnlyTheFiveEligibleTypes(t *testing.T) {
	eligible := []string{"address", "address-group", "service", "service-group", "ip-pool"}
	for _, rt := range eligible {
		if _, _, ok := FleetSpec(rt); !ok {
			t.Errorf("FleetSpec(%q) = not ok, want eligible", rt)
		}
	}

	// firewall-policy, virtual-ip and security-profile:* are excluded on purpose — pushing those to
	// several devices raises a placement/approval question this feature does not answer. Static
	// routes are excluded because they are keyed by a device-assigned sequence number, not a name.
	ineligible := []string{"firewall-policy", "virtual-ip", "security-profile:antivirus", "static-route", "schedule", ""}
	for _, rt := range ineligible {
		if _, _, ok := FleetSpec(rt); ok {
			t.Errorf("FleetSpec(%q) = ok, want ineligible", rt)
		}
	}
}

func TestFleetCreatePath(t *testing.T) {
	got := FleetCreatePath(7, "addresses")
	want := "/policy/device/7/addresses"
	if got != want {
		t.Errorf("FleetCreatePath = %q, want %q", got, want)
	}
}

func TestFleetUpdatePath_EscapesTheKey(t *testing.T) {
	// Address and service names are free text — a name containing a slash must not be split into
	// two URL segments, the same reason every other by-key device route escapes its mkey.
	got := FleetUpdatePath(7, "addresses", "branch/office")
	want := "/policy/device/7/addresses/branch%2Foffice"
	if got != want {
		t.Errorf("FleetUpdatePath = %q, want %q", got, want)
	}
}

package policyobject

import "testing"

// The form checks exist because FortiOS does not make them. A DHCP server with no range, or with a
// range that runs backwards, is accepted with a 200 and then hands out no leases — which on screen
// is indistinguishable from one that works.

func TestValidateDHCPServer_AcceptsAWorkingServer(t *testing.T) {
	inp := dhcpServerInput{
		Interface: "dmz",
		IPRanges:  []dhcpRangeInput{{StartIP: "10.10.10.100", EndIP: "10.10.10.150"}},
		Netmask:   "255.255.255.0",
	}
	if msg := validateDHCPServer(inp); msg != "" {
		t.Errorf("valid server rejected: %s", msg)
	}
}

func TestValidateDHCPServer_RejectsTheSilentFailures(t *testing.T) {
	cases := []struct {
		name string
		inp  dhcpServerInput
	}{
		{"no interface", dhcpServerInput{
			IPRanges: []dhcpRangeInput{{StartIP: "10.0.0.1", EndIP: "10.0.0.9"}}, Netmask: "255.255.255.0",
		}},
		{"no range at all", dhcpServerInput{Interface: "dmz", Netmask: "255.255.255.0"}},
		{"range with only a start", dhcpServerInput{
			Interface: "dmz", Netmask: "255.255.255.0",
			IPRanges: []dhcpRangeInput{{StartIP: "10.0.0.1"}},
		}},
		{"no netmask", dhcpServerInput{
			Interface: "dmz",
			IPRanges:  []dhcpRangeInput{{StartIP: "10.0.0.1", EndIP: "10.0.0.9"}},
		}},
		{"specify mode with no DNS server", dhcpServerInput{
			Interface: "dmz", Netmask: "255.255.255.0",
			IPRanges:   []dhcpRangeInput{{StartIP: "10.0.0.1", EndIP: "10.0.0.9"}},
			DNSService: "specify",
		}},
		{"reservation with no address", dhcpServerInput{
			Interface: "dmz", Netmask: "255.255.255.0",
			IPRanges:     []dhcpRangeInput{{StartIP: "10.0.0.1", EndIP: "10.0.0.9"}},
			Reservations: []dhcpReservationInput{{MAC: "00:11:22:33:44:55", Action: "reserved"}},
		}},
	}
	for _, tc := range cases {
		if msg := validateDHCPServer(tc.inp); msg == "" {
			t.Errorf("%s: accepted, want a rejection", tc.name)
		}
	}
}

func TestValidateDHCPServer_RangeOrderIsComparedNumerically(t *testing.T) {
	// The reason this is not a string comparison: "192.168.1.9" > "192.168.1.10" as text, so the
	// most ordinary range an operator can type would be rejected as backwards.
	ok := dhcpServerInput{
		Interface: "dmz", Netmask: "255.255.255.0",
		IPRanges: []dhcpRangeInput{{StartIP: "192.168.1.9", EndIP: "192.168.1.10"}},
	}
	if msg := validateDHCPServer(ok); msg != "" {
		t.Errorf("192.168.1.9 – 192.168.1.10 is a valid range, got: %s", msg)
	}

	backwards := dhcpServerInput{
		Interface: "dmz", Netmask: "255.255.255.0",
		IPRanges: []dhcpRangeInput{{StartIP: "10.0.0.50", EndIP: "10.0.0.20"}},
	}
	if msg := validateDHCPServer(backwards); msg == "" {
		t.Error("a range that ends before it starts was accepted")
	}
}

func TestValidateDHCPServer_ABlockedMACNeedsNoAddress(t *testing.T) {
	inp := dhcpServerInput{
		Interface: "dmz", Netmask: "255.255.255.0",
		IPRanges:     []dhcpRangeInput{{StartIP: "10.0.0.1", EndIP: "10.0.0.9"}},
		Reservations: []dhcpReservationInput{{MAC: "00:11:22:33:44:55", Action: "block"}},
	}
	if msg := validateDHCPServer(inp); msg != "" {
		t.Errorf("a blocked MAC has nothing to reserve: %s", msg)
	}
}

func TestIPToUint_RejectsWhatIsNotAnAddress(t *testing.T) {
	for _, s := range []string{"", "10.0.0", "10.0.0.256", "10.0.0.-1", "ten.0.0.1", "10.0.0.1.5"} {
		if _, ok := ipToUint(s); ok {
			t.Errorf("%q parsed as an address", s)
		}
	}
	if v, ok := ipToUint("255.255.255.255"); !ok || v != 4294967295 {
		t.Errorf("255.255.255.255 = %d, %v", v, ok)
	}
}

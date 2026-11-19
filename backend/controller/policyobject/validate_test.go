package policyobject

import "testing"

// These checks must never be STRICTER than FortiOS, only earlier. A rule that rejects something the
// device would have accepted breaks a workflow that used to work, which is worse than the round
// trip it saves — so every "invalid" case below is one the firewall answers with an error code, and
// every "valid" case is one the console creates today.

func TestValidateFortiName(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		valid bool
	}{
		{"ordinary", "LAN-Subnet", true},
		{"dots and colons are used by real objects", "srv.example.com:8080", true},
		{"underscores", "AI_Generated_Addr_1", true},
		{"empty", "", false},
		{"a space", "LAN Subnet", false},
		{"a double quote would end the CLI argument early", `evil" edit "other`, false},
		{"a semicolon", "addr;reboot", false},
		{"a newline", "addr\nnext", false},
		{"79 characters is the limit", string(make([]byte, 0, 79)) + strings79(), true},
		{"80 is one too many", strings79() + "x", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFortiName("name", tc.in)
			if tc.valid && err != nil {
				t.Errorf("rejected a name FortiOS accepts: %v", err)
			}
			if !tc.valid && err == nil {
				t.Errorf("accepted %q, which the device would refuse", tc.in)
			}
		})
	}
}

func strings79() string {
	b := make([]byte, 79)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}

func TestValidateSubnet(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		valid bool
	}{
		{"CIDR, what the console sends", "10.0.0.0/24", true},
		{"a single host", "192.168.1.10/32", true},
		{"address and mask, the form FortiOS stores", "10.0.0.0 255.255.255.0", true},
		{"everything", "0.0.0.0/0", true},
		{"empty", "", false},
		{"not an address", "not-a-subnet", false},
		{"prefix out of range", "10.0.0.0/33", false},
		{"octet out of range", "10.0.0.300/24", false},
		{"a non-contiguous mask is not a subnet", "10.0.0.0 255.0.255.0", false},
		{"mask missing", "10.0.0.0 ", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateSubnet("subnet", tc.in)
			if tc.valid && err != nil {
				t.Errorf("rejected %q, which is valid: %v", tc.in, err)
			}
			if !tc.valid && err == nil {
				t.Errorf("accepted %q", tc.in)
			}
		})
	}
}

func TestValidatePortRange(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		valid bool
	}{
		{"blank means the protocol is unused", "", true},
		{"one port", "443", true},
		{"a range", "8000-8100", true},
		{"a list of both", "80,443,8000-8100", true},
		{"the top of the range", "65535", true},
		{"zero is not a port", "0", false},
		{"past the top", "65536", false},
		{"backwards range", "443-80", false},
		{"a stray comma", "80,,443", false},
		{"words", "http", false},
		{"negative", "-1", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePortRange("TCP ports", tc.in)
			if tc.valid && err != nil {
				t.Errorf("rejected %q, which is valid: %v", tc.in, err)
			}
			if !tc.valid && err == nil {
				t.Errorf("accepted %q", tc.in)
			}
		})
	}
}

// The per-type rules. The point of switching on `type` is that a field which is required for one
// kind of address is absent by design for another — validating them all would reject valid objects.
func TestValidateAddressInput_OnlyChecksFieldsTheTypeUses(t *testing.T) {
	cases := []struct {
		name  string
		in    addressInput
		valid bool
	}{
		{"ipmask needs a subnet", addressInput{Name: "a", Type: "ipmask", Subnet: "10.0.0.0/24"}, true},
		{"ipmask without one", addressInput{Name: "a", Type: "ipmask"}, false},
		{"a blank type defaults to ipmask", addressInput{Name: "a", Subnet: "10.0.0.0/24"}, true},
		{"iprange needs both ends", addressInput{Name: "a", Type: "iprange", StartIP: "10.0.0.1", EndIP: "10.0.0.9"}, true},
		{"iprange missing the end", addressInput{Name: "a", Type: "iprange", StartIP: "10.0.0.1"}, false},
		{"fqdn has no subnet and that is fine", addressInput{Name: "a", Type: "fqdn"}, true},
		{"geography has no subnet either", addressInput{Name: "a", Type: "geography", Country: "TH"}, true},
		{"a bad name fails whatever the type", addressInput{Name: "bad name", Type: "fqdn"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAddressInput(tc.in)
			if tc.valid && err != nil {
				t.Errorf("rejected a valid %s address: %v", tc.in.Type, err)
			}
			if !tc.valid && err == nil {
				t.Errorf("accepted an invalid %s address", tc.in.Type)
			}
		})
	}
}

func TestValidateServiceInput(t *testing.T) {
	if err := validateServiceInput(serviceInput{Name: "HTTPS-ALT", TCPPorts: "8443"}); err != nil {
		t.Errorf("rejected a valid service: %v", err)
	}
	// A service that sets only UDP is normal; the empty TCP field must not fail it.
	if err := validateServiceInput(serviceInput{Name: "DNS", UDPPorts: "53"}); err != nil {
		t.Errorf("rejected a UDP-only service: %v", err)
	}
	if err := validateServiceInput(serviceInput{Name: "X", TCPPorts: "80-"}); err == nil {
		t.Error("accepted an unterminated port range")
	}
}

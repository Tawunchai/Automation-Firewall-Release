package policyobject

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

// Input validation for the device-proxy writes.
//
// Everything in this layer used to be forwarded to FortiOS unchecked and the device asked to
// adjudicate. That works, in the sense that nothing invalid lands — but it costs a round trip to a
// firewall for every typo, and the answer comes back as a number:
//
//	-5    an object with that name already exists
//	-3    entry not found in datasource
//	-651  the name contains a character the device reserves
//
// which the operator sees instead of "that name is already taken". The checks here are the ones the
// device would have applied anyway, done before the request leaves — they never accept something
// FortiOS would reject, so nothing that worked before stops working.
//
// The model is services.ValidateDiagTarget, which guards the ping/traceroute target: an allow-list
// of characters rather than an escape routine, because the safe answer to "what if it contains a
// newline" is that it cannot.

// fortiNameMaxLen is FortiOS's limit for an object name (firewall address, service, policy name,
// profile). Longer names are truncated or rejected depending on the table; either way the operator
// should hear about it here.
const fortiNameMaxLen = 79

// fortiNamePattern is what may appear in an object name.
//
// Letters, digits, and the punctuation FortiGate's own GUI allows. Deliberately excludes whitespace
// and the shell/CLI metacharacters — an object name reaches the device's CLI in `edit "<name>"` on
// the configuration-deploy path, and a name containing a quote would end the argument early.
var fortiNamePattern = regexp.MustCompile(`^[A-Za-z0-9._:@\-]+$`)

// ValidateFortiName checks a user-supplied object name.
func ValidateFortiName(field, name string) error {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return fmt.Errorf("%s is required", field)
	case len(name) > fortiNameMaxLen:
		return fmt.Errorf("%s must be %d characters or fewer (got %d)", field, fortiNameMaxLen, len(name))
	case !fortiNamePattern.MatchString(name):
		return fmt.Errorf(
			"%s may contain only letters, digits, and . _ - : @ — no spaces or quotes", field)
	}
	return nil
}

// ValidateSubnet checks an address object's subnet.
//
// FortiOS accepts both "10.0.0.0/24" and "10.0.0.0 255.255.255.0" and stores the second form, so
// both are allowed here — rejecting the CIDR the whole console types would be a regression, and
// rejecting the mask form would break anything reading a value back off the device.
func ValidateSubnet(field, subnet string) error {
	subnet = strings.TrimSpace(subnet)
	if subnet == "" {
		return fmt.Errorf("%s is required", field)
	}

	if strings.Contains(subnet, "/") {
		if _, _, err := net.ParseCIDR(subnet); err != nil {
			return fmt.Errorf("%s must be a subnet such as 10.0.0.0/24", field)
		}
		return nil
	}

	// "address mask" — both halves must be IPv4, and the mask must be a real one.
	parts := strings.Fields(subnet)
	if len(parts) != 2 {
		return fmt.Errorf("%s must be a subnet such as 10.0.0.0/24 or 10.0.0.0 255.255.255.0", field)
	}
	if net.ParseIP(parts[0]).To4() == nil {
		return fmt.Errorf("%s: %q is not an IPv4 address", field, parts[0])
	}
	mask := net.ParseIP(parts[1]).To4()
	if mask == nil {
		return fmt.Errorf("%s: %q is not a subnet mask", field, parts[1])
	}
	if ones, bits := net.IPv4Mask(mask[0], mask[1], mask[2], mask[3]).Size(); bits == 0 || ones > bits {
		// Size() returns 0,0 for a mask with non-contiguous bits, e.g. 255.0.255.0.
		return fmt.Errorf("%s: %q is not a valid subnet mask", field, parts[1])
	}
	return nil
}

// ValidatePortRange checks a service object's port specification: "80", "80-90", "80,443,8000-8100".
//
// Empty is allowed — a TCP/UDP/SCTP service sets only the protocols it uses, and the form leaves
// the others blank.
func ValidatePortRange(field, spec string) error {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return nil
	}

	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return fmt.Errorf("%s has an empty entry — check for a stray comma", field)
		}

		lo, hi, isRange := strings.Cut(part, "-")
		low, err := parsePort(field, lo)
		if err != nil {
			return err
		}
		if !isRange {
			continue
		}
		high, err := parsePort(field, hi)
		if err != nil {
			return err
		}
		if high < low {
			return fmt.Errorf("%s: the range %q ends before it starts", field, part)
		}
	}
	return nil
}

func parsePort(field, raw string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 1 || n > 65535 {
		return 0, fmt.Errorf("%s: %q is not a port number between 1 and 65535", field, strings.TrimSpace(raw))
	}
	return n, nil
}

// ValidateIPv4 checks a single IPv4 address (a VIP's mapped address, a route gateway).
func ValidateIPv4(field, ip string) error {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return fmt.Errorf("%s is required", field)
	}
	if net.ParseIP(ip).To4() == nil {
		return fmt.Errorf("%s must be an IPv4 address (got %q)", field, ip)
	}
	return nil
}

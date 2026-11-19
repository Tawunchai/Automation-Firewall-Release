package policyobject

import "strings"

// Per-input validation for the two object types the console creates most.
//
// Kept separate from validate.go so the reusable checks stay reusable and the shape-specific rules
// — which fields matter for which `type` — live next to the input structs they read.
//
// Scope is deliberate: address and service. Those are the objects an operator types by hand, dozens
// at a time, and the ones the AI Assistant creates in bulk as policy prerequisites. Policies
// themselves reference objects by name and are validated by the device against what actually
// exists, which is a check nothing here could reproduce without asking the device anyway.

func validateAddressInput(inp addressInput) error {
	if err := ValidateFortiName("name", inp.Name); err != nil {
		return err
	}

	// Only the fields the chosen type actually uses. Validating `subnet` on a geography address
	// would reject a valid object for having an empty field it does not have.
	switch strings.ToLower(strings.TrimSpace(inp.Type)) {
	case "", "ipmask", "subnet":
		return ValidateSubnet("subnet", inp.Subnet)
	case "iprange":
		if err := ValidateIPv4("start IP", inp.StartIP); err != nil {
			return err
		}
		return ValidateIPv4("end IP", inp.EndIP)
	default:
		// fqdn, geography, mac, dynamic, interface-subnet: their fields are free text, a country
		// code, or a datasource key the device resolves. Left to FortiOS, which is the only thing
		// that knows whether a Fabric connector or a country code exists.
		return nil
	}
}

func validateServiceInput(inp serviceInput) error {
	if err := ValidateFortiName("name", inp.Name); err != nil {
		return err
	}
	if err := ValidatePortRange("TCP ports", inp.TCPPorts); err != nil {
		return err
	}
	if err := ValidatePortRange("UDP ports", inp.UDPPorts); err != nil {
		return err
	}
	return ValidatePortRange("SCTP ports", inp.SCTPPorts)
}

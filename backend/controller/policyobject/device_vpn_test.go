package policyobject

import (
	"errors"
	"fmt"
	"testing"

	"network_automation/services"
)

// The device's answer to "delete something that isn't there" is HTTP 404 with an EMPTY error body
// — no -3, no message — so services.do() renders it as "error code 0 (HTTP 404)". Both helpers
// below are read off that string, and getting either backwards is silent: the tunnel deletes
// cleanly and leaves objects behind, which then break the next create with -5/-34.
//
// (Measured live on FGT80E 7.2.10:
//
//	DELETE /api/v2/cmdb/firewall/addrgrp/NOPE  → {"status":"error","http_status":404}  )
const deviceNotFoundErr = "FortiGate API error: error code 0 (HTTP 404)"

func TestIsGoneErr(t *testing.T) {
	gone := []error{
		nil, // nothing to delete
		// errors.New, not fmt.Errorf: these are literal device messages, and a device message is
		// allowed to contain a percent sign. Passing one as a format string would rewrite it into
		// "%!d(MISSING)" and the test would be asserting on something the device never said.
		errors.New(deviceNotFoundErr),
		errors.New("FortiGate API error: entry not found (HTTP 404)"),
		errors.New("FortiGate API error: error code -3 (HTTP 500)"),
		// The shape the device really produces, with the code carried rather than spelled out.
		&services.DeviceError{Code: -3, HTTPStatus: 500, Text: "entry not found in datasource"},
		&services.DeviceError{Code: 0, HTTPStatus: 404, Text: "error code 0"},
	}
	for _, err := range gone {
		if !isGoneErr(err) {
			t.Errorf("isGoneErr(%v) = false, want true — the object is already off the device", err)
		}
	}

	// A reference error is NOT "gone": the object is still there and still in use, and the user
	// needs to hear about it.
	stillThere := errors.New("FortiGate API error: The entry is used by other 1 entries (HTTP 500)")
	if isGoneErr(stillThere) {
		t.Error("isGoneErr treated a -23 in-use error as success — the object survives silently")
	}

	// The codes that merely LOOK like -3 or -15 to a substring search. Each one is a delete that
	// failed and was reported as done, leaving the object on the firewall for the next create to
	// collide with.
	for _, err := range []error{
		&services.DeviceError{Code: -38, HTTPStatus: 500, Text: "error code -38"},
		&services.DeviceError{Code: -150, HTTPStatus: 500, Text: "error code -150"},
		&services.DeviceError{Code: -23, HTTPStatus: 500, Text: "error code -23"},
	} {
		if isGoneErr(err) {
			t.Errorf("isGoneErr(%v) = true — the object is still on the device", err)
		}
	}
}

func TestIsDuplicateErr(t *testing.T) {
	for _, err := range []error{
		fmt.Errorf("FortiGate API error: error code -5 (HTTP 500)"),
		fmt.Errorf("FortiGate API error: duplicate name (HTTP 500)"),
		fmt.Errorf("FortiGate API error: entry already exists (HTTP 500)"),
	} {
		if !isDuplicateErr(err) {
			t.Errorf("isDuplicateErr(%v) = false, want true", err)
		}
	}
	if isDuplicateErr(nil) {
		t.Error("isDuplicateErr(nil) = true")
	}
	// A 404 is the opposite of a duplicate — mixing them up makes a create swallow a real failure.
	if isDuplicateErr(errors.New(deviceNotFoundErr)) {
		t.Error("isDuplicateErr matched the device's not-found answer")
	}

	// The failures that are NOT duplicates but used to read as one, because the check searched the
	// message for the substring "-5". Every entry here is a real write that was discarded by the
	// firewall while the VPN wizard went on to build policies pointing at the object it thought it
	// had just created.
	for _, err := range []error{
		&services.DeviceError{Code: -518, HTTPStatus: 500, Text: "error code -518"},
		&services.DeviceError{Code: -56, HTTPStatus: 500, Text: "error code -56"},
		&services.DeviceError{Code: -8, HTTPStatus: 500, Text: `invalid value for "spoke-5"`},
	} {
		if isDuplicateErr(err) {
			t.Errorf("isDuplicateErr(%v) = true — only -5 is a duplicate", err)
		}
	}
}

func TestDefaultLocalInterface(t *testing.T) {
	if got := defaultLocalInterface("lan", "port1"); got != "lan" {
		t.Errorf("= %q, want the chosen local interface", got)
	}
	// Blank Local interface → the policies still need both ends, so fall back to the outgoing one.
	for _, blank := range []string{"", "   "} {
		if got := defaultLocalInterface(blank, "port1"); got != "port1" {
			t.Errorf("defaultLocalInterface(%q) = %q, want the fallback", blank, got)
		}
	}
}

func TestCleanSubnets(t *testing.T) {
	got := cleanSubnets([]string{" 192.168.1.0/24 ", "", "   ", "10.0.0.0/8"})
	if len(got) != 2 || got[0] != "192.168.1.0/24" || got[1] != "10.0.0.0/8" {
		t.Errorf("cleanSubnets = %#v", got)
	}
	if got := cleanSubnets(nil); got == nil || len(got) != 0 {
		t.Errorf("cleanSubnets(nil) = %#v, want an empty slice (it is marshalled to JSON)", got)
	}
}

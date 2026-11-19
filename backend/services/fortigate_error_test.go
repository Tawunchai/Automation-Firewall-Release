package services

import (
	"errors"
	"fmt"
	"testing"
)

// Telling one FortiOS refusal from another.
//
// These are the tests for a class of bug that produced NO error anywhere. Several creates and
// deletes deliberately swallow one specific refusal — "already exists" makes a re-run safe, "no
// such object" makes a delete idempotent — and they decided which one they had by searching the
// message for "-5" or "-3". Every case below marked "must not" is a message that search said yes
// to, so a genuine failure was recorded as success and the flow carried on to build things on top
// of an object that had never been created.

func TestDuplicateIsCodeMinusFiveAndNothingElse(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			"the duplicate itself",
			&DeviceError{Code: -5, HTTPStatus: 500, Text: "error code -5"},
			true,
		},
		{
			// Exactly what the lab device returns for a re-created address, verified live.
			"a duplicate that has been wrapped on its way up",
			fmt.Errorf("create address %q: %w", "web-servers", &DeviceError{Code: -5, HTTPStatus: 500, Text: "error code -5"}),
			true,
		},
		{
			// The one that made this worth fixing. -518 is a real user-group failure this repo
			// documents; "-518" contains "-5", so the old test read a discarded write as a
			// successful one.
			"-518, a discarded write",
			// Rendered the way the device sends it when there is no cli_error, which is the
			// shape that made the old substring search say yes: "error code -518" contains "-5".
			&DeviceError{Code: -518, HTTPStatus: 500, Text: "error code -518"},
			false,
		},
		{
			// The Web Rating Override page's own error, for a category the device does not know.
			"-56, an unknown category",
			&DeviceError{Code: -56, HTTPStatus: 500, Text: "error code -56"},
			false,
		},
		{
			"-50, in the same decade as -5",
			&DeviceError{Code: -50, HTTPStatus: 500, Text: "error code -50"},
			false,
		},
		{
			// A cli_error quotes the administrator's own input back. An object called `site-5` or
			// a port range written `1-5` put the substring in the message with no -5 anywhere near
			// it.
			"a message that merely CONTAINS -5",
			&DeviceError{Code: -8, HTTPStatus: 500, Text: `__convert_cmdb_value: invalid value for "site-5"`},
			false,
		},
		{
			"the device phrasing it in words instead",
			errors.New("FortiGate API error: duplicate entry (HTTP 500)"),
			true,
		},
		{
			"a transport failure, where the device said nothing at all",
			errors.New("FortiGate API request failed: dial tcp 10.0.99.201:443: i/o timeout"),
			false,
		},
		{"no error", nil, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsDuplicateObjectError(tc.err); got != tc.want {
				t.Errorf("IsDuplicateObjectError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestGoneIsTheCodesAndPhrasesThatMeanGone(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			"-3, entry not found in datasource",
			&DeviceError{Code: -3, HTTPStatus: 500, Text: "entry not found in datasource"},
			true,
		},
		{
			"-15, no such node",
			&DeviceError{Code: -15, HTTPStatus: 500, Text: "error code -15"},
			true,
		},
		{
			// What a DELETE of a missing mkey really answers — verified live on the lab device: a
			// 404 with no error code at all.
			"a by-key 404 with no code",
			&DeviceError{Code: 0, HTTPStatus: 404, Text: "error code 0"},
			true,
		},
		{
			// -30 … -39 all contain "-3". A delete that failed for one of these reported success
			// and the object stayed on the firewall.
			"-38 is not -3",
			&DeviceError{Code: -38, HTTPStatus: 500, Text: "error code -38"},
			false,
		},
		{
			"-150 is not -15",
			&DeviceError{Code: -150, HTTPStatus: 500, Text: "error code -150"},
			false,
		},
		{
			"a permission failure is not a missing object",
			&DeviceError{Code: -37, HTTPStatus: 403, Text: "error code -37"},
			false,
		},
		{"no error is not evidence of anything", nil, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsObjectGoneError(tc.err); got != tc.want {
				t.Errorf("IsObjectGoneError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestDeviceErrorCodeSurvivesWrapping(t *testing.T) {
	// Domain calls add context with %w (services.DeleteLDAPServer is one), and the controllers
	// then read the code out. errors.As is what makes that work through any depth.
	deep := fmt.Errorf("deleting the tunnel: %w",
		fmt.Errorf("failed to delete LDAP server %q: %w", "ldap-1",
			&DeviceError{Code: -23, HTTPStatus: 500, Text: "error code -23"}))

	code, ok := DeviceErrorCode(deep)
	if !ok || code != FGErrStillReferenced {
		t.Errorf("DeviceErrorCode = (%d, %v), want (-23, true) through two layers of wrapping", code, ok)
	}
}

func TestDeviceErrorCodeReadsAFlattenedMessage(t *testing.T) {
	// Some paths hand the error on as text. The pattern is anchored on the words fgErrorText
	// writes, so it reads the code and cannot be fooled by a longer number.
	for _, tc := range []struct {
		msg  string
		want int
	}{
		{"FortiGate API error: error code -5 (HTTP 500)", -5},
		{"FortiGate API error: error code -518 (HTTP 500)", -518},
		{`failed to create address "site-5": FortiGate API error: error code -3 (HTTP 500)`, -3},
	} {
		got, ok := DeviceErrorCode(errors.New(tc.msg))
		if !ok || got != tc.want {
			t.Errorf("DeviceErrorCode(%q) = (%d, %v), want (%d, true)", tc.msg, got, ok, tc.want)
		}
	}

	// A message with no code must say so rather than guess one out of the text.
	if _, ok := DeviceErrorCode(errors.New(`invalid value for "site-5"`)); ok {
		t.Error("a message with no error code was read as having one — a hyphenated NAME is not a code")
	}
}

func TestDeviceErrorRendersTheSameStringItAlwaysDid(t *testing.T) {
	// The message is what reaches the UI, the logs, the Change Ledger and every existing
	// text-based check. Introducing the type must not have reworded anything.
	de := &DeviceError{Code: -8, HTTPStatus: 500, Text: "__convert_cmdb_value: invalid ip address not-an-ip."}
	want := "FortiGate API error: __convert_cmdb_value: invalid ip address not-an-ip. (HTTP 500)"
	if got := de.Error(); got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

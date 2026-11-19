package policyobject

import (
	"encoding/json"
	"testing"

	"network_automation/services"
)

// DeviceUpdatePolicy used to build a brand-new FGPolicy from whatever the PATCH body carried, Go
// zero-values filling in every field the caller never mentioned (`enabled` defaulting to true,
// `nat` defaulting to false), then PUT the whole thing — a full replace wearing a PATCH's name. A
// live test found exactly what that does: a PATCH that only meant to touch a comment silently
// re-enabled a disabled policy, because "not sent" and "sent false" look identical once bound into
// a plain bool. buildPolicyUpdateAttrs is the fix, and these tests are what it has to keep true:
// an attribute reaches the device if and only if its JSON key was actually in the request body.

// parseBody is the same two-unmarshal step DeviceUpdatePolicy does on a real request.
func parseBody(t *testing.T, raw string) (policyInput, map[string]json.RawMessage) {
	t.Helper()
	var inp policyInput
	if err := json.Unmarshal([]byte(raw), &inp); err != nil {
		t.Fatalf("unmarshal into policyInput: %v", err)
	}
	var present map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &present); err != nil {
		t.Fatalf("unmarshal into present: %v", err)
	}
	return inp, present
}

func TestBuildPolicyUpdateAttrs_CommentOnlyTouchesNothingElse(t *testing.T) {
	inp, present := parseBody(t, `{"comments":"updated by audit"}`)
	attrs := buildPolicyUpdateAttrs(inp, present)

	if len(attrs) != 1 {
		t.Fatalf("expected exactly one attribute, got %v", attrs)
	}
	if attrs["comments"] != "updated by audit" {
		t.Errorf("comments not set correctly: %v", attrs["comments"])
	}
	for _, untouched := range []string{"status", "nat", "srcintf", "dstintf", "service"} {
		if _, present := attrs[untouched]; present {
			t.Errorf("a comments-only PATCH must not touch %q, but it is in the attrs map", untouched)
		}
	}
}

func TestBuildPolicyUpdateAttrs_OmittingEnabledMustNotReEnableADisabledPolicy(t *testing.T) {
	// This is the exact failure the live test found: a PATCH with no "enabled" key used to default
	// to enabled:true. It must now be entirely absent from attrs, so the device keeps the policy
	// disabled.
	inp, present := parseBody(t, `{"comments":"x","src_intf":"port1","dst_intf":"port2"}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	if _, present := attrs["status"]; present {
		t.Errorf("status must not appear when \"enabled\" was never sent, got %v", attrs["status"])
	}
}

func TestBuildPolicyUpdateAttrs_ExplicitEnabledFalseIsHonoured(t *testing.T) {
	inp, present := parseBody(t, `{"enabled":false}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	if attrs["status"] != "disable" {
		t.Errorf("expected status=disable, got %v", attrs["status"])
	}
}

func TestBuildPolicyUpdateAttrs_NatOnlyDoesNotResetInterfacesOrAddresses(t *testing.T) {
	inp, present := parseBody(t, `{"nat":true}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	if len(attrs) != 1 || attrs["nat"] != "enable" {
		t.Fatalf("expected only nat=enable, got %v", attrs)
	}
}

func TestBuildPolicyUpdateAttrs_NatOmittedIsNeverSentAsFalse(t *testing.T) {
	// nat is a plain bool (Go zero value false), same trap as enabled — only `present` tells the
	// two apart.
	inp, present := parseBody(t, `{"comments":"x"}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	if _, present := attrs["nat"]; present {
		t.Errorf("nat must not appear when it was never sent, got %v", attrs["nat"])
	}
}

func TestBuildPolicyUpdateAttrs_InterfacesOmittedNeverSendsAnEmptyList(t *testing.T) {
	// The other half of the same live bug: omitting src_intf/dst_intf used to send an EMPTY
	// interface list, which FortiOS rejects with -651. Omitted now means "not in attrs at all".
	inp, present := parseBody(t, `{"comments":"x"}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	for _, k := range []string{"srcintf", "dstintf"} {
		if _, present := attrs[k]; present {
			t.Errorf("%q must not appear when no interface field was sent, got %v", k, attrs[k])
		}
	}
}

func TestBuildPolicyUpdateAttrs_EmptyBodyProducesNoAttrs(t *testing.T) {
	inp, present := parseBody(t, `{}`)
	if attrs := buildPolicyUpdateAttrs(inp, present); len(attrs) != 0 {
		t.Errorf("an empty PATCH body must produce no attributes, got %v", attrs)
	}
}

func TestBuildPolicyUpdateAttrs_FullPayloadMatchesTheOldFullReplaceShape(t *testing.T) {
	// The one caller in production today (the firewall-policy form) always resends every field —
	// this pins that the new partial-update code produces the same values for that existing case.
	raw := `{
		"name":"edge-allow","src_intf":"port1","dst_intf":"port2",
		"src_addr":["all"],"dst_addr":["all"],"service":["ALL"],
		"schedule":"always","action":"accept","nat":true,"log_traffic":"all",
		"enabled":true,"comments":"full form resend",
		"av_profile":"default","webfilter_profile":"","dnsfilter_profile":"",
		"app_control":"","ips_sensor":"","file_filter_profile":""
	}`
	inp, present := parseBody(t, raw)
	attrs := buildPolicyUpdateAttrs(inp, present)

	want := map[string]any{
		"name":       "edge-allow",
		"schedule":   "always",
		"action":     "accept",
		"nat":        "enable",
		"logtraffic": "all",
		"status":     "enable",
		"comments":   "full form resend",
		"av-profile": "default",
		"utm-status": "enable", // only av_profile is non-empty, but one is enough
	}
	for k, v := range want {
		if attrs[k] != v {
			t.Errorf("%s: expected %v, got %v", k, v, attrs[k])
		}
	}
	srcIntf, ok := attrs["srcintf"].([]services.FGName)
	if !ok || len(srcIntf) != 1 || srcIntf[0].Name != "port1" {
		t.Errorf("srcintf not built correctly: %v", attrs["srcintf"])
	}
}

func TestBuildPolicyUpdateAttrs_PartialProfileChangeLeavesUtmStatusAlone(t *testing.T) {
	// Only one of the six profile fields is sent — utm-status cannot be correctly recomputed from
	// that alone, so it must be left off the attrs map entirely rather than guessed.
	inp, present := parseBody(t, `{"ips_sensor":"clduat_ips"}`)
	attrs := buildPolicyUpdateAttrs(inp, present)
	if _, present := attrs["utm-status"]; present {
		t.Errorf("utm-status must not be touched by a single-profile-field PATCH, got %v", attrs["utm-status"])
	}
	if attrs["ips-sensor"] != "clduat_ips" {
		t.Errorf("ips-sensor not set: %v", attrs["ips-sensor"])
	}
}

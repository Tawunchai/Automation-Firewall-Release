package services

import (
	"encoding/json"
	"testing"
)

// The create response's "objects" map is what Fallback/undo walks to remove exactly what an Apply
// put on the device, so a name in it must correspond to something that really exists. It used to be
// emitted straight from VPNObjectNamesFor / RemoteAccessObjectNamesFor, which DERIVE every possible
// name from the tunnel name — so a Site-to-Site create always advertised
// "<tunnel>_remote_gateway" even though that address is only built in "Use Remote" mode (confirmed
// live: the object 404s, `show firewall address <tunnel>_remote_gateway` → "entry not found").
//
// The handlers now blank the fields whose object their options did not build; omitempty keeps those
// blanks out of the JSON entirely, so undo never sees a phantom.

func objectKeys(t *testing.T, v interface{}) map[string]string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]string
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

// Phase1/phase2 always exist — they are the tunnel. Everything else is conditional.
func TestVPNObjectNames_OnlyPhasesAreMandatory(t *testing.T) {
	keys := objectKeys(t, VPNObjectNames{Phase1: "T", Phase2: "T"})

	if keys["phase1"] != "T" || keys["phase2"] != "T" {
		t.Errorf("phases = %v", keys)
	}
	for _, k := range []string{
		"local_address", "remote_address", "remote_gateway_address",
		"policy_local_to_remote", "policy_remote_to_local",
	} {
		if _, present := keys[k]; present {
			t.Errorf("%q must be omitted when it was not created", k)
		}
	}
}

// The reported bug: a Site-to-Site tunnel that is not in "Use Remote" mode and had policies turned
// off must advertise neither the gateway address nor the policies.
func TestVPNObjectNames_SiteToSiteWithoutOptionalObjects(t *testing.T) {
	n := VPNObjectNamesFor("S2S")
	n.RemoteGatewayAddr = ""                              // not "Use Remote"
	n.PolicyLocalToRemote, n.PolicyRemoteToLocal = "", "" // "create firewall policies" off

	keys := objectKeys(t, n)
	if _, present := keys["remote_gateway_address"]; present {
		t.Error("remote_gateway_address leaked into the response for a non Use-Remote tunnel")
	}
	if _, present := keys["policy_local_to_remote"]; present {
		t.Error("policy names leaked when policy creation was off")
	}
	// The addresses it DID build must still be reported, or undo would leave them behind.
	if keys["local_address"] != "S2S_local" || keys["remote_address"] != "S2S_remote" {
		t.Errorf("selector addresses = %v, want both reported", keys)
	}
}

// A FortiClient/Cisco tunnel is IKE mode-config: no L2TP policy exists for it, and no split group
// unless split tunnelling was enabled.
func TestRemoteAccessObjectNames_ModeConfigHasNoL2TPPolicy(t *testing.T) {
	ra := RemoteAccessObjectNamesFor("RA")
	ra.PolicyL2TP = ""
	ra.SplitGroup = "" // split tunnel off

	keys := objectKeys(t, ra)
	if _, present := keys["policy_l2tp"]; present {
		t.Error("policy_l2tp must not be reported for a mode-config client")
	}
	if _, present := keys["split_group"]; present {
		t.Error("split_group must not be reported when split tunnelling is off")
	}
	if keys["client_range"] != "RA_range" || keys["policy_remote_to_local"] != "vpn_RA_remote" {
		t.Errorf("always-built objects missing: %v", keys)
	}
}

// Android/Windows are L2TP: the L2TP policy IS real, the split group never is.
func TestRemoteAccessObjectNames_L2TPReportsItsPolicy(t *testing.T) {
	ra := RemoteAccessObjectNamesFor("NAT1VE")
	ra.SplitGroup = ""

	keys := objectKeys(t, ra)
	if keys["policy_l2tp"] != "vpn_NAT1VE_l2tp" {
		t.Errorf("policy_l2tp = %q, want it reported for an L2TP tunnel", keys["policy_l2tp"])
	}
	if _, present := keys["split_group"]; present {
		t.Error("L2TP has no split tunnel, so split_group must be omitted")
	}
}

// The derivation itself must not drift — the frontend Review step computes the same strings.
func TestObjectNameDerivation_Unchanged(t *testing.T) {
	n := VPNObjectNamesFor("T")
	for _, tc := range []struct{ got, want string }{
		{n.LocalAddress, "T_local"},
		{n.RemoteAddress, "T_remote"},
		{n.RemoteGatewayAddr, "T_remote_gateway"},
		{n.PolicyLocalToRemote, "vpn_T_local"},
		{n.PolicyRemoteToLocal, "vpn_T_remote"},
	} {
		if tc.got != tc.want {
			t.Errorf("got %q, want %q", tc.got, tc.want)
		}
	}

	ra := RemoteAccessObjectNamesFor("T")
	for _, tc := range []struct{ got, want string }{
		{ra.ClientRange, "T_range"},
		{ra.SplitGroup, "T_split"},
		{ra.PolicyL2TP, "vpn_T_l2tp"},
		{ra.PolicyRemoteToLocal, "vpn_T_remote"},
	} {
		if tc.got != tc.want {
			t.Errorf("got %q, want %q", tc.got, tc.want)
		}
	}
}

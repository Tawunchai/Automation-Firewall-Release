package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// The VPN Creation Wizard's Site-to-Site mapping, pinned to what a live FortiGate 7.2.10
// (FGT80E) accepted and read back:
//
//	NAT config "No NAT between sites"          → type=static,  nattraversal=enable
//	NAT config "This site is behind NAT"       → type=static,  nattraversal=forced
//	NAT config "The remote site is behind NAT" → type=dynamic  (the GUI calls this "Dialup")
//	Remote device "IP Address"                 → type=static + remote-gw
//	Remote device "Dynamic DNS"                → type=ddns   + remotegw-ddns
//	Auth "Pre-shared Key"                      → authmethod=psk + psksecret
//	Auth "Signature"                           → authmethod=signature + certificate[{name}]
//	                                             + peertype=peer + peer=<name>_peer
//
// Also pinned: the device rejects a duplicate remote gateway with -34, which is why the wizard
// must not be the only thing standing between the user and that error.

func ipsecW(over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	w := FGIPsecTunnelWrite{
		Name: "HQ-to-Branch", Interface: "port1",
		RemoteGW: "10.10.10.254", PSK: "P@ssw0rd123",
		LocalSubnets: []string{"192.168.1.0/24"}, RemoteSubnets: []string{"192.168.9.0/24"},
	}
	if over != nil {
		over(&w)
	}
	return w
}

// ─── phase1 payload: the remote end ──────────────────────────────────────────

func TestIPsecPhase1Payload_StaticIP(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(nil))
	if p["type"] != "static" {
		t.Errorf("type = %v, want static", p["type"])
	}
	if p["remote-gw"] != "10.10.10.254" {
		t.Errorf("remote-gw = %v", p["remote-gw"])
	}
	if _, ok := p["remotegw-ddns"]; ok {
		t.Error("remotegw-ddns must not be sent for an IP-address remote")
	}
	// The wizard hides these; they must still be pinned to sane values.
	if p["ike-version"] != ipsecDefaultIKE || p["proposal"] != ipsecDefaultProposal || p["dhgrp"] != ipsecDefaultDHGroup {
		t.Errorf("defaults drifted: ike=%v proposal=%v dh=%v", p["ike-version"], p["proposal"], p["dhgrp"])
	}
	if p["vdom"] != "root" {
		t.Error("create needs vdom in the body")
	}
}

// "The remote site is behind NAT" — the GUI re-titles its diagram "Dialup" because the remote
// has no address to dial. Sending a remote-gw here would be meaningless.
func TestIPsecPhase1Payload_RemoteBehindNATIsDialup(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) {
		w.RemoteType = "dynamic"
		w.RemoteGW = "10.10.10.254" // the wizard may still hold a stale value
	}))
	if p["type"] != "dynamic" {
		t.Errorf("type = %v, want dynamic (dialup)", p["type"])
	}
	if _, ok := p["remote-gw"]; ok {
		t.Errorf("remote-gw must not be sent for a dialup tunnel, got %v", p["remote-gw"])
	}
}

func TestIPsecPhase1Payload_DynamicDNS(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) {
		w.RemoteType = "ddns"
		w.RemoteDDNS = "branch.example.com"
	}))
	if p["type"] != "ddns" {
		t.Errorf("type = %v, want ddns", p["type"])
	}
	if p["remotegw-ddns"] != "branch.example.com" {
		t.Errorf("remotegw-ddns = %v", p["remotegw-ddns"])
	}
	if _, ok := p["remote-gw"]; ok {
		t.Error("remote-gw must not be sent for a DDNS remote")
	}
}

// ─── phase1 payload: NAT configuration ───────────────────────────────────────

func TestIPsecPhase1Payload_NATTraversal(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},             // "No NAT between sites" → leave the device default (enable)
		{"enable", "enable"}, // explicit
		{"forced", "forced"}, // "This site is behind NAT"
		{"disable", "disable"},
		{"bogus", ""}, // never pass junk through to the device
	}
	for _, c := range cases {
		p := ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) { w.NATTraversal = c.in }))
		got, present := p["nattraversal"]
		if c.want == "" {
			if present {
				t.Errorf("nattraversal %q: sent %v, want the field omitted", c.in, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("nattraversal %q → %v, want %v", c.in, got, c.want)
		}
	}
}

// ─── phase1 payload: authentication ──────────────────────────────────────────

func TestIPsecPhase1Payload_PSK(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(nil))
	if p["authmethod"] != "psk" || p["psksecret"] != "P@ssw0rd123" {
		t.Errorf("authmethod=%v psksecret set=%v", p["authmethod"], p["psksecret"] != nil)
	}
	if _, ok := p["certificate"]; ok {
		t.Error("certificate must not be sent for PSK auth")
	}
	if p["peertype"] != "any" {
		t.Errorf("peertype = %v, want any", p["peertype"])
	}
}

func TestIPsecPhase1Payload_Signature(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) {
		w.AuthMethod = "signature"
		w.Certificate = "Fortinet_Factory"
		w.PeerCA = "Fortinet_CA"
	}))
	if p["authmethod"] != "signature" {
		t.Errorf("authmethod = %v", p["authmethod"])
	}
	if _, ok := p["psksecret"]; ok {
		t.Error("psksecret must not be sent for signature auth")
	}
	// certificate is a member table of up to 4 personal certificates.
	certs, ok := p["certificate"].([]map[string]interface{})
	if !ok || len(certs) != 1 || certs[0]["name"] != "Fortinet_Factory" {
		t.Fatalf("certificate = %#v, want a one-entry member table", p["certificate"])
	}
	// The CA is NOT a phase1 field — it rides on a user.peer this tunnel creates.
	if p["peertype"] != "peer" || p["peer"] != "HQ-to-Branch_peer" {
		t.Errorf("peer wiring = %v/%v, want peer/HQ-to-Branch_peer", p["peertype"], p["peer"])
	}
}

// Signature WITHOUT a peer CA is legal — the remote's cert is then not pinned to a CA, and there
// is no user.peer to reference.
func TestIPsecPhase1Payload_SignatureNoCA(t *testing.T) {
	p := ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) {
		w.AuthMethod = "signature"
		w.Certificate = "Fortinet_Factory"
	}))
	if p["peertype"] != "any" {
		t.Errorf("peertype = %v, want any when no CA is pinned", p["peertype"])
	}
	if _, ok := p["peer"]; ok {
		t.Error("peer must not be referenced when no CA was chosen")
	}
}

func TestIPsecPhase1Payload_MarshalsToFortiOSShape(t *testing.T) {
	b, err := json.Marshal(ipsecPhase1Payload(ipsecW(func(w *FGIPsecTunnelWrite) {
		w.RemoteType = "ddns"
		w.RemoteDDNS = "branch.example.com"
		w.NATTraversal = "forced"
	})))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{`"type":"ddns"`, `"remotegw-ddns":"branch.example.com"`, `"nattraversal":"forced"`, `"net-device":"disable"`} {
		if !strings.Contains(s, want) {
			t.Errorf("payload missing %s: %s", want, s)
		}
	}
}

func TestIPsecPeerName(t *testing.T) {
	if got := ipsecPeerName("HQ-to-Branch"); got != "HQ-to-Branch_peer" {
		t.Errorf("ipsecPeerName = %q", got)
	}
}

// ─── validation ──────────────────────────────────────────────────────────────

func TestValidateIPsecTunnel(t *testing.T) {
	cases := []struct {
		name    string
		w       FGIPsecTunnelWrite
		wantErr string // substring; "" = must pass
	}{
		{"valid site-to-site PSK", ipsecW(nil), ""},
		{"no name", ipsecW(func(w *FGIPsecTunnelWrite) { w.Name = " " }), "name is required"},
		{"no interface", ipsecW(func(w *FGIPsecTunnelWrite) { w.Interface = "" }), "outgoing interface"},
		{"static needs a remote IP", ipsecW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "" }), "remote IP address is required"},
		{"remote IP must be an IP", ipsecW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "branch.example.com" }), "not a valid IP"},
		{"dialup needs no remote IP", ipsecW(func(w *FGIPsecTunnelWrite) {
			w.RemoteType = "dynamic"
			w.RemoteGW = ""
		}), ""},
		{"ddns needs an FQDN", ipsecW(func(w *FGIPsecTunnelWrite) {
			w.RemoteType = "ddns"
			w.RemoteGW = ""
		}), "FQDN is required"},
		{"ddns with an FQDN", ipsecW(func(w *FGIPsecTunnelWrite) {
			w.RemoteType = "ddns"
			w.RemoteGW = ""
			w.RemoteDDNS = "branch.example.com"
		}), ""},
		{"bad remote type", ipsecW(func(w *FGIPsecTunnelWrite) { w.RemoteType = "carrier-pigeon" }), "invalid remote type"},
		{"bad nat traversal", ipsecW(func(w *FGIPsecTunnelWrite) { w.NATTraversal = "maybe" }), "invalid NAT traversal"},
		{"psk required", ipsecW(func(w *FGIPsecTunnelWrite) { w.PSK = "" }), "pre-shared key is required"},
		{"signature needs a certificate", ipsecW(func(w *FGIPsecTunnelWrite) {
			w.AuthMethod = "signature"
			w.PSK = ""
		}), "certificate name is required"},
		{"signature with a certificate needs no psk", ipsecW(func(w *FGIPsecTunnelWrite) {
			w.AuthMethod = "signature"
			w.PSK = ""
			w.Certificate = "Fortinet_Factory"
		}), ""},
		{"bad auth method", ipsecW(func(w *FGIPsecTunnelWrite) { w.AuthMethod = "vibes" }), "invalid authentication method"},
		{"bad subnet", ipsecW(func(w *FGIPsecTunnelWrite) { w.LocalSubnets = []string{"nope"} }), "not a valid CIDR"},
		{"bad prefix length", ipsecW(func(w *FGIPsecTunnelWrite) { w.RemoteSubnets = []string{"192.168.9.0/33"} }), "not a valid CIDR"},
		// A bare host is legal — FortiOS stores it as a /32 selector.
		{"bare host subnet", ipsecW(func(w *FGIPsecTunnelWrite) { w.RemoteSubnets = []string{"192.168.9.7"} }), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateIPsecTunnel(c.w)
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want no error, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, c.wantErr)
			}
		})
	}
}

// Pins the lenient/strict split that made ValidateIPsecTunnel wrong once: CIDRToFGSubnet passes
// junk through unchanged, so only isValidSubnetSpec may be used to judge input.
func TestIsValidSubnetSpec(t *testing.T) {
	for _, ok := range []string{"192.168.1.0/24", "10.0.0.1", "10.0.0.0 255.255.255.0", "0.0.0.0/0", " 10.1.1.0/24 "} {
		if !isValidSubnetSpec(ok) {
			t.Errorf("isValidSubnetSpec(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "   ", "nope", "192.168.9.0/33", "999.1.1.1", "10.0.0.0/24/8"} {
		if isValidSubnetSpec(bad) {
			t.Errorf("isValidSubnetSpec(%q) = true", bad)
		}
	}
	// The trap itself: the converter is not a validator.
	if CIDRToFGSubnet("nope") != "nope" {
		t.Error("CIDRToFGSubnet stopped passing junk through — re-check the validators that rely on it")
	}
}

func TestIPsecVocabularies(t *testing.T) {
	for _, ok := range []string{"static", "dynamic", "ddns", "DDNS", " static "} {
		if !isValidIPsecRemoteType(ok) {
			t.Errorf("isValidIPsecRemoteType(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "dialup", "site-to-site"} {
		if isValidIPsecRemoteType(bad) {
			t.Errorf("isValidIPsecRemoteType(%q) = true", bad)
		}
	}
	for _, ok := range []string{"enable", "disable", "forced"} {
		if !isValidIPsecNATTraversal(ok) {
			t.Errorf("isValidIPsecNATTraversal(%q) = false", ok)
		}
	}
	for _, ok := range []string{"psk", "signature"} {
		if !isValidIPsecAuthMethod(ok) {
			t.Errorf("isValidIPsecAuthMethod(%q) = false", ok)
		}
	}
	if isValidIPsecAuthMethod("certificate") {
		t.Error("\"certificate\" is not the CMDB word — it is \"signature\"")
	}
}

// ─── object naming ───────────────────────────────────────────────────────────

// Lifted verbatim from the FortiGate wizard's own "Review Settings → Object Summary" screen for a
// tunnel named VPN_TEST. The frontend's Review step computes these same names from the same rule
// (ipsec-wizard-rules.ts → vpnObjectNames, pinned by its own test): the summary is what the user
// approves before pressing Create, so a name that drifts on either side is a lie on screen.
func TestVPNObjectNamesFor(t *testing.T) {
	got := VPNObjectNamesFor("VPN_TEST")
	want := VPNObjectNames{
		Phase1:              "VPN_TEST",
		Phase2:              "VPN_TEST",
		LocalAddress:        "VPN_TEST_local",
		RemoteAddress:       "VPN_TEST_remote",
		RemoteGatewayAddr:   "VPN_TEST_remote_gateway",
		PolicyLocalToRemote: "vpn_VPN_TEST_local",
		PolicyRemoteToLocal: "vpn_VPN_TEST_remote",
	}
	if got != want {
		t.Errorf("VPNObjectNamesFor:\n got  %+v\n want %+v", got, want)
	}
}

// ─── router lookup ───────────────────────────────────────────────────────────

func TestRouterLookup_RejectsNonIPWithoutCallingTheDevice(t *testing.T) {
	// BaseURL is deliberately unreachable: a bad destination must never reach the wire.
	fc := &FortiClient{BaseURL: "https://127.0.0.1:1"}
	for _, bad := range []string{"", "branch.example.com", "999.1.1.1", "10.0.0.0/24"} {
		if _, err := fc.RouterLookup(bad); err == nil {
			t.Errorf("RouterLookup(%q) = no error, want a validation error", bad)
		}
	}
}

func TestRouterLookup_ParsesTheDeviceAnswer(t *testing.T) {
	// The exact shape monitor/router/lookup returned live for 8.8.8.8 on the lab device.
	fc, calls, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/router/lookup": map[string]interface{}{
			"success": true, "network": "0.0.0.0/0", "gateway": "10.0.99.1", "interface": "port1",
		},
	})
	defer done()

	lk, err := fc.RouterLookup("8.8.8.8")
	if err != nil {
		t.Fatalf("RouterLookup: %v", err)
	}
	if !lk.Success || lk.Interface != "port1" || lk.Gateway != "10.0.99.1" || lk.Network != "0.0.0.0/0" {
		t.Errorf("lookup = %+v", lk)
	}
	c := findCall(*calls, "GET", "/api/v2/monitor/router/lookup")
	if c == nil || !strings.Contains(c.Path, "destination=8.8.8.8") {
		t.Errorf("destination not passed through: %+v", *calls)
	}
}

func TestGetVPNWizardMetadata_FiltersTheCABundle(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/system/available-certificates": []map[string]interface{}{
			{"name": "Fortinet_Factory", "source": "factory"},
			{"name": "Fortinet_SSL", "source": "factory"},
		},
		"GET /api/v2/cmdb/vpn.certificate/ca": []map[string]interface{}{
			{"name": "Fortinet_CA", "source": "factory"},
			{"name": "Fortinet_CA2", "source": "factory"},
			// The device carries the whole public root store; the GUI lists none of it.
			{"name": "DigiCert_Global_Root_CA", "source": "bundle"},
			{"name": "ISRG_Root_X1", "source": "bundle"},
		},
		"GET /api/v2/monitor/router/lookup": map[string]interface{}{
			"success": true, "network": "0.0.0.0/0", "gateway": "10.0.99.1", "interface": "port1",
		},
	})
	defer done()

	meta := fc.GetVPNWizardMetadata()
	if len(meta.Certificates) != 2 {
		t.Errorf("certificates = %#v", meta.Certificates)
	}
	if len(meta.CACertificates) != 2 {
		t.Fatalf("ca_certificates = %#v, want only the 2 non-bundle CAs", meta.CACertificates)
	}
	for _, n := range meta.CACertificates {
		if strings.Contains(n, "DigiCert") || strings.Contains(n, "ISRG") {
			t.Errorf("the public root bundle leaked into the peer CA picker: %v", meta.CACertificates)
		}
	}
	// Local Gateway prefill for "Internet Access: Use Remote".
	if meta.DefaultGateway != "10.0.99.1" {
		t.Errorf("default_gateway = %q, want the device's default gateway", meta.DefaultGateway)
	}
}

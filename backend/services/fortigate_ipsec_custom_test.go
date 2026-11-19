package services

import (
	"testing"
)

// The Custom template's phase1/phase2 mapping, pinned to what a live FortiGate 7.2.10 (FGT80E)
// accepted and read back for vpn.ipsec/phase1-interface + phase2-interface. See applyCustomPhase1
// and customPhase2Payload for the CMDB key each field maps to.

func cxW(over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	w := FGIPsecTunnelWrite{
		Name: "CX_Test", Interface: "port1",
		IKEVersion: "1", RemoteType: "static", RemoteGW: "10.10.10.250",
		NATTraversal: "forced", AuthMethod: "psk", PSK: "Custom12345678",
		Proposal: "aes128-sha256 aes256-sha256", DHGroup: "14 5",
		Comments: "custom verify",
		Custom: &FGIPsecCustom{
			IPVersion: "4", ModeConfig: false,
			Keepalive: "15", DPD: "on-idle", DPDRetryCount: "4", DPDRetryInterval: "25",
			IKEMode: "aggressive", PeerType: "one", PeerID: "BranchID", LocalID: "HQ-ID", Keylife: "28800",
			P2LocalSubnet: "192.168.10.0/24", P2RemoteSubnet: "192.168.20.0/24",
			P2Proposal: "aes256-sha256", P2Replay: true, P2PFS: true, P2DHGroup: "14 5",
			P2LocalPort: "0", P2RemotePort: "0", P2Protocol: "0",
			P2AutoNegotiate: true, P2Keepalive: true, P2KeylifeSeconds: "43200",
		},
	}
	if over != nil {
		over(&w)
	}
	return w
}

func TestCustomPhase1Payload_AllFields(t *testing.T) {
	p := ipsecPhase1Payload(cxW(nil))

	want := map[string]interface{}{
		"ip-version": "4", "type": "static", "interface": "port1",
		"remote-gw": "10.10.10.250", "nattraversal": "forced",
		"authmethod": "psk", "keylife": 28800,
		"mode": "aggressive", "peertype": "one", "peerid": "BranchID", "localid": "HQ-ID",
		"dpd": "on-idle", "dpd-retrycount": 4, "dpd-retryinterval": 25, "keepalive": 15,
		"mode-cfg": "disable",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("phase1[%s] = %v (%T), want %v (%T)", k, p[k], p[k], v, v)
		}
	}
	if p["psksecret"] != "Custom12345678" {
		t.Errorf("psksecret not carried through, got %v", p["psksecret"])
	}
	// A group name / peer ID forces peertype=one — main mode identifies a peer only by IP.
	if p["peertype"] != "one" {
		t.Errorf("a peer ID must set peertype=one, got %v", p["peertype"])
	}
}

func TestCustomPhase1_ModeOnlyOnIKEv1(t *testing.T) {
	// IKEv2 rejects `mode`; it must never be sent there even when the state carries one.
	p := ipsecPhase1Payload(cxW(func(w *FGIPsecTunnelWrite) {
		w.IKEVersion = "2"
		w.Custom.IKEMode = "aggressive"
	}))
	if _, ok := p["mode"]; ok {
		t.Errorf("mode must not be sent on IKEv2, got %v", p["mode"])
	}
	if p["ike-version"] != "2" {
		t.Errorf("ike-version = %v, want 2", p["ike-version"])
	}
}

func TestCustomPhase1_DPDDisabledDropsRetries(t *testing.T) {
	p := ipsecPhase1Payload(cxW(func(w *FGIPsecTunnelWrite) { w.Custom.DPD = "disable" }))
	if p["dpd"] != "disable" {
		t.Errorf("dpd = %v, want disable", p["dpd"])
	}
	for _, k := range []string{"dpd-retrycount", "dpd-retryinterval"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must not be sent when DPD is disabled, got %v", k, p[k])
		}
	}
}

func TestCustomPhase1_PeerTypeAnyOmitsPeerID(t *testing.T) {
	// The base payload's peertype is "any"; a Custom form that didn't pick "Specify a peer ID"
	// leaves it there and sends no peerid.
	p := ipsecPhase1Payload(cxW(func(w *FGIPsecTunnelWrite) {
		w.Custom.PeerType = "any"
		w.Custom.PeerID = ""
	}))
	if p["peertype"] != "any" {
		t.Errorf("peertype = %v, want any", p["peertype"])
	}
	if _, ok := p["peerid"]; ok {
		t.Errorf("peerid must not be sent for peertype=any, got %v", p["peerid"])
	}
}

func TestCustomPhase1_LocalGatewayOnlyWhenSpecified(t *testing.T) {
	// Primary IP (blank local gateway) leaves local-gw at the device default.
	p := ipsecPhase1Payload(cxW(nil))
	if _, ok := p["local-gw"]; ok {
		t.Errorf("local-gw must not be sent when using Primary IP, got %v", p["local-gw"])
	}
	// Specify sends it.
	p2 := ipsecPhase1Payload(cxW(func(w *FGIPsecTunnelWrite) { w.Custom.LocalGateway = "10.0.99.5" }))
	if p2["local-gw"] != "10.0.99.5" {
		t.Errorf("local-gw = %v, want 10.0.99.5", p2["local-gw"])
	}
}

func TestCustomPhase1_AdvancedPointers(t *testing.T) {
	// nil pointers leave the device default (nothing sent); a set pointer sends enable/disable.
	p := ipsecPhase1Payload(cxW(nil))
	if _, ok := p["add-route"]; ok {
		t.Errorf("add-route must be omitted when AddRoute is nil, got %v", p["add-route"])
	}
	yes := true
	p2 := ipsecPhase1Payload(cxW(func(w *FGIPsecTunnelWrite) {
		w.Custom.AddRoute = &yes
		w.Custom.NetDevice = &yes
		w.Custom.AutoDiscoverySender = true
	}))
	if p2["add-route"] != "enable" {
		t.Errorf("add-route = %v, want enable", p2["add-route"])
	}
	if p2["net-device"] != "enable" {
		t.Errorf("net-device = %v, want enable", p2["net-device"])
	}
	if p2["auto-discovery-sender"] != "enable" {
		t.Errorf("auto-discovery-sender = %v, want enable", p2["auto-discovery-sender"])
	}
}

func TestCustomPhase2Payload_AllFields(t *testing.T) {
	p2 := customPhase2Payload(cxW(nil))

	want := map[string]interface{}{
		"name": "CX_Test", "phase1name": "CX_Test",
		"proposal":   "aes256-sha256",
		"src-subnet": "192.168.10.0 255.255.255.0", "dst-subnet": "192.168.20.0 255.255.255.0",
		"pfs": "enable", "replay": "enable", "auto-negotiate": "enable", "keepalive": "enable",
		"dhgrp": "14 5", "keylife-type": "seconds",
		"src-port": 0, "dst-port": 0, "protocol": 0, "keylifeseconds": 43200,
	}
	for k, v := range want {
		if p2[k] != v {
			t.Errorf("phase2[%s] = %v (%T), want %v (%T)", k, p2[k], p2[k], v, v)
		}
	}
}

func TestCustomPhase2_PFSOffDropsDHGroup(t *testing.T) {
	// With PFS off the device ignores dhgrp, so it must not be sent.
	p2 := customPhase2Payload(cxW(func(w *FGIPsecTunnelWrite) {
		w.Custom.P2PFS = false
		w.Custom.P2DHGroup = "14 5"
	}))
	if p2["pfs"] != "disable" {
		t.Errorf("pfs = %v, want disable", p2["pfs"])
	}
	if _, ok := p2["dhgrp"]; ok {
		t.Errorf("dhgrp must not be sent when PFS is off, got %v", p2["dhgrp"])
	}
}

func TestCustomPhase2_EmptySubnetsDefaultToAny(t *testing.T) {
	p2 := customPhase2Payload(cxW(func(w *FGIPsecTunnelWrite) {
		w.Custom.P2LocalSubnet = ""
		w.Custom.P2RemoteSubnet = ""
	}))
	if p2["src-subnet"] != "0.0.0.0 0.0.0.0" {
		t.Errorf("empty local subnet should default to 0.0.0.0/0, got %v", p2["src-subnet"])
	}
	if p2["dst-subnet"] != "0.0.0.0 0.0.0.0" {
		t.Errorf("empty remote subnet should default to 0.0.0.0/0, got %v", p2["dst-subnet"])
	}
}

func TestValidateCustom(t *testing.T) {
	// A fully-filled Custom config is valid.
	if err := ValidateIPsecTunnel(cxW(nil)); err != nil {
		t.Errorf("a complete custom config should validate, got: %v", err)
	}
	// Static gateway needs a valid IP.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "" })); err == nil {
		t.Error("a static gateway with no IP should fail")
	}
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "nope" })); err == nil {
		t.Error("a static gateway with a junk IP should fail")
	}
	// Dialup User needs no remote address.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) {
		w.RemoteType = "dynamic"
		w.RemoteGW = ""
	})); err != nil {
		t.Errorf("a dialup custom tunnel needs no remote gateway, got: %v", err)
	}
	// DDNS needs an FQDN.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) {
		w.RemoteType = "ddns"
		w.RemoteGW = ""
		w.RemoteDDNS = ""
	})); err == nil {
		t.Error("a DDNS gateway with no FQDN should fail")
	}
	// PSK required.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.PSK = "" })); err == nil {
		t.Error("a PSK tunnel with no secret should fail")
	}
	// Signature needs a certificate.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) {
		w.AuthMethod = "signature"
		w.PSK = ""
		w.Certificate = ""
	})); err == nil {
		t.Error("a signature tunnel with no certificate should fail")
	}
	// "Specify a peer ID" needs the ID.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) {
		w.Custom.PeerType = "one"
		w.Custom.PeerID = ""
	})); err == nil {
		t.Error("peertype=one with no peer ID should fail")
	}
	// A bad phase2 subnet is caught.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.Custom.P2LocalSubnet = "nope" })); err == nil {
		t.Error("an invalid phase2 subnet should fail")
	}
}

// v6W is a valid IPv6 custom tunnel (remote-gw6 + subnet6 selectors).
func v6W(over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	return cxW(func(w *FGIPsecTunnelWrite) {
		w.RemoteGW = "2001:db8:0:1::1"
		w.Custom.IPVersion = "6"
		w.Custom.P2LocalSubnet = "2001:db8:0:10::/64"
		w.Custom.P2RemoteSubnet = "2001:db8:0:20::/64"
		if over != nil {
			over(w)
		}
	})
}

func TestCustomPhase1_IPv6(t *testing.T) {
	p := ipsecPhase1Payload(v6W(func(w *FGIPsecTunnelWrite) { w.Custom.LocalGateway = "2001:db8:0:1::2" }))
	if p["ip-version"] != "6" {
		t.Errorf("ip-version = %v, want 6", p["ip-version"])
	}
	if p["remote-gw6"] != "2001:db8:0:1::1" {
		t.Errorf("remote-gw6 = %v, want 2001:db8:0:1::1", p["remote-gw6"])
	}
	// The IPv4 gateway key must NOT be sent on an IPv6 tunnel.
	if _, ok := p["remote-gw"]; ok {
		t.Errorf("remote-gw must not be sent on an IPv6 tunnel, got %v", p["remote-gw"])
	}
	if p["local-gw6"] != "2001:db8:0:1::2" {
		t.Errorf("local-gw6 = %v, want 2001:db8:0:1::2", p["local-gw6"])
	}
	if _, ok := p["local-gw"]; ok {
		t.Errorf("local-gw (v4) must not be sent on an IPv6 tunnel, got %v", p["local-gw"])
	}
}

func TestCustomPhase2_IPv6(t *testing.T) {
	p2 := customPhase2Payload(v6W(nil))
	want := map[string]interface{}{
		"src-addr-type": "subnet6", "dst-addr-type": "subnet6",
		"src-subnet6": "2001:db8:0:10::/64", "dst-subnet6": "2001:db8:0:20::/64",
	}
	for k, v := range want {
		if p2[k] != v {
			t.Errorf("phase2[%s] = %v, want %v", k, p2[k], v)
		}
	}
	// The IPv4 selector keys must be absent.
	for _, k := range []string{"src-subnet", "dst-subnet"} {
		if _, ok := p2[k]; ok {
			t.Errorf("%s must not be sent on an IPv6 tunnel, got %v", k, p2[k])
		}
	}
}

func TestValidateCustom_IPv6(t *testing.T) {
	if err := ValidateIPsecTunnel(v6W(nil)); err != nil {
		t.Errorf("a valid IPv6 custom tunnel should validate, got: %v", err)
	}
	// An IPv4 gateway on an IPv6 tunnel is a family mismatch.
	if err := ValidateIPsecTunnel(v6W(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "10.0.0.1" })); err == nil {
		t.Error("an IPv4 remote gateway on an IPv6 tunnel should fail")
	}
	// …and vice-versa: an IPv6 gateway on an IPv4 tunnel.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "2001:db8::1" })); err == nil {
		t.Error("an IPv6 remote gateway on an IPv4 tunnel should fail")
	}
	// An invalid IP version.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.Custom.IPVersion = "5" })); err == nil {
		t.Error("IP version 5 should be rejected")
	}
}

func TestValidateCustom_EditingSkipsPSK(t *testing.T) {
	// On a create, a blank PSK fails.
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) { w.PSK = "" })); err == nil {
		t.Error("a create with a blank PSK should fail")
	}
	// On an edit, a blank PSK is fine (it keeps the stored secret).
	if err := ValidateIPsecTunnel(cxW(func(w *FGIPsecTunnelWrite) {
		w.PSK = ""
		w.Editing = true
	})); err != nil {
		t.Errorf("an edit with a blank PSK should pass, got: %v", err)
	}
}

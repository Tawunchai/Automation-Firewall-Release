package services

import (
	"strings"
	"testing"
)

// The VPN Creation Wizard's Remote Access (dialup FortiClient) mapping, pinned to what a live
// FortiGate 7.2.10 (FGT80E) accepted and read back for vpn.ipsec/phase1-interface:
//
//	type=dynamic + mode-cfg=enable                → a dialup listener that hands out addresses
//	assign-ip-from=range + ipv4-start/end/netmask → the client IP pool (Client Address Range)
//	authusrgrp + xauthtype=auto (PSK)             → clients authenticate against the User Group
//	dns-mode auto|manual (+ ipv4-dns-server1)     → Use System DNS / Specify
//	ipv4-split-include=<addrgrp>                  → split tunnel (omitted for a full tunnel)
//	save-password / client-auto-negotiate / client-keep-alive → the three Client Options

func raW(over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	w := FGIPsecTunnelWrite{
		Name: "VPN_Remote", Interface: "port1",
		RemoteType: "dynamic", RemoteAccess: true,
		AuthMethod: "psk", PSK: "P@ssw0rd123",
		UserGroup:        "Guest-group",
		ClientRangeStart: "10.10.70.1", ClientRangeEnd: "10.10.70.254", ClientNetmask: "255.255.255.0",
		DNSMode:     "auto",
		SplitTunnel: true, SplitGroup: "VPN_Remote_split",
		SavePassword: true, AutoConnect: false, AlwaysUp: false,
	}
	if over != nil {
		over(&w)
	}
	return w
}

func TestIPsecPhase1Payload_RemoteAccessPSK(t *testing.T) {
	p := ipsecPhase1Payload(raW(nil))

	want := map[string]interface{}{
		"type": "dynamic", "mode-cfg": "enable", "net-device": "disable",
		"assign-ip": "enable", "assign-ip-from": "range",
		"ipv4-start-ip": "10.10.70.1", "ipv4-end-ip": "10.10.70.254", "ipv4-netmask": "255.255.255.0",
		"authusrgrp": "Guest-group", "xauthtype": "auto",
		"dns-mode": "auto", "ipv4-split-include": "VPN_Remote_split",
		"save-password": "enable", "client-auto-negotiate": "disable", "client-keep-alive": "disable",
		"authmethod": "psk",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v, want %v", k, p[k], v)
		}
	}
	// A dialup listener has no gateway to dial.
	if _, ok := p["remote-gw"]; ok {
		t.Errorf("remote-gw must not be sent for a dialup tunnel, got %v", p["remote-gw"])
	}
	if p["psksecret"] != "P@ssw0rd123" {
		t.Errorf("psksecret not carried through")
	}
	// dns-mode auto pushes the system resolvers — no explicit server.
	if _, ok := p["ipv4-dns-server1"]; ok {
		t.Errorf("ipv4-dns-server1 must not be sent when DNS mode is auto")
	}
}

func TestIPsecPhase1Payload_RemoteAccessFullTunnel(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.SplitTunnel = false
		w.SplitGroup = ""
	}))
	if _, ok := p["ipv4-split-include"]; ok {
		t.Errorf("ipv4-split-include must be omitted for a full tunnel, got %v", p["ipv4-split-include"])
	}
	// Still a dialup mode-config listener.
	if p["type"] != "dynamic" || p["mode-cfg"] != "enable" {
		t.Errorf("full-tunnel RA is still dialup mode-config: type=%v mode-cfg=%v", p["type"], p["mode-cfg"])
	}
}

func TestIPsecPhase1Payload_RemoteAccessManualDNS(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.DNSMode = "manual"
		w.DNSServer = "8.8.8.8"
	}))
	if p["dns-mode"] != "manual" || p["ipv4-dns-server1"] != "8.8.8.8" {
		t.Errorf("manual DNS = %v/%v, want manual/8.8.8.8", p["dns-mode"], p["ipv4-dns-server1"])
	}
}

func TestIPsecPhase1Payload_RemoteAccessSignature(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.AuthMethod = "signature"
		w.PSK = ""
		w.Certificate = "Fortinet_Factory"
	}))
	if p["authmethod"] != "signature" {
		t.Errorf("authmethod = %v, want signature", p["authmethod"])
	}
	// A certificate IS the client auth — no XAUTH is layered on for signature dialup.
	if _, ok := p["xauthtype"]; ok {
		t.Errorf("xauthtype must not be set for a signature tunnel, got %v", p["xauthtype"])
	}
	if _, ok := p["certificate"]; !ok {
		t.Error("certificate member table must be present for signature auth")
	}
	// The user group still gates who may connect.
	if p["authusrgrp"] != "Guest-group" {
		t.Errorf("authusrgrp = %v, want Guest-group", p["authusrgrp"])
	}
}

func TestIPsecPhase1Payload_RemoteAccessClientOptions(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.SavePassword = false
		w.AutoConnect = true
		w.AlwaysUp = true
	}))
	if p["save-password"] != "disable" || p["client-auto-negotiate"] != "enable" || p["client-keep-alive"] != "enable" {
		t.Errorf("client options = save=%v auto=%v keep=%v", p["save-password"], p["client-auto-negotiate"], p["client-keep-alive"])
	}
}

// ─── Cisco IPsec Client ──────────────────────────────────────────────────────
//
// Verified live on FGT80E/7.2.10 by POSTing both variants and reading them back:
//
//	Group Name required → mode=aggressive, peertype=one, peerid=<name>
//	Group Name off      → mode=main,       peertype=any, peerid=""
//	both                → unity-support=enable, and NO client options
//
// Why aggressive: a group name is an IKE identifier, and IKEv1 MAIN mode identifies a peer only by
// its IP address — there is nowhere to carry the name. Aggressive mode sends it in packet one.

func ciscoW(over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	return raW(func(w *FGIPsecTunnelWrite) {
		w.RAClient = "cisco"
		w.ClientNetmask = "255.255.255.255"
		if over != nil {
			over(w)
		}
	})
}

func TestIPsecPhase1Payload_CiscoWithGroupName(t *testing.T) {
	p := ipsecPhase1Payload(ciscoW(func(w *FGIPsecTunnelWrite) {
		w.RequireGroupName = true
		w.GroupName = "SalesGroup"
	}))
	want := map[string]interface{}{
		"mode": "aggressive", "peertype": "one", "peerid": "SalesGroup", "unity-support": "enable",
		// still a dialup mode-config listener with XAUTH against the user group
		"type": "dynamic", "mode-cfg": "enable", "xauthtype": "auto", "authusrgrp": "Guest-group",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v, want %v", k, p[k], v)
		}
	}
	// The Cisco template has no Client Options step — those keys must not be sent at all.
	for _, k := range []string{"save-password", "client-auto-negotiate", "client-keep-alive"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must not be sent for a Cisco tunnel, got %v", k, p[k])
		}
	}
}

func TestIPsecPhase1Payload_CiscoWithoutGroupName(t *testing.T) {
	p := ipsecPhase1Payload(ciscoW(nil))
	if p["mode"] != "main" {
		t.Errorf("mode = %v, want main when no group name is required", p["mode"])
	}
	// peertype stays the dialup default; no identifier to match on.
	if p["peertype"] != "any" {
		t.Errorf("peertype = %v, want any", p["peertype"])
	}
	if _, ok := p["peerid"]; ok {
		t.Errorf("peerid must not be sent when no group name is required, got %v", p["peerid"])
	}
	if p["unity-support"] != "enable" {
		t.Errorf("unity-support = %v, want enable for a Cisco client", p["unity-support"])
	}
}

// A group name the user typed but then un-ticked must not leak into the tunnel.
func TestIPsecPhase1Payload_CiscoStaleGroupNameIgnored(t *testing.T) {
	p := ipsecPhase1Payload(ciscoW(func(w *FGIPsecTunnelWrite) {
		w.RequireGroupName = false
		w.GroupName = "SalesGroup" // stale
	}))
	if p["mode"] != "main" || p["peertype"] == "one" {
		t.Errorf("stale group name changed the tunnel: mode=%v peertype=%v", p["mode"], p["peertype"])
	}
	if _, ok := p["peerid"]; ok {
		t.Errorf("stale peerid leaked: %v", p["peerid"])
	}
}

// FortiClient must NOT get the Cisco-only keys.
func TestIPsecPhase1Payload_FortiClientHasNoCiscoKeys(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) { w.RAClient = "forticlient" }))
	for _, k := range []string{"peerid", "unity-support", "mode"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must not be sent for a FortiClient tunnel, got %v", k, p[k])
		}
	}
}

func TestValidateRemoteAccess_Cisco(t *testing.T) {
	cases := []struct {
		name    string
		w       FGIPsecTunnelWrite
		wantErr string
	}{
		{"cisco without a group name", ciscoW(nil), ""},
		{"cisco with a group name", ciscoW(func(w *FGIPsecTunnelWrite) {
			w.RequireGroupName = true
			w.GroupName = "SalesGroup"
		}), ""},
		{"group name required but empty", ciscoW(func(w *FGIPsecTunnelWrite) {
			w.RequireGroupName = true
			w.GroupName = "  "
		}), "group name is required"},
		{"bad client", raW(func(w *FGIPsecTunnelWrite) { w.RAClient = "openvpn" }), "invalid remote access client"},
		// FortiClient never carries a group name, so an empty one is not an error there.
		{"forticlient ignores the group flag", raW(func(w *FGIPsecTunnelWrite) { w.RequireGroupName = true }), ""},
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

func TestIsValidRemoteAccessClient(t *testing.T) {
	// All five remote device types the wizard offers are valid; see TestRemoteAccessClientFamilies
	// for which of them are Native (L2TP) rather than mode-config dialup.
	for _, ok := range []string{"forticlient", "cisco", "Cisco", " forticlient ", "ios", "android", "windows"} {
		if !isValidRemoteAccessClient(ok) {
			t.Errorf("isValidRemoteAccessClient(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "openvpn", "wireguard", "sslvpn"} {
		if isValidRemoteAccessClient(bad) {
			t.Errorf("isValidRemoteAccessClient(%q) = true", bad)
		}
	}
}

// ─── Native (iOS / Android / Windows) — L2TP over IPsec ──────────────────────
//
// Every value below was read back VERBATIM from a tunnel the FortiGate's own Native wizard created
// (FGT80E/7.2.10). This is a different tunnel technology from the client-based templates, not a
// different client — hence no mode-config, no XAUTH and no user group on phase1 at all.

func nativeW(os string, over func(*FGIPsecTunnelWrite)) FGIPsecTunnelWrite {
	return raW(func(w *FGIPsecTunnelWrite) {
		w.RAClient = os
		w.SplitTunnel = false
		w.SplitGroup = ""
		w.ClientNetmask = "255.255.255.0"
		if over != nil {
			over(w)
		}
	})
}

func TestIPsecPhase1Payload_NativeL2TP(t *testing.T) {
	// ⚠️ iOS is deliberately NOT in this list — see TestIPsecPhase1Payload_IOSIsModeConfigNotL2TP.
	for _, os := range []string{"android", "windows"} {
		t.Run(os, func(t *testing.T) {
			p := ipsecPhase1Payload(nativeW(os, nil))
			want := map[string]interface{}{
				"type": "dynamic", "mode": "main", "peertype": "any", "net-device": "disable",
				"nattraversal": "enable", "dpd": "on-demand",
				// Legacy crypto — all the OS-built-in clients speak.
				"proposal": ipsecNativeProposal, "dhgrp": ipsecNativeP1DHGroup, "ike-version": ipsecRAIKE,
			}
			for k, v := range want {
				if p[k] != v {
					t.Errorf("%s = %v, want %v", k, p[k], v)
				}
			}
			// ★ The whole point: the L2TP server does addressing + user auth, so phase1 must carry
			// NONE of the mode-config machinery. A phase1 that also offers mode-config hands the
			// client two conflicting addresses and never comes up.
			for _, k := range []string{
				"mode-cfg", "assign-ip", "assign-ip-from", "ipv4-start-ip", "ipv4-end-ip",
				"ipv4-netmask", "dns-mode", "authusrgrp", "xauthtype", "ipv4-split-include",
				"save-password", "client-auto-negotiate", "client-keep-alive", "peerid",
			} {
				if _, ok := p[k]; ok {
					t.Errorf("%s must NOT be sent on a Native L2TP phase1, got %v", k, p[k])
				}
			}
			if _, ok := p["remote-gw"]; ok {
				t.Error("remote-gw must not be sent for a dialup listener")
			}
		})
	}
}

// The user group is still required — it just lives on `vpn l2tp`, not on phase1.
func TestValidateRemoteAccess_NativeStillNeedsAUserGroup(t *testing.T) {
	if err := ValidateIPsecTunnel(nativeW("android", nil)); err != nil {
		t.Fatalf("valid native config rejected: %v", err)
	}
	err := ValidateIPsecTunnel(nativeW("android", func(w *FGIPsecTunnelWrite) { w.UserGroup = "" }))
	if err == nil || !strings.Contains(err.Error(), "user group is required") {
		t.Errorf("error = %v, want it to mention the user group", err)
	}
}

func TestValidateRemoteAccess_NativeNeedsAUsableMask(t *testing.T) {
	err := ValidateIPsecTunnel(nativeW("ios", func(w *FGIPsecTunnelWrite) { w.ClientNetmask = "nope" }))
	if err == nil {
		t.Fatal("a mask that cannot build the L2TP route must be rejected")
	}
}

// ⚠️ The single most surprising fact of the Native template, verified live: the L2TP route's
// destination is the range START masked by the Subnet Mask — NOT the client range.
func TestL2TPRouteDst(t *testing.T) {
	cases := []struct{ start, mask, want string }{
		// The exact pair the device produced: 10.10.70.1 + /16 → 10.10.0.0/16.
		{"10.10.70.1", "255.255.0.0", "10.10.0.0 255.255.0.0"},
		{"10.10.70.1", "255.255.255.0", "10.10.70.0 255.255.255.0"},
		{"192.168.5.100", "255.255.255.0", "192.168.5.0 255.255.255.0"},
		{"10.10.70.1", "255.255.255.255", "10.10.70.1 255.255.255.255"},
		{"10.10.70.1", "255.0.0.0", "10.0.0.0 255.0.0.0"},
		// Junk must produce nothing rather than a bogus route.
		{"nope", "255.255.255.0", ""},
		{"10.10.70.1", "nope", ""},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := L2TPRouteDst(c.start, c.mask); got != c.want {
			t.Errorf("L2TPRouteDst(%q,%q) = %q, want %q", c.start, c.mask, got, c.want)
		}
	}
}

// 🔴 The single most expensive assumption of this whole feature, and it was WRONG: "Native" in the
// GUI does NOT mean L2TP. Only Android and Windows are L2TP; **iOS is an ordinary IKE mode-config
// dialup** (mode-cfg=enable, l2tp=disable, tunnel-mode). Read back from the GUI's own iOS tunnel.
// It is also why the GUI titles iOS "Dialup - iOS (Native)" WITHOUT the "L2TP/IPsec" suffix.
func TestIPsecPhase1Payload_IOSIsModeConfigNotL2TP(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.RAClient = "ios"
		w.ClientNetmask = "255.255.255.0"
	}))
	want := map[string]interface{}{
		"mode-cfg": "enable", "assign-ip": "enable", "assign-ip-from": "range",
		"xauthtype": "auto", "authusrgrp": "Guest-group", "unity-support": "enable",
		"mode": "main", "peertype": "any", "type": "dynamic",
		// iOS's own crypto — it needs the older algorithms and DH group 2 in the list.
		"proposal": "aes256-sha256 aes256-md5 aes256-sha1", "dhgrp": "14 5 2",
		// The GUI groups the tunnel list by this.
		"wizard-type": "dialup-ios",
		// iOS keeps split tunnelling — unlike the L2TP templates.
		"ipv4-split-include": "VPN_Remote_split",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v, want %v", k, p[k], v)
		}
	}
	// iOS has no Client Options step, so those keys must stay at the device default.
	for _, k := range []string{"save-password", "client-auto-negotiate", "client-keep-alive"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must not be sent for iOS (it has no Client Options step), got %v", k, p[k])
		}
	}
}

// iOS offers "Require 'Group Name' on VPN client" exactly as the Cisco template does.
func TestIPsecPhase1Payload_IOSGroupName(t *testing.T) {
	p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) {
		w.RAClient = "ios"
		w.RequireGroupName = true
		w.GroupName = "SalesGroup"
	}))
	if p["mode"] != "aggressive" || p["peertype"] != "one" || p["peerid"] != "SalesGroup" {
		t.Errorf("iOS group name = mode:%v peertype:%v peerid:%v, want aggressive/one/SalesGroup",
			p["mode"], p["peertype"], p["peerid"])
	}
}

// wizard-type is what makes the GUI file a tunnel under its template instead of under "Custom".
func TestRemoteAccessWizardType(t *testing.T) {
	want := map[string]string{
		"forticlient": "dialup-forticlient", "cisco": "dialup-cisco", "ios": "dialup-ios",
		"android": "dialup-android", "windows": "dialup-windows",
		"": "custom", "openvpn": "custom",
	}
	for in, out := range want {
		if got := remoteAccessWizardType(in); got != out {
			t.Errorf("remoteAccessWizardType(%q) = %q, want %q", in, got, out)
		}
	}
	// Every template must stamp it onto phase1.
	for c, wt := range map[string]string{"forticlient": "dialup-forticlient", "cisco": "dialup-cisco",
		"ios": "dialup-ios", "android": "dialup-android", "windows": "dialup-windows"} {
		p := ipsecPhase1Payload(raW(func(w *FGIPsecTunnelWrite) { w.RAClient = c }))
		if p["wizard-type"] != wt {
			t.Errorf("%s phase1 wizard-type = %v, want %q", c, p["wizard-type"], wt)
		}
	}
}

func TestRemoteAccessClientFamilies(t *testing.T) {
	// L2TP family — Android and Windows ONLY.
	for _, n := range []string{"android", "windows", " Android "} {
		if !IsL2TPRemoteAccessClient(n) {
			t.Errorf("IsL2TPRemoteAccessClient(%q) = false", n)
		}
	}
	// 🔴 iOS is under the GUI's "Native" toggle but is NOT L2TP.
	for _, c := range []string{"forticlient", "cisco", "ios", "iOS"} {
		if IsL2TPRemoteAccessClient(c) {
			t.Errorf("IsL2TPRemoteAccessClient(%q) = true — iOS/client-based are mode-config", c)
		}
		if !isValidRemoteAccessClient(c) {
			t.Errorf("isValidRemoteAccessClient(%q) = false", c)
		}
	}
	// Group Name is offered by Cisco and iOS, and by nobody else.
	for _, c := range []string{"cisco", "ios"} {
		if !remoteAccessSupportsGroupName(c) {
			t.Errorf("remoteAccessSupportsGroupName(%q) = false", c)
		}
	}
	for _, c := range []string{"forticlient", "android", "windows", ""} {
		if remoteAccessSupportsGroupName(c) {
			t.Errorf("remoteAccessSupportsGroupName(%q) = true", c)
		}
	}
	if IsL2TPRemoteAccessClient("openvpn") || isValidRemoteAccessClient("openvpn") {
		t.Error("openvpn is not a remote access client here")
	}
}

func TestL2TPInterface(t *testing.T) {
	if L2TPInterface() != "l2t.root" {
		t.Errorf("L2TPInterface() = %q, want l2t.root", L2TPInterface())
	}
}

func TestRemoteAccessObjectNames_IncludeL2TPPolicy(t *testing.T) {
	if got := RemoteAccessObjectNamesFor("Test").PolicyL2TP; got != "vpn_Test_l2tp" {
		t.Errorf("PolicyL2TP = %q, want vpn_Test_l2tp", got)
	}
}

func TestValidateRemoteAccess(t *testing.T) {
	cases := []struct {
		name    string
		w       FGIPsecTunnelWrite
		wantErr string // substring; "" = must pass
	}{
		{"valid FortiClient PSK", raW(nil), ""},
		{"no user group", raW(func(w *FGIPsecTunnelWrite) { w.UserGroup = " " }), "user group is required"},
		{"no range", raW(func(w *FGIPsecTunnelWrite) { w.ClientRangeStart = ""; w.ClientRangeEnd = "" }), "client address range"},
		{"bad range start", raW(func(w *FGIPsecTunnelWrite) { w.ClientRangeStart = "nope" }), "client range start"},
		{"bad range end", raW(func(w *FGIPsecTunnelWrite) { w.ClientRangeEnd = "999.1.1.1" }), "client range end"},
		{"bad netmask", raW(func(w *FGIPsecTunnelWrite) { w.ClientNetmask = "nope" }), "netmask"},
		{"psk required", raW(func(w *FGIPsecTunnelWrite) { w.PSK = "" }), "pre-shared key is required"},
		{"signature needs a cert", raW(func(w *FGIPsecTunnelWrite) { w.AuthMethod = "signature"; w.PSK = "" }), "certificate name is required"},
		{"signature with a cert is fine", raW(func(w *FGIPsecTunnelWrite) {
			w.AuthMethod = "signature"
			w.PSK = ""
			w.Certificate = "Fortinet_Factory"
		}), ""},
		{"manual DNS must be an IP", raW(func(w *FGIPsecTunnelWrite) { w.DNSMode = "manual"; w.DNSServer = "nope" }), "DNS server"},
		// A dialup listener needs no remote gateway — the S2S "remote IP required" rule must not fire.
		{"no remote gateway needed", raW(func(w *FGIPsecTunnelWrite) { w.RemoteGW = "" }), ""},
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

// Lifted verbatim from the FortiGate wizard's own "Review Settings → Object Summary" for a Remote
// Access tunnel named VPN_Remote. The frontend computes the same names (ipsec-wizard-rules.ts →
// raObjectNames), so a drift on either side is a lie on the Review screen.
func TestRemoteAccessObjectNamesFor(t *testing.T) {
	got := RemoteAccessObjectNamesFor("VPN_Remote")
	want := RemoteAccessObjectNames{
		Phase1:              "VPN_Remote",
		Phase2:              "VPN_Remote",
		ClientRange:         "VPN_Remote_range",
		SplitGroup:          "VPN_Remote_split",
		PolicyL2TP:          "vpn_VPN_Remote_l2tp",
		PolicyRemoteToLocal: "vpn_VPN_Remote_remote",
	}
	if got != want {
		t.Errorf("RemoteAccessObjectNamesFor:\n got  %+v\n want %+v", got, want)
	}
}

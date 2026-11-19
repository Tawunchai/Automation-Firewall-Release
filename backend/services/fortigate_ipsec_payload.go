package services

import (
	"net"
	"strconv"
	"strings"
)

// The CMDB bodies an IPsec write actually puts on the wire: phase1 for each of the three template
// families (site-to-site, Custom, Remote Access / native L2TP) and the Custom phase2.
//
// Moved out of fortigate_ipsec.go unchanged when that file crossed the 48 KB byte ceiling. The cut
// is the seam the comments already described: above it is what the caller may ASK for (the types,
// the object-name derivations and ValidateIPsecTunnel's refusals), here is what the device is TOLD,
// field by field. These functions are the ones the mapping tests drive without a device.

// ipsecPhase1Payload builds the CMDB body for POST vpn.ipsec/phase1-interface. Split out from
// CreateIPsecTunnel so the mapping above can be unit-tested without a device.
func ipsecPhase1Payload(w FGIPsecTunnelWrite) map[string]interface{} {
	remoteType := defaultStr(strings.ToLower(strings.TrimSpace(w.RemoteType)), "static")
	authMethod := defaultStr(strings.ToLower(strings.TrimSpace(w.AuthMethod)), "psk")

	p := map[string]interface{}{
		"vdom":        "root",
		"name":        w.Name,
		"type":        remoteType,
		"interface":   w.Interface,
		"ike-version": defaultStr(w.IKEVersion, ipsecDefaultIKE),
		"proposal":    defaultStr(w.Proposal, ipsecDefaultProposal),
		"dhgrp":       defaultStr(w.DHGroup, ipsecDefaultDHGroup),
		"authmethod":  authMethod,
		"peertype":    "any",
		"net-device":  "disable",
		"comments":    w.Comments,
	}

	// The remote end. A dialup tunnel (remote behind NAT) has NO gateway to dial: sending
	// remote-gw there is meaningless, and the device keeps it at 0.0.0.0 anyway.
	switch remoteType {
	case "static":
		p["remote-gw"] = strings.TrimSpace(w.RemoteGW)
	case "ddns":
		p["remotegw-ddns"] = strings.TrimSpace(w.RemoteDDNS)
	}

	if nt := strings.ToLower(strings.TrimSpace(w.NATTraversal)); ipsecNATTraversals[nt] {
		p["nattraversal"] = nt
	}

	switch authMethod {
	case "psk":
		p["psksecret"] = w.PSK
	case "signature":
		// certificate is a member table of up to 4 signed personal certificates.
		p["certificate"] = []map[string]interface{}{{"name": strings.TrimSpace(w.Certificate)}}
		// The Peer Certificate CA is not a phase1 field — it rides on a user.peer object that
		// CreateIPsecTunnel creates first, and phase1 points at it by name.
		if strings.TrimSpace(w.PeerCA) != "" {
			p["peertype"] = "peer"
			p["peer"] = ipsecPeerName(w.Name)
		}
	}

	// Remote Access turns the phase1 into a dialup mode-config listener (all the FortiClient keys).
	if w.RemoteAccess {
		applyRemoteAccessPhase1(p, w)
	}
	// The Custom template overlays the manual phase1 fields the GUI's "New VPN Tunnel" form exposes.
	if w.Custom != nil {
		applyCustomPhase1(p, w)
	}
	return p
}

// applyCustomPhase1 overlays the manual phase1 fields (the GUI's Custom "New VPN Tunnel" form) onto
// a phase1 payload. Every key here is a real vpn.ipsec/phase1-interface field, confirmed against a
// FortiGate 7.2.10. It sets ONLY what the Custom form controls; the identity/auth keys are already
// on `p` from ipsecPhase1Payload.
func applyCustomPhase1(p map[string]interface{}, w FGIPsecTunnelWrite) {
	c := w.Custom

	ipv6 := strings.TrimSpace(c.IPVersion) == "6"
	p["ip-version"] = defaultStr(strings.TrimSpace(c.IPVersion), "4")

	// IPv6 uses its own gateway keys: the base payload put the remote address in `remote-gw` (an
	// IPv4 key the device rejects for an IPv6 tunnel), so move it to `remote-gw6`.
	if ipv6 {
		if gw, ok := p["remote-gw"]; ok {
			delete(p, "remote-gw")
			p["remote-gw6"] = gw
		}
	}

	// Local Gateway: a specific source IP, or the device default (Primary IP) when left blank.
	if gw := strings.TrimSpace(c.LocalGateway); gw != "" {
		if ipv6 {
			p["local-gw6"] = gw
		} else {
			p["local-gw"] = gw
		}
	}

	p["mode-cfg"] = FGBoolToString(c.ModeConfig)
	if v, ok := atoiOK(c.Keepalive); ok {
		p["keepalive"] = v
	}

	// Dead Peer Detection — the retry count/interval only apply when DPD is on.
	if dpd := strings.ToLower(strings.TrimSpace(c.DPD)); dpd != "" {
		p["dpd"] = dpd
		if dpd != "disable" {
			if v, ok := atoiOK(c.DPDRetryCount); ok {
				p["dpd-retrycount"] = v
			}
			if v, ok := atoiOK(c.DPDRetryInterval); ok {
				p["dpd-retryinterval"] = v
			}
		}
	}

	p["fec-egress"] = FGBoolToString(c.FECEgress)
	p["fec-ingress"] = FGBoolToString(c.FECIngress)

	// Advanced.
	if c.AddRoute != nil {
		p["add-route"] = FGBoolToString(*c.AddRoute)
	}
	p["auto-discovery-sender"] = FGBoolToString(c.AutoDiscoverySender)
	p["auto-discovery-receiver"] = FGBoolToString(c.AutoDiscoveryReceiver)
	p["exchange-interface-ip"] = FGBoolToString(c.ExchangeInterfaceIP)
	if c.NetDevice != nil {
		p["net-device"] = FGBoolToString(*c.NetDevice)
	}
	p["aggregate-member"] = FGBoolToString(c.AggregateMember)

	// IKE Mode is an IKEv1-only knob; on IKEv2 the device rejects `mode`, so never send it there.
	if strings.TrimSpace(w.IKEVersion) == "1" {
		if m := strings.ToLower(strings.TrimSpace(c.IKEMode)); m == "aggressive" || m == "main" {
			p["mode"] = m
		}
	}

	// Peer Options (Accept Types). "one" = Specify a peer ID (peertype=one + peerid). Anything else
	// leaves the "any" the base payload already set.
	if strings.EqualFold(strings.TrimSpace(c.PeerType), "one") && strings.TrimSpace(c.PeerID) != "" {
		p["peertype"] = "one"
		p["peerid"] = strings.TrimSpace(c.PeerID)
	}

	if id := strings.TrimSpace(c.LocalID); id != "" {
		p["localid"] = id
	}
	if v, ok := atoiOK(c.Keylife); ok {
		p["keylife"] = v
	}
}

// customPhase2Payload builds the single phase2 selector the Custom form describes. Unlike the
// Site-to-Site path (one selector per local×remote subnet pair), Custom exposes one selector with
// its own crypto, ports and lifetime — exactly the GUI's "Phase 2 Selectors" section.
func customPhase2Payload(w FGIPsecTunnelWrite) map[string]interface{} {
	c := w.Custom
	p2 := map[string]interface{}{
		"vdom":           "root",
		"name":           w.Name,
		"phase1name":     w.Name,
		"proposal":       defaultStr(strings.TrimSpace(c.P2Proposal), ipsecDefaultProposal),
		"replay":         FGBoolToString(c.P2Replay),
		"pfs":            FGBoolToString(c.P2PFS),
		"auto-negotiate": FGBoolToString(c.P2AutoNegotiate),
		"keepalive":      FGBoolToString(c.P2Keepalive),
		"keylife-type":   "seconds",
	}
	// IPv6 selectors are their own address type + key (a CIDR, not the IPv4 "ip mask" form).
	if strings.TrimSpace(c.IPVersion) == "6" {
		p2["src-addr-type"] = "subnet6"
		p2["dst-addr-type"] = "subnet6"
		p2["src-subnet6"] = defaultStr(strings.TrimSpace(c.P2LocalSubnet), "::/0")
		p2["dst-subnet6"] = defaultStr(strings.TrimSpace(c.P2RemoteSubnet), "::/0")
	} else {
		p2["src-subnet"] = CIDRToFGSubnet(defaultStr(strings.TrimSpace(c.P2LocalSubnet), "0.0.0.0/0"))
		p2["dst-subnet"] = CIDRToFGSubnet(defaultStr(strings.TrimSpace(c.P2RemoteSubnet), "0.0.0.0/0"))
	}
	// PFS carries the phase2 DH group; with PFS off the device ignores dhgrp, so only send it on.
	if c.P2PFS && strings.TrimSpace(c.P2DHGroup) != "" {
		p2["dhgrp"] = strings.TrimSpace(c.P2DHGroup)
	}
	// Ports/protocol: 0 = All (the device's own default), so an empty field means All too.
	if v, ok := atoiOK(c.P2LocalPort); ok {
		p2["src-port"] = v
	}
	if v, ok := atoiOK(c.P2RemotePort); ok {
		p2["dst-port"] = v
	}
	if v, ok := atoiOK(c.P2Protocol); ok {
		p2["protocol"] = v
	}
	if v, ok := atoiOK(c.P2KeylifeSeconds); ok {
		p2["keylifeseconds"] = v
	}
	return p2
}

// atoiOK trims v and parses it as an int, reporting ok=false for a blank or non-numeric value so
// the caller can leave the field at the device default rather than send a zero it didn't choose.
func atoiOK(v string) (int, bool) {
	t := strings.TrimSpace(v)
	if t == "" {
		return 0, false
	}
	n, err := strconv.Atoi(t)
	if err != nil {
		return 0, false
	}
	return n, true
}

// applyRemoteAccessPhase1 overlays the IKE mode-config (dialup FortiClient) keys onto a phase1
// payload. Every key + value here was POSTed to a FortiGate 7.2.10 and read back unchanged.
//
//	type=dynamic + mode-cfg=enable          → a dialup listener that hands out addresses
//	assign-ip-from=range + ipv4-start/end/netmask → the client IP pool (Client Address Range)
//	authusrgrp + xauthtype=auto (PSK)       → clients authenticate against the User Group via XAUTH
//	dns-mode auto|manual (+ ipv4-dns-server1)→ Use System DNS / Specify
//	ipv4-split-include=<addrgrp>            → split tunnel: only those subnets go over the VPN
//
// Per remote device type (the wizard's "Remote device type" row):
//
//	FortiClient → save-password / client-auto-negotiate / client-keep-alive (the Client Options step)
//	Cisco       → unity-support=enable, and no Client Options step exists at all. Ticking
//	              "Require 'Group Name' on VPN client" adds mode=aggressive + peertype=one + peerid.
func applyRemoteAccessPhase1(p map[string]interface{}, w FGIPsecTunnelWrite) {
	// The GUI groups its tunnel list by this, so a tunnel without it lands under "Custom" instead
	// of under the template that built it.
	p["wizard-type"] = remoteAccessWizardType(w.RAClient)

	// Android/Windows are L2TP/IPsec, not mode-config dialup — an entirely different phase1.
	// (iOS is NOT: it falls through to the mode-config path below.)
	if IsL2TPRemoteAccessClient(w.RAClient) {
		applyNativeL2TPPhase1(p, w)
		return
	}

	p["type"] = "dynamic"       // a dialup listener; no remote-gw
	p["mode-cfg"] = "enable"    // hand the client its settings over IKE
	p["net-device"] = "disable" // all dialup clients share this one tunnel interface
	p["assign-ip"] = "enable"
	p["assign-ip-from"] = "range"
	p["ipv4-start-ip"] = strings.TrimSpace(w.ClientRangeStart)
	p["ipv4-end-ip"] = strings.TrimSpace(w.ClientRangeEnd)
	p["ipv4-netmask"] = defaultStr(strings.TrimSpace(w.ClientNetmask), "255.255.255.255")

	// Per-template crypto — each client speaks a different vintage of IKE (iOS in particular needs
	// the older algorithms in its proposal, and DH group 2 in its list).
	crypto := raCryptoFor(w.RAClient)
	if strings.TrimSpace(w.Proposal) == "" {
		p["proposal"] = crypto.Proposal
	}
	if strings.TrimSpace(w.DHGroup) == "" {
		p["dhgrp"] = crypto.P1DHGroup
	}
	if strings.TrimSpace(w.IKEVersion) == "" {
		p["ike-version"] = ipsecRAIKE
	}

	// DNS pushed to the client.
	dnsMode := defaultStr(strings.ToLower(strings.TrimSpace(w.DNSMode)), "auto")
	p["dns-mode"] = dnsMode
	if dnsMode == "manual" && strings.TrimSpace(w.DNSServer) != "" {
		p["ipv4-dns-server1"] = strings.TrimSpace(w.DNSServer)
	}

	// The user group clients authenticate against. PSK dialup pairs it with XAUTH; a signature
	// tunnel already authenticates by certificate and needs no XAUTH.
	if g := strings.TrimSpace(w.UserGroup); g != "" {
		p["authusrgrp"] = g
	}
	if !strings.EqualFold(strings.TrimSpace(w.AuthMethod), "signature") {
		p["xauthtype"] = "auto"
	}

	// Split tunnel: name the addrgrp of local networks reached over the VPN. Omit it entirely for a
	// full tunnel (the client then routes everything through the FortiGate).
	if w.SplitTunnel && strings.TrimSpace(w.SplitGroup) != "" {
		p["ipv4-split-include"] = strings.TrimSpace(w.SplitGroup)
	}

	// "Require 'Group Name' on VPN client" — offered by the Cisco AND iOS templates. The group name
	// is an IKE identifier, and IKEv1 MAIN mode identifies a peer only by its IP, so carrying one
	// forces AGGRESSIVE mode, matched as peertype=one against peerid. (Verified live: the GUI's iOS
	// tunnel with the box unticked is mode=main / peertype=any / peerid="".)
	if remoteAccessSupportsGroupName(w.RAClient) {
		p["unity-support"] = "enable" // the Unity extensions both clients expect
		if w.RequireGroupName && strings.TrimSpace(w.GroupName) != "" {
			p["mode"] = "aggressive"
			p["peertype"] = "one"
			p["peerid"] = strings.TrimSpace(w.GroupName)
		} else {
			p["mode"] = "main"
		}
		// Neither template has a Client Options step, so those keys stay at the device default.
		return
	}

	// FortiClient — the only template with the three Client Options.
	p["save-password"] = FGBoolToString(w.SavePassword)
	p["client-auto-negotiate"] = FGBoolToString(w.AutoConnect)
	p["client-keep-alive"] = FGBoolToString(w.AlwaysUp)
}

// applyNativeL2TPPhase1 overlays the Native (iOS/Android/Windows) keys onto a phase1 payload.
//
// Read back VERBATIM from a tunnel the FortiGate's own Native wizard created (FGT80E/7.2.10) —
// every value here is what the device produced, not a guess:
//
//	mode-cfg   = disable   ← the L2TP server hands out the addresses, so IKE does NOT
//	xauthtype  = disable   ← the L2TP server authenticates the user, so IKE does NOT
//	authusrgrp = ""        ← the user group lives on `vpn l2tp`, NOT on phase1
//	mode=main, peertype=any, dpd=on-demand, nattraversal=enable
//	proposal/dhgrp         ← legacy, because that is all the OS-built-in clients speak
//
// So this function deliberately sets NONE of the mode-config keys: an L2TP phase1 that also
// advertises mode-config hands the client two conflicting addresses and never comes up.
func applyNativeL2TPPhase1(p map[string]interface{}, w FGIPsecTunnelWrite) {
	p["type"] = "dynamic" // a dialup listener; no remote-gw
	p["mode"] = "main"
	p["peertype"] = "any"
	p["net-device"] = "disable"
	p["nattraversal"] = "enable" // native clients are almost always behind NAT
	p["dpd"] = "on-demand"

	crypto := raCryptoFor(w.RAClient)
	if strings.TrimSpace(w.IKEVersion) == "" {
		p["ike-version"] = ipsecRAIKE
	}
	if strings.TrimSpace(w.Proposal) == "" {
		p["proposal"] = crypto.Proposal
	}
	if strings.TrimSpace(w.DHGroup) == "" {
		p["dhgrp"] = crypto.P1DHGroup
	}
}

// L2TPRouteDst returns the destination of the "L2TP Route" — the client network reached over
// l2t.root, written in FortiGate's "ip mask" form.
//
// ⚠️ It is NOT the client address range. Verified live: a range of 10.10.70.1-10.10.70.254 with a
// Subnet Mask of 255.255.0.0 produced a route to 10.10.0.0/16 — i.e. the range START masked by the
// Subnet Mask. That is the ONLY thing the Native template's Subnet Mask is used for: `vpn l2tp`
// stores just sip/eip and no mask at all.
func L2TPRouteDst(startIP, netmask string) string {
	ip := net.ParseIP(strings.TrimSpace(startIP)).To4()
	mask := net.ParseIP(strings.TrimSpace(netmask)).To4()
	if ip == nil || mask == nil {
		return ""
	}
	network := net.IPv4(ip[0]&mask[0], ip[1]&mask[1], ip[2]&mask[2], ip[3]&mask[3]).To4()
	return network.String() + " " + mask.String()
}

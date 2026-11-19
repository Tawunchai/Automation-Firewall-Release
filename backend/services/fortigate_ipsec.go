package services

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var addressTable = cmdbPath{path: "firewall/address", noun: "address"}
var userPeerTable = cmdbPath{path: "user/peer", noun: "IPsec peer"}

// IPsec VPN — vpn.ipsec/phase1-interface and phase2-interface, plus the vpn/l2tp singleton the
// Native (dial-up) templates configure.
//
// Split out of fortigate.go verbatim. The Hub-and-Spoke/ADVPN template lives in
// fortigate_hubspoke.go; the wizard's pickers live in fortigate_vpnmeta.go.

// ── IPsec VPN (vpn.ipsec/phase1-interface + phase2-interface) ─────────────────
//
// Field names/enums confirmed live against a FortiGate 7.2.10. A route-based
// (interface-mode) IPsec tunnel is a phase1-interface (the tunnel, mkey=name, which
// also creates a virtual interface of the same name) plus one or more phase2-interface
// selectors (the local/remote subnet pairs). Create needs "vdom" in the body.

// FGIPsecPhase2 is a single quick-mode selector under a tunnel.
type FGIPsecPhase2 struct {
	Name       string `json:"name"`
	Phase1Name string `json:"phase1name"`
	SrcSubnet  string `json:"src_subnet"` // CIDR
	DstSubnet  string `json:"dst_subnet"` // CIDR
}

// FGIPsecTunnel is the merged read model for the IPsec Tunnels page.
type FGIPsecTunnel struct {
	Name       string          `json:"name"`
	Interface  string          `json:"interface"` // binding (physical/outgoing interface)
	RemoteGW   string          `json:"remote_gw"`
	IKEVersion string          `json:"ike_version"` // 1 | 2
	Type       string          `json:"type"`        // static | dynamic | ddns
	Comments   string          `json:"comments"`
	Up         bool            `json:"up"` // runtime status (any selector connected)
	Phase2     []FGIPsecPhase2 `json:"phase2"`
	RefCount   int             `json:"ref_count"` // firewall policies referencing the tunnel
	// Kind is the wizard template this tunnel was built with, inferred from its phase1 shape:
	// "hub-and-spoke" | "remote-access" | "custom". The Edit button routes to the matching wizard
	// flow with it; a Site-to-Site tunnel reads back as "custom" (its phase1 carries no special flag).
	Kind string `json:"kind"`
}

// ipsecTunnelKind infers the wizard template from a phase1-interface's raw fields. Verified against
// the tunnels each template creates:
//   - auto-discovery-sender/receiver = Hub-and-Spoke (ADVPN)
//   - mode-cfg / a dialup wizard-type / l2tp = Remote Access (dialup)
//   - anything else = Custom (also the fallback for a plain Site-to-Site tunnel)
func ipsecTunnelKind(m map[string]json.RawMessage) string {
	str := func(k string) string {
		if v, ok := m[k]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	if str("auto-discovery-sender") == "enable" || str("auto-discovery-receiver") == "enable" {
		return "hub-and-spoke"
	}
	if str("mode-cfg") == "enable" || strings.HasPrefix(str("wizard-type"), "dialup") || str("l2tp") == "enable" {
		return "remote-access"
	}
	return "custom"
}

// FGIPsecTunnelWrite is the create payload for the IPsec wizard (route-based PSK tunnel).
// FGIPsecTunnelWrite is one Site-to-Site tunnel as the VPN Creation Wizard describes it.
//
// GUI → CMDB mapping for vpn.ipsec/phase1-interface. Every row verified live on a FortiGate
// 7.2.10 (FGT80E) by POSTing each variant and reading it back:
//
//	"NAT configuration: No NAT between sites"      → type=static,  nattraversal=enable
//	"NAT configuration: This site is behind NAT"   → type=static,  nattraversal=forced
//	"NAT configuration: The remote site is behind NAT" → type=DYNAMIC, no remote-gw
//	   ↑ this is why the GUI's diagram re-titles itself "Dialup - FortiGate": a remote behind NAT
//	     has no address we can dial, so the tunnel becomes a dialup listener the remote connects to.
//	"Remote device: IP Address"    → type=static + remote-gw <ip>
//	"Remote device: Dynamic DNS"   → type=ddns   + remotegw-ddns <fqdn>
//	"Authentication method: Pre-shared Key" → authmethod=psk + psksecret
//	"Authentication method: Signature"      → authmethod=signature + certificate[{name}]
//	                                          + peertype=peer + peer=<a user.peer carrying the CA>
//	"Outgoing Interface" → interface (the wizard auto-fills it from RouterLookup — see that method)
//
// ⚠️ The device rejects a SECOND tunnel with the same remote-gw on the same interface with
// error -34 ("The remote gateway is a duplicate of another IPsec gateway entry") — see
// ValidateIPsecTunnel, which turns that into a sentence before the user hits it.
type FGIPsecTunnelWrite struct {
	Name          string
	Interface     string // outgoing/binding interface
	IKEVersion    string // "1" | "2"
	RemoteGW      string
	PSK           string
	Proposal      string   // e.g. "aes256-sha256"
	DHGroup       string   // e.g. "14"
	LocalSubnets  []string // CIDRs
	RemoteSubnets []string // CIDRs
	Comments      string

	// ── VPN Creation Wizard fields ──
	RemoteType   string // static | dynamic | ddns   (empty = static)
	RemoteDDNS   string // FQDN, only when RemoteType == "ddns"
	NATTraversal string // enable | disable | forced (empty = enable, the device default)
	AuthMethod   string // psk | signature           (empty = psk)
	Certificate  string // vpn.certificate.local name, only when AuthMethod == "signature"
	PeerCA       string // vpn.certificate.ca name — wrapped in a user.peer (see ensureIPsecPeer)

	// ── Remote Access (dialup FortiClient, mode-config) ──
	// When RemoteAccess is true the tunnel is a dialup LISTENER (type=dynamic) with IKE
	// mode-config: FortiClient connects in, authenticates against UserGroup, and is handed
	// an address out of ClientRangeStart..ClientRangeEnd. Verified live on FGT80E/7.2.10.
	RemoteAccess     bool   // build a dialup mode-config listener instead of a site-to-site tunnel
	RAClient         string // forticlient | cisco  (empty = forticlient) — see applyRemoteAccessPhase1
	UserGroup        string // authusrgrp — the user group clients authenticate against (XAUTH for PSK)
	ClientRangeStart string // ipv4-start-ip — first address handed to a client
	ClientRangeEnd   string // ipv4-end-ip   — last address handed to a client
	ClientNetmask    string // ipv4-netmask  (empty = the device default, 255.255.255.255)
	DNSMode          string // auto (Use System DNS) | manual (Specify)  — dns-mode
	DNSServer        string // ipv4-dns-server1, only when DNSMode == "manual"
	SplitTunnel      bool   // when true, only SplitGroup's subnets go through the tunnel (ipv4-split-include)
	SplitGroup       string // firewall/addrgrp fed to ipv4-split-include (the "<name>_split" group)

	// FortiClient-only Client Options (the Cisco template has no such step).
	SavePassword bool // save-password         — remember credentials on the client
	AutoConnect  bool // client-auto-negotiate — bring the tunnel up automatically
	AlwaysUp     bool // client-keep-alive     — keep the tunnel up (dead-peer re-dial)

	// Cisco-only: "Require 'Group Name' on VPN client". A group name is an IKE identifier, and
	// IKEv1 MAIN mode identifies a peer only by IP — so carrying one forces AGGRESSIVE mode.
	RequireGroupName bool   // mode=aggressive + peertype=one + peerid
	GroupName        string // peerid

	// ── Custom template (the GUI's manual "New VPN Tunnel" form) ──
	// When Custom is non-nil the tunnel is built EXACTLY from these fields — no address objects,
	// no policies and no routes are created (the Custom template creates only phase1 + phase2, the
	// same as the FortiGate GUI's Custom form). Every other wizard field is ignored except the
	// shared identity/auth ones (Name, Interface, RemoteType, RemoteGW/RemoteDDNS, AuthMethod, PSK,
	// Certificate, PeerCA, Proposal, DHGroup, Comments).
	Custom *FGIPsecCustom

	// Editing marks an update (PUT) rather than a create. On an edit a BLANK PSK means "keep the
	// stored secret" (it is never read back), so validation must not demand one.
	Editing bool
}

// FGIPsecCustom carries the manual phase1/phase2 fields the Custom template exposes. Field names +
// value enums were confirmed against a FortiGate 7.2.10 vpn.ipsec phase1-interface / phase2-interface
// (see applyCustomPhase1 / customPhase2Payload for the exact CMDB keys each maps to).
type FGIPsecCustom struct {
	// ── Network ──
	IPVersion        string // "4" | "6"  (only 4 is wired; see validateCustom)
	LocalGateway     string // local-gw — a specific source IP; "" = the device default (Primary IP)
	ModeConfig       bool   // mode-cfg — hand the peer its address over IKE
	Keepalive        string // keepalive — NAT keepalive frequency in seconds (int; "" = 10)
	DPD              string // dpd — disable | on-idle | on-demand
	DPDRetryCount    string // dpd-retrycount (int)
	DPDRetryInterval string // dpd-retryinterval (int, seconds)
	FECEgress        bool   // fec-egress
	FECIngress       bool   // fec-ingress

	// ── Network → Advanced ──
	AddRoute              *bool // add-route (nil = leave the device default)
	AutoDiscoverySender   bool  // auto-discovery-sender
	AutoDiscoveryReceiver bool  // auto-discovery-receiver
	ExchangeInterfaceIP   bool  // exchange-interface-ip
	NetDevice             *bool // net-device — "Device creation" (nil = device default)
	AggregateMember       bool  // aggregate-member

	// ── Authentication ──
	IKEMode  string // mode — aggressive | main (IKEv1 only; ignored on IKEv2)
	PeerType string // peertype — any | one   (Accept Types, signature Peer Options)
	PeerID   string // peerid — when PeerType == "one" (Specify a peer ID)
	LocalID  string // localid
	Keylife  string // keylife — phase1 key lifetime in seconds (int; "" = 86400)

	// ── Phase 2 Selector ──
	P2LocalSubnet    string // src-subnet  (CIDR; "" = 0.0.0.0/0)
	P2RemoteSubnet   string // dst-subnet  (CIDR; "" = 0.0.0.0/0)
	P2Proposal       string // proposal    ("" = phase2 default)
	P2Replay         bool   // replay
	P2PFS            bool   // pfs
	P2DHGroup        string // dhgrp        (only when P2PFS)
	P2LocalPort      string // src-port     ("0"/"" = All)
	P2RemotePort     string // dst-port     ("0"/"" = All)
	P2Protocol       string // protocol     ("0"/"" = All)
	P2AutoNegotiate  bool   // auto-negotiate
	P2Keepalive      bool   // keepalive (Autokey Keep Alive)
	P2KeylifeSeconds string // keylifeseconds (int; "" = 43200)
}

// IPsec wizard vocabularies and the defaults the wizard leaves off the GUI. Site-to-Site in
// FortiOS's own wizard exposes no IKE/proposal/DH pickers, so these are pinned here instead.
const (
	ipsecDefaultProposal = "aes256-sha256"
	ipsecDefaultDHGroup  = "14"
	ipsecDefaultIKE      = "2"

	// Remote Access (FortiClient dialup) crypto defaults. FortiClient negotiates IKEv1 with
	// mode-config by default, and the GUI's Remote Access wizard offers several proposals so a
	// range of FortiClient builds can pick one. Verified accepted live on FGT80E/7.2.10.
	ipsecRAProposal = "aes128-sha256 aes256-sha256"
	ipsecRADHGroup  = "14 5"
	ipsecRAIKE      = "1"

	// Native (iOS/Android/Windows L2TP/IPsec) crypto. Deliberately LEGACY: the OS-built-in clients
	// negotiate nothing stronger, so the FortiGate wizard pins exactly these — read back verbatim
	// from a tunnel its own Native wizard created on FGT80E/7.2.10. Do not "modernise" them; the
	// native clients simply fail to connect.
	ipsecNativeProposal  = "aes256-md5 3des-sha1 aes192-sha1"
	ipsecNativeP1DHGroup = "2"
	ipsecNativeP2DHGroup = "14 5"
)

// The Remote Access remote-device types this wizard builds. ⚠️ The families do NOT split the way
// the GUI's "Client-based / Native" toggle suggests — verified by reading back tunnels the device's
// own wizard created:
//
//	IKE mode-config dialup (forticlient, cisco, **ios**) → phase1 hands out the addresses and
//	    authenticates via XAUTH against authusrgrp. iOS lives HERE despite being under "Native":
//	    its phase1 is mode-cfg=enable / l2tp=disable / encapsulation=tunnel-mode. That is also why
//	    the GUI titles it "Dialup - iOS (Native)" WITHOUT the "L2TP/IPsec" the other two carry.
//	L2TP over IPsec (android, windows)                   → phase1 has NO mode-config, NO XAUTH and
//	    NO user group — the `vpn l2tp` server does all three.
const (
	raClientFortiClient = "forticlient"
	raClientCisco       = "cisco"
	raClientIOS         = "ios"
	raClientAndroid     = "android"
	raClientWindows     = "windows"

	// The system tunnel interface L2TP clients arrive on once the L2TP server terminates them.
	// (Per-VDOM: "l2t.<vdom>". Everything here is vdom root.)
	l2tpInterface = "l2t.root"
)

var (
	ipsecRemoteTypes   = map[string]bool{"static": true, "dynamic": true, "ddns": true}
	ipsecNATTraversals = map[string]bool{"enable": true, "disable": true, "forced": true}
	ipsecAuthMethods   = map[string]bool{"psk": true, "signature": true}
	// ⚠️ Only Android and Windows are L2TP. iOS is mode-config — verified live.
	ipsecRAL2TP    = map[string]bool{raClientAndroid: true, raClientWindows: true}
	ipsecRAClients = map[string]bool{
		raClientFortiClient: true, raClientCisco: true,
		raClientIOS: true, raClientAndroid: true, raClientWindows: true,
	}

	// Clients that can require a group name (peerid). iOS's Authentication step carries the same
	// "Require 'Group Name' on VPN client" box the Cisco template does.
	ipsecRAGroupNameClients = map[string]bool{raClientCisco: true, raClientIOS: true}

	// wizard-type — the phase1 field that records which wizard template built a tunnel. The GUI's
	// tunnel list GROUPS BY IT, so a tunnel without it shows up under "Custom" instead of under its
	// template. Values come straight from the CMDB schema's option list.
	ipsecRAWizardTypes = map[string]string{
		raClientFortiClient: "dialup-forticlient",
		raClientCisco:       "dialup-cisco",
		raClientIOS:         "dialup-ios",
		raClientAndroid:     "dialup-android",
		raClientWindows:     "dialup-windows",
	}

	// Per-template crypto. Each template pins its own, because each client speaks a different
	// vintage of IKE. ios/android/windows were read back VERBATIM from tunnels the device's own
	// wizard created; forticlient/cisco are ours (FortiClient negotiates modern crypto happily).
	ipsecRACrypto = map[string]raCrypto{
		raClientFortiClient: {Proposal: "aes128-sha256 aes256-sha256", P1DHGroup: "14 5", P2DHGroup: "14 5"},
		raClientCisco:       {Proposal: "aes128-sha256 aes256-sha256", P1DHGroup: "14 5", P2DHGroup: "14 5"},
		// iOS: read back verbatim from the GUI's own iOS tunnel, phase2 keepalive included — a
		// mobile client roams and idles, so its SA is kept alive rather than left to expire.
		raClientIOS:     {Proposal: "aes256-sha256 aes256-md5 aes256-sha1", P1DHGroup: "14 5 2", P2DHGroup: "14 5", P2Keepalive: "enable"},
		raClientAndroid: {Proposal: ipsecNativeProposal, P1DHGroup: ipsecNativeP1DHGroup, P2DHGroup: ipsecNativeP2DHGroup},
		raClientWindows: {Proposal: ipsecNativeProposal, P1DHGroup: ipsecNativeP1DHGroup, P2DHGroup: ipsecNativeP2DHGroup},
	}
)

// raCrypto is one template's pinned IKE/IPsec algorithms. P2Keepalive is empty when the template
// leaves phase2's keepalive at the device default (disable) — verified per template.
type raCrypto struct{ Proposal, P1DHGroup, P2DHGroup, P2Keepalive string }

// raCryptoFor returns the template's crypto, falling back to FortiClient's for an unknown client.
func raCryptoFor(client string) raCrypto {
	if c, ok := ipsecRACrypto[strings.ToLower(strings.TrimSpace(client))]; ok {
		return c
	}
	return ipsecRACrypto[raClientFortiClient]
}

// isValidRemoteAccessClient reports whether v is a Remote Access client type this wizard supports.
func isValidRemoteAccessClient(v string) bool {
	return ipsecRAClients[strings.ToLower(strings.TrimSpace(v))]
}

// IsL2TPRemoteAccessClient reports whether v builds an L2TP/IPsec tunnel rather than an IKE
// mode-config one. ⚠️ Only Android and Windows do — iOS does NOT, despite sitting under "Native".
func IsL2TPRemoteAccessClient(v string) bool {
	return ipsecRAL2TP[strings.ToLower(strings.TrimSpace(v))]
}

// remoteAccessSupportsGroupName reports whether v's Authentication step offers "Require 'Group
// Name' on VPN client" — Cisco and iOS.
func remoteAccessSupportsGroupName(v string) bool {
	return ipsecRAGroupNameClients[strings.ToLower(strings.TrimSpace(v))]
}

// remoteAccessWizardType maps a client to the phase1 `wizard-type` marker the GUI groups by.
func remoteAccessWizardType(v string) string {
	if t, ok := ipsecRAWizardTypes[strings.ToLower(strings.TrimSpace(v))]; ok {
		return t
	}
	return "custom"
}

// L2TPInterface is the system tunnel interface L2TP clients arrive on — the source interface of a
// Native VPN's remote-to-local policy, and the device its route points out.
func L2TPInterface() string { return l2tpInterface }

func isValidIPsecRemoteType(v string) bool {
	return ipsecRemoteTypes[strings.ToLower(strings.TrimSpace(v))]
}
func isValidIPsecNATTraversal(v string) bool {
	return ipsecNATTraversals[strings.ToLower(strings.TrimSpace(v))]
}
func isValidIPsecAuthMethod(v string) bool {
	return ipsecAuthMethods[strings.ToLower(strings.TrimSpace(v))]
}

// ipsecPeerName is the user.peer object a signature tunnel needs to carry its Peer Certificate CA.
// FortiOS has no "CA" field on phase1: the CA lives on a user.peer, which phase1 then references.
func ipsecPeerName(tunnel string) string { return tunnel + "_peer" }

// VPNObjectNames is every object a Site-to-Site tunnel brings with it, named exactly the way
// FortiGate's own VPN Creation Wizard names them — the names are lifted from its
// "Review Settings → Object Summary" screen, so a tunnel built here is indistinguishable from one
// built in the device GUI (and an admin reading the config finds what they expect).
//
//	Phase 1 interface        VPN_TEST
//	Local address group      VPN_TEST_local
//	Remote address group     VPN_TEST_remote
//	Phase 2 interface        VPN_TEST
//	Local to remote policies vpn_VPN_TEST_local
//	Remote to local policies vpn_VPN_TEST_remote
//	Remote Gateway Address   VPN_TEST_remote_gateway
//
// The routes have no names — FortiOS keys them by sequence number, which is why the GUI's summary
// simply says "static" for each.
// The optional members are omitempty because this struct doubles as the create response's
// "objects" map, and that map is what Fallback/undo walks to remove exactly what an Apply put on
// the device. A name for something that was never created makes undo fail on a phantom, so a
// handler blanks the fields whose object its options did not build (see objectsCreated).
type VPNObjectNames struct {
	Phase1              string `json:"phase1"`
	Phase2              string `json:"phase2"`
	LocalAddress        string `json:"local_address,omitempty"`
	RemoteAddress       string `json:"remote_address,omitempty"`
	RemoteGatewayAddr   string `json:"remote_gateway_address,omitempty"`
	PolicyLocalToRemote string `json:"policy_local_to_remote,omitempty"`
	PolicyRemoteToLocal string `json:"policy_remote_to_local,omitempty"`
}

// VPNObjectNamesFor derives them from the tunnel name. The frontend's Review step computes the
// same names (see ipsec-wizard-rules.ts) — both are pinned by tests so the summary the user
// approves is what the device actually gets.
func VPNObjectNamesFor(tunnel string) VPNObjectNames {
	return VPNObjectNames{
		Phase1:              tunnel,
		Phase2:              tunnel,
		LocalAddress:        tunnel + "_local",
		RemoteAddress:       tunnel + "_remote",
		RemoteGatewayAddr:   tunnel + "_remote_gateway",
		PolicyLocalToRemote: "vpn_" + tunnel + "_local",
		PolicyRemoteToLocal: "vpn_" + tunnel + "_remote",
	}
}

// RemoteAccessObjectNames is every object a Remote Access (dialup FortiClient) tunnel brings with
// it, named exactly the way FortiGate's own VPN Creation Wizard names them — lifted from its
// "Review Settings → Object Summary" screen:
//
//	Split Tunnel Group      VPN_Remote_split   (an addrgrp of the local networks reached over the VPN)
//	Phase 1 interface       VPN_Remote
//	Phase 2 interface       VPN_Remote
//	Address                 VPN_Remote_range   (an iprange address = the client IP pool)
//	Remote to local policies vpn_VPN_Remote_remote
//
// (The GUI also lists "Endpoint Registration" against the tunnel name; on FortiOS 7.2 that is not
// a CMDB field — FortiClient registration moved to EMS/ZTNA — so nothing is written for it.)
//
// The Native (L2TP/IPsec) template swaps the split group for an L2TP policy and route:
//
//	Phase 1/2 interface     Test
//	L2TP                    l2tp            (the vpn/l2tp SINGLETON — hence no per-tunnel name)
//	Address                 Test_range
//	L2TP Policy             vpn_Test_l2tp
//	Remote to local policies vpn_Test_remote
//	L2TP Route              static          (keyed by seq-num, so the GUI just says "static")
//
// Optional members are omitempty for the same reason as VPNObjectNames: only what was actually
// built may appear in the create response's "objects" map.
type RemoteAccessObjectNames struct {
	Phase1              string `json:"phase1"`
	Phase2              string `json:"phase2"`
	ClientRange         string `json:"client_range,omitempty"`           // <name>_range   (iprange address)
	SplitGroup          string `json:"split_group,omitempty"`            // <name>_split   (addrgrp for ipv4-split-include)
	PolicyL2TP          string `json:"policy_l2tp,omitempty"`            // vpn_<name>_l2tp   (Native/L2TP only)
	PolicyRemoteToLocal string `json:"policy_remote_to_local,omitempty"` // vpn_<name>_remote
}

// RemoteAccessObjectNamesFor derives them from the tunnel name. The frontend's Review step computes
// the same names (ipsec-wizard-rules.ts) — both are pinned by tests so the summary the user
// approves is what the device actually gets.
func RemoteAccessObjectNamesFor(tunnel string) RemoteAccessObjectNames {
	return RemoteAccessObjectNames{
		Phase1:              tunnel,
		Phase2:              tunnel,
		ClientRange:         tunnel + "_range",
		SplitGroup:          tunnel + "_split",
		PolicyL2TP:          "vpn_" + tunnel + "_l2tp",
		PolicyRemoteToLocal: "vpn_" + tunnel + "_remote",
	}
}

// CreateAddressGroupWithMembers creates a firewall/addrgrp holding the named addresses, and
// nothing else — no type, colour or exclude list. It is the VPN wizard's helper for building a
// split-tunnel group, kept apart from the full-object CRUD in fortigate_group.go on purpose: this
// one sends a MINIMAL body, so it can never reset a field it does not know about.
func (f *FortiClient) CreateAddressGroupWithMembers(name string, members []string, comment string) error {
	err := addrgrpTable.Create(f, map[string]interface{}{
		"name":    name,
		"member":  NamesToFGNames(members),
		"comment": comment,
	})
	return err
}

// SetAddressGroupMembers rewrites an existing firewall/addrgrp's member list and comment, leaving
// every other field of the group exactly as the device holds it. A VPN subnet edit must not clear
// an allow-routing or colour somebody set on the group by hand — see UpdateAddressGroup in
// fortigate_group.go for the full-object write the Address Groups page uses.
func (f *FortiClient) SetAddressGroupMembers(name string, members []string, comment string) error {
	err := addrgrpTable.Update(f, name, map[string]interface{}{
		"member":  NamesToFGNames(members),
		"comment": comment,
	})
	return err
}

// AddressExists / AddressGroupExists report whether a name is taken, and by WHICH table. FortiOS
// keeps addresses and address groups in one namespace — creating a group with an address's name
// fails with -163 "'address' and 'address group' cannot be the same name" — so the shape a name
// currently has decides what may be written to it.
func (f *FortiClient) AddressExists(name string) bool {
	_, err := f.do("GET", "/api/v2/cmdb/firewall/address/"+url.PathEscape(name), nil)
	return err == nil
}

func (f *FortiClient) AddressGroupExists(name string) bool {
	_, err := f.do("GET", "/api/v2/cmdb/firewall/addrgrp/"+url.PathEscape(name), nil)
	return err == nil
}

// RenameAddress changes a firewall/address's mkey. FortiOS rewrites every reference to it as part
// of the rename (verified live: a policy whose srcaddr was "X" reads back as "X_1" straight after
// PUT {"name":"X_1"}), which is what makes the plain-address → address-group migration possible
// without a window where a policy points at nothing.
func (f *FortiClient) RenameAddress(oldName, newName string) error {
	err := addressTable.Update(f, oldName, map[string]interface{}{"name": newName})
	return err
}

// RepointPolicyAddress swaps one address name for another across every policy's srcaddr/dstaddr.
// Used to finish the migration above: the rename drags the policies onto the new member name, and
// this puts them back on the set name so they cover ALL of its members, not just the first.
func (f *FortiClient) RepointPolicyAddress(from, to string) error {
	policies, err := f.GetPolicies()
	if err != nil {
		return err
	}
	swap := func(list []FGName) ([]FGName, bool) {
		changed := false
		for i, n := range list {
			if n.Name == from {
				list[i] = FGName{Name: to}
				changed = true
			}
		}
		return list, changed
	}
	for _, p := range policies {
		src, a := swap(p.SrcAddr)
		dst, b := swap(p.DstAddr)
		if !a && !b {
			continue
		}
		p.SrcAddr, p.DstAddr = src, dst
		if err := f.UpdatePolicy(p.PolicyID, p); err != nil {
			return fmt.Errorf("policy %d not repointed from %q to %q: %w", p.PolicyID, from, to, err)
		}
	}
	return nil
}

// ValidateIPsecTunnel catches what the device would only answer with a bare code, so the wizard
// can say it in a sentence. Everything here is a real, verified device constraint.
func ValidateIPsecTunnel(w FGIPsecTunnelWrite) error {
	if strings.TrimSpace(w.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if strings.TrimSpace(w.Interface) == "" {
		return fmt.Errorf("outgoing interface is required")
	}
	// Remote Access is a dialup listener — no remote gateway to dial. It has its own required
	// fields (a user group + a client IP pool) instead of a remote address.
	if w.RemoteAccess {
		return validateRemoteAccess(w)
	}
	// Custom is the manual form — its own required-field rules (a remote gateway per gateway type,
	// valid subnets, a secret/certificate) live in validateCustom.
	if w.Custom != nil {
		return validateCustom(w)
	}
	rt := defaultStr(strings.ToLower(strings.TrimSpace(w.RemoteType)), "static")
	if !ipsecRemoteTypes[rt] {
		return fmt.Errorf("invalid remote type %q (static, dynamic or ddns)", w.RemoteType)
	}
	switch rt {
	case "static":
		gw := strings.TrimSpace(w.RemoteGW)
		if gw == "" {
			return fmt.Errorf("remote IP address is required")
		}
		if net.ParseIP(gw) == nil {
			return fmt.Errorf("remote IP address: %q is not a valid IP address", w.RemoteGW)
		}
	case "ddns":
		if strings.TrimSpace(w.RemoteDDNS) == "" {
			return fmt.Errorf("FQDN is required for a Dynamic DNS remote device")
		}
	}
	if nt := strings.TrimSpace(w.NATTraversal); nt != "" && !ipsecNATTraversals[strings.ToLower(nt)] {
		return fmt.Errorf("invalid NAT traversal %q (enable, disable or forced)", w.NATTraversal)
	}
	am := defaultStr(strings.ToLower(strings.TrimSpace(w.AuthMethod)), "psk")
	if !ipsecAuthMethods[am] {
		return fmt.Errorf("invalid authentication method %q (psk or signature)", w.AuthMethod)
	}
	switch am {
	case "psk":
		if strings.TrimSpace(w.PSK) == "" {
			return fmt.Errorf("pre-shared key is required")
		}
	case "signature":
		if strings.TrimSpace(w.Certificate) == "" {
			return fmt.Errorf("certificate name is required for signature authentication")
		}
	}
	for _, s := range append(append([]string{}, w.LocalSubnets...), w.RemoteSubnets...) {
		if s = strings.TrimSpace(s); s != "" && !isValidSubnetSpec(s) {
			return fmt.Errorf("subnet %q is not a valid CIDR (e.g. 192.168.1.0/24)", s)
		}
	}
	return nil
}

// validateRemoteAccess catches the Remote Access (dialup FortiClient) constraints the device would
// otherwise answer with a bare code — a missing user group, a bad client-pool address — so the
// wizard can say it in a sentence.
func validateRemoteAccess(w FGIPsecTunnelWrite) error {
	if c := strings.TrimSpace(w.RAClient); c != "" && !isValidRemoteAccessClient(c) {
		return fmt.Errorf("invalid remote access client %q (forticlient or cisco)", w.RAClient)
	}
	// A Cisco client that must present a group name has nothing to present without one.
	if strings.EqualFold(strings.TrimSpace(w.RAClient), raClientCisco) &&
		w.RequireGroupName && strings.TrimSpace(w.GroupName) == "" {
		return fmt.Errorf("group name is required when the VPN client must present one")
	}
	// Native still needs a user group — it just lives on `vpn l2tp` instead of on phase1.
	if strings.TrimSpace(w.UserGroup) == "" {
		return fmt.Errorf("a user group is required for Remote Access")
	}
	// The L2TP templates have no Subnet Mask default to fall back on: it is the only input that
	// decides the L2TP route's destination, so an unusable one would silently produce no route.
	if IsL2TPRemoteAccessClient(w.RAClient) {
		if L2TPRouteDst(w.ClientRangeStart, defaultStr(strings.TrimSpace(w.ClientNetmask), "255.255.255.255")) == "" {
			return fmt.Errorf("client range start and subnet mask must be valid IPv4 addresses")
		}
	}
	start := strings.TrimSpace(w.ClientRangeStart)
	end := strings.TrimSpace(w.ClientRangeEnd)
	if start == "" || end == "" {
		return fmt.Errorf("a client address range (start and end) is required")
	}
	if net.ParseIP(start) == nil {
		return fmt.Errorf("client range start: %q is not a valid IP address", w.ClientRangeStart)
	}
	if net.ParseIP(end) == nil {
		return fmt.Errorf("client range end: %q is not a valid IP address", w.ClientRangeEnd)
	}
	if nm := strings.TrimSpace(w.ClientNetmask); nm != "" && net.ParseIP(nm) == nil {
		return fmt.Errorf("subnet mask %q is not a valid netmask", w.ClientNetmask)
	}
	am := defaultStr(strings.ToLower(strings.TrimSpace(w.AuthMethod)), "psk")
	if !ipsecAuthMethods[am] {
		return fmt.Errorf("invalid authentication method %q (psk or signature)", w.AuthMethod)
	}
	switch am {
	case "psk":
		if strings.TrimSpace(w.PSK) == "" {
			return fmt.Errorf("pre-shared key is required")
		}
	case "signature":
		if strings.TrimSpace(w.Certificate) == "" {
			return fmt.Errorf("certificate name is required for signature authentication")
		}
	}
	if strings.EqualFold(strings.TrimSpace(w.DNSMode), "manual") {
		if s := strings.TrimSpace(w.DNSServer); s != "" && net.ParseIP(s) == nil {
			return fmt.Errorf("DNS server %q is not a valid IP address", w.DNSServer)
		}
	}
	return nil
}

// validateCustom catches the Custom (manual) form's constraints the device would otherwise answer
// with a bare code — a missing remote gateway, an invalid IP/subnet, a mode set on the wrong IKE
// version — so the wizard can say it in a sentence.
func validateCustom(w FGIPsecTunnelWrite) error {
	c := w.Custom

	ipv6 := strings.TrimSpace(c.IPVersion) == "6"
	if v := strings.TrimSpace(c.IPVersion); v != "" && v != "4" && v != "6" {
		return fmt.Errorf("invalid IP version %q (4 or 6)", c.IPVersion)
	}
	// matchesFamily checks an address is of the tunnel's IP family (an IPv4 remote gateway on an
	// IPv6 tunnel, or vice-versa, is a config the device silently mishandles).
	matchesFamily := func(ip net.IP) bool {
		if ip == nil {
			return false
		}
		is4 := ip.To4() != nil
		return is4 != ipv6
	}

	rt := defaultStr(strings.ToLower(strings.TrimSpace(w.RemoteType)), "static")
	if !ipsecRemoteTypes[rt] {
		return fmt.Errorf("invalid remote gateway type %q (static, dynamic or ddns)", w.RemoteType)
	}
	switch rt {
	case "static":
		gw := strings.TrimSpace(w.RemoteGW)
		if gw == "" {
			return fmt.Errorf("remote gateway IP address is required")
		}
		if !matchesFamily(net.ParseIP(gw)) {
			return fmt.Errorf("remote gateway: %q is not a valid IPv%s address", w.RemoteGW, defaultStr(c.IPVersion, "4"))
		}
	case "ddns":
		if strings.TrimSpace(w.RemoteDDNS) == "" {
			return fmt.Errorf("remote gateway: a Dynamic DNS name is required when the gateway is Dynamic DNS")
		}
	}
	// "dynamic" (Dialup User) needs no remote address — it is a listener.

	if gw := strings.TrimSpace(c.LocalGateway); gw != "" && !matchesFamily(net.ParseIP(gw)) {
		return fmt.Errorf("local gateway %q is not a valid IPv%s address", c.LocalGateway, defaultStr(c.IPVersion, "4"))
	}
	if nt := strings.TrimSpace(w.NATTraversal); nt != "" && !ipsecNATTraversals[strings.ToLower(nt)] {
		return fmt.Errorf("invalid NAT traversal %q (enable, disable or forced)", w.NATTraversal)
	}
	if d := strings.ToLower(strings.TrimSpace(c.DPD)); d != "" && d != "disable" && d != "on-idle" && d != "on-demand" {
		return fmt.Errorf("invalid dead peer detection %q (disable, on-idle or on-demand)", c.DPD)
	}

	am := defaultStr(strings.ToLower(strings.TrimSpace(w.AuthMethod)), "psk")
	if !ipsecAuthMethods[am] {
		return fmt.Errorf("invalid authentication method %q (psk or signature)", w.AuthMethod)
	}
	switch am {
	case "psk":
		// On an edit a blank PSK keeps the stored secret (it is never read back), so only a create
		// must have one.
		if strings.TrimSpace(w.PSK) == "" && !w.Editing {
			return fmt.Errorf("pre-shared key is required")
		}
	case "signature":
		if strings.TrimSpace(w.Certificate) == "" {
			return fmt.Errorf("certificate name is required for signature authentication")
		}
	}
	// "Specify a peer ID" has nothing to match a peer against without the ID itself.
	if strings.EqualFold(strings.TrimSpace(c.PeerType), "one") && strings.TrimSpace(c.PeerID) == "" {
		return fmt.Errorf("a peer ID is required when Accept Types is 'Specify a peer ID'")
	}

	for _, s := range []string{c.P2LocalSubnet, c.P2RemoteSubnet} {
		if s = strings.TrimSpace(s); s != "" && !isValidSubnetSpec(s) {
			return fmt.Errorf("phase 2 subnet %q is not a valid CIDR (e.g. 192.168.1.0/24)", s)
		}
	}
	return nil
}

// isValidSubnetSpec reports whether s is something CIDRToFGSubnet can meaningfully convert:
// "10.0.0.0/24", a bare host "10.0.0.1", or FortiGate's own "10.0.0.0 255.255.255.0" form.
//
// ⚠️ CIDRToFGSubnet is NOT a validity check. It is deliberately lenient — anything it cannot
// parse it returns unchanged — so `CIDRToFGSubnet(s) == ""` never fires and a typo like "nope"
// would sail through validation and be POSTed to the device verbatim.
func isValidSubnetSpec(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if parts := strings.Fields(s); len(parts) == 2 {
		return net.ParseIP(parts[0]) != nil && net.ParseIP(parts[1]) != nil
	}
	if strings.Contains(s, "/") {
		_, _, err := net.ParseCIDR(s)
		return err == nil
	}
	return net.ParseIP(s) != nil
}

// ── vpn/l2tp — the L2TP server the Native templates need ──────────────────────
//
// ⚠️ SINGLETON. There is exactly ONE `vpn l2tp` per VDOM (its CMDB schema has no mkey), so a
// second Native VPN OVERWRITES the first one's range and user group. That is why the GUI's Object
// Summary calls this object plain "l2tp" rather than "<tunnel>_l2tp".

// FGL2TPServer is the vpn/l2tp singleton.
type FGL2TPServer struct {
	Status    string `json:"status"` // enable | disable
	SIP       string `json:"sip"`    // client range START
	EIP       string `json:"eip"`    // client range END
	UserGroup string `json:"usrgrp"` // the group L2TP authenticates against
}

// GetL2TPServer reads the singleton.
func (f *FortiClient) GetL2TPServer() (FGL2TPServer, error) {
	var out FGL2TPServer
	resp, err := f.do("GET", "/api/v2/cmdb/vpn/l2tp", nil)
	if err != nil {
		return out, err
	}
	// The singleton comes back as an object, but tolerate a one-element array too.
	if err := json.Unmarshal(resp.Results, &out); err != nil {
		var rows []FGL2TPServer
		if json.Unmarshal(resp.Results, &rows) == nil && len(rows) > 0 {
			return rows[0], nil
		}
		return out, fmt.Errorf("failed to parse vpn/l2tp: %w", err)
	}
	return out, nil
}

// EnableL2TPServer points the singleton at this tunnel's client range and user group.
func (f *FortiClient) EnableL2TPServer(sip, eip, usrgrp string) error {
	_, err := f.do("PUT", "/api/v2/cmdb/vpn/l2tp", map[string]interface{}{
		"status": "enable",
		"sip":    strings.TrimSpace(sip),
		"eip":    strings.TrimSpace(eip),
		"usrgrp": strings.TrimSpace(usrgrp),
	})
	return err
}

// DisableL2TPServer switches the singleton back off and releases the user group, so the group can
// then be deleted and a later Native VPN starts from a clean slate.
func (f *FortiClient) DisableL2TPServer() error {
	_, err := f.do("PUT", "/api/v2/cmdb/vpn/l2tp", map[string]interface{}{
		"status": "disable",
		"usrgrp": "",
	})
	return err
}

// IsL2TPTunnel reports whether `name`'s phase2 is an L2TP selector — i.e. the tunnel was built by
// the Native template. Delete uses it to decide whether to switch the l2tp singleton back off.
func (f *FortiClient) IsL2TPTunnel(name string) bool {
	resp, err := f.do("GET", "/api/v2/cmdb/vpn.ipsec/phase2-interface/"+url.PathEscape(name), nil)
	if err != nil {
		return false
	}
	var rows []struct {
		L2TP string `json:"l2tp"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 {
		return false
	}
	return strings.EqualFold(rows[0].L2TP, "enable")
}

// L2TPServerOwner returns the name of the existing L2TP/IPsec tunnel currently holding the
// vpn/l2tp singleton, or "" when the server is off or unowned.
//
// vpn/l2tp is ONE object per VDOM. Building a second Native (Android/Windows) VPN silently
// repoints it — the earlier tunnel's SA still comes up but its L2TP session no longer
// authenticates, so it breaks without any error. The wizard warns about this in the UI, but the
// warning is only a render: the AI Assistant and direct API calls reach the same create path, so
// the guard has to live here where every path passes through.
func (f *FortiClient) L2TPServerOwner(excludeTunnel string) string {
	srv, err := f.GetL2TPServer()
	if err != nil || !strings.EqualFold(srv.Status, "enable") {
		return ""
	}
	names, err := f.fetchNames("/api/v2/cmdb/vpn.ipsec/phase1-interface")
	if err != nil {
		// The server is on but we cannot say which tunnel owns it. Report the server itself so the
		// caller still refuses rather than overwriting something invisible.
		return "an existing L2TP VPN"
	}
	for _, n := range names {
		if strings.EqualFold(n.Name, excludeTunnel) {
			continue // editing the tunnel that already owns it is fine
		}
		if f.IsL2TPTunnel(n.Name) {
			return n.Name
		}
	}
	return ""
}

// ensureIPsecPeer creates (idempotently) the user.peer that carries a signature tunnel's Peer
// Certificate CA. FortiOS models "which CA must have signed the remote's certificate" as a
// user.peer, which phase1 then references — there is no CA field on phase1 itself.
func (f *FortiClient) ensureIPsecPeer(tunnel, ca string) error {
	name := ipsecPeerName(tunnel)
	body := map[string]interface{}{"name": name, "ca": ca, "mandatory-ca-verify": "enable"}
	err := userPeerTable.Create(f, body)
	if err == nil {
		return nil
	}
	// Already there (a re-run, or a leftover from a half-finished create) — update it to the CA
	// this tunnel actually wants rather than failing.
	if IsDuplicateObjectError(err) {
		uerr := userPeerTable.Update(f, name, body)
		return uerr
	}
	return err
}

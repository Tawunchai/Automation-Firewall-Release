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
var vpnIpsecPhase1InterfaceTable = cmdbPath{path: "vpn.ipsec/phase1-interface", noun: "IPsec phase 1"}
var vpnIpsecPhase2InterfaceTable = cmdbPath{path: "vpn.ipsec/phase2-interface", noun: "IPsec phase 2"}

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var interfaceTable = cmdbPath{path: "system/interface", noun: "interface"}

// ── Hub-and-Spoke VPN (ADVPN with BGP auto-discovery) ─────────────────────────
//
// The FortiGate VPN Creation Wizard's Hub-and-Spoke template builds a very different object set
// from Site-to-Site: the tunnel is an overlay with a real tunnel-interface IP, routing is done by
// BGP (not static routes), and the hub accepts many spokes on ONE dialup phase1. Every CLI line
// below was verified live on a FortiGate 7.2.10 (FGT80E) by applying it over SSH and reading it
// back — see the notes on each builder.
//
//	HUB   phase1: type=dynamic  + auto-discovery-sender=enable + add-route=disable + net-device=disable
//	SPOKE phase1: type=static   + remote-gw=<hub public IP> + auto-discovery-receiver=enable + net-device=enable
//	both:  a system/interface tunnel IP (set ip <tunnelIP>/32, set remote-ip <peerTunnelIP> <mask>)
//	both:  router/bgp — local AS, router-id=<tunnelIP>, one network per local subnet
//	HUB Individual: one BGP neighbor per spoke tunnel IP
//	HUB Range:      a BGP neighbor-group (bound to the tunnel) + a neighbor-range (the overlay subnet)
//	SPOKE:          one BGP neighbor = the hub's tunnel IP
//
// The routing protocol is BGP because ADVPN spoke-to-spoke shortcuts need a dynamic protocol to
// re-advertise the learned routes; static routes cannot follow a shortcut that appears at runtime.

// HubSpokeRoleHub / HubSpokeRoleSpoke are the two roles the wizard's "Role" toggle offers.
const (
	HubSpokeRoleHub   = "hub"
	HubSpokeRoleSpoke = "spoke"
)

// FGHubSpokeWrite is one Hub-and-Spoke tunnel as the VPN Creation Wizard describes it. It is the
// create AND update payload; Editing marks the update path (a blank PSK then keeps the stored
// secret, which is never read back from the device).
type FGHubSpokeWrite struct {
	Name      string
	Role      string // hub | spoke
	Interface string // Incoming Interface (the physical/WAN interface the tunnel binds to)

	// Authentication
	AuthMethod  string // psk | signature (empty = psk)
	PSK         string
	Certificate string // signature — vpn.certificate.local name
	PeerCA      string // signature — vpn.certificate.ca name (wrapped in a user.peer)
	Proposal    string // empty = the device default (aes256-sha256)

	// Tunnel Interface (the overlay). TunnelIP is THIS device's tunnel-interface address; RemoteIP
	// is the peer end of the overlay with the mask that sizes the whole overlay subnet.
	TunnelIP string // e.g. "10.10.1.1"      → set ip 10.10.1.1 255.255.255.255
	RemoteIP string // e.g. "10.10.1.2/24"   → set remote-ip 10.10.1.2 255.255.255.0

	// Policy & Routing (BGP)
	LocalAS        string   // the private AS both ends share, e.g. "65400"
	LocalInterface string   // the LAN side the hub↔spoke policy is written for (dstintf of spoke2hub)
	LocalSubnets   []string // networks this device advertises over BGP + its local address group

	// Hub only
	SpokeType        string   // individual | range
	SpokeTunnelIPs   []string // individual — one BGP neighbor per spoke tunnel IP
	SpokeRangePrefix string   // range — the overlay subnet the neighbor-range accepts, e.g. "10.10.1.0/24"

	// Spoke only
	RemoteGW string // the hub's PUBLIC IP (phase1 remote-gw). The hub tunnel IP is RemoteIP's host.

	Comments string
	Editing  bool
}

func (w FGHubSpokeWrite) isHub() bool   { return !strings.EqualFold(w.Role, HubSpokeRoleSpoke) }
func (w FGHubSpokeWrite) isSpoke() bool { return strings.EqualFold(w.Role, HubSpokeRoleSpoke) }

// isValidHubSpokeRole reports whether v is one of the two roles.
func isValidHubSpokeRole(v string) bool {
	r := strings.ToLower(strings.TrimSpace(v))
	return r == HubSpokeRoleHub || r == HubSpokeRoleSpoke || r == ""
}

// HubSpokeObjectNames is every object a Hub-and-Spoke tunnel brings with it, named exactly the way
// the FortiGate wizard's "Review Settings → Object Summary" names them:
//
//	Phase 1 / Phase 2 / Tunnel interface   <name>
//	Local address group                    <name>_local
//	Remote to local policies               vpn_<name>_spoke2hub
//	Local to remote policies               vpn_<name>_spoke2spoke
//	BGP neighbor-group (Range mode)        <name>
type HubSpokeObjectNames struct {
	Phase1            string `json:"phase1"`
	Phase2            string `json:"phase2"`
	TunnelInterface   string `json:"tunnel_interface"`
	LocalAddress      string `json:"local_address"`
	PolicySpoke2Hub   string `json:"policy_spoke2hub"`
	PolicySpoke2Spoke string `json:"policy_spoke2spoke"`
	NeighborGroup     string `json:"neighbor_group"`
}

// HubSpokeObjectNamesFor derives them from the tunnel name. The frontend's Review step computes the
// same names (ipsec-wizard-rules.ts) — both are pinned by tests so the summary the user approves is
// what the device actually gets.
func HubSpokeObjectNamesFor(tunnel string) HubSpokeObjectNames {
	return HubSpokeObjectNames{
		Phase1:            tunnel,
		Phase2:            tunnel,
		TunnelInterface:   tunnel,
		LocalAddress:      tunnel + "_local",
		PolicySpoke2Hub:   "vpn_" + tunnel + "_spoke2hub",
		PolicySpoke2Spoke: "vpn_" + tunnel + "_spoke2spoke",
		NeighborGroup:     tunnel,
	}
}

// ── Validation ────────────────────────────────────────────────────────────────

// ValidateHubSpoke checks the request BEFORE it reaches the device, so the user gets a sentence
// instead of a bare error code. It does NOT re-validate what the device owns (crypto negotiation);
// it catches the empty/duplicate/malformed inputs that would otherwise fail deep in a multi-step
// build and leave a half-created tunnel behind.
func ValidateHubSpoke(w FGHubSpokeWrite) error {
	if strings.TrimSpace(w.Name) == "" {
		return fmt.Errorf("tunnel name is required")
	}
	if !isValidHubSpokeRole(w.Role) {
		return fmt.Errorf("role must be hub or spoke")
	}
	if strings.TrimSpace(w.Interface) == "" {
		return fmt.Errorf("incoming interface is required")
	}
	auth := strings.ToLower(strings.TrimSpace(w.AuthMethod))
	if auth == "signature" {
		if strings.TrimSpace(w.Certificate) == "" {
			return fmt.Errorf("certificate name is required for signature authentication")
		}
	} else if !w.Editing && strings.TrimSpace(w.PSK) == "" {
		// A blank PSK is fine on an edit (it means "keep the stored secret"), never on a create.
		return fmt.Errorf("pre-shared key is required")
	}
	if !isTunnelHostIP(w.TunnelIP) {
		return fmt.Errorf("tunnel IP must be a valid IPv4 address")
	}
	if !isTunnelRemoteIP(w.RemoteIP) {
		return fmt.Errorf("remote IP/netmask must be a valid IPv4 address with mask (e.g. 10.10.1.2/24)")
	}
	if strings.TrimSpace(w.LocalAS) == "" || !isBGPAS(w.LocalAS) {
		return fmt.Errorf("local AS must be a number between 1 and 4294967295")
	}
	if len(cleanList(w.LocalSubnets)) == 0 {
		return fmt.Errorf("at least one local subnet is required")
	}
	for _, s := range cleanList(w.LocalSubnets) {
		if !isCIDR(s) {
			return fmt.Errorf("local subnet %q is not a valid CIDR (e.g. 10.0.96.0/22)", s)
		}
	}
	if w.isHub() {
		st := strings.ToLower(strings.TrimSpace(w.SpokeType))
		switch st {
		case "range":
			if !isCIDR(w.SpokeRangePrefix) {
				return fmt.Errorf("spoke range prefix must be a valid CIDR (e.g. 10.10.1.0/24)")
			}
		case "individual", "":
			ips := cleanList(w.SpokeTunnelIPs)
			if len(ips) == 0 {
				return fmt.Errorf("at least one spoke tunnel IP is required")
			}
			for _, ip := range ips {
				if net.ParseIP(ip) == nil {
					return fmt.Errorf("spoke tunnel IP %q is not a valid IPv4 address", ip)
				}
			}
		default:
			return fmt.Errorf("spoke type must be individual or range")
		}
	} else {
		if strings.TrimSpace(w.RemoteGW) == "" || net.ParseIP(strings.TrimSpace(w.RemoteGW)) == nil {
			return fmt.Errorf("hub gateway (remote gateway) must be a valid IPv4 address")
		}
	}
	return nil
}

// ── Pure payload builders (unit-tested; no device) ────────────────────────────

// hubSpokePhase1Payload reuses ipsecPhase1Payload for the shared identity/auth keys, then overlays
// the ADVPN keys the role needs. Both roles turn add-route off (BGP owns routing) and IKEv2.
func hubSpokePhase1Payload(w FGHubSpokeWrite) map[string]interface{} {
	base := FGIPsecTunnelWrite{
		Name:        strings.TrimSpace(w.Name),
		Interface:   strings.TrimSpace(w.Interface),
		IKEVersion:  "2",
		Proposal:    w.Proposal,
		AuthMethod:  w.AuthMethod,
		PSK:         w.PSK,
		Certificate: w.Certificate,
		PeerCA:      w.PeerCA,
		Comments:    w.Comments,
	}
	if w.isHub() {
		base.RemoteType = "dynamic" // the hub is a listener: many spokes dial IN to one phase1
	} else {
		base.RemoteType = "static"
		base.RemoteGW = strings.TrimSpace(w.RemoteGW)
	}
	p := ipsecPhase1Payload(base)
	p["add-route"] = "disable"
	if w.isHub() {
		p["auto-discovery-sender"] = "enable"
		p["dpd"] = "on-idle"
		p["net-device"] = "disable"
	} else {
		p["auto-discovery-receiver"] = "enable"
		p["net-device"] = "enable"
	}
	return p
}

// hubSpokePhase2Payload is the simple selector both roles use — everything (0.0.0.0/0) is protected
// and BGP decides what actually goes over it. A spoke auto-negotiates so its SA comes up on boot
// without waiting for interesting traffic (needed for the BGP session to the hub to establish).
func hubSpokePhase2Payload(w FGHubSpokeWrite) map[string]interface{} {
	p := map[string]interface{}{
		"vdom":       "root",
		"name":       strings.TrimSpace(w.Name),
		"phase1name": strings.TrimSpace(w.Name),
		"proposal":   defaultStr(strings.TrimSpace(w.Proposal), ipsecDefaultProposal),
	}
	if w.isSpoke() {
		p["auto-negotiate"] = "enable"
	}
	return p
}

// hubSpokeTunnelIPPayload sets the overlay IPs on the tunnel's auto-created system/interface. FortiOS
// stores "ip <host>/32" and "remote-ip <peer> <overlay-mask>" — the remote-ip's mask sizes the whole
// overlay subnet the neighbor-range accepts.
func hubSpokeTunnelIPPayload(w FGHubSpokeWrite) map[string]interface{} {
	return map[string]interface{}{
		"ip":          CIDRToFGSubnet(strings.TrimSpace(w.TunnelIP)), // "10.10.1.1 255.255.255.255"
		"remote-ip":   CIDRToFGSubnet(strings.TrimSpace(w.RemoteIP)), // "10.10.1.2 255.255.255.0"
		"allowaccess": "ping",
	}
}

// ── small validators/helpers ──────────────────────────────────────────────────

func cleanList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func isTunnelHostIP(v string) bool { return net.ParseIP(strings.TrimSpace(v)) != nil }

func isTunnelRemoteIP(v string) bool {
	s := strings.TrimSpace(v)
	if !strings.Contains(s, "/") {
		return net.ParseIP(s) != nil // a bare host is acceptable (defaults to /32)
	}
	ip, _, err := net.ParseCIDR(s)
	return err == nil && ip.To4() != nil
}

func isCIDR(v string) bool {
	s := strings.TrimSpace(v)
	if !strings.Contains(s, "/") {
		return false
	}
	_, _, err := net.ParseCIDR(s)
	return err == nil
}

// ── Device methods ────────────────────────────────────────────────────────────

// CreateHubSpokeTunnel POSTs phase1 then phase2. Signature auth's user.peer (the Peer Certificate
// CA carrier) is created first, exactly like CreateIPsecTunnel.
func (f *FortiClient) CreateHubSpokeTunnel(w FGHubSpokeWrite) error {
	if strings.EqualFold(w.AuthMethod, "signature") && strings.TrimSpace(w.PeerCA) != "" {
		if err := f.ensureIPsecPeer(w.Name, strings.TrimSpace(w.PeerCA)); err != nil {
			return fmt.Errorf("peer certificate CA: %w", err)
		}
	}
	if err := vpnIpsecPhase1InterfaceTable.Create(f, hubSpokePhase1Payload(w)); err != nil {
		return err
	}
	if err := vpnIpsecPhase2InterfaceTable.Create(f, hubSpokePhase2Payload(w)); err != nil {
		return fmt.Errorf("tunnel created but phase2 selector failed: %w", err)
	}
	return nil
}

// UpdateHubSpokeTunnel overwrites phase1 (auth/proposal/interface) and phase2 by mkey. A blank PSK on
// an edit keeps the stored secret — ipsecPhase1Payload would send "" and blank the secret, so it is
// dropped here.
func (f *FortiClient) UpdateHubSpokeTunnel(w FGHubSpokeWrite) error {
	p1 := hubSpokePhase1Payload(w)
	if w.Editing && strings.TrimSpace(w.PSK) == "" {
		delete(p1, "psksecret")
	}
	if err := vpnIpsecPhase1InterfaceTable.Update(f, w.Name, p1); err != nil {
		return err
	}
	if err := vpnIpsecPhase2InterfaceTable.Update(f, w.Name, hubSpokePhase2Payload(w)); err != nil {
		return err
	}
	return nil
}

// SetTunnelInterfaceIP writes the overlay IPs onto the tunnel's system/interface (auto-created with
// phase1). It is a PUT by mkey — never a collection write.
func (f *FortiClient) SetTunnelInterfaceIP(w FGHubSpokeWrite) error {
	return interfaceTable.Update(f, w.Name, hubSpokeTunnelIPPayload(w))
}

// RemoteIPHost returns the host part of the spoke's Remote IP/netmask — the hub's tunnel IP, which is
// the spoke's single BGP neighbor.
func (w FGHubSpokeWrite) RemoteIPHost() string {
	s := strings.TrimSpace(w.RemoteIP)
	if i := strings.Index(s, "/"); i >= 0 {
		return s[:i]
	}
	return s
}

// IsHubSpokeTunnel reports whether a phase1 was built by this Hub-and-Spoke path — either end sets an
// auto-discovery flag, which a Site-to-Site / Remote Access / Custom tunnel never does. Delete uses
// it to decide whether to also tear down BGP.
func (f *FortiClient) IsHubSpokeTunnel(name string) bool {
	resp, err := f.do("GET", "/api/v2/cmdb/vpn.ipsec/phase1-interface/"+url.PathEscape(name), nil)
	if err != nil {
		return false
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 {
		return false
	}
	var sender, receiver string
	json.Unmarshal(rows[0]["auto-discovery-sender"], &sender)     //nolint:errcheck
	json.Unmarshal(rows[0]["auto-discovery-receiver"], &receiver) //nolint:errcheck
	return sender == "enable" || receiver == "enable"
}

// TunnelOverlayCIDR reads the tunnel's system/interface remote-ip and returns the overlay subnet as
// a CIDR string (e.g. "10.10.1.0/24"), or "" if the interface has none. The caller reads it BEFORE
// deleting the tunnel — the system/interface is auto-removed with phase1, so it is gone by the time
// the BGP teardown runs.
func (f *FortiClient) TunnelOverlayCIDR(name string) string {
	resp, err := f.do("GET", "/api/v2/cmdb/system/interface/"+url.PathEscape(name), nil)
	if err != nil {
		return ""
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 {
		return ""
	}
	var remoteIP string
	json.Unmarshal(rows[0]["remote-ip"], &remoteIP) //nolint:errcheck
	n := parseOverlayCIDR(remoteIP)
	if n == nil {
		return ""
	}
	return n.String()
}

// parseOverlayCIDR turns FortiOS "<ip> <mask>" (or a CIDR) into the network *net.IPNet, or nil.
func parseOverlayCIDR(v string) *net.IPNet {
	s := strings.TrimSpace(v)
	if s == "" {
		return nil
	}
	if strings.Contains(s, "/") {
		_, n, err := net.ParseCIDR(s)
		if err != nil {
			return nil
		}
		return n
	}
	fields := strings.Fields(s)
	if len(fields) != 2 {
		return nil
	}
	ip := net.ParseIP(fields[0])
	maskIP := net.ParseIP(fields[1])
	if ip == nil || maskIP == nil || ip.To4() == nil || maskIP.To4() == nil {
		return nil
	}
	mask := net.IPMask(maskIP.To4())
	return &net.IPNet{IP: ip.Mask(mask), Mask: mask}
}

// bgpIsEmpty reports whether BGP has no neighbors, neighbor-groups, neighbor-ranges or networks left
// — i.e. removing this tunnel emptied it, so the AS can be cleared.
func (f *FortiClient) bgpIsEmpty() bool {
	for _, table := range []string{"neighbor", "neighbor-group", "neighbor-range", "network"} {
		if len(f.bgpChildRows(table)) > 0 {
			return false
		}
	}
	return true
}

// ── BGP neighbor health (item 2) ──────────────────────────────────────────────

// BGPNeighbor is one BGP peer's live state, for the tunnels page's health panel.
type BGPNeighbor struct {
	IP       string `json:"ip"`
	RemoteAS string `json:"remote_as"`
	State    string `json:"state"` // Established | Connect | Active | Idle | OpenSent | …
	Up       bool   `json:"up"`    // State == Established
}

// BGPSummary is the device's BGP process as the tunnels page shows it.
type BGPSummary struct {
	Configured bool          `json:"configured"` // an AS is set (a BGP process exists)
	LocalAS    string        `json:"local_as"`
	RouterID   string        `json:"router_id"`
	Neighbors  []BGPNeighbor `json:"neighbors"`
}

// GetBGPSummary reads the local AS/router-id from CMDB and each neighbor's live state from the
// monitor API. Best-effort: an older build with no monitor endpoint still returns the configured
// neighbors (state "unknown"), so the panel degrades to "configured, N peers" rather than vanishing.
func (f *FortiClient) GetBGPSummary() BGPSummary {
	out := BGPSummary{}
	// CMDB — local AS + router-id. router/bgp is a SINGLETON, so Results is an object, not an array;
	// getRawObject handles that (an array-shaped GET would leave everything blank). `as` comes back as
	// a string on some builds and a number on others — scalarString copes with both.
	if m, err := f.getRawObject("/api/v2/cmdb/router/bgp"); err == nil {
		out.LocalAS = strings.TrimSpace(scalarString(m["as"]))
		out.RouterID = strings.TrimSpace(scalarString(m["router-id"]))
		out.Configured = out.LocalAS != "" && out.LocalAS != "0"
	}
	if !out.Configured {
		return out
	}
	// Configured neighbors (CMDB) keyed by IP → remote-as, so we can pair the monitor states.
	remoteAS := map[string]string{}
	order := []string{}
	for _, m := range f.bgpChildRows("neighbor") {
		var ip, ras string
		json.Unmarshal(m["ip"], &ip)         //nolint:errcheck
		json.Unmarshal(m["remote-as"], &ras) //nolint:errcheck
		ip = strings.TrimSpace(ip)
		if ip != "" {
			remoteAS[ip] = strings.TrimSpace(ras)
			order = append(order, ip)
		}
	}
	// Live state from the monitor API.
	states := f.bgpNeighborStates()
	for _, ip := range order {
		st := states[ip]
		if st == "" {
			st = "unknown"
		}
		out.Neighbors = append(out.Neighbors, BGPNeighbor{
			IP: ip, RemoteAS: remoteAS[ip], State: st, Up: strings.EqualFold(st, "Established"),
		})
	}
	// Dynamic peers (Range mode) show up only in the monitor list, not CMDB neighbors — append them.
	for ip, st := range states {
		if _, known := remoteAS[ip]; known {
			continue
		}
		out.Neighbors = append(out.Neighbors, BGPNeighbor{
			IP: ip, State: st, Up: strings.EqualFold(st, "Established"),
		})
	}
	return out
}

// bgpNeighborStates maps neighbor IP → BGP state from the monitor API. Returns empty if the endpoint
// is unavailable (older firmware) — callers treat that as "state unknown".
func (f *FortiClient) bgpNeighborStates() map[string]string {
	out := map[string]string{}
	resp, err := f.do("GET", "/api/v2/monitor/router/bgp/neighbors", nil)
	if err != nil {
		return out
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, m := range rows {
		var ip, state string
		// FortiOS has used both neighbor_ip and neighbor-ip across builds; try both.
		for _, k := range []string{"neighbor_ip", "neighbor-ip", "neighbor"} {
			if v, ok := m[k]; ok {
				json.Unmarshal(v, &ip) //nolint:errcheck
				if ip != "" {
					break
				}
			}
		}
		for _, k := range []string{"state", "session_state", "bgp_state"} {
			if v, ok := m[k]; ok {
				json.Unmarshal(v, &state) //nolint:errcheck
				if state != "" {
					break
				}
			}
		}
		if ip != "" {
			out[strings.TrimSpace(ip)] = strings.TrimSpace(state)
		}
	}
	return out
}

// ── Hub-and-Spoke readback for Edit (item 1) ──────────────────────────────────

// FGHubSpokeReadback is a Hub-and-Spoke tunnel reconstructed from the device — enough for the wizard
// to open it in Edit mode. The PSK is never read back (FortiOS won't return it), so it comes back
// empty and a blank on save keeps the stored secret.
type FGHubSpokeReadback struct {
	Name             string   `json:"name"`
	Role             string   `json:"role"` // hub | spoke
	Interface        string   `json:"interface"`
	AuthMethod       string   `json:"auth_method"`
	Certificate      string   `json:"certificate"`
	PeerCA           string   `json:"peer_ca"`
	Proposal         string   `json:"proposal"`
	TunnelIP         string   `json:"tunnel_ip"`
	RemoteIP         string   `json:"remote_ip"`
	LocalAS          string   `json:"local_as"`
	LocalSubnets     []string `json:"local_subnets"`
	SpokeType        string   `json:"spoke_type"`
	SpokeTunnelIPs   []string `json:"spoke_tunnel_ips"`
	SpokeRangePrefix string   `json:"spoke_range_prefix"`
	RemoteGW         string   `json:"remote_gw"`
}

// ReadHubSpoke reconstructs a Hub-and-Spoke tunnel from phase1 + its tunnel interface + BGP +
// the <name>_local address set. Returns (nil, false) if the tunnel isn't Hub-and-Spoke.
func (f *FortiClient) ReadHubSpoke(name string) (*FGHubSpokeReadback, bool) {
	p1, err := f.getRawObject("/api/v2/cmdb/vpn.ipsec/phase1-interface/" + url.PathEscape(name))
	if err != nil {
		return nil, false
	}
	str := func(m map[string]json.RawMessage, k string) string {
		if v, ok := m[k]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	sender := str(p1, "auto-discovery-sender") == "enable"
	receiver := str(p1, "auto-discovery-receiver") == "enable"
	if !sender && !receiver {
		return nil, false
	}
	rb := &FGHubSpokeReadback{
		Name:       name,
		Role:       HubSpokeRoleHub,
		Interface:  str(p1, "interface"),
		AuthMethod: defaultStr(str(p1, "authmethod"), "psk"),
		Proposal:   str(p1, "proposal"),
	}
	if receiver {
		rb.Role = HubSpokeRoleSpoke
		// A hub is a dialup listener with no remote-gw; only a spoke carries the hub's public IP.
		if gw := str(p1, "remote-gw"); gw != "" && gw != "0.0.0.0" {
			rb.RemoteGW = gw
		}
	}
	if rb.AuthMethod == "signature" {
		// certificate is a member table [{name}]; peer CA rides on the user.peer.
		if v, ok := p1["certificate"]; ok {
			var certs []map[string]string
			if json.Unmarshal(v, &certs) == nil && len(certs) > 0 {
				rb.Certificate = certs[0]["name"]
			}
		}
	}

	// Tunnel interface overlay IPs.
	if iface, e := f.getRawObject("/api/v2/cmdb/system/interface/" + url.PathEscape(name)); e == nil {
		rb.TunnelIP = firstField(str(iface, "ip"))              // "10.10.1.1 255.255.255.255" → "10.10.1.1"
		rb.RemoteIP = fgRemoteIPToCIDR(str(iface, "remote-ip")) // "10.10.1.2 255.255.255.0" → "10.10.1.2/24"
	}

	// BGP: local AS + this tunnel's neighbors (individual) or neighbor-range (range).
	bgp := f.GetBGPSummary()
	rb.LocalAS = bgp.LocalAS
	rb.LocalSubnets = f.hubSpokeLocalSubnets(name)

	if rb.Role == HubSpokeRoleHub {
		// Range if a neighbor-group named <name> exists; else Individual (neighbors in the overlay).
		overlay := parseOverlayCIDR(rawRemoteIP(f, name))
		rangeMode := false
		for _, m := range f.bgpChildRows("neighbor-range") {
			var grp, prefix string
			json.Unmarshal(m["neighbor-group"], &grp) //nolint:errcheck
			json.Unmarshal(m["prefix"], &prefix)      //nolint:errcheck
			if grp == name {
				rangeMode = true
				rb.SpokeRangePrefix = FGSubnetToCIDR(prefix)
			}
		}
		if rangeMode {
			rb.SpokeType = "range"
		} else {
			rb.SpokeType = "individual"
			for _, m := range f.bgpChildRows("neighbor") {
				var ip string
				json.Unmarshal(m["ip"], &ip) //nolint:errcheck
				p := net.ParseIP(strings.TrimSpace(ip))
				if p != nil && overlay != nil && overlay.Contains(p) {
					rb.SpokeTunnelIPs = append(rb.SpokeTunnelIPs, strings.TrimSpace(ip))
				}
			}
		}
	}
	return rb, true
}

// hubSpokeLocalSubnets reads the CIDRs the tunnel advertises from its <name>_local address set.
func (f *FortiClient) hubSpokeLocalSubnets(name string) []string {
	target := HubSpokeObjectNamesFor(name).LocalAddress
	addrs, err := f.GetAddresses()
	if err != nil {
		return nil
	}
	var out []string
	for _, a := range addrs {
		if (a.Name == target || strings.HasPrefix(a.Name, target+"_")) && strings.TrimSpace(a.Subnet) != "" {
			out = append(out, FGSubnetToCIDR(a.Subnet))
		}
	}
	return out
}

func rawRemoteIP(f *FortiClient, name string) string {
	iface, err := f.getRawObject("/api/v2/cmdb/system/interface/" + url.PathEscape(name))
	if err != nil {
		return ""
	}
	if v, ok := iface["remote-ip"]; ok {
		var s string
		json.Unmarshal(v, &s) //nolint:errcheck
		return s
	}
	return ""
}

// scalarString reads a JSON value that FortiOS may return as either a string or a number (e.g. the
// BGP `as`) into a string. Returns "" for null/missing/object values.
func scalarString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var n json.Number
	if json.Unmarshal(raw, &n) == nil {
		return n.String()
	}
	return ""
}

// firstField returns the first whitespace-separated token ("10.10.1.1 255.255.255.255" → "10.10.1.1").
func firstField(s string) string {
	fs := strings.Fields(strings.TrimSpace(s))
	if len(fs) == 0 {
		return ""
	}
	return fs[0]
}

// fgRemoteIPToCIDR turns "10.10.1.2 255.255.255.0" into "10.10.1.2/24" (host preserved, not the network).
func fgRemoteIPToCIDR(s string) string {
	fs := strings.Fields(strings.TrimSpace(s))
	if len(fs) != 2 {
		return strings.TrimSpace(s)
	}
	maskIP := net.ParseIP(fs[1])
	if maskIP == nil || maskIP.To4() == nil {
		return fs[0]
	}
	bits, _ := net.IPMask(maskIP.To4()).Size()
	return fmt.Sprintf("%s/%d", fs[0], bits)
}

// ── Conflict pre-check (item 3) ───────────────────────────────────────────────

// HubSpokeConflicts returns human-readable problems that would make this Hub-and-Spoke create fail or
// misbehave, checked against what is already on the device BEFORE anything is written:
//   - the tunnel name already exists
//   - the tunnel IP is already an interface address here
//   - a DIFFERENT local AS is already configured (BGP is one process per VDOM — a second AS collides)
//
// It never blocks on its own; the controller decides whether to warn or hard-stop.
func (f *FortiClient) HubSpokeConflicts(w FGHubSpokeWrite) []string {
	var out []string
	name := strings.TrimSpace(w.Name)

	if !w.Editing {
		if _, err := f.getRawObject("/api/v2/cmdb/vpn.ipsec/phase1-interface/" + url.PathEscape(name)); err == nil {
			out = append(out, fmt.Sprintf("a tunnel named %q already exists on this device", name))
		}
	}

	// Tunnel IP already in use by another interface.
	if ip := strings.TrimSpace(w.TunnelIP); ip != "" {
		if resp, err := f.do("GET", "/api/v2/cmdb/system/interface", nil); err == nil {
			var rows []map[string]json.RawMessage
			if json.Unmarshal(resp.Results, &rows) == nil {
				for _, m := range rows {
					var nm, ipField string
					json.Unmarshal(m["name"], &nm)    //nolint:errcheck
					json.Unmarshal(m["ip"], &ipField) //nolint:errcheck
					if nm == name {
						continue // our own tunnel interface (edit)
					}
					if firstField(ipField) == ip {
						out = append(out, fmt.Sprintf("tunnel IP %s is already used by interface %q", ip, nm))
					}
				}
			}
		}
	}

	// A different local AS already set.
	bgp := f.GetBGPSummary()
	if bgp.Configured && strings.TrimSpace(w.LocalAS) != "" && bgp.LocalAS != strings.TrimSpace(w.LocalAS) {
		out = append(out, fmt.Sprintf("BGP already runs local AS %s on this device — a Hub-and-Spoke VPN shares one AS, so use %s (or clear the existing BGP)", bgp.LocalAS, bgp.LocalAS))
	}
	return out
}

// ── Delete-impact preview (item 5) ────────────────────────────────────────────

// TunnelDeletionPreview is everything a DeleteIPsecTunnel would remove, computed WITHOUT deleting
// anything — so the confirm dialog can list the exact objects (not a generic sentence).
type TunnelDeletionPreview struct {
	Tunnel     string   `json:"tunnel"`
	Kind       string   `json:"kind"`
	Phase2     []string `json:"phase2"`
	Policies   []string `json:"policies"`
	Routes     []string `json:"routes"`    // "dst via device" labels
	Addresses  []string `json:"addresses"` // address / addrgrp names
	BGP        []string `json:"bgp"`       // BGP rows (hub-spoke) — neighbors / groups / networks
	L2TPServer bool     `json:"l2tp_server"`
}

// PreviewTunnelDeletion mirrors DeviceDeleteIPsecTunnel's matching to report what would go, read-only.
func (f *FortiClient) PreviewTunnelDeletion(name string) TunnelDeletionPreview {
	pv := TunnelDeletionPreview{Tunnel: name}

	// Kind + phase1 flags (for BGP + L2TP).
	if p1, err := f.getRawObject("/api/v2/cmdb/vpn.ipsec/phase1-interface/" + url.PathEscape(name)); err == nil {
		pv.Kind = ipsecTunnelKind(p1)
	}
	pv.L2TPServer = f.IsL2TPTunnel(name)

	// phase2 selectors.
	for _, m := range f.bgpChildRowsAt("/api/v2/cmdb/vpn.ipsec/phase2-interface") {
		var p1n, p2n string
		json.Unmarshal(m["phase1name"], &p1n) //nolint:errcheck
		json.Unmarshal(m["name"], &p2n)       //nolint:errcheck
		if p1n == name && p2n != "" {
			pv.Phase2 = append(pv.Phase2, p2n)
		}
	}

	// Policies touching the interface or matching our RA policy names.
	if policies, err := f.GetPolicies(); err == nil {
		ra := RemoteAccessObjectNamesFor(name)
		for _, p := range policies {
			touches := false
			for _, list := range [][]FGName{p.SrcIntf, p.DstIntf} {
				for _, n := range list {
					if n.Name == name {
						touches = true
					}
				}
			}
			if touches || p.Name == ra.PolicyRemoteToLocal || p.Name == ra.PolicyL2TP {
				pv.Policies = append(pv.Policies, p.Name)
			}
		}
	}

	// Routes out the tunnel interface or tagged with its name.
	if routes, err := f.GetStaticRoutes(); err == nil {
		for _, r := range routes {
			if r.Device == name || strings.Contains(r.Comment, "IPsec "+name) {
				dst := r.Dst
				if dst == "" && r.InternetServiceName != "" {
					dst = r.InternetServiceName
				}
				label := dst
				if r.Device != "" {
					label = dst + " via " + r.Device
				}
				pv.Routes = append(pv.Routes, label)
			}
		}
	}

	// Address objects the delete removes (VPN + RA + Hub-Spoke names).
	seen := map[string]bool{}
	addrNames := f.tunnelAddressNames(name)
	if addrs, err := f.GetAddresses(); err == nil {
		for _, a := range addrs {
			if addrNames[a.Name] && !seen[a.Name] {
				seen[a.Name] = true
				pv.Addresses = append(pv.Addresses, a.Name)
			}
		}
	}

	// BGP (hub-spoke).
	if pv.Kind == "hub-and-spoke" {
		overlay := parseOverlayCIDR(rawRemoteIP(f, name))
		grp := HubSpokeObjectNamesFor(name).NeighborGroup
		for _, m := range f.bgpChildRows("neighbor-group") {
			var nm string
			json.Unmarshal(m["name"], &nm) //nolint:errcheck
			if nm == grp {
				pv.BGP = append(pv.BGP, "neighbor-group "+grp)
			}
		}
		for _, m := range f.bgpChildRows("neighbor-range") {
			var g string
			json.Unmarshal(m["neighbor-group"], &g) //nolint:errcheck
			if g == grp {
				pv.BGP = append(pv.BGP, "neighbor-range → "+grp)
			}
		}
		if overlay != nil {
			for _, m := range f.bgpChildRows("neighbor") {
				var ip string
				json.Unmarshal(m["ip"], &ip) //nolint:errcheck
				if p := net.ParseIP(strings.TrimSpace(ip)); p != nil && overlay.Contains(p) {
					pv.BGP = append(pv.BGP, "neighbor "+strings.TrimSpace(ip))
				}
			}
		}
		wantNets := map[string]bool{}
		for _, s := range f.hubSpokeLocalSubnets(name) {
			wantNets[CIDRToFGSubnet(s)] = true
		}
		for _, m := range f.bgpChildRows("network") {
			var prefix string
			json.Unmarshal(m["prefix"], &prefix) //nolint:errcheck
			if wantNets[strings.TrimSpace(prefix)] {
				pv.BGP = append(pv.BGP, "network "+FGSubnetToCIDR(prefix))
			}
		}
	}
	return pv
}

// tunnelAddressNames is the set of address/addrgrp names the delete would remove for a tunnel across
// all templates (Site-to-Site, Remote Access, Hub-and-Spoke), including the <name>_local_N members.
func (f *FortiClient) tunnelAddressNames(name string) map[string]bool {
	out := map[string]bool{}
	add := func(n string) {
		if n != "" {
			out[n] = true
			for i := 1; i <= 32; i++ {
				out[fmt.Sprintf("%s_%d", n, i)] = true
			}
		}
	}
	vn := VPNObjectNamesFor(name)
	add(vn.LocalAddress)
	add(vn.RemoteAddress)
	out[vn.RemoteGatewayAddr] = true
	ra := RemoteAccessObjectNamesFor(name)
	out[ra.SplitGroup] = true
	out[ra.ClientRange] = true
	return out
}

// bgpChildRowsAt GETs an arbitrary CMDB collection as raw rows (helper for phase2 in the preview).
func (f *FortiClient) bgpChildRowsAt(path string) []map[string]json.RawMessage {
	resp, err := f.do("GET", path, nil)
	if err != nil {
		return nil
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	return rows
}

// isDuplicate is the -5 "already exists" test, shared by the hub-spoke creates so a re-run is safe.
func isDuplicate(err error) bool { return IsDuplicateObjectError(err) }

// isGoneErr reports the device's "that object isn't here" answers, so a delete of something already
// removed reads as success (the end state we wanted).
func isGoneErr(err error) bool { return IsObjectGoneError(err) }

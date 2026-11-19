package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.

// VPN wizard support — the device's own routing answer (router lookup) and the certificate /
// gateway / interface metadata that prefills the IPsec Creation Wizard.
//
// Split out of fortigate.go verbatim.

// ── Router lookup ─────────────────────────────────────────────────────────────

// FGRouteLookup is the device's own answer to "how would you reach this address?".
type FGRouteLookup struct {
	Success   bool   `json:"success"`
	Network   string `json:"network"`   // the matched route, e.g. "0.0.0.0/0" or "10.0.96.0/22"
	Gateway   string `json:"gateway"`   // "0.0.0.0" for a directly-connected network
	Interface string `json:"interface"` // what the wizard fills "Outgoing Interface" with
}

// RouterLookup asks the device which interface it would use to reach `destination`. This is what
// the FortiGate GUI's VPN wizard does when you type a Remote IP address, and it must be the
// device answering — NOT a subnet match computed here.
//
// ⚠️ Why that matters, measured on the lab device: "dmz" is configured 10.10.10.1/24, so a
// naive "which interface's subnet contains 10.10.10.254?" says dmz. The device says port1 —
// because dmz's link is DOWN, so its connected route is not in the routing table at all and the
// address falls through to the default route. The real GUI shows port1 for exactly this reason.
// A local guess would confidently bind the tunnel to a dead interface.
func (f *FortiClient) RouterLookup(destination string) (FGRouteLookup, error) {
	var out FGRouteLookup
	if net.ParseIP(strings.TrimSpace(destination)) == nil {
		return out, fmt.Errorf("%q is not a valid IP address", destination)
	}
	resp, err := f.do("GET", "/api/v2/monitor/router/lookup?destination="+url.QueryEscape(strings.TrimSpace(destination)), nil)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(resp.Results, &out); err != nil {
		return out, fmt.Errorf("failed to parse route lookup: %w", err)
	}
	return out, nil
}

// ── VPN wizard metadata ───────────────────────────────────────────────────────

// FGVPNWizardMetadata is what the VPN Creation Wizard needs beyond the interface list it
// already fetches: the two certificate pickers and a sensible Local Gateway prefill.
type FGVPNWizardMetadata struct {
	Certificates   []string `json:"certificates"`    // "Certificate Name" (signature auth)
	CACertificates []string `json:"ca_certificates"` // "Peer Certificate CA"
	DefaultGateway string   `json:"default_gateway"` // prefills "Local Gateway" (Use Remote)
	UserGroups     []string `json:"user_groups"`     // "User Group" (Remote Access — authusrgrp)

	// The vpn/l2tp SINGLETON's current state — the Native (Android/Windows) templates share this one
	// object per VDOM, so the wizard warns when a new Native VPN would overwrite an in-use one.
	L2TPEnabled   bool   `json:"l2tp_enabled"`
	L2TPRange     string `json:"l2tp_range"`      // "sip-eip" when enabled
	L2TPUserGroup string `json:"l2tp_user_group"` // usrgrp when enabled
}

// GetVPNWizardMetadata gathers those lists. Best-effort: a probe failure leaves its field empty
// rather than failing the page.
//
// The five probes run concurrently because none of them reads another's answer. Sequentially they
// cost the SUM of five round trips — measured at 1.11s against the lab FGT80E, which made this the
// slowest call behind the VPN wizard even though every individual probe is fast. Together they cost
// about as much as the slowest one.
//
// The safety argument is the same one services.Parallel documents: a *FortiClient wraps an
// http.Client and a cookie jar (both goroutine-safe), its own mutable state is behind a RWMutex,
// and these all share ONE pooled session. The rule this function adds on top is that each closure
// writes exactly ONE local variable and touches nothing else — the struct is assembled below, after
// every goroutine has finished, so the result cannot depend on which one finished first. That is
// why the L2TP probe returns a small struct rather than setting three fields: one writer, one
// variable, checkable by reading the Parallel block alone.
func (f *FortiClient) GetVPNWizardMetadata() FGVPNWizardMetadata {
	var (
		certs   []string
		cas     []string
		gateway string
		groups  []string
		l2tp    fgL2TPState
	)

	Parallel(
		func() { certs = f.availableCertificateNames() },
		func() { cas = f.peerCACertificateNames() },
		func() { gateway = f.defaultGatewayIP() },
		func() { groups = f.vpnUserGroupNames() },
		func() { l2tp = f.l2tpSingletonState() },
	)

	return FGVPNWizardMetadata{
		Certificates:   certs,
		CACertificates: cas,
		DefaultGateway: gateway,
		UserGroups:     groups,
		L2TPEnabled:    l2tp.Enabled,
		L2TPRange:      l2tp.Range,
		L2TPUserGroup:  l2tp.UserGroup,
	}
}

// fgCertRow is the shape both certificate listings come back in.
type fgCertRow struct {
	Name   string `json:"name"`
	Source string `json:"source"`
}

// certRows fetches and decodes a certificate listing, returning nil on any failure.
//
// Collapsing "the request failed" and "the body did not parse" into nil is deliberate and matches
// what the callers already did: both leave the picker empty, which is the degraded state the wizard
// is built for. An error here must not fail the page.
func (f *FortiClient) certRows(path string) []fgCertRow {
	resp, err := f.do("GET", path, nil)
	if err != nil {
		return nil
	}
	var rows []fgCertRow
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	return rows
}

// availableCertificateNames lists local certificates — the same list the GUI's "Certificate Name"
// picker shows. The monitor endpoint is what the GUI itself reads (it carries validity/type the
// CMDB table doesn't).
func (f *FortiClient) availableCertificateNames() []string {
	var out []string
	for _, r := range f.certRows("/api/v2/monitor/system/available-certificates?scope=vdom") {
		if r.Name != "" {
			out = append(out, r.Name)
		}
	}
	return out
}

// peerCACertificateNames lists the CAs offerable as a VPN peer CA.
//
// The device carries the whole public root bundle (147 CAs on the lab unit) plus a handful of
// factory ones; the GUI lists ONLY the non-bundle entries, and so do we — offering
// "DigiCert_Global_Root_CA" as a VPN peer CA is noise, not a feature. (Verified: filtering on
// source != "bundle" leaves exactly the 4 the GUI shows.)
func (f *FortiClient) peerCACertificateNames() []string {
	var out []string
	for _, r := range f.certRows("/api/v2/cmdb/vpn.certificate/ca?fields=name,source") {
		if r.Name != "" && !strings.EqualFold(r.Source, "bundle") {
			out = append(out, r.Name)
		}
	}
	return out
}

// defaultGatewayIP returns the device's current default gateway — what "Internet Access: Use
// Remote" prefills into Local Gateway, since the tunnel's own traffic must keep using it once the
// default route points into the tunnel. Empty when the device cannot answer, or answers with the
// directly-connected sentinel 0.0.0.0, which is not a gateway anyone can dial.
func (f *FortiClient) defaultGatewayIP() string {
	lk, err := f.RouterLookup("8.8.8.8")
	if err != nil || lk.Gateway == "" || lk.Gateway == "0.0.0.0" {
		return ""
	}
	return lk.Gateway
}

// vpnUserGroupNames lists the groups behind the "User Group" picker in Remote Access
// authentication (authusrgrp).
func (f *FortiClient) vpnUserGroupNames() []string {
	resp, err := f.do("GET", "/api/v2/cmdb/user/group?fields=name", nil)
	if err != nil {
		return nil
	}
	var rows []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	var out []string
	for _, r := range rows {
		if r.Name != "" {
			out = append(out, r.Name)
		}
	}
	return out
}

// fgL2TPState is the wizard-facing view of the vpn/l2tp singleton. It exists so the probe below
// hands back a single value: three separate output variables would work, but one writer to one
// variable is the property that makes the Parallel block above verifiable at a glance.
type fgL2TPState struct {
	Enabled   bool
	Range     string // "sip-eip" when enabled
	UserGroup string
}

// l2tpSingletonState reads the L2TP singleton's current state — so the Native templates can say
// "this replaces X". A disabled or unreadable singleton is the zero value, which is what the
// wizard treats as "nothing to warn about".
func (f *FortiClient) l2tpSingletonState() fgL2TPState {
	l2tp, err := f.GetL2TPServer()
	if err != nil || !strings.EqualFold(l2tp.Status, "enable") {
		return fgL2TPState{}
	}
	out := fgL2TPState{Enabled: true, UserGroup: l2tp.UserGroup}
	if l2tp.SIP != "" || l2tp.EIP != "" {
		out.Range = strings.TrimSpace(l2tp.SIP + "-" + l2tp.EIP)
	}
	return out
}

func (f *FortiClient) getPhase1s() ([]map[string]json.RawMessage, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/vpn.ipsec/phase1-interface", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse phase1-interface: %w", err)
	}
	return raw, nil
}

// ipsecTunnelStatus returns the set of tunnels the device currently reports as up.
func (f *FortiClient) ipsecTunnelStatus() map[string]bool {
	up := map[string]bool{}
	resp, err := f.do("GET", "/api/v2/monitor/vpn/ipsec", nil)
	if err != nil {
		return up
	}
	var list []struct {
		Name    string `json:"name"`
		Proxyid []struct {
			Status string `json:"status"`
		} `json:"proxyid"`
	}
	if json.Unmarshal(resp.Results, &list) != nil {
		return up
	}
	for _, t := range list {
		connected := false
		for _, p := range t.Proxyid {
			if strings.EqualFold(p.Status, "up") {
				connected = true
				break
			}
		}
		up[t.Name] = connected
	}
	return up
}

// GetIPsecTunnels lists route-based tunnels with their phase2 selectors + status.
func (f *FortiClient) GetIPsecTunnels() ([]FGIPsecTunnel, error) {
	p1s, err := f.getPhase1s()
	if err != nil {
		return nil, err
	}
	getStr := func(m map[string]json.RawMessage, k string) string {
		if v, ok := m[k]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}

	// phase2 selectors grouped by phase1name
	p2ByTunnel := map[string][]FGIPsecPhase2{}
	if resp, e := f.do("GET", "/api/v2/cmdb/vpn.ipsec/phase2-interface", nil); e == nil {
		var raw []map[string]json.RawMessage
		if json.Unmarshal(resp.Results, &raw) == nil {
			for _, m := range raw {
				p1 := getStr(m, "phase1name")
				p2ByTunnel[p1] = append(p2ByTunnel[p1], FGIPsecPhase2{
					Name:       getStr(m, "name"),
					Phase1Name: p1,
					SrcSubnet:  FGSubnetToCIDR(getStr(m, "src-subnet")),
					DstSubnet:  FGSubnetToCIDR(getStr(m, "dst-subnet")),
				})
			}
		}
	}

	status := f.ipsecTunnelStatus()

	// count firewall policies referencing each tunnel interface (src or dst intf)
	refCount := map[string]int{}
	if policies, pErr := f.GetPolicies(); pErr == nil {
		for _, p := range policies {
			for _, n := range FGNamesToStrings(p.SrcIntf) {
				refCount[n]++
			}
			for _, n := range FGNamesToStrings(p.DstIntf) {
				refCount[n]++
			}
		}
	}

	out := make([]FGIPsecTunnel, 0, len(p1s))
	for _, m := range p1s {
		name := getStr(m, "name")
		out = append(out, FGIPsecTunnel{
			Name:       name,
			Interface:  getStr(m, "interface"),
			RemoteGW:   getStr(m, "remote-gw"),
			IKEVersion: getStr(m, "ike-version"),
			Type:       getStr(m, "type"),
			Comments:   getStr(m, "comments"),
			Up:         status[name],
			Phase2:     p2ByTunnel[name],
			RefCount:   refCount[name],
			Kind:       ipsecTunnelKind(m),
		})
	}
	return out, nil
}

// GetIPsecTunnel returns a single tunnel by name (edit/view).
func (f *FortiClient) GetIPsecTunnel(name string) (*FGIPsecTunnel, error) {
	all, err := f.GetIPsecTunnels()
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].Name == name {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("IPsec tunnel %q not found", name)
}

// FGIPsecCustomRead is a tunnel's phase1/phase2 read back into the Custom form's shape, so the
// Edit page can pre-fill the manual editor. Field-for-field the inverse of FGIPsecCustom.
type FGIPsecCustomRead struct {
	IPVersion             string `json:"ip_version"`
	LocalGateway          string `json:"local_gateway"`
	ModeConfig            bool   `json:"mode_config"`
	Keepalive             string `json:"keepalive"`
	DPD                   string `json:"dpd"`
	DPDRetryCount         string `json:"dpd_retry_count"`
	DPDRetryInterval      string `json:"dpd_retry_interval"`
	FECEgress             bool   `json:"fec_egress"`
	FECIngress            bool   `json:"fec_ingress"`
	AddRoute              bool   `json:"add_route"`
	AutoDiscoverySender   bool   `json:"auto_discovery_sender"`
	AutoDiscoveryReceiver bool   `json:"auto_discovery_receiver"`
	ExchangeInterfaceIP   bool   `json:"exchange_interface_ip"`
	NetDevice             bool   `json:"net_device"`
	AggregateMember       bool   `json:"aggregate_member"`
	IKEMode               string `json:"ike_mode"`
	PeerType              string `json:"peer_type"`
	PeerID                string `json:"peer_id"`
	LocalID               string `json:"local_id"`
	Keylife               string `json:"keylife"`
	P2LocalSubnet         string `json:"p2_local_subnet"`
	P2RemoteSubnet        string `json:"p2_remote_subnet"`
	P2Proposal            string `json:"p2_proposal"`
	P2Replay              bool   `json:"p2_replay"`
	P2PFS                 bool   `json:"p2_pfs"`
	P2DHGroup             string `json:"p2_dhgroup"`
	P2LocalPort           string `json:"p2_local_port"`
	P2RemotePort          string `json:"p2_remote_port"`
	P2Protocol            string `json:"p2_protocol"`
	P2AutoNegotiate       bool   `json:"p2_auto_negotiate"`
	P2Keepalive           bool   `json:"p2_keepalive"`
	P2KeylifeSeconds      string `json:"p2_keylife_seconds"`
}

// FGIPsecTunnelEdit is a tunnel read back with everything the Edit form needs. The PSK is never
// returned (it comes back ENC-wrapped and is write-only) — HasPSK just says one is set, and a blank
// PSK on save keeps the existing one.
type FGIPsecTunnelEdit struct {
	Name         string            `json:"name"`
	Interface    string            `json:"interface"`
	IKEVersion   string            `json:"ike_version"`
	RemoteType   string            `json:"remote_type"`
	RemoteGW     string            `json:"remote_gw"`
	RemoteDDNS   string            `json:"remote_ddns"`
	NATTraversal string            `json:"nattraversal"`
	AuthMethod   string            `json:"auth_method"`
	HasPSK       bool              `json:"has_psk"`
	Certificate  string            `json:"certificate"`
	Comments     string            `json:"comments"`
	Proposal     string            `json:"proposal"`
	DHGroup      string            `json:"dhgroup"`
	Custom       FGIPsecCustomRead `json:"custom"`
}

// getOne fetches a single CMDB object as a loose string map, tolerating the array-or-object shape
// FortiOS returns. Values keep their JSON kind (string/number/bool) as a normalized string.
func (f *FortiClient) getRawObject(path string) (map[string]json.RawMessage, error) {
	resp, err := f.do("GET", path, nil)
	if err != nil {
		return nil, err
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &rows); err == nil {
		if len(rows) == 0 {
			return nil, fmt.Errorf("not found")
		}
		return rows[0], nil
	}
	var one map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &one); err != nil {
		return nil, err
	}
	return one, nil
}

// looseStr reads a raw JSON value as a string regardless of whether it came as a string, number or
// bool — FortiOS mixes all three across CMDB fields (keylife is a number, dpd a string).
func looseStr(m map[string]json.RawMessage, k string) string {
	raw, ok := m[k]
	if !ok {
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
	return strings.Trim(string(raw), `"`)
}

// memberName pulls the first member's name out of a CMDB member table (e.g. phase1 `certificate`).
func memberName(m map[string]json.RawMessage, k string) string {
	raw, ok := m[k]
	if !ok {
		return ""
	}
	var rows []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(raw, &rows) == nil && len(rows) > 0 {
		return rows[0].Name
	}
	return ""
}

// GetIPsecTunnelFull reads a tunnel's phase1 + phase2 into the Custom form's shape for editing.
func (f *FortiClient) GetIPsecTunnelFull(name string) (*FGIPsecTunnelEdit, error) {
	p1, err := f.getRawObject("/api/v2/cmdb/vpn.ipsec/phase1-interface/" + url.PathEscape(name))
	if err != nil {
		return nil, fmt.Errorf("phase1 %q: %w", name, err)
	}
	isEnable := func(k string) bool { return strings.EqualFold(looseStr(p1, k), "enable") }
	ipv6 := looseStr(p1, "ip-version") == "6"

	remoteGW := looseStr(p1, "remote-gw")
	localGW := looseStr(p1, "local-gw")
	if ipv6 {
		remoteGW = looseStr(p1, "remote-gw6")
		localGW = looseStr(p1, "local-gw6")
	}
	// The device stores a "no gateway" as 0.0.0.0 / :: — show it as blank in the form.
	if remoteGW == "0.0.0.0" || remoteGW == "::" {
		remoteGW = ""
	}
	if localGW == "0.0.0.0" || localGW == "::" {
		localGW = ""
	}
	peerType := looseStr(p1, "peertype")

	out := &FGIPsecTunnelEdit{
		Name:         name,
		Interface:    looseStr(p1, "interface"),
		IKEVersion:   defaultStr(looseStr(p1, "ike-version"), "2"),
		RemoteType:   defaultStr(looseStr(p1, "type"), "static"),
		RemoteGW:     remoteGW,
		RemoteDDNS:   looseStr(p1, "remotegw-ddns"),
		NATTraversal: looseStr(p1, "nattraversal"),
		AuthMethod:   defaultStr(looseStr(p1, "authmethod"), "psk"),
		HasPSK:       looseStr(p1, "psksecret") != "",
		Certificate:  memberName(p1, "certificate"),
		Comments:     looseStr(p1, "comments"),
		Proposal:     looseStr(p1, "proposal"),
		DHGroup:      looseStr(p1, "dhgrp"),
		Custom: FGIPsecCustomRead{
			IPVersion:             defaultStr(looseStr(p1, "ip-version"), "4"),
			LocalGateway:          localGW,
			ModeConfig:            isEnable("mode-cfg"),
			Keepalive:             looseStr(p1, "keepalive"),
			DPD:                   looseStr(p1, "dpd"),
			DPDRetryCount:         looseStr(p1, "dpd-retrycount"),
			DPDRetryInterval:      looseStr(p1, "dpd-retryinterval"),
			FECEgress:             isEnable("fec-egress"),
			FECIngress:            isEnable("fec-ingress"),
			AddRoute:              isEnable("add-route"),
			AutoDiscoverySender:   isEnable("auto-discovery-sender"),
			AutoDiscoveryReceiver: isEnable("auto-discovery-receiver"),
			ExchangeInterfaceIP:   isEnable("exchange-interface-ip"),
			NetDevice:             isEnable("net-device"),
			AggregateMember:       isEnable("aggregate-member"),
			IKEMode:               defaultStr(looseStr(p1, "mode"), "main"),
			PeerType:              map[bool]string{true: "one", false: "any"}[peerType == "one"],
			PeerID:                looseStr(p1, "peerid"),
			LocalID:               looseStr(p1, "localid"),
			Keylife:               looseStr(p1, "keylife"),
		},
	}

	// phase2 is best-effort: a phase1-only listener (rare) still edits.
	if p2, err := f.getRawObject("/api/v2/cmdb/vpn.ipsec/phase2-interface/" + url.PathEscape(name)); err == nil {
		p2enable := func(k string) bool { return strings.EqualFold(looseStr(p2, k), "enable") }
		if ipv6 {
			out.Custom.P2LocalSubnet = looseStr(p2, "src-subnet6")
			out.Custom.P2RemoteSubnet = looseStr(p2, "dst-subnet6")
		} else {
			out.Custom.P2LocalSubnet = FGSubnetToCIDR(looseStr(p2, "src-subnet"))
			out.Custom.P2RemoteSubnet = FGSubnetToCIDR(looseStr(p2, "dst-subnet"))
		}
		out.Custom.P2Proposal = looseStr(p2, "proposal")
		out.Custom.P2Replay = p2enable("replay")
		out.Custom.P2PFS = p2enable("pfs")
		out.Custom.P2DHGroup = looseStr(p2, "dhgrp")
		out.Custom.P2LocalPort = looseStr(p2, "src-port")
		out.Custom.P2RemotePort = looseStr(p2, "dst-port")
		out.Custom.P2Protocol = looseStr(p2, "protocol")
		out.Custom.P2AutoNegotiate = p2enable("auto-negotiate")
		out.Custom.P2Keepalive = p2enable("keepalive")
		out.Custom.P2KeylifeSeconds = looseStr(p2, "keylifeseconds")
	}
	return out, nil
}

// UpdateIPsecTunnel edits an existing tunnel via the Custom (manual) form. It is a PARTIAL PUT of
// the phase1 + phase2 fields the form controls, so anything the form does not cover — a dialup
// tunnel's mode-config/authusrgrp, a wizard tunnel's wizard-type — is left untouched by the device.
//
// ⚠️ w.Custom must be set (the update always goes through the manual shape). A blank PSK KEEPS the
// existing secret (it is never read back, so a blank field means "unchanged", not "erase").
func (f *FortiClient) UpdateIPsecTunnel(w FGIPsecTunnelWrite) error {
	if w.Custom == nil {
		return fmt.Errorf("update requires the custom field set")
	}

	// A signature tunnel's Peer Certificate CA still rides on its user.peer.
	if strings.EqualFold(w.AuthMethod, "signature") && strings.TrimSpace(w.PeerCA) != "" {
		if err := f.ensureIPsecPeer(w.Name, strings.TrimSpace(w.PeerCA)); err != nil {
			return fmt.Errorf("peer certificate CA: %w", err)
		}
	}

	p1 := ipsecPhase1Payload(w)
	delete(p1, "vdom") // the mkey is in the URL; vdom rides as a query param on f.do
	// A blank PSK means "leave it": never overwrite the stored secret with an empty string.
	if strings.TrimSpace(w.PSK) == "" {
		delete(p1, "psksecret")
	}
	if err := vpnIpsecPhase1InterfaceTable.Update(f, w.Name, p1); err != nil {
		return err
	}

	p2 := customPhase2Payload(w)
	delete(p2, "vdom")
	delete(p2, "name")       // the mkey is the URL; sending it as a rename is not intended
	delete(p2, "phase1name") // never re-bind an existing phase2 to a different phase1
	if err := vpnIpsecPhase2InterfaceTable.Update(f, w.Name, p2); err != nil {
		return fmt.Errorf("phase1 updated but phase2 selector failed: %w", err)
	}
	return nil
}

// CreateIPsecTunnel creates a route-based PSK tunnel: phase1-interface + one phase2 per
// (local × remote) subnet pair. Returns after phase1+phase2; callers layer routes/policies.
func (f *FortiClient) CreateIPsecTunnel(w FGIPsecTunnelWrite) error {
	proposal := defaultStr(w.Proposal, ipsecDefaultProposal)

	// Signature auth needs its user.peer (carrying the Peer Certificate CA) to exist BEFORE
	// phase1 references it — otherwise the device rejects phase1 with -3.
	if strings.EqualFold(w.AuthMethod, "signature") && strings.TrimSpace(w.PeerCA) != "" {
		if err := f.ensureIPsecPeer(w.Name, strings.TrimSpace(w.PeerCA)); err != nil {
			return fmt.Errorf("peer certificate CA: %w", err)
		}
	}

	p1 := ipsecPhase1Payload(w)
	if b, err := json.Marshal(p1); err == nil {
		// psksecret is sensitive — log everything except its value.
		masked := make(map[string]interface{}, len(p1))
		for k, v := range p1 {
			if k == "psksecret" {
				masked[k] = "***"
			} else {
				masked[k] = v
			}
		}
		mb, _ := json.Marshal(masked)
		log.Printf("[fortigate] POST vpn.ipsec/phase1-interface payload=%s (raw len=%d)", mb, len(b))
	}
	if err := vpnIpsecPhase1InterfaceTable.Create(f, p1); err != nil {
		return err
	}

	// Custom builds ONE phase2 from its own crypto/ports/lifetime — not the local×remote grid below.
	if w.Custom != nil {
		p2 := customPhase2Payload(w)
		if err := vpnIpsecPhase2InterfaceTable.Create(f, p2); err != nil {
			return fmt.Errorf("tunnel created but phase2 selector failed: %w", err)
		}
		return nil
	}

	locals := w.LocalSubnets
	if len(locals) == 0 {
		locals = []string{"0.0.0.0/0"}
	}
	remotes := w.RemoteSubnets
	if len(remotes) == 0 {
		remotes = []string{"0.0.0.0/0"}
	}
	idx := 0
	for _, ls := range locals {
		for _, rs := range remotes {
			idx++
			p2name := w.Name
			if idx > 1 {
				p2name = fmt.Sprintf("%s_p2_%d", w.Name, idx)
			}
			p2 := map[string]interface{}{
				"vdom":       "root",
				"name":       p2name,
				"phase1name": w.Name,
				"proposal":   proposal,
				"src-subnet": CIDRToFGSubnet(ls),
				"dst-subnet": CIDRToFGSubnet(rs),
			}
			// Every Remote Access template pins its own phase2 crypto (iOS and the L2TP ones need
			// older algorithms than FortiClient does).
			if w.RemoteAccess {
				crypto := raCryptoFor(w.RAClient)
				if strings.TrimSpace(w.Proposal) == "" {
					p2["proposal"] = crypto.Proposal
				}
				p2["dhgrp"] = defaultStr(w.DHGroup, crypto.P2DHGroup)
				p2["pfs"] = "disable"
				if crypto.P2Keepalive != "" {
					p2["keepalive"] = crypto.P2Keepalive
				}
			}
			// Android/Windows = L2TP over IPsec: the SA only PROTECTS the L2TP session rather than
			// carrying routed traffic, so it is transport-mode with l2tp on. Verified verbatim
			// against a tunnel the device's own wizard built. (iOS is tunnel-mode + l2tp=disable.)
			if IsL2TPRemoteAccessClient(w.RAClient) {
				p2["encapsulation"] = "transport-mode"
				p2["l2tp"] = "enable"
			}
			if err := vpnIpsecPhase2InterfaceTable.Create(f, p2); err != nil {
				return fmt.Errorf("tunnel created but phase2 selector failed: %w", err)
			}
		}
	}
	return nil
}

// DeleteIPsecTunnel removes a tunnel: its phase2 selectors first, then phase1, then the
// user.peer a signature tunnel needed (if this tunnel is the one that created it).
//
// Order matters: FortiGate refuses to delete an object another still references (-23), and the
// peer is referenced BY phase1 — so it can only go once phase1 is gone.
func (f *FortiClient) DeleteIPsecTunnel(name string) error {
	if resp, err := f.do("GET", "/api/v2/cmdb/vpn.ipsec/phase2-interface", nil); err == nil {
		var raw []map[string]json.RawMessage
		if json.Unmarshal(resp.Results, &raw) == nil {
			for _, m := range raw {
				var p1, p2 string
				json.Unmarshal(m["phase1name"], &p1) //nolint:errcheck
				json.Unmarshal(m["name"], &p2)       //nolint:errcheck
				if p1 == name && p2 != "" {
					_ = vpnIpsecPhase2InterfaceTable.Delete(f, p2)
				}
			}
		}
	}
	if err := vpnIpsecPhase1InterfaceTable.Delete(f, name); err != nil {
		return err
	}
	// Best-effort: only OUR generated peer name, and only if it exists. A peer the user made by
	// hand has a different name and is never touched.
	_ = userPeerTable.Delete(f, ipsecPeerName(name))
	return nil
}

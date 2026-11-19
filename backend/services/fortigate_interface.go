package services

import (
	"encoding/json"
	"fmt"
	"strings"
)

// FortiGate interfaces — the policy/route pickers and the full Network > Interfaces listing.
//
// Split out of fortigate.go, which had grown to ~7,800 lines and was the file every feature
// had to touch. Moved verbatim; see fortigate.go for the client these methods hang off.

// ── Interfaces ────────────────────────────────────────────────────────────────

// FGInterface holds a minimal network interface record.
type FGInterface struct {
	Name  string `json:"name"`
	Alias string `json:"alias"`
	IP    string `json:"ip"`
	Type  string `json:"type"`
}

// GetInterfaces returns all configured system interfaces.
func (f *FortiClient) GetInterfaces() ([]FGInterface, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/interface?fields=name,alias,ip,type", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse interfaces: %w", err)
	}
	getString := func(m map[string]json.RawMessage, key string) string {
		if v, ok := m[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	var out []FGInterface
	for _, m := range raw {
		out = append(out, FGInterface{
			Name:  getString(m, "name"),
			Alias: getString(m, "alias"),
			IP:    getString(m, "ip"),
			Type:  getString(m, "type"),
		})
	}
	return out, nil
}

// GetAvailableInterfaces calls the same monitor endpoint FortiGate's own GUI uses to
// populate the Incoming/Outgoing Interface pickers on the firewall policy page:
// GET /api/v2/monitor/system/available-interfaces?count=<n>&start=0&vdom=root&view_type=limited
// (path and query params confirmed against a live FortiGate 7.2.10 via the browser's
// Network tab). Unlike the raw system/interface CMDB dump (GetInterfaces), each result
// item carries two flags the real GUI itself keys off:
//   - "valid_in_policy": true only on interfaces FortiGate considers usable in a policy
//     (absent/false on hardware-switch member ports like port2..port11, which collapse
//     into their parent switch interface instead)
//   - "type": present on every real interface, but absent on the synthetic "any" entry
//     the endpoint also returns (which the real GUI's interface picker does not show)
//
// Filtering on both — rather than guessing a name/type blocklist — reproduces exactly
// what the device itself returns as eligible, confirmed field-for-field against real
// response data.
func (f *FortiClient) GetAvailableInterfaces() ([]FGInterface, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/available-interfaces?count=500&start=0&view_type=limited", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse available interfaces: %w", err)
	}
	getString := func(m map[string]json.RawMessage, key string) string {
		if v, ok := m[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getBool := func(m map[string]json.RawMessage, key string) bool {
		if v, ok := m[key]; ok {
			var b bool
			json.Unmarshal(v, &b) //nolint:errcheck
			return b
		}
		return false
	}
	getFirstIPv4 := func(m map[string]json.RawMessage) string {
		v, ok := m["ipv4_addresses"]
		if !ok {
			return ""
		}
		var addrs []struct {
			IP string `json:"ip"`
		}
		if json.Unmarshal(v, &addrs) != nil || len(addrs) == 0 {
			return ""
		}
		return addrs[0].IP
	}

	var out []FGInterface
	for _, m := range raw {
		name := getString(m, "name")
		if name == "" || getString(m, "type") == "" || !getBool(m, "valid_in_policy") {
			continue
		}
		// valid_in_policy alone still lets through two internal auto-generated interfaces
		// that the real GUI hides from this picker despite the flag being true:
		//   - NAT46/64 tunnel interfaces (e.g. "naf.root"), flagged "is_nat_tunnel"
		//   - the FortiLink fabric/switch-controller aggregate, flagged "is_switchctl_interface_mode"
		// Both signals confirmed against a live FortiGate 7.2.10's actual API response,
		// where excluding just these two brings the list to exactly the 7 interfaces the
		// real GUI shows (wan1, wan2, dmz, ha, port1, l2t.root, lan).
		if getBool(m, "is_nat_tunnel") || getBool(m, "is_switchctl_interface_mode") {
			continue
		}
		out = append(out, FGInterface{
			Name:  name,
			Alias: getString(m, "alias"),
			IP:    getFirstIPv4(m),
			Type:  getString(m, "type"),
		})
	}
	return out, nil
}

// GetRouteInterfaces returns exactly the interfaces the FortiGate GUI offers in the
// Static Route "Interface" picker — a different (wider) set than the firewall-policy
// picker (GetAvailableInterfaces). Confirmed field-for-field against a live FortiGate
// 7.2.10 (FGT80E) via /api/v2/monitor/system/available-interfaces, whose flags decide
// exactly what the GUI shows. The static-route picker keeps:
//   - every routable interface: valid_in_policy==true AND NOT is_nat_tunnel
//     (→ wan1, wan2, dmz, ha, port1, l2t.root, lan, and — unlike the policy picker —
//     fortilink, which the policy picker drops via is_switchctl_interface_mode)
//   - SD-WAN zones (type=="sdwan-zone", e.g. virtual-wan-link), which carry
//     valid_in_policy==false yet still appear as a route egress
//
// and drops the synthetic "any" (blank type), hardware-switch member ports
// (valid_in_policy absent: port2..port12), the modem, NAT46/64 tunnels (naf.root),
// and the SSL-VPN tunnel (ssl.root). "Blackhole" is a pseudo-entry the frontend adds.
func (f *FortiClient) GetRouteInterfaces() ([]FGInterface, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/available-interfaces?count=500&start=0&view_type=limited", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse route interfaces: %w", err)
	}
	getString := func(m map[string]json.RawMessage, key string) string {
		if v, ok := m[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getBool := func(m map[string]json.RawMessage, key string) bool {
		if v, ok := m[key]; ok {
			var b bool
			json.Unmarshal(v, &b) //nolint:errcheck
			return b
		}
		return false
	}
	getFirstIPv4 := func(m map[string]json.RawMessage) string {
		v, ok := m["ipv4_addresses"]
		if !ok {
			return ""
		}
		var addrs []struct {
			IP string `json:"ip"`
		}
		if json.Unmarshal(v, &addrs) != nil || len(addrs) == 0 {
			return ""
		}
		return addrs[0].IP
	}

	var out []FGInterface
	for _, m := range raw {
		name := getString(m, "name")
		typ := getString(m, "type")
		if name == "" || typ == "" {
			continue // "" type = the synthetic "any" entry the GUI never shows
		}
		routable := getBool(m, "valid_in_policy") && !getBool(m, "is_nat_tunnel")
		isSDWANZone := typ == "sdwan-zone"
		if !routable && !isSDWANZone {
			continue
		}
		out = append(out, FGInterface{
			Name:  name,
			Alias: getString(m, "alias"),
			IP:    getFirstIPv4(m),
			Type:  typ,
		})
	}
	return out, nil
}

// ── System Interface (full management: list / create / update / delete) ───────
//
// FGSystemInterface is the rich read model backing the Network > Interfaces page.
// It mirrors the columns the FortiGate GUI shows (Name, Type, Members, IP/Netmask,
// Administrative Access) plus the create/edit form fields. Field names/enums were
// confirmed live against a FortiGate 7.2.10 (FGT80E) CMDB system/interface schema.
type FGSystemInterface struct {
	Name         string   `json:"name"`
	Alias        string   `json:"alias"`
	Type         string   `json:"type"` // physical | vlan | aggregate | redundant | hard-switch | switch | loopback | tunnel | ...
	VDOM         string   `json:"vdom"`
	IP           string   `json:"ip"`     // CIDR ("10.10.10.1/24"); "" when unassigned
	Status       string   `json:"status"` // administrative status: up | down
	Role         string   `json:"role"`   // lan | wan | dmz | undefined
	VLANID       int      `json:"vlanid"`
	Interface    string   `json:"interface"`   // parent interface (VLAN / emac-vlan)
	Mode         string   `json:"mode"`        // static | dhcp | pppoe (addressing mode)
	AllowAccess  []string `json:"allowaccess"` // administrative access services
	Description  string   `json:"description"`
	VLANProtocol string   `json:"vlan_protocol"`         // 8021q | 8021ad
	DeviceID     string   `json:"device_identification"` // enable | disable
	Members      []string `json:"members"`               // switch / aggregate member ports
	SecondaryIP  bool     `json:"secondary_ip"`

	// RefCount = q_ref (from ?with_meta=1) — how many other CMDB objects (policies, VIPs, DHCP
	// servers, static routes, ...) point at this interface. Same "Ref" column pattern already used
	// for addresses/services/VIPs/schedules (see fortigate_object.go) — never implemented here
	// before, even though the real GUI's Interfaces table has always shown it.
	RefCount int `json:"ref_count"`

	// DHCPRanges = the configured DHCP scope(s) serving ON this interface ("start-end" strings),
	// joined from system/dhcp/server.interface — the real GUI's "DHCP Ranges" column. Distinct from
	// "DHCP Clients" (live leases), which this app does not read.
	DHCPRanges []string `json:"dhcp_ranges"`

	// Addressing-mode extras (for edit prefill)
	DefaultGW            bool   `json:"default_gw"`          // DHCP/PPPoE "Retrieve default gateway from server"
	Distance             int    `json:"distance"`            // administrative distance
	DNSServerOverride    bool   `json:"dns_server_override"` // "Override internal DNS"
	IPManagedByIPAM      bool   `json:"ip_managed_by_ipam"`
	PPPoEUsername        string `json:"pppoe_username"`
	SecurityMode         string `json:"security_mode"` // none | captive-portal | 802.1X
	EgressShapingProfile string `json:"egress_shaping_profile"`

	// Runtime link state (from monitor/system/interface); nil when unknown.
	LinkUp *bool   `json:"link_up"`
	Speed  float64 `json:"speed_mbps"`
}

// vsMember mirrors one member row of system/interface (mkey "interface-name").
type fgIntfMember struct {
	InterfaceName string `json:"interface-name"`
}

// interfaceLinkState fetches runtime link/speed from monitor/system/interface.
// Best-effort: any error yields an empty map so the list still renders.
func (f *FortiClient) interfaceLinkState() map[string]struct {
	Up    bool
	Speed float64
} {
	out := map[string]struct {
		Up    bool
		Speed float64
	}{}
	resp, err := f.do("GET", "/api/v2/monitor/system/interface", nil)
	if err != nil {
		return out
	}
	// results can be an object keyed by name OR an array — handle both.
	var asObj map[string]struct {
		Name  string  `json:"name"`
		Link  bool    `json:"link"`
		Speed float64 `json:"speed"`
	}
	if json.Unmarshal(resp.Results, &asObj) == nil && len(asObj) > 0 {
		for k, v := range asObj {
			name := v.Name
			if name == "" {
				name = k
			}
			out[name] = struct {
				Up    bool
				Speed float64
			}{v.Link, v.Speed}
		}
		return out
	}
	var asArr []struct {
		Name  string  `json:"name"`
		Link  bool    `json:"link"`
		Speed float64 `json:"speed"`
	}
	if json.Unmarshal(resp.Results, &asArr) == nil {
		for _, v := range asArr {
			out[v.Name] = struct {
				Up    bool
				Speed float64
			}{v.Link, v.Speed}
		}
	}
	return out
}

// hardwareSwitchMembers maps each hardware-switch name → its member ports, read from
// system/virtual-switch (the CMDB system/interface "member" table is empty for a
// hard-switch — its ports live under virtual-switch, confirmed live).
func (f *FortiClient) hardwareSwitchMembers() map[string][]string {
	out := map[string][]string{}
	resp, err := f.do("GET", "/api/v2/cmdb/system/virtual-switch", nil)
	if err != nil {
		return out
	}
	var vsw []struct {
		Name string `json:"name"`
		Port []struct {
			Name string `json:"name"`
		} `json:"port"`
	}
	if json.Unmarshal(resp.Results, &vsw) != nil {
		return out
	}
	for _, s := range vsw {
		ports := make([]string, 0, len(s.Port))
		for _, p := range s.Port {
			ports = append(ports, p.Name)
		}
		out[s.Name] = ports
	}
	return out
}

// GetSystemInterfaces returns every configured system interface with the display and
// form fields the Network > Interfaces page needs. It merges four sources:
//  1. cmdb/system/interface   — the interface objects themselves (+ ?with_meta=1 for q_ref)
//  2. cmdb/system/virtual-switch — hardware-switch member ports
//  3. monitor/system/interface   — runtime link status / speed
//  4. cmdb/system/dhcp/server    — DHCP scopes, joined by their "interface" field
func (f *FortiClient) GetSystemInterfaces() ([]FGSystemInterface, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/interface?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse system interfaces: %w", err)
	}

	hwMembers := f.hardwareSwitchMembers()
	linkState := f.interfaceLinkState()

	// Best-effort: a DHCP read failing must not blank out the whole interface list over one
	// column. dhcpByInterface maps interface name -> "start-end" range strings.
	dhcpByInterface := map[string][]string{}
	if servers, dErr := f.GetDHCPServers(); dErr == nil {
		for _, s := range servers {
			for _, r := range s.IPRanges {
				dhcpByInterface[s.Interface] = append(dhcpByInterface[s.Interface], r.StartIP+"-"+r.EndIP)
			}
		}
	}

	getString := func(m map[string]json.RawMessage, key string) string {
		if v, ok := m[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getInt := func(m map[string]json.RawMessage, key string) int {
		if v, ok := m[key]; ok {
			var i int
			json.Unmarshal(v, &i) //nolint:errcheck
			return i
		}
		return 0
	}

	out := make([]FGSystemInterface, 0, len(raw))
	for _, m := range raw {
		name := getString(m, "name")
		if name == "" {
			continue
		}
		typ := getString(m, "type")

		// Members: software switch / aggregate use the "member" table; hardware
		// switch pulls from virtual-switch.
		var members []string
		if v, ok := m["member"]; ok {
			var mem []fgIntfMember
			if json.Unmarshal(v, &mem) == nil {
				for _, mm := range mem {
					if mm.InterfaceName != "" {
						members = append(members, mm.InterfaceName)
					}
				}
			}
		}
		if len(members) == 0 {
			if hw, ok := hwMembers[name]; ok {
				members = hw
			}
		}

		// allowaccess is a space-separated string in the CMDB payload.
		var access []string
		if a := getString(m, "allowaccess"); a != "" {
			access = strings.Fields(a)
		}

		ipCIDR := ""
		if ip := getString(m, "ip"); ip != "" && ip != "0.0.0.0 0.0.0.0" {
			ipCIDR = FGSubnetToCIDR(ip)
		}

		secondary := false
		if v, ok := m["secondaryip"]; ok {
			var arr []json.RawMessage
			if json.Unmarshal(v, &arr) == nil && len(arr) > 0 {
				secondary = true
			}
		}

		iface := FGSystemInterface{
			Name:         name,
			Alias:        getString(m, "alias"),
			Type:         typ,
			VDOM:         getString(m, "vdom"),
			IP:           ipCIDR,
			Status:       getString(m, "status"),
			Role:         getString(m, "role"),
			VLANID:       getInt(m, "vlanid"),
			Interface:    getString(m, "interface"),
			Mode:         getString(m, "mode"),
			AllowAccess:  access,
			Description:  getString(m, "description"),
			VLANProtocol: getString(m, "vlan-protocol"),
			DeviceID:     getString(m, "device-identification"),
			Members:      members,
			SecondaryIP:  secondary,
			RefCount:     getInt(m, "q_ref"),
			DHCPRanges:   dhcpByInterface[name],

			DefaultGW:            FGStringToBool(getString(m, "defaultgw")),
			Distance:             getInt(m, "distance"),
			DNSServerOverride:    FGStringToBool(getString(m, "dns-server-override")),
			IPManagedByIPAM:      FGStringToBool(getString(m, "ip-managed-by-fortiipam")),
			PPPoEUsername:        getString(m, "username"),
			SecurityMode:         getString(m, "security-mode"),
			EgressShapingProfile: getString(m, "egress-shaping-profile"),
		}
		if ls, ok := linkState[name]; ok {
			up := ls.Up
			iface.LinkUp = &up
			iface.Speed = ls.Speed
		}
		out = append(out, iface)
	}
	return out, nil
}

// Do exposes a raw authenticated GET for ad-hoc inspection (e.g. fetching a CMDB
// object's ?action=schema to see real field names/options for a given FortiOS build).
func (f *FortiClient) Do(method, path string) ([]byte, error) {
	resp, err := f.do(method, path, nil)
	if err != nil {
		return nil, err
	}
	return resp.Results, nil
}

// GetGUIFeatureFlags fetches system/settings and returns the "gui-*" feature-visibility
// flags relevant to the firewall policy Security Profiles section (e.g. gui-ips,
// gui-antivirus). FortiGate's admin can hide a whole security-profile category from the
// GUI (System > Feature Visibility) without deleting the underlying profile objects —
// this is how a device can have real IPS sensor objects configured yet not show an IPS
// toggle on the policy page. Returns an empty map (not an error) if the field is absent
// on this FortiOS build, so callers can fall back to "show everything".
func (f *FortiClient) GetGUIFeatureFlags() (map[string]bool, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/settings", nil)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &m); err != nil {
		return nil, fmt.Errorf("failed to parse system/settings: %w", err)
	}
	out := map[string]bool{}
	for k, v := range m {
		if len(k) < 4 || k[:4] != "gui-" {
			continue
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			out[k] = strings.ToLower(s) == "enable"
		}
	}
	return out, nil
}

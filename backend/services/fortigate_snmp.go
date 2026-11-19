package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var snmpCommunityTable = cmdbPath{path: "system.snmp/community", noun: "SNMP community"}
var snmpUserTable = cmdbPath{path: "system.snmp/user", noun: "SNMP user"}

// System ▸ SNMP — the agent itself, the v1/v2c communities, and the v3 users.
//
// Three CMDB tables, confirmed against a live FortiOS 7.2.10 before this file was written
// (`system.snmp/sysinfo`, `system.snmp/community`, `system.snmp/user`):
//
//	sysinfo    a SINGLE object, no mkey — a GET still answers with a one-element array.
//	community  mkey `id` (integer, device-assigned), with a NESTED `hosts` table of its own.
//	user       mkey `name` (string), and the only one of the three that holds secrets.
//
// Four things about these tables are not guessable from FortiGate's own GUI, and each one has
// already cost somebody a wasted round elsewhere in this console:
//
//  1. **`events` is one space-separated string, not a list.** 42 options on 7.2.10 — the same set
//     for communities and users. The device's own default leaves two of them off
//     (`fm-conf-change`, `device-new`), which is why the default value cannot be used as the
//     catalogue; the catalogue is `SNMPEventOptions` below, read off `action=schema`.
//  2. **Every status field is the string "enable"/"disable", never a JSON boolean.** They are
//     booleans on this side of the wire and converted at the edge, once, in this file.
//  3. **`auth-pwd` and `priv-pwd` read back as the literal `ENC XXXX`.** That is a pointer, not a
//     password — writing it back would set the user's password to the four characters "XXXX".
//     Both are `*string` on the write struct for the same reason admin passwords are
//     (fortigate_adminuser.go): nil means "leave it alone", and only a non-nil value is sent.
//  4. **A community host's `ip` carries an address AND a mask** ("10.0.0.5 255.255.255.255") even
//     though the GUI shows one box. Splitting that apart is `hostIPToAddr`, and putting it back is
//     `addrToHostIP` — a bare address written straight through is accepted by some builds and
//     silently widened by others, so this never sends one.

// ── The event catalogue ───────────────────────────────────────────────────────

// SNMPEventOptions is every trap a community or a user can subscribe to, in the device's own
// order — which is also the order FortiGate's GUI lists them in, so the page can render the
// catalogue without re-sorting it into a different shape than the firewall shows.
//
// Read from `?action=schema` on FortiOS 7.2.10 rather than typed out of the GUI: the GUI labels
// and the CMDB names disagree often enough ("IPS detected an attack" is `ips-signature`,
// "HA cluster status change" is `ha-switch`) that one list has to be the source, and it is this.
var SNMPEventOptions = []string{
	"cpu-high", "mem-low", "log-full", "intf-ip", "vpn-tun-up", "vpn-tun-down",
	"ha-switch", "ha-hb-failure", "ips-signature", "ips-anomaly",
	"av-virus", "av-oversize", "av-pattern", "av-fragmented",
	"fm-if-change", "fm-conf-change", "bgp-established", "bgp-backward-transition",
	"ha-member-up", "ha-member-down", "ent-conf-change",
	"av-conserve", "av-bypass", "av-oversize-passed", "av-oversize-blocked",
	"ips-pkg-update", "ips-fail-open", "temperature-high", "voltage-alert",
	"power-supply-failure", "faz-disconnect", "wc-ap-up", "wc-ap-down",
	"fswctl-session-up", "fswctl-session-down", "load-balance-real-server-down",
	"device-new", "per-cpu-high", "dhcp", "pool-usage",
	"ospf-nbr-state-change", "ospf-virtnbr-state-change",
}

var snmpEventSet = func() map[string]bool {
	m := make(map[string]bool, len(SNMPEventOptions))
	for _, e := range SNMPEventOptions {
		m[e] = true
	}
	return m
}()

// snmpEventsToSlice splits the device's one string into the list the form works with.
//
// Unknown names are DROPPED rather than passed through. A newer FortiOS can return an event this
// build has no label for; carrying it into a checkbox list would draw a box with a raw CMDB name
// on it, and — worse — writing it back on an unrelated edit would be this console asserting a
// subscription it never showed anyone.
func snmpEventsToSlice(s string) []string {
	fields := strings.Fields(s)
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if snmpEventSet[f] {
			out = append(out, f)
		}
	}
	return out
}

// snmpEventsToString joins the list back, de-duplicated and in the catalogue's order.
//
// Order matters more than it looks: the device stores what it is given, and a form that posts its
// checkboxes in click order would rewrite the stored string on every save, making the Change
// Ledger show a diff on a field nobody touched.
func snmpEventsToString(v []string) string {
	want := make(map[string]bool, len(v))
	for _, e := range v {
		if snmpEventSet[e] {
			want[e] = true
		}
	}
	out := make([]string, 0, len(want))
	for _, e := range SNMPEventOptions {
		if want[e] {
			out = append(out, e)
		}
	}
	return strings.Join(out, " ")
}

// ── enable/disable ↔ bool ─────────────────────────────────────────────────────

func snmpOn(s string) bool { return strings.EqualFold(strings.TrimSpace(s), "enable") }

func snmpFlag(b bool) string {
	if b {
		return "enable"
	}
	return "disable"
}

// ── A community host's address ────────────────────────────────────────────────

const snmpHostAnyMask = "255.255.255.255"

// hostIPToAddr drops the mask the device stores beside the address.
//
// A /32 mask is what the GUI's single "IP Address" box produces, so showing it would be showing
// the operator a field they never filled in. Anything WIDER than a /32 is a real subnet the
// operator chose, and that is kept — printed back as `addr/mask`, because silently narrowing a
// /24 of trusted managers to one host is the kind of edit that looks like it worked.
func hostIPToAddr(ip string) string {
	fields := strings.Fields(ip)
	switch len(fields) {
	case 0:
		return ""
	case 1:
		return fields[0]
	default:
		if fields[1] == snmpHostAnyMask || fields[1] == "" {
			return fields[0]
		}
		return fields[0] + "/" + fields[1]
	}
}

// addrToHostIP is hostIPToAddr backwards: whatever the form holds becomes the `addr mask` pair
// FortiOS stores. A bare address gets the /32 the GUI would have given it.
func addrToHostIP(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	if a, mask, ok := strings.Cut(addr, "/"); ok {
		return strings.TrimSpace(a) + " " + strings.TrimSpace(mask)
	}
	if strings.Contains(addr, " ") {
		return strings.Join(strings.Fields(addr), " ")
	}
	return addr + " " + snmpHostAnyMask
}

// ── SNMP agent (system.snmp/sysinfo) ──────────────────────────────────────────

// FGSNMPSysInfo is the agent itself: whether it answers at all, and the three strings an SNMP
// manager displays for this firewall.
//
// The three trap thresholds ride along because two of the events above (`cpu-high`, `mem-low`)
// are meaningless without them — a subscription to "CPU usage too high" says nothing until you
// know what this device calls too high.
type FGSNMPSysInfo struct {
	Status      bool   `json:"status"`
	Description string `json:"description"`
	ContactInfo string `json:"contact_info"`
	Location    string `json:"location"`

	TrapHighCPUThreshold   int `json:"trap_high_cpu_threshold"`
	TrapLowMemoryThreshold int `json:"trap_low_memory_threshold"`
	TrapLogFullThreshold   int `json:"trap_log_full_threshold"`
}

type fgSNMPSysInfoRaw struct {
	Status      string `json:"status"`
	Description string `json:"description"`
	ContactInfo string `json:"contact-info"`
	Location    string `json:"location"`

	TrapHighCPUThreshold   int `json:"trap-high-cpu-threshold"`
	TrapLowMemoryThreshold int `json:"trap-low-memory-threshold"`
	TrapLogFullThreshold   int `json:"trap-log-full-threshold"`
}

func (r fgSNMPSysInfoRaw) toGUI() FGSNMPSysInfo {
	return FGSNMPSysInfo{
		Status:                 snmpOn(r.Status),
		Description:            r.Description,
		ContactInfo:            r.ContactInfo,
		Location:               r.Location,
		TrapHighCPUThreshold:   r.TrapHighCPUThreshold,
		TrapLowMemoryThreshold: r.TrapLowMemoryThreshold,
		TrapLogFullThreshold:   r.TrapLogFullThreshold,
	}
}

// GetSNMPSysInfo reads the agent settings.
//
// `sysinfo` has no mkey, but the CMDB still answers a collection GET with a one-element array —
// the same shape every other table uses. Unmarshalling into a single object instead fails with a
// type error that reads like a transport problem, which is why this goes through a slice.
func (f *FortiClient) GetSNMPSysInfo() (*FGSNMPSysInfo, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system.snmp/sysinfo", nil)
	if err != nil {
		return nil, err
	}
	var raw []fgSNMPSysInfoRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		// Some builds answer the single-object table with the object itself.
		var one fgSNMPSysInfoRaw
		if err2 := json.Unmarshal(resp.Results, &one); err2 != nil {
			return nil, fmt.Errorf("failed to parse SNMP agent settings: %w", err)
		}
		raw = []fgSNMPSysInfoRaw{one}
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("SNMP agent settings not returned by the device")
	}
	s := raw[0].toGUI()
	return &s, nil
}

func snmpSysInfoPayload(s FGSNMPSysInfo) map[string]any {
	body := map[string]any{
		"status":       snmpFlag(s.Status),
		"description":  s.Description,
		"contact-info": s.ContactInfo,
		"location":     s.Location,
	}
	// Zero is not a threshold anyone sets, and FortiOS keeps its own default when the key is
	// absent — so an unset field leaves the device's value alone instead of flooring it.
	if s.TrapHighCPUThreshold > 0 {
		body["trap-high-cpu-threshold"] = s.TrapHighCPUThreshold
	}
	if s.TrapLowMemoryThreshold > 0 {
		body["trap-low-memory-threshold"] = s.TrapLowMemoryThreshold
	}
	if s.TrapLogFullThreshold > 0 {
		body["trap-log-full-threshold"] = s.TrapLogFullThreshold
	}
	return body
}

// UpdateSNMPSysInfo writes the agent settings. PUT on the table itself — there is no key to
// address, because there is only ever one of these.
func (f *FortiClient) UpdateSNMPSysInfo(s FGSNMPSysInfo) error {
	_, err := f.do("PUT", "/api/v2/cmdb/system.snmp/sysinfo", snmpSysInfoPayload(s))
	return err
}

// ── SNMP v1/v2c communities (system.snmp/community) ───────────────────────────

// FGSNMPHost is one entry of a community's nested `hosts` table.
//
// `ID` is the device's own key for the row. It is carried rather than regenerated because FortiOS
// treats a nested table as a complete replacement on PUT: a host that keeps its id survives the
// write as the same row, and one that does not is a delete plus an insert.
type FGSNMPHost struct {
	ID       int    `json:"id"`
	IP       string `json:"ip"`
	HostType string `json:"host_type"` // any | query | trap
}

type FGSNMPCommunity struct {
	ID     int          `json:"id"`
	Name   string       `json:"name"`
	Status bool         `json:"status"`
	Hosts  []FGSNMPHost `json:"hosts"`

	QueryV1Status  bool `json:"query_v1_status"`
	QueryV1Port    int  `json:"query_v1_port"`
	QueryV2cStatus bool `json:"query_v2c_status"`
	QueryV2cPort   int  `json:"query_v2c_port"`

	TrapV1Status  bool `json:"trap_v1_status"`
	TrapV1LPort   int  `json:"trap_v1_lport"`
	TrapV1RPort   int  `json:"trap_v1_rport"`
	TrapV2cStatus bool `json:"trap_v2c_status"`
	TrapV2cLPort  int  `json:"trap_v2c_lport"`
	TrapV2cRPort  int  `json:"trap_v2c_rport"`

	Events []string `json:"events"`
}

type fgSNMPHostRaw struct {
	ID       int    `json:"id"`
	IP       string `json:"ip"`
	HostType string `json:"host-type"`
}

type fgSNMPCommunityRaw struct {
	ID     int             `json:"id"`
	Name   string          `json:"name"`
	Status string          `json:"status"`
	Hosts  []fgSNMPHostRaw `json:"hosts"`

	QueryV1Status  string `json:"query-v1-status"`
	QueryV1Port    int    `json:"query-v1-port"`
	QueryV2cStatus string `json:"query-v2c-status"`
	QueryV2cPort   int    `json:"query-v2c-port"`

	TrapV1Status  string `json:"trap-v1-status"`
	TrapV1LPort   int    `json:"trap-v1-lport"`
	TrapV1RPort   int    `json:"trap-v1-rport"`
	TrapV2cStatus string `json:"trap-v2c-status"`
	TrapV2cLPort  int    `json:"trap-v2c-lport"`
	TrapV2cRPort  int    `json:"trap-v2c-rport"`

	Events string `json:"events"`
}

func (r fgSNMPCommunityRaw) toGUI() FGSNMPCommunity {
	hosts := make([]FGSNMPHost, 0, len(r.Hosts))
	for _, h := range r.Hosts {
		hosts = append(hosts, FGSNMPHost{
			ID:       h.ID,
			IP:       hostIPToAddr(h.IP),
			HostType: h.HostType,
		})
	}
	return FGSNMPCommunity{
		ID:             r.ID,
		Name:           r.Name,
		Status:         snmpOn(r.Status),
		Hosts:          hosts,
		QueryV1Status:  snmpOn(r.QueryV1Status),
		QueryV1Port:    r.QueryV1Port,
		QueryV2cStatus: snmpOn(r.QueryV2cStatus),
		QueryV2cPort:   r.QueryV2cPort,
		TrapV1Status:   snmpOn(r.TrapV1Status),
		TrapV1LPort:    r.TrapV1LPort,
		TrapV1RPort:    r.TrapV1RPort,
		TrapV2cStatus:  snmpOn(r.TrapV2cStatus),
		TrapV2cLPort:   r.TrapV2cLPort,
		TrapV2cRPort:   r.TrapV2cRPort,
		Events:         snmpEventsToSlice(r.Events),
	}
}

// snmpPort falls back to the protocol default rather than sending 0. FortiOS accepts 0 and then
// answers nothing on that socket, which looks exactly like a firewall rule problem.
func snmpPort(v, fallback int) int {
	if v <= 0 || v > 65535 {
		return fallback
	}
	return v
}

func snmpCommunityPayload(c FGSNMPCommunity) map[string]any {
	hosts := make([]map[string]any, 0, len(c.Hosts))
	for i, h := range c.Hosts {
		ip := addrToHostIP(h.IP)
		if ip == "" {
			continue // a blank row in the form is not a host
		}
		id := h.ID
		if id <= 0 {
			// A new row still needs a key. Positions are 1-based and unique within the table,
			// which is all FortiOS asks of a nested id.
			id = i + 1
		}
		ht := h.HostType
		if ht == "" {
			ht = "any"
		}
		hosts = append(hosts, map[string]any{"id": id, "ip": ip, "host-type": ht})
	}

	return map[string]any{
		"name":   c.Name,
		"status": snmpFlag(c.Status),
		// Always sent, even when empty: the nested table is REPLACED by what the PUT carries, so
		// leaving the key out on an edit that removed the last host would keep that host in force.
		"hosts":            hosts,
		"query-v1-status":  snmpFlag(c.QueryV1Status),
		"query-v1-port":    snmpPort(c.QueryV1Port, 161),
		"query-v2c-status": snmpFlag(c.QueryV2cStatus),
		"query-v2c-port":   snmpPort(c.QueryV2cPort, 161),
		"trap-v1-status":   snmpFlag(c.TrapV1Status),
		"trap-v1-lport":    snmpPort(c.TrapV1LPort, 162),
		"trap-v1-rport":    snmpPort(c.TrapV1RPort, 162),
		"trap-v2c-status":  snmpFlag(c.TrapV2cStatus),
		"trap-v2c-lport":   snmpPort(c.TrapV2cLPort, 162),
		"trap-v2c-rport":   snmpPort(c.TrapV2cRPort, 162),
		"events":           snmpEventsToString(c.Events),
	}
}

func (f *FortiClient) GetSNMPCommunities() ([]FGSNMPCommunity, error) {
	raw, err := cmdbRaws[fgSNMPCommunityRaw](f, snmpCommunityTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGSNMPCommunity, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

// GetSNMPCommunity fetches one by id, for the edit form.
func (f *FortiClient) GetSNMPCommunity(id int) (*FGSNMPCommunity, error) {
	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/system.snmp/community/%d", id), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgSNMPCommunityRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse SNMP community: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("SNMP community %d not found", id)
	}
	c := raw[0].toGUI()
	return &c, nil
}

// CreateSNMPCommunity returns the id the device assigned. The id is never sent on a create —
// FortiOS allocates it, and supplying one collides with a row the operator cannot see.
func (f *FortiClient) CreateSNMPCommunity(c FGSNMPCommunity) (int, error) {
	resp, err := f.do("POST", "/api/v2/cmdb/system.snmp/community", snmpCommunityPayload(c))
	if err != nil {
		return 0, err
	}
	if resp.MKey != nil {
		switch v := resp.MKey.(type) {
		case float64:
			return int(v), nil
		case int:
			return v, nil
		}
	}
	return 0, nil
}

func (f *FortiClient) UpdateSNMPCommunity(id int, c FGSNMPCommunity) error {
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/system.snmp/community/%d", id), snmpCommunityPayload(c))
	return err
}

// DeleteSNMPCommunity removes one BY ID. Never a collection URL — see fortios-gotchas.md.
func (f *FortiClient) DeleteSNMPCommunity(id int) error {
	return snmpCommunityTable.Delete(f, strconv.Itoa(id))
}

// ── SNMP v3 users (system.snmp/user) ──────────────────────────────────────────

// FGSNMPUser is one v3 user.
//
// The two passwords are deliberately absent. A read returns `ENC XXXX` for both, which is the
// device saying "there is one" and nothing more — so that is exactly what this carries, as the
// two Has… booleans. The form shows "leave blank to keep", the same contract the Administrators
// page uses for admin passwords.
type FGSNMPUser struct {
	Name   string `json:"name"`
	Status bool   `json:"status"`

	SecurityLevel string `json:"security_level"` // no-auth-no-priv | auth-no-priv | auth-priv
	AuthProto     string `json:"auth_proto"`
	PrivProto     string `json:"priv_proto"`
	HasAuthPwd    bool   `json:"has_auth_pwd"`
	HasPrivPwd    bool   `json:"has_priv_pwd"`

	NotifyHosts []string `json:"notify_hosts"`

	Queries   bool `json:"queries"`
	QueryPort int  `json:"query_port"`

	TrapStatus bool `json:"trap_status"`
	TrapLPort  int  `json:"trap_lport"`
	TrapRPort  int  `json:"trap_rport"`

	Events []string `json:"events"`
}

// FGSNMPUserWrite is a create or an edit.
//
// AuthPwd/PrivPwd are POINTERS for the same reason FGAdminWrite.Password is: nil omits the key and
// the device keeps what it has, where an empty string would replace a working credential with
// nothing. The read value `ENC XXXX` must never reach this struct — the controller is what stops
// that, by only ever filling these from what the operator typed.
type FGSNMPUserWrite struct {
	FGSNMPUser
	AuthPwd *string
	PrivPwd *string
}

type fgSNMPUserRaw struct {
	Name   string `json:"name"`
	Status string `json:"status"`

	SecurityLevel string `json:"security-level"`
	AuthProto     string `json:"auth-proto"`
	AuthPwd       string `json:"auth-pwd"`
	PrivProto     string `json:"priv-proto"`
	PrivPwd       string `json:"priv-pwd"`

	NotifyHosts string `json:"notify-hosts"`

	Queries   string `json:"queries"`
	QueryPort int    `json:"query-port"`

	TrapStatus string `json:"trap-status"`
	TrapLPort  int    `json:"trap-lport"`
	TrapRPort  int    `json:"trap-rport"`

	Events string `json:"events"`
}

// snmpSecretSet reports whether the device is holding a password in this field.
//
// A read never returns the password itself. A user that has one reads back as the literal
// `ENC XXXX`; one that does not reads back empty. So the question "is a secret set" is answered by
// the field being non-empty — NOT by it looking like a password, which it never will.
func snmpSecretSet(v string) bool {
	return strings.TrimSpace(v) != ""
}

func (r fgSNMPUserRaw) toGUI() FGSNMPUser {
	return FGSNMPUser{
		Name:          r.Name,
		Status:        snmpOn(r.Status),
		SecurityLevel: r.SecurityLevel,
		AuthProto:     r.AuthProto,
		PrivProto:     r.PrivProto,
		HasAuthPwd:    snmpSecretSet(r.AuthPwd),
		HasPrivPwd:    snmpSecretSet(r.PrivPwd),
		NotifyHosts:   strings.Fields(r.NotifyHosts),
		Queries:       snmpOn(r.Queries),
		QueryPort:     r.QueryPort,
		TrapStatus:    snmpOn(r.TrapStatus),
		TrapLPort:     r.TrapLPort,
		TrapRPort:     r.TrapRPort,
		Events:        snmpEventsToSlice(r.Events),
	}
}

func snmpUserPayload(w FGSNMPUserWrite) map[string]any {
	level := w.SecurityLevel
	if level == "" {
		level = "no-auth-no-priv"
	}

	body := map[string]any{
		"name":           w.Name,
		"status":         snmpFlag(w.Status),
		"security-level": level,
		"notify-hosts":   strings.Join(w.NotifyHosts, " "),
		"queries":        snmpFlag(w.Queries),
		"query-port":     snmpPort(w.QueryPort, 161),
		"trap-status":    snmpFlag(w.TrapStatus),
		"trap-lport":     snmpPort(w.TrapLPort, 162),
		"trap-rport":     snmpPort(w.TrapRPort, 162),
		"events":         snmpEventsToString(w.Events),
	}

	// The protocol keys are only meaningful at the level that uses them, and FortiOS rejects
	// `priv-proto` outright on an auth-no-priv user (-8). Sending them conditionally is what keeps
	// a level change from failing on a field the new level does not have.
	if level == "auth-no-priv" || level == "auth-priv" {
		if w.AuthProto != "" {
			body["auth-proto"] = w.AuthProto
		}
		if w.AuthPwd != nil {
			body["auth-pwd"] = *w.AuthPwd
		}
	}
	if level == "auth-priv" {
		if w.PrivProto != "" {
			body["priv-proto"] = w.PrivProto
		}
		if w.PrivPwd != nil {
			body["priv-pwd"] = *w.PrivPwd
		}
	}
	return body
}

func (f *FortiClient) GetSNMPUsers() ([]FGSNMPUser, error) {
	raw, err := cmdbRaws[fgSNMPUserRaw](f, snmpUserTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGSNMPUser, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

// GetSNMPUser fetches one by name, for the edit form.
func (f *FortiClient) GetSNMPUser(name string) (*FGSNMPUser, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system.snmp/user/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgSNMPUserRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse SNMP user: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("SNMP user %q not found", name)
	}
	u := raw[0].toGUI()
	return &u, nil
}

func (f *FortiClient) CreateSNMPUser(w FGSNMPUserWrite) error {
	return snmpUserTable.Create(f, snmpUserPayload(w))
}

// UpdateSNMPUser writes one by name. The name itself is the mkey, so renaming is a delete and a
// create — not something this offers.
func (f *FortiClient) UpdateSNMPUser(name string, w FGSNMPUserWrite) error {
	return snmpUserTable.Update(f, name, snmpUserPayload(w))
}

// DeleteSNMPUser removes one BY NAME. Never a collection URL — see fortios-gotchas.md.
func (f *FortiClient) DeleteSNMPUser(name string) error {
	return snmpUserTable.Delete(f, name)
}

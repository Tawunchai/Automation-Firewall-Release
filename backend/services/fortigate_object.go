package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var serviceCustomTable = cmdbPath{path: "firewall/service/custom", noun: "custom"}

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var vipTable = cmdbPath{path: "firewall/vip", noun: "virtual IP"}
var firewallPolicyTable = cmdbPath{path: "firewall/policy", noun: "firewall policy"}

// The service table is spelled differently across firmware versions; both are tried, in order.
var servicePrimaryTable = cmdbPath{path: "firewall.service/custom", noun: "service"}
var serviceFallbackTable = cmdbPath{path: "firewall/service/custom", noun: "service"}

// Policy & Objects — firewall policies, addresses, virtual IPs, services and schedules, plus
// the generic name-list fetcher the pickers share.
//
// Split out of fortigate.go verbatim; see fortigate.go for the client these methods hang off.

// ── Generic name-list fetcher (used for schedules & security profiles) ───────

// fetchNames GETs a CMDB path restricted to the "name" field and returns the name list.
// Used for object types where the policy form only needs a name to reference (profiles,
// protocol options, IP pools, etc). Returns an empty slice (not an error) when the path
// doesn't exist on this FortiOS build, so an optional feature (e.g. no IPS sensors
// configured) doesn't break the rest of the form.
func (f *FortiClient) fetchNames(path string) ([]FGName, error) {
	resp, err := f.do("GET", path+"?fields=name", nil)
	if err != nil {
		return []FGName{}, nil //nolint:nilerr
	}
	var names []FGName
	if err := json.Unmarshal(resp.Results, &names); err != nil {
		return []FGName{}, nil
	}
	return names, nil
}

func (f *FortiClient) GetAVProfiles() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/antivirus/profile")
}

func (f *FortiClient) GetWebFilterProfiles() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/webfilter/profile")
}

func (f *FortiClient) GetDNSFilterProfiles() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/dnsfilter/profile")
}

func (f *FortiClient) GetAppControlLists() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/application/list")
}

func (f *FortiClient) GetIPSSensors() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/ips/sensor")
}

func (f *FortiClient) GetFileFilterProfiles() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/file-filter/profile")
}

func (f *FortiClient) GetSSLSSHProfiles() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall/ssl-ssh-profile")
}

func (f *FortiClient) GetIPPools() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall/ippool")
}

func (f *FortiClient) GetProtocolOptions() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall/profile-protocol-options")
}

// GetDecryptedTrafficMirrors lists firewall/decrypted-traffic-mirror objects — the
// datasource backing the firewall policy's "decrypted-traffic-mirror" field (confirmed
// via the live CMDB schema: field type string, datasource "firewall.decrypted-traffic-mirror.name").
func (f *FortiClient) GetDecryptedTrafficMirrors() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall/decrypted-traffic-mirror")
}

func (f *FortiClient) GetAddressGroups() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall/addrgrp")
}

func (f *FortiClient) GetServiceGroups() ([]FGName, error) {
	return f.fetchNames("/api/v2/cmdb/firewall.service/group")
}

// GetSchedules merges onetime, recurring, and group schedules into a single list.
// "always" and "none" are built-in recurring schedules, so they come back for free.
func (f *FortiClient) GetSchedules() ([]FGSchedule, error) {
	var out []FGSchedule
	for _, entry := range []struct {
		path   string
		fgType string
	}{
		{"/api/v2/cmdb/firewall.schedule/recurring", "recurring"},
		{"/api/v2/cmdb/firewall.schedule/onetime", "onetime"},
		{"/api/v2/cmdb/firewall.schedule/group", "group"},
	} {
		names, err := f.fetchNames(entry.path)
		if err != nil {
			continue
		}
		for _, n := range names {
			out = append(out, FGSchedule{Name: n.Name, Type: entry.fgType})
		}
	}
	return out, nil
}

// ── Firewall Schedules (full CRUD: recurring / onetime / group) ───────────────
//
// FortiOS keeps schedules in three sibling CMDB tables, each with its own field set (verified
// live against FortiGate 7.2.10):
//
//	firewall.schedule/recurring : start/end = "hh:mm", day = space-joined weekday names
//	firewall.schedule/onetime   : start/end = "hh:mm yyyy/mm/dd", expiration-days = 0-100
//	firewall.schedule/group     : member    = list of other schedule names
//
// FGScheduleFull is our GUI-shaped union across all three — only the fields relevant to `Type`
// are populated. The "Type" column in the GUI is not a stored field; it is which table the row
// came from, so we carry it explicitly.
type FGScheduleFull struct {
	Name string `json:"name"`
	Type string `json:"type"` // recurring | onetime | group

	// recurring + onetime
	Start string   `json:"start"` // recurring "hh:mm"; onetime "hh:mm yyyy/mm/dd"
	End   string   `json:"end"`
	Day   []string `json:"day"` // recurring only: sunday..saturday

	// onetime only — Pre-expiration event log: 0 = off, 1-100 = write a log this many days early
	ExpirationDays int `json:"expiration_days"`

	// group only
	Member []string `json:"member"`

	Color int `json:"color"` // 0-32 (0 = default)
	Ref   int `json:"ref"`   // q_ref — how many policies use it (GUI "Ref" column)
}

// schedulePaths maps our schedule type to its FortiGate CMDB path.
var schedulePaths = map[string]cmdbPath{
	"recurring": {path: "firewall.schedule/recurring", noun: "recurring schedule"},
	"onetime":   {path: "firewall.schedule/onetime", noun: "one-time schedule"},
	"group":     {path: "firewall.schedule/group", noun: "schedule group"},
}

// IsValidScheduleType reports whether t is one of the three schedule tables.
func IsValidScheduleType(t string) bool {
	_, ok := schedulePaths[t]
	return ok
}

// builtinScheduleNames are the schedules FortiOS ships and its own GUI will not let you edit or
// delete ("always" = 24/7, "none" = never). We surface them in the list (the GUI does) but block
// mutation, exactly like built-in services.
var builtinScheduleNames = map[string]bool{
	"always": true,
	"none":   true,
}

// IsBuiltinSchedule reports whether name is a FortiOS built-in schedule.
func IsBuiltinSchedule(name string) bool {
	return builtinScheduleNames[name]
}

// fgScheduleRaw is the wire shape shared by all three tables — every field is optional, so one
// struct decodes any of them. day/member come back as space-joined strings (FortiOS "user"/list
// scalar form), which we split into slices.
type fgScheduleRaw struct {
	Name           string          `json:"name"`
	Start          string          `json:"start"`
	End            string          `json:"end"`
	Day            string          `json:"day"`
	ExpirationDays int             `json:"expiration-days"`
	Member         json.RawMessage `json:"member"` // [{name:...}] on group, absent elsewhere
	Color          int             `json:"color"`
	QRef           int             `json:"q_ref"`
}

func (r fgScheduleRaw) toFull(fgType string) FGScheduleFull {
	s := FGScheduleFull{
		Name: r.Name, Type: fgType,
		Start: r.Start, End: r.End,
		ExpirationDays: r.ExpirationDays,
		Color:          r.Color, Ref: r.QRef,
	}
	// day is a space-joined weekday list; "none" means no day is selected.
	if d := strings.Fields(r.Day); len(d) > 0 && r.Day != "none" {
		s.Day = d
	}
	if len(r.Member) > 0 {
		var members []FGName
		if json.Unmarshal(r.Member, &members) == nil {
			s.Member = FGNamesToStrings(members)
		}
	}
	return s
}

// GetSchedulesAll returns every schedule across all three tables, with reference counts
// (with_meta=1 → q_ref). Built-in "always"/"none" are included, matching the GUI.
func (f *FortiClient) GetSchedulesAll() ([]FGScheduleFull, error) {
	out := []FGScheduleFull{}
	for _, t := range []string{"recurring", "onetime", "group"} {
		rows, err := cmdbRaws[fgScheduleRaw](f, schedulePaths[t], "with_meta=1")
		if err != nil {
			continue // a table the device doesn't populate shouldn't sink the whole list
		}
		for _, r := range rows {
			out = append(out, r.toFull(t))
		}
	}
	return out, nil
}

// GetSchedule returns one schedule's full detail for the edit form.
func (f *FortiClient) GetSchedule(fgType, name string) (*FGScheduleFull, error) {
	table, ok := schedulePaths[fgType]
	if !ok {
		return nil, fmt.Errorf("unknown schedule type: %s", fgType)
	}
	row, err := cmdbRawGet[fgScheduleRaw](f, table, name, "with_meta=1")
	if err != nil {
		return nil, err
	}
	s := row.toFull(fgType)
	return &s, nil
}

// buildSchedulePayload turns our GUI form into the FortiOS body for the given table. Only the
// fields that table owns are emitted; day/member are space-joined the way FortiOS stores them.
func buildSchedulePayload(s FGScheduleFull) map[string]interface{} {
	p := map[string]interface{}{
		"name":  s.Name,
		"color": s.Color,
	}
	switch s.Type {
	case "recurring":
		// "All day" is start == end == "00:00" (FortiOS treats an empty span as 24h).
		p["start"] = defaultStr(s.Start, "00:00")
		p["end"] = defaultStr(s.End, "00:00")
		if len(s.Day) > 0 {
			p["day"] = strings.Join(s.Day, " ")
		} else {
			p["day"] = "none"
		}
	case "onetime":
		p["start"] = s.Start
		p["end"] = s.End
		p["expiration-days"] = s.ExpirationDays // 0 = Pre-expiration event log OFF
	case "group":
		p["member"] = NamesToFGNames(s.Member)
	}
	return p
}

// CreateSchedule creates a schedule of the given type on the device.
func (f *FortiClient) CreateSchedule(s FGScheduleFull) error {
	table, ok := schedulePaths[s.Type]
	if !ok {
		return fmt.Errorf("unknown schedule type: %s", s.Type)
	}
	return table.Create(f, buildSchedulePayload(s))
}

// UpdateSchedule replaces a schedule by its current name. FortiOS resets omitted fields to their
// defaults on PUT (observed: a partial `expiration-days:0` silently reverts to 3), so we always
// send the full object — the same rule the AntiVirus/WebFilter update paths follow.
func (f *FortiClient) UpdateSchedule(fgType, name string, s FGScheduleFull) error {
	table, ok := schedulePaths[fgType]
	if !ok {
		return fmt.Errorf("unknown schedule type: %s", fgType)
	}
	return table.Update(f, name, buildSchedulePayload(s))
}

// DeleteSchedule removes one schedule by mkey (never at the collection URL — see the DELETE gotcha).
func (f *FortiClient) DeleteSchedule(fgType, name string) error {
	table, ok := schedulePaths[fgType]
	if !ok {
		return fmt.Errorf("unknown schedule type: %s", fgType)
	}
	return table.Delete(f, name)
}

// ── Firewall Policy ───────────────────────────────────────────────────────────

func (f *FortiClient) GetPolicies() ([]FGPolicy, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/policy", nil)
	if err != nil {
		return nil, err
	}
	var policies []FGPolicy
	if err := json.Unmarshal(resp.Results, &policies); err != nil {
		return nil, fmt.Errorf("failed to parse policies: %w", err)
	}
	return policies, nil
}

func (f *FortiClient) CreatePolicy(p FGPolicy) (*FGPolicy, error) {
	resp, err := f.do("POST", "/api/v2/cmdb/firewall/policy", p)
	if err != nil {
		return nil, err
	}
	// Fetch created policy by mkey (policyid)
	if resp.MKey != nil {
		mkey := fmt.Sprintf("%v", resp.MKey)
		r2, err := f.do("GET", "/api/v2/cmdb/firewall/policy/"+mkey, nil)
		if err == nil {
			var policies []FGPolicy
			if json.Unmarshal(r2.Results, &policies) == nil && len(policies) > 0 {
				return &policies[0], nil
			}
		}
	}
	return &p, nil
}

func (f *FortiClient) UpdatePolicy(policyID int, p FGPolicy) error {
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/firewall/policy/%d", policyID), p)
	return err
}

func (f *FortiClient) DeletePolicy(policyID int) error {
	return firewallPolicyTable.Delete(f, strconv.Itoa(policyID))
}

// MovePolicy repositions a policy in the rule base using FortiGate's move action:
// PUT /firewall/policy/<id>?action=move&before|after=<refID>. Order matters for the
// first-match principle, so the wizard's "Index" field calls this after create.
func (f *FortiClient) MovePolicy(policyID int, position string, refID int) error {
	if position != "before" && position != "after" {
		position = "before"
	}
	path := fmt.Sprintf("/api/v2/cmdb/firewall/policy/%d?action=move&%s=%d", policyID, position, refID)
	_, err := f.do("PUT", path, nil)
	return err
}

func (f *FortiClient) TogglePolicyStatus(policyID int, enable bool) error {
	status := "disable"
	if enable {
		status = "enable"
	}
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/firewall/policy/%d", policyID), map[string]string{"status": status})
	return err
}

// ── Address ───────────────────────────────────────────────────────────────────

func (f *FortiClient) GetAddresses() ([]FGAddress, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/address", nil)
	if err != nil {
		return nil, err
	}
	var addrs []FGAddress
	if err := json.Unmarshal(resp.Results, &addrs); err != nil {
		return nil, fmt.Errorf("failed to parse addresses: %w", err)
	}
	return addrs, nil
}

func (f *FortiClient) CreateAddress(a FGAddress) error {
	return addressTable.Create(f, a)
}

func (f *FortiClient) UpdateAddress(name string, a FGAddress) error {
	return addressTable.Update(f, name, a)
}

func (f *FortiClient) DeleteAddress(name string) error {
	return addressTable.Delete(f, name)
}

// ── Virtual IPs (firewall/vip) ────────────────────────────────────────────────
//
// FGVirtualIP is our GUI-shaped view of a firewall/vip object — one flat struct mirroring the
// FortiOS "New Virtual IP" page. vipPayload / fgToVirtualIP convert to/from the real CMDB JSON.
//
// GUI → CMDB mapping, every row verified live on a FortiGate 7.2.10 (FGT80E) by POSTing each
// shape and reading it back:
//
//	Type "Static NAT"                         → type=static-nat + extip + mappedip[{range}]
//	Type "FQDN"                               → type=fqdn + extaddr[{name}] + mapped-addr
//	  ⚠️ FQDN uses extaddr (an FQDN address object), NOT extip. Sending extip on an fqdn VIP —
//	     or an empty/0.0.0.0 extip — is rejected with "-8 Extip is invalid".
//	Interface                                 → extintf ("any" when the GUI shows the "any" box)
//	External IP address/range                 → extip ("a.b.c.d" or "a.b.c.d-a.b.c.e")
//	Map to → IPv4 address/range               → mappedip[{range}]
//	Optional Filters · Source address         → src-filter[{range}]  (IPs/ranges/subnets)
//	Optional Filters · Services               → service[{name}]
//	  ⚠️ When Services are set the device DERIVES the external port from them and stores
//	     extport=0 — which is exactly why the GUI HIDES "External service port" once Services is on.
//	Port Forwarding                           → portforward {enable|disable} + protocol
//	Port Mapping Type "One to one"/"Many..."  → portmapping-type {1-to-1|m-to-n}
//	External service port / Map to IPv4 port  → extport / mappedport ("80" or a range "8000-8010")
type FGVirtualIP struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	Type      string `json:"type"`      // static-nat | fqdn
	Interface string `json:"interface"` // extintf; "" or "any" = any interface

	// Static NAT
	ExtIP    string `json:"ext_ip"`    // external IP or range "a-b"
	MappedIP string `json:"mapped_ip"` // mapped IP or range "a-b"

	// FQDN
	ExtAddr    string `json:"ext_addr"`    // external FQDN address name
	MappedAddr string `json:"mapped_addr"` // mapped FQDN address name

	// Optional Filters
	SourceFilter []string `json:"source_filter"` // src IPs/ranges/subnets
	Services     []string `json:"services"`      // service names

	// Port Forwarding
	PortForward     bool   `json:"port_forward"`
	Protocol        string `json:"protocol"`          // tcp | udp | sctp | icmp
	PortMappingType string `json:"port_mapping_type"` // 1-to-1 | m-to-n
	ExtPort         string `json:"ext_port"`          // "80" or "8000-8010"
	MappedPort      string `json:"mapped_port"`

	// There is deliberately no Enabled/status field here. firewall/vip's SCHEMA advertises
	// `status` (option, disable|enable, default enable) and it cannot be used on 7.2.10: a REST
	// write carrying it is answered 200/201 and the value is discarded, and the CLI refuses
	// `set status` outright with a parse error, return code -61. Adding the field back would put a
	// switch in the UI that reports success and changes nothing on the firewall.
	// Verified on the lab FGT80E, 2026-09-16 — see references/fortios-gotchas.md.

	// Read-only extras for the list page.
	RefCount int `json:"ref_count,omitempty"`
}

var (
	vipTypes        = map[string]bool{"static-nat": true, "fqdn": true}
	vipProtocols    = map[string]bool{"tcp": true, "udp": true, "sctp": true, "icmp": true}
	vipPortMappings = map[string]bool{"1-to-1": true, "m-to-n": true}
)

// vipNameRefs renders a list of object names as FortiOS's [{"name": …}] datasource shape, which
// is how firewall.vip references addresses and services.
func vipNameRefs(names []string) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(names))
	for _, n := range names {
		if n = strings.TrimSpace(n); n != "" {
			out = append(out, map[string]interface{}{"name": n})
		}
	}
	return out
}

func vipRangeRefs(ranges []string) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(ranges))
	for _, r := range ranges {
		if r = strings.TrimSpace(r); r != "" {
			out = append(out, map[string]interface{}{"range": r})
		}
	}
	return out
}

// ValidateVirtualIP catches the input the device would only reject with a bare code — most of all
// the FQDN/extip trap — so the form gets a sentence instead of "-8".
func ValidateVirtualIP(v FGVirtualIP) error {
	if strings.TrimSpace(v.Name) == "" {
		return fmt.Errorf("name is required")
	}
	typ := defaultStr(strings.ToLower(strings.TrimSpace(v.Type)), "static-nat")
	if !vipTypes[typ] {
		return fmt.Errorf("invalid VIP type %q (static-nat or fqdn)", v.Type)
	}
	switch typ {
	case "static-nat":
		ext := strings.TrimSpace(v.ExtIP)
		if ext == "" {
			return fmt.Errorf("external IP address/range is required")
		}
		if !isIPOrRange(ext) {
			return fmt.Errorf("external IP address/range %q is not a valid IP or range (e.g. 203.0.113.10 or 203.0.113.10-203.0.113.20)", v.ExtIP)
		}
		if m := strings.TrimSpace(v.MappedIP); m == "" {
			return fmt.Errorf("mapped IPv4 address/range is required")
		} else if !isIPOrRange(m) {
			return fmt.Errorf("mapped IPv4 address/range %q is not a valid IP or range", v.MappedIP)
		}
	case "fqdn":
		// The FQDN VIP maps an EXTERNAL FQDN to a MAPPED FQDN — both are firewall address names,
		// and extip must NOT be sent (that is the -8 trap).
		if strings.TrimSpace(v.ExtAddr) == "" {
			return fmt.Errorf("external FQDN address is required for an FQDN virtual IP")
		}
		if strings.TrimSpace(v.MappedAddr) == "" {
			return fmt.Errorf("mapped FQDN address is required for an FQDN virtual IP")
		}
	}
	if v.PortForward {
		if p := strings.ToLower(strings.TrimSpace(v.Protocol)); p != "" && !vipProtocols[p] {
			return fmt.Errorf("invalid protocol %q (tcp, udp, sctp or icmp)", v.Protocol)
		}
		if pm := strings.TrimSpace(v.PortMappingType); pm != "" && !vipPortMappings[pm] {
			return fmt.Errorf("invalid port mapping type %q (1-to-1 or m-to-n)", v.PortMappingType)
		}
		// icmp has no ports, so the port fields are only required for the L4 protocols — and only
		// when Services aren't driving the port (the GUI hides the port field in that case).
		if strings.ToLower(strings.TrimSpace(v.Protocol)) != "icmp" && len(v.Services) == 0 {
			if strings.TrimSpace(v.ExtPort) == "" {
				return fmt.Errorf("external service port is required for port forwarding")
			}
			if strings.TrimSpace(v.MappedPort) == "" {
				return fmt.Errorf("mapped port is required for port forwarding")
			}
		}
	}
	return nil
}

// isIPOrRange accepts "a.b.c.d" or "a.b.c.d-a.b.c.e".
func isIPOrRange(s string) bool {
	s = strings.TrimSpace(s)
	if net.ParseIP(s) != nil {
		return true
	}
	if lo, hi, ok := strings.Cut(s, "-"); ok {
		return net.ParseIP(strings.TrimSpace(lo)) != nil && net.ParseIP(strings.TrimSpace(hi)) != nil
	}
	return false
}

// vipPayload builds the CMDB body. Every field is sent explicitly (no omitempty) so an update can
// turn a previously-set option back off.
func vipPayload(v FGVirtualIP) map[string]interface{} {
	typ := defaultStr(strings.ToLower(strings.TrimSpace(v.Type)), "static-nat")
	p := map[string]interface{}{
		"name":    v.Name,
		"comment": v.Comment,
		"type":    typ,
		"extintf": defaultStr(strings.TrimSpace(v.Interface), "any"),
	}

	switch typ {
	case "static-nat":
		p["extip"] = strings.TrimSpace(v.ExtIP)
		p["mappedip"] = vipRangeRefs([]string{v.MappedIP})
	case "fqdn":
		// FQDN maps an external FQDN address to a mapped FQDN address; extip is not used here
		// (sending it is the -8 trap), and portforward is not offered for this type.
		p["extaddr"] = vipNameRefs([]string{v.ExtAddr})
		p["mapped-addr"] = strings.TrimSpace(v.MappedAddr)
	}

	// Optional Filters (both types).
	p["src-filter"] = vipRangeRefs(v.SourceFilter)
	p["service"] = vipNameRefs(v.Services)

	// Port Forwarding — only meaningful for static-nat.
	if typ == "static-nat" && v.PortForward {
		p["portforward"] = "enable"
		p["protocol"] = defaultStr(strings.ToLower(strings.TrimSpace(v.Protocol)), "tcp")
		p["portmapping-type"] = defaultStr(strings.TrimSpace(v.PortMappingType), "1-to-1")
		// icmp has no ports at all. For the L4 protocols the MAPPED port is always sent, but the
		// EXTERNAL port is omitted when Services are set: the device derives it from the service
		// and stores extport=0 (which is exactly why the GUI hides that one field but keeps
		// "Map to IPv4 port" — image 3).
		if !strings.EqualFold(v.Protocol, "icmp") {
			p["mappedport"] = strings.TrimSpace(v.MappedPort)
			if len(v.Services) == 0 {
				p["extport"] = strings.TrimSpace(v.ExtPort)
			}
		}
	} else {
		p["portforward"] = "disable"
	}
	return p
}

// fgToVirtualIP parses a raw CMDB vip object back into the form.
func fgToVirtualIP(raw json.RawMessage) FGVirtualIP {
	var m struct {
		Name     string `json:"name"`
		Comment  string `json:"comment"`
		Type     string `json:"type"`
		ExtIntf  string `json:"extintf"`
		ExtIP    string `json:"extip"`
		MappedIP []struct {
			Range string `json:"range"`
		} `json:"mappedip"`
		ExtAddr []struct {
			Name string `json:"name"`
		} `json:"extaddr"`
		MappedAddr string `json:"mapped-addr"`
		SrcFilter  []struct {
			Range string `json:"range"`
		} `json:"src-filter"`
		Service []struct {
			Name string `json:"name"`
		} `json:"service"`
		PortForward     string `json:"portforward"`
		Protocol        string `json:"protocol"`
		PortMappingType string `json:"portmapping-type"`
		ExtPort         string `json:"extport"`
		MappedPort      string `json:"mappedport"`
		Ref             int    `json:"q_ref"`
	}
	json.Unmarshal(raw, &m) //nolint:errcheck

	v := FGVirtualIP{
		Name: m.Name, Comment: m.Comment,
		Type: m.Type, Interface: m.ExtIntf,
		ExtIP: m.ExtIP, MappedAddr: m.MappedAddr,
		Protocol: m.Protocol, PortMappingType: m.PortMappingType,
		ExtPort: m.ExtPort, MappedPort: m.MappedPort,
		PortForward: strings.EqualFold(m.PortForward, "enable"),
		RefCount:    m.Ref,
	}
	if len(m.MappedIP) > 0 {
		v.MappedIP = m.MappedIP[0].Range
	}
	if len(m.ExtAddr) > 0 {
		v.ExtAddr = m.ExtAddr[0].Name
	}
	v.SourceFilter = make([]string, 0, len(m.SrcFilter))
	for _, r := range m.SrcFilter {
		v.SourceFilter = append(v.SourceFilter, r.Range)
	}
	v.Services = make([]string, 0, len(m.Service))
	for _, s := range m.Service {
		v.Services = append(v.Services, s.Name)
	}
	return v
}

// GetVirtualIPs lists all firewall/vip objects for the list page (with_meta=1 → q_ref).
func (f *FortiClient) GetVirtualIPs() ([]FGVirtualIP, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/vip?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil {
		return nil, fmt.Errorf("failed to parse virtual IPs: %w", err)
	}
	out := make([]FGVirtualIP, 0, len(items))
	for _, it := range items {
		out = append(out, fgToVirtualIP(it))
	}
	return out, nil
}

// GetVirtualIP fetches one firewall/vip by name for the edit form.
func (f *FortiClient) GetVirtualIP(name string) (*FGVirtualIP, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/vip/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return nil, fmt.Errorf("virtual IP %q not found", name)
	}
	v := fgToVirtualIP(items[0])
	return &v, nil
}

// CreateVirtualIP creates a firewall/vip object.
func (f *FortiClient) CreateVirtualIP(v FGVirtualIP) error {
	payload := vipPayload(v)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST firewall/vip payload=%s", b)
	}
	return vipTable.Create(f, payload)
}

// UpdateVirtualIP overwrites a firewall/vip object by name.
func (f *FortiClient) UpdateVirtualIP(name string, v FGVirtualIP) error {
	payload := vipPayload(v)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT firewall/vip/%s payload=%s", name, b)
	}
	return vipTable.Update(f, name, payload)
}

// DeleteVirtualIP removes a firewall/vip by name (mkey — never the collection URL).
func (f *FortiClient) DeleteVirtualIP(name string) error {
	return vipTable.Delete(f, name)
}

// FGSDNConnector is a single Fabric/SDN connector — the datasource behind a Dynamic
// (Fabric Connector) address's "SDN Connector" dropdown.
type FGSDNConnector struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// GetSDNConnectors lists system/sdn-connector objects (Fabric Connectors).
func (f *FortiClient) GetSDNConnectors() ([]FGSDNConnector, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/sdn-connector", nil)
	if err != nil {
		return nil, err
	}
	var conns []FGSDNConnector
	if err := json.Unmarshal(resp.Results, &conns); err != nil {
		return nil, fmt.Errorf("failed to parse sdn connectors: %w", err)
	}
	return conns, nil
}

// ── Service ───────────────────────────────────────────────────────────────────

// GetServices fetches all FortiGate service objects using a robust item-by-item parsing strategy.
// Handles FortiGate quirks: category can be a string OR array, icmptype/icmpcode may be absent.
// Returns empty slice on any error so UI shows "No services" instead of 502.
func (f *FortiClient) GetServices() ([]FGService, error) {
	seen := map[string]bool{}
	var all []FGService

	// tryFetchRaw fetches a path and parses each service item individually (robust against type mismatches)
	tryFetchRaw := func(path string) {
		resp, err := f.do("GET", path, nil)
		if err != nil || resp == nil {
			return
		}
		raw := resp.Results
		if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
			return
		}

		// Parse as raw JSON array first
		var rawItems []json.RawMessage
		if json.Unmarshal(raw, &rawItems) != nil {
			return
		}

		for _, item := range rawItems {
			s := parseServiceItem(item)
			if s.Name != "" && !seen[s.Name] {
				seen[s.Name] = true
				all = append(all, s)
			}
		}
	}

	// Custom endpoint includes both user-created and built-in (predefined) services.
	// Do NOT also fetch /predefined — it returns duplicates that inflate the count.
	tryFetchRaw("/api/v2/cmdb/firewall.service/custom")

	return all, nil
}

// parseServiceItem extracts a FGService from a raw JSON object, handling FortiGate's
// inconsistent types (e.g. category as string or array).
func parseServiceItem(raw json.RawMessage) FGService {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return FGService{}
	}

	s := FGService{}

	getString := func(key string) string {
		if v, ok := m[key]; ok {
			var out string
			json.Unmarshal(v, &out) //nolint:errcheck
			return out
		}
		return ""
	}
	getInt := func(key string) int {
		if v, ok := m[key]; ok {
			var out int
			json.Unmarshal(v, &out) //nolint:errcheck
			return out
		}
		return 0
	}

	s.Name = getString("name")
	s.Protocol = getString("protocol")
	s.TCPPortRange = getString("tcp-portrange")
	s.UDPPortRange = getString("udp-portrange")
	s.SCTPPortRange = getString("sctp-portrange")
	s.ProtocolNum = getInt("protocol-number")
	s.Comment = getString("comment")
	s.Color = getInt("color")
	s.FQDN = getString("fqdn")
	s.IPRange = getString("iprange")
	s.RefCount = getInt("q_ref")

	// icmptype / icmpcode: may be int or absent
	if v, ok := m["icmptype"]; ok {
		var t int
		if json.Unmarshal(v, &t) == nil {
			s.ICMPType = &t
		}
	}
	if v, ok := m["icmpcode"]; ok {
		var c int
		if json.Unmarshal(v, &c) == nil {
			s.ICMPCode = &c
		}
	}

	// category: can be a plain string ("Web Access") or array ([{"name":"Web Access"}])
	if v, ok := m["category"]; ok {
		var catStr string
		if json.Unmarshal(v, &catStr) == nil && catStr != "" {
			s.Category = []FGName{{Name: catStr}}
		} else {
			var catArr []FGName
			if json.Unmarshal(v, &catArr) == nil {
				s.Category = catArr
			}
		}
	}

	return s
}

// svcPrimaryPath is the canonical CMDB path for firewall.service/custom.
const svcPrimaryPath = "/api/v2/cmdb/firewall.service/custom"
const svcFallbackPath = "/api/v2/cmdb/firewall/service/custom"

// isPathError returns true when the error indicates the API path was not found
// (so it's safe to retry with an alternative path). On 400/403/409 we do NOT retry.
func isPathError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "HTTP 404") || strings.Contains(msg, "HTTP 405") ||
		strings.Contains(msg, "not found") || strings.Contains(msg, "object does not exist")
}

func (f *FortiClient) CreateService(s FGService) error {
	payload := toServiceWrite(s)
	if err := serviceCustomTable.Create(f, payload); err == nil {
		return nil
	} else if !isPathError(err) {
		// 400/403 etc — path is fine, body or permissions are the issue → return immediately
		return err
	}
	// 404/405 — path not found on this FortiOS version, try alternate path
	err := serviceCustomTable.Create(f, payload)
	return err
}

func (f *FortiClient) UpdateService(name string, s FGService) error {
	payload := toServiceUpdate(s)
	encoded := url.PathEscape(name)
	if _, err := f.do("PUT", svcPrimaryPath+"/"+encoded, payload); err == nil {
		return nil
	} else if !isPathError(err) {
		return err
	}
	_, err := f.do("PUT", svcFallbackPath+"/"+encoded, payload)
	return err
}

func (f *FortiClient) DeleteService(name string) error {
	if err := servicePrimaryTable.Delete(f, name); err == nil {
		return nil
	} else if !isPathError(err) {
		return err
	}
	return serviceFallbackTable.Delete(f, name)
}

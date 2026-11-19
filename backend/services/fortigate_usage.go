package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
)

// "What would break if I deleted this?" — the question the console could not answer.
//
// Until now, deleting an object that something still references produced the device's own refusal
// (`error -15`, "object is in use"), which names nothing. The operator's only recourse was to open
// the policy table and read it. That is the wrong way round: the console has already read every
// table the answer is in.
//
// This file computes the answer, and it is used two ways:
//
//	before a delete   the confirm dialog lists the referrers instead of guessing, and the delete
//	                  button is only armed when the list is empty
//	on demand         a "Used by" panel on any object row — the everyday question, which is
//	                  usually asked long before anyone wants to delete anything
//
// ── Why it scans rather than asks ────────────────────────────────────────────
//
// FortiOS exposes a reference COUNT (`?with_meta=1` → `q_ref`) and no reference LIST. The CLI has
// `diagnose sys checkused`, which would be authoritative, but reaching it means an SSH login, and
// the lab device locks an admin account after three failed ones — too expensive for a panel that
// opens whenever somebody clicks a row. So the referring tables are read over REST and walked here.
//
// ── Why it reports its own incompleteness ────────────────────────────────────
//
// A scan can only find references in the tables it knows about, and FortiOS has more tables than
// this console models. So every report carries the device's own `q_ref` beside the number we
// found, and `Complete` is true only when they agree. When they do not, the UI says "the device
// counts 4 references; 3 are listed below" rather than implying the list is exhaustive — the same
// rule the Audit page follows about never reporting an absence of evidence as evidence of absence.
// A delete is never armed on an incomplete scan.
//
// Nothing here is cached. Every table it reads is one a user can edit, and a stale "nothing uses
// this" is the one wrong answer that ends with a deleted object (see fortigate_cache.go).

// UsageRef is one place an object is named.
type UsageRef struct {
	Table      string `json:"table"`       // CMDB path, e.g. "firewall/policy"
	Label      string `json:"label"`       // "Firewall Policy"
	Key        string `json:"key"`         // the referring object's mkey, for building a link
	Name       string `json:"name"`        // what to show — the referrer's name, or its id
	Field      string `json:"field"`       // CMDB field, e.g. "srcaddr"
	FieldLabel string `json:"field_label"` // "Source"
	Route      string `json:"route"`       // frontend route that opens the referrer
}

// UsageReport answers "what uses this object".
type UsageReport struct {
	Kind string     `json:"kind"`
	Name string     `json:"name"`
	Refs []UsageRef `json:"refs"`

	// DeviceCount is FortiOS's own q_ref for this object, or -1 when it could not be read.
	DeviceCount int `json:"device_count"`
	// Found is len(Refs) — carried separately so the UI can state both numbers.
	Found int `json:"found"`
	// Complete is true only when every table was readable AND Found accounts for DeviceCount.
	Complete bool `json:"complete"`
	// Unreadable names the tables that could not be read, so the UI can say which.
	Unreadable []string `json:"unreadable"`
	// SafeToDelete is Complete && Found == 0. The only condition under which this console will
	// arm a delete button on its own.
	SafeToDelete bool `json:"safe_to_delete"`
}

// ── The reference map ────────────────────────────────────────────────────────
//
// Which table, which field, and what the field is called in the GUI. Every entry was checked
// against the live CMDB schema on FortiOS 7.2.10; a field this firmware does not have simply
// yields nothing rather than failing the scan.

type refField struct {
	Key       string // CMDB field name
	Label     string // GUI label
	MemberKey string // key inside each member object; "" means "name"
}

type refSite struct {
	Path      string // CMDB path to read
	Label     string // GUI label for the table
	KeyField  string // field holding the referrer's own mkey
	NameField string // field to display; "" = KeyField
	Route     string // frontend route, with %s for the key
	Fields    []refField
}

// policySite is shared by most kinds — the policy table names nearly everything.
func policySite(fields ...refField) refSite {
	return refSite{
		Path: "firewall/policy", Label: "Firewall Policy",
		KeyField: "policyid", NameField: "name",
		Route:  "/admin/firewall-policy",
		Fields: fields,
	}
}

// usageSites returns the tables worth reading for one kind of object.
//
// address and addrgrp share a list: FortiOS keeps them in one namespace, so any field that accepts
// an address accepts a group, and a group can contain another group.
func usageSites(kind string) []refSite {
	addressLike := []refSite{
		policySite(
			refField{Key: "srcaddr", Label: "Source"},
			refField{Key: "dstaddr", Label: "Destination"},
		),
		{
			Path: "firewall/addrgrp", Label: "Address Group",
			KeyField: "name", Route: "/admin/fw-address-groups",
			Fields: []refField{
				{Key: "member", Label: "Member"},
				{Key: "exclude-member", Label: "Excluded member"},
			},
		},
		{
			Path: "firewall/vip", Label: "Virtual IP",
			KeyField: "name", Route: "/admin/virtual-ips",
			Fields: []refField{
				{Key: "extaddr", Label: "External address"},
				{Key: "mapped-addr", Label: "Mapped address"},
				{Key: "srcintf-filter", Label: "Source interface filter"},
			},
		},
		{
			Path: "router/static", Label: "Static Route",
			KeyField: "seq-num", Route: "/admin/static-routes",
			Fields: []refField{{Key: "dstaddr", Label: "Destination address"}},
		},
		{
			Path: "vpn.ipsec/phase2-interface", Label: "IPsec Phase 2",
			KeyField: "name", Route: "/admin/ipsec-tunnels",
			Fields: []refField{
				{Key: "src-name", Label: "Local selector"},
				{Key: "dst-name", Label: "Remote selector"},
			},
		},
	}

	serviceLike := []refSite{
		policySite(refField{Key: "service", Label: "Service"}),
		{
			Path: "firewall.service/group", Label: "Service Group",
			KeyField: "name", Route: "/admin/fw-service-groups",
			Fields: []refField{{Key: "member", Label: "Member"}},
		},
		{
			Path: "firewall/vip", Label: "Virtual IP",
			KeyField: "name", Route: "/admin/virtual-ips",
			Fields: []refField{{Key: "service", Label: "Service"}},
		},
	}

	interfaceLike := []refSite{
		policySite(
			refField{Key: "srcintf", Label: "Incoming interface"},
			refField{Key: "dstintf", Label: "Outgoing interface"},
		),
		{
			Path: "system/zone", Label: "Zone",
			KeyField: "name", Route: "/admin/zones",
			// system/zone's member key is interface-name, not name — see fortigate_zone.go.
			Fields: []refField{{Key: "interface", Label: "Member interface", MemberKey: "interface-name"}},
		},
		{
			Path: "router/static", Label: "Static Route",
			KeyField: "seq-num", Route: "/admin/static-routes",
			Fields: []refField{{Key: "device", Label: "Interface"}},
		},
		{
			Path: "firewall/vip", Label: "Virtual IP",
			KeyField: "name", Route: "/admin/virtual-ips",
			Fields: []refField{{Key: "extintf", Label: "External interface"}},
		},
		{
			Path: "firewall/ippool", Label: "IP Pool",
			KeyField: "name", Route: "/admin/ip-pools",
			Fields: []refField{
				{Key: "associated-interface", Label: "Associated interface"},
				{Key: "arp-intf", Label: "ARP interface"},
			},
		},
		{
			Path: "firewall/address", Label: "Address",
			KeyField: "name", Route: "/admin/fw-addresses",
			Fields: []refField{{Key: "associated-interface", Label: "Associated interface"}},
		},
	}

	switch kind {
	case "address", "addrgrp":
		return addressLike
	case "service", "servicegrp":
		return serviceLike
	case "interface", "zone":
		return interfaceLike
	case "ippool":
		return []refSite{policySite(refField{Key: "poolname", Label: "IP Pool"})}
	case "schedule":
		return []refSite{
			policySite(refField{Key: "schedule", Label: "Schedule"}),
			{
				Path: "firewall.schedule/group", Label: "Schedule Group",
				KeyField: "name", Route: "/admin/schedules",
				Fields: []refField{{Key: "member", Label: "Member"}},
			},
		}
	default:
		return nil
	}
}

// usageObjectPath maps a kind to the CMDB table the object itself lives in, for the q_ref read.
// A kind with no entry gets DeviceCount -1 and can never be Complete, which is the honest answer.
func usageObjectPath(kind string) string {
	switch kind {
	case "address":
		return "firewall/address"
	case "addrgrp":
		return "firewall/addrgrp"
	case "service":
		return "firewall.service/custom"
	case "servicegrp":
		return "firewall.service/group"
	case "ippool":
		return "firewall/ippool"
	case "zone":
		return "system/zone"
	case "interface":
		return "system/interface"
	default:
		return ""
	}
}

// UsageKinds is the set this scanner understands, for validating a request before it reaches the
// device.
var UsageKinds = []string{"address", "addrgrp", "service", "servicegrp", "ippool", "zone", "interface", "schedule"}

func IsUsageKind(kind string) bool {
	for _, k := range UsageKinds {
		if k == kind {
			return true
		}
	}
	return false
}

// ── The scan ─────────────────────────────────────────────────────────────────

// fieldNames pulls every object name out of one CMDB field value.
//
// A reference field arrives in one of three shapes, and all three occur in the tables above:
//
//	[]any of objects   [{"name":"LAN"},{"name":"DMZ"}]   — srcaddr, member, service
//	[]any of objects   [{"interface-name":"port1"}]      — system/zone.interface
//	string             "port1"                           — router/static.device, associated-interface
//
// Anything else yields nothing rather than an error: a firmware that changes a field's shape
// should cost this scan that one field, not the whole report.
func fieldNames(v any, memberKey string) []string {
	if memberKey == "" {
		memberKey = "name"
	}
	switch t := v.(type) {
	case string:
		if t == "" {
			return nil
		}
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			m, ok := e.(map[string]any)
			if !ok {
				continue
			}
			if s, ok := m[memberKey].(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

// rowKey renders a referrer's mkey, which is a string on most tables and a number on
// firewall/policy (policyid) and router/static (seq-num).
func rowKey(row map[string]any, field string) string {
	switch v := row[field].(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%d", int(v))
	default:
		return ""
	}
}

// readTable GETs one CMDB collection as generic rows.
func (f *FortiClient) readTable(path string) ([]map[string]any, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/"+path, nil)
	if err != nil {
		return nil, err
	}
	var rows []map[string]any
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	return rows, nil
}

// objectRefCount reads FortiOS's own reference count for one object. Returns -1 when the count
// could not be read — which is different from 0 and must never be rendered as "unused".
func (f *FortiClient) objectRefCount(path, name string) int {
	if path == "" {
		return -1
	}
	resp, err := f.do("GET", "/api/v2/cmdb/"+path+"/"+url.PathEscape(name)+"?with_meta=1", nil)
	if err != nil {
		return -1
	}
	var rows []struct {
		QRef *int `json:"q_ref"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 || rows[0].QRef == nil {
		return -1
	}
	return *rows[0].QRef
}

// FindUsage answers "what uses this object" for one named object of one kind.
func (f *FortiClient) FindUsage(kind, name string) (*UsageReport, error) {
	if !IsUsageKind(kind) {
		return nil, fmt.Errorf("unknown object kind %q", kind)
	}
	sites := usageSites(kind)
	rep := &UsageReport{Kind: kind, Name: name, Refs: []UsageRef{}, DeviceCount: -1, Unreadable: []string{}}

	type tableResult struct {
		rows []map[string]any
		err  error
	}
	results := make([]tableResult, len(sites))

	// The tables are independent reads against one device — issued together they cost about as
	// much as the slowest one (see Parallel's note). The q_ref read joins them.
	var mu sync.Mutex
	fns := make([]func(), 0, len(sites)+1)
	for i, site := range sites {
		i, site := i, site
		fns = append(fns, func() {
			rows, err := f.readTable(site.Path)
			mu.Lock()
			results[i] = tableResult{rows: rows, err: err}
			mu.Unlock()
		})
	}
	deviceCount := -1
	fns = append(fns, func() {
		n := f.objectRefCount(usageObjectPath(kind), name)
		mu.Lock()
		deviceCount = n
		mu.Unlock()
	})
	Parallel(fns...)
	rep.DeviceCount = deviceCount

	target := strings.ToLower(name)
	allReadable := true
	for i, site := range sites {
		res := results[i]
		if res.err != nil {
			allReadable = false
			rep.Unreadable = append(rep.Unreadable, site.Label)
			continue
		}
		for _, row := range res.rows {
			key := rowKey(row, site.KeyField)
			display := key
			nameField := site.NameField
			if nameField == "" {
				nameField = site.KeyField
			}
			if s, ok := row[nameField].(string); ok && s != "" {
				display = s
			}
			for _, fld := range site.Fields {
				for _, ref := range fieldNames(row[fld.Key], fld.MemberKey) {
					if strings.ToLower(ref) != target {
						continue
					}
					rep.Refs = append(rep.Refs, UsageRef{
						Table: site.Path, Label: site.Label,
						Key: key, Name: display,
						Field: fld.Key, FieldLabel: fld.Label,
						Route: site.Route,
					})
				}
			}
		}
	}

	// Stable order: by table, then by the referrer's key, so two reads of an unchanged device
	// produce the same list and a diff of two reports means something.
	sort.SliceStable(rep.Refs, func(a, b int) bool {
		if rep.Refs[a].Label != rep.Refs[b].Label {
			return rep.Refs[a].Label < rep.Refs[b].Label
		}
		if rep.Refs[a].Key != rep.Refs[b].Key {
			return rep.Refs[a].Key < rep.Refs[b].Key
		}
		return rep.Refs[a].Field < rep.Refs[b].Field
	})

	rep.Found = len(rep.Refs)

	// Completeness, stated conservatively.
	//
	// distinct referrers, not raw hits: one policy naming an address in BOTH srcaddr and dstaddr
	// is two rows here and one reference to FortiOS. Comparing raw hits against q_ref would then
	// report a complete scan as over-counted and refuse a delete that is in fact safe.
	distinct := map[string]bool{}
	for _, r := range rep.Refs {
		distinct[r.Table+"|"+r.Key] = true
	}
	rep.Complete = allReadable && rep.DeviceCount >= 0 && len(distinct) >= rep.DeviceCount
	rep.SafeToDelete = rep.Complete && rep.Found == 0

	return rep, nil
}

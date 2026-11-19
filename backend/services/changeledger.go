package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Change Audit Ledger — the device-independent half.
//
// The design decision that makes this feasible: rather than teach 40-odd handlers to describe their
// own changes, the ledger works at the **CMDB level**. Every device-proxy write ends up as a
// POST/PUT/DELETE against one FortiOS table with one mkey, so a single route→table map is enough
// to snapshot the object before and after — and, crucially, to reverse it:
//
//	create → DELETE <table>/<mkey>            (remove what was added)
//	delete → POST   <table>      + Before      (put back what was removed)
//	update → PUT    <table>/<mkey> + Before    (restore the previous body)
//
// ⚠️ Reverting a create is the one case that DELETEs, and it always carries an mkey. Issuing a
// DELETE at a CMDB *collection* URL wipes the entire table — that mistake once erased every policy
// on the lab device with no revision to restore from. BuildRevertRequest therefore refuses to
// produce a DELETE without an mkey, and there is a test that holds it to that.

// ChangeTarget is the CMDB coordinate of one device-proxy write.
type ChangeTarget struct {
	// ResourceType is the app's own name for the object class, used for display and filtering.
	ResourceType string
	// CMDBPath is the FortiOS table, WITHOUT a trailing mkey — e.g. "/api/v2/cmdb/firewall/policy".
	CMDBPath string
	// MKey is the object's primary key. Empty on a create, until the device assigns one.
	MKey string
	// Action is create | update | delete.
	Action string
}

// deviceProxySegment maps the URL segment used by the /policy/device/:id/… routes to its CMDB
// table. Kept as one table rather than scattered across handlers so that adding a resource to the
// app and forgetting to audit it is a one-line omission, visible here.
//
// Every path was taken from routes.go and cross-checked against the service that calls it.
var deviceProxySegment = map[string]struct {
	resourceType string
	cmdbPath     string
}{
	"firewall-policies": {"firewall-policy", "/api/v2/cmdb/firewall/policy"},
	"addresses":         {"address", "/api/v2/cmdb/firewall/address"},
	"virtual-ips":       {"virtual-ip", "/api/v2/cmdb/firewall/vip"},
	"services":          {"service", "/api/v2/cmdb/firewall.service/custom"},
	"static-routes":     {"static-route", "/api/v2/cmdb/router/static"},
	// These four were never added here when their own feature shipped (Phase 9's object groups and
	// zones), which meant — found while wiring Fleet Apply, which reads this same table — three
	// things silently: no Change Ledger row for any write to them, no mandatory-approval coverage
	// (moot; none of the four are in services.RequiresApproval's set), and a read-only account could
	// write to all four because getDeviceInfo's role check is this same classifier.
	"address-groups": {"address-group", "/api/v2/cmdb/firewall/addrgrp"},
	"service-groups": {"service-group", "/api/v2/cmdb/firewall.service/group"},
	"ip-pools":       {"ip-pool", "/api/v2/cmdb/firewall/ippool"},
	"zones":          {"zone", "/api/v2/cmdb/system/zone"},
	"ipsec-tunnels":  {"ipsec-tunnel", "/api/v2/cmdb/vpn.ipsec/phase1-interface"},
	"users":          {"local-user", "/api/v2/cmdb/user/local"},
	"user-groups":    {"user-group", "/api/v2/cmdb/user/group"},
	"ldap-servers":   {"ldap-server", "/api/v2/cmdb/user/ldap"},
	"radius-servers": {"radius-server", "/api/v2/cmdb/user/radius"},
	// The LDAP form's inline "Exchange server" picker.
	"exchange-connectors": {"exchange-connector", "/api/v2/cmdb/user/exchange"},
	// Security Profiles ▸ Web Rating Overrides. The mkey is the URL itself, so a revert of a
	// create names that URL and stays a single-object DELETE.
	"web-rating-overrides": {"web-rating-override", "/api/v2/cmdb/webfilter/ftgd-local-rating"},
}

// sdwanSubTable maps the SD-WAN route's table segment to its CMDB path. system/sdwan is a complex
// object, so its children are separate tables rather than fields — the same shape as schedules
// below, for the same reason: one URL segment chooses the table, the next is the mkey.
var sdwanSubTable = map[string]struct {
	resourceType string
	cmdbPath     string
}{
	"zones":   {"sdwan-zone", "/api/v2/cmdb/system/sdwan/zone"},
	"members": {"sdwan-member", "/api/v2/cmdb/system/sdwan/members"},
	"rules":   {"sdwan-rule", "/api/v2/cmdb/system/sdwan/service"},
	// The route says "performance-slas" because that is the tab's name; the table is health-check.
	"performance-slas": {"sdwan-health-check", "/api/v2/cmdb/system/sdwan/health-check"},
}

// snmpSubTable maps the System ▸ SNMP route's table segment to its CMDB path. The page covers
// three separate tables, so — exactly like sdwan above — the segment after "snmp" picks the table
// and the one after that is the mkey.
//
// `sysinfo` is in here despite having no mkey of its own: it is a single-object table, so a write
// to it records a ledger row with an empty ResourceKey. That costs the row its snapshot and its
// one-click revert (both are addressed by key), which is a real gap — but a row saying the SNMP
// agent was reconfigured, by whom and when, is worth much more than no row at all, which is what
// leaving it out of this map would produce.
var snmpSubTable = map[string]struct {
	resourceType string
	cmdbPath     string
}{
	"sysinfo":     {"snmp-agent", "/api/v2/cmdb/system.snmp/sysinfo"},
	"communities": {"snmp-community", "/api/v2/cmdb/system.snmp/community"},
	"users":       {"snmp-user", "/api/v2/cmdb/system.snmp/user"},
}

// scheduleTypePath maps the :type segment of the schedule routes to its own CMDB table — FortiOS
// splits schedules into three tables rather than discriminating on a field.
var scheduleTypePath = map[string]string{
	"recurring": "/api/v2/cmdb/firewall.schedule/recurring",
	"onetime":   "/api/v2/cmdb/firewall.schedule/onetime",
	"group":     "/api/v2/cmdb/firewall.schedule/group",
}

// securityProfileCMDBPath exposes the category→table map to the ledger. The map itself stays
// unexported in fortigate_antivirus.go, which owns it.
func securityProfileCMDBPath(category string) (string, bool) {
	p, ok := securityProfilePaths[category]
	if !ok {
		return "", false
	}
	return p.collection(), true
}

// methodAction maps an HTTP verb to a ledger action.
//
// PATCH and PUT both land on update. So does a POST to a /move or /toggle sub-route — those rewrite
// an existing object and revert by replaying its Before snapshot, exactly like any other update.
func methodAction(method string) string {
	switch strings.ToUpper(method) {
	case "POST":
		return ChangeActionCreate
	case "PUT", "PATCH":
		return ChangeActionUpdate
	case "DELETE":
		return ChangeActionDelete
	}
	return ""
}

// Action names, mirrored from entity so services does not import entity for three strings.
const (
	ChangeActionCreate = "create"
	ChangeActionUpdate = "update"
	ChangeActionDelete = "delete"
)

// ResolveChangeTarget turns a device-proxy request into a CMDB coordinate.
//
// routeTail is the part of the path after "/policy/device/:deviceId/", e.g.
// "firewall-policies/12" or "security-profiles/antivirus/Corp-AV" or
// "firewall-policies/12/toggle". Returns false for anything not worth auditing (reads, and the
// handful of write routes that do not map to a single CMDB object).
func ResolveChangeTarget(method, routeTail string) (ChangeTarget, bool) {
	action := methodAction(method)
	if action == "" {
		return ChangeTarget{}, false
	}

	parts := splitRouteTail(routeTail)
	if len(parts) == 0 {
		return ChangeTarget{}, false
	}

	switch parts[0] {
	case "security-profiles":
		// security-profiles/:category[/:name]
		if len(parts) < 2 {
			return ChangeTarget{}, false
		}
		path, ok := securityProfileCMDBPath(parts[1])
		if !ok {
			return ChangeTarget{}, false
		}
		t := ChangeTarget{
			ResourceType: "security-profile:" + parts[1],
			CMDBPath:     path,
			Action:       action,
		}
		if len(parts) >= 3 {
			t.MKey = parts[2]
		}
		return t, true

	case "schedules":
		// POST schedules            (create — type comes from the body, filled in by the caller)
		// PUT/DELETE schedules/:type/:name
		t := ChangeTarget{ResourceType: "schedule", Action: action}
		if len(parts) >= 3 {
			path, ok := scheduleTypePath[parts[1]]
			if !ok {
				return ChangeTarget{}, false
			}
			t.CMDBPath = path
			t.MKey = parts[2]
			return t, true
		}
		// A create knows its table only from the request body; the recorder fills CMDBPath in.
		return t, action == ChangeActionCreate

	case "sdwan":
		// system/sdwan is a COMPLEX object whose child tables each live on their own URL, so the
		// route's second segment picks the table rather than being an mkey:
		//   POST          sdwan/zones            · PUT/DELETE sdwan/zones/:name
		//   POST          sdwan/members          · PUT/DELETE sdwan/members/:seq
		//   POST          sdwan/performance-slas · PUT/DELETE sdwan/performance-slas/:name
		// Anything else under sdwan is a read and never reaches here.
		if len(parts) < 2 {
			return ChangeTarget{}, false
		}
		sub, ok := sdwanSubTable[parts[1]]
		if !ok {
			return ChangeTarget{}, false
		}
		t := ChangeTarget{ResourceType: sub.resourceType, CMDBPath: sub.cmdbPath, Action: action}
		if len(parts) >= 3 {
			t.MKey = parts[2]
		}
		return t, true

	case "snmp":
		// System ▸ SNMP, three tables behind one page:
		//   PATCH         snmp/sysinfo       (no mkey — the table holds one object)
		//   POST          snmp/communities   · PATCH/DELETE snmp/communities/:id
		//   POST          snmp/users         · PATCH/DELETE snmp/users/:name
		if len(parts) < 2 {
			return ChangeTarget{}, false
		}
		sub, ok := snmpSubTable[parts[1]]
		if !ok {
			return ChangeTarget{}, false
		}
		t := ChangeTarget{ResourceType: sub.resourceType, CMDBPath: sub.cmdbPath, Action: action}
		if len(parts) >= 3 {
			t.MKey = parts[2]
		}
		return t, true

	case "vpn-health":
		// Bringing a tunnel up/down is a runtime action, not a config change: there is no CMDB
		// object to snapshot and nothing to revert by replaying a body.
		return ChangeTarget{}, false
	}

	seg, ok := deviceProxySegment[parts[0]]
	if !ok {
		return ChangeTarget{}, false
	}
	t := ChangeTarget{ResourceType: seg.resourceType, CMDBPath: seg.cmdbPath, Action: action}
	if len(parts) >= 2 {
		t.MKey = parts[1]
	}
	// A trailing sub-action (…/12/toggle, …/12/move) still rewrites object 12.
	if len(parts) >= 3 && action == ChangeActionCreate {
		t.Action = ChangeActionUpdate
	}
	return t, true
}

// splitRouteTail splits a URL tail into non-empty, percent-decoded segments.
//
// Decoding matters: object names legitimately contain spaces and slashes (an address named
// "Guest Wi-Fi" arrives as "Guest%20Wi-Fi"), and storing the encoded form would make the revert
// look up a key the device does not have.
func splitRouteTail(tail string) []string {
	raw := strings.Split(strings.Trim(tail, "/"), "/")
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		if p == "" {
			continue
		}
		if dec, err := url.PathUnescape(p); err == nil {
			p = dec
		}
		out = append(out, p)
	}
	return out
}

// ── snapshots ────────────────────────────────────────────────────────────────

// SnapshotCMDBObject reads one object as raw CMDB JSON.
//
// Returns nil (not an error) when the object does not exist: that is the normal answer before a
// create and after a delete, and treating it as a failure would make the ledger refuse to record
// exactly the two changes it most needs to.
func (f *FortiClient) SnapshotCMDBObject(cmdbPath, mkey string) (json.RawMessage, error) {
	if strings.TrimSpace(cmdbPath) == "" || strings.TrimSpace(mkey) == "" {
		return nil, nil
	}
	resp, err := f.do("GET", cmdbPath+"/"+url.PathEscape(mkey), nil)
	if err != nil {
		return nil, nil //nolint:nilerr // "not found" and "unreachable" are both "no snapshot"
	}

	// A CMDB GET by mkey returns a one-element array. Unwrap it: the revert has to POST/PUT a
	// single object, and replaying a one-element array would be rejected.
	var arr []json.RawMessage
	if json.Unmarshal(resp.Results, &arr) == nil {
		if len(arr) == 0 {
			return nil, nil
		}
		return arr[0], nil
	}
	if len(resp.Results) == 0 || string(resp.Results) == "null" {
		return nil, nil
	}
	return resp.Results, nil
}

// ── revert ───────────────────────────────────────────────────────────────────

// RevertRequest is the single CMDB call that undoes one recorded change.
type RevertRequest struct {
	Method string
	Path   string
	Body   json.RawMessage
}

// BuildRevertRequest computes the inverse of one recorded change.
//
// Split out from ExecuteRevert so the dangerous part — which URL a DELETE is aimed at — is
// testable without a device.
func BuildRevertRequest(action, cmdbPath, mkey string, before json.RawMessage) (RevertRequest, error) {
	cmdbPath = strings.TrimRight(strings.TrimSpace(cmdbPath), "/")
	mkey = strings.TrimSpace(mkey)
	if cmdbPath == "" {
		return RevertRequest{}, fmt.Errorf("no CMDB path recorded for this change")
	}

	switch action {
	case ChangeActionCreate:
		// Undo a create by deleting the object that was added.
		//
		// ⚠️ Without an mkey this would be a DELETE at the collection URL, which FortiOS answers by
		// emptying the whole table. Refuse instead.
		if mkey == "" {
			return RevertRequest{}, fmt.Errorf("cannot revert: the created object has no recorded key, and deleting without one would clear the entire %s table", cmdbPath)
		}
		return RevertRequest{Method: "DELETE", Path: cmdbPath + "/" + url.PathEscape(mkey)}, nil

	case ChangeActionDelete:
		if len(before) == 0 {
			return RevertRequest{}, fmt.Errorf("cannot revert: no snapshot of the deleted object was captured")
		}
		return RevertRequest{Method: "POST", Path: cmdbPath, Body: StripCMDBMeta(before)}, nil

	case ChangeActionUpdate:
		if len(before) == 0 {
			return RevertRequest{}, fmt.Errorf("cannot revert: no snapshot of the previous state was captured")
		}
		if mkey == "" {
			return RevertRequest{}, fmt.Errorf("cannot revert: no object key was recorded")
		}
		return RevertRequest{Method: "PUT", Path: cmdbPath + "/" + url.PathEscape(mkey), Body: StripCMDBMeta(before)}, nil
	}

	return RevertRequest{}, fmt.Errorf("unsupported change action %q", action)
}

// cmdbMetaKeys are read-only fields FortiOS stamps on every object it returns. Replaying them on a
// POST/PUT is rejected (or silently ignored, which is worse — it hides a real failure), so they are
// stripped from a snapshot before it is written back.
var cmdbMetaKeys = []string{"q_origin_key", "q_ref", "q_static", "q_no_rename", "q_class", "q_type", "uuid", "obj seq"}

// StripCMDBMeta removes the device's own bookkeeping fields from a snapshot.
//
// Anything that is not a JSON object is passed through untouched: this must never be the thing that
// turns a recoverable revert into a parse error.
func StripCMDBMeta(raw json.RawMessage) json.RawMessage {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return raw
	}
	for _, k := range cmdbMetaKeys {
		delete(obj, k)
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return raw
	}
	return out
}

// ExecuteRevert applies the inverse of one recorded change to the device.
func (f *FortiClient) ExecuteRevert(action, cmdbPath, mkey string, before json.RawMessage) error {
	req, err := BuildRevertRequest(action, cmdbPath, mkey, before)
	if err != nil {
		return err
	}

	var body interface{}
	if len(req.Body) > 0 {
		var m map[string]interface{}
		if err := json.Unmarshal(req.Body, &m); err != nil {
			return fmt.Errorf("stored snapshot is not a valid object: %w", err)
		}
		body = m
	}

	resp, err := f.do(req.Method, req.Path, body)
	if err != nil {
		return err
	}
	if resp != nil && resp.Status != "" && !strings.EqualFold(resp.Status, "success") {
		// Re-creating an object that already exists is not a failure to report as one: the desired
		// end state (the object is present) already holds.
		msg := fgErrorText(resp)
		if req.Method == "POST" && isDuplicateErr(resp.Error, msg) {
			return nil
		}
		return fmt.Errorf("device rejected the revert: %s", msg)
	}
	return nil
}

// isDuplicateErr matches FortiOS's several ways of saying "that already exists".
func isDuplicateErr(code int, msg string) bool {
	if code == -5 {
		return true
	}
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "already exist") || strings.Contains(lower, "duplicat")
}

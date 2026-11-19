package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// Change Audit Ledger tests.
//
// The single most important test in this file is TestBuildRevertRequest_NeverDeletesACollection.
// A DELETE at a CMDB collection URL empties the whole table on a real FortiGate, and that mistake
// has already cost this project every policy on the lab device once. Nothing below is allowed to
// produce such a URL.

// ── route → CMDB resolution ──────────────────────────────────────────────────

func TestResolveChangeTarget_MapsEveryWriteVerb(t *testing.T) {
	cases := []struct {
		method, tail string
		wantType     string
		wantPath     string
		wantKey      string
		wantAction   string
	}{
		{"POST", "firewall-policies", "firewall-policy", "/api/v2/cmdb/firewall/policy", "", ChangeActionCreate},
		{"PATCH", "firewall-policies/12", "firewall-policy", "/api/v2/cmdb/firewall/policy", "12", ChangeActionUpdate},
		{"DELETE", "firewall-policies/12", "firewall-policy", "/api/v2/cmdb/firewall/policy", "12", ChangeActionDelete},
		{"POST", "addresses", "address", "/api/v2/cmdb/firewall/address", "", ChangeActionCreate},
		{"PATCH", "addresses/LAN", "address", "/api/v2/cmdb/firewall/address", "LAN", ChangeActionUpdate},
		{"DELETE", "virtual-ips/WebVIP", "virtual-ip", "/api/v2/cmdb/firewall/vip", "WebVIP", ChangeActionDelete},
		{"POST", "services", "service", "/api/v2/cmdb/firewall.service/custom", "", ChangeActionCreate},
		{"PATCH", "static-routes/3", "static-route", "/api/v2/cmdb/router/static", "3", ChangeActionUpdate},
		{"DELETE", "ipsec-tunnels/HQ", "ipsec-tunnel", "/api/v2/cmdb/vpn.ipsec/phase1-interface", "HQ", ChangeActionDelete},
		{"PUT", "users/alice", "local-user", "/api/v2/cmdb/user/local", "alice", ChangeActionUpdate},
		{"PUT", "user-groups/Staff", "user-group", "/api/v2/cmdb/user/group", "Staff", ChangeActionUpdate},
		{"DELETE", "ldap-servers/corp", "ldap-server", "/api/v2/cmdb/user/ldap", "corp", ChangeActionDelete},
		{"PUT", "radius-servers/rad1", "radius-server", "/api/v2/cmdb/user/radius", "rad1", ChangeActionUpdate},
		{"PUT", "schedules/recurring/WorkHours", "schedule", "/api/v2/cmdb/firewall.schedule/recurring", "WorkHours", ChangeActionUpdate},
		{"DELETE", "schedules/onetime/Maint", "schedule", "/api/v2/cmdb/firewall.schedule/onetime", "Maint", ChangeActionDelete},
		{"POST", "security-profiles/antivirus", "security-profile:antivirus", "/api/v2/cmdb/antivirus/profile", "", ChangeActionCreate},
		{"PATCH", "security-profiles/webfilter/Corp", "security-profile:webfilter", "/api/v2/cmdb/webfilter/profile", "Corp", ChangeActionUpdate},
		{"DELETE", "security-profiles/application-control/Apps", "security-profile:application-control", "/api/v2/cmdb/application/list", "Apps", ChangeActionDelete},
		// These four shipped with Phase 9 (object groups) and System ▸ Zones but were never added
		// here — found while wiring Fleet Apply, which reads this same map. Until this, a write to
		// any of them produced no ledger row at all, and a read-only account could write to all four
		// (getDeviceInfo's role check is this same classifier).
		{"POST", "address-groups", "address-group", "/api/v2/cmdb/firewall/addrgrp", "", ChangeActionCreate},
		{"PATCH", "address-groups/Servers", "address-group", "/api/v2/cmdb/firewall/addrgrp", "Servers", ChangeActionUpdate},
		{"DELETE", "service-groups/Web", "service-group", "/api/v2/cmdb/firewall.service/group", "Web", ChangeActionDelete},
		{"POST", "ip-pools", "ip-pool", "/api/v2/cmdb/firewall/ippool", "", ChangeActionCreate},
		{"PATCH", "zones/dmz", "zone", "/api/v2/cmdb/system/zone", "dmz", ChangeActionUpdate},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.tail, func(t *testing.T) {
			got, ok := ResolveChangeTarget(tc.method, tc.tail)
			if !ok {
				t.Fatalf("ResolveChangeTarget returned not-auditable")
			}
			if got.ResourceType != tc.wantType || got.CMDBPath != tc.wantPath ||
				got.MKey != tc.wantKey || got.Action != tc.wantAction {
				t.Errorf("got %+v, want type=%s path=%s key=%s action=%s",
					got, tc.wantType, tc.wantPath, tc.wantKey, tc.wantAction)
			}
		})
	}
}

// Reads must not create ledger noise, and unknown routes must not be guessed at.
func TestResolveChangeTarget_IgnoresNonWrites(t *testing.T) {
	for _, tc := range []struct{ method, tail string }{
		{"GET", "firewall-policies"},
		{"HEAD", "addresses"},
		{"POST", "unknown-resource"},
		{"POST", ""},
		{"POST", "security-profiles"},             // no category
		{"POST", "security-profiles/not-a-thing"}, // unknown category
		{"PUT", "schedules/not-a-type/Thing"},     // unknown schedule table
		{"POST", "vpn-health/HQ/up"},              // runtime action, nothing to revert
		// Diagnostics run a command and read a counter; they change no CMDB object, so a ping in
		// the change ledger would be noise sitting next to real edits — and there is nothing a
		// revert could even mean.
		{"POST", "diag/ping"},
		{"POST", "diag/traceroute"},
		{"POST", "diag/sessions"},
	} {
		if _, ok := ResolveChangeTarget(tc.method, tc.tail); ok {
			t.Errorf("%s %q was reported as auditable", tc.method, tc.tail)
		}
	}
}

// /move and /toggle POST to an existing object; recording them as creates would make the revert
// try to DELETE the policy instead of restoring its previous position.
func TestResolveChangeTarget_SubActionsAreUpdatesNotCreates(t *testing.T) {
	for _, tail := range []string{"firewall-policies/12/toggle", "firewall-policies/12/move"} {
		got, ok := ResolveChangeTarget("POST", tail)
		if !ok {
			t.Fatalf("%s was not auditable", tail)
		}
		if got.Action != ChangeActionUpdate {
			t.Errorf("%s action = %q, want %q", tail, got.Action, ChangeActionUpdate)
		}
		if got.MKey != "12" {
			t.Errorf("%s key = %q, want 12", tail, got.MKey)
		}
	}
}

// Object names legitimately contain spaces. Storing the percent-encoded form would make the revert
// look up a key the device has never heard of.
func TestResolveChangeTarget_DecodesPercentEncodedKeys(t *testing.T) {
	got, ok := ResolveChangeTarget("DELETE", "addresses/Guest%20Wi-Fi")
	if !ok {
		t.Fatalf("not auditable")
	}
	if got.MKey != "Guest Wi-Fi" {
		t.Errorf("key = %q, want %q", got.MKey, "Guest Wi-Fi")
	}
}

// A schedule create picks its table from the request body, so the resolver reports the change
// without a path and lets the recorder fill it in.
func TestResolveChangeTarget_ScheduleCreateDefersItsTable(t *testing.T) {
	got, ok := ResolveChangeTarget("POST", "schedules")
	if !ok {
		t.Fatalf("schedule create was not auditable")
	}
	if got.CMDBPath != "" {
		t.Errorf("path = %q, want empty — the table comes from the request body", got.CMDBPath)
	}
	if _, ok := ResolveChangeTarget("DELETE", "schedules"); ok {
		t.Errorf("a DELETE with no schedule type must not be auditable — there is no object to target")
	}
}

// ── revert construction ──────────────────────────────────────────────────────

// THE test. Every path that produces a DELETE must carry an mkey.
func TestBuildRevertRequest_NeverDeletesACollection(t *testing.T) {
	// Reverting a create whose key was never captured must refuse, not fall back to the table URL.
	_, err := BuildRevertRequest(ChangeActionCreate, "/api/v2/cmdb/firewall/policy", "", nil)
	if err == nil {
		t.Fatalf("reverting a keyless create was allowed — that DELETE would empty firewall/policy")
	}
	if !strings.Contains(err.Error(), "entire") {
		t.Errorf("error should explain the danger, got %q", err)
	}

	// And no other input may produce a collection-URL DELETE either.
	inputs := []struct {
		action, path, key string
		before            json.RawMessage
	}{
		{ChangeActionCreate, "/api/v2/cmdb/firewall/policy", "12", nil},
		{ChangeActionCreate, "/api/v2/cmdb/firewall/address/", "LAN", nil},
		{ChangeActionUpdate, "/api/v2/cmdb/firewall/policy", "12", json.RawMessage(`{"policyid":12}`)},
		{ChangeActionDelete, "/api/v2/cmdb/firewall/address", "LAN", json.RawMessage(`{"name":"LAN"}`)},
	}
	for _, in := range inputs {
		req, err := BuildRevertRequest(in.action, in.path, in.key, in.before)
		if err != nil {
			continue
		}
		if req.Method != "DELETE" {
			continue
		}
		trimmed := strings.TrimRight(in.path, "/")
		if req.Path == trimmed || req.Path == trimmed+"/" {
			t.Errorf("%s produced a collection DELETE at %q", in.action, req.Path)
		}
		if !strings.HasSuffix(req.Path, "/"+in.key) {
			t.Errorf("DELETE path %q does not end in the mkey %q", req.Path, in.key)
		}
	}
}

func TestBuildRevertRequest_CreateIsUndoneByDeletingTheKey(t *testing.T) {
	req, err := BuildRevertRequest(ChangeActionCreate, "/api/v2/cmdb/firewall/address", "LAN", nil)
	if err != nil {
		t.Fatalf("BuildRevertRequest: %v", err)
	}
	if req.Method != "DELETE" || req.Path != "/api/v2/cmdb/firewall/address/LAN" {
		t.Errorf("got %s %s, want DELETE /api/v2/cmdb/firewall/address/LAN", req.Method, req.Path)
	}
	if len(req.Body) != 0 {
		t.Errorf("a DELETE should carry no body, got %s", req.Body)
	}
}

func TestBuildRevertRequest_DeleteIsUndoneByRecreatingTheSnapshot(t *testing.T) {
	before := json.RawMessage(`{"name":"LAN","subnet":"192.168.1.0 255.255.255.0"}`)

	req, err := BuildRevertRequest(ChangeActionDelete, "/api/v2/cmdb/firewall/address", "LAN", before)
	if err != nil {
		t.Fatalf("BuildRevertRequest: %v", err)
	}
	if req.Method != "POST" || req.Path != "/api/v2/cmdb/firewall/address" {
		t.Errorf("got %s %s, want POST at the collection URL", req.Method, req.Path)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(req.Body, &body); err != nil {
		t.Fatalf("revert body is not an object: %v", err)
	}
	if body["name"] != "LAN" {
		t.Errorf("body lost the object name: %s", req.Body)
	}
}

func TestBuildRevertRequest_UpdateIsUndoneByReplayingTheBefore(t *testing.T) {
	before := json.RawMessage(`{"policyid":12,"srcintf":[{"name":"lan"}]}`)

	req, err := BuildRevertRequest(ChangeActionUpdate, "/api/v2/cmdb/firewall/policy", "12", before)
	if err != nil {
		t.Fatalf("BuildRevertRequest: %v", err)
	}
	if req.Method != "PUT" || req.Path != "/api/v2/cmdb/firewall/policy/12" {
		t.Errorf("got %s %s, want PUT …/policy/12", req.Method, req.Path)
	}
	if !strings.Contains(string(req.Body), `"lan"`) {
		t.Errorf("revert body does not restore the previous value: %s", req.Body)
	}
}

// Without a snapshot there is nothing to restore — offering a revert would silently do nothing.
func TestBuildRevertRequest_RefusesWithoutASnapshot(t *testing.T) {
	if _, err := BuildRevertRequest(ChangeActionUpdate, "/api/v2/cmdb/firewall/policy", "12", nil); err == nil {
		t.Errorf("update revert with no Before snapshot was allowed")
	}
	if _, err := BuildRevertRequest(ChangeActionDelete, "/api/v2/cmdb/firewall/address", "LAN", nil); err == nil {
		t.Errorf("delete revert with no Before snapshot was allowed")
	}
	if _, err := BuildRevertRequest(ChangeActionUpdate, "", "12", json.RawMessage(`{}`)); err == nil {
		t.Errorf("revert with no CMDB path was allowed")
	}
	if _, err := BuildRevertRequest("teleport", "/api/v2/cmdb/firewall/policy", "12", json.RawMessage(`{}`)); err == nil {
		t.Errorf("unknown action was allowed")
	}
}

// Object names with slashes and spaces must survive the round trip into a URL.
func TestBuildRevertRequest_EscapesTheKey(t *testing.T) {
	req, err := BuildRevertRequest(ChangeActionCreate, "/api/v2/cmdb/firewall/address", "Guest Wi-Fi", nil)
	if err != nil {
		t.Fatalf("BuildRevertRequest: %v", err)
	}
	if strings.Contains(req.Path, " ") {
		t.Errorf("path %q contains a raw space", req.Path)
	}
	if !strings.HasSuffix(req.Path, "Guest%20Wi-Fi") {
		t.Errorf("path = %q, want the key percent-encoded", req.Path)
	}
}

// FortiOS stamps read-only bookkeeping onto everything it returns; replaying those on a write is
// rejected by the device or silently ignored, which hides a failed revert.
func TestStripCMDBMeta_RemovesDeviceBookkeeping(t *testing.T) {
	in := json.RawMessage(`{"name":"LAN","q_origin_key":"LAN","q_ref":3,"q_static":true,"uuid":"abc","subnet":"10.0.0.0 255.0.0.0"}`)

	var out map[string]interface{}
	if err := json.Unmarshal(StripCMDBMeta(in), &out); err != nil {
		t.Fatalf("StripCMDBMeta produced invalid JSON: %v", err)
	}
	for _, k := range []string{"q_origin_key", "q_ref", "q_static", "uuid"} {
		if _, present := out[k]; present {
			t.Errorf("%q survived the strip", k)
		}
	}
	if out["name"] != "LAN" || out["subnet"] == nil {
		t.Errorf("real fields were dropped: %+v", out)
	}
}

// A snapshot that is not an object (a device quirk, or a corrupted row) must pass through rather
// than turning a recoverable revert into a parse failure.
func TestStripCMDBMeta_PassesThroughNonObjects(t *testing.T) {
	in := json.RawMessage(`[1,2,3]`)
	if got := string(StripCMDBMeta(in)); got != `[1,2,3]` {
		t.Errorf("StripCMDBMeta mangled a non-object: %s", got)
	}
}

// ── snapshots ────────────────────────────────────────────────────────────────

// A CMDB GET by mkey returns a one-element array; a revert has to write a single object, so the
// snapshot must be unwrapped at capture time.
func TestSnapshotCMDBObject_UnwrapsTheSingleElementArray(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/firewall/address/LAN": []map[string]interface{}{
			{"name": "LAN", "subnet": "192.168.1.0 255.255.255.0"},
		},
	})
	defer done()

	snap, err := fc.SnapshotCMDBObject("/api/v2/cmdb/firewall/address", "LAN")
	if err != nil {
		t.Fatalf("SnapshotCMDBObject: %v", err)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(snap, &obj); err != nil {
		t.Fatalf("snapshot is not a single object: %v (%s)", err, snap)
	}
	if obj["name"] != "LAN" {
		t.Errorf("snapshot = %s, want the LAN address object", snap)
	}
}

// Before a create and after a delete the object does not exist. That is the normal case, not an
// error — treating it as one would stop the ledger recording exactly those two changes.
func TestSnapshotCMDBObject_MissingObjectIsNotAnError(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/firewall/address/GONE": []map[string]interface{}{},
	})
	defer done()

	snap, err := fc.SnapshotCMDBObject("/api/v2/cmdb/firewall/address", "GONE")
	if err != nil {
		t.Errorf("missing object returned an error: %v", err)
	}
	if snap != nil {
		t.Errorf("snapshot = %s, want nil", snap)
	}

	// No key means no object to snapshot — and must not fire a collection GET.
	if snap, err := fc.SnapshotCMDBObject("/api/v2/cmdb/firewall/address", ""); err != nil || snap != nil {
		t.Errorf("empty key: got %s / %v, want nil / nil", snap, err)
	}
}

// Re-creating an object that already exists means the desired end state already holds; reporting
// that as a failed revert would send someone chasing a problem that is not there.
func TestIsDuplicateErr(t *testing.T) {
	if !isDuplicateErr(-5, "") {
		t.Errorf("error -5 is FortiOS's duplicate-name code")
	}
	if !isDuplicateErr(0, "entry already exists") {
		t.Errorf("'already exists' should read as duplicate")
	}
	if isDuplicateErr(-3, "entry not found in datasource") {
		t.Errorf("a missing datasource entry is a real failure, not a duplicate")
	}
}

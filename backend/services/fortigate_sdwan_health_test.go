package services

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// Tests for the Performance SLA layer. Every expectation here was read off the real device first
// (10.0.99.201, FGT80E v7.2.10) — these pin the behaviours that a plausible-looking payload gets
// wrong and that the firewall answers with a 200 anyway.

// ── The CMDB's multi-value string encoding ───────────────────────────────────

func TestParseFGQuotedList(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		// What the device actually returns after `set server 1.1.1.1 8.8.8.8`.
		{`"1.1.1.1" "8.8.8.8"`, []string{"1.1.1.1", "8.8.8.8"}},
		{`"aws.amazon.com"`, []string{"aws.amazon.com"}},
		// A check with no server must yield NO entries, not one empty string — the difference
		// decides whether the create validator thinks a server was supplied.
		{"", []string{}},
		{`  `, []string{}},
		// Unquoted is accepted too: nothing guarantees the device keeps quoting forever.
		{"1.1.1.1 8.8.8.8", []string{"1.1.1.1", "8.8.8.8"}},
	}
	for _, c := range cases {
		got := parseFGQuotedList(c.in)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseFGQuotedList(%q) = %#v, want %#v", c.in, got, c.want)
		}
	}
}

// ── Payload: probe mode decides what is sent ─────────────────────────────────

func TestHealthPayload_PassiveOmitsWhatTheDeviceDiscards(t *testing.T) {
	// Measured on the device: with detect-mode passive, a PUT carrying failtime/recoverytime/
	// update-static-route returns 200 and reads back UNCHANGED, and the server is stored as "".
	// Sending them would make the form report a save that never happened.
	p := sdwanHealthCheckPayload(SDWANHealthCheck{
		Name: "Passive-SLA", DetectMode: "passive", Protocol: "ping",
		Servers: []string{"1.1.1.1"}, Interval: 900, Failtime: 3, Recoverytime: 7,
		UpdateStaticRoute: true,
	}, true)

	for _, k := range []string{"server", "protocol", "system-dns", "interval", "failtime",
		"recoverytime", "update-static-route"} {
		if _, present := p[k]; present {
			t.Errorf("passive mode must not send %q, got %v", k, p[k])
		}
	}
	if p["detect-mode"] != "passive" {
		t.Fatalf("detect-mode not carried: %v", p["detect-mode"])
	}
	// Participants and the SLA table still belong to a passive check.
	if _, present := p["members"]; !present {
		t.Error("members must be sent in every mode")
	}
	if _, present := p["sla"]; !present {
		t.Error("sla must be sent in every mode")
	}
}

func TestHealthPayload_ActiveSendsLinkStatus(t *testing.T) {
	p := sdwanHealthCheckPayload(SDWANHealthCheck{
		Name: "Active-SLA", DetectMode: "active", Protocol: "http",
		Servers: []string{"aws.amazon.com"}, Interval: 600, Failtime: 4, Recoverytime: 6,
		UpdateStaticRoute: false,
	}, true)

	want := map[string]interface{}{
		"name": "Active-SLA", "detect-mode": "active", "protocol": "http",
		"server": "aws.amazon.com", "system-dns": "disable",
		"interval": 600, "failtime": 4, "recoverytime": 6,
		"update-static-route": "disable",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v, want %v", k, p[k], v)
		}
	}
}

func TestHealthPayload_PreferPassiveKeepsLinkStatus(t *testing.T) {
	// Prefer Passive is NOT passive: the device accepted failtime/recoverytime/update-static-route
	// under it and read them back, and the dialog shows both sections.
	p := sdwanHealthCheckPayload(SDWANHealthCheck{
		DetectMode: "prefer-passive", Protocol: "ping", Servers: []string{"1.1.1.1"},
		Interval: 900, Failtime: 3, Recoverytime: 7, UpdateStaticRoute: true,
	}, false)

	if p["failtime"] != 3 || p["recoverytime"] != 7 || p["update-static-route"] != "enable" {
		t.Fatalf("prefer-passive dropped link status: %v", p)
	}
}

func TestHealthPayload_ServersJoinedAndEmptyOnesNeverSent(t *testing.T) {
	p := sdwanHealthCheckPayload(SDWANHealthCheck{
		DetectMode: "active", Protocol: "ping", Servers: []string{" 1.1.1.1 ", "", "8.8.8.8"},
	}, false)
	if p["server"] != "1.1.1.1 8.8.8.8" {
		t.Fatalf("server list should join on a single space, got %q", p["server"])
	}

	// `{"server": ""}` is a NO-OP on this field, not a clear — the device returns 200 and keeps
	// what was there. Writing it would record an intent the firewall never carried out.
	p = sdwanHealthCheckPayload(SDWANHealthCheck{DetectMode: "active", Protocol: "dns", SystemDNS: true}, false)
	if _, present := p["server"]; present {
		t.Fatalf("an empty server list must not be sent, got %v", p["server"])
	}
	if p["system-dns"] != "enable" {
		t.Fatalf("system-dns should be enabled for a DNS probe, got %v", p["system-dns"])
	}
}

func TestHealthPayload_SystemDNSOnlyAppliesToDNS(t *testing.T) {
	// system-dns is a DNS-probe setting. Left enabled after a switch to Ping, the device would go
	// on probing something the form no longer shows.
	p := sdwanHealthCheckPayload(SDWANHealthCheck{
		DetectMode: "active", Protocol: "ping", SystemDNS: true, Servers: []string{"1.1.1.1"},
	}, false)
	if p["system-dns"] != "disable" {
		t.Fatalf("system-dns must be off for a non-DNS probe, got %v", p["system-dns"])
	}
}

func TestHealthPayload_NameOnlyOnCreate(t *testing.T) {
	// The mkey travels in the URL on an update. Sending it in the body too turns a save into a
	// rename the moment the form's name drifts from the row it was loaded from.
	create := sdwanHealthCheckPayload(SDWANHealthCheck{Name: " Corp-SLA ", DetectMode: "active"}, true)
	if create["name"] != "Corp-SLA" {
		t.Fatalf("create should send a trimmed name, got %q", create["name"])
	}
	update := sdwanHealthCheckPayload(SDWANHealthCheck{Name: "Corp-SLA", DetectMode: "active"}, false)
	if _, present := update["name"]; present {
		t.Fatal("an update must not send the name")
	}
}

// ── Participants and the SLA sub-table ───────────────────────────────────────

func TestHealthMemberRefs_SeqNumsNotNames(t *testing.T) {
	// system/sdwan/health-check.members is a member_table keyed by seq-num. Sending {"name": …}
	// there is answered with "entry not found in datasource / Return code -3".
	got := sdwanHealthMemberRefs([]int{3, 1, 3, 0, -2})
	want := []map[string]interface{}{{"seq-num": 3}, {"seq-num": 1}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("member refs = %#v, want %#v (deduped, no zero or negative)", got, want)
	}

	// "All SD-WAN Members" is an EMPTY list that must still be sent — omitting it would leave a
	// previous selection standing.
	empty := sdwanHealthMemberRefs(nil)
	if empty == nil || len(empty) != 0 {
		t.Fatalf("no participants must serialise as an empty list, got %#v", empty)
	}
	if b, _ := json.Marshal(empty); string(b) != "[]" {
		t.Fatalf("empty participants should marshal to [], got %s", b)
	}
}

func TestHealthParticipants_SeqNumZeroIsEveryMemberNotAMember(t *testing.T) {
	// Caught on the real firewall, not in review. A CREATE that sends `members: []` reads back as
	// `[{"seq-num": 0}]` — the device's way of writing "All SD-WAN Members" — while an UPDATE
	// sending the same reads back as `[]`. Carried through, the very first save of a check turned
	// "every member" into a participant named "#0".
	members, labels := sdwanHealthParticipants([]int{0}, map[int]string{1: "wan1"})
	if len(members) != 0 || len(labels) != 0 {
		t.Fatalf("seq-num 0 must not become a participant, got %v / %v", members, labels)
	}

	members, labels = sdwanHealthParticipants([]int{2, 5}, map[int]string{2: "wan1"})
	if len(members) != 2 || members[0] != 2 || members[1] != 5 {
		t.Fatalf("real participants dropped: %v", members)
	}
	// Member 5 exists on the check but not in system/sdwan any more. Showing the bare sequence
	// number beats making the participant list look shorter than it is.
	if labels[0] != "wan1" || labels[1] != "#5" {
		t.Fatalf("labels = %v", labels)
	}
}

func TestHealthSLARows_FactorSetIsJoined(t *testing.T) {
	rows := sdwanHealthSLARows([]SDWANSLARow{{
		ID: 1, LinkCostFactor: []string{"latency", " jitter ", ""},
		LatencyThreshold: 250, JitterThreshold: 50, PacketLossThreshold: 5,
	}})
	if len(rows) != 1 {
		t.Fatalf("want one row, got %d", len(rows))
	}
	if rows[0]["link-cost-factor"] != "latency jitter" {
		t.Fatalf("link-cost-factor = %q, want %q", rows[0]["link-cost-factor"], "latency jitter")
	}
	// A row that does not select on MOS must not carry a MOS threshold; the field is a string on
	// the device and an empty one is refused.
	if _, present := rows[0]["mos-threshold"]; present {
		t.Error("mos-threshold must be omitted when the row does not select on MOS")
	}

	rows = sdwanHealthSLARows([]SDWANSLARow{{
		ID: 2, LinkCostFactor: []string{"mos"}, MOSThreshold: "3.6",
	}})
	if rows[0]["mos-threshold"] != "3.6" {
		t.Fatalf("a MOS row should carry its threshold, got %v", rows[0]["mos-threshold"])
	}
}

func TestHealthSLARows_EmptyReallyClearsTheTable(t *testing.T) {
	// Unlike system/sdwan/service — whose sla table merges on the first PUT and refuses to drop its
	// last row — health-check's replaces cleanly. Measured: sla=[1,2] → PUT sla=[3] → reads [3],
	// and sla=[] empties it. So "SLA Target off" is expressible, and no reconcile pass is needed.
	rows := sdwanHealthSLARows(nil)
	if rows == nil || len(rows) != 0 {
		t.Fatalf("an empty SLA table must serialise as [], got %#v", rows)
	}
	if b, _ := json.Marshal(rows); string(b) != "[]" {
		t.Fatalf("marshalled to %s, want []", b)
	}
}

// ── Deletes never target a collection ────────────────────────────────────────

func TestDeleteSDWANHealthCheck_RefusesWithoutAnMKey(t *testing.T) {
	// A DELETE at the collection URL empties the whole table. That mistake once removed every
	// firewall policy on this lab device, so the guard is a test, not a comment.
	f := &FortiClient{}
	if err := f.DeleteSDWANHealthCheck("  "); err == nil {
		t.Fatal("a blank name must be refused before any request is made")
	}
	if err := f.UpdateSDWANHealthCheck("", SDWANHealthCheck{}); err == nil {
		t.Fatal("a blank name must be refused on update too")
	}
	if _, err := f.GetSDWANHealthCheck(""); err == nil {
		t.Fatal("a blank name must be refused on read")
	}
}

// ── Runtime measurements: absent is not zero ─────────────────────────────────

func TestRawFloat_AbsentIsNotZero(t *testing.T) {
	if rawFloat(nil) != nil {
		t.Error("a missing key must stay nil, not become 0")
	}
	if rawFloat(json.RawMessage(`""`)) != nil {
		t.Error("an empty string must stay nil")
	}
	if rawFloat(json.RawMessage(`"not a number"`)) != nil {
		t.Error("junk must stay nil rather than parse as 0")
	}
	// A latency of exactly 0 is a real measurement and must survive.
	if v := rawFloat(json.RawMessage(`0`)); v == nil || *v != 0 {
		t.Errorf("a real zero must be reported, got %v", v)
	}
	// The device quotes some numeric fields; both spellings have to work.
	if v := rawFloat(json.RawMessage(`"12.5"`)); v == nil || *v != 12.5 {
		t.Errorf("quoted number not parsed, got %v", v)
	}
	if v := rawFloat(json.RawMessage(`12.5`)); v == nil || *v != 12.5 {
		t.Errorf("bare number not parsed, got %v", v)
	}
}

func TestFirstFloat_PrefersTheFirstSpellingPresent(t *testing.T) {
	// SD-WAN is off on the lab device, so packet loss was never observable there. Reading both
	// spellings costs nothing and means a running firewall does not need a code change.
	fields := map[string]json.RawMessage{"packetloss": json.RawMessage(`4`)}
	if v := firstFloat(fields, "packet_loss", "packetloss"); v == nil || *v != 4 {
		t.Fatalf("fallback spelling not read, got %v", v)
	}
	if v := firstFloat(fields, "packet_loss"); v != nil {
		t.Fatalf("an unknown spelling must stay absent, got %v", *v)
	}
}

func TestSortHealthLive_StableOrder(t *testing.T) {
	// The runtime object is a Go map; unsorted, the member list reshuffles on every poll.
	rows := []SDWANHealthLive{{Interface: "wan2"}, {Interface: "port1"}, {Interface: "wan1"}}
	sortHealthLive(rows)
	got := []string{rows[0].Interface, rows[1].Interface, rows[2].Interface}
	want := []string{"port1", "wan1", "wan2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}

// ── The ledger has to know this table too ────────────────────────────────────

func TestResolveChangeTarget_SDWANHealthChecks(t *testing.T) {
	// The route segment is the TAB's name; the CMDB table is called something else. A miss here
	// means every SLA edit is missing from the Change Ledger and cannot be rolled back.
	got, ok := ResolveChangeTarget("PUT", "sdwan/performance-slas/Default_AWS")
	if !ok {
		t.Fatal("a performance SLA update must resolve to a change target")
	}
	if got.CMDBPath != "/api/v2/cmdb/system/sdwan/health-check" {
		t.Errorf("CMDBPath = %q", got.CMDBPath)
	}
	if got.MKey != "Default_AWS" || got.ResourceType != "sdwan-health-check" {
		t.Errorf("got %+v", got)
	}

	// A create has no mkey yet, which is exactly why a revert of one must become a DELETE by key
	// rather than a DELETE at the collection.
	got, ok = ResolveChangeTarget("POST", "sdwan/performance-slas")
	if !ok || got.MKey != "" || got.Action != ChangeActionCreate {
		t.Fatalf("create target = %+v ok=%v", got, ok)
	}

	// A name carrying a space arrives percent-encoded and must be decoded — "Default_Google
	// Search" is a real check on this device.
	got, _ = ResolveChangeTarget("DELETE", "sdwan/performance-slas/Default_Google%20Search")
	if got.MKey != "Default_Google Search" {
		t.Errorf("mkey not decoded: %q", got.MKey)
	}
}

// ── The read side ────────────────────────────────────────────────────────────

func TestDecodeHealthCheck_MembersAreSeqNums(t *testing.T) {
	// The members child table is keyed by seq-num, NOT by name. Decoding it as a name list — the
	// shape every other FortiOS member table uses — silently produced a list of empty strings.
	var r fgSDWANHealthCheck
	body := `{"name":"Corp","members":[{"seq-num":2},{"seq-num":5}],
	          "server":"\"1.1.1.1\" \"8.8.8.8\"","update-static-route":"enable"}`
	if err := json.Unmarshal([]byte(strings.ReplaceAll(body, "\n\t          ", " ")), &r); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(r.Members) != 2 || r.Members[0].SeqNum != 2 || r.Members[1].SeqNum != 5 {
		t.Fatalf("members = %+v", r.Members)
	}
	if got := parseFGQuotedList(r.Server); !reflect.DeepEqual(got, []string{"1.1.1.1", "8.8.8.8"}) {
		t.Fatalf("servers = %#v", got)
	}
	if !FGStringToBool(r.UpdateStaticRoute) {
		t.Fatal("update-static-route should decode as true")
	}
}

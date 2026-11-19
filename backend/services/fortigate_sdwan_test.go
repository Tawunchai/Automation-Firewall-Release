package services

import (
	"encoding/json"
	"testing"
	"time"
)

// Tests for the SD-WAN layer. Two things are worth pinning here rather than finding on a firewall:
// the payloads that reach the device, and the bandwidth rate — the one number on the page that is
// computed rather than read.

func TestSDWANMemberPayload_OmitsSeqNumOnCreate(t *testing.T) {
	// A create must let the device allocate the next sequence number. Sending 0 would either be
	// rejected or, worse, collide with an existing member the moment a second one is added.
	p := sdwanMemberPayload(SDWANMember{Interface: "wan2", Zone: "virtual-wan-link", Status: true})
	if _, present := p["seq-num"]; present {
		t.Fatalf("seq-num must be omitted when unset, got %v", p["seq-num"])
	}

	p = sdwanMemberPayload(SDWANMember{SeqNum: 7, Interface: "wan2", Zone: "virtual-wan-link"})
	if p["seq-num"] != 7 {
		t.Fatalf("seq-num should be sent when set, got %v", p["seq-num"])
	}
}

func TestSDWANMemberPayload_DefaultsAndStatus(t *testing.T) {
	// An empty gateway is the field's documented "unset" value, and it must be SENT rather than
	// omitted: on an update, leaving it out would keep whatever gateway was there before.
	p := sdwanMemberPayload(SDWANMember{Interface: "wan2", Zone: "z", Status: false})
	if p["gateway"] != "0.0.0.0" || p["source"] != "0.0.0.0" {
		t.Fatalf("blank gateway/source should become 0.0.0.0, got %v / %v", p["gateway"], p["source"])
	}
	if p["status"] != "disable" {
		t.Fatalf("status false must serialise as disable, got %v", p["status"])
	}

	p = sdwanMemberPayload(SDWANMember{Interface: "wan2", Zone: "z", Gateway: " 10.0.0.1 ", Status: true})
	if p["gateway"] != "10.0.0.1" {
		t.Fatalf("gateway should be trimmed, got %q", p["gateway"])
	}
	if p["status"] != "enable" {
		t.Fatalf("status true must serialise as enable, got %v", p["status"])
	}
}

func TestSDWANZonePayload_OmitsEmptyTieBreak(t *testing.T) {
	// Sending an empty option value is how a form quietly overwrites a device default with junk.
	p := sdwanZonePayload(SDWANZone{Name: " sales "})
	if p["name"] != "sales" {
		t.Fatalf("name should be trimmed, got %q", p["name"])
	}
	if _, present := p["service-sla-tie-break"]; present {
		t.Fatal("an empty tie-break must not be sent")
	}

	p = sdwanZonePayload(SDWANZone{Name: "sales", ServiceSLATieBreak: "fib-best-match"})
	if p["service-sla-tie-break"] != "fib-best-match" {
		t.Fatalf("tie-break not carried, got %v", p["service-sla-tie-break"])
	}
}

func TestDeleteSDWAN_RefusesWithoutAnMKey(t *testing.T) {
	// The rule that cost this project a policy table once: a DELETE without an mkey would hit the
	// collection URL and empty the whole table. Both deletes must refuse before any request goes.
	fc := &FortiClient{BaseURL: "https://example.invalid"}
	if err := fc.DeleteSDWANZone("   "); err == nil {
		t.Fatal("DeleteSDWANZone must refuse a blank name")
	}
	if err := fc.DeleteSDWANMember(0); err == nil {
		t.Fatal("DeleteSDWANMember must refuse sequence number 0")
	}
}

// ── Bandwidth rate ───────────────────────────────────────────────────────────

func TestSDWANRates_FirstSampleYieldsNothing(t *testing.T) {
	// One reading of a cumulative counter is not a rate. Reporting 0 here would put a measured-
	// looking zero on screen for a link that may be busy.
	resetSDWANRates()
	got := sdwanRates.sample("dev-a", map[string]fgInterfaceStats{
		"wan1": {RxBytes: 1000, TxBytes: 500},
	})
	if len(got) != 0 {
		t.Fatalf("first sample must produce no rates, got %v", got)
	}
}

func TestSDWANRates_SecondSampleMeasuresBitsPerSecond(t *testing.T) {
	resetSDWANRates()
	sdwanRates.sample("dev-b", map[string]fgInterfaceStats{"wan1": {RxBytes: 1000, TxBytes: 500}})

	// Backdate the stored sample so a known interval elapses without the test sleeping.
	sdwanRates.mu.Lock()
	s := sdwanRates.samples["dev-b"]
	s.at = s.at.Add(-2 * time.Second)
	sdwanRates.samples["dev-b"] = s
	sdwanRates.mu.Unlock()

	got := sdwanRates.sample("dev-b", map[string]fgInterfaceStats{"wan1": {RxBytes: 3000, TxBytes: 1500}})
	r, ok := got["wan1"]
	if !ok {
		t.Fatal("expected a rate for wan1")
	}
	// 2000 bytes over 2s = 1000 B/s = 8000 bit/s.
	if r.DownBps < 7900 || r.DownBps > 8100 {
		t.Fatalf("download should be ~8000 bit/s, got %v", r.DownBps)
	}
	if r.UpBps < 3900 || r.UpBps > 4100 {
		t.Fatalf("upload should be ~4000 bit/s, got %v", r.UpBps)
	}
}

func TestSDWANRates_DropsCounterResets(t *testing.T) {
	// An interface bounce or a reboot restarts the counters. Subtracting across that produces an
	// enormous negative delta, which as an unsigned rate would render as an impossible spike.
	resetSDWANRates()
	sdwanRates.sample("dev-c", map[string]fgInterfaceStats{"wan1": {RxBytes: 9000, TxBytes: 9000}})

	sdwanRates.mu.Lock()
	s := sdwanRates.samples["dev-c"]
	s.at = s.at.Add(-1 * time.Second)
	sdwanRates.samples["dev-c"] = s
	sdwanRates.mu.Unlock()

	got := sdwanRates.sample("dev-c", map[string]fgInterfaceStats{"wan1": {RxBytes: 10, TxBytes: 10}})
	if _, present := got["wan1"]; present {
		t.Fatal("a counter reset must not produce a rate")
	}
}

func TestSDWANRates_DropsStaleSample(t *testing.T) {
	// Averaging over an hour makes a burst and an idle period look identical.
	resetSDWANRates()
	sdwanRates.sample("dev-d", map[string]fgInterfaceStats{"wan1": {RxBytes: 1000}})

	sdwanRates.mu.Lock()
	s := sdwanRates.samples["dev-d"]
	s.at = s.at.Add(-2 * sdwanStaleSample)
	sdwanRates.samples["dev-d"] = s
	sdwanRates.mu.Unlock()

	got := sdwanRates.sample("dev-d", map[string]fgInterfaceStats{"wan1": {RxBytes: 99999}})
	if len(got) != 0 {
		t.Fatalf("a stale previous sample must not produce a rate, got %v", got)
	}
}

func TestSDWANRates_KeyedPerDevice(t *testing.T) {
	// Two firewalls both have a "wan1". Sharing one bucket would show device A's throughput on
	// device B's page.
	resetSDWANRates()
	sdwanRates.sample("dev-e", map[string]fgInterfaceStats{"wan1": {RxBytes: 1000}})
	got := sdwanRates.sample("dev-f", map[string]fgInterfaceStats{"wan1": {RxBytes: 5000}})
	if len(got) != 0 {
		t.Fatalf("a different device must start from no history, got %v", got)
	}
}

// ── Runtime decoding ─────────────────────────────────────────────────────────

func TestRawString_HandlesQuotedAndBare(t *testing.T) {
	// monitor/virtual-wan/members reported {"status":"error"} on the lab device; other firmware
	// could answer with a bare token. Both must read back the same.
	if got := rawString(json.RawMessage(`"error"`)); got != "error" {
		t.Fatalf("quoted scalar: got %q", got)
	}
	if got := rawString(json.RawMessage(`42`)); got != "42" {
		t.Fatalf("bare scalar: got %q", got)
	}
	if got := rawString(nil); got != "" {
		t.Fatalf("missing key must be empty, got %q", got)
	}
}

func TestResolveChangeTarget_SDWANSubTables(t *testing.T) {
	// system/sdwan's children are separate CMDB tables, so the ledger has to read the SECOND path
	// segment as the table and the third as the mkey — not the second as an mkey, which is what
	// the generic branch would have done.
	cases := []struct {
		method, tail string
		wantPath     string
		wantKey      string
		wantType     string
	}{
		{"POST", "sdwan/zones", "/api/v2/cmdb/system/sdwan/zone", "", "sdwan-zone"},
		{"DELETE", "sdwan/zones/sales", "/api/v2/cmdb/system/sdwan/zone", "sales", "sdwan-zone"},
		{"PUT", "sdwan/members/7", "/api/v2/cmdb/system/sdwan/members", "7", "sdwan-member"},
	}
	for _, c := range cases {
		got, ok := ResolveChangeTarget(c.method, c.tail)
		if !ok {
			t.Fatalf("%s %s: not resolved", c.method, c.tail)
		}
		if got.CMDBPath != c.wantPath || got.MKey != c.wantKey || got.ResourceType != c.wantType {
			t.Fatalf("%s %s: got %+v", c.method, c.tail, got)
		}
	}

	// A read, and an unknown child table, must not be recorded as changes.
	if _, ok := ResolveChangeTarget("GET", "sdwan"); ok {
		t.Fatal("a GET must not resolve to a change target")
	}
	if _, ok := ResolveChangeTarget("POST", "sdwan/neighbor"); ok {
		t.Fatal("an unmapped sdwan child table must not resolve")
	}
}

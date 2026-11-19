package services

import (
	"encoding/json"
	"reflect"
	"testing"
)

// ── The space-separated multi-value trap ─────────────────────────────────────
//
// severity/location/protocol/os/application are declared `"type": "user"` with
// multiple_values=true, which on FortiOS means ONE STRING with spaces — not a JSON array. Read
// back from the lab unit's built-in "default" sensor: "severity": "medium high critical".
//
// Getting this wrong in either direction is silent: the device stores something, answers 200, and
// the sensor filters on values nobody chose.

func TestIPSMultiToSlice(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"medium high critical", []string{"medium", "high", "critical"}},
		{"high", []string{"high"}},
		// "all" is the device's word for "no filter", not a value.
		{"all", nil},
		{"", nil},
		{"   ", nil},
		// Extra whitespace is what a hand-edited config produces.
		{"  low   medium  ", []string{"low", "medium"}},
	}
	for _, tc := range cases {
		if got := ipsMultiToSlice(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ipsMultiToSlice(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestIPSSliceToMulti(t *testing.T) {
	cases := []struct {
		in   []string
		want string
	}{
		{[]string{"medium", "high", "critical"}, "medium high critical"},
		// An empty filter must go out as "all". Sending "" instead leaves the PREVIOUS filter in
		// place on an update — the user clears the box, saves, and nothing changes.
		{nil, "all"},
		{[]string{}, "all"},
		{[]string{"", "  "}, "all"},
		// Duplicates would be stored verbatim by the device.
		{[]string{"high", "high", "low"}, "high low"},
		{[]string{"all", "high"}, "high"},
	}
	for _, tc := range cases {
		if got := ipsSliceToMulti(tc.in); got != tc.want {
			t.Errorf("ipsSliceToMulti(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// A sensor read from the device, shown in the form and saved again must not drift.
func TestIPSSensor_RoundTripsWithoutDrift(t *testing.T) {
	// Verbatim from GET /api/v2/cmdb/ips/sensor/default on the lab FGT80E.
	const raw = `{
	  "name": "default",
	  "comment": "Prevent critical attacks.",
	  "block-malicious-url": "disable",
	  "scan-botnet-connections": "disable",
	  "extended-log": "disable",
	  "entries": [{
	    "id": 1, "rule": [], "location": "all", "severity": "medium high critical",
	    "protocol": "all", "os": "all", "application": "all", "cve": [],
	    "status": "default", "log": "enable", "log-packet": "disable",
	    "action": "default", "quarantine": "none"
	  }]
	}`

	var dev fgIPSSensor
	if err := json.Unmarshal([]byte(raw), &dev); err != nil {
		t.Fatalf("fixture did not decode: %v", err)
	}
	form := fgToIPSSensorForm(dev)

	if form.Name != "default" || form.BlockMaliciousURL || form.ExtendedLog {
		t.Errorf("profile scalars wrong: %+v", form)
	}
	if len(form.Entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(form.Entries))
	}
	e := form.Entries[0]
	if !reflect.DeepEqual(e.Severity, []string{"medium", "high", "critical"}) {
		t.Errorf("severity = %v", e.Severity)
	}
	if e.Location != nil || e.Protocol != nil || e.OS != nil || e.Application != nil {
		t.Errorf(`"all" should read back as an empty filter, got %+v`, e)
	}
	if e.Kind != "filter" {
		t.Errorf("Kind = %q, want filter (no explicit rules)", e.Kind)
	}
	if !e.Log {
		t.Error("log=enable read back as false")
	}

	// Now send it back and check the wire shape.
	payload := ipsSensorPayload(form)
	entries := payload["entries"].([]map[string]interface{})
	if got := entries[0]["severity"]; got != "medium high critical" {
		t.Errorf("severity went out as %#v, want the space-separated string", got)
	}
	for _, k := range []string{"location", "protocol", "os", "application"} {
		if got := entries[0][k]; got != "all" {
			t.Errorf("%s went out as %#v, want \"all\" so the filter is cleared", k, got)
		}
	}
}

// A signature entry is the same table row with `rule` populated — the form has to be able to
// tell them apart, because they are different drawers in the UI.
func TestIPSSensor_SignatureEntryIsDetected(t *testing.T) {
	const raw = `{"name":"sig","entries":[{"id":1,"rule":[{"id":30316},{"id":12345}],
	  "location":"all","severity":"all","protocol":"all","os":"all","application":"all",
	  "status":"enable","action":"block","log":"enable","quarantine":"none","cve":[]}]}`

	var dev fgIPSSensor
	if err := json.Unmarshal([]byte(raw), &dev); err != nil {
		t.Fatalf("decode: %v", err)
	}
	e := fgToIPSSensorForm(dev).Entries[0]
	if e.Kind != "signature" {
		t.Errorf("Kind = %q, want signature", e.Kind)
	}
	if !reflect.DeepEqual(e.Rules, []int{30316, 12345}) {
		t.Errorf("Rules = %v", e.Rules)
	}
}

// Row ids are renumbered on write. The form reorders and deletes freely, so replaying whatever
// id came back from a read collides the moment a row in the middle is removed.
func TestIPSSensorPayload_RenumbersEntryIDs(t *testing.T) {
	form := IPSSensorForm{
		Name: "x",
		Entries: []IPSEntry{
			{ID: 7, Severity: []string{"high"}, Action: "block"},
			{ID: 7, Severity: []string{"low"}, Action: "pass"},
			{ID: 99, Severity: []string{"critical"}, Action: "reset"},
		},
	}
	entries := ipsSensorPayload(form)["entries"].([]map[string]interface{})
	for i, e := range entries {
		if e["id"] != i+1 {
			t.Errorf("entry %d has id %v, want %d — duplicate ids are rejected by the device", i, e["id"], i+1)
		}
	}
}

// Member tables must always go out, empty included: omitting them leaves the previous membership
// on the device, so signatures removed in the form silently stay in the sensor.
func TestIPSSensorPayload_AlwaysSendsRuleAndCVETables(t *testing.T) {
	form := IPSSensorForm{Name: "x", Entries: []IPSEntry{{Severity: []string{"high"}}}}
	e := ipsSensorPayload(form)["entries"].([]map[string]interface{})[0]

	rules, ok := e["rule"].([]map[string]interface{})
	if !ok || rules == nil {
		t.Errorf("rule = %#v, want an empty array not a missing key", e["rule"])
	}
	cves, ok := e["cve"].([]map[string]interface{})
	if !ok || cves == nil {
		t.Errorf("cve = %#v, want an empty array not a missing key", e["cve"])
	}
}

func TestValidateIPSSensorForm(t *testing.T) {
	valid := IPSSensorForm{
		Name:    "block-critical",
		Entries: []IPSEntry{{Severity: []string{"critical"}, Action: "block", Status: "enable"}},
	}
	if err := ValidateIPSSensorForm(valid); err != nil {
		t.Fatalf("a reasonable sensor was rejected: %v", err)
	}

	cases := []struct {
		name string
		form IPSSensorForm
	}{
		{"no name", IPSSensorForm{Entries: valid.Entries}},
		// The one that matters most operationally: an empty sensor attaches to a policy and
		// inspects nothing, while the UI shows IPS as "on".
		{"no entries at all", IPSSensorForm{Name: "empty"}},
		{"unknown severity", IPSSensorForm{Name: "x", Entries: []IPSEntry{{Severity: []string{"catastrophic"}}}}},
		{"unknown target", IPSSensorForm{Name: "x", Entries: []IPSEntry{{Location: []string{"middle"}}}}},
		{"bad action", IPSSensorForm{Name: "x", Entries: []IPSEntry{{Severity: []string{"high"}, Action: "quarantine"}}}},
		{"bad botnet mode", IPSSensorForm{Name: "x", ScanBotnetConnections: "yes", Entries: valid.Entries}},
		// Matches everything, changes nothing — accepted by the device, useless in practice.
		{"no-op entry", IPSSensorForm{Name: "x", Entries: []IPSEntry{{Action: "default", Status: "default"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateIPSSensorForm(tc.form); err == nil {
				t.Error("accepted")
			}
		})
	}
}

// The filter option lists are derived from the signature database, whose attribute fields are
// comma-separated combinations ("Other, Windows, Linux"). The form needs the ATOMS.
func TestStrSet_SplitsCombinationsAndDropsAll(t *testing.T) {
	s := newStrSet()
	s.addCSV("Other, Windows, Linux")
	s.addCSV("Windows")
	s.addCSV("All")
	s.addCSV("")

	got := s.sorted()
	want := []string{"Linux", "Other", "Windows"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("sorted() = %v, want %v", got, want)
	}
}

// Severity has to read worst-last (or best-first), not alphabetically — "critical, high, info,
// low, medium" is unreadable in a dropdown.
func TestStrSet_SeverityOrdersBySeverity(t *testing.T) {
	s := newStrSet()
	for _, v := range []string{"critical", "info", "high", "low", "medium"} {
		s.addCSV(v)
	}
	got := s.sortedBy(ipsSeverityOrder)
	want := []string{"info", "low", "medium", "high", "critical"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("sortedBy(severity) = %v, want %v", got, want)
	}
}

// rule-id arrives as a number on this firmware, but FortiOS is not consistent about numeric ids
// across versions and a quoted one must not silently become 0.
func TestParseFlexibleInt(t *testing.T) {
	cases := []struct {
		raw  string
		want int
	}{
		{`30316`, 30316},
		{`"30316"`, 30316},
		{`""`, 0},
		{`null`, 0},
		{`"abc"`, 0},
	}
	for _, tc := range cases {
		if got := parseFlexibleInt(json.RawMessage(tc.raw)); got != tc.want {
			t.Errorf("parseFlexibleInt(%s) = %d, want %d", tc.raw, got, tc.want)
		}
	}
}

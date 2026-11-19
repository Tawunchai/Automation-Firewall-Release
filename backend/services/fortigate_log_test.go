package services

import (
	"strings"
	"testing"
)

// The payloads below are verbatim copies of what the lab FortiGate 80E (FortiOS 7.2.10, build
// 1706) actually answered, so these tests pin the mapping to the device rather than to the docs.
//
// Getting them required temporarily switching on the two gates that keep a Local Traffic log empty
// by default (`log setting local-in-allow` and `log memory filter local-traffic`), generating some
// traffic to the unit, and putting both settings back. What is captured here is the result, so
// nobody has to do that again to work on this code.

// ── /api/v2/log/memory/traffic/local ─────────────────────────────────────────

// Two rows and the full envelope.
//
// Row 1 is TCP and carries `srcport`/`dstport`. Row 2 is the ICMP row and is the reason this
// fixture exists: it has NO port fields at all — not zero, absent — which is the shape that turns
// into "10.10.20.227:0" on screen if the decoder uses plain ints.
const trafficLogPayload = `{
  "http_method":"GET",
  "results":[
    {
      "date":"2026-08-26","time":"23:53:10","eventtime":1787813590123456789,"tz":"-0700",
      "logid":"0001000014","type":"traffic","subtype":"local","level":"notice","vd":"root",
      "srcip":"10.10.20.227","srcport":57815,"srcintf":"port1","srcintfrole":"lan",
      "dstip":"10.0.99.201","dstport":443,"dstintf":"root","dstintfrole":"undefined",
      "srccountry":"Reserved","dstcountry":"Reserved","sessionid":3595,"proto":6,
      "action":"close","policyid":0,"policytype":"local-in-policy","service":"HTTPS",
      "trandisp":"noop","app":"Web Management(HTTPS)","duration":1,
      "sentbyte":2332,"rcvdbyte":462,"sentpkt":7,"rcvdpkt":5,"appcat":"unscanned",
      "srchwvendor":"Fortinet","devtype":"Router","mastersrcmac":"00:09:0f:09:00:00",
      "srcmac":"00:09:0f:09:00:00","srcserver":0,
      "_metadata":{"#":1,"logid":14,"timestamp":1787813590000,"roll":0,"archive":false}
    },
    {
      "date":"2026-08-26","time":"23:52:18","eventtime":1787813537873930627,"tz":"-0700",
      "logid":"0001000014","type":"traffic","subtype":"local","level":"notice","vd":"root",
      "srcip":"10.10.20.227","identifier":1,"srcintf":"port1","srcintfrole":"lan",
      "dstip":"10.0.99.201","dstintf":"root","dstintfrole":"undefined",
      "srccountry":"Reserved","dstcountry":"Reserved","sessionid":3566,"proto":1,
      "action":"accept","policyid":0,"policytype":"local-in-policy","service":"PING",
      "trandisp":"noop","app":"PING","duration":63,
      "sentbyte":240,"rcvdbyte":240,"sentpkt":4,"rcvdpkt":4,"appcat":"unscanned",
      "srchwvendor":"Fortinet","devtype":"Router","mastersrcmac":"00:09:0f:09:00:00",
      "srcmac":"00:09:0f:09:00:00","srcserver":0,
      "_metadata":{"#":2,"logid":14,"timestamp":1787813538000,"roll":0,"archive":true}
    }
  ],
  "vdom":"root","device":"memory","category":"traffic","subcategory":"local",
  "start":1,"rows":2,"session_id":8,"completed":100,"percent_logs_processed":100,
  "total_lines":34,"now":1787813600000,"ready":true,
  "status":"success","serial":"FGT80ETK19026638","version":"v7.2.10","build":1706
}`

// The empty answer, which is what this device gives for Local Traffic in its normal state.
// `results` is `[]`, not null, and the envelope still carries `now` and `ready`.
const emptyLogPayload = `{
  "http_method":"GET","results":[],
  "vdom":"root","device":"memory","category":"traffic","subcategory":"local",
  "start":1,"rows":5,"session_id":4,"completed":100,"percent_logs_processed":100,
  "total_lines":0,"now":1787813352964,"ready":true,
  "status":"success","serial":"FGT80ETK19026638","version":"v7.2.10","build":1706
}`

func parseLog(t *testing.T, payload string, q TrafficLogQuery) FGTrafficLogPage {
	t.Helper()
	page, err := ParseTrafficLog([]byte(payload), q, nil)
	if err != nil {
		t.Fatalf("ParseTrafficLog: %v", err)
	}
	return page
}

// parseLog2 is parseLog with a policy table, for the tests that assert on the resolved rule.
func parseLog2(t *testing.T, payload string, q TrafficLogQuery, policies map[int]LogPolicyRef) FGTrafficLogPage {
	t.Helper()
	page, err := ParseTrafficLog([]byte(payload), q, policies)
	if err != nil {
		t.Fatalf("ParseTrafficLog: %v", err)
	}
	return page
}

func localQuery(window LogWindow) TrafficLogQuery {
	return TrafficLogQuery{Source: "memory", Subcategory: "local", Window: window}
}

func TestParseTrafficLog_MapsARowFromTheDevice(t *testing.T) {
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow1Hour))

	if page.Returned != 2 {
		t.Fatalf("returned = %d, want 2", page.Returned)
	}
	// Total counts what THIS log holds after the subcategory filter the device skipped — not the
	// envelope's `total_lines` (34), which counts every subtype sitting in the buffer.
	if page.Total != 2 {
		t.Errorf("total = %d, want 2 (the rows that are really `local`)", page.Total)
	}
	if !page.Ready {
		t.Error("ready = false, want true")
	}
	if page.DeviceNow != 1787813600000 {
		t.Errorf("device_now = %d, want the envelope's `now`", page.DeviceNow)
	}

	// Rows come back newest-first. The TCP row is at …590000 and the ICMP row at …538000, so
	// TCP leads and the ICMP row — the one carrying the absent ports and the archive flag — is
	// second. Indexing them by hand here rather than searching keeps the ordering itself asserted.
	if page.Rows[0].Proto != 6 || page.Rows[1].Proto != 1 {
		t.Fatalf("order = proto %d then %d, want 6 (newer) then 1", page.Rows[0].Proto, page.Rows[1].Proto)
	}
	row := page.Rows[1]
	if row.SrcIP != "10.10.20.227" || row.DstIP != "10.0.99.201" {
		t.Errorf("addresses = %s → %s", row.SrcIP, row.DstIP)
	}
	if row.ProtoName != "ICMP" {
		t.Errorf("proto_name = %q, want ICMP (resolved from proto 1)", row.ProtoName)
	}
	if row.Service != "PING" || row.Action != "accept" {
		t.Errorf("service/action = %q/%q", row.Service, row.Action)
	}
	if row.Row != 2 || row.Timestamp != 1787813538000 {
		t.Errorf("_metadata not mapped: row=%d timestamp=%d", row.Row, row.Timestamp)
	}
	if !row.Archive {
		t.Error("archive = false, want true — it is the paperclip column and it came from _metadata")
	}
}

// The single most important behaviour in this file.
//
// FortiOS OMITS srcport/dstport on a protocol that has none. Decoded into plain ints they become
// 0, and the table then shows "10.10.20.227:0" for every ping — a port that was never on the wire.
func TestParseTrafficLog_AbsentPortsStayNilRatherThanZero(t *testing.T) {
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow1Hour))

	icmp := page.Rows[1] // proto 1, no port fields in the payload at all
	if icmp.Proto != 1 {
		t.Fatalf("expected the ICMP row second (it is the older of the two), got proto %d", icmp.Proto)
	}
	if icmp.SrcPort != nil {
		t.Errorf("srcport = %d, want nil — the device sent no srcport for ICMP", *icmp.SrcPort)
	}
	if icmp.DstPort != nil {
		t.Errorf("dstport = %d, want nil — the device sent no dstport for ICMP", *icmp.DstPort)
	}

	tcp := page.Rows[0]
	if tcp.SrcPort == nil || *tcp.SrcPort != 57815 {
		t.Errorf("tcp srcport = %v, want 57815", tcp.SrcPort)
	}
	if tcp.DstPort == nil || *tcp.DstPort != 443 {
		t.Errorf("tcp dstport = %v, want 443", tcp.DstPort)
	}
}

// policyid 0 is a REAL answer on a local-in row — it is the implicit local-in policy. It must not
// be collapsed with "the device did not say", which is why it is a pointer too.
func TestParseTrafficLog_PolicyZeroIsAValueNotAnAbsence(t *testing.T) {
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow1Hour))
	for _, row := range page.Rows {
		if row.PolicyID == nil {
			t.Fatal("policyid = nil, want a pointer to 0 — the device sent policyid: 0")
		}
		if *row.PolicyID != 0 {
			t.Errorf("policyid = %d, want 0", *row.PolicyID)
		}
		if row.PolicyType != "local-in-policy" {
			t.Errorf("policytype = %q", row.PolicyType)
		}
	}
}

// Raw exists so the Details panel can show every field. Its values are TEXT because `eventtime`
// exceeds 2^53 — as a JSON number the browser would round it and display an instant the firewall
// never recorded.
func TestParseTrafficLog_RawKeepsBigNumbersExact(t *testing.T) {
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow1Hour))
	row := page.Rows[1] // the ICMP row, whose eventtime is the one past 2^53

	if got := row.Raw["eventtime"]; got != "1787813537873930627" {
		t.Errorf("raw eventtime = %q, want the exact literal 1787813537873930627", got)
	}
	// Strings are unquoted; the panel shows a value, not a JSON fragment.
	if got := row.Raw["service"]; got != "PING" {
		t.Errorf("raw service = %q, want PING (unquoted)", got)
	}
	// _metadata is lifted into real fields and must not also appear as a raw blob.
	if _, ok := row.Raw["_metadata"]; ok {
		t.Error("raw still carries _metadata; it is mapped to Row/Timestamp/Archive instead")
	}
}

// The window is measured against the DEVICE's clock, which is the only clock that agrees with the
// timestamps in the rows. The lab device runs -0700 while the backend container runs UTC.
func TestParseTrafficLog_WindowMeasuredFromTheDeviceClock(t *testing.T) {
	// now = 1787813600000; the rows are at …538000 and …590000, i.e. 62s and 10s old.
	// A 1-hour window keeps both.
	if got := parseLog(t, trafficLogPayload, localQuery(LogWindow1Hour)).Returned; got != 2 {
		t.Errorf("1h window kept %d rows, want 2", got)
	}

	// Cut-off arithmetic: with `now` from the envelope, window_start is exactly one span back.
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow24Hour))
	want := int64(1787813600000) - windowMillisFor(LogWindow24Hour)
	if page.WindowStart != want {
		t.Errorf("window_start = %d, want %d", page.WindowStart, want)
	}
}

func TestParseTrafficLog_RowsOutsideTheWindowAreDropped(t *testing.T) {
	future := strings.Replace(trafficLogPayload, `"now":1787813600000`, `"now":1787900000000`, 1)
	page := parseLog(t, future, localQuery(LogWindow1Hour))
	if page.Returned != 0 {
		t.Errorf("returned = %d, want 0 — both rows are a day older than the 1h window", page.Returned)
	}
	// A wider window reaches them again.
	if got := parseLog(t, future, localQuery(LogWindow7Day)).Returned; got != 2 {
		t.Errorf("7d window returned %d, want 2", got)
	}
}

// A row with no usable timestamp is KEPT. Dropping a real log entry because one metadata field was
// missing would hide evidence, and this page exists on the principle that an empty table is never
// invented.
func TestParseTrafficLog_RowWithNoTimestampSurvivesTheWindow(t *testing.T) {
	noTS := strings.Replace(trafficLogPayload,
		`"_metadata":{"#":1,"logid":14,"timestamp":1787813590000,"roll":0,"archive":false}`,
		`"_metadata":{"#":1,"logid":14,"roll":0,"archive":false}`, 1)

	// Move `now` far forward so the window would exclude anything with a real timestamp.
	noTS = strings.Replace(noTS, `"now":1787813600000`, `"now":1787900000000`, 1)

	page := parseLog(t, noTS, localQuery(LogWindow1Hour))
	if page.Returned != 1 {
		t.Fatalf("returned = %d, want 1 — the timestamp-less row must be kept", page.Returned)
	}
	if page.Rows[0].Timestamp != 0 {
		t.Errorf("expected the row without a timestamp, got %d", page.Rows[0].Timestamp)
	}
}

func TestParseTrafficLog_EmptyIsNotAnError(t *testing.T) {
	page := parseLog(t, emptyLogPayload, localQuery(LogWindow1Hour))
	if page.Returned != 0 || page.Total != 0 {
		t.Errorf("returned/total = %d/%d, want 0/0", page.Returned, page.Total)
	}
	// Non-nil so the JSON is `[]` rather than `null`; the page maps over it.
	if page.Rows == nil {
		t.Error("rows = nil, want an empty slice so it serialises as []")
	}
	if !page.Ready {
		t.Error("ready should still be reported on an empty answer")
	}
}

func TestParseTrafficLog_RefusedQueryIsAnError(t *testing.T) {
	refused := `{"status":"error","http_status":404,"results":[]}`
	if _, err := ParseTrafficLog([]byte(refused), localQuery(LogWindow1Hour), nil); err == nil {
		t.Fatal("a status:error envelope must not be reported as an empty log")
	}
}

func TestParseTrafficLog_TruncatedMeansThePageCameBackFull(t *testing.T) {
	// Comparing against the envelope's total no longer works now that rows are filtered here: the
	// device counts subtypes this log does not show, so `total_lines` is routinely larger than the
	// row count for a reason that is not truncation. "The device filled the page to the brim" is
	// the honest signal.
	q := localQuery(LogWindow7Day)
	q.Rows = 2 // the fixture carries exactly 2 entries
	page := parseLog(t, trafficLogPayload, q)
	if !page.Truncated {
		t.Error("truncated = false, want true — the device returned as many rows as were asked for")
	}

	roomy := localQuery(LogWindow7Day)
	roomy.Rows = 50
	if parseLog(t, trafficLogPayload, roomy).Truncated {
		t.Error("truncated = true with room to spare in the page")
	}
	if parseLog(t, emptyLogPayload, localQuery(LogWindow7Day)).Truncated {
		t.Error("truncated = true on an empty log")
	}
}

// ── The device does not honour the subcategory in the path ───────────────────

// Measured on the lab unit: /traffic/local, /traffic/forward, /traffic/sniffer and
// /traffic/multicast all return the SAME rows — every one `subtype: "local"` — and the envelope
// echoes back whichever was asked for. A Forward Traffic view that trusted the path would show
// local traffic under a heading saying otherwise, with the response agreeing.
func TestParseTrafficLog_FiltersBySubtypeBecauseTheDeviceDoesNot(t *testing.T) {
	forward := TrafficLogQuery{Source: "memory", Subcategory: "forward", Window: LogWindowAll}
	page := parseLog(t, trafficLogPayload, forward)

	if page.Returned != 0 {
		t.Errorf("returned = %d, want 0 — every row in the fixture is subtype `local`", page.Returned)
	}
	if page.Total != 0 {
		t.Errorf("total = %d, want 0 — the footer must not claim 34 forward entries", page.Total)
	}

	// And the same payload read as the log it really is keeps everything.
	if got := parseLog(t, trafficLogPayload, localQuery(LogWindowAll)).Returned; got != 2 {
		t.Errorf("local returned %d, want 2", got)
	}
}

func TestParseTrafficLog_KeepsARowWithNoSubtype(t *testing.T) {
	// Dropping a real log line because one field was missing would hide evidence — the same rule
	// the time window follows for a row with no timestamp.
	noSub := strings.Replace(trafficLogPayload, `"subtype":"local"`, `"subtype":""`, 1)
	if got := parseLog(t, noSub, localQuery(LogWindowAll)).Returned; got != 2 {
		t.Errorf("returned = %d, want 2 — the row without a subtype must be kept", got)
	}
}

func TestParseTrafficLog_NewestFirst(t *testing.T) {
	page := parseLog(t, trafficLogPayload, localQuery(LogWindow7Day))
	for i := 1; i < len(page.Rows); i++ {
		if page.Rows[i-1].Timestamp < page.Rows[i].Timestamp {
			t.Fatalf("rows are not newest-first: %d before %d",
				page.Rows[i-1].Timestamp, page.Rows[i].Timestamp)
		}
	}
}

// ── The device URL ───────────────────────────────────────────────────────────

func TestBuildLogPath_UsesTheLogNamespaceNotMonitor(t *testing.T) {
	got := buildLogPath(TrafficLogQuery{Source: "memory", Subcategory: "local", Rows: 50})
	if !strings.HasPrefix(got, "/api/v2/log/memory/traffic/local?") {
		t.Errorf("path = %q — logs live under /api/v2/log/, and /api/v2/monitor/log/… 404s", got)
	}
}

// AND is expressed by REPEATING the parameter. Joining terms with a space, +, ; or & was verified
// against the device to match nothing at all.
func TestBuildLogPath_AndIsARepeatedParameter(t *testing.T) {
	got := buildLogPath(TrafficLogQuery{
		Source: "memory", Subcategory: "local",
		Filters: []string{"action==deny", "srcip==10.0.0.1"},
	})
	if strings.Count(got, "&filter=") != 2 {
		t.Errorf("path = %q, want two separate filter parameters", got)
	}
	if !strings.Contains(got, "filter=action%3D%3Ddeny") {
		t.Errorf("filter value is not escaped: %q", got)
	}
}

func TestBuildLogPath_ClampsRowsAndStart(t *testing.T) {
	if got := buildLogPath(TrafficLogQuery{Source: "memory", Subcategory: "local", Rows: 99999}); !strings.Contains(got, "rows=1000") {
		t.Errorf("rows not clamped to the cap: %q", got)
	}
	if got := buildLogPath(TrafficLogQuery{Source: "memory", Subcategory: "local"}); !strings.Contains(got, "rows=400") {
		t.Errorf("missing rows should default to the device's own 400: %q", got)
	}
	if got := buildLogPath(TrafficLogQuery{Source: "memory", Subcategory: "local", Start: -5}); !strings.Contains(got, "start=0") {
		t.Errorf("negative start not clamped: %q", got)
	}
}

func TestBuildLogPath_SkipsBlankFilters(t *testing.T) {
	got := buildLogPath(TrafficLogQuery{
		Source: "memory", Subcategory: "local", Filters: []string{"", "   ", "action==deny"},
	})
	if strings.Count(got, "&filter=") != 1 {
		t.Errorf("path = %q, want one filter", got)
	}
}

// ── Validation ───────────────────────────────────────────────────────────────

func TestSubcategoryValidation_RejectsFortiview(t *testing.T) {
	for _, ok := range []string{"local", "forward", "sniffer", "multicast"} {
		if !IsValidLogSubcategory(ok) {
			t.Errorf("%q should be accepted", ok)
		}
	}
	// The device answers 200 for `fortiview` but silently serves `forward` instead. Accepting it
	// would mean showing forward traffic under a name that says otherwise.
	if IsValidLogSubcategory("fortiview") {
		t.Error("fortiview must be rejected: the device rewrites it to forward")
	}
	if IsValidLogSubcategory("../../cmdb/firewall/policy") {
		t.Error("subcategory becomes a path segment and must be whitelisted")
	}
}

func TestSourceValidation(t *testing.T) {
	for _, ok := range []string{"memory", "disk", "fortianalyzer", "fortianalyzer_cloud", "forticloud"} {
		if !isValidLogSource(ok) {
			t.Errorf("%q should be accepted", ok)
		}
	}
	if isValidLogSource("../monitor/system/status") {
		t.Error("source becomes a path segment and must be whitelisted")
	}
}

func TestGetTrafficLog_RefusesABadSegmentBeforeCallingTheDevice(t *testing.T) {
	fc := NewFortiClient("192.0.2.1", 443) // TEST-NET-1: never routed, so a call would hang
	if _, err := fc.GetTrafficLog(TrafficLogQuery{Source: "evil", Subcategory: "local"}, nil); err == nil {
		t.Error("a bad source must be refused locally, not sent to the device")
	}
	if _, err := fc.GetTrafficLog(TrafficLogQuery{Source: "memory", Subcategory: "evil"}, nil); err == nil {
		t.Error("a bad subcategory must be refused locally, not sent to the device")
	}
}

func TestWindowValidation(t *testing.T) {
	for _, w := range []LogWindow{LogWindow1Hour, LogWindow24Hour, LogWindow7Day} {
		if !IsValidLogWindow(w) {
			t.Errorf("%q should be accepted", w)
		}
	}
	if IsValidLogWindow("99y") {
		t.Error("an unknown window must be rejected rather than silently unfiltered")
	}
	if windowMillisFor(LogWindow1Hour) != 3600_000 {
		t.Errorf("1h = %d ms", windowMillisFor(LogWindow1Hour))
	}
}

func TestProtoName(t *testing.T) {
	cases := map[int]string{1: "ICMP", 6: "TCP", 17: "UDP", 58: "ICMPv6", 50: "ESP", 0: ""}
	for n, want := range cases {
		if got := ProtoName(n); got != want {
			t.Errorf("ProtoName(%d) = %q, want %q", n, got, want)
		}
	}
	// An unmapped protocol shows its number, which beats an empty cell.
	if got := ProtoName(253); got != "253" {
		t.Errorf("ProtoName(253) = %q, want \"253\"", got)
	}
}

// ── The source picker ────────────────────────────────────────────────────────

// Verbatim from GET /api/v2/monitor/log/device/state on the lab device. Note `is_fortiview_supported`
// at the end: it is a bool sitting among the objects, and decoding the whole thing into
// map[string]struct{…} fails on it.
const logDeviceStatePayload = `{
  "memory":{"is_available":true,"is_enabled":true,"is_default":true,"is_ha_supported":true},
  "disk":{"is_available":false,"is_enabled":false,"is_loggable":false,"num_ssds_available":0},
  "fortianalyzer":{"is_available":true,"is_enabled":false,"overrides_global_faz":false},
  "fortianalyzer_cloud":{"is_available":false,"is_enabled":false},
  "forticloud":{"is_available":true,"is_enabled":true,"is_faz_cloud":false},
  "is_fortiview_supported":true
}`

func TestParseLogSources_MatchesTheDevicesOwnPicker(t *testing.T) {
	sources, err := parseLogSources([]byte(logDeviceStatePayload))
	if err != nil {
		t.Fatalf("parseLogSources: %v", err)
	}
	if len(sources) != 5 {
		t.Fatalf("got %d sources, want 5", len(sources))
	}
	// Order is fixed: local storage first, then the off-box collectors. Map iteration in Go is
	// random, so without the fixed order the picker's entries would swap between refreshes.
	if sources[0].Key != "memory" || sources[4].Key != "forticloud" {
		t.Errorf("order = %s … %s", sources[0].Key, sources[4].Key)
	}
	// FortiOS calls it "FortiGate Cloud", never "FortiCloud".
	if sources[4].Label != "FortiGate Cloud" {
		t.Errorf("forticloud label = %q", sources[4].Label)
	}
	if !sources[0].IsDefault {
		t.Error("memory should be marked as the device's default")
	}
	// An 80E has no log disk.
	if sources[1].Available {
		t.Error("disk reported available on a device that answered is_available:false")
	}
}

func TestPickLogSource(t *testing.T) {
	sources, err := parseLogSources([]byte(logDeviceStatePayload))
	if err != nil {
		t.Fatal(err)
	}

	if got := PickLogSource(sources, "forticloud"); got != "forticloud" {
		t.Errorf("an available request should be honoured, got %q", got)
	}
	// Disk is unavailable on this unit: fall back rather than querying a backend that answers 200
	// with zero rows, which would read as "no traffic".
	if got := PickLogSource(sources, "disk"); got != "memory" {
		t.Errorf("unavailable request should fall back to the default, got %q", got)
	}
	if got := PickLogSource(sources, ""); got != "memory" {
		t.Errorf("no preference should pick the device's default, got %q", got)
	}
	if got := PickLogSource(nil, "memory"); got != "" {
		t.Errorf("a device with no log storage should yield \"\", got %q", got)
	}
}

func TestPickLogSource_SkipsAvailableButDisabled(t *testing.T) {
	// Memory off, FortiAnalyzer present but not enabled, FortiGate Cloud on. The only one worth
	// reading is the cloud.
	sources := []FGLogSource{
		{Key: "memory", Available: true, Enabled: false, IsDefault: true},
		{Key: "fortianalyzer", Available: true, Enabled: false},
		{Key: "forticloud", Available: true, Enabled: true},
	}
	if got := PickLogSource(sources, ""); got != "forticloud" {
		t.Errorf("got %q, want forticloud — the only enabled backend", got)
	}
}

// ── The gates ────────────────────────────────────────────────────────────────

func TestLogGates_ExplainAnEmptyLog(t *testing.T) {
	yes, no := true, false

	// The lab device's real state: nothing recorded AND memory filters the category out.
	off := FGLogGates{SourceAcceptsLocal: &no}
	if off.Recording() {
		t.Error("Recording() true with every local-in flag off")
	}
	if off.Stored() {
		t.Error("Stored() true while the backend filter is disabled")
	}
	if !off.Explains() {
		t.Error("Explains() false — these gates are exactly why the log is empty")
	}

	// local-out alone counts as recording: FortiGate-originated traffic lands in this same log.
	onlyOut := FGLogGates{LocalOut: true, SourceAcceptsLocal: &yes}
	if !onlyOut.Recording() || !onlyOut.Stored() || onlyOut.Explains() {
		t.Error("a correctly configured device must not be blamed for an empty log")
	}

	// Unknown (nil) counts as stored: never claim a misconfiguration from a table that could not
	// be read.
	unknown := FGLogGates{LocalInAllow: true}
	if !unknown.Stored() {
		t.Error("Stored() must default to true when the filter table is unknown")
	}
	if unknown.Explains() {
		t.Error("Explains() must stay false on an unreadable filter table")
	}
}

// FortiGate Cloud's filter table kept the OLD product name in the CLI. `log.forticloud` 404s.
func TestLogFilterPath_FortiCloudKeepsTheFortiGuardName(t *testing.T) {
	if got := logFilterPathFor("forticloud"); got != "log.fortiguard" {
		t.Errorf("logFilterPathFor(forticloud) = %q, want log.fortiguard", got)
	}
	if got := logFilterPathFor("memory"); got != "log.memory" {
		t.Errorf("logFilterPathFor(memory) = %q", got)
	}
	if got := logFilterPathFor("nonsense"); got != "" {
		t.Errorf("an unknown source should have no filter path, got %q", got)
	}
}

// ── The time window belongs to the backend, not to the page ──────────────────

// The bug this pins: the memory buffer held 34 entries, the page asked for "the last hour", every
// one of them was an hour old, and the table went empty over a full buffer. On a security log that
// reads as "the firewall saw nothing" — the one thing this page must never say by accident.
func TestResolveLogWindow_MemoryIsNeverWindowed(t *testing.T) {
	for _, asked := range []LogWindow{LogWindow1Hour, LogWindow24Hour, LogWindow7Day, LogWindowAll} {
		if got := ResolveLogWindow("memory", asked); got != LogWindowAll {
			t.Errorf("ResolveLogWindow(memory, %q) = %q, want all — the buffer IS the result set", asked, got)
		}
	}
}

func TestResolveLogWindow_IndexedBackendsKeepTheirPeriod(t *testing.T) {
	for _, src := range []string{"forticloud", "disk", "fortianalyzer"} {
		if got := ResolveLogWindow(src, LogWindow24Hour); got != LogWindow24Hour {
			t.Errorf("ResolveLogWindow(%s, 24h) = %q", src, got)
		}
		// "all" against an indexed store would pull its whole history; fall back to the default.
		if got := ResolveLogWindow(src, LogWindowAll); got != LogWindow1Hour {
			t.Errorf("ResolveLogWindow(%s, all) = %q, want the 1h default", src, got)
		}
	}
	if !logSourceSupportsWindow("forticloud") || logSourceSupportsWindow("memory") {
		t.Error("logSourceSupportsWindow disagrees with ResolveLogWindow")
	}
}

func TestParseTrafficLog_WindowAllKeepsEveryRow(t *testing.T) {
	// `now` pushed a day forward: a 1-hour window drops both rows, "all" keeps them.
	future := strings.Replace(trafficLogPayload, `"now":1787813600000`, `"now":1787900000000`, 1)
	if got := parseLog(t, future, localQuery(LogWindow1Hour)).Returned; got != 0 {
		t.Fatalf("1h window returned %d, want 0 — the fixture for this test would be wrong", got)
	}
	page := parseLog(t, future, localQuery(LogWindowAll))
	if page.Returned != 2 {
		t.Errorf("all window returned %d, want 2", page.Returned)
	}
	if page.WindowStart != 0 {
		t.Errorf("window_start = %d, want 0 — nothing was cut off", page.WindowStart)
	}
}

func TestIsValidLogWindow_AcceptsAll(t *testing.T) {
	if !IsValidLogWindow(LogWindowAll) {
		t.Error("LogWindowAll must be a valid window")
	}
}

// ── Reverse DNS arrives in a separate envelope ───────────────────────────────

// Captured from GET …/traffic/local?extra=reverse_lookup. The name is NOT a field of the entry —
// it sits in `_extra`, which is absent entirely unless the extra was requested.
const reverseLookupPayload = `{
  "results":[
    {
      "date":"2026-08-26","time":"23:52:14","tz":"-0700","type":"traffic","subtype":"local",
      "srcip":"10.0.99.201","srcport":8233,"dstip":"173.243.140.16","dstport":443,
      "srccountry":"Reserved","dstcountry":"United States","proto":6,"action":"server-rst",
      "policyid":0,"service":"HTTPS","app":"HTTPS","sentbyte":4115,"rcvdbyte":9557,
      "_metadata":{"#":10,"logid":14,"timestamp":1787813534000,"roll":0,"archive":false},
      "_extra":{"dstip_reverse_lookup":"globalgip.fortinet.net"}
    }
  ],
  "device":"memory","category":"traffic","subcategory":"local",
  "total_lines":1,"now":1787813600000,"ready":true,"status":"success"
}`

func TestParseTrafficLog_LiftsReverseLookupOutOfExtra(t *testing.T) {
	page := parseLog(t, reverseLookupPayload, localQuery(LogWindowAll))
	row := page.Rows[0]

	if row.DstHost != "globalgip.fortinet.net" {
		t.Errorf("dsthost = %q, want globalgip.fortinet.net", row.DstHost)
	}
	if row.SrcHost != "" {
		t.Errorf("srchost = %q, want empty — the device resolved only the destination", row.SrcHost)
	}
	// The recorded name and the resolved one are different claims and must stay separable.
	if row.DstName != "" {
		t.Errorf("dstname = %q — a reverse lookup must not be written into the recorded name", row.DstName)
	}
	if row.DstCountry != "United States" {
		t.Errorf("dstcountry = %q", row.DstCountry)
	}
	// `_extra` is unpacked into fields, so it must not also sit in Raw as a JSON blob.
	if _, ok := row.Raw["_extra"]; ok {
		t.Error("raw still carries _extra")
	}
}

// ⚠️ Several extras must be SEPARATE parameters: `extra=reverse_lookup,country_id` returns an
// EMPTY `_extra` — both silently dropped — while repeating the parameter returns both.
func TestBuildLogPath_ExtrasAreSeparateParameters(t *testing.T) {
	got := buildLogPath(TrafficLogQuery{
		Source: "memory", Subcategory: "local",
		Extras: []string{"reverse_lookup", "country_id"},
	})
	if strings.Count(got, "&extra=") != 2 {
		t.Errorf("path = %q, want two separate extra parameters", got)
	}
	if strings.Contains(got, "reverse_lookup%2Ccountry_id") || strings.Contains(got, "reverse_lookup,country_id") {
		t.Errorf("extras were joined with a comma, which returns an empty _extra: %q", got)
	}
	// Blank entries are skipped, as the filters are.
	blank := buildLogPath(TrafficLogQuery{Source: "memory", Subcategory: "local", Extras: []string{"", "  "}})
	if strings.Contains(blank, "extra=") {
		t.Errorf("blank extras should not be sent: %q", blank)
	}
}

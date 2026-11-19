package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Log & Report — reading the device's own logs.
//
// ── THE LOG API IS NOT THE MONITOR API, AND NOT THE CMDB ──────────────────────
// Logs live in a THIRD namespace of their own, which cost an hour to find because every wrong
// guess answers with a plausible-looking 404 envelope rather than a hint:
//
//	/api/v2/cmdb/…      configuration
//	/api/v2/monitor/…   runtime state          ← monitor/log/device/state lives here
//	/api/v2/log/…       the log entries        ← THIS, and nothing else serves them
//
// Probed live on the lab FGT80E (FortiOS 7.2.10, build 1706). `monitor/log/memory/traffic/local`
// and every variation of it returns `http_status: 404`; the same path under `/api/v2/log/` returns
// rows. Both spellings are "valid" as far as the envelope is concerned, so a reader who guesses
// wrong sees an empty page and concludes the device has no logs.
//
//	GET /api/v2/log/{source}/{category}/{subcategory}?start=&rows=&filter=
//	         memory        traffic    local
//	         forticloud    event      forward
//	         disk                     sniffer
//	         fortianalyzer            multicast
//
// ── THE ENVELOPE CARRIES THE PAGING STATE, NOT `results` ──────────────────────
// `total_lines` is the size of the whole match, `now` is the DEVICE's clock in epoch ms, and
// `ready`/`completed`/`percent_logs_processed` describe a search that FortiOS may still be running.
// None of those fit fgAPIResponse (they are log-only), so this file reads the raw body through
// doRawGet and decodes the envelope itself rather than widening the shared type.
//
// `now` is why the time-window filter is computed against the DEVICE's clock and not the Go
// server's: the two are minutes apart on this lab (and the device runs -0700 while the container
// runs UTC), so "the last hour" measured from the wrong clock silently returns nothing.
//
// ── FILTER SEMANTICS, VERIFIED ON THE DEVICE ─────────────────────────────────
// The syntax is not documented in the firmware and is not what it looks like:
//
//	AND   repeat the whole parameter:  &filter=action==deny&filter=srcip==10.0.0.1   ✅ verified
//	OR    comma INSIDE one parameter:  &filter=action==deny,action==accept           ✅ verified
//	ops   ==  !=  <  >  and  =*wildcard*                                             ✅ verified
//	time  time>=23:00:00                                                             ❌ HTTP error
//
// A filter naming a field that does not exist is NOT an error — it answers 200 with
// `total_lines: 0`. So a typo in a search box is indistinguishable from "nothing matched", which
// is why free-text search is turned into an explicit OR over known fields (see BuildSearchFilter
// in fortigate_logsearch.go) rather than passed through as whatever the user typed.
//
// Because time cannot be filtered on the device, the window is applied here, in Go, against
// `_metadata.timestamp`.
//
// ── ⚠️ THE SUBCATEGORY IN THE PATH IS NOT HONOURED EITHER ────────────────────
// Measured on the lab unit's MEMORY backend: /traffic/local, /traffic/forward, /traffic/sniffer and
// /traffic/multicast all return THE SAME 34 rows — every one of them `subtype: "local"` — and the
// envelope politely echoes back whichever subcategory was asked for. So a Forward Traffic view
// reading /traffic/forward would show local traffic under a heading that says otherwise, with the
// response itself agreeing that it is forward traffic.
//
// The only trustworthy discriminator is the ROW's own `subtype`, so that is what filters here.
// Same failure mode as the filter parameter and the `extra` list: the device accepts what it is
// given and quietly does something else.

// ── Log sources ───────────────────────────────────────────────────────────────

// FGLogSource is one entry of the log-source picker — the control at the top right of the page
// that FortiOS itself renders.
//
// The list is NOT hard-coded: monitor/log/device/state reports which backends this unit actually
// has, and the lab device answers memory+forticloud available with disk `is_available: false`
// (an 80E has no log disk). Hard-coding the five possible sources would offer Disk on a device
// that cannot serve it, and a Disk query answers 200 with zero rows — an offer that silently
// does nothing.
type FGLogSource struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Available bool   `json:"available"`
	Enabled   bool   `json:"enabled"`
	IsDefault bool   `json:"is_default"`
}

// logSourceLabels maps the API's key to the name FortiOS shows in its own picker. "forticloud"
// renders as "FortiGate Cloud" in the GUI, never as "FortiCloud".
var logSourceLabels = map[string]string{
	"memory":              "Memory",
	"disk":                "Disk",
	"fortianalyzer":       "FortiAnalyzer",
	"fortianalyzer_cloud": "FortiAnalyzer Cloud",
	"forticloud":          "FortiGate Cloud",
}

// logSourceOrder is the order FortiOS lists them in: local storage first, then the off-box
// collectors. Map iteration order in Go is random, so without this the picker's entries would
// swap places between refreshes.
var logSourceOrder = []string{"memory", "disk", "fortianalyzer", "fortianalyzer_cloud", "forticloud"}

// isValidLogSource reports whether s is a log backend FortiOS knows about. The handler checks this
// before building a path so that a crafted `?source=` cannot be pasted into the device URL.
func isValidLogSource(s string) bool {
	_, ok := logSourceLabels[s]
	return ok
}

// rawLogDeviceState mirrors the parts of monitor/log/device/state this needs. Every backend
// reports is_available/is_enabled; only `memory` carries is_default.
type rawLogDeviceState struct {
	IsAvailable bool `json:"is_available"`
	IsEnabled   bool `json:"is_enabled"`
	IsDefault   bool `json:"is_default"`
}

// GetLogSources reports which log backends this device can serve, for the source picker.
func (f *FortiClient) GetLogSources() ([]FGLogSource, error) {
	resp, err := f.do("GET", "/api/v2/monitor/log/device/state", nil)
	if err != nil {
		return nil, err
	}
	return parseLogSources(resp.Results)
}

// parseLogSources decodes a monitor/log/device/state payload. Separate from the request so the
// captured response can be replayed in tests.
func parseLogSources(results json.RawMessage) ([]FGLogSource, error) {
	// The object also holds `is_fortiview_supported`, a bool rather than an object, so decoding
	// straight into map[string]rawLogDeviceState fails on it. Decode loosely, then per key.
	var byKey map[string]json.RawMessage
	if err := json.Unmarshal(results, &byKey); err != nil {
		return nil, fmt.Errorf("log device state: %w", err)
	}

	out := make([]FGLogSource, 0, len(logSourceOrder))
	for _, key := range logSourceOrder {
		raw, ok := byKey[key]
		if !ok {
			continue
		}
		var st rawLogDeviceState
		if err := json.Unmarshal(raw, &st); err != nil {
			continue
		}
		out = append(out, FGLogSource{
			Key:       key,
			Label:     logSourceLabels[key],
			Available: st.IsAvailable,
			Enabled:   st.IsEnabled,
			IsDefault: st.IsDefault,
		})
	}
	return out, nil
}

// PickLogSource chooses which backend to read when the caller did not name one, or named one the
// device cannot serve.
//
// Preference order, and each step is a real case on the lab device:
//   - what was asked for, IF the device can serve it;
//   - the one FortiOS marks as default (memory, here);
//   - the first that is both available and enabled (FortiGate Cloud, when memory logging is off);
//   - the first available at all, so the page still shows a picker rather than nothing.
func PickLogSource(sources []FGLogSource, want string) string {
	for _, s := range sources {
		if s.Key == want && s.Available {
			return s.Key
		}
	}
	for _, s := range sources {
		if s.IsDefault && s.Available && s.Enabled {
			return s.Key
		}
	}
	for _, s := range sources {
		if s.Available && s.Enabled {
			return s.Key
		}
	}
	for _, s := range sources {
		if s.Available {
			return s.Key
		}
	}
	return ""
}

// ── Why a Local Traffic log can be empty while the firewall is busy ───────────

// FGLogGates is the answer to "the page is empty — is that the truth?".
//
// Local Traffic is gated TWICE on FortiOS, and both gates are off by default. On the lab device
// they read exactly like this, which is the whole reason its Local Traffic log has never had a
// single row in it:
//
//	config log setting                    local-in-allow: disable        ← nothing is RECORDED
//	config log memory filter              local-traffic:  disable        ← memory REJECTS it
//	config log fortiguard filter          local-traffic:  enable
//
// The first decides whether traffic addressed to the firewall is logged at all. The second is
// per-backend: memory can be told to drop the category even when it is being recorded, which is
// how a device ends up with local traffic in FortiGate Cloud and none in Memory — two sources,
// two different answers, neither of them wrong.
//
// FortiOS's own log view shows "No results" for this and explains nothing. Reporting the gates
// turns an empty table from a dead end into a diagnosis, and it is the difference between "this
// firewall saw no traffic" and "this firewall was told not to write it down".
type FGLogGates struct {
	// LocalInAllow logs traffic ACCEPTED by an implicit/explicit local-in policy.
	LocalInAllow bool `json:"local_in_allow"`
	// LocalInDenyUnicast logs unicast traffic DENIED to the firewall — the port scans and the
	// failed logins, which is the half most people actually want.
	LocalInDenyUnicast bool `json:"local_in_deny_unicast"`
	// LocalInDenyBroadcast is normally left off deliberately: broadcast noise floods the buffer.
	LocalInDenyBroadcast bool `json:"local_in_deny_broadcast"`
	// LocalOut logs traffic the firewall ITSELF originates (FortiGuard updates, syslog, its own
	// DNS). Enabled by default on 7.2, and it lands in this same traffic/local subcategory.
	LocalOut bool `json:"local_out"`

	// SourceAcceptsLocal is the chosen backend's own `local-traffic` filter. nil when the backend
	// has no such filter table to read (FortiAnalyzer's lives on the collector, not here).
	SourceAcceptsLocal *bool `json:"source_accepts_local"`
	// SourceFilterPath names the CLI table SourceAcceptsLocal came from, so a hint can print a
	// command that is true for the source actually being read.
	SourceFilterPath string `json:"source_filter_path,omitempty"`
}

// Recording reports whether anything at all will be written for Local Traffic.
func (g FGLogGates) Recording() bool {
	return g.LocalInAllow || g.LocalInDenyUnicast || g.LocalInDenyBroadcast || g.LocalOut
}

// Stored reports whether the chosen backend will keep what is recorded. Unknown (nil) counts as
// yes: never claim a device is misconfigured on the strength of a table that could not be read.
func (g FGLogGates) Stored() bool {
	return g.SourceAcceptsLocal == nil || *g.SourceAcceptsLocal
}

// Explains reports whether the gates account for an empty result, which is what decides if the
// page shows a diagnosis or the ordinary "nothing matched" state.
func (g FGLogGates) Explains() bool { return !g.Recording() || !g.Stored() }

// logFilterPath maps a log source to the CMDB table holding its per-category filter.
// FortiGate Cloud's table is `log.fortiguard`, not `log.forticloud` — the CLI kept the old
// FortiGuard name after the product was renamed, and the obvious spelling 404s.
var logFilterPath = map[string]string{
	"memory":              "log.memory",
	"disk":                "log.disk",
	"fortianalyzer":       "log.fortianalyzer",
	"fortianalyzer_cloud": "log.fortianalyzer-cloud",
	"forticloud":          "log.fortiguard",
}

// logFilterPathFor is the CMDB table holding a source's per-category filter, or "" when it has none.
func logFilterPathFor(source string) string { return logFilterPath[source] }

// GetLogGates reads both gates for one source. Failures are not fatal: the gates only ANNOTATE an
// empty list, so a device that will not answer them should still serve its logs.
func (f *FortiClient) GetLogGates(source string) FGLogGates {
	var g FGLogGates

	if resp, err := f.do("GET", "/api/v2/cmdb/log/setting", nil); err == nil {
		var s struct {
			LocalInAllow         string `json:"local-in-allow"`
			LocalInDenyUnicast   string `json:"local-in-deny-unicast"`
			LocalInDenyBroadcast string `json:"local-in-deny-broadcast"`
			LocalOut             string `json:"local-out"`
		}
		if json.Unmarshal(resp.Results, &s) == nil {
			g.LocalInAllow = FGStringToBool(s.LocalInAllow)
			g.LocalInDenyUnicast = FGStringToBool(s.LocalInDenyUnicast)
			g.LocalInDenyBroadcast = FGStringToBool(s.LocalInDenyBroadcast)
			g.LocalOut = FGStringToBool(s.LocalOut)
		}
	}

	path, ok := logFilterPath[source]
	if !ok {
		return g
	}
	g.SourceFilterPath = path
	if resp, err := f.do("GET", "/api/v2/cmdb/"+path+"/filter", nil); err == nil {
		var s struct {
			LocalTraffic string `json:"local-traffic"`
		}
		if json.Unmarshal(resp.Results, &s) == nil && s.LocalTraffic != "" {
			accepts := FGStringToBool(s.LocalTraffic)
			g.SourceAcceptsLocal = &accepts
		}
	}
	return g
}

// ── The rows ──────────────────────────────────────────────────────────────────

// FGTrafficLog is one traffic log entry.
//
// The field set was taken from real rows on the lab device rather than from the log reference,
// and the two disagree in ways that matter.
//
// ⚠️ PORTS AND POLICY ID ARE POINTERS ON PURPOSE. FortiOS OMITS a field rather than sending zero:
// an ICMP row has no `srcport` and no `dstport` at all. Decoded into plain ints those become 0,
// and the table then renders "10.10.20.227:0" for every ping — a port number that was never on
// the wire. Same shape of bug as monitor/firewall/policy's missing hit counters. `policyid` IS
// present and IS 0 for local-in traffic, where 0 means the implicit local-in policy and is a real
// answer; it stays a pointer so "absent" and "the implicit policy" stay distinguishable.
type FGTrafficLog struct {
	// Row is `_metadata.#`, the 1-based index within the whole match. It is what the device
	// counts by, so it survives paging and is the stable React key.
	Row int `json:"row"`
	// Timestamp is `_metadata.timestamp`, epoch MILLISECONDS. This is the sortable, comparable
	// instant; Date/Time below are the device's own local-time rendering of it.
	Timestamp int64 `json:"timestamp"`
	// Date and Time are pre-formatted by the device in ITS timezone, and TZ is that offset
	// ("-0700"). They are passed through verbatim and shown as-is, exactly as FortiOS does:
	// re-deriving them from Timestamp in the browser would relabel every row with the viewer's
	// timezone and quietly disagree with the same log read over SSH.
	Date string `json:"date"`
	Time string `json:"time"`
	TZ   string `json:"tz"`

	LogID   string `json:"logid"`
	Level   string `json:"level"`
	VDom    string `json:"vd"`
	Type    string `json:"type"`
	Subtype string `json:"subtype"`

	// Archive is `_metadata.archive` — the paperclip column. True when the device kept a packet
	// capture or quarantined file alongside the entry.
	Archive bool `json:"archive"`

	SrcIP       string `json:"srcip"`
	SrcPort     *int   `json:"srcport"`
	SrcIntf     string `json:"srcintf"`
	SrcIntfRole string `json:"srcintfrole"`
	SrcCountry  string `json:"srccountry"`
	SrcName     string `json:"srcname"`
	SrcMAC      string `json:"srcmac"`
	// MasterSrcMAC is the MAC the firewall saw past a switch or AP, when it could.
	MasterSrcMAC string `json:"mastersrcmac"`
	SrcHWVendor  string `json:"srchwvendor"`
	SrcDevType   string `json:"devtype"`
	SrcOSName    string `json:"osname"`
	User         string `json:"user"`
	Group        string `json:"group"`

	DstIP       string `json:"dstip"`
	DstPort     *int   `json:"dstport"`
	DstIntf     string `json:"dstintf"`
	DstIntfRole string `json:"dstintfrole"`
	DstCountry  string `json:"dstcountry"`
	DstName     string `json:"dstname"`
	DstMAC      string `json:"dstmac"`
	DstHWVendor string `json:"dsthwvendor"`
	DstDevType  string `json:"dstdevtype"`

	SessionID  int64  `json:"sessionid"`
	Proto      int    `json:"proto"`
	ProtoName  string `json:"proto_name"`
	Action     string `json:"action"`
	PolicyID   *int   `json:"policyid"`
	PolicyType string `json:"policytype"`
	Service    string `json:"service"`
	App        string `json:"app"`
	AppCat     string `json:"appcat"`
	TranDisp   string `json:"trandisp"`
	Duration   int    `json:"duration"`

	SentByte int64 `json:"sentbyte"`
	RcvdByte int64 `json:"rcvdbyte"`
	SentPkt  int64 `json:"sentpkt"`
	RcvdPkt  int64 `json:"rcvdpkt"`

	CRScore *int   `json:"crscore"`
	CRLevel string `json:"crlevel"`

	Message string `json:"msg"`

	// SrcHost and DstHost are reverse-DNS names, and they are NOT fields of the log entry — the
	// device resolves them on request and returns them in a separate `_extra` object (see
	// logExtraLookup). FortiOS's own log view shows them in brackets after the address, which is
	// the only way an operator can tell 173.243.140.16 from any other number.
	//
	// Kept apart from SrcName/DstName, which are what the FIREWALL recorded at the time. A name
	// resolved now is a different claim from a name the device saw then, and on a security log the
	// difference matters: DNS may have changed, or the lookup may be answering from a resolver the
	// firewall never used.
	SrcHost string `json:"srchost,omitempty"`
	DstHost string `json:"dsthost,omitempty"`

	// Policy is the RULE behind this entry, resolved from the device's policy table — the answer
	// to "which rule claimed my packet", which is what "why can't I get online" reduces to. nil
	// when the device did not name a rule. See fortigate_logpolicy.go; note especially that
	// policyid 0 means two different things depending on PolicyType.
	Policy *LogPolicyRef `json:"policy,omitempty"`

	// Raw is every field the device sent, as text, for the Details panel.
	//
	// STRINGS, not interface{}, and that is not laziness. `eventtime` is 1787813537873930627 —
	// larger than 2^53, so the moment it becomes a JSON number the browser rounds it to
	// …930600 and the panel displays a value the firewall never emitted. Numbers are carried
	// through by their exact literal instead. Details is display-only, so text is the honest type.
	Raw map[string]string `json:"raw,omitempty"`
}

// protoNames covers the IANA numbers a FortiGate actually logs. Anything else renders as its
// number, which is more useful than an empty cell.
var protoNames = map[int]string{
	1: "ICMP", 2: "IGMP", 6: "TCP", 17: "UDP", 41: "IPv6", 47: "GRE",
	50: "ESP", 51: "AH", 58: "ICMPv6", 89: "OSPF", 103: "PIM", 112: "VRRP", 132: "SCTP",
}

// ProtoName renders an IP protocol number the way FortiOS labels it.
func ProtoName(n int) string {
	if name, ok := protoNames[n]; ok {
		return name
	}
	if n == 0 {
		return ""
	}
	return strconv.Itoa(n)
}

// ── Decoding ──────────────────────────────────────────────────────────────────

// rawLogEnvelope is the log API's response. Only `results` overlaps with fgAPIResponse; the rest
// is paging and search state that exists on this namespace alone.
type rawLogEnvelope struct {
	Results     json.RawMessage `json:"results"`
	Status      string          `json:"status"`
	HTTPStatus  int             `json:"http_status"`
	Device      string          `json:"device"`
	Category    string          `json:"category"`
	Subcategory string          `json:"subcategory"`
	Start       int             `json:"start"`
	Rows        int             `json:"rows"`
	SessionID   int             `json:"session_id"`
	Completed   int             `json:"completed"`
	Processed   int             `json:"percent_logs_processed"`
	TotalLines  int             `json:"total_lines"`
	// Now is the DEVICE's clock, epoch ms. Every time comparison uses this.
	Now   int64 `json:"now"`
	Ready bool  `json:"ready"`
	Error int   `json:"error"`
}

// logMetadata is the `_metadata` object every row carries.
type logMetadata struct {
	Num       int   `json:"#"`
	Timestamp int64 `json:"timestamp"`
	Roll      int   `json:"roll"`
	Archive   bool  `json:"archive"`
}

// logExtra is the `_extra` object the device adds when `extra=` was asked for. It is absent
// entirely otherwise, and its keys depend on which extras were requested.
type logExtra struct {
	SrcReverse string `json:"srcip_reverse_lookup"`
	DstReverse string `json:"dstip_reverse_lookup"`
}

// LogExtraReverse is the `extra` value that turns reverse DNS on.
//
// ⚠️ SEVERAL EXTRAS MUST BE SEPARATE PARAMETERS. `extra=reverse_lookup,country_id` returns an
// EMPTY `_extra` object — not one of the two, both silently dropped — while repeating the
// parameter (`extra=reverse_lookup&extra=country_id`) returns both. Same shape as the filter
// parameter, and the same failure: comma looks like it should work and quietly gives nothing.
const LogExtraReverse = "reverse_lookup"

// decodeLogRow turns one raw entry into a row, keeping every field's exact literal for Raw.
func decodeLogRow(raw json.RawMessage) (FGTrafficLog, error) {
	var row FGTrafficLog
	if err := json.Unmarshal(raw, &row); err != nil {
		return row, err
	}
	row.ProtoName = ProtoName(row.Proto)

	// A second decode, this time keeping every value as its literal text. Working from
	// json.RawMessage stops the float64 round-trip that would corrupt eventtime; see the note on
	// FGTrafficLog.Raw.
	var loose map[string]json.RawMessage
	if err := json.Unmarshal(raw, &loose); err == nil {
		row.Raw = make(map[string]string, len(loose))
		for k, v := range loose {
			// Both of the device's own envelopes are lifted into real fields above and below, so
			// neither belongs in Raw — the Details panel would otherwise show a JSON blob beside
			// the values already unpacked from it.
			if k == "_metadata" || k == "_extra" {
				continue
			}
			row.Raw[k] = literal(v)
		}
	}

	var envelopes struct {
		Meta  logMetadata `json:"_metadata"`
		Extra logExtra    `json:"_extra"`
	}
	if err := json.Unmarshal(raw, &envelopes); err == nil {
		row.Row = envelopes.Meta.Num
		row.Timestamp = envelopes.Meta.Timestamp
		row.Archive = envelopes.Meta.Archive
		row.SrcHost = envelopes.Extra.SrcReverse
		row.DstHost = envelopes.Extra.DstReverse
	}
	return row, nil
}

// literal renders a JSON value as the text a person should see, unquoting strings and leaving
// numbers exactly as the device wrote them.
func literal(v json.RawMessage) string {
	trimmed := strings.TrimSpace(string(v))
	if strings.HasPrefix(trimmed, `"`) {
		var s string
		if json.Unmarshal(v, &s) == nil {
			return s
		}
	}
	return trimmed
}

// ── Query ─────────────────────────────────────────────────────────────────────

// LogWindow is one of the three periods FortiOS offers in its own time-period picker, or
// LogWindowAll for a backend that has no such picker.
type LogWindow string

const (
	LogWindow1Hour  LogWindow = "1h"
	LogWindow24Hour LogWindow = "24h"
	LogWindow7Day   LogWindow = "7d"

	// LogWindowAll means "every entry the backend holds", and is what MEMORY always gets.
	//
	// ⚠️ THIS IS NOT A CONVENIENCE — a window on the memory buffer HIDES REAL LOGS.
	// The memory log is a small ring buffer (19.5 MB on the lab unit) that keeps whatever fits and
	// nothing more, so the buffer IS the result set: an entry is either in it or gone. Filtering it
	// to "the last hour" means an operator who comes back after lunch sees an empty table over a
	// buffer with 34 entries in it — which reads as "the firewall saw nothing", the one thing this
	// page must never say by accident.
	//
	// FortiOS agrees, and shows it: its own log view drops the time-period control entirely while
	// the source is Memory, and offers it again for FortiGate Cloud. The picker is not a preference
	// the page owns — it belongs to the backend being read (see logSourceSupportsWindow).
	LogWindowAll LogWindow = "all"
)

// logSourceSupportsWindow reports whether a backend can meaningfully be asked for a time range.
//
// Everything except memory is an indexed store that holds far more than a screenful and is queried
// by period. Memory is a ring buffer that is already exactly as long as it is; see LogWindowAll.
func logSourceSupportsWindow(source string) bool {
	return source != "memory"
}

// windowMillis is how far back each period reaches, in ms.
var windowMillis = map[LogWindow]int64{
	LogWindow1Hour:  60 * 60 * 1000,
	LogWindow24Hour: 24 * 60 * 60 * 1000,
	LogWindow7Day:   7 * 24 * 60 * 60 * 1000,
}

// IsValidLogWindow reports whether w is a period the page may ask for. LogWindowAll is valid and
// simply filters nothing.
func IsValidLogWindow(w LogWindow) bool {
	if w == LogWindowAll {
		return true
	}
	_, ok := windowMillis[w]
	return ok
}

// ResolveLogWindow decides the window actually used, given the backend being read.
//
// A period asked for against memory is not an error — the page may be carrying a stale selection
// from when another source was picked — it just does not apply, so it collapses to LogWindowAll
// rather than silently emptying the table.
func ResolveLogWindow(source string, want LogWindow) LogWindow {
	if !logSourceSupportsWindow(source) {
		return LogWindowAll
	}
	if !IsValidLogWindow(want) || want == LogWindowAll {
		return LogWindow1Hour
	}
	return want
}

// windowMillisFor exposes a period's span for the handler and the tests.
func windowMillisFor(w LogWindow) int64 { return windowMillis[w] }

// TrafficLogQuery is one read of the log.
type TrafficLogQuery struct {
	Source      string // memory | forticloud | …
	Subcategory string // local | forward | sniffer | multicast
	Window      LogWindow
	// Filters are ANDed, each one already in `field==value` form. See BuildSearchFilter.
	Filters []string
	// Terms is the same search in a form this process can APPLY, because the device does not —
	// it answers a matching filter with every row it holds. See fortigate_logmatch.go.
	Terms []LogTerm
	// Start is a 0-BASED offset. Verified: `start=3` returns the 4th row onward and the envelope
	// echoes `start: 4`, so the device's echo is 1-based while the parameter is not.
	Start int
	Rows  int
	// Extras are the device's optional lookups, each sent as its OWN parameter — see
	// LogExtraReverse for why they cannot be joined with commas.
	Extras []string
}

// logSubcategories is what /api/v2/log/{src}/traffic/{sub} accepts. `fortiview` is quietly
// rewritten by the device to `forward` — it answers 200 with `subcategory: forward` — so it is
// not offered here rather than being silently honoured as something else.
var logSubcategories = map[string]bool{
	logSubcategoryLocal: true, "forward": true, "sniffer": true, "multicast": true,
}

// logSubcategoryLocal is the log of traffic addressed to, or originated by, the unit itself. Named
// because resolving policyid 0 depends on which log a row came out of — see fortigate_logpolicy.go.
const logSubcategoryLocal = "local"

// IsValidLogSubcategory reports whether s is a traffic subcategory the device serves.
func IsValidLogSubcategory(s string) bool { return logSubcategories[s] }

// maxLogRows caps one read. The device happily serves `rows=10000`, but the memory buffer is
// 19.5 MB and a page renders a few dozen lines; pulling the whole buffer to show 50 rows would
// spend seconds of device time on every refresh.
const maxLogRows = 1000

// defaultLogRows matches what FortiOS uses when `rows` is omitted.
const defaultLogRows = 400

// FGTrafficLogPage is one page of results plus the state needed to page and to judge it.
type FGTrafficLogPage struct {
	Rows []FGTrafficLog `json:"rows"`
	// Total is how many entries this log really holds, after the subcategory filter the DEVICE
	// skipped (see the note at the top of this file) but before the time window. Deliberately not
	// the envelope's `total_lines`, which counts every subtype in the buffer.
	Total int `json:"total"`
	// Returned is how many survived the window, which is what the footer counts.
	Returned int `json:"returned"`
	Start    int `json:"start"`
	// DeviceNow is the firewall's clock (epoch ms) at the moment of the read. Every relative time
	// on the page is measured from this, never from the browser's clock.
	DeviceNow int64 `json:"device_now"`
	// Ready is false while FortiOS is still building the result set; the page re-reads.
	Ready     bool      `json:"ready"`
	Completed int       `json:"completed"`
	Source    string    `json:"source"`
	Window    LogWindow `json:"window"`
	// WindowStart is the earliest instant included, so the UI can label the range honestly.
	WindowStart int64 `json:"window_start"`
	// Truncated is true when the device had more matching rows than one read returned.
	Truncated bool `json:"truncated"`
}

// buildLogPath assembles the device URL. Every segment is validated by the caller, and the filter
// values are escaped here.
func buildLogPath(q TrafficLogQuery) string {
	rows := q.Rows
	if rows <= 0 {
		rows = defaultLogRows
	}
	if rows > maxLogRows {
		rows = maxLogRows
	}
	start := q.Start
	if start < 0 {
		start = 0
	}

	var b bytes.Buffer
	fmt.Fprintf(&b, "/api/v2/log/%s/traffic/%s?start=%d&rows=%d", q.Source, q.Subcategory, start, rows)
	// AND is expressed by REPEATING the parameter — verified on the device. Joining the terms
	// into one `filter=` with any separator (space, +, ;, &) matches nothing at all.
	for _, f := range q.Filters {
		if strings.TrimSpace(f) == "" {
			continue
		}
		fmt.Fprintf(&b, "&filter=%s", url.QueryEscape(f))
	}
	// Repeated for the same reason the filters are: joining them with a comma returns an empty
	// `_extra` rather than an error.
	for _, e := range q.Extras {
		if strings.TrimSpace(e) == "" {
			continue
		}
		fmt.Fprintf(&b, "&extra=%s", url.QueryEscape(e))
	}
	return b.String()
}

// maxLogBody caps the JSON one read may return: 1,000 rows of ~700 bytes plus headroom.
const maxLogBody = 8 << 20

// GetTrafficLog reads one page of the traffic log.
func (f *FortiClient) GetTrafficLog(q TrafficLogQuery, policies map[int]LogPolicyRef) (FGTrafficLogPage, error) {
	page := FGTrafficLogPage{Rows: []FGTrafficLog{}, Source: q.Source, Window: q.Window}

	if !isValidLogSource(q.Source) {
		return page, fmt.Errorf("unknown log source %q", q.Source)
	}
	if !IsValidLogSubcategory(q.Subcategory) {
		return page, fmt.Errorf("unknown traffic subcategory %q", q.Subcategory)
	}

	body, _, err := f.doRawGet(buildLogPath(q), maxLogBody)
	if err != nil {
		return page, err
	}
	return ParseTrafficLog(body, q, policies)
}

// ParseTrafficLog decodes a log response and applies the time window.
//
// Split from the request so the fixture captured off the real device can be replayed in tests —
// the window arithmetic and the pointer-vs-zero port handling are where the bugs live, and neither
// needs a firewall to exercise.
func ParseTrafficLog(body []byte, q TrafficLogQuery, policies map[int]LogPolicyRef) (FGTrafficLogPage, error) {
	page := FGTrafficLogPage{Rows: []FGTrafficLog{}, Source: q.Source, Window: q.Window}

	var env rawLogEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return page, fmt.Errorf("log response was not JSON: %w", err)
	}
	if env.Status != "" && env.Status != "success" {
		return page, fmt.Errorf("device refused the log query (status %q, HTTP %d)", env.Status, env.HTTPStatus)
	}

	page.Start = q.Start
	page.DeviceNow = env.Now
	page.Ready = env.Ready
	page.Completed = env.Completed

	var entries []json.RawMessage
	if len(env.Results) > 0 {
		// `results` is an ARRAY here. A device with no logs sends `[]`, not null — but a refused
		// search has been seen to send an object, so a decode failure is "no rows", not an error.
		_ = json.Unmarshal(env.Results, &entries)
	}

	rows := make([]FGTrafficLog, 0, len(entries))
	for _, raw := range entries {
		row, err := decodeLogRow(raw)
		if err != nil {
			continue // one malformed entry must not lose the whole page
		}
		// The device did not filter by subcategory even though it was asked to — see the note at
		// the top of this file. A row that does not say it belongs to this log is not in this log.
		// An entry with no `subtype` at all is kept: it is a real log line, and dropping it on a
		// missing field would hide evidence.
		if row.Subtype != "" && q.Subcategory != "" && row.Subtype != q.Subcategory {
			continue
		}
		// And the search is applied here too. The device honours a single `field==value` term but
		// ignores the comma-OR form that every free-text search becomes, so a word matching nothing
		// used to return the whole log as if it were the result. See fortigate_logmatch.go.
		if !MatchLogRow(&row, q.Terms) {
			continue
		}
		row.Policy = ResolveLogPolicy(row.PolicyID, row.PolicyType, q.Subcategory, policies)
		rows = append(rows, row)
	}

	// Total is what this log really holds, AFTER the subcategory filter the device skipped —
	// not the envelope's `total_lines`, which counts every subtype in the buffer and would tell a
	// Forward Traffic footer it had 34 entries while showing none.
	page.Total = len(rows)

	// The window is measured from the DEVICE's clock. Falling back to the newest row's own
	// timestamp keeps the filter meaningful on a response that omitted `now`; falling back to the
	// Go server's clock would not, because the two machines disagree.
	if span, windowed := windowMillis[q.Window]; windowed {
		now := env.Now
		if now == 0 {
			for _, r := range rows {
				if r.Timestamp > now {
					now = r.Timestamp
				}
			}
		}
		if now > 0 {
			cutoff := now - span
			page.WindowStart = cutoff
			kept := rows[:0]
			for _, r := range rows {
				// A row with no usable timestamp is KEPT. Dropping it would hide a real log entry
				// on the strength of a missing field, and the whole point of this page is that an
				// empty table is never invented.
				if r.Timestamp == 0 || r.Timestamp >= cutoff {
					kept = append(kept, r)
				}
			}
			rows = kept
		}
	}

	// Newest first, as every FortiOS log view orders it. The device already returns them this
	// way; sorting makes it true regardless of source, and `Row` breaks ties so the order is
	// total and the React keys stay stable.
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Timestamp != rows[j].Timestamp {
			return rows[i].Timestamp > rows[j].Timestamp
		}
		return rows[i].Row < rows[j].Row
	})

	page.Rows = rows
	page.Returned = len(rows)
	// The device filled the page to the brim, so there is very likely more behind it. Comparing
	// against the envelope's total no longer works now that rows are filtered here: the device
	// counts subtypes this log does not show.
	page.Truncated = len(entries) > 0 && len(entries) >= requestedRows(q)
	return page, nil
}

// requestedRows is the row cap actually sent to the device, mirroring buildLogPath's clamping so
// that "the page came back full" can be recognised.
func requestedRows(q TrafficLogQuery) int {
	rows := q.Rows
	if rows <= 0 {
		rows = defaultLogRows
	}
	if rows > maxLogRows {
		rows = maxLogRows
	}
	return rows
}

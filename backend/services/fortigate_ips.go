package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// IPS sensor (ips/sensor) — form mapping and the filter-option catalogue behind the form.
//
// IPS was the one profile a firewall policy could REFERENCE but this console could not CREATE:
// device_proxy.go has always sent `ips-sensor` on a policy and PolicyWizard has always offered
// the picker, but the Security Profiles section had no IPS page, so the only way to get a sensor
// onto the list was to leave and use the FortiGate's own GUI.
//
// CMDB path /api/v2/cmdb/ips/sensor (mkey=name). Verified live against 10.0.99.201
// (FortiGate 80E, FortiOS 7.2.10, build 1706): schema pulled with `?action=schema&vdom=root`,
// object shape read back from the built-in "default" sensor.
//
// ⚠️ The five filter fields — severity, location, protocol, os, application — are declared
// `"type": "user", "multiple_values": true` in the schema, which means the device stores them as
// ONE SPACE-SEPARATED STRING, not as a JSON array:
//
//	"severity": "medium high critical"
//
// and the literal "all" is how "no filter" is spelled. Sending a JSON array here is silently
// coerced, so this file converts in both directions rather than letting a []string reach the wire.

// ── Form ──────────────────────────────────────────────────────────────────────

// IPSEntry is one row of the sensor's table — the FortiOS "IPS Filter" / "IPS Signature" drawer.
//
// FortiOS keeps both flavours in the same `entries` table and tells them apart by whether `rule`
// is populated: a row with explicit signature ids is a signature entry, a row without is a filter
// that matches signatures by attribute. Kind carries that distinction to the form so the UI can
// render the right drawer, and is derived on read rather than stored on the device.
type IPSEntry struct {
	ID   int    `json:"id"`
	Kind string `json:"kind"` // "filter" | "signature" (derived: len(rules) > 0)

	// Filter attributes. An empty slice means "all" — the device's own spelling of no filter.
	Severity    []string `json:"severity"`
	Location    []string `json:"location"`
	Protocol    []string `json:"protocol"`
	OS          []string `json:"os"`
	Application []string `json:"application"`

	// Rules are explicit signature ids (ips/rule → rule-id). CVEs are CVE ids or wildcards.
	Rules []int    `json:"rules"`
	CVEs  []string `json:"cves"`

	Status     string `json:"status"` // default | enable | disable
	Action     string `json:"action"` // default | pass | block | reset
	Log        bool   `json:"log"`
	LogPacket  bool   `json:"log_packet"`
	Quarantine string `json:"quarantine"` // none | attacker
}

// IPSSensorForm mirrors the FortiOS "New IPS Sensor" page.
type IPSSensorForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	BlockMaliciousURL bool `json:"block_malicious_url"`
	ExtendedLog       bool `json:"extended_log"`
	// ScanBotnetConnections is a three-way on the device, not a toggle: disable | block | monitor.
	ScanBotnetConnections string `json:"scan_botnet_connections"`

	Entries []IPSEntry `json:"entries"`
}

// ── Enum guards ───────────────────────────────────────────────────────────────
//
// Every value below is copied from the live schema dump, not from documentation. Anything else
// is rejected here so the device answers about real problems instead of typos.

var (
	ipsStatusValues     = map[string]bool{"default": true, "enable": true, "disable": true}
	ipsActionValues     = map[string]bool{"default": true, "pass": true, "block": true, "reset": true}
	ipsQuarantineValues = map[string]bool{"none": true, "attacker": true}
	ipsBotnetValues     = map[string]bool{"disable": true, "block": true, "monitor": true}
	// ipsSeverityValues is closed — the signature database only ever carries these five.
	ipsSeverityValues = map[string]bool{"info": true, "low": true, "medium": true, "high": true, "critical": true}
	ipsLocationValues = map[string]bool{"client": true, "server": true}
)

// ValidateIPSSensorForm catches what the device would otherwise reject with a bare numeric code.
func ValidateIPSSensorForm(form IPSSensorForm) error {
	if strings.TrimSpace(form.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if b := strings.TrimSpace(form.ScanBotnetConnections); b != "" && !ipsBotnetValues[b] {
		return fmt.Errorf("scan_botnet_connections must be disable, block or monitor (got %q)", b)
	}
	if len(form.Entries) == 0 {
		// A sensor with no entries matches nothing. FortiOS accepts it, and it is the single
		// easiest way to attach an IPS profile to a policy and believe traffic is being
		// inspected when nothing is.
		return fmt.Errorf("an IPS sensor needs at least one filter or signature entry — " +
			"a sensor with none inspects nothing")
	}
	for i, e := range form.Entries {
		where := fmt.Sprintf("entry %d", i+1)
		if s := strings.TrimSpace(e.Status); s != "" && !ipsStatusValues[s] {
			return fmt.Errorf("%s: status must be default, enable or disable (got %q)", where, s)
		}
		if a := strings.TrimSpace(e.Action); a != "" && !ipsActionValues[a] {
			return fmt.Errorf("%s: action must be default, pass, block or reset (got %q)", where, a)
		}
		if q := strings.TrimSpace(e.Quarantine); q != "" && !ipsQuarantineValues[q] {
			return fmt.Errorf("%s: quarantine must be none or attacker (got %q)", where, q)
		}
		for _, s := range e.Severity {
			if !ipsSeverityValues[strings.ToLower(strings.TrimSpace(s))] {
				return fmt.Errorf("%s: unknown severity %q — expected info, low, medium, high or critical", where, s)
			}
		}
		for _, l := range e.Location {
			if !ipsLocationValues[strings.ToLower(strings.TrimSpace(l))] {
				return fmt.Errorf("%s: unknown target %q — expected client or server", where, l)
			}
		}
		if len(e.Rules) == 0 && len(e.CVEs) == 0 &&
			len(e.Severity) == 0 && len(e.Location) == 0 && len(e.Protocol) == 0 &&
			len(e.OS) == 0 && len(e.Application) == 0 {
			// "All signatures, default action" is a legitimate sensor (it is what the built-in
			// "all_default" is), so this is only rejected when the row ALSO leaves action and
			// status at default — that row changes nothing whatsoever.
			if strings.TrimSpace(e.Action) == "" || e.Action == "default" {
				if strings.TrimSpace(e.Status) == "" || e.Status == "default" {
					return fmt.Errorf("%s: matches every signature but changes nothing — "+
						"narrow the filter, or set an action other than Default", where)
				}
			}
		}
	}
	return nil
}

// ── Multi-value conversion ────────────────────────────────────────────────────

// ipsMultiToSlice splits one of the device's space-separated filter strings.
// "all" (the device's word for unfiltered) and "" both become an empty slice.
func ipsMultiToSlice(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" || s == "all" {
		return nil
	}
	fields := strings.Fields(s)
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f != "" && f != "all" {
			out = append(out, f)
		}
	}
	return out
}

// ipsSliceToMulti joins a filter back into the one string the device stores.
// An empty slice becomes "all", which is what clears the filter — sending "" instead leaves the
// previous value in place on an update.
func ipsSliceToMulti(v []string) string {
	out := make([]string, 0, len(v))
	seen := map[string]bool{}
	for _, s := range v {
		s = strings.TrimSpace(s)
		if s == "" || s == "all" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return "all"
	}
	return strings.Join(out, " ")
}

// ── Device → form ─────────────────────────────────────────────────────────────

type fgIPSEntry struct {
	ID          int    `json:"id"`
	Location    string `json:"location"`
	Severity    string `json:"severity"`
	Protocol    string `json:"protocol"`
	OS          string `json:"os"`
	Application string `json:"application"`
	Status      string `json:"status"`
	Action      string `json:"action"`
	Log         string `json:"log"`
	LogPacket   string `json:"log-packet"`
	Quarantine  string `json:"quarantine"`
	Rule        []struct {
		ID int `json:"id"`
	} `json:"rule"`
	CVE []struct {
		Entry string `json:"cve-entry"`
	} `json:"cve"`
}

type fgIPSSensor struct {
	Name              string       `json:"name"`
	Comment           string       `json:"comment"`
	BlockMaliciousURL string       `json:"block-malicious-url"`
	ScanBotnet        string       `json:"scan-botnet-connections"`
	ExtendedLog       string       `json:"extended-log"`
	Entries           []fgIPSEntry `json:"entries"`
}

func fgToIPSSensorForm(s fgIPSSensor) IPSSensorForm {
	form := IPSSensorForm{
		Name:                  s.Name,
		Comment:               s.Comment,
		BlockMaliciousURL:     s.BlockMaliciousURL == "enable",
		ExtendedLog:           s.ExtendedLog == "enable",
		ScanBotnetConnections: orDefault(s.ScanBotnet, "disable"),
		Entries:               make([]IPSEntry, 0, len(s.Entries)),
	}
	for _, e := range s.Entries {
		rules := make([]int, 0, len(e.Rule))
		for _, r := range e.Rule {
			rules = append(rules, r.ID)
		}
		cves := make([]string, 0, len(e.CVE))
		for _, c := range e.CVE {
			if strings.TrimSpace(c.Entry) != "" {
				cves = append(cves, c.Entry)
			}
		}
		kind := "filter"
		if len(rules) > 0 || len(cves) > 0 {
			kind = "signature"
		}
		form.Entries = append(form.Entries, IPSEntry{
			ID:          e.ID,
			Kind:        kind,
			Severity:    ipsMultiToSlice(e.Severity),
			Location:    ipsMultiToSlice(e.Location),
			Protocol:    ipsMultiToSlice(e.Protocol),
			OS:          ipsMultiToSlice(e.OS),
			Application: ipsMultiToSlice(e.Application),
			Rules:       rules,
			CVEs:        cves,
			Status:      orDefault(e.Status, "default"),
			Action:      orDefault(e.Action, "default"),
			Log:         e.Log != "disable",
			LogPacket:   e.LogPacket == "enable",
			Quarantine:  orDefault(e.Quarantine, "none"),
		})
	}
	return form
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// ── Form → device ─────────────────────────────────────────────────────────────

func ipsSensorPayload(form IPSSensorForm) map[string]interface{} {
	entries := make([]map[string]interface{}, 0, len(form.Entries))
	for i, e := range form.Entries {
		// ids are renumbered from 1 on every write. The device requires them unique within the
		// sensor, and the form is free to reorder or delete rows — trusting whatever id came back
		// from a previous read would collide the moment a row was removed and another added.
		row := map[string]interface{}{
			"id":          i + 1,
			"status":      orDefault(e.Status, "default"),
			"action":      orDefault(e.Action, "default"),
			"log":         boolToEnable(e.Log),
			"log-packet":  boolToEnable(e.LogPacket),
			"quarantine":  orDefault(e.Quarantine, "none"),
			"location":    ipsSliceToMulti(e.Location),
			"severity":    ipsSliceToMulti(e.Severity),
			"protocol":    ipsSliceToMulti(e.Protocol),
			"os":          ipsSliceToMulti(e.OS),
			"application": ipsSliceToMulti(e.Application),
		}
		// `rule` and `cve` are member tables: a list of {id} / {cve-entry} objects. They are always
		// sent, empty included — omitting them on an update leaves the previous membership behind,
		// which is how a filter row silently keeps signatures the user removed from the form.
		rules := make([]map[string]interface{}, 0, len(e.Rules))
		for _, id := range e.Rules {
			rules = append(rules, map[string]interface{}{"id": id})
		}
		row["rule"] = rules

		cves := make([]map[string]interface{}, 0, len(e.CVEs))
		for _, c := range e.CVEs {
			if c = strings.TrimSpace(c); c != "" {
				cves = append(cves, map[string]interface{}{"cve-entry": c})
			}
		}
		row["cve"] = cves

		entries = append(entries, row)
	}

	return map[string]interface{}{
		"name":                    form.Name,
		"comment":                 form.Comment,
		"block-malicious-url":     boolToEnable(form.BlockMaliciousURL),
		"extended-log":            boolToEnable(form.ExtendedLog),
		"scan-botnet-connections": orDefault(form.ScanBotnetConnections, "disable"),
		"entries":                 entries,
	}
}

func boolToEnable(b bool) string {
	if b {
		return "enable"
	}
	return "disable"
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

const ipsSensorPath = "/api/v2/cmdb/ips/sensor"

// GetIPSSensor reads one sensor and shapes it for the edit form.
func (f *FortiClient) GetIPSSensor(name string) (IPSSensorForm, error) {
	var form IPSSensorForm
	resp, err := f.do("GET", ipsSensorPath+"/"+url.PathEscape(name), nil)
	if err != nil {
		return form, err
	}
	var items []fgIPSSensor
	if err := json.Unmarshal(resp.Results, &items); err != nil {
		return form, fmt.Errorf("failed to parse IPS sensor: %w", err)
	}
	if len(items) == 0 {
		return form, fmt.Errorf("IPS sensor %q not found", name)
	}
	return fgToIPSSensorForm(items[0]), nil
}

// CreateIPSSensor adds a sensor. Idempotent per the project rule: a duplicate name is reported
// as "already exists" rather than as a device failure.
func (f *FortiClient) CreateIPSSensor(form IPSSensorForm) error {
	_, err := f.do("POST", ipsSensorPath, ipsSensorPayload(form))
	if err != nil && IsDuplicateObjectError(err) {
		return fmt.Errorf("an IPS sensor named %q already exists on this device", form.Name)
	}
	return err
}

// UpdateIPSSensor rewrites a sensor in place.
func (f *FortiClient) UpdateIPSSensor(name string, form IPSSensorForm) error {
	payload := ipsSensorPayload(form)
	// The mkey in the URL is authoritative; a rename would need a different call, and sending a
	// differing name in the body is how the object ends up half-renamed.
	payload["name"] = name
	_, err := f.do("PUT", ipsSensorPath+"/"+url.PathEscape(name), payload)
	return err
}

// ── Filter-option catalogue ───────────────────────────────────────────────────
//
// The five filter fields are free-form strings in the schema, so the schema cannot say what may
// go in them. The authoritative list is the device's own signature database: every value the
// form should offer is one that some signature actually carries. This is the same approach the
// Application Control page already takes with its 2,414-app list.

// IPSMetadata is everything the IPS form's pickers need.
type IPSMetadata struct {
	Severities   []string `json:"severities"`
	Locations    []string `json:"locations"`
	Protocols    []string `json:"protocols"`
	OSes         []string `json:"oses"`
	Applications []string `json:"applications"`
	// SignatureCount is how many signatures the device holds. 0 means the database could not be
	// read — the form shows the fallback lists and says so rather than pretending it is empty.
	SignatureCount int `json:"signature_count"`
	// Signatures is the searchable list behind the "IPS Signature" drawer. Capped: the full
	// database is 4 MB and the picker is a search box, not a scroll.
	Signatures []IPSSignature `json:"signatures"`
}

// IPSSignature is one row of the signature picker.
type IPSSignature struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Severity string `json:"severity"`
	Location string `json:"location"`
	OS       string `json:"os"`
	Service  string `json:"service"`
	Action   string `json:"action"`
}

// ipsFallbackMetadata is what the form gets when the signature database cannot be read (an
// unlicensed or unreachable unit). These are the values FortiOS's own GUI offers, and they let
// the form stay usable rather than showing five empty dropdowns.
var ipsFallbackMetadata = IPSMetadata{
	Severities: []string{"info", "low", "medium", "high", "critical"},
	Locations:  []string{"client", "server"},
	Protocols: []string{"BO", "DCERPC", "DHCP", "DNS", "FTP", "H323", "HTTP", "ICMP", "IM", "IMAP",
		"LDAP", "MSSQL", "NBSS", "NNTP", "Other", "POP3", "RADIUS", "RPC", "RTSP", "SCCP",
		"SIP", "SMTP", "SNMP", "SSH", "SSL", "TCP", "TELNET", "UDP"},
	OSes: []string{"BSD", "Linux", "MacOS", "Other", "Solaris", "Windows"},
	Applications: []string{"Adobe", "Apache", "Apple", "CA", "Cisco", "DB2", "HP", "IBM", "IE", "IIS",
		"IM", "MSSQL", "MS_Exchange", "MS_Office", "MediaPlayer", "Mozilla", "MySQL", "Novell",
		"Oracle", "Other", "PHP_app", "PostgreSQL", "Real", "SAP", "Samba", "Sendmail", "Sun"},
}

// maxIPSSignaturesReturned caps the picker payload. The lab unit holds 5,864 signatures at ~4 MB
// of JSON; trimmed to the fields the picker shows and capped here, the response is a few hundred
// KB. The search box filters server-side data it already has, so the cap only bites on a device
// with an unusually large database, and the count field tells the user when it did.
const maxIPSSignaturesReturned = 6000

// ipsMetadataTTL — the signature database changes when FortiGuard pushes an update, which is
// daily at most. Matches the Application Control signature cache.
const ipsMetadataTTL = 30 * time.Minute

var ipsMetaCache sync.Map // deviceKey → *ipsMetaEntry

type ipsMetaEntry struct {
	at   time.Time
	data IPSMetadata
}

// GetIPSMetadata returns the filter-option catalogue, derived from the device's own signature
// database and cached per device.
//
// Best-effort by contract, like every other metadata reader here: a device that cannot answer
// yields the fallback lists rather than an error, because a form with slightly generic dropdowns
// is far more useful than a form that will not open.
func (f *FortiClient) GetIPSMetadata() IPSMetadata {
	key := f.BaseURL
	if v, ok := ipsMetaCache.Load(key); ok {
		if e := v.(*ipsMetaEntry); time.Since(e.at) < ipsMetadataTTL {
			return e.data
		}
	}

	meta, err := f.buildIPSMetadata()
	if err != nil {
		// Do not cache a failure: the next open should try again rather than serve fallbacks for
		// half an hour because one read timed out.
		return ipsFallbackMetadata
	}
	ipsMetaCache.Store(key, &ipsMetaEntry{at: time.Now(), data: meta})
	return meta
}

func (f *FortiClient) buildIPSMetadata() (IPSMetadata, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/ips/rule?fields=name,rule-id,severity,location,os,application,service,action", nil)
	if err != nil {
		return IPSMetadata{}, err
	}

	var rules []struct {
		Name        string          `json:"name"`
		RuleID      json.RawMessage `json:"rule-id"`
		Severity    string          `json:"severity"`
		Location    string          `json:"location"`
		OS          string          `json:"os"`
		Application string          `json:"application"`
		Service     string          `json:"service"`
		Action      string          `json:"action"`
	}
	if err := json.Unmarshal(resp.Results, &rules); err != nil {
		return IPSMetadata{}, fmt.Errorf("failed to parse IPS signature database: %w", err)
	}
	if len(rules) == 0 {
		return IPSMetadata{}, fmt.Errorf("device returned an empty IPS signature database")
	}

	// Each signature's attribute fields are comma-separated lists of the atoms the filter uses
	// ("Other, Windows, Linux"), so the option set is the union of the split values, not the
	// distinct raw strings — 45 raw `os` combinations on the lab unit reduce to 6 real ones.
	sev, loc, proto, oses, apps := newStrSet(), newStrSet(), newStrSet(), newStrSet(), newStrSet()
	sigs := make([]IPSSignature, 0, len(rules))
	for _, r := range rules {
		sev.addCSV(r.Severity)
		loc.addCSV(r.Location)
		proto.addCSV(r.Service)
		oses.addCSV(r.OS)
		apps.addCSV(r.Application)

		if len(sigs) < maxIPSSignaturesReturned {
			sigs = append(sigs, IPSSignature{
				ID:       parseFlexibleInt(r.RuleID),
				Name:     r.Name,
				Severity: r.Severity,
				Location: r.Location,
				OS:       r.OS,
				Service:  r.Service,
				Action:   r.Action,
			})
		}
	}

	return IPSMetadata{
		Severities:     sev.sortedBy(ipsSeverityOrder),
		Locations:      loc.sorted(),
		Protocols:      proto.sorted(),
		OSes:           oses.sorted(),
		Applications:   apps.sorted(),
		SignatureCount: len(rules),
		Signatures:     sigs,
	}, nil
}

// ipsSeverityOrder ranks severities by how bad they are rather than alphabetically, because a
// dropdown that reads critical, high, info, low, medium is a dropdown nobody can scan.
var ipsSeverityOrder = map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

// parseFlexibleInt reads a rule id that may arrive as a number or as a quoted string, which
// FortiOS does inconsistently across firmware for this field.
func parseFlexibleInt(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var n int
	if err := json.Unmarshal(raw, &n); err == nil {
		return n
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			return v
		}
	}
	return 0
}

// ── small set helper ──────────────────────────────────────────────────────────

type strSet map[string]bool

func newStrSet() strSet { return strSet{} }

// addCSV splits a comma-separated attribute list and adds each atom, dropping "All" — it is the
// signature database's way of saying "every value", not a value the filter can be set to.
func (s strSet) addCSV(v string) {
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		if part == "" || strings.EqualFold(part, "all") {
			continue
		}
		s[part] = true
	}
}

func (s strSet) sorted() []string {
	out := make([]string, 0, len(s))
	for k := range s {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// sortedBy orders by an explicit rank first, then alphabetically for anything unranked.
func (s strSet) sortedBy(rank map[string]int) []string {
	out := s.sorted()
	sort.SliceStable(out, func(i, j int) bool {
		ri, oki := rank[strings.ToLower(out[i])]
		rj, okj := rank[strings.ToLower(out[j])]
		if oki && okj {
			return ri < rj
		}
		if oki != okj {
			return oki
		}
		return out[i] < out[j]
	})
	return out
}

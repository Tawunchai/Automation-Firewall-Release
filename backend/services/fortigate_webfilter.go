package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Web Filter profile (webfilter/profile) — form mapping, the urlfilter/content named tables it
// depends on, and the FortiGuard category metadata behind the form's pickers.
//
// Split out of fortigate.go verbatim.

// ── Web Filter Profile (create/update) ────────────────────────────────────────
//
// WebFilterProfileForm is our simplified, GUI-shaped view of a FortiGate
// webfilter/profile object — one flat struct mirroring exactly the toggles on FortiOS's
// own "New Web Filter Profile" page (flow-based, the FortiOS default). Every mapping below
// was verified against a live FortiGate 7.2.10 (FGT80E) by round-tripping a probe profile:
//
//	Name / Comments                                     → name / comment
//	FortiGuard Category Based Filter (master toggle)    → ftgd-wf.options: ABSENCE of "ftgd-disable"
//	Allow users to override blocked categories          → ovrd-perm: "fortiguard-wf-override"
//	Static URL Filter · Block invalid URLs              → options: "block-invalid-url"
//	Static URL Filter · URL Filter                      → web.urlfilter-table (0 = off, else a table id)
//	Static URL Filter · Block malicious URLs (FortiSandbox) → web.blocklist {enable|disable}
//	Static URL Filter · Content Filter                  → web.bword-table (0 = off, else a table id)
//	Rating Options · Allow websites when a rating error occurs → ftgd-wf.options: "error-allow"
//	Rating Options · Rate URLs by domain and IP Address → ftgd-wf.options: "rate-server-ip"
//	Proxy Options · HTTP POST Action (Allow|Block)      → post-action {normal|block}
//	Proxy Options · Remove Cookies                      → options: "cookiefilter"
//
// URL Filter and Content Filter reference their own CMDB tables (webfilter/urlfilter and
// webfilter/content). Like the real GUI, enabling either toggle auto-creates an empty table
// named after the profile and binds it (see ensureWebfilterTable); disabling sets the ref
// back to 0 and leaves the table in place, which is what the GUI does too.
type WebFilterProfileForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	FortiGuardCategoryFilter bool `json:"fortiguard_category_filter"`
	AllowOverride            bool `json:"allow_override"`

	BlockInvalidURLs           bool `json:"block_invalid_urls"`
	URLFilter                  bool `json:"url_filter"`
	BlockMaliciousFortiSandbox bool `json:"block_malicious_fortisandbox"`
	ContentFilter              bool `json:"content_filter"`

	AllowRatingError  bool `json:"allow_rating_error"`
	RateByDomainAndIP bool `json:"rate_by_domain_and_ip"`

	HTTPPostAction string `json:"http_post_action"` // "allow" (normal) | "block"
	RemoveCookies  bool   `json:"remove_cookies"`

	// Static URL Filter · URL Filter table rows (stored in the webfilter/urlfilter table this
	// profile binds to). Only meaningful when URLFilter is on.
	URLFilterEntries []WebFilterURLEntry `json:"url_filter_entries"`
	// Static URL Filter · Content Filter table rows (webfilter/content table). ContentFilter on.
	ContentFilterEntries []WebFilterContentEntry `json:"content_filter_entries"`

	// FortiGuard Category Based Filter tree: per-category action, only for categories whose
	// action ≠ "allow". Stored on the device as ftgd-wf.filters entries (allow = no entry).
	// action ∈ {allow, monitor, block, warning, authenticate}; the frontend fills every other
	// category from the taxonomy as "allow", so only overrides need to be sent.
	Categories []WebFilterCategoryAction `json:"categories"`

	// "Allow users to override blocked categories" expanded sub-form (override{...}). Only
	// meaningful when AllowOverride is on.
	Override WebFilterOverride `json:"override"`
}

// WebFilterCategoryAction is one FortiGuard/local category and its chosen action.
//
// AuthGroups carries the user group(s) that may authenticate past the category — the ftgd-wf
// filters entry's "auth-usr-grp". FortiOS REQUIRES it whenever action is "authenticate": without
// it the device rejects the whole request with error -149 ("object check operator error") AND
// silently drops every filter entry after the offending one, so a profile comes back missing
// categories it was told to set (verified live on 7.2.10).
type WebFilterCategoryAction struct {
	Category   int      `json:"category"`
	Action     string   `json:"action"` // allow | monitor | block | warning | authenticate
	AuthGroups []string `json:"auth_groups,omitempty"`
}

// WebFilterURLEntry is one row of the Static URL Filter table (webfilter/urlfilter entries).
type WebFilterURLEntry struct {
	URL    string `json:"url"`
	Type   string `json:"type"`   // simple | regex | wildcard
	Action string `json:"action"` // exempt | block | allow | monitor
	Status string `json:"status"` // enable | disable
}

// WebFilterContentEntry is one row of the Content Filter table (webfilter/content entries).
// Pattern maps to the CMDB "name" mkey; Score defaults to 10 (the GUI default) when unset.
type WebFilterContentEntry struct {
	Pattern     string `json:"pattern"`
	PatternType string `json:"pattern_type"` // wildcard | regexp
	Lang        string `json:"lang"`         // western | simch | trach | japanese | korean | french | thai | spanish | cyrillic
	Action      string `json:"action"`       // block | exempt
	Status      string `json:"status"`       // enable | disable
	Score       int    `json:"score"`
}

// WebFilterOverride mirrors the webfilter/profile "override" sub-object shown when "Allow
// users to override blocked categories" is enabled.
type WebFilterOverride struct {
	Groups        []string `json:"groups"`        // ovrd-user-group — groups that can override
	Profiles      []string `json:"profiles"`      // override.profile — profiles they can switch to
	Scope         string   `json:"scope"`         // user | user-group | ip | ask  (→ ovrd-scope)
	DurationMode  string   `json:"duration_mode"` // predefined | ask  (→ ovrd-dur-mode constant|ask)
	DurationDays  int      `json:"duration_days"` // together → ovrd-dur "<d>d<h>h<m>m"
	DurationHours int      `json:"duration_hours"`
	DurationMins  int      `json:"duration_minutes"`
}

// ensureNamedTable returns the id of the id-keyed CMDB table at `base` whose name is `name`,
// creating an empty one if none exists, then replaces its entries with `entries`.
//
// FortiOS keeps the rows of a "Static URL Filter" / "Static Domain Filter" style toggle in a
// SEPARATE table object that the profile then references by id, and the real GUI auto-creates
// that table the moment the toggle is switched on. We mirror that: the toggle resolves to a
// valid table reference AND the rows the user added are written into it. The mkey of these
// tables is an integer id (not the name), so after creating we re-list and match by name to
// learn the id. entries must be non-nil (send [] to clear).
func (f *FortiClient) ensureNamedTable(base, name string, entries []map[string]interface{}) (int, error) {
	findByName := func() (int, bool, error) {
		resp, err := f.do("GET", base+"?fields=id,name", nil)
		if err != nil {
			return 0, false, err
		}
		var rows []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(resp.Results, &rows); err != nil {
			return 0, false, err
		}
		for _, r := range rows {
			if r.Name == name {
				return r.ID, true, nil
			}
		}
		return 0, false, nil
	}

	// setEntries replaces the table's row list (entries is always sent, [] clears the table).
	setEntries := func(id int) (int, error) {
		if _, err := f.do("PUT", base+"/"+strconv.Itoa(id), map[string]interface{}{"entries": entries}); err != nil {
			return 0, err
		}
		return id, nil
	}

	if id, ok, err := findByName(); err != nil {
		return 0, err
	} else if ok {
		return setEntries(id)
	}

	if _, err := f.do("POST", base, map[string]interface{}{"name": name}); err != nil {
		return 0, err
	}
	if id, ok, err := findByName(); err != nil {
		return 0, err
	} else if ok {
		return setEntries(id)
	}
	return 0, fmt.Errorf("created table %q at %s but could not resolve its id", name, base)
}

// ensureWebfilterTable resolves the webfilter/<kind> table named `name` (kind is "urlfilter"
// or "content") and replaces its rows — see ensureNamedTable.
func (f *FortiClient) ensureWebfilterTable(kind, name string, entries []map[string]interface{}) (int, error) {
	return f.ensureNamedTable("/api/v2/cmdb/webfilter/"+kind, name, entries)
}

// ensureDNSDomainFilterTable resolves the dnsfilter/domain-filter table named `name` and
// replaces its rows — the Static Domain Filter half of a DNS Filter profile.
func (f *FortiClient) ensureDNSDomainFilterTable(name string, entries []map[string]interface{}) (int, error) {
	return f.ensureNamedTable("/api/v2/cmdb/dnsfilter/domain-filter", name, entries)
}

// GetWebfilterTableIDs lists the ids already taken in webfilter/urlfilter or webfilter/content.
//
// These tables are keyed by a NUMBER the author picks, so raw CLI that says `edit 1` on a table id
// that already exists silently OVERWRITES that table (its name and every entry). The AI is given
// this list so it never re-uses a live id. (The structured create path is immune — it resolves the
// table by name via ensureWebfilterTable — but the chat's "Apply" button deploys the CLI verbatim.)
func (f *FortiClient) GetWebfilterTableIDs(kind string) []int {
	resp, err := f.do("GET", "/api/v2/cmdb/webfilter/"+kind+"?fields=id,name", nil)
	if err != nil {
		return nil
	}
	var rows []struct {
		ID int `json:"id"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	sort.Ints(ids)
	return ids
}

// normalizeURLFilterEntries makes a Static URL Filter list actually do what it says, because the
// entry TYPE decides what matches and the two get mixed up constantly:
//
//   - simple   → exact host match. "youtube.com" blocks youtube.com and its paths, NOT www.youtube.com.
//   - wildcard → a PATTERN; it only means anything if it contains "*". "*.youtube.com" catches every
//     subdomain but NOT the bare youtube.com.
//   - regex    → left untouched.
//
// So a wildcard entry with no "*" is silently just an exact match — the commonest way a "block
// YouTube" rule ends up letting www.youtube.com straight through. Two repairs, both idempotent:
//  1. a wildcard entry with no "*" becomes "*.<host>";
//  2. a blocking "*.<host>" gains a matching simple "<host>" entry, so the apex is covered too.
//
// Exported so the wizard/parser can show the user exactly what will be written.
func normalizeURLFilterEntries(list []WebFilterURLEntry) []WebFilterURLEntry {
	out := make([]WebFilterURLEntry, 0, len(list)*2)
	seen := map[string]bool{} // url|type — a table cannot hold the same pattern twice
	push := func(e WebFilterURLEntry) {
		key := strings.ToLower(e.URL) + "|" + strings.ToLower(e.Type)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, e)
	}

	for _, e := range list {
		e.URL = strings.TrimSpace(e.URL)
		if e.URL == "" {
			continue
		}
		e.Type = defaultStr(e.Type, "simple")
		e.Action = defaultStr(e.Action, "block")
		e.Status = defaultStr(e.Status, "enable")

		if strings.EqualFold(e.Type, "wildcard") && !strings.Contains(e.URL, "*") {
			log.Printf("[fortigate] url filter: wildcard entry %q has no wildcard — rewriting to %q so it matches subdomains",
				e.URL, "*."+e.URL)
			e.URL = "*." + e.URL
		}
		push(e)
	}

	// Apex companion for every blocking "*.<host>" wildcard (that pattern does not match the bare host).
	for _, e := range append([]WebFilterURLEntry(nil), out...) {
		if !strings.EqualFold(e.Type, "wildcard") || !strings.EqualFold(e.Action, "block") {
			continue
		}
		host := strings.TrimPrefix(e.URL, "*.")
		if host == e.URL || host == "" || strings.Contains(host, "*") {
			continue // not the "*.<host>" shape (e.g. "*youtube.com*") — leave it alone
		}
		if seen[strings.ToLower(host)+"|simple"] {
			continue
		}
		log.Printf("[fortigate] url filter: adding apex entry %q (simple) — %q alone does not match the bare domain",
			host, e.URL)
		push(WebFilterURLEntry{URL: host, Type: "simple", Action: e.Action, Status: e.Status})
	}
	return out
}

// buildURLFilterEntries / buildContentFilterEntries map our form rows to the CMDB entry shape
// (skipping blank rows). Verified live: urlfilter entries key on an auto-assigned int id;
// content entries key on "name" (the pattern text) and carry a numeric score (GUI default 10).
func buildURLFilterEntries(list []WebFilterURLEntry) []map[string]interface{} {
	list = normalizeURLFilterEntries(list)
	out := make([]map[string]interface{}, 0, len(list))
	for _, e := range list {
		out = append(out, map[string]interface{}{
			"url":    e.URL,
			"type":   e.Type,
			"action": e.Action,
			"status": e.Status,
		})
	}
	return out
}

func buildContentFilterEntries(list []WebFilterContentEntry) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(list))
	for _, e := range list {
		if strings.TrimSpace(e.Pattern) == "" {
			continue
		}
		score := e.Score
		if score <= 0 {
			score = 10
		}
		out = append(out, map[string]interface{}{
			"name":         e.Pattern,
			"pattern-type": defaultStr(e.PatternType, "wildcard"),
			"lang":         defaultStr(e.Lang, "western"),
			"action":       defaultStr(e.Action, "block"),
			"status":       defaultStr(e.Status, "enable"),
			"score":        score,
		})
	}
	return out
}

// fgFlagField renders a FortiOS multi-option ("flag") field: the space-joined flag string, or
// JSON null when no flag is set.
//
// ⚠️ On FortiOS 7.2.10 a non-empty space-separated string REPLACES the flag set, but an empty
// string "" is SILENTLY IGNORED (HTTP 200, no change) and a JSON array errors (-651). The only
// value that clears every flag is JSON null. Verified live for both webfilter ftgd-wf.options
// and dnsfilter ftgd-dns.options: PUT {"options":""} read back unchanged, PUT {"options":null}
// read back empty.
func fgFlagField(flags []string) interface{} {
	if len(flags) == 0 {
		return nil
	}
	return strings.Join(flags, " ")
}

func defaultStr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// webFilterProfilePayload builds the nested FortiGate CMDB JSON body for POST/PUT
// webfilter/profile from our simplified form. Every field is sent explicitly (no
// omitempty) so an update can turn a previously-enabled option back off. It resolves the
// URL Filter / Content Filter table references on demand, so it needs the live client.
//
// feature-set is intentionally NOT sent: the verified probe omitted it and every field
// round-tripped correctly, and the device's own default profiles are already flow-based.
//
// ⚠️ Clearing multi-option flag fields: see fgFlagField — the three flag fields below
// (options, ovrd-perm, ftgd-wf.options) must go through it.
func (f *FortiClient) webFilterProfilePayload(form WebFilterProfileForm) (map[string]interface{}, error) {
	flagField := fgFlagField

	// Top-level multi-flag "options" (space-separated).
	var opts []string
	if form.BlockInvalidURLs {
		opts = append(opts, "block-invalid-url")
	}
	if form.RemoveCookies {
		opts = append(opts, "cookiefilter")
	}

	// FortiGuard "ftgd-wf.options" multi-flag. "ftgd-disable" turns the whole category-based
	// filter OFF, so it is present precisely when the master toggle is off.
	var fopts []string
	if !form.FortiGuardCategoryFilter {
		fopts = append(fopts, "ftgd-disable")
	}
	if form.AllowRatingError {
		fopts = append(fopts, "error-allow")
	}
	if form.RateByDomainAndIP {
		fopts = append(fopts, "rate-server-ip")
	}

	postAction := "normal"
	if strings.EqualFold(form.HTTPPostAction, "block") {
		postAction = "block"
	}

	urlfID, bwordID := 0, 0
	if form.URLFilter {
		id, err := f.ensureWebfilterTable("urlfilter", form.Name, buildURLFilterEntries(form.URLFilterEntries))
		if err != nil {
			return nil, fmt.Errorf("URL Filter table: %w", err)
		}
		urlfID = id
	}
	if form.ContentFilter {
		id, err := f.ensureWebfilterTable("content", form.Name, buildContentFilterEntries(form.ContentFilterEntries))
		if err != nil {
			return nil, fmt.Errorf("could not build the Content Filter table: %w", err)
		}
		bwordID = id
	}

	var ovrd []string
	if form.AllowOverride {
		ovrd = append(ovrd, "fortiguard-wf-override")
	}

	// FortiGuard category tree → ftgd-wf.filters. Only non-"allow" categories get an entry
	// (a category with no entry is allowed); ids are auto-assigned by the device. Sent as an
	// empty array — not null — when every category is allowed, so an update clears old entries.
	filters := make([]map[string]interface{}, 0, len(form.Categories))
	for _, c := range form.Categories {
		act := strings.ToLower(strings.TrimSpace(c.Action))
		if act == "" || act == "allow" {
			continue
		}
		entry := map[string]interface{}{
			"category": c.Category,
			"action":   act,
			"log":      "enable",
		}
		switch act {
		case "warning":
			// "warning" needs a re-prompt window; mirror the device's own default of 5 minutes.
			entry["warning-duration-type"] = "timeout"
			entry["warn-duration"] = "5m"
		case "authenticate":
			// FortiOS rejects an "authenticate" filter with no user group (-149) and then discards
			// every entry after it — fail loudly here instead of writing a half-applied profile.
			if len(c.AuthGroups) == 0 {
				return nil, fmt.Errorf("category %d: action \"authenticate\" requires at least one user group", c.Category)
			}
			entry["auth-usr-grp"] = NamesToFGNames(c.AuthGroups)
			entry["warning-duration-type"] = "timeout"
			entry["warn-duration"] = "5m"
		}
		filters = append(filters, entry)
	}

	ftgdWF := map[string]interface{}{
		"options": flagField(fopts),
		"filters": filters,
	}

	payload := map[string]interface{}{
		"name":        form.Name,
		"comment":     form.Comment,
		"options":     flagField(opts),
		"post-action": postAction,
		"ovrd-perm":   flagField(ovrd),
		"web": map[string]interface{}{
			"blocklist":       FGBoolToString(form.BlockMaliciousFortiSandbox),
			"urlfilter-table": urlfID,
			"bword-table":     bwordID,
		},
		"ftgd-wf":  ftgdWF,
		"override": webFilterOverridePayload(form.Override),
	}
	return payload, nil
}

// webFilterOverridePayload builds the "override" sub-object. Duration days/hours/minutes are
// composed into FortiGate's "<d>d<h>h<m>m" duration string (verified accepted live). User
// groups and profiles are name-reference tables.
func webFilterOverridePayload(o WebFilterOverride) map[string]interface{} {
	scope := strings.ToLower(strings.TrimSpace(o.Scope))
	if scope == "" {
		scope = "user"
	}
	durMode := "constant" // GUI "Predefined"
	if strings.EqualFold(o.DurationMode, "ask") {
		durMode = "ask"
	}
	dur := fmt.Sprintf("%dd%dh%dm", o.DurationDays, o.DurationHours, o.DurationMins)

	return map[string]interface{}{
		"ovrd-scope":      scope,
		"ovrd-dur-mode":   durMode,
		"ovrd-dur":        dur,
		"profile-type":    "list",
		"ovrd-user-group": NamesToFGNames(o.Groups),
		"profile":         NamesToFGNames(o.Profiles),
	}
}

// fgToWebFilterProfileForm parses one webfilter/profile CMDB object into our simplified
// form, tolerant of missing sub-tables. Multi-flag "options" strings are space-separated
// lists of flags (verified live), so membership is tested by scanning the fields.
func fgToWebFilterProfileForm(raw json.RawMessage) WebFilterProfileForm {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return WebFilterProfileForm{}
	}
	getString := func(src map[string]json.RawMessage, key string) string {
		if src == nil {
			return ""
		}
		if v, ok := src[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getInt := func(src map[string]json.RawMessage, key string) int {
		if src == nil {
			return 0
		}
		if v, ok := src[key]; ok {
			var n int
			json.Unmarshal(v, &n) //nolint:errcheck
			return n
		}
		return 0
	}
	getSub := func(key string) map[string]json.RawMessage {
		if v, ok := m[key]; ok {
			var sub map[string]json.RawMessage
			if json.Unmarshal(v, &sub) == nil {
				return sub
			}
		}
		return nil
	}
	hasFlag := func(field, flag string) bool {
		for _, f := range strings.Fields(field) {
			if f == flag {
				return true
			}
		}
		return false
	}

	web := getSub("web")
	ftgd := getSub("ftgd-wf")
	options := getString(m, "options")
	ftgdOptions := getString(ftgd, "options")

	postAction := "allow"
	if strings.EqualFold(getString(m, "post-action"), "block") {
		postAction = "block"
	}

	// FortiGuard category actions from ftgd-wf.filters (only non-allow categories are stored).
	// auth-usr-grp comes back as a name-reference table and must round-trip, or re-saving an
	// "authenticate" category would drop its groups and fail with -149.
	var categories []WebFilterCategoryAction
	if ftgd != nil {
		if raw, ok := ftgd["filters"]; ok {
			var entries []struct {
				Category   int      `json:"category"`
				Action     string   `json:"action"`
				AuthUsrGrp []FGName `json:"auth-usr-grp"`
			}
			if json.Unmarshal(raw, &entries) == nil {
				for _, e := range entries {
					categories = append(categories, WebFilterCategoryAction{
						Category:   e.Category,
						Action:     e.Action,
						AuthGroups: FGNamesToStrings(e.AuthUsrGrp),
					})
				}
			}
		}
	}

	return WebFilterProfileForm{
		Name:    getString(m, "name"),
		Comment: getString(m, "comment"),

		FortiGuardCategoryFilter: !hasFlag(ftgdOptions, "ftgd-disable"),
		AllowOverride:            hasFlag(getString(m, "ovrd-perm"), "fortiguard-wf-override"),

		BlockInvalidURLs:           hasFlag(options, "block-invalid-url"),
		URLFilter:                  getInt(web, "urlfilter-table") != 0,
		BlockMaliciousFortiSandbox: FGStringToBool(getString(web, "blocklist")),
		ContentFilter:              getInt(web, "bword-table") != 0,

		AllowRatingError:  hasFlag(ftgdOptions, "error-allow"),
		RateByDomainAndIP: hasFlag(ftgdOptions, "rate-server-ip"),

		HTTPPostAction: postAction,
		RemoveCookies:  hasFlag(options, "cookiefilter"),

		Categories: categories,
		Override:   parseWebFilterOverride(getSub("override")),
	}
}

// parseWebFilterOverride reads the "override" sub-object back into our form shape.
func parseWebFilterOverride(ov map[string]json.RawMessage) WebFilterOverride {
	if ov == nil {
		return WebFilterOverride{Scope: "user", DurationMode: "predefined", DurationMins: 15}
	}
	str := func(key string) string {
		if v, ok := ov[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	names := func(key string) []string {
		var rows []struct {
			Name string `json:"name"`
		}
		if v, ok := ov[key]; ok {
			json.Unmarshal(v, &rows) //nolint:errcheck
		}
		out := make([]string, 0, len(rows))
		for _, r := range rows {
			if r.Name != "" {
				out = append(out, r.Name)
			}
		}
		return out
	}

	scope := str("ovrd-scope")
	if scope == "" {
		scope = "user"
	}
	durMode := "predefined"
	if strings.EqualFold(str("ovrd-dur-mode"), "ask") {
		durMode = "ask"
	}
	d, h, mn := parseFGDuration(str("ovrd-dur"))

	return WebFilterOverride{
		Groups:        names("ovrd-user-group"),
		Profiles:      names("profile"),
		Scope:         scope,
		DurationMode:  durMode,
		DurationDays:  d,
		DurationHours: h,
		DurationMins:  mn,
	}
}

// parseFGDuration parses a FortiGate duration string like "15m", "1d2h30m", "3600" (seconds)
// into days/hours/minutes. Unknown/empty input defaults to 15 minutes (the device default).
func parseFGDuration(s string) (days, hours, mins int) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return 0, 0, 15
	}
	// Plain integer = seconds.
	if n, err := strconv.Atoi(s); err == nil {
		total := n / 60
		return total / 1440, (total % 1440) / 60, total % 60
	}
	num := 0
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			num = num*10 + int(r-'0')
		case r == 'd':
			days = num
			num = 0
		case r == 'h':
			hours = num
			num = 0
		case r == 'm':
			mins = num
			num = 0
		case r == 's':
			num = 0 // ignore trailing seconds
		}
	}
	return days, hours, mins
}

// GetWebFilterProfile fetches a single webfilter/profile object by name for the edit form.
func (f *FortiClient) GetWebFilterProfile(name string) (WebFilterProfileForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/webfilter/profile/"+url.PathEscape(name), nil)
	if err != nil {
		return WebFilterProfileForm{}, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return WebFilterProfileForm{}, fmt.Errorf("web filter profile %q not found", name)
	}
	log.Printf("[fortigate] GET webfilter/profile/%s raw=%s", name, items[0])
	form := fgToWebFilterProfileForm(items[0])

	// The URL/Content filter rows live in the referenced tables, not the profile — fetch them
	// so the edit form can show them. Table ids come straight from the raw web{} sub-object.
	urlfID, bwordID := webfilterTableIDs(items[0])
	if form.URLFilter && urlfID != 0 {
		form.URLFilterEntries = f.getURLFilterEntries(urlfID)
	}
	if form.ContentFilter && bwordID != 0 {
		form.ContentFilterEntries = f.getContentFilterEntries(bwordID)
	}

	log.Printf("[fortigate] GET webfilter/profile/%s parsed=%+v", name, form)
	return form, nil
}

// webfilterTableIDs pulls web.urlfilter-table and web.bword-table out of a raw profile object.
func webfilterTableIDs(raw json.RawMessage) (urlfID, bwordID int) {
	var m struct {
		Web struct {
			URLFilterTable int `json:"urlfilter-table"`
			BWordTable     int `json:"bword-table"`
		} `json:"web"`
	}
	json.Unmarshal(raw, &m) //nolint:errcheck
	return m.Web.URLFilterTable, m.Web.BWordTable
}

// getURLFilterEntries reads back the rows of a webfilter/urlfilter table by id.
func (f *FortiClient) getURLFilterEntries(id int) []WebFilterURLEntry {
	resp, err := f.do("GET", "/api/v2/cmdb/webfilter/urlfilter/"+strconv.Itoa(id), nil)
	if err != nil {
		return nil
	}
	var items []struct {
		Entries []struct {
			URL    string `json:"url"`
			Type   string `json:"type"`
			Action string `json:"action"`
			Status string `json:"status"`
		} `json:"entries"`
	}
	if json.Unmarshal(resp.Results, &items) != nil || len(items) == 0 {
		return nil
	}
	out := make([]WebFilterURLEntry, 0, len(items[0].Entries))
	for _, e := range items[0].Entries {
		out = append(out, WebFilterURLEntry{URL: e.URL, Type: e.Type, Action: e.Action, Status: e.Status})
	}
	return out
}

// getContentFilterEntries reads back the rows of a webfilter/content table by id.
func (f *FortiClient) getContentFilterEntries(id int) []WebFilterContentEntry {
	resp, err := f.do("GET", "/api/v2/cmdb/webfilter/content/"+strconv.Itoa(id), nil)
	if err != nil {
		return nil
	}
	var items []struct {
		Entries []struct {
			Name        string `json:"name"`
			PatternType string `json:"pattern-type"`
			Lang        string `json:"lang"`
			Action      string `json:"action"`
			Status      string `json:"status"`
			Score       int    `json:"score"`
		} `json:"entries"`
	}
	if json.Unmarshal(resp.Results, &items) != nil || len(items) == 0 {
		return nil
	}
	out := make([]WebFilterContentEntry, 0, len(items[0].Entries))
	for _, e := range items[0].Entries {
		out = append(out, WebFilterContentEntry{
			Pattern: e.Name, PatternType: e.PatternType, Lang: e.Lang,
			Action: e.Action, Status: e.Status, Score: e.Score,
		})
	}
	return out
}

// CreateWebFilterProfile creates a new webfilter/profile object on the device.
// writeWebFilterProfile builds one form into a device payload and sends it, logging it the same
// way every webfilter write already does. Split out so Create/Update can each send it twice when
// the override-duration trap below applies.
func (f *FortiClient) writeWebFilterProfile(method, path string, form WebFilterProfileForm) error {
	payload, err := f.webFilterProfilePayload(form)
	if err != nil {
		return err
	}
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] %s %s payload=%s", method, path, b)
	}
	_, err = f.do(method, path, payload)
	return err
}

func (f *FortiClient) CreateWebFilterProfile(form WebFilterProfileForm) error {
	const path = "/api/v2/cmdb/webfilter/profile"
	if !form.AllowOverride {
		return f.writeWebFilterProfile("POST", path, form)
	}
	// See UpdateWebFilterProfile's comment on the override-duration trap. For a brand-new object
	// there is nothing yet to collide with, so creating it with override off first is
	// unconditionally safe; override is then turned on in a second write, by which point the
	// duration this create asked for already matches what the first write just stored.
	safe := form
	safe.AllowOverride = false
	if err := f.writeWebFilterProfile("POST", path, safe); err != nil {
		return err
	}
	return f.writeWebFilterProfile("PUT", path+"/"+url.PathEscape(form.Name), form)
}

// UpdateWebFilterProfile overwrites an existing webfilter/profile object by name.
//
// Found live: FortiOS refuses a write (-56) that both enables `ovrd-perm`'s override flag AND sets
// `ovrd-dur` to anything other than the duration already stored on the device — it is not "only
// 15 minutes works" (the symptom that made it look that way: 15m is FortiOS's own factory default,
// so a brand-new object's stored value already happens to match it). The fix is the device's own
// accepted workaround, proven live: write the new duration first with override OFF (always
// accepted, since the conflicting flag is off), then turn override on in a second write, at which
// point the stored duration already matches what the first write set.
func (f *FortiClient) UpdateWebFilterProfile(name string, form WebFilterProfileForm) error {
	path := "/api/v2/cmdb/webfilter/profile/" + url.PathEscape(name)
	if !form.AllowOverride {
		return f.writeWebFilterProfile("PUT", path, form)
	}
	safe := form
	safe.AllowOverride = false
	if err := f.writeWebFilterProfile("PUT", path, safe); err != nil {
		return err
	}
	return f.writeWebFilterProfile("PUT", path, form)
}

// ── Web Filter metadata (FortiGuard category tree + form pickers) ─────────────
//
// WebFilterMetadata is everything the "New Web Filter Profile" page needs to render the
// FortiGuard Category Based Filter tree and the override sub-form, fetched live so category
// names/groupings track the device's own FortiGuard package.
type WebFilterMetadata struct {
	Categories        []FGWebFilterCategory `json:"categories"`          // FortiGuard categories (id, name, group, rating…)
	LocalCategories   []FGWebFilterCategory `json:"local_categories"`    // user-defined ftgd-local-cat entries
	WebFilterLicensed bool                  `json:"web_filter_licensed"` // FortiGuard web-filtering subscription active?
	UserGroups        []string              `json:"user_groups"`         // for "Groups that can override"
	Profiles          []string              `json:"profiles"`            // other webfilter profiles, for "Profile Name"
}

// FGWebFilterCategory is one row of the FortiGuard category taxonomy (or a local category).
type FGWebFilterCategory struct {
	ID               int      `json:"id"`
	Name             string   `json:"name"`
	Group            string   `json:"group"`
	GroupID          int      `json:"group_id"`
	Rating           string   `json:"rating,omitempty"`             // G | PG-13 | R
	DefaultAction    string   `json:"default_action,omitempty"`     // monitor | block | warning | allow
	BlockedInRatings []string `json:"blocked_in_ratings,omitempty"` // which presets block it: subset of [G, PG-13, R]
}

// fortiguardCategories fetches the FortiGuard category taxonomy — the exact list the device's
// own GUI renders, including each category's rating and which presets (G / PG-13 / R) block it.
// Shared by the Web Filter and DNS Filter forms: both filter on the SAME taxonomy (verified
// live — 93 categories in 7 groups on FortiGate 7.2.10). Best-effort: an error returns nil.
// fortiguardCategories returns the device's FortiGuard category tree.
//
// Cached per device (see fortigate_cache.go): the taxonomy ships with the firmware and neither the
// GUI nor this app can change it, yet it was re-fetched every time anyone opened a Web Filter or
// DNS Filter form — the largest single read either of those makes.
func (f *FortiClient) fortiguardCategories() []FGWebFilterCategory {
	return cachedSlice(fgCategoryCache, f.BaseURL, f.fetchFortiguardCategories)
}

func (f *FortiClient) fetchFortiguardCategories() []FGWebFilterCategory {
	resp, err := f.do("GET", "/api/v2/monitor/webfilter/fortiguard-categories?include_unrated=true", nil)
	if err != nil {
		return nil
	}
	var rows []struct {
		ID               int      `json:"id"`
		Name             string   `json:"name"`
		Group            string   `json:"group"`
		GroupID          int      `json:"group_id"`
		Rating           string   `json:"rating"`
		DefaultWFAction  string   `json:"default_wf_action"`
		BlockedInRatings []string `json:"blocked_in_ratings"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	out := make([]FGWebFilterCategory, 0, len(rows))
	for _, r := range rows {
		out = append(out, FGWebFilterCategory{
			ID: r.ID, Name: r.Name, Group: r.Group, GroupID: r.GroupID,
			Rating: r.Rating, DefaultAction: r.DefaultWFAction, BlockedInRatings: r.BlockedInRatings,
		})
	}
	return out
}

// licenseStatuses fetches monitor/license/status ONCE and reports, per service key
// ("antivirus", "web_filtering", "botnet_domain", …), whether its subscription is active.
// A missing/empty status, "expired", "no_license" and "not_supported" all count as inactive —
// the same rule the GUI uses to grey a feature out. Best-effort: an error returns nil, and a
// nil map reports every service inactive (fail-closed).
// licenseStatuses reports which FortiGuard services this device has a live contract for.
//
// Cached briefly (licenceTTL): a contract really can be activated mid-session and the user expects
// the "not licensed" banner to clear, so this is minutes rather than the half hour the firmware
// data gets.
func (f *FortiClient) licenseStatuses() map[string]bool {
	return cachedMap(fgLicenceCache, f.BaseURL, f.fetchLicenseStatuses)
}

func (f *FortiClient) fetchLicenseStatuses() map[string]bool {
	resp, err := f.do("GET", "/api/v2/monitor/license/status", nil)
	if err != nil {
		return nil
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &m) != nil {
		return nil
	}
	out := make(map[string]bool, len(m))
	for service, raw := range m {
		var v struct {
			Status string `json:"status"`
		}
		json.Unmarshal(raw, &v) //nolint:errcheck
		s := strings.ToLower(v.Status)
		out[service] = s != "" && s != "expired" && s != "no_license" && s != "not_supported"
	}
	return out
}

// GetWebFilterMetadata gathers the FortiGuard category taxonomy plus the form's picker lists.
// Each probe is best-effort: a failure leaves that slice empty rather than failing the page.
// GetWebFilterMetadata gathers everything the Web Filter form's pickers need.
//
// Five independent reads, issued together — nothing here feeds anything else. Two of them
// (categories, licence) come from the caches in fortigate_cache.go, so on a warm cache this is
// three device calls in parallel instead of five in sequence.
//
// The three that are NOT cached are the ones a user can change: local categories, user groups and
// the other profiles on the box. Those must be live, or the form would fail to offer an object
// that was created seconds earlier.
func (f *FortiClient) GetWebFilterMetadata(selfProfile string) WebFilterMetadata {
	meta := WebFilterMetadata{WebFilterLicensed: false}

	Parallel(
		func() { meta.Categories = f.fortiguardCategories() },

		// FortiGuard web-filtering licence → drives the "not licensed" warning banner.
		func() { meta.WebFilterLicensed = f.licenseStatuses()["web_filtering"] },

		// Local (custom) categories → shown as the "Local Categories" group.
		func() {
			resp, err := f.do("GET", "/api/v2/cmdb/webfilter/ftgd-local-cat?fields=id,desc", nil)
			if err != nil {
				return
			}
			var rows []struct {
				ID   json.Number `json:"id"`
				Desc string      `json:"desc"`
			}
			if json.Unmarshal(resp.Results, &rows) != nil {
				return
			}
			for _, r := range rows {
				id, _ := strconv.Atoi(r.ID.String())
				meta.LocalCategories = append(meta.LocalCategories, FGWebFilterCategory{
					ID: id, Name: r.Desc, Group: "Local Categories", GroupID: 0, DefaultAction: "allow",
				})
			}
		},

		// User groups → "Groups that can override".
		func() {
			resp, err := f.do("GET", "/api/v2/cmdb/user/group?fields=name", nil)
			if err != nil {
				return
			}
			var rows []FGName
			if json.Unmarshal(resp.Results, &rows) != nil {
				return
			}
			for _, r := range rows {
				meta.UserGroups = append(meta.UserGroups, r.Name)
			}
		},

		// Other webfilter profiles → "Profile Name" the user can switch to (exclude self).
		func() {
			resp, err := f.do("GET", "/api/v2/cmdb/webfilter/profile?fields=name", nil)
			if err != nil {
				return
			}
			var rows []FGName
			if json.Unmarshal(resp.Results, &rows) != nil {
				return
			}
			for _, r := range rows {
				if r.Name != selfProfile && !hiddenSecurityProfileNames[r.Name] {
					meta.Profiles = append(meta.Profiles, r.Name)
				}
			}
		},
	)

	return meta
}

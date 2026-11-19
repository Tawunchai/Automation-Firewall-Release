package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var applicationListTable = cmdbPath{path: "application/list", noun: "application sensor"}

// Application Control (application/list) — form mapping, the category/risk taxonomy, and the
// per-device signature database cache the AI Assistant and the form both read.
//
// Split out of fortigate.go verbatim.

// ── Application Control (Application Sensor) ──────────────────────────────────
//
// AppControlProfileForm is our simplified, GUI-shaped view of a FortiGate
// application/list object — one flat struct mirroring the FortiOS "New Application
// Sensor" page. appControlProfilePayload / fgToAppControlProfileForm convert to/from
// the real nested CMDB JSON. Every mapping below was verified live against a FortiGate
// 7.2.10 (FGT80E): create/update/delete round-trip cleanly.
//
// GUI → CMDB mapping:
//
//	Categories grid (per-category action)      → entries[] grouped by action (category ids)
//	Unknown Applications action                → unknown-application-action {pass|block} + unknown-application-log
//	Network Protocol Enforcement (master)      → control-default-network-services {enable|disable}
//	Network Protocol Enforcement table         → default-network-services[] {port, services, violation-action}
//	Application & Filter Overrides             → entries[] carrying application[]/filter attrs
//	Block applications on non-default ports    → enforce-default-app-port {enable|disable}
//	Allow and Log DNS Traffic                  → options: allow-dns
//	Replacement Messages for HTTP-based Apps   → app-replacemsg {enable|disable}
//
// Per-entry action encoding (verified live):
//
//	monitor    → action=pass,  log=enable
//	allow      → action=pass,  log=disable
//	block      → action=block, log=enable
//	quarantine → action=block, quarantine=attacker (+quarantine-expiry 5m, quarantine-log enable), log=enable
type AppControlProfileForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	// Categories grid — one {category id, action} per FortiGuard application category.
	Categories []AppCategoryAction `json:"categories"`
	// "Unknown Applications" tile action: monitor | allow | block.
	UnknownApplicationAction string `json:"unknown_application_action"`

	// Network Protocol Enforcement.
	NetworkProtocolEnforcement bool                `json:"network_protocol_enforcement"`
	NetworkServices            []AppNetworkService `json:"network_services"`

	// Application and Filter Overrides (ordered — index = GUI Priority).
	Overrides []AppOverride `json:"overrides"`

	// Options.
	BlockNonDefaultPorts bool `json:"block_non_default_ports"`
	AllowAndLogDNS       bool `json:"allow_and_log_dns"`
	ReplacementMessages  bool `json:"replacement_messages"`
}

// AppCategoryAction is one category tile in the grid and its chosen action.
type AppCategoryAction struct {
	Category int    `json:"category"`
	Action   string `json:"action"` // monitor | allow | block | quarantine
}

// AppNetworkService is one Network Protocol Enforcement row (default-network-services entry).
type AppNetworkService struct {
	ID              int      `json:"id"`
	Port            int      `json:"port"`
	Services        []string `json:"services"`         // http, ssh, telnet, ftp, dns, smtp, pop3, imap, snmp, nntp, https
	ViolationAction string   `json:"violation_action"` // monitor | block  (pass also accepted)
}

// AppSignatureRef is one specific application signature referenced by an Application override.
type AppSignatureRef struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// AppOverride is one row of the "Application and Filter Overrides" table. Type "application"
// uses Applications; type "filter" uses the filter attributes (category/risk/technology/…).
type AppOverride struct {
	Type   string `json:"type"`   // application | filter
	Action string `json:"action"` // monitor | allow | block | quarantine
	// application type
	Applications []AppSignatureRef `json:"applications"`
	// filter type
	Categories   []int    `json:"categories"`
	Risk         []int    `json:"risk"`       // 1..5
	Popularity   []int    `json:"popularity"` // 1..5
	Technologies []string `json:"technologies"`
	Behaviors    []string `json:"behaviors"`
	Protocols    []string `json:"protocols"`
	Vendors      []string `json:"vendors"`
}

// appEntryActionFields sets the action/log/quarantine fields on an entry map from our
// GUI action string. Kept in one place so category-grid entries and override entries
// encode identically.
func appEntryActionFields(entry map[string]interface{}, action string) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "allow":
		entry["action"] = "pass"
		entry["log"] = "disable"
	case "block":
		entry["action"] = "block"
		entry["log"] = "enable"
	case "quarantine":
		entry["action"] = "block"
		entry["log"] = "enable"
		entry["quarantine"] = "attacker"
		entry["quarantine-expiry"] = "5m"
		entry["quarantine-log"] = "enable"
	default: // "monitor"
		entry["action"] = "pass"
		entry["log"] = "enable"
	}
}

// appActionFromEntry reverses appEntryActionFields when reading an entry back.
func appActionFromEntry(action, log, quarantine string) string {
	if strings.EqualFold(quarantine, "attacker") {
		return "quarantine"
	}
	if strings.EqualFold(action, "block") || strings.EqualFold(action, "reset") {
		return "block"
	}
	// pass
	if strings.EqualFold(log, "disable") {
		return "allow"
	}
	return "monitor"
}

// appIDRefs converts []int → [{id:n}] for category/application reference tables, dropping
// duplicates (FortiGate rejects a reference table that repeats an id).
func appIDRefs(ids []int) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(ids))
	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, map[string]interface{}{"id": id})
	}
	return out
}

// appRiskRefs converts risk levels → [{level:n}] (the CMDB risk table shape).
func appRiskRefs(levels []int) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(levels))
	for _, l := range levels {
		out = append(out, map[string]interface{}{"level": l})
	}
	return out
}

// FortiOS stores an application filter's technology & behavior as numeric codes, not the
// display strings the GUI shows (verified live on 7.2.10: "Client-Server"→"2", "Botnet"→"2").
// These maps convert display name → code on write and code → name on read so the frontend
// only ever deals with the human-readable names the GUI shows.
var appTechnologyCodes = map[string]string{
	"Network-Protocol": "0", "Browser-Based": "1", "Client-Server": "2", "Peer-to-Peer": "4",
}
var appBehaviorCodes = map[string]string{
	"Botnet": "2", "Evasive": "3", "Excessive-Bandwidth": "5", "Tunneling": "6",
}

func reverseMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[v] = k
	}
	return out
}

var appTechnologyNames = reverseMap(appTechnologyCodes)
var appBehaviorNames = reverseMap(appBehaviorCodes)

// appCodedAttr maps display names → codes via lookup (unknown values pass through), joining
// into FortiGate's space-separated string; empty → "all".
func appCodedAttr(vals []string, codes map[string]string) string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if code, ok := codes[v]; ok {
			out = append(out, code)
		} else {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return "all"
	}
	return strings.Join(out, " ")
}

// appDecodeAttr maps stored codes → display names (unknown codes pass through), dropping "all".
func appDecodeAttr(v string, names map[string]string) []string {
	if v == "" || strings.EqualFold(strings.TrimSpace(v), "all") {
		return nil
	}
	out := make([]string, 0)
	for _, code := range strings.Fields(v) {
		if name, ok := names[code]; ok {
			out = append(out, name)
		} else {
			out = append(out, code)
		}
	}
	return out
}

// appFilterAttr joins a plain (uncoded) multi-value filter attribute (protocols/vendor)
// into FortiGate's space-separated string, defaulting to "all" when none selected.
func appFilterAttr(vals []string) string {
	clean := make([]string, 0, len(vals))
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			clean = append(clean, strings.TrimSpace(v))
		}
	}
	if len(clean) == 0 {
		return "all"
	}
	return strings.Join(clean, " ")
}

// appPopularityStr joins popularity levels into "1 2 …"; empty → all levels (the default).
func appPopularityStr(levels []int) string {
	if len(levels) == 0 {
		return "1 2 3 4 5"
	}
	parts := make([]string, 0, len(levels))
	for _, l := range levels {
		parts = append(parts, strconv.Itoa(l))
	}
	return strings.Join(parts, " ")
}

// appControlProfilePayload builds the nested application/list CMDB body from our form.
// Override entries are placed FIRST (higher priority), then the category-grid entries —
// matching how the GUI's "Application and Filter Overrides" take precedence over the grid.
func appControlProfilePayload(form AppControlProfileForm) map[string]interface{} {
	entries := make([]map[string]interface{}, 0, len(form.Overrides)+4)

	// 1) Overrides first (GUI Priority order).
	for _, o := range form.Overrides {
		entry := map[string]interface{}{}
		appEntryActionFields(entry, o.Action)
		if strings.EqualFold(o.Type, "application") {
			ids := make([]int, 0, len(o.Applications))
			for _, a := range o.Applications {
				ids = append(ids, a.ID)
			}
			if len(ids) == 0 {
				continue // nothing selected — skip empty override
			}
			entry["application"] = appIDRefs(ids)
		} else { // filter
			entry["category"] = appIDRefs(o.Categories)
			entry["risk"] = appRiskRefs(o.Risk)
			entry["popularity"] = appPopularityStr(o.Popularity)
			entry["technology"] = appCodedAttr(o.Technologies, appTechnologyCodes)
			entry["behavior"] = appCodedAttr(o.Behaviors, appBehaviorCodes)
			entry["protocols"] = appFilterAttr(o.Protocols)
			entry["vendor"] = appFilterAttr(o.Vendors)
		}
		entries = append(entries, entry)
	}

	// 2) Category grid — group category ids by action into one entry per distinct action.
	byAction := map[string][]int{}
	order := []string{}
	for _, c := range form.Categories {
		act := strings.ToLower(strings.TrimSpace(c.Action))
		if act == "" {
			act = "monitor"
		}
		if _, seen := byAction[act]; !seen {
			order = append(order, act)
		}
		byAction[act] = append(byAction[act], c.Category)
	}
	for _, act := range order {
		entry := map[string]interface{}{"category": appIDRefs(byAction[act])}
		appEntryActionFields(entry, act)
		entries = append(entries, entry)
	}

	// Unknown Applications tile → unknown-application-action (+log).
	unkAction, unkLog := "pass", "disable"
	switch strings.ToLower(strings.TrimSpace(form.UnknownApplicationAction)) {
	case "block":
		unkAction, unkLog = "block", "enable"
	case "monitor":
		unkAction, unkLog = "pass", "enable"
	default: // allow
		unkAction, unkLog = "pass", "disable"
	}

	// Network Protocol Enforcement rows.
	nps := make([]map[string]interface{}, 0, len(form.NetworkServices))
	for i, s := range form.NetworkServices {
		if s.Port <= 0 {
			continue
		}
		va := strings.ToLower(strings.TrimSpace(s.ViolationAction))
		if va == "" {
			va = "block"
		}
		nps = append(nps, map[string]interface{}{
			"id":               i + 1,
			"port":             s.Port,
			"services":         strings.Join(s.Services, " "),
			"violation-action": va,
		})
	}

	payload := map[string]interface{}{
		"name":                             form.Name,
		"comment":                          form.Comment,
		"entries":                          entries,
		"other-application-action":         "pass",
		"other-application-log":            "enable",
		"unknown-application-action":       unkAction,
		"unknown-application-log":          unkLog,
		"enforce-default-app-port":         FGBoolToString(form.BlockNonDefaultPorts),
		"app-replacemsg":                   FGBoolToString(form.ReplacementMessages),
		"deep-app-inspection":              "enable",
		"options":                          appOptionsFlag(form.AllowAndLogDNS),
		"control-default-network-services": FGBoolToString(form.NetworkProtocolEnforcement),
		"default-network-services":         nps,
	}
	return payload
}

// appOptionsFlag builds the top-level "options" multi-flag. Only "allow-dns" is surfaced in
// the GUI ("Allow and Log DNS Traffic"). Like every FortiOS multi-flag field, an empty string
// is SILENTLY IGNORED on PUT — the only value that clears the flag is JSON null — so this
// returns nil when the toggle is off (verified live: without it, turning DNS off left it on).
func appOptionsFlag(allowDNS bool) interface{} {
	if allowDNS {
		return "allow-dns"
	}
	return nil
}

// fgToAppControlProfileForm parses one application/list CMDB object into our form.
func fgToAppControlProfileForm(raw json.RawMessage) AppControlProfileForm {
	var obj struct {
		Name                     string `json:"name"`
		Comment                  string `json:"comment"`
		UnknownApplicationAction string `json:"unknown-application-action"`
		UnknownApplicationLog    string `json:"unknown-application-log"`
		EnforceDefaultAppPort    string `json:"enforce-default-app-port"`
		AppReplacemsg            string `json:"app-replacemsg"`
		Options                  string `json:"options"`
		ControlDefaultNetSvc     string `json:"control-default-network-services"`
		Entries                  []struct {
			Category []struct {
				ID int `json:"id"`
			} `json:"category"`
			Application []struct {
				ID int `json:"id"`
			} `json:"application"`
			Risk []struct {
				Level int `json:"level"`
			} `json:"risk"`
			Protocols  string `json:"protocols"`
			Vendor     string `json:"vendor"`
			Technology string `json:"technology"`
			Behavior   string `json:"behavior"`
			Popularity string `json:"popularity"`
			Action     string `json:"action"`
			Log        string `json:"log"`
			Quarantine string `json:"quarantine"`
		} `json:"entries"`
		DefaultNetworkServices []struct {
			Port            int    `json:"port"`
			Services        string `json:"services"`
			ViolationAction string `json:"violation-action"`
		} `json:"default-network-services"`
	}
	if json.Unmarshal(raw, &obj) != nil {
		return AppControlProfileForm{}
	}

	form := AppControlProfileForm{
		Name:                       obj.Name,
		Comment:                    obj.Comment,
		BlockNonDefaultPorts:       FGStringToBool(obj.EnforceDefaultAppPort),
		ReplacementMessages:        FGStringToBool(obj.AppReplacemsg),
		AllowAndLogDNS:             strings.Contains(obj.Options, "allow-dns"),
		NetworkProtocolEnforcement: FGStringToBool(obj.ControlDefaultNetSvc),
	}

	// Unknown Applications tile.
	switch {
	case strings.EqualFold(obj.UnknownApplicationAction, "block"):
		form.UnknownApplicationAction = "block"
	case FGStringToBool(obj.UnknownApplicationLog):
		form.UnknownApplicationAction = "monitor"
	default:
		form.UnknownApplicationAction = "allow"
	}

	defaultPop := func(p string) bool {
		f := strings.Fields(p)
		return len(f) == 0 || len(f) == 5
	}
	isDefaultAttr := func(v string) bool { return v == "" || strings.EqualFold(v, "all") }

	for _, e := range obj.Entries {
		action := appActionFromEntry(e.Action, e.Log, e.Quarantine)
		hasApp := len(e.Application) > 0
		hasFilter := len(e.Risk) > 0 || !isDefaultAttr(e.Technology) || !isDefaultAttr(e.Behavior) ||
			!isDefaultAttr(e.Protocols) || !isDefaultAttr(e.Vendor) || !defaultPop(e.Popularity)

		switch {
		case hasApp:
			apps := make([]AppSignatureRef, 0, len(e.Application))
			for _, a := range e.Application {
				apps = append(apps, AppSignatureRef{ID: a.ID})
			}
			form.Overrides = append(form.Overrides, AppOverride{
				Type: "application", Action: action, Applications: apps,
			})
		case hasFilter:
			cats := make([]int, 0, len(e.Category))
			for _, c := range e.Category {
				cats = append(cats, c.ID)
			}
			risk := make([]int, 0, len(e.Risk))
			for _, r := range e.Risk {
				risk = append(risk, r.Level)
			}
			form.Overrides = append(form.Overrides, AppOverride{
				Type: "filter", Action: action, Categories: cats, Risk: risk,
				Popularity:   splitPopularity(e.Popularity),
				Technologies: appDecodeAttr(e.Technology, appTechnologyNames),
				Behaviors:    appDecodeAttr(e.Behavior, appBehaviorNames),
				Protocols:    splitAttr(e.Protocols), Vendors: splitAttr(e.Vendor),
			})
		default: // clean category-grid entry
			for _, c := range e.Category {
				form.Categories = append(form.Categories, AppCategoryAction{Category: c.ID, Action: action})
			}
		}
	}

	for _, s := range obj.DefaultNetworkServices {
		form.NetworkServices = append(form.NetworkServices, AppNetworkService{
			Port: s.Port, Services: strings.Fields(s.Services),
			ViolationAction: defaultStr(s.ViolationAction, "block"),
		})
	}
	return form
}

// splitAttr turns a space-separated filter attribute into a slice, dropping the "all" wildcard.
func splitAttr(v string) []string {
	if v == "" || strings.EqualFold(v, "all") {
		return nil
	}
	return strings.Fields(v)
}

// splitPopularity turns "1 2 3" into []int, treating the full 1-5 set as "no narrowing" (nil).
func splitPopularity(v string) []int {
	f := strings.Fields(v)
	if len(f) == 0 || len(f) == 5 {
		return nil
	}
	out := make([]int, 0, len(f))
	for _, s := range f {
		if n, err := strconv.Atoi(s); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// GetAppControlProfile fetches a single application/list object by name for the edit form.
func (f *FortiClient) GetAppControlProfile(name string) (AppControlProfileForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/application/list/"+url.PathEscape(name), nil)
	if err != nil {
		return AppControlProfileForm{}, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return AppControlProfileForm{}, fmt.Errorf("application sensor %q not found", name)
	}
	form := fgToAppControlProfileForm(items[0])
	log.Printf("[fortigate] GET application/list/%s parsed=%+v", name, form)
	return form, nil
}

// CreateAppControlProfile creates a new application/list object on the device.
func (f *FortiClient) CreateAppControlProfile(form AppControlProfileForm) error {
	payload := appControlProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST application/list payload=%s", b)
	}
	return applicationListTable.Create(f, payload)
}

// UpdateAppControlProfile overwrites an existing application/list object by name.
func (f *FortiClient) UpdateAppControlProfile(name string, form AppControlProfileForm) error {
	payload := appControlProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT application/list/%s payload=%s", name, b)
	}
	if err := applicationListTable.Update(f, name, payload); err != nil {
		return err
	}
	// The PUT above cannot empty the Network Protocol Enforcement table — see
	// clearAppNetworkServices. Any other row count the PUT already handled.
	if len(form.NetworkServices) == 0 {
		return f.clearAppNetworkServices(name)
	}
	return nil
}

// clearAppNetworkServices removes every default-network-services row from an application/list
// profile by deleting each child entry.
//
// FortiOS treats an EMPTY sub-table in a PUT body as "no instruction" rather than "make it empty",
// so {"default-network-services":[]} answers 200 with revision_changed:false and the old rows stay.
// A non-empty list is honoured normally (2 rows → 1 row replaces correctly), and null does not work
// either — all three verified live on FortiOS 7.2.10. Deleting the children individually is the
// only thing that actually empties it.
//
// The stakes: a leftover row is invisible in the GUI while Network Protocol Enforcement is off, but
// it comes back into force the moment someone turns the toggle on again.
func (f *FortiClient) clearAppNetworkServices(name string) error {
	ids, err := f.appNetworkServiceIDs(name)
	if err != nil {
		return err
	}
	for _, id := range ids {
		// A child table of ONE sensor, so the table is built per sensor — the row is still
		// named by its own mkey, which is what cmdbPath.Delete insists on.
		rows := cmdbPath{
			path: "application/list/" + url.PathEscape(name) + "/default-network-services",
			noun: "network protocol enforcement row",
		}
		if err := rows.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
			return fmt.Errorf("clear network protocol enforcement row %d: %w", id, err)
		}
	}
	return nil
}

// appNetworkServiceIDs reads the mkeys of a profile's default-network-services rows.
func (f *FortiClient) appNetworkServiceIDs(name string) ([]int, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/application/list/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var objs []struct {
		DefaultNetworkServices []struct {
			ID int `json:"id"`
		} `json:"default-network-services"`
	}
	if err := json.Unmarshal(resp.Results, &objs); err != nil || len(objs) == 0 {
		return nil, nil //nolint:nilerr // nothing to clear if the shape is unexpected
	}
	ids := make([]int, 0, len(objs[0].DefaultNetworkServices))
	for _, e := range objs[0].DefaultNetworkServices {
		ids = append(ids, e.ID)
	}
	return ids, nil
}

// ── Application Control metadata (category taxonomy + filter option values) ────
//
// AppControlMetadata is everything the "New Application Sensor" page needs beyond the
// profile itself: the FortiGuard application category taxonomy (for the Categories grid),
// the enumerable Filter-override attribute values, and any live application signatures.
type AppControlMetadata struct {
	Categories   []AppCategoryMeta  `json:"categories"`
	Applications []AppSignatureMeta `json:"applications"` // signature DB (live when available, else bundled catalog)
	Technologies []string           `json:"technologies"`
	Behaviors    []string           `json:"behaviors"`
	Protocols    []string           `json:"protocols"`
	Vendors      []string           `json:"vendors"`
	RiskLevels   []AppRiskLevel     `json:"risk_levels"`
	AppDBSource  string             `json:"app_db_source"` // "live" | "bundled" | "none"
}

// AppCategoryMeta is one FortiGuard application category tile (id + display name).
type AppCategoryMeta struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// AppRiskLevel is one selectable risk level (1..5) with its display label.
type AppRiskLevel struct {
	Level int    `json:"level"`
	Name  string `json:"name"`
}

// AppSignatureMeta is one application signature from the live database.
type AppSignatureMeta struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Category   int    `json:"category"`
	Technology string `json:"technology"`
	Popularity int    `json:"popularity"`
	Risk       int    `json:"risk"`
	Vendor     string `json:"vendor"`
}

// appControlCategories is a last-resort fallback for the application-control category
// taxonomy, used only if the live endpoint (GetApplicationCategories) is unreachable. The
// authoritative source is the device itself — /api/v2/monitor/utm/application-categories
// (the exact endpoint the FortiOS GUI calls; verified live). ⚠️ These fallback ids were once
// hard-guessed and several were WRONG (e.g. 15 is Network.Service, not Storage.Backup) — never
// trust them over the live list, since a wrong id blocks the wrong category.
var appControlCategories = []AppCategoryMeta{
	{2, "P2P"}, {3, "VoIP"}, {5, "Video/Audio"}, {6, "Proxy"}, {7, "Remote.Access"},
	{8, "Game"}, {12, "General.Interest"}, {15, "Network.Service"}, {17, "Update"},
	{21, "Email"}, {22, "Storage.Backup"}, {23, "Social.Media"}, {25, "Web.Client"},
	{26, "Industrial"}, {28, "Collaboration"}, {29, "Business"}, {30, "Cloud.IT"}, {31, "Mobile"},
}

// GetAppControlMetadata bundles the category taxonomy + Filter-override attribute values.
// Application signatures are fetched live when the device exposes them (empty otherwise).
func (f *FortiClient) GetAppControlMetadata() AppControlMetadata {
	meta := AppControlMetadata{
		Categories: f.getApplicationCategories(),
		// Enumerable Filter attributes shown by the FortiOS "Filter" override picker.
		Technologies: []string{"Browser-Based", "Client-Server", "Network-Protocol", "Peer-to-Peer"},
		Behaviors:    []string{"Botnet", "Evasive", "Excessive-Bandwidth", "Tunneling"},
		RiskLevels: []AppRiskLevel{
			{1, "Low"}, {2, "Elevated"}, {3, "Medium"}, {4, "High"}, {5, "Critical"},
		},
	}

	// Full application signature catalogue — the same list the FortiOS GUI shows in the
	// "Add New Override → Application" table. Read from the device's LOCAL application
	// database (/api/v2/cmdb/application/name), which ships in the firmware and is present on
	// every FortiGate, so the complete ~2,400-signature list comes back even on an unlicensed /
	// cloud-unreachable unit (verified live = 2,414 rows). See getApplicationSignatures.
	meta.Applications = f.getApplicationSignatures(meta.Categories)

	// Only if the device somehow returns no signatures at all do we leave the picker empty
	// ("none") and steer the user to a Filter override — we never ship fabricated signature ids,
	// since a made-up id would create a profile that silently matches nothing.
	if len(meta.Applications) == 0 {
		meta.AppDBSource = "none"
	} else {
		meta.AppDBSource = "live"
	}

	// Vendor picker options derived from the live signature set (empty when there is none).
	vendorSet := map[string]bool{}
	for _, a := range meta.Applications {
		if a.Vendor != "" {
			vendorSet[a.Vendor] = true
		}
	}
	for v := range vendorSet {
		meta.Vendors = append(meta.Vendors, v)
	}
	sort.Strings(meta.Vendors)
	return meta
}

// getApplicationCategories fetches the authoritative application category taxonomy from the
// device — /api/v2/monitor/utm/application-categories, the exact endpoint the FortiOS GUI
// uses (verified live). Falls back to the static list only if the device call fails.
func (f *FortiClient) getApplicationCategories() []AppCategoryMeta {
	resp, err := f.do("GET", "/api/v2/monitor/utm/application-categories", nil)
	if err != nil {
		return appControlCategories
	}
	var rows []struct {
		Name string `json:"name"`
		ID   int    `json:"id"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 {
		return appControlCategories
	}
	out := make([]AppCategoryMeta, 0, len(rows))
	for _, r := range rows {
		out = append(out, AppCategoryMeta{ID: r.ID, Name: r.Name})
	}
	return out
}

// getApplicationSignatures fetches the full application signature catalogue the "Add New
// Override → Application" table needs — the exact 2,414-signature list the FortiOS GUI shows.
//
// ⚠️ The authoritative source is the device's LOCAL application database:
// /api/v2/cmdb/application/name. This ships inside the firmware's Application Control
// signature package and is present on EVERY FortiGate — even unlicensed / cloud-unreachable
// units — so it always returns the complete list (verified live on 10.0.99.201 = 2,414 rows,
// first app "1kxun" exactly matching the GUI). It labels each app with a numeric category id
// (already matching monitor/utm/application-categories) plus display-string technology / vendor
// and 1-5 popularity / risk, so no name→id remapping is needed.
//
// The earlier implementation read /api/v2/monitor/fortiguard/app-information, which is a
// FortiGuard *cloud* feed that returns HTTP 424 on this lab device (service inactive) — that
// is why the picker came up empty even though the GUI's list was full. We keep that feed only
// as a last-resort fallback. `cats` maps category NAME→id for the fallback feed (the local DB
// already uses ids).
func (f *FortiClient) getApplicationSignatures(cats []AppCategoryMeta) []AppSignatureMeta {
	if sigs, ok := cachedAppSignatures(f.BaseURL); ok {
		return sigs
	}

	// Primary: local application database (same source the GUI override picker uses).
	if resp, err := f.do("GET", "/api/v2/cmdb/application/name", nil); err == nil {
		var rows []struct {
			ID         int    `json:"id"`
			Name       string `json:"name"`
			Category   int    `json:"category"`
			Technology string `json:"technology"`
			Popularity int    `json:"popularity"`
			Risk       int    `json:"risk"`
			Vendor     string `json:"vendor"`
		}
		if json.Unmarshal(resp.Results, &rows) == nil && len(rows) > 0 {
			out := make([]AppSignatureMeta, 0, len(rows))
			for _, r := range rows {
				if r.ID == 0 || r.Name == "" {
					continue
				}
				out = append(out, AppSignatureMeta{
					ID: r.ID, Name: r.Name, Category: r.Category, Technology: r.Technology,
					Popularity: r.Popularity, Risk: r.Risk, Vendor: r.Vendor,
				})
			}
			if len(out) > 0 {
				storeAppSignatures(f.BaseURL, out)
				return out
			}
		}
	}

	// Fallback: FortiGuard cloud feed (only if the local DB is somehow unavailable). Its rows
	// are tolerant-typed: Category may arrive as an id or a name, so accept both and normalise.
	nameToID := make(map[string]int, len(cats))
	for _, c := range cats {
		nameToID[c.Name] = c.ID
	}
	resp, err := f.do("GET", "/api/v2/monitor/fortiguard/app-information", nil)
	if err != nil {
		return nil // 424 on unlicensed / cloud-unreachable devices
	}
	var rows []struct {
		ID         int         `json:"ID"`
		IDlc       int         `json:"id"`
		Name       string      `json:"Name"`
		Namelc     string      `json:"name"`
		Category   interface{} `json:"Category"`
		Technology string      `json:"Technology"`
		Popularity int         `json:"Popularity"`
		RiskID     int         `json:"RiskID"`
		Vendor     string      `json:"Vendor"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil || len(rows) == 0 {
		return nil
	}
	out := make([]AppSignatureMeta, 0, len(rows))
	for _, r := range rows {
		id, name := r.ID, r.Name
		if id == 0 {
			id = r.IDlc
		}
		if name == "" {
			name = r.Namelc
		}
		catID := 0
		switch cv := r.Category.(type) {
		case float64:
			catID = int(cv)
		case string:
			catID = nameToID[cv]
		}
		out = append(out, AppSignatureMeta{
			ID: id, Name: name, Category: catID, Technology: r.Technology,
			Popularity: r.Popularity, Risk: r.RiskID, Vendor: r.Vendor,
		})
	}
	storeAppSignatures(f.BaseURL, out)
	return out
}

// ── Application signature DB cache ────────────────────────────────────────────
//
// /api/v2/cmdb/application/name returns the device's ENTIRE local application database:
// 2,414 rows / ~1.1 MB / ~1s on the lab FortiGate (measured). It was being re-fetched on
// EVERY AI request (buildLiveDeviceContext) and on every Application Control form load —
// a full second of the AI's latency spent re-downloading a list that only changes when the
// firmware or the FortiGuard application package is updated. Cache it per device.
//
// Keyed by BaseURL (https://<mgmt-ip>:<port>) so two devices never share an entry.
type appSigCacheEntry struct {
	sigs      []AppSignatureMeta
	fetchedAt time.Time
}

const appSigCacheTTL = 30 * time.Minute

var (
	appSigCacheMu sync.RWMutex
	appSigCache   = map[string]appSigCacheEntry{}
)

func cachedAppSignatures(baseURL string) ([]AppSignatureMeta, bool) {
	appSigCacheMu.RLock()
	e, ok := appSigCache[baseURL]
	appSigCacheMu.RUnlock()
	if !ok || time.Since(e.fetchedAt) > appSigCacheTTL || len(e.sigs) == 0 {
		return nil, false
	}
	return e.sigs, true
}

func storeAppSignatures(baseURL string, sigs []AppSignatureMeta) {
	if len(sigs) == 0 {
		return
	}
	appSigCacheMu.Lock()
	appSigCache[baseURL] = appSigCacheEntry{sigs: sigs, fetchedAt: time.Now()}
	appSigCacheMu.Unlock()
	log.Printf("[fortigate] cached %d application signatures for %s (TTL %s)", len(sigs), baseURL, appSigCacheTTL)
}

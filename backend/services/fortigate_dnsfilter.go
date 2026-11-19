package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var dnsfilterProfileTable = cmdbPath{path: "dnsfilter/profile", noun: "profile"}

// DNS Filter profile (dnsfilter/profile) — form mapping, the domain-filter table it depends on,
// and the category/licence metadata behind the form.
//
// Split out of fortigate.go verbatim.

// ── DNS Filter Profile (create/update) ────────────────────────────────────────
//
// DNSFilterProfileForm is our simplified, GUI-shaped view of a FortiGate dnsfilter/profile
// object — one flat struct mirroring the FortiOS "New DNS Filter Profile" page.
// dnsFilterProfilePayload / fgToDNSFilterProfileForm convert to/from the real nested CMDB JSON
// so the frontend never has to know FortiGate's nested schema.
//
// GUI → CMDB mapping. Every row was verified against a live FortiGate 7.2.10 (FGT80E) by
// POSTing a probe profile and reading it back over REST *and* over SSH (`show dnsfilter
// profile`); both agree with what is written here:
//
//	Name                                           → name
//	Comments                                       → comment
//	Redirect botnet C&C requests to Block Portal   → block-botnet {enable|disable}
//	Enforce 'Safe Search' on Google, Bing, YouTube → safe-search {enable|disable}
//	Restrict YouTube Access (Strict | Moderate)    → youtube-restrict {strict|moderate}
//	FortiGuard Category Based Filter (master)      → ftgd-dns.options CONTAINS "ftgd-disable" when OFF
//	category action "Redirect to Block Portal"     → ftgd-dns.filters[] {category, action: block}
//	category action "Monitor"                      → ftgd-dns.filters[] {category, action: monitor}
//	category action "Allow"                        → NO entry at all (see the ⚠️ below)
//	Static Domain Filter → Domain Filter           → domain-filter.domain-filter-table = table id (0 = off)
//	External IP Block Lists                        → external-ip-blocklist[] (system.external-resource names)
//	DNS Translation                                → dns-translation[] {src, dst, netmask, status}
//	Redirect Portal IP "Use FortiGuard Default"    → redirect-portal 0.0.0.0
//	Redirect Portal IP "Specify"                   → redirect-portal <ip>
//	Allow DNS requests when a rating error occurs  → ftgd-dns.options CONTAINS "error-allow"
//	Log all DNS queries and responses              → log-all-domain {enable|disable}
//
// ⚠️ "Allow" IS THE ABSENCE OF AN ENTRY — never send action="allow".
// The CMDB schema for ftgd-dns.filters.action offers only {block|monitor}, but FortiOS does NOT
// reject "allow": it answers HTTP 200 "success" and SILENTLY STORES "block" instead (verified
// live — the REST read-back and `show dnsfilter profile` both come back as block). Passing the
// GUI's own vocabulary straight through would therefore BLOCK every category the user asked to
// ALLOW — the exact opposite of the request, with a success message on screen. A category the
// user allows is simply left out of filters[], which is also how the GUI's "R" preset (which
// allows all 15 Adult/Mature Content categories) round-trips.
//
// ⚠️ ftgd-dns.options is a multi-option field — it MUST go through fgFlagField (an empty string
// is silently ignored; only JSON null clears it).
type DNSFilterProfileForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	RedirectBotnet  bool   `json:"redirect_botnet"`
	SafeSearch      bool   `json:"safe_search"`
	YouTubeRestrict string `json:"youtube_restrict"` // strict | moderate (only shown when SafeSearch)

	// FortiGuard Category Based Filter. Categories holds ONLY the non-allow rows (see above).
	FortiGuardCategoryFilter bool                      `json:"fortiguard_category_filter"`
	Categories               []DNSFilterCategoryAction `json:"categories"`

	// Static Domain Filter.
	DomainFilter        bool             `json:"domain_filter"`
	DomainFilterEntries []DNSDomainEntry `json:"domain_filter_entries"`

	ExternalIPBlocklist      bool     `json:"external_ip_blocklist"`
	ExternalIPBlocklistNames []string `json:"external_ip_blocklist_names"`

	DNSTranslation        bool                  `json:"dns_translation"`
	DNSTranslationEntries []DNSTranslationEntry `json:"dns_translation_entries"`

	// Options.
	UseDefaultRedirectPortal bool   `json:"use_default_redirect_portal"`
	RedirectPortalIP         string `json:"redirect_portal_ip"`
	AllowRatingError         bool   `json:"allow_rating_error"`
	LogAllDomains            bool   `json:"log_all_domains"`
}

// DNSFilterCategoryAction is one FortiGuard category and its action in the grid.
// Action "block" is what the GUI toolbar calls "Redirect to Block Portal".
type DNSFilterCategoryAction struct {
	Category int    `json:"category"`
	Action   string `json:"action"` // monitor | block  ("allow" is never stored — see above)
}

// DNSDomainEntry is one row of the Static Domain Filter table (dnsfilter/domain-filter entries).
type DNSDomainEntry struct {
	Domain string `json:"domain"`
	Type   string `json:"type"`   // simple | regex | wildcard
	Action string `json:"action"` // block | allow | monitor
	Status string `json:"status"` // enable | disable
}

// DNSTranslationEntry is one row of the DNS Translation table. IPv4 only: the form maps to
// dns-translation entries with addr-type=ipv4, which is what the GUI's Original/Translated
// Destination + Network Mask columns produce. (The CMDB also carries src6/dst6/prefix for
// addr-type=ipv6; no GUI row on this device produces one, so it is deliberately not wired.)
type DNSTranslationEntry struct {
	Src     string `json:"src"`     // Original Destination
	Dst     string `json:"dst"`     // Translated Destination
	Netmask string `json:"netmask"` // Network Mask/Prefix
	Status  string `json:"status"`  // enable | disable
}

// dnsFilterDefaultPortal is the redirect-portal value meaning "Use FortiGuard Default".
const dnsFilterDefaultPortal = "0.0.0.0"

var (
	dnsDomainTypes   = map[string]bool{"simple": true, "regex": true, "wildcard": true}
	dnsDomainActions = map[string]bool{"block": true, "allow": true, "monitor": true}
	// The grid's vocabulary. "allow" is accepted from the frontend and then encoded by OMISSION.
	dnsCategoryActions = map[string]bool{"allow": true, "monitor": true, "block": true}
)

// isValidDNSDomainType / isValidDNSFilterCategoryAction expose the two vocabularies for tests
// and callers that validate before hitting the device.
func isValidDNSDomainType(t string) bool {
	return dnsDomainTypes[strings.ToLower(strings.TrimSpace(t))]
}

func isValidDNSFilterCategoryAction(a string) bool {
	return dnsCategoryActions[strings.ToLower(strings.TrimSpace(a))]
}

// dnsYouTubeRestrict normalises the YouTube restriction. The 7.2.10 schema offers only
// {strict|moderate} (there is no "none"), and strict is the device default.
func dnsYouTubeRestrict(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "moderate") {
		return "moderate"
	}
	return "strict"
}

// buildDNSDomainEntries converts Static Domain Filter rows into dnsfilter/domain-filter
// entries. Ids are assigned densely from 1 (the table is rewritten wholesale on every save).
func buildDNSDomainEntries(list []DNSDomainEntry) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(list))
	for _, e := range list {
		domain := strings.TrimSpace(e.Domain)
		if domain == "" {
			continue
		}
		out = append(out, map[string]interface{}{
			"id":     len(out) + 1,
			"domain": domain,
			"type":   defaultStr(strings.ToLower(strings.TrimSpace(e.Type)), "simple"),
			"action": defaultStr(strings.ToLower(strings.TrimSpace(e.Action)), "block"),
			"status": defaultStr(strings.ToLower(strings.TrimSpace(e.Status)), "enable"),
		})
	}
	return out
}

// ValidateDNSFilterForm catches the input the device would only reject with an opaque -3/-651,
// so the user gets a sentence instead of a code. Runs on both create and update.
func ValidateDNSFilterForm(form DNSFilterProfileForm) error {
	if strings.TrimSpace(form.Name) == "" {
		return fmt.Errorf("name is required")
	}
	for _, c := range form.Categories {
		if !isValidDNSFilterCategoryAction(c.Action) {
			return fmt.Errorf("category %d: invalid action %q (allow, monitor or block)", c.Category, c.Action)
		}
	}
	if form.DomainFilter {
		for _, e := range form.DomainFilterEntries {
			if strings.TrimSpace(e.Domain) == "" {
				return fmt.Errorf("static domain filter: a rule has an empty domain")
			}
			if t := strings.TrimSpace(e.Type); t != "" && !dnsDomainTypes[strings.ToLower(t)] {
				return fmt.Errorf("static domain filter %q: invalid type %q (simple, regex or wildcard)", e.Domain, e.Type)
			}
			if a := strings.TrimSpace(e.Action); a != "" && !dnsDomainActions[strings.ToLower(a)] {
				return fmt.Errorf("static domain filter %q: invalid action %q (block, allow or monitor)", e.Domain, e.Action)
			}
		}
	}
	if form.ExternalIPBlocklist {
		for _, n := range form.ExternalIPBlocklistNames {
			if strings.TrimSpace(n) == "" {
				return fmt.Errorf("external IP block lists: an entry has an empty name")
			}
		}
	}
	if form.DNSTranslation {
		for _, t := range form.DNSTranslationEntries {
			if net.ParseIP(strings.TrimSpace(t.Src)) == nil {
				return fmt.Errorf("DNS translation: %q is not a valid original destination IP", t.Src)
			}
			if net.ParseIP(strings.TrimSpace(t.Dst)) == nil {
				return fmt.Errorf("DNS translation: %q is not a valid translated destination IP", t.Dst)
			}
			if m := strings.TrimSpace(t.Netmask); m != "" && net.ParseIP(m) == nil {
				return fmt.Errorf("DNS translation: %q is not a valid network mask", t.Netmask)
			}
		}
	}
	if !form.UseDefaultRedirectPortal {
		if ip := strings.TrimSpace(form.RedirectPortalIP); ip != "" && net.ParseIP(ip) == nil {
			return fmt.Errorf("redirect portal IP: %q is not a valid IP address", form.RedirectPortalIP)
		}
	}
	return nil
}

// dnsFilterProfilePayload builds the nested CMDB body for POST/PUT dnsfilter/profile. Every
// field is sent explicitly (no omitempty) so an update can turn a previously-enabled option
// back off. It resolves the Static Domain Filter table on demand, so it needs the live client.
func (f *FortiClient) dnsFilterProfilePayload(form DNSFilterProfileForm) (map[string]interface{}, error) {
	// ftgd-dns.options multi-flag. "ftgd-disable" turns the whole category filter OFF, so it is
	// present precisely when the master toggle is off.
	var fopts []string
	if !form.FortiGuardCategoryFilter {
		fopts = append(fopts, "ftgd-disable")
	}
	if form.AllowRatingError {
		fopts = append(fopts, "error-allow")
	}

	// Category grid → ftgd-dns.filters. Only block/monitor rows get an entry; "allow" is encoded
	// by omission (⚠️ see the type doc — action="allow" is silently stored as "block"). Sent as an
	// empty array — not null — so an update that allows everything clears the old entries.
	filters := make([]map[string]interface{}, 0, len(form.Categories))
	if form.FortiGuardCategoryFilter {
		for _, c := range form.Categories {
			act := strings.ToLower(strings.TrimSpace(c.Action))
			if act != "block" && act != "monitor" {
				continue
			}
			filters = append(filters, map[string]interface{}{
				"id":       len(filters) + 1,
				"category": c.Category,
				"action":   act,
				"log":      "enable",
			})
		}
	}

	tableID := 0
	if form.DomainFilter {
		id, err := f.ensureDNSDomainFilterTable(form.Name, buildDNSDomainEntries(form.DomainFilterEntries))
		if err != nil {
			return nil, fmt.Errorf("could not build the Static Domain Filter table: %w", err)
		}
		tableID = id
	}

	blocklist := make([]map[string]interface{}, 0, len(form.ExternalIPBlocklistNames))
	if form.ExternalIPBlocklist {
		for _, n := range form.ExternalIPBlocklistNames {
			if n = strings.TrimSpace(n); n != "" {
				blocklist = append(blocklist, map[string]interface{}{"name": n})
			}
		}
	}

	translations := make([]map[string]interface{}, 0, len(form.DNSTranslationEntries))
	if form.DNSTranslation {
		for _, t := range form.DNSTranslationEntries {
			src, dst := strings.TrimSpace(t.Src), strings.TrimSpace(t.Dst)
			if src == "" || dst == "" {
				continue
			}
			translations = append(translations, map[string]interface{}{
				"id":        len(translations) + 1,
				"addr-type": "ipv4",
				"src":       src,
				"dst":       dst,
				"netmask":   defaultStr(strings.TrimSpace(t.Netmask), "255.255.255.255"),
				"status":    defaultStr(strings.ToLower(strings.TrimSpace(t.Status)), "enable"),
			})
		}
	}

	portal := strings.TrimSpace(form.RedirectPortalIP)
	if form.UseDefaultRedirectPortal || portal == "" {
		portal = dnsFilterDefaultPortal
	}

	return map[string]interface{}{
		"name":                  form.Name,
		"comment":               form.Comment,
		"block-botnet":          FGBoolToString(form.RedirectBotnet),
		"safe-search":           FGBoolToString(form.SafeSearch),
		"youtube-restrict":      dnsYouTubeRestrict(form.YouTubeRestrict),
		"log-all-domain":        FGBoolToString(form.LogAllDomains),
		"redirect-portal":       portal,
		"domain-filter":         map[string]interface{}{"domain-filter-table": tableID},
		"external-ip-blocklist": blocklist,
		"dns-translation":       translations,
		"ftgd-dns": map[string]interface{}{
			"options": fgFlagField(fopts),
			"filters": filters,
		},
	}, nil
}

// fgToDNSFilterProfileForm parses a raw CMDB dnsfilter/profile object back into the form.
// The Static Domain Filter ROWS are not in here — they live in the referenced table, which
// GetDNSFilterProfile fetches separately.
func fgToDNSFilterProfileForm(raw json.RawMessage) DNSFilterProfileForm {
	var m struct {
		Name           string `json:"name"`
		Comment        string `json:"comment"`
		BlockBotnet    string `json:"block-botnet"`
		SafeSearch     string `json:"safe-search"`
		YouTube        string `json:"youtube-restrict"`
		LogAllDomain   string `json:"log-all-domain"`
		RedirectPortal string `json:"redirect-portal"`
		DomainFilter   struct {
			Table int `json:"domain-filter-table"`
		} `json:"domain-filter"`
		FTGDDNS struct {
			Options string `json:"options"`
			Filters []struct {
				Category int    `json:"category"`
				Action   string `json:"action"`
			} `json:"filters"`
		} `json:"ftgd-dns"`
		ExternalIPBlocklist []FGName `json:"external-ip-blocklist"`
		DNSTranslation      []struct {
			AddrType string `json:"addr-type"`
			Src      string `json:"src"`
			Dst      string `json:"dst"`
			Netmask  string `json:"netmask"`
			Status   string `json:"status"`
		} `json:"dns-translation"`
	}
	json.Unmarshal(raw, &m) //nolint:errcheck

	hasOpt := func(flag string) bool {
		for _, o := range strings.Fields(m.FTGDDNS.Options) {
			if strings.EqualFold(o, flag) {
				return true
			}
		}
		return false
	}

	form := DNSFilterProfileForm{
		Name:            m.Name,
		Comment:         m.Comment,
		RedirectBotnet:  FGStringToBool(m.BlockBotnet),
		SafeSearch:      FGStringToBool(m.SafeSearch),
		YouTubeRestrict: dnsYouTubeRestrict(m.YouTube),
		// The master toggle is the ABSENCE of "ftgd-disable".
		FortiGuardCategoryFilter: !hasOpt("ftgd-disable"),
		AllowRatingError:         hasOpt("error-allow"),
		LogAllDomains:            FGStringToBool(m.LogAllDomain),
		DomainFilter:             m.DomainFilter.Table != 0,
		// A blank or 0.0.0.0 portal means the GUI's "Use FortiGuard Default".
		UseDefaultRedirectPortal: strings.TrimSpace(m.RedirectPortal) == "" ||
			strings.TrimSpace(m.RedirectPortal) == dnsFilterDefaultPortal,
	}
	if !form.UseDefaultRedirectPortal {
		form.RedirectPortalIP = strings.TrimSpace(m.RedirectPortal)
	}

	// Every slice below is initialised even when empty: they cross the wire as JSON, and the
	// form treats them as arrays. A nil slice marshals to null, which would blow up the table
	// the moment the user switched its toggle back on.
	form.DomainFilterEntries = make([]DNSDomainEntry, 0)

	form.Categories = make([]DNSFilterCategoryAction, 0, len(m.FTGDDNS.Filters))
	for _, fl := range m.FTGDDNS.Filters {
		form.Categories = append(form.Categories, DNSFilterCategoryAction{
			Category: fl.Category, Action: strings.ToLower(fl.Action),
		})
	}

	form.ExternalIPBlocklistNames = make([]string, 0, len(m.ExternalIPBlocklist))
	for _, b := range m.ExternalIPBlocklist {
		form.ExternalIPBlocklistNames = append(form.ExternalIPBlocklistNames, b.Name)
	}
	form.ExternalIPBlocklist = len(form.ExternalIPBlocklistNames) > 0

	form.DNSTranslationEntries = make([]DNSTranslationEntry, 0, len(m.DNSTranslation))
	for _, t := range m.DNSTranslation {
		// IPv4 rows only — an ipv6 row carries src6/dst6, which this form doesn't model, and
		// showing it as a blank IPv4 row would silently drop it on the next save.
		if t.AddrType != "" && !strings.EqualFold(t.AddrType, "ipv4") {
			continue
		}
		form.DNSTranslationEntries = append(form.DNSTranslationEntries, DNSTranslationEntry{
			Src: t.Src, Dst: t.Dst, Netmask: t.Netmask, Status: strings.ToLower(t.Status),
		})
	}
	form.DNSTranslation = len(form.DNSTranslationEntries) > 0

	return form
}

// GetDNSDomainFilterTableIDs lists the dnsfilter/domain-filter table ids already on the device.
//
// Same hazard as the webfilter tables, and for a while only those were reported to the AI: a
// domain-filter table is keyed by a NUMBER the author picks, so CLI that says `edit 1` on a live id
// overwrites that whole table, rows and all. The AI prompt's own example used to pair `edit 0` for
// the table with `set domain-filter-table 0` in the profile — two ids that are NOT the same thing
// on a real device (`edit 0` makes FortiOS assign the next free id, which is never 0), so the
// profile ended up pointing at a table that does not exist and the block silently did nothing.
// Telling the model which ids are taken is what lets it name one id and use it in both places.
func (f *FortiClient) GetDNSDomainFilterTableIDs() []int {
	resp, err := f.do("GET", "/api/v2/cmdb/dnsfilter/domain-filter?fields=id,name", nil)
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

// getDNSDomainFilterEntries reads back the rows of a dnsfilter/domain-filter table by id.
func (f *FortiClient) getDNSDomainFilterEntries(id int) []DNSDomainEntry {
	resp, err := f.do("GET", "/api/v2/cmdb/dnsfilter/domain-filter/"+strconv.Itoa(id), nil)
	if err != nil {
		return nil
	}
	var items []struct {
		Entries []struct {
			Domain string `json:"domain"`
			Type   string `json:"type"`
			Action string `json:"action"`
			Status string `json:"status"`
		} `json:"entries"`
	}
	if json.Unmarshal(resp.Results, &items) != nil || len(items) == 0 {
		return nil
	}
	out := make([]DNSDomainEntry, 0, len(items[0].Entries))
	for _, e := range items[0].Entries {
		out = append(out, DNSDomainEntry{
			Domain: e.Domain, Type: e.Type, Action: e.Action, Status: e.Status,
		})
	}
	return out
}

// GetDNSFilterProfile fetches a single dnsfilter/profile by name for the edit form, including
// the Static Domain Filter rows from the table it references.
func (f *FortiClient) GetDNSFilterProfile(name string) (DNSFilterProfileForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/dnsfilter/profile/"+url.PathEscape(name), nil)
	if err != nil {
		return DNSFilterProfileForm{}, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return DNSFilterProfileForm{}, fmt.Errorf("DNS filter profile %q not found", name)
	}
	log.Printf("[fortigate] GET dnsfilter/profile/%s raw=%s", name, items[0])
	form := fgToDNSFilterProfileForm(items[0])

	// A table read that fails must not turn the (already empty) slice back into nil — see the
	// slice note in fgToDNSFilterProfileForm.
	if tableID := dnsDomainFilterTableID(items[0]); form.DomainFilter && tableID != 0 {
		if rows := f.getDNSDomainFilterEntries(tableID); rows != nil {
			form.DomainFilterEntries = rows
		}
	}

	log.Printf("[fortigate] GET dnsfilter/profile/%s parsed=%+v", name, form)
	return form, nil
}

// dnsDomainFilterTableID pulls domain-filter.domain-filter-table out of a raw profile object.
func dnsDomainFilterTableID(raw json.RawMessage) int {
	var m struct {
		DomainFilter struct {
			Table int `json:"domain-filter-table"`
		} `json:"domain-filter"`
	}
	json.Unmarshal(raw, &m) //nolint:errcheck
	return m.DomainFilter.Table
}

// CreateDNSFilterProfile creates a new dnsfilter/profile object on the device.
func (f *FortiClient) CreateDNSFilterProfile(form DNSFilterProfileForm) error {
	payload, err := f.dnsFilterProfilePayload(form)
	if err != nil {
		return err
	}
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST dnsfilter/profile payload=%s", b)
	}
	err = dnsfilterProfileTable.Create(f, payload)
	return err
}

// UpdateDNSFilterProfile overwrites an existing dnsfilter/profile object by name.
func (f *FortiClient) UpdateDNSFilterProfile(name string, form DNSFilterProfileForm) error {
	payload, err := f.dnsFilterProfilePayload(form)
	if err != nil {
		return err
	}
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT dnsfilter/profile/%s payload=%s", name, b)
	}
	err = dnsfilterProfileTable.Update(f, name, payload)
	return err
}

// ── DNS Filter metadata (category tree + licence state + pickers) ─────────────

// DNSFilterMetadata is everything the "New DNS Filter Profile" page needs beyond the profile:
// the FortiGuard category tree, the two licence signals whose absence the real GUI warns
// about, and the external-resource names for the External IP Block Lists picker.
type DNSFilterMetadata struct {
	Categories []FGWebFilterCategory `json:"categories"`
	// FortiGuard web-filtering subscription — the DNS category filter is rated by the same
	// service, so an unlicensed device rates nothing and the grid does nothing.
	WebFilterLicensed bool `json:"web_filter_licensed"`
	// Botnet C&C domain package. The GUI shows "0 domains in botnet package / Botnet package
	// update unavailable, AntiVirus subscription not found" when this is off — the package
	// ships with the AntiVirus (AVDB) entitlement, which is what botnet_domain reports.
	BotnetLicensed bool `json:"botnet_licensed"`
	// system/external-resource names usable in External IP Block Lists.
	ExternalResources []string `json:"external_resources"`
}

// GetDNSFilterMetadata gathers the DNS Filter form's category tree, licence signals and
// pickers. Each probe is best-effort: a failure leaves that field at its zero value rather
// than failing the page.
// GetDNSFilterMetadata gathers the DNS Filter form's category tree, licence signals and pickers.
//
// Three independent reads, issued together; the first two share the caches the Web Filter form
// fills, so opening one form after the other costs a single live call here. External resources are
// user-created and stay live.
func (f *FortiClient) GetDNSFilterMetadata() DNSFilterMetadata {
	var meta DNSFilterMetadata

	Parallel(
		func() { meta.Categories = f.fortiguardCategories() },
		func() {
			lic := f.licenseStatuses()
			meta.WebFilterLicensed = lic["web_filtering"]
			meta.BotnetLicensed = lic["botnet_domain"]
		},

		// External resources → the External IP Block Lists picker. Only address-type feeds are
		// valid here (the field's datasource is system.external-resource.name, and FortiOS rejects
		// a domain/malware feed with -3).
		func() {
			resp, err := f.do("GET", "/api/v2/cmdb/system/external-resource?fields=name,type", nil)
			if err != nil {
				return
			}
			var rows []struct {
				Name string `json:"name"`
				Type string `json:"type"`
			}
			if json.Unmarshal(resp.Results, &rows) != nil {
				return
			}
			for _, r := range rows {
				if r.Type == "" || strings.EqualFold(r.Type, "address") {
					meta.ExternalResources = append(meta.ExternalResources, r.Name)
				}
			}
		},
	)

	return meta
}

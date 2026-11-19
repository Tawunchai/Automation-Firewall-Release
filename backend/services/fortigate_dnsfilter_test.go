package services

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Pinned to behaviour VERIFIED against the lab FortiGate (80E, FortiOS 7.2.10) by POSTing a
// probe profile and reading it back over REST *and* SSH (`show dnsfilter profile`):
//
//	GUI "Redirect to Block Portal"  == CMDB ftgd-dns.filters action=block
//	GUI "Monitor"                   == CMDB ftgd-dns.filters action=monitor
//	GUI "Allow"                     == NO filters entry at all
//	  ⚠️ action="allow" is NOT rejected — the device answers 200 and stores "block" instead,
//	     i.e. sending the GUI's own word would block what the user allowed. See TestDNSFilter…AllowIsOmitted.
//	FortiGuard Category Based Filter OFF == ftgd-dns.options contains "ftgd-disable"
//	"Allow DNS requests when a rating error occurs" == ftgd-dns.options contains "error-allow"
//	  ⚠️ options is a multi-option field: "" is silently ignored, only JSON null clears it.
//	Redirect Portal IP "Use FortiGuard Default" == redirect-portal 0.0.0.0

// ─── helpers ─────────────────────────────────────────────────────────────────

// dnsForm returns a valid baseline form; `over` tweaks it per test.
func dnsForm(over func(*DNSFilterProfileForm)) DNSFilterProfileForm {
	f := DNSFilterProfileForm{
		Name: "dns1", Comment: "c",
		FortiGuardCategoryFilter: true,
		YouTubeRestrict:          "strict",
		UseDefaultRedirectPortal: true,
	}
	if over != nil {
		over(&f)
	}
	return f
}

// dnsPayload builds a payload with no device round-trip (Static Domain Filter off ⇒ no HTTP).
func dnsPayload(t *testing.T, form DNSFilterProfileForm) map[string]interface{} {
	t.Helper()
	p, err := (&FortiClient{}).dnsFilterProfilePayload(form)
	if err != nil {
		t.Fatalf("dnsFilterProfilePayload: %v", err)
	}
	return p
}

func ftgdDNS(t *testing.T, p map[string]interface{}) map[string]interface{} {
	t.Helper()
	m, ok := p["ftgd-dns"].(map[string]interface{})
	if !ok {
		t.Fatalf("ftgd-dns missing/wrong type: %#v", p["ftgd-dns"])
	}
	return m
}

func dnsFilters(t *testing.T, p map[string]interface{}) []map[string]interface{} {
	t.Helper()
	f, ok := ftgdDNS(t, p)["filters"].([]map[string]interface{})
	if !ok {
		t.Fatalf("filters missing/wrong type: %#v", ftgdDNS(t, p)["filters"])
	}
	return f
}

// ─── payload: scalars ────────────────────────────────────────────────────────

func TestDNSFilterProfilePayload_Basics(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.RedirectBotnet = true
		f.SafeSearch = true
		f.YouTubeRestrict = "moderate"
		f.LogAllDomains = true
	}))

	for k, want := range map[string]interface{}{
		"name":             "dns1",
		"comment":          "c",
		"block-botnet":     "enable",
		"safe-search":      "enable",
		"youtube-restrict": "moderate",
		"log-all-domain":   "enable",
		"redirect-portal":  "0.0.0.0",
	} {
		if p[k] != want {
			t.Errorf("%s = %v, want %v", k, p[k], want)
		}
	}
}

func TestDNSFilterProfilePayload_TogglesOff(t *testing.T) {
	p := dnsPayload(t, dnsForm(nil))
	for k, want := range map[string]interface{}{
		"block-botnet":   "disable",
		"safe-search":    "disable",
		"log-all-domain": "disable",
	} {
		if p[k] != want {
			t.Errorf("%s = %v, want %v", k, p[k], want)
		}
	}
}

// The 7.2.10 schema offers only {strict|moderate} — there is no "none". Anything unset or
// unrecognised must land on the device default rather than being passed through.
func TestDNSFilterProfilePayload_YouTubeRestrictDefaultsToStrict(t *testing.T) {
	for _, in := range []string{"", "none", "bogus", "STRICT"} {
		p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) { f.YouTubeRestrict = in }))
		if p["youtube-restrict"] != "strict" {
			t.Errorf("youtube-restrict for %q = %v, want strict", in, p["youtube-restrict"])
		}
	}
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) { f.YouTubeRestrict = "MoDeRaTe" }))
	if p["youtube-restrict"] != "moderate" {
		t.Errorf("youtube-restrict = %v, want moderate (case-insensitive)", p["youtube-restrict"])
	}
}

// ─── payload: the "allow" trap ───────────────────────────────────────────────

// THE important one. FortiOS answers HTTP 200 to action="allow" and silently stores "block",
// so an allowed category MUST leave the device with no entry at all. If this test ever fails,
// the form is about to block exactly the categories the user chose to allow.
func TestDNSFilterProfilePayload_AllowIsOmittedNeverSent(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.Categories = []DNSFilterCategoryAction{
			{Category: 1, Action: "allow"},
			{Category: 2, Action: "monitor"},
			{Category: 3, Action: "block"},
			{Category: 4, Action: "ALLOW"}, // case must not sneak past
			{Category: 5, Action: ""},      // empty is not a category the user asked to act on
			{Category: 6, Action: "bogus"}, // unknown action must never reach the device
		}
	}))

	filters := dnsFilters(t, p)
	if len(filters) != 2 {
		t.Fatalf("filters = %d entries, want 2 (only monitor+block): %#v", len(filters), filters)
	}
	got := map[int]string{}
	for _, e := range filters {
		got[e["category"].(int)] = e["action"].(string)
		if e["log"] != "enable" {
			t.Errorf("category %v: log = %v, want enable", e["category"], e["log"])
		}
	}
	if got[2] != "monitor" || got[3] != "block" {
		t.Errorf("filters = %v, want {2:monitor, 3:block}", got)
	}

	// Belt and braces: the word "allow" must not appear anywhere in the serialised filters.
	b, err := json.Marshal(filters)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(b)), "allow") {
		t.Errorf("serialised filters mention \"allow\" — the device would store it as block: %s", b)
	}
}

// ─── payload: ftgd-dns.options multi-flag ────────────────────────────────────

// No flag set must serialise to JSON null — "" is silently ignored by the device, which would
// leave a previously-disabled category filter disabled forever.
func TestDNSFilterProfilePayload_OptionsNullWhenNoFlags(t *testing.T) {
	p := dnsPayload(t, dnsForm(nil)) // category filter ON, rating-error OFF ⇒ no flags
	if opts := ftgdDNS(t, p)["options"]; opts != nil {
		t.Errorf("ftgd-dns.options = %#v, want nil (JSON null)", opts)
	}

	b, err := json.Marshal(p["ftgd-dns"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"options":null`) {
		t.Errorf("ftgd-dns marshalled without options:null — %s", b)
	}
}

func TestDNSFilterProfilePayload_FortiGuardOffAddsFtgdDisable(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.FortiGuardCategoryFilter = false
		f.Categories = []DNSFilterCategoryAction{{Category: 1, Action: "block"}}
	}))
	if got := ftgdDNS(t, p)["options"]; got != "ftgd-disable" {
		t.Errorf("options = %#v, want \"ftgd-disable\"", got)
	}
	// With the master toggle off the grid is not in play — no category entries may be written.
	if f := dnsFilters(t, p); len(f) != 0 {
		t.Errorf("filters = %#v, want empty when the category filter is off", f)
	}
}

func TestDNSFilterProfilePayload_ErrorAllowFlag(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) { f.AllowRatingError = true }))
	if got := ftgdDNS(t, p)["options"]; got != "error-allow" {
		t.Errorf("options = %#v, want \"error-allow\"", got)
	}
}

func TestDNSFilterProfilePayload_BothFlagsSpaceJoined(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.FortiGuardCategoryFilter = false
		f.AllowRatingError = true
	}))
	if got := ftgdDNS(t, p)["options"]; got != "ftgd-disable error-allow" {
		t.Errorf("options = %#v, want \"ftgd-disable error-allow\"", got)
	}
}

// ─── payload: redirect portal ────────────────────────────────────────────────

func TestDNSFilterProfilePayload_RedirectPortal(t *testing.T) {
	cases := []struct {
		name       string
		useDefault bool
		ip         string
		wantPortal string
	}{
		{"use fortiguard default", true, "", "0.0.0.0"},
		{"default wins over a stale ip", true, "1.2.3.4", "0.0.0.0"},
		{"specify", false, "1.2.3.4", "1.2.3.4"},
		{"specify but blank falls back to default", false, "", "0.0.0.0"},
		{"specify trims", false, "  10.0.0.1  ", "10.0.0.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
				f.UseDefaultRedirectPortal = c.useDefault
				f.RedirectPortalIP = c.ip
			}))
			if p["redirect-portal"] != c.wantPortal {
				t.Errorf("redirect-portal = %v, want %v", p["redirect-portal"], c.wantPortal)
			}
		})
	}
}

// ─── payload: DNS translation + external block lists ─────────────────────────

func TestDNSFilterProfilePayload_DNSTranslation(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.DNSTranslation = true
		f.DNSTranslationEntries = []DNSTranslationEntry{
			{Src: "10.1.1.1", Dst: "10.2.2.2", Netmask: "255.255.255.0", Status: "enable"},
			{Src: "10.3.3.3", Dst: "10.4.4.4"}, // netmask/status default
			{Src: "", Dst: "10.5.5.5"},         // incomplete row is dropped
		}
	}))
	rows, ok := p["dns-translation"].([]map[string]interface{})
	if !ok || len(rows) != 2 {
		t.Fatalf("dns-translation = %#v, want 2 rows", p["dns-translation"])
	}
	if rows[0]["id"] != 1 || rows[1]["id"] != 2 {
		t.Errorf("ids = %v/%v, want dense 1/2", rows[0]["id"], rows[1]["id"])
	}
	if rows[0]["addr-type"] != "ipv4" {
		t.Errorf("addr-type = %v, want ipv4", rows[0]["addr-type"])
	}
	if rows[1]["netmask"] != "255.255.255.255" || rows[1]["status"] != "enable" {
		t.Errorf("defaults = %v/%v, want 255.255.255.255/enable", rows[1]["netmask"], rows[1]["status"])
	}
}

// Toggling the section off must send an EMPTY array, not nil — that is what clears rows the
// device already has (an update has to be able to turn a feature back off).
func TestDNSFilterProfilePayload_TogglesOffSendEmptyArrays(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.DNSTranslation = false
		f.DNSTranslationEntries = []DNSTranslationEntry{{Src: "10.1.1.1", Dst: "10.2.2.2"}}
		f.ExternalIPBlocklist = false
		f.ExternalIPBlocklistNames = []string{"feed1"}
	}))
	for _, k := range []string{"dns-translation", "external-ip-blocklist"} {
		rows, ok := p[k].([]map[string]interface{})
		if !ok {
			t.Fatalf("%s = %#v, want []map (not nil)", k, p[k])
		}
		if len(rows) != 0 {
			t.Errorf("%s = %#v, want empty when the toggle is off", k, rows)
		}
	}
	b, _ := json.Marshal(p["dns-translation"])
	if string(b) != "[]" {
		t.Errorf("dns-translation marshals to %s, want []", b)
	}
}

func TestDNSFilterProfilePayload_ExternalBlocklistNameRefs(t *testing.T) {
	p := dnsPayload(t, dnsForm(func(f *DNSFilterProfileForm) {
		f.ExternalIPBlocklist = true
		f.ExternalIPBlocklistNames = []string{"feed1", "  ", "feed2"}
	}))
	rows, ok := p["external-ip-blocklist"].([]map[string]interface{})
	if !ok || len(rows) != 2 {
		t.Fatalf("external-ip-blocklist = %#v, want 2 rows (blank dropped)", p["external-ip-blocklist"])
	}
	if rows[0]["name"] != "feed1" || rows[1]["name"] != "feed2" {
		t.Errorf("rows = %v, want name refs feed1/feed2", rows)
	}
}

// Domain Filter off ⇒ the profile must point at table 0, which is how the device stores "off".
func TestDNSFilterProfilePayload_DomainFilterOffIsTableZero(t *testing.T) {
	p := dnsPayload(t, dnsForm(nil))
	df, ok := p["domain-filter"].(map[string]interface{})
	if !ok || df["domain-filter-table"] != 0 {
		t.Errorf("domain-filter = %#v, want {domain-filter-table: 0}", p["domain-filter"])
	}
}

func TestBuildDNSDomainEntries(t *testing.T) {
	got := buildDNSDomainEntries([]DNSDomainEntry{
		{Domain: "*.facebook.com", Type: "wildcard", Action: "block", Status: "enable"},
		{Domain: "example.com"}, // defaults: simple/block/enable
		{Domain: "   "},         // blank dropped
	})
	if len(got) != 2 {
		t.Fatalf("entries = %#v, want 2", got)
	}
	if got[0]["id"] != 1 || got[1]["id"] != 2 {
		t.Errorf("ids = %v/%v, want dense 1/2", got[0]["id"], got[1]["id"])
	}
	if got[1]["type"] != "simple" || got[1]["action"] != "block" || got[1]["status"] != "enable" {
		t.Errorf("defaults = %#v", got[1])
	}
}

// ─── parser ──────────────────────────────────────────────────────────────────

func TestFgToDNSFilterProfileForm(t *testing.T) {
	raw := json.RawMessage(`{
		"name": "p1", "comment": "hi",
		"block-botnet": "enable", "safe-search": "enable", "youtube-restrict": "moderate",
		"log-all-domain": "enable", "redirect-portal": "1.2.3.4",
		"domain-filter": {"domain-filter-table": 7},
		"ftgd-dns": {"options": "error-allow", "filters": [
			{"id":1,"category":1,"action":"block","log":"enable"},
			{"id":2,"category":3,"action":"monitor","log":"enable"}
		]},
		"external-ip-blocklist": [{"name":"feed1"}],
		"dns-translation": [
			{"id":1,"addr-type":"ipv4","src":"10.1.1.1","dst":"10.2.2.2","netmask":"255.255.255.0","status":"enable"},
			{"id":2,"addr-type":"ipv6","src6":"::1","dst6":"::2","prefix":128,"status":"enable"}
		]
	}`)
	f := fgToDNSFilterProfileForm(raw)

	if f.Name != "p1" || f.Comment != "hi" {
		t.Errorf("name/comment = %q/%q", f.Name, f.Comment)
	}
	if !f.RedirectBotnet || !f.SafeSearch || !f.LogAllDomains {
		t.Errorf("toggles = %v/%v/%v, want all true", f.RedirectBotnet, f.SafeSearch, f.LogAllDomains)
	}
	if f.YouTubeRestrict != "moderate" {
		t.Errorf("youtube_restrict = %q", f.YouTubeRestrict)
	}
	// "error-allow" present, "ftgd-disable" absent ⇒ category filter ON, rating-error ON.
	if !f.FortiGuardCategoryFilter || !f.AllowRatingError {
		t.Errorf("ftgd flags = %v/%v, want true/true", f.FortiGuardCategoryFilter, f.AllowRatingError)
	}
	if f.UseDefaultRedirectPortal || f.RedirectPortalIP != "1.2.3.4" {
		t.Errorf("portal = %v/%q, want specify 1.2.3.4", f.UseDefaultRedirectPortal, f.RedirectPortalIP)
	}
	if !f.DomainFilter {
		t.Error("domain_filter = false, want true (table 7 is referenced)")
	}
	if len(f.Categories) != 2 || f.Categories[0].Action != "block" || f.Categories[1].Action != "monitor" {
		t.Errorf("categories = %#v", f.Categories)
	}
	if !f.ExternalIPBlocklist || len(f.ExternalIPBlocklistNames) != 1 || f.ExternalIPBlocklistNames[0] != "feed1" {
		t.Errorf("external blocklist = %v/%#v", f.ExternalIPBlocklist, f.ExternalIPBlocklistNames)
	}
	// The ipv6 row carries src6/dst6 this form doesn't model — showing it as a blank IPv4 row
	// would silently drop it on the next save, so it must be filtered out.
	if len(f.DNSTranslationEntries) != 1 || f.DNSTranslationEntries[0].Src != "10.1.1.1" {
		t.Errorf("dns translations = %#v, want only the ipv4 row", f.DNSTranslationEntries)
	}
}

func TestFgToDNSFilterProfileForm_FtgdDisableAndDefaultPortal(t *testing.T) {
	for _, portal := range []string{"", "0.0.0.0"} {
		raw := json.RawMessage(`{"name":"p","redirect-portal":"` + portal +
			`","ftgd-dns":{"options":"ftgd-disable error-allow","filters":[]}}`)
		f := fgToDNSFilterProfileForm(raw)
		if f.FortiGuardCategoryFilter {
			t.Error("fortiguard_category_filter = true, want false when ftgd-disable is present")
		}
		if !f.AllowRatingError {
			t.Error("allow_rating_error = false, want true (error-allow is also present)")
		}
		if !f.UseDefaultRedirectPortal || f.RedirectPortalIP != "" {
			t.Errorf("portal %q → %v/%q, want default/empty", portal, f.UseDefaultRedirectPortal, f.RedirectPortalIP)
		}
	}
}

// A profile the user saved, read back and saved again must not drift.
func TestDNSFilterFormRoundTrip(t *testing.T) {
	orig := dnsForm(func(f *DNSFilterProfileForm) {
		f.RedirectBotnet = true
		f.SafeSearch = true
		f.YouTubeRestrict = "moderate"
		f.AllowRatingError = true
		f.LogAllDomains = true
		f.UseDefaultRedirectPortal = false
		f.RedirectPortalIP = "1.2.3.4"
		f.Categories = []DNSFilterCategoryAction{{Category: 1, Action: "block"}, {Category: 2, Action: "monitor"}}
		f.DNSTranslation = true
		f.DNSTranslationEntries = []DNSTranslationEntry{{Src: "10.1.1.1", Dst: "10.2.2.2", Netmask: "255.255.255.0", Status: "enable"}}
		f.ExternalIPBlocklist = true
		f.ExternalIPBlocklistNames = []string{"feed1"}
	})

	p := dnsPayload(t, orig)
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	back := fgToDNSFilterProfileForm(b)

	if back.Name != orig.Name || back.Comment != orig.Comment ||
		back.RedirectBotnet != orig.RedirectBotnet || back.SafeSearch != orig.SafeSearch ||
		back.YouTubeRestrict != orig.YouTubeRestrict || back.LogAllDomains != orig.LogAllDomains ||
		back.AllowRatingError != orig.AllowRatingError ||
		back.FortiGuardCategoryFilter != orig.FortiGuardCategoryFilter ||
		back.UseDefaultRedirectPortal != orig.UseDefaultRedirectPortal ||
		back.RedirectPortalIP != orig.RedirectPortalIP {
		t.Errorf("scalars drifted:\n orig=%+v\n back=%+v", orig, back)
	}
	if len(back.Categories) != 2 {
		t.Errorf("categories = %#v", back.Categories)
	}
	if len(back.DNSTranslationEntries) != 1 || !back.DNSTranslation {
		t.Errorf("translations = %v/%#v", back.DNSTranslation, back.DNSTranslationEntries)
	}
	if !back.ExternalIPBlocklist || len(back.ExternalIPBlocklistNames) != 1 {
		t.Errorf("blocklist = %v/%#v", back.ExternalIPBlocklist, back.ExternalIPBlocklistNames)
	}
}

// ─── validation ──────────────────────────────────────────────────────────────

func TestValidateDNSFilterForm(t *testing.T) {
	cases := []struct {
		name    string
		form    DNSFilterProfileForm
		wantErr string // substring; "" = must pass
	}{
		{"valid baseline", dnsForm(nil), ""},
		{"empty name", dnsForm(func(f *DNSFilterProfileForm) { f.Name = "  " }), "name is required"},
		{"bad category action", dnsForm(func(f *DNSFilterProfileForm) {
			f.Categories = []DNSFilterCategoryAction{{Category: 1, Action: "warning"}}
		}), "invalid action"},
		{"allow is a legal category action", dnsForm(func(f *DNSFilterProfileForm) {
			f.Categories = []DNSFilterCategoryAction{{Category: 1, Action: "allow"}}
		}), ""},
		{"empty domain", dnsForm(func(f *DNSFilterProfileForm) {
			f.DomainFilter = true
			f.DomainFilterEntries = []DNSDomainEntry{{Domain: " "}}
		}), "empty domain"},
		{"bad domain type", dnsForm(func(f *DNSFilterProfileForm) {
			f.DomainFilter = true
			f.DomainFilterEntries = []DNSDomainEntry{{Domain: "a.com", Type: "glob"}}
		}), "invalid type"},
		{"bad domain action", dnsForm(func(f *DNSFilterProfileForm) {
			f.DomainFilter = true
			f.DomainFilterEntries = []DNSDomainEntry{{Domain: "a.com", Action: "warning"}}
		}), "invalid action"},
		{"domain rules ignored while the toggle is off", dnsForm(func(f *DNSFilterProfileForm) {
			f.DomainFilter = false
			f.DomainFilterEntries = []DNSDomainEntry{{Domain: "", Type: "glob"}}
		}), ""},
		{"bad translation src", dnsForm(func(f *DNSFilterProfileForm) {
			f.DNSTranslation = true
			f.DNSTranslationEntries = []DNSTranslationEntry{{Src: "nope", Dst: "10.0.0.1"}}
		}), "original destination"},
		{"bad translation dst", dnsForm(func(f *DNSFilterProfileForm) {
			f.DNSTranslation = true
			f.DNSTranslationEntries = []DNSTranslationEntry{{Src: "10.0.0.1", Dst: "nope"}}
		}), "translated destination"},
		{"bad netmask", dnsForm(func(f *DNSFilterProfileForm) {
			f.DNSTranslation = true
			f.DNSTranslationEntries = []DNSTranslationEntry{{Src: "10.0.0.1", Dst: "10.0.0.2", Netmask: "nope"}}
		}), "network mask"},
		{"bad portal ip", dnsForm(func(f *DNSFilterProfileForm) {
			f.UseDefaultRedirectPortal = false
			f.RedirectPortalIP = "999.1.1.1"
		}), "not a valid IP"},
		{"good portal ip", dnsForm(func(f *DNSFilterProfileForm) {
			f.UseDefaultRedirectPortal = false
			f.RedirectPortalIP = "10.0.0.1"
		}), ""},
		{"blank external resource", dnsForm(func(f *DNSFilterProfileForm) {
			f.ExternalIPBlocklist = true
			f.ExternalIPBlocklistNames = []string{""}
		}), "empty name"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateDNSFilterForm(c.form)
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want no error, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, c.wantErr)
			}
		})
	}
}

func TestIsValidDNSVocabularies(t *testing.T) {
	for _, ok := range []string{"simple", "regex", "wildcard", "WILDCARD", " simple "} {
		if !isValidDNSDomainType(ok) {
			t.Errorf("isValidDNSDomainType(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "glob", "exact"} {
		if isValidDNSDomainType(bad) {
			t.Errorf("isValidDNSDomainType(%q) = true", bad)
		}
	}
	for _, ok := range []string{"allow", "monitor", "block", "BLOCK"} {
		if !isValidDNSFilterCategoryAction(ok) {
			t.Errorf("isValidDNSFilterCategoryAction(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "warning", "authenticate"} {
		if isValidDNSFilterCategoryAction(bad) {
			t.Errorf("isValidDNSFilterCategoryAction(%q) = true", bad)
		}
	}
}

// ─── CRUD against a fake FortiGate ───────────────────────────────────────────

type fgCall struct {
	Method string
	Path   string // path + raw query
	Body   map[string]interface{}
}

// fakeFortiGate records every request and answers with the FortiGate envelope. `results` maps
// "METHOD /path" (query stripped) to the results payload; anything unmapped returns {}.
//
// The recorder is mutex-guarded because net/http serves each connection on its own goroutine, and
// the client under test now issues independent reads CONCURRENTLY (services.Parallel — the metadata
// builders and the audit/trace loaders). Before that every request arrived one at a time and the
// unguarded append happened to be safe; `go test -race` flagged it the moment it was not.
//
// Callers read the slice only after the call under test has returned, and Parallel does not return
// until every goroutine has finished, so a plain dereference on the read side is still correct.
func fakeFortiGate(t *testing.T, results map[string]interface{}) (*FortiClient, *[]fgCall, func()) {
	t.Helper()
	calls := &[]fgCall{}
	var mu sync.Mutex
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			json.Unmarshal(b, &body) //nolint:errcheck
		}
		mu.Lock()
		*calls = append(*calls, fgCall{Method: r.Method, Path: r.URL.RequestURI(), Body: body})
		mu.Unlock()

		res, ok := results[r.Method+" "+r.URL.Path]
		if !ok {
			res = map[string]interface{}{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200, "results": res,
		})
	}))
	fc := newTestClient(srv.URL, srv.Client())
	return fc, calls, srv.Close
}

func findCall(calls []fgCall, method, pathPrefix string) *fgCall {
	for i := range calls {
		if calls[i].Method == method && strings.HasPrefix(calls[i].Path, pathPrefix) {
			return &calls[i]
		}
	}
	return nil
}

func TestCreateDNSFilterProfile(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.CreateDNSFilterProfile(dnsForm(func(f *DNSFilterProfileForm) {
		f.Categories = []DNSFilterCategoryAction{{Category: 1, Action: "block"}}
	})); err != nil {
		t.Fatalf("CreateDNSFilterProfile: %v", err)
	}

	c := findCall(*calls, "POST", "/api/v2/cmdb/dnsfilter/profile")
	if c == nil {
		t.Fatalf("no POST to dnsfilter/profile; calls = %+v", *calls)
	}
	// Every write must carry the vdom (the client appends it) — a VDOM device 403s without it.
	if !strings.Contains(c.Path, "vdom=root") {
		t.Errorf("POST path = %q, want it to carry vdom=root", c.Path)
	}
	if c.Body["name"] != "dns1" {
		t.Errorf("POST body name = %v, want dns1", c.Body["name"])
	}
}

func TestUpdateDNSFilterProfile_PutsToMkeyURL(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.UpdateDNSFilterProfile("my profile", dnsForm(nil)); err != nil {
		t.Fatalf("UpdateDNSFilterProfile: %v", err)
	}
	c := findCall(*calls, "PUT", "/api/v2/cmdb/dnsfilter/profile/")
	if c == nil {
		t.Fatalf("no PUT to dnsfilter/profile/<name>; calls = %+v", *calls)
	}
	// The name is part of the URL and must be escaped, not concatenated raw.
	if !strings.HasPrefix(c.Path, "/api/v2/cmdb/dnsfilter/profile/my%20profile") {
		t.Errorf("PUT path = %q, want the name percent-escaped", c.Path)
	}
}

// A DELETE must always name the object. A DELETE at the collection URL wipes the whole table —
// this project has lost every firewall policy that way once, so it is pinned here.
func TestDeleteDNSFilterProfile_ByMkeyNeverCollection(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.DeleteSecurityProfile("dnsfilter", "p1"); err != nil {
		t.Fatalf("DeleteSecurityProfile: %v", err)
	}
	c := findCall(*calls, "DELETE", "/api/v2/cmdb/dnsfilter/profile")
	if c == nil {
		t.Fatalf("no DELETE; calls = %+v", *calls)
	}
	if !strings.HasPrefix(c.Path, "/api/v2/cmdb/dnsfilter/profile/p1") {
		t.Fatalf("DELETE path = %q — must target /profile/<name>, never the collection", c.Path)
	}
}

// Turning Domain Filter on resolves (creating if needed) the named table, writes the rows into
// it, and links the profile to the id the device assigned.
func TestDNSFilterProfilePayload_CreatesAndLinksDomainFilterTable(t *testing.T) {
	listed := false
	calls := &[]fgCall{}
	// Guarded for the same reason as fakeFortiGate above: the handler runs on net/http's
	// per-connection goroutine, so `listed` and the recorder must not be touched unguarded even
	// though this particular flow (payload building) is still sequential.
	var mu sync.Mutex
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			json.Unmarshal(b, &body) //nolint:errcheck
		}
		mu.Lock()
		defer mu.Unlock()
		*calls = append(*calls, fgCall{Method: r.Method, Path: r.URL.RequestURI(), Body: body})

		var res interface{} = map[string]interface{}{}
		if r.Method == "GET" && r.URL.Path == "/api/v2/cmdb/dnsfilter/domain-filter" {
			// First list: no table yet. After the POST: the device has assigned id 3.
			if listed {
				res = []map[string]interface{}{{"id": 3, "name": "dns1"}}
			} else {
				res = []map[string]interface{}{}
				listed = true
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200, "results": res,
		})
	}))
	defer srv.Close()
	fc := newTestClient(srv.URL, srv.Client())

	p, err := fc.dnsFilterProfilePayload(dnsForm(func(f *DNSFilterProfileForm) {
		f.DomainFilter = true
		f.DomainFilterEntries = []DNSDomainEntry{
			{Domain: "*.facebook.com", Type: "wildcard", Action: "block", Status: "enable"},
		}
	}))
	if err != nil {
		t.Fatalf("dnsFilterProfilePayload: %v", err)
	}

	// The table is created under the profile's own name…
	created := findCall(*calls, "POST", "/api/v2/cmdb/dnsfilter/domain-filter")
	if created == nil || created.Body["name"] != "dns1" {
		t.Fatalf("table not created under the profile name; calls = %+v", *calls)
	}
	// …its rows are written by id…
	put := findCall(*calls, "PUT", "/api/v2/cmdb/dnsfilter/domain-filter/3")
	if put == nil {
		t.Fatalf("rows not written to the new table; calls = %+v", *calls)
	}
	entries, ok := put.Body["entries"].([]interface{})
	if !ok || len(entries) != 1 {
		t.Fatalf("entries = %#v, want 1 row", put.Body["entries"])
	}
	// …and the profile points at the id the device assigned, not a guessed one.
	df, _ := p["domain-filter"].(map[string]interface{})
	if df["domain-filter-table"] != 3 {
		t.Errorf("domain-filter-table = %v, want 3 (the id the device assigned)", df["domain-filter-table"])
	}
}

func TestGetDNSFilterProfile_FetchesDomainRows(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/dnsfilter/profile/p1": []map[string]interface{}{{
			"name":          "p1",
			"comment":       "hi",
			"domain-filter": map[string]interface{}{"domain-filter-table": 5},
			"ftgd-dns":      map[string]interface{}{"options": "", "filters": []interface{}{}},
		}},
		"GET /api/v2/cmdb/dnsfilter/domain-filter/5": []map[string]interface{}{{
			"entries": []map[string]interface{}{
				{"domain": "*.facebook.com", "type": "wildcard", "action": "block", "status": "enable"},
			},
		}},
	})
	defer done()

	form, err := fc.GetDNSFilterProfile("p1")
	if err != nil {
		t.Fatalf("GetDNSFilterProfile: %v", err)
	}
	if form.Name != "p1" || !form.DomainFilter {
		t.Fatalf("form = %+v, want p1 with domain_filter on", form)
	}
	if len(form.DomainFilterEntries) != 1 || form.DomainFilterEntries[0].Domain != "*.facebook.com" {
		t.Errorf("domain rows = %#v, want the row from table 5", form.DomainFilterEntries)
	}
	if findCall(*calls, "GET", "/api/v2/cmdb/dnsfilter/domain-filter/5") == nil {
		t.Error("the referenced domain-filter table was never read")
	}
}

// Domain Filter off ⇒ the table is not touched at all (no stray reads/writes).
func TestGetDNSFilterProfile_SkipsTableWhenOff(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/dnsfilter/profile/p1": []map[string]interface{}{{
			"name":          "p1",
			"domain-filter": map[string]interface{}{"domain-filter-table": 0},
			"ftgd-dns":      map[string]interface{}{"options": "", "filters": []interface{}{}},
		}},
	})
	defer done()

	form, err := fc.GetDNSFilterProfile("p1")
	if err != nil {
		t.Fatalf("GetDNSFilterProfile: %v", err)
	}
	if form.DomainFilter || len(form.DomainFilterEntries) != 0 {
		t.Errorf("domain filter = %v/%#v, want off/empty", form.DomainFilter, form.DomainFilterEntries)
	}
	if findCall(*calls, "GET", "/api/v2/cmdb/dnsfilter/domain-filter") != nil {
		t.Error("domain-filter table was read even though the profile references table 0")
	}
}

// Every list field must cross the wire as [] and never null. The form binds these straight to
// tables; a null arrives as `rows.map is not a function` the moment the user switches the
// matching toggle on. Caught on the live device, where a Domain-Filter-off profile returned
// "domain_filter_entries": null.
func TestGetDNSFilterProfile_ListFieldsAreNeverNull(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/dnsfilter/profile/p1": []map[string]interface{}{{
			"name":          "p1",
			"domain-filter": map[string]interface{}{"domain-filter-table": 0},
			"ftgd-dns":      map[string]interface{}{"options": "ftgd-disable", "filters": []interface{}{}},
		}},
	})
	defer done()

	form, err := fc.GetDNSFilterProfile("p1")
	if err != nil {
		t.Fatalf("GetDNSFilterProfile: %v", err)
	}
	b, err := json.Marshal(form)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"categories", "domain_filter_entries", "external_ip_blocklist_names", "dns_translation_entries",
	} {
		if strings.Contains(string(b), `"`+field+`":null`) {
			t.Errorf("%s marshalled as null — the form binds it to a table and would throw: %s", field, b)
		}
	}
}

// A failed table read must leave an empty slice, not put nil back.
func TestGetDNSFilterProfile_TableReadFailureKeepsEmptySlice(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v2/cmdb/dnsfilter/domain-filter") {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200,
			"results": []map[string]interface{}{{
				"name":          "p1",
				"domain-filter": map[string]interface{}{"domain-filter-table": 9},
				"ftgd-dns":      map[string]interface{}{"options": "", "filters": []interface{}{}},
			}},
		})
	}))
	defer srv.Close()
	fc := newTestClient(srv.URL, srv.Client())

	form, err := fc.GetDNSFilterProfile("p1")
	if err != nil {
		t.Fatalf("GetDNSFilterProfile: %v", err)
	}
	if form.DomainFilterEntries == nil {
		t.Error("DomainFilterEntries = nil after a failed table read, want an empty slice")
	}
}

func TestGetDNSFilterProfile_NotFound(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/dnsfilter/profile/nope": []map[string]interface{}{},
	})
	defer done()

	if _, err := fc.GetDNSFilterProfile("nope"); err == nil {
		t.Fatal("want an error for a profile the device doesn't have")
	}
}

func TestGetDNSFilterMetadata(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/webfilter/fortiguard-categories": []map[string]interface{}{
			{"id": 1, "name": "Drug Abuse", "group": "Potentially Liable", "group_id": 1,
				"rating": "R", "default_wf_action": "monitor", "blocked_in_ratings": []string{"G", "PG-13"}},
		},
		"GET /api/v2/monitor/license/status": map[string]interface{}{
			"web_filtering": map[string]interface{}{"status": "expired"},
			"botnet_domain": map[string]interface{}{"status": "expired"},
			"antivirus":     map[string]interface{}{"status": "licensed"},
		},
		"GET /api/v2/cmdb/system/external-resource": []map[string]interface{}{
			{"name": "ip-feed", "type": "address"},
			{"name": "domain-feed", "type": "domain"}, // wrong datasource for this field
		},
	})
	defer done()

	meta := fc.GetDNSFilterMetadata()
	if len(meta.Categories) != 1 || meta.Categories[0].Name != "Drug Abuse" {
		t.Errorf("categories = %#v", meta.Categories)
	}
	if meta.Categories[0].BlockedInRatings[0] != "G" {
		t.Errorf("blocked_in_ratings = %#v — the presets are derived from it", meta.Categories[0].BlockedInRatings)
	}
	// The lab device's real state: both expired ⇒ both banners show.
	if meta.WebFilterLicensed || meta.BotnetLicensed {
		t.Errorf("licences = %v/%v, want false/false for expired", meta.WebFilterLicensed, meta.BotnetLicensed)
	}
	if len(meta.ExternalResources) != 1 || meta.ExternalResources[0] != "ip-feed" {
		t.Errorf("external resources = %#v, want only the address-type feed", meta.ExternalResources)
	}
}

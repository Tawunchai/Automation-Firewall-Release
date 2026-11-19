package services

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The live-context builders: the part of the AI prompt that says what is ALREADY on the firewall.
//
// They were at 0% — which matters more here than the number suggests, because a wrong section does
// not fail. It produces a prompt the model answers confidently with a CLI block the device then
// refuses: a reused address that is pinned to another interface comes back "entry not found in
// datasource", a profile name that already exists comes back -5. Those are the failures these
// tests are about.
//
// Everything below runs against a fake FortiGate (newTestClient + httptest), so no device is
// involved and no credential is needed.

// fakeFGT answers a CMDB GET whose path contains one of the given fragments with that fragment's
// body, and 500s anything else — so a test states exactly which tables the device has, and a
// builder that reads a table the test did not name is caught rather than silently served "[]".
func fakeFGT(t *testing.T, bodies map[string]string) *FortiClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		for frag, body := range bodies {
			if strings.Contains(r.URL.Path, frag) {
				_, _ = fmt.Fprintf(w, `{"results":%s,"status":"success"}`, body)
				return
			}
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"status":"error","http_status":500}`))
	}))
	t.Cleanup(srv.Close)
	return newTestClient(srv.URL, srv.Client())
}

// ─── addresses ───────────────────────────────────────────────────────────────

// Each address type has to render as the value a person would recognise, because the model quotes
// these back as `set dstaddr "<name>"` and a human reviews the diff before Apply. A type rendered
// as the bare word "ipmask" tells the reviewer nothing.
func TestAddressesContext_RendersEveryTypeAsItsValue(t *testing.T) {
	fc := fakeFGT(t, map[string]string{"firewall/address": `[
		{"name":"LAN-NET","type":"ipmask","subnet":"10.0.0.0 255.255.255.0"},
		{"name":"POOL","type":"iprange","start-ip":"10.0.0.10","end-ip":"10.0.0.20"},
		{"name":"GOOGLE","type":"fqdn","fqdn":"www.google.com"},
		{"name":"TH","type":"geography","country":"TH"}
	]`})

	got := addressesContext(fc)
	for _, want := range []string{
		"LAN-NET = 10.0.0.0/24",
		"POOL = 10.0.0.10-10.0.0.20",
		"GOOGLE = www.google.com",
		"TH = geo:TH",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the address section does not contain %q.\n%s", want, got)
		}
	}
}

// associated-interface pins an address to ONE interface. FortiGate refuses it in a policy on any
// other interface with "entry not found in datasource", and the model cannot know which addresses
// are pinned unless the prompt says so — this is the section that says so.
func TestAddressesContext_MarksAnInterfaceBoundAddress(t *testing.T) {
	fc := fakeFGT(t, map[string]string{"firewall/address": `[
		{"name":"FREE","type":"ipmask","subnet":"10.0.0.0 255.255.255.0"},
		{"name":"DMZ-ONLY","type":"ipmask","subnet":"10.10.10.0 255.255.255.0","associated-interface":"dmz"}
	]`})

	got := addressesContext(fc)
	if !strings.Contains(got, "DMZ-ONLY = 10.10.10.0/24 [dmz]") {
		t.Errorf("a pinned address is not marked with its interface:\n%s", got)
	}
	if strings.Contains(got, "FREE = 10.0.0.0/24 [") {
		t.Errorf("an unpinned address was marked with an interface:\n%s", got)
	}
	if !strings.Contains(got, "usable ONLY on that interface") {
		t.Error("the heading does not explain what [iface] means, so the marker is decoration")
	}
}

// The section is capped, and a cap that does not SAY it is a cap is a lie: the model would treat
// the list as the whole device and invent a new address rather than reuse one it cannot see.
func TestAddressesContext_SaysWhenItHasTruncated(t *testing.T) {
	var rows []string
	for i := 0; i < 70; i++ {
		rows = append(rows, fmt.Sprintf(`{"name":"A%02d","type":"ipmask","subnet":"10.0.%d.0 255.255.255.0"}`, i, i))
	}
	fc := fakeFGT(t, map[string]string{"firewall/address": "[" + strings.Join(rows, ",") + "]"})

	got := addressesContext(fc)
	if !strings.Contains(got, "(more not shown)") {
		t.Error("70 addresses were listed without saying the list is incomplete")
	}
	if strings.Contains(got, "A69") {
		t.Error("the cap did not apply")
	}
	if !strings.Contains(got, "A00") {
		t.Error("the cap dropped the start of the list instead of the end")
	}
}

// A device that will not answer must produce NO section, not an empty-looking one. "" means the
// model is told nothing about addresses; a heading with no rows under it reads as "this firewall
// has no address objects", which is the one thing it must never say when the read failed.
func TestAddressesContext_IsSilentWhenTheReadFails(t *testing.T) {
	fc := fakeFGT(t, nil) // every path 500s
	if got := addressesContext(fc); got != "" {
		t.Errorf("a failed read produced a section: %q", got)
	}
}

func TestAddressesContext_IsSilentOnAnEmptyTable(t *testing.T) {
	fc := fakeFGT(t, map[string]string{"firewall/address": `[]`})
	if got := addressesContext(fc); got != "" {
		t.Errorf("an empty table produced a section: %q", got)
	}
}

// ─── services ────────────────────────────────────────────────────────────────

func TestServicesContext_ListsNamesAndIsSilentOnFailure(t *testing.T) {
	fc := fakeFGT(t, map[string]string{"firewall.service": `[{"name":"HTTPS"},{"name":"DNS"}]`})
	got := servicesContext(fc)
	if !strings.Contains(got, "HTTPS") || !strings.Contains(got, "DNS") {
		t.Errorf("service names missing:\n%s", got)
	}
	if !strings.Contains(got, "SERVICE OBJECTS") {
		t.Errorf("the section has no heading, so the model cannot tell what the list is:\n%s", got)
	}

	if got := servicesContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a failed read produced a section: %q", got)
	}
}

// ─── security profile names ──────────────────────────────────────────────────

// This section exists to stop the model proposing a profile name that already exists, which
// FortiGate refuses with -5. A section that omits a profile the device has is therefore not a
// cosmetic gap — it is the input that produces the failed Apply.
func TestSecurityProfileNamesContext_NamesEachKindItFinds(t *testing.T) {
	fc := fakeFGT(t, map[string]string{
		"antivirus/profile": `[{"name":"av-strict"}]`,
		"dnsfilter/profile": `[{"name":"dns-default"}]`,
		"file-filter":       `[{"name":"ff-exe"}]`,
	})
	got := securityProfileNamesContext(fc)
	for _, want := range []string{"ANTIVIRUS PROFILES", "av-strict", "DNS FILTER PROFILES", "dns-default",
		"FILE FILTER PROFILES", "ff-exe"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q:\n%s", want, got)
		}
	}
}

// One kind failing must not take the others down with it: the model should still be told about the
// profiles the device DID answer for.
func TestSecurityProfileNamesContext_KeepsTheKindsThatAnswered(t *testing.T) {
	fc := fakeFGT(t, map[string]string{"antivirus/profile": `[{"name":"av-strict"}]`})
	got := securityProfileNamesContext(fc)
	if !strings.Contains(got, "av-strict") {
		t.Errorf("the one readable kind was dropped because the others failed:\n%s", got)
	}
	if strings.Contains(got, "DNS FILTER PROFILES") {
		t.Errorf("a heading was written for a kind that could not be read:\n%s", got)
	}
}

func TestSecurityProfileNamesContext_IsSilentWhenNothingAnswers(t *testing.T) {
	if got := securityProfileNamesContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a wholly unreadable device produced a section: %q", got)
	}
}

// ─── policies, VIPs, schedules ───────────────────────────────────────────────

func TestPolicyNamesContext_IsSilentWhenTheReadFails(t *testing.T) {
	if got := policyNamesContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a failed policy read produced a section: %q", got)
	}
}

func TestVirtualIPsContext_IsSilentWhenTheReadFails(t *testing.T) {
	if got := virtualIPsContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a failed VIP read produced a section: %q", got)
	}
}

func TestSchedulesContext_IsSilentWhenTheReadFails(t *testing.T) {
	if got := schedulesContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a failed schedule read produced a section: %q", got)
	}
}

// ─── a read that failed is not an empty device ───────────────────────────────

// These two sections cannot stay silent — they carry standing instructions the model needs either
// way — so what matters is WHAT they say when the read failed. They used to say "none", which is
// the prompt asserting as fact something it does not know: the model then proposes creating a user
// or an LDAP server that already exists, and FortiGate refuses the Apply with -5. (This is the
// project's own "a read failure is not an empty list" rule, which the frontend enforces with
// `{ strict: true }` and this builder did not.)
func TestUsersAndGroupsContext_DoesNotClaimTheDeviceIsEmptyWhenTheReadFailed(t *testing.T) {
	got := usersAndGroupsContext(fakeFGT(t, nil))
	if strings.Contains(got, "EXISTING USERS: none") {
		t.Errorf("a failed read is reported as an empty device:\n%s", got)
	}
	if !strings.Contains(got, "could not be read") {
		t.Errorf("a failed read does not say so:\n%s", got)
	}
}

func TestUsersAndGroupsContext_StillSaysNoneWhenTheDeviceReallyIsEmpty(t *testing.T) {
	got := usersAndGroupsContext(fakeFGT(t, map[string]string{
		"user/local": `[]`, "user/group": `[]`, "user/fortitoken": `[]`,
	}))
	if !strings.Contains(got, "EXISTING USERS: none") {
		t.Errorf("a genuinely empty device no longer reads as empty:\n%s", got)
	}
}

func TestAuthServersContext_DoesNotClaimTheDeviceIsEmptyWhenTheReadFailed(t *testing.T) {
	got := authServersContext(fakeFGT(t, nil))
	for _, lie := range []string{"EXISTING LDAP SERVERS: none.", "EXISTING RADIUS SERVERS: none."} {
		if strings.Contains(got, lie) {
			t.Errorf("a failed read is reported as an empty device (%q):\n%s", lie, got)
		}
	}
	if strings.Count(got, "could not be read") != 2 {
		t.Errorf("both failed reads should say so:\n%s", got)
	}
}

func TestAuthServersContext_StillSaysNoneWhenTheDeviceReallyIsEmpty(t *testing.T) {
	got := authServersContext(fakeFGT(t, map[string]string{
		"user/ldap": `[]`, "user/radius": `[]`, "vpn.certificate/ca": `[]`, "user/exchange": `[]`,
	}))
	if !strings.Contains(got, "EXISTING LDAP SERVERS: none.") ||
		!strings.Contains(got, "EXISTING RADIUS SERVERS: none.") {
		t.Errorf("a genuinely empty device no longer reads as empty:\n%s", got)
	}
}

func TestSDWANContext_IsSilentWhenTheReadFails(t *testing.T) {
	if got := sdwanContext(fakeFGT(t, nil)); got != "" {
		t.Errorf("a failed SD-WAN read produced a section: %q", got)
	}
}

// The file-type catalogue is NOT device data — the 56 antivirus.filetype names are a fixed FortiOS
// datasource, and an invented one is "-3 entry not found in datasource". So this section must
// survive a dead device: the names are still correct, and withholding them is what makes the model
// guess. Pinned because it looks like the others and is deliberately not.
func TestFileFilterContext_StillServesTheCatalogueWhenTheDeviceIsUnreachable(t *testing.T) {
	got := fileFilterContext(fakeFGT(t, nil))
	if !strings.Contains(got, "FILE FILTER TYPES") {
		t.Fatalf("the fixed file-type catalogue was withheld because a device read failed:\n%s", got)
	}
	for _, want := range []string{"msofficex", "password-protected"} {
		if !strings.Contains(got, want) {
			t.Errorf("the catalogue is missing %q:\n%s", want, got)
		}
	}
}

// ─── the builders that also return a lookup table ────────────────────────────

// These three hand the applier a map as well as prompt text. A failed read must leave the text
// empty AND the map usable (empty, not nil-dereferenced) — the applier indexes it without checking.
func TestWebAndDNSBuilders_DegradeWithoutLosingTheirLookups(t *testing.T) {
	fc := fakeFGT(t, nil)

	// Its map is keyed by the three table KINDS and is always present; what must be empty is the
	// id list under each, because an id the applier believes is taken makes it pick a different
	// mkey, and an id it believes is free makes it OVERWRITE a live table.
	txt, ids := webfilterTableIDContext(fc)
	if txt != "" {
		t.Errorf("webfilterTableIDContext wrote a section for a dead device: %q", txt)
	}
	for kind, list := range ids {
		if len(list) != 0 {
			t.Errorf("a dead device yielded %d %s table ids: %v", len(list), kind, list)
		}
	}
	for _, kind := range []string{"urlfilter", "content", "dns-domain-filter"} {
		if _, ok := ids[kind]; !ok {
			t.Errorf("the lookup is missing the %q key, which the applier indexes without checking", kind)
		}
	}
	if txt, cov := existingWebFilterContext(fc); txt != "" || len(cov) != 0 {
		t.Errorf("existingWebFilterContext on a dead device: text %q, %d entries", txt, len(cov))
	}
	if txt, cov := existingDNSFilterContext(fc); txt != "" || len(cov) != 0 {
		t.Errorf("existingDNSFilterContext on a dead device: text %q, %d entries", txt, len(cov))
	}
	if txt, cov := existingAppListsContext(fc, AppControlMetadata{}); txt != "" || len(cov) != 0 {
		t.Errorf("existingAppListsContext on a dead device: text %q, %d entries", txt, len(cov))
	}
}

// ─── the prompt-cache invariant ──────────────────────────────────────────────

// The assembled sections are prompt-cached by Anthropic, which keys on a byte-for-byte prefix
// match. Every section is fetched concurrently, so if the assembly order depended on which read
// finished first the prompt would differ run to run and the cache would never hit — a silent
// latency and cost regression, with nothing failing. Pin the invariant where it is cheap: the same
// device twice must produce the same string.
func TestContextAssemblyIsOrderStable(t *testing.T) {
	bodies := map[string]string{
		"firewall/address":  `[{"name":"LAN","type":"ipmask","subnet":"10.0.0.0 255.255.255.0"}]`,
		"firewall.service":  `[{"name":"HTTPS"},{"name":"DNS"}]`,
		"antivirus/profile": `[{"name":"av-strict"}]`,
		"dnsfilter/profile": `[{"name":"dns-default"}]`,
	}
	build := func() string {
		fc := fakeFGT(t, bodies)
		return addressesContext(fc) + servicesContext(fc) + securityProfileNamesContext(fc)
	}
	first := build()
	for i := 0; i < 5; i++ {
		if got := build(); got != first {
			t.Fatalf("the assembled context is not stable across runs — prompt caching cannot hit.\nrun %d:\n%s\nfirst:\n%s", i, got, first)
		}
	}
	if first == "" {
		t.Fatal("the fixture produced nothing, so this test proves nothing")
	}
}

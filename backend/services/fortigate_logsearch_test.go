package services

import (
	"errors"
	"strings"
	"testing"
)

// The filter language is the most dangerous part of this feature, because the device VALIDATES
// NOTHING and fails in both directions:
//
//	filter=zzz==qqq        → 200, total_lines 0   a typo looks like "your firewall saw nothing"
//	filter=action=deny     → 200, ALL 34 rows     a bare `=` matches everything, not one action
//
// Both were measured against the lab FGT80E. The second is the worse one: the page would look
// filtered while showing unfiltered data. Everything below exists to make those two impossible.

// The filter strings a search becomes — what is actually sent to the device. They come off the
// terms, because a term now carries both halves: the string the firewall is asked for and the
// clauses this process checks its answer against.
func build(t *testing.T, search string) []string {
	t.Helper()
	terms, err := BuildLogSearch(search)
	if err != nil {
		t.Fatalf("BuildLogSearch(%q): %v", search, err)
	}
	filters := make([]string, 0, len(terms))
	for _, term := range terms {
		filters = append(filters, term.Filter)
	}
	return filters
}

func buildErr(t *testing.T, search string) error {
	t.Helper()
	_, err := BuildLogSearch(search)
	if err == nil {
		t.Fatalf("BuildLogSearch(%q) accepted a search it should have refused", search)
	}
	return err
}

func TestBuildSearchFilter_EmptySearchMeansEverything(t *testing.T) {
	for _, s := range []string{"", "   ", "\t\n"} {
		if got := build(t, s); len(got) != 0 {
			t.Errorf("BuildSearchFilter(%q) = %v, want no filters", s, got)
		}
	}
}

// ── Free text ────────────────────────────────────────────────────────────────

func TestBuildSearchFilter_BareIPSearchesBothEnds(t *testing.T) {
	got := build(t, "10.0.99.201")
	if len(got) != 1 {
		t.Fatalf("got %d filters, want 1 (an OR is a comma inside ONE parameter)", len(got))
	}
	// OR is a comma; AND would be a second parameter. Confusing the two turns "either end" into
	// "both ends at once", which matches nothing.
	if got[0] != "srcip==10.0.99.201,dstip==10.0.99.201" {
		t.Errorf("got %q", got[0])
	}
}

func TestBuildSearchFilter_BareNumberSearchesPortsAndIDs(t *testing.T) {
	got := build(t, "443")
	if !strings.Contains(got[0], "dstport==443") || !strings.Contains(got[0], "srcport==443") {
		t.Errorf("got %q, want the port fields", got[0])
	}
	// Exact, not wildcarded: 443 is not "part of" 4433.
	if strings.Contains(got[0], "*") {
		t.Errorf("a number must be matched exactly, got %q", got[0])
	}
}

func TestBuildSearchFilter_BareWordIsWildcarded(t *testing.T) {
	got := build(t, "deny")
	if !strings.Contains(got[0], "action=*deny*") {
		t.Errorf("got %q, want action=*deny* so that a partial word matches", got[0])
	}
	// `=*value*` — a single `=` with stars in the value. Verified: `action=*de*` matches the deny
	// rows while `action=deny` matches everything.
	if strings.Contains(got[0], "action==*deny*") {
		t.Error("a wildcard pattern must use a single `=`, not `==`")
	}
}

// `action=**deny**` was measured to match ZERO rows while `action=*de*` matches 15. A doubled star
// does not widen the search — it silently kills it.
func TestBuildSearchFilter_NeverEmitsADoubledWildcard(t *testing.T) {
	for _, search := range []string{"*deny*", "*deny", "deny*", "*"} {
		got := build(t, search)
		if strings.Contains(got[0], "**") {
			t.Errorf("BuildSearchFilter(%q) produced a doubled star: %q", search, got[0])
		}
	}
	// Someone's own pattern is passed through as written rather than being wrapped again.
	if got := build(t, "*deny*"); !strings.Contains(got[0], "action=*deny*") {
		t.Errorf("got %q", got[0])
	}
}

// ── Structured terms ─────────────────────────────────────────────────────────

func TestBuildSearchFilter_StructuredTermIsSentAsWritten(t *testing.T) {
	cases := map[string]string{
		"action==deny":   "action==deny",
		"action!=deny":   "action!=deny",
		"dstport>=1024":  "dstport>=1024",
		"sentbyte>100":   "sentbyte>100",
		"srcip==1.2.3.4": "srcip==1.2.3.4",
	}
	for search, want := range cases {
		if got := build(t, search); got[0] != want {
			t.Errorf("BuildSearchFilter(%q)[0] = %q, want %q", search, got[0], want)
		}
	}
}

// THE ONE THAT FAILS OPEN. A single `=` with no wildcard matched every row in the buffer, so it
// must become `==` — otherwise the page shows unfiltered data under a filter.
func TestBuildSearchFilter_BareEqualsBecomesExactMatch(t *testing.T) {
	got := build(t, "action=deny")
	if got[0] != "action==deny" {
		t.Errorf("got %q, want action==deny — a bare `=` matches EVERYTHING on the device", got[0])
	}
}

func TestBuildSearchFilter_BareEqualsWithAWildcardStaysAWildcard(t *testing.T) {
	// Here the `=` is doing real work and must not be normalised away.
	got := build(t, "app=*Teams*")
	if got[0] != "app=*Teams*" {
		t.Errorf("got %q, want the wildcard preserved", got[0])
	}
}

// ── Refusals ─────────────────────────────────────────────────────────────────

func TestBuildSearchFilter_UnknownFieldIsRefusedNotForwarded(t *testing.T) {
	err := buildErr(t, "srcipp==1.1.1.1")

	var se *LogSearchError
	if !errors.As(err, &se) {
		t.Fatalf("error type = %T, want *LogSearchError so the handler can answer 400", err)
	}
	// The message has to name the field; "invalid search" would leave someone re-typing the same
	// typo.
	if !strings.Contains(err.Error(), "srcipp") {
		t.Errorf("error %q does not name the offending field", err)
	}
}

func TestBuildSearchFilter_NumericFieldRejectsAWord(t *testing.T) {
	// `dstport==https` is accepted by the device and matches nothing — another silent zero.
	err := buildErr(t, "dstport==https")
	if !strings.Contains(err.Error(), "number") {
		t.Errorf("error %q should explain that the field holds a number", err)
	}
}

func TestBuildSearchFilter_IPFieldRejectsSomethingThatIsNotAnAddress(t *testing.T) {
	err := buildErr(t, "srcip==server01")
	if !strings.Contains(err.Error(), "IP address") {
		t.Errorf("error %q should explain that the field holds an address", err)
	}
	// …and should point at the way to do a partial match.
	if !strings.Contains(err.Error(), "srcip=*server01*") {
		t.Errorf("error %q should suggest the wildcard form", err)
	}
}

func TestBuildSearchFilter_PartialAddressGoesThroughAsAWildcard(t *testing.T) {
	// The refusal above must not block the legitimate way to search part of an address.
	if got := build(t, "srcip=*10.0.*"); got[0] != "srcip=*10.0.*" {
		t.Errorf("got %q", got[0])
	}
}

func TestBuildSearchFilter_MissingValueIsRefused(t *testing.T) {
	err := buildErr(t, "action==")
	if !strings.Contains(err.Error(), "no value") {
		t.Errorf("error %q should say the value is missing", err)
	}
}

func TestBuildSearchFilter_UnclosedQuoteIsRefused(t *testing.T) {
	// Silently closing it would search for a value nobody asked for and report no results.
	err := buildErr(t, `app=="Microsoft Teams`)
	if !strings.Contains(err.Error(), "quote") {
		t.Errorf("error %q should mention the quote", err)
	}
}

// ── Several terms ────────────────────────────────────────────────────────────

func TestBuildSearchFilter_SpaceSeparatedTermsAreANDed(t *testing.T) {
	got := build(t, "action==deny 10.10.20.227")
	// Two SEPARATE filters — the caller repeats the parameter, which is how the device spells AND.
	if len(got) != 2 {
		t.Fatalf("got %d filters, want 2", len(got))
	}
	if got[0] != "action==deny" {
		t.Errorf("first term = %q", got[0])
	}
	if !strings.Contains(got[1], "srcip==10.10.20.227") {
		t.Errorf("second term = %q", got[1])
	}
}

func TestBuildSearchFilter_QuotedPhraseStaysOneTerm(t *testing.T) {
	got := build(t, `app=="Web Management(HTTPS)"`)
	if len(got) != 1 {
		t.Fatalf("got %d filters, want 1 — the quotes hold the phrase together", len(got))
	}
	if got[0] != "app==Web Management(HTTPS)" {
		t.Errorf("got %q", got[0])
	}
}

func TestBuildSearchFilter_ADottedWordIsNotMistakenForATerm(t *testing.T) {
	// "10.0.99.201" contains no operator, so it must fall through to the free-text branch rather
	// than being split on something.
	got := build(t, "10.0.99.201")
	if !strings.HasPrefix(got[0], "srcip==") {
		t.Errorf("got %q, want the free-text IP branch", got[0])
	}
}

func TestBuildSearchFilter_FieldNamesAreCaseInsensitive(t *testing.T) {
	if got := build(t, "SrcIP==1.2.3.4"); got[0] != "srcip==1.2.3.4" {
		t.Errorf("got %q, want the field lowercased for the device", got[0])
	}
}

func TestLogSearchFields_AreListedForTheUI(t *testing.T) {
	fields := logSearchFieldNames()
	if len(fields) < 20 {
		t.Fatalf("got %d fields, expected the whole known set", len(fields))
	}
	// Sorted, so the hint the UI shows is stable between renders.
	for i := 1; i < len(fields); i++ {
		if fields[i-1] > fields[i] {
			t.Fatalf("fields are not sorted: %q before %q", fields[i-1], fields[i])
		}
	}
	// Spot-check that the ones the UI's ⊕ menu offers really are accepted.
	for _, want := range []string{"srcip", "dstip", "dstport", "action", "service", "app", "user"} {
		if _, ok := logSearchFields[want]; !ok {
			t.Errorf("%q is offered by the UI but not on the known list", want)
		}
	}
}

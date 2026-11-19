package services

import "testing"

// The device applies a single-field term but ignores the comma-OR form a free-text search becomes,
// accepting it and returning every row. These pin the substitute — and, more importantly, pin that
// a search NARROWS, because the bug being fixed here is a page that looked filtered while showing
// unfiltered data.

func matchRow(over func(*FGTrafficLog)) FGTrafficLog {
	r := FGTrafficLog{
		VDom:       "root",
		Subtype:    "local",
		Level:      "notice",
		SrcIP:      "10.0.99.201",
		SrcIntf:    "root",
		SrcPort:    intp(1883),
		DstIP:      "173.243.140.16",
		DstIntf:    "port1",
		DstPort:    intp(443),
		DstCountry: "United States",
		Proto:      6,
		ProtoName:  "TCP",
		Action:     "accept",
		Service:    "HTTPS",
		App:        "HTTPS.BROWSER",
		SentByte:   4000,
		RcvdByte:   9000,
		PolicyID:   intp(0),
	}
	if over != nil {
		over(&r)
	}
	return r
}

/** Parse a search the way the handler does, then apply it. */
func searchMatches(t *testing.T, search string, r FGTrafficLog) bool {
	t.Helper()
	terms, err := BuildLogSearch(search)
	if err != nil {
		t.Fatalf("BuildLogSearch(%q) = %v", search, err)
	}
	return MatchLogRow(&r, terms)
}

func TestMatchLogRow_NarrowsOnEveryField(t *testing.T) {
	// The device applies these itself, and this agrees with it rather than replacing it — every
	// term is re-checked so that no branch has to decide which forms this firmware honours. Each
	// is checked both ways round.
	cases := []struct {
		search string
		want   bool
	}{
		{"srcip==10.0.99.201", true},
		{"srcip==10.0.99.202", false},
		{"dstip==173.243.140.16", true},
		{"dstip==8.8.8.8", false},
		{"dstport==443", true},
		{"dstport==80", false},
		{"action==accept", true},
		{"action==server-rst", false},
		{"service==HTTPS", true},
		{"service==NTP", false},
		{"dstcountry==\"United States\"", true},
		{"dstcountry==Canada", false},
	}
	for _, c := range cases {
		if got := searchMatches(t, c.search, matchRow(nil)); got != c.want {
			t.Errorf("%s matched %v, want %v", c.search, got, c.want)
		}
	}
}

func TestMatchLogRow_TermsAreANDed(t *testing.T) {
	// Space means AND, matching the device's own semantics. One term failing must reject the row
	// even when the other matches — the case where a half-applied filter is most convincing.
	r := matchRow(nil)
	if !searchMatches(t, "action==accept dstport==443", r) {
		t.Error("both terms match, want the row kept")
	}
	if searchMatches(t, "action==accept dstport==80", r) {
		t.Error("second term does not match, want the row dropped")
	}
}

func TestMatchLogRow_FreeTextIsAnORAcrossFields(t *testing.T) {
	// THIS is the form the device ignores. A bare word looks in a dozen fields at once, wildcarded,
	// so typing "goog" finds "Google.Services"; any one field matching is enough. Before this was
	// applied here, "none of them matched" came back as the entire log.
	r := matchRow(func(x *FGTrafficLog) { x.App = "Google.Services" })
	if !searchMatches(t, "goog", r) {
		t.Error("free text should have matched app")
	}
	if !searchMatches(t, "accept", r) {
		t.Error("free text should have matched action")
	}
	if searchMatches(t, "zzz", r) {
		t.Error("free text matched a word that is in no field")
	}
}

func TestMatchLogRow_BareAddressAndPortAreExact(t *testing.T) {
	// A partial match on an address is meaningless: 10.0.99.201 is not "part of" 110.0.99.2018.
	r := matchRow(nil)
	if !searchMatches(t, "10.0.99.201", r) {
		t.Error("a bare address should match srcip")
	}
	if searchMatches(t, "10.0.99.20", r) {
		t.Error("a bare address must not match as a prefix")
	}
	// A bare number is looked for in the port fields first.
	if !searchMatches(t, "443", r) {
		t.Error("a bare number should match dstport")
	}
}

func TestMatchLogRow_ComparisonsAreNumeric(t *testing.T) {
	r := matchRow(nil)
	for _, c := range []struct {
		search string
		want   bool
	}{
		{"sentbyte>1000", true},
		{"sentbyte>9000", false},
		{"dstport>=443", true},
		{"dstport<443", false},
		{"dstport!=443", false},
		{"dstport!=80", true},
	} {
		if got := searchMatches(t, c.search, r); got != c.want {
			t.Errorf("%s = %v, want %v", c.search, got, c.want)
		}
	}
}

func TestMatchLogRow_AnAbsentFieldIsNotAnEmptyOne(t *testing.T) {
	// FortiOS OMITS a port on an ICMP row rather than sending zero. Treating absent as "" would
	// make `srcport==0` match it, which is a port number that was never on the wire.
	icmp := matchRow(func(r *FGTrafficLog) { r.SrcPort = nil; r.DstPort = nil; r.Proto = 1 })
	if searchMatches(t, "dstport==0", icmp) {
		t.Error("an omitted port must not read as zero")
	}
	// But it genuinely differs from any value, which is what != asks.
	if !searchMatches(t, "dstport!=443", icmp) {
		t.Error("a row with no port does have a port other than 443")
	}
}

func TestMatchLogRow_NoTermsKeepsEverything(t *testing.T) {
	// An empty search is "show everything", and must not become "show nothing" — the exact
	// direction this page must never be wrong in.
	if !MatchLogRow(&[]FGTrafficLog{matchRow(nil)}[0], nil) {
		t.Error("an empty search dropped a row")
	}
}

func TestGlobMatch(t *testing.T) {
	// `*` is the only metacharacter the filter language has, so a dot is a full stop.
	cases := []struct {
		pattern, s string
		want       bool
	}{
		{"*deny*", "deny", true},
		{"*de*", "server-rst", false},
		{"*rst*", "server-rst", true},
		{"server*", "server-rst", true},
		{"*rst", "server-rst", true},
		{"*rst", "rst-server", false},
		{"HTTPS", "https", true},
		{"h.tps", "httpsx", false},
		{"*fortinet.net*", "globalgip.fortinet.net", true},
		{"*fortinetXnet*", "globalgip.fortinet.net", false},
	}
	for _, c := range cases {
		if got := globMatch(c.pattern, c.s); got != c.want {
			t.Errorf("globMatch(%q, %q) = %v, want %v", c.pattern, c.s, got, c.want)
		}
	}
}

func TestBuildLogSearch_SendsAndChecksTheSameThing(t *testing.T) {
	// What is asked of the firewall and what is applied to its answer come from one parse, so the
	// two cannot describe different searches.
	terms, err := BuildLogSearch("action==deny dstport>=1024")
	if err != nil {
		t.Fatal(err)
	}
	if len(terms) != 2 {
		t.Fatalf("terms = %d, want 2", len(terms))
	}
	if terms[0].Filter != "action==deny" || terms[0].Clauses[0].Field != "action" {
		t.Errorf("term 0 = %+v", terms[0])
	}
	if terms[1].Filter != "dstport>=1024" || terms[1].Clauses[0].Op != ">=" {
		t.Errorf("term 1 = %+v", terms[1])
	}
}

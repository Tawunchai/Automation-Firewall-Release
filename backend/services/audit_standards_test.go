package services

import (
	"sort"
	"strings"
	"testing"
)

// The catalogue is data, and data rots quietly. These tests are the only thing standing between a
// half-finished edit and a customer-facing document that cites a control that does not exist or
// omits a version.

func TestEveryCheckHasControls(t *testing.T) {
	for _, check := range AuditChecks {
		if len(ControlsForCheck(check)) == 0 {
			t.Errorf("check %q has no control mapping — it would appear in the report with no standards at all", check)
		}
	}
}

func TestCatalogueHasNoOrphanChecks(t *testing.T) {
	known := map[string]bool{}
	for _, c := range AuditChecks {
		known[c] = true
	}
	for check := range controlCatalogue {
		if !known[check] {
			t.Errorf("catalogue maps %q, which the audit engine never emits — AuditChecks and the engine have drifted apart", check)
		}
	}
}

// Every reference must be quotable. A control id with no framework, no version or no title is
// worse than no mapping at all: it looks authoritative and says nothing.
func TestEveryControlRefIsComplete(t *testing.T) {
	for _, check := range AuditChecks {
		for _, ref := range ControlsForCheck(check) {
			switch {
			case ref.FrameworkID == "":
				t.Errorf("%s: control %q has no framework id", check, ref.ID)
			case ref.Framework == "":
				t.Errorf("%s: control %q has no framework name", check, ref.ID)
			case ref.Version == "":
				t.Errorf("%s: control %q (%s) has no version — control numbers move between framework versions, so an unversioned citation is unusable", check, ref.ID, ref.Framework)
			case ref.ID == "":
				t.Errorf("%s: a %s reference has no control id", check, ref.Framework)
			case ref.Title == "":
				t.Errorf("%s: control %s %s has no title", check, ref.Framework, ref.ID)
			case ref.Strength != StrengthDirect && ref.Strength != StrengthSupporting:
				t.Errorf("%s: control %s %s has strength %q, which is neither direct nor supporting", check, ref.Framework, ref.ID, ref.Strength)
			}
		}
	}
}

// FSBP ids belong to Fortinet's checks, not ours. The Security Rating relay that used to carry them
// straight from the device has been removed, so no FSBP id reaches the UI from anywhere now. If one
// ever appears in this catalogue it means somebody attributed our interpretation to the vendor.
func TestCatalogueNeverClaimsFSBP(t *testing.T) {
	for _, check := range AuditChecks {
		for _, ref := range ControlsForCheck(check) {
			if strings.EqualFold(ref.FrameworkID, "fsbp") || strings.EqualFold(ref.Framework, "FSBP") {
				t.Errorf("%s cites FSBP %s — FSBP ids may only be relayed from the device, never asserted by this catalogue", check, ref.ID)
			}
		}
	}
}

func TestControlsForCheckDoesNotAliasTheCatalogue(t *testing.T) {
	got := ControlsForCheck("policy-any-any")
	if len(got) == 0 {
		t.Fatal("policy-any-any lost its mapping")
	}
	got[0].Title = "mutated by a caller"
	if controlCatalogue["policy-any-any"][0].Title == "mutated by a caller" {
		t.Error("ControlsForCheck handed out the catalogue's own slice — one careless caller would rewrite the mapping for every request in the process")
	}
}

// ── Coverage ────────────────────────────────────────────────────────────────

func findFramework(t *testing.T, cov []FrameworkCoverage, id string) FrameworkCoverage {
	t.Helper()
	for _, fc := range cov {
		if fc.ID == id {
			return fc
		}
	}
	t.Fatalf("framework %q missing from coverage", id)
	return FrameworkCoverage{}
}

func findControl(t *testing.T, fc FrameworkCoverage, id string) ControlCoverage {
	t.Helper()
	for _, c := range fc.Controls {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("control %q missing from %s coverage", id, fc.Name)
	return ControlCoverage{}
}

func TestCleanScanEvidencesEveryAssessedControl(t *testing.T) {
	cov := BuildStandardsCoverage(nil, nil)
	for _, fc := range cov {
		if len(fc.Controls) == 0 {
			t.Errorf("%s has no controls at all", fc.Name)
		}
		if fc.Gaps != 0 {
			t.Errorf("%s reports %d gaps on a scan with no findings", fc.Name, fc.Gaps)
		}
		if fc.Observations != 0 {
			t.Errorf("%s reports %d observations on a scan with no findings", fc.Name, fc.Observations)
		}
		// The controls this console assesses are all evidenced; the ones it does not are all
		// not-assessed. Anything left over means a control fell into a status with no cause.
		if fc.Evidenced != fc.Assessed {
			t.Errorf("%s: %d of %d ASSESSED controls evidenced on a clean scan", fc.Name, fc.Evidenced, fc.Assessed)
		}
		if fc.Assessed+fc.NotAssessed != len(fc.Controls) {
			t.Errorf("%s: %d assessed + %d not assessed != %d controls - the denominator does not add up",
				fc.Name, fc.Assessed, fc.NotAssessed, len(fc.Controls))
		}
	}
}

// The whole point of the control-first rewrite: a clean scan must not be able to imply that the
// framework was covered. If this ever passes with zero not-assessed rows, the universe has silently
// shrunk back to "whatever we happen to check".
func TestEveryFrameworkAdmitsWhatItDoesNotCheck(t *testing.T) {
	for _, fc := range BuildStandardsCoverage(nil, nil) {
		if fc.NotAssessed == 0 {
			t.Errorf("%s claims to assess all %d of its controls - no configuration review covers a whole framework, so this is the denominator going missing again",
				fc.Name, len(fc.Controls))
		}
	}
}

// A not-assessed row with no reason is worse than no row: it looks like a verdict and says nothing.
func TestEveryNotAssessedControlSaysWhy(t *testing.T) {
	for _, def := range controlUniverse {
		if len(def.AssessedBy) > 0 {
			if def.NotAssessed != "" {
				t.Errorf("%s %s is assessed by %d checks AND carries a not-assessed reason - one of the two is wrong",
					def.Framework, def.ID, len(def.AssessedBy))
			}
			continue
		}
		if strings.TrimSpace(def.NotAssessed) == "" {
			t.Errorf("%s %s is not assessed and does not say why", def.Framework, def.ID)
		}
	}
	for _, fc := range BuildStandardsCoverage(nil, nil) {
		for _, c := range fc.Controls {
			if c.Status == ControlNotAssessed && strings.TrimSpace(c.NotAssessed) == "" {
				t.Errorf("%s %s reached the coverage view as not-assessed with no reason", fc.Name, c.ID)
			}
			if c.Status != ControlNotAssessed && c.NotAssessed != "" {
				t.Errorf("%s %s carries a not-assessed reason but its status is %q", fc.Name, c.ID, c.Status)
			}
		}
	}
}

// The universe and the engine have to agree in both directions, or a control cites evidence that is
// never produced, or a check is computed and then dropped on the floor.
func TestUniverseAndChecksAgreeBothWays(t *testing.T) {
	known := map[string]bool{}
	for _, c := range AuditChecks {
		known[c] = true
	}
	used := map[string]bool{}
	for _, def := range controlUniverse {
		for _, link := range def.AssessedBy {
			if !known[link.Check] {
				t.Errorf("%s %s cites check %q, which the audit engine never emits", def.Framework, def.ID, link.Check)
			}
			used[link.Check] = true
		}
	}
	for _, c := range AuditChecks {
		if !used[c] {
			t.Errorf("check %q is emitted by the engine but no control cites it - its findings would be computed and silently dropped from the standards view", c)
		}
	}
}

// The Annex A scope, pinned. This replaced the two PCI "listed in full" guards when PCI DSS, NIST
// SP 800-53 and NIST CSF were withdrawn and ISO/IEC 27001 became the only framework.
//
// It does the same job they did: a control quietly dropped from the universe would take its rows
// off the scorecard, and a reader has no way to notice a row that is not there. So the scope is
// written out here rather than derived, and removing one has to be a deliberate edit in two places.
func TestISOAnnexAScopeIsListedInFull(t *testing.T) {
	want := []string{
		"A.8.2", "A.8.5", "A.8.7", "A.8.8", "A.8.9", "A.8.15", "A.8.16", "A.8.17",
		"A.8.20", "A.8.21", "A.8.22", "A.8.23", "A.8.24", "A.8.32",
	}
	have := map[string]bool{}
	for _, def := range controlUniverse {
		if def.Framework == FrameworkISO27k {
			have[def.ID] = true
		}
	}
	for _, id := range want {
		if !have[id] {
			t.Errorf("ISO/IEC 27001 %s is missing from the universe - the Annex A scope has a hole in it", id)
		}
	}
	if len(have) != len(want) {
		t.Errorf("the universe carries %d ISO controls, the declared scope is %d - a row was added without being declared here", len(have), len(want))
	}
}

// ISO/IEC 27001 is the ONLY framework this console assesses. If a second one ever reappears in the
// universe without a frameworkOrder row, its controls would be built into coverage and then
// dropped on the floor by BuildStandardsCoverage, which walks frameworkOrder.
func TestOnlyISOIsAssessed(t *testing.T) {
	for _, def := range controlUniverse {
		if def.Framework != FrameworkISO27k {
			t.Errorf("control %s belongs to framework %q - this console assesses ISO/IEC 27001 only", def.ID, def.Framework)
		}
	}
	cov := BuildStandardsCoverage(nil, nil)
	if len(cov) != 1 || cov[0].ID != FrameworkISO27k {
		t.Errorf("coverage returned %d framework(s), expected exactly ISO/IEC 27001", len(cov))
	}
}

// Clutter is not a control failure. Eleven of seventeen findings on the lab device were hygiene,
// and before this rule they alone turned four controls red.
func TestAdvisoryFindingsOpenAnObservationNotAGap(t *testing.T) {
	cov := BuildStandardsCoverage([]AuditFinding{{Check: "object-unused", Severity: SeverityLow}}, nil)

	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlObservation {
		t.Errorf("ISO A.8.9 is %q, expected %q - an orphaned address object is untidy, not a control failure", c.Status, ControlObservation)
	}
	if iso.Gaps != 0 {
		t.Errorf("a hygiene finding opened %d gap(s) on ISO/IEC 27001", iso.Gaps)
	}
	if iso.Observations == 0 {
		t.Error("the hygiene finding was counted as nothing at all - it must still be visible")
	}
}

// A real finding and a hygiene finding can land on the same control. The real one has to win.
func TestGapBeatsObservation(t *testing.T) {
	// Both checks have to land on the SAME control for the contest to happen at all. On ISO A.8.9
	// (Configuration management) object-unused is a supporting, advisory link and policy-shadowed
	// is a direct one.
	cov := BuildStandardsCoverage([]AuditFinding{
		{Check: "object-unused", Severity: SeverityLow},
		{Check: "policy-shadowed", Severity: SeverityHigh},
	}, nil)
	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlGap {
		t.Errorf("ISO A.8.9 is %q, expected %q - a rule that can never match outranks an orphaned object", c.Status, ControlGap)
	}
}

// Not-assessed is not a fifth flavour of pass. Nothing a scan finds, and nothing anybody signs, may
// move a control out of it.
func TestNotAssessedSurvivesFindingsAndAcceptance(t *testing.T) {
	// This used to assert on PCI 1.3.1, a cardholder-data row that nothing here could ever assess.
	// With ISO/IEC 27001 as the only framework there is no permanently unassessable row left in the
	// catalogue — every Annex A control in scope carries at least one check — so the control under
	// test is constructed here. The RULE is what this guards, and it is general: a control nothing
	// assesses may not be moved by a finding, and may not be moved by a sign-off.
	def := ControlDef{
		Framework: FrameworkISO27k, ID: "A.0.0", Title: "assessed by nothing here",
		NotAssessed: "nothing this console reads could answer it",
	}

	all := map[string]int{}
	undecided := map[string]bool{}
	for _, c := range AuditChecks {
		all[c] = 1
		undecided[c] = true
	}
	if got := coverageFor(def, all, undecided); got.Status != ControlNotAssessed {
		t.Errorf("a control nothing assesses is %q after a scan that found everything, expected %q",
			got.Status, ControlNotAssessed)
	}

	// The acceptance half, through the real report path.
	rep := &AuditReport{
		Findings: []AuditFinding{{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1", Accepted: &AcceptedRisk{}}},
		Standards: []FrameworkCoverage{{
			ID: FrameworkISO27k, Name: "ISO/IEC 27001",
			Controls: []ControlCoverage{{ID: "A.0.0", Status: ControlNotAssessed, NotAssessed: def.NotAssessed}},
		}},
	}
	markAcceptedControls(rep, nil)
	for _, c := range rep.Standards[0].Controls {
		if c.ID == "A.0.0" && c.Status != ControlNotAssessed {
			t.Errorf("a not-assessed control became %q once findings were accepted - an acceptance cannot cover a control nobody assessed", c.Status)
		}
	}
}

func TestOneFindingOpensAGapOnEveryControlItTouches(t *testing.T) {
	cov := BuildStandardsCoverage([]AuditFinding{{Check: "policy-any-any"}}, nil)

	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.20"); c.Status != ControlGap {
		t.Errorf("ISO A.8.20 is %q, expected %q — an any/any/any rule is exactly what Networks security forbids", c.Status, ControlGap)
	}
	// The supporting mapping opens the same gap: a control is not spared because the link to it is
	// weaker, only described differently.
	if c := findControl(t, iso, "A.8.22"); c.Status != ControlGap {
		t.Errorf("ISO A.8.22 is %q, expected %q — segregation is what an any/any/any rule undoes", c.Status, ControlGap)
	}
	// A control no finding touches must stay evidenced, or every gap would drag the whole
	// framework red and the view would carry no information.
	if c := findControl(t, iso, "A.8.17"); c.Status != ControlEvidenced {
		t.Errorf("ISO A.8.17 is %q, expected %q — no finding maps to it", c.Status, ControlEvidenced)
	}
}

// The heart of the honesty guarantee: a check that could not run must never be reported as
// evidence that everything is fine.
func TestUndecidedCheckNeverReadsAsEvidenced(t *testing.T) {
	cov := BuildStandardsCoverage(nil, []string{"policy-shadowed"})

	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlIndeterminate {
		t.Errorf("ISO A.8.9 is %q, expected %q — shadow detection could not decide, so nothing was proven", c.Status, ControlIndeterminate)
	}
	if iso.Indeterminate == 0 {
		t.Error("framework counted no indeterminate controls despite an undecided check")
	}
}

// A real finding outranks "we could not tell": if the scan found something wrong, that is not in
// doubt, whatever else it failed to evaluate.
func TestGapBeatsIndeterminate(t *testing.T) {
	cov := BuildStandardsCoverage(
		[]AuditFinding{{Check: "policy-shadowed"}},
		[]string{"policy-shadowed"},
	)
	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlGap {
		t.Errorf("ISO A.8.9 is %q, expected %q — a finding was actually reported against it", c.Status, ControlGap)
	}
}

func TestDirectMappingWinsOverSupporting(t *testing.T) {
	cov := BuildStandardsCoverage(nil, nil)
	iso := findFramework(t, cov, FrameworkISO27k)
	// A.8.9 is supporting from four checks (three of them hygiene) and direct from two.
	if c := findControl(t, iso, "A.8.9"); c.Strength != StrengthDirect {
		t.Errorf("ISO A.8.9 strength is %q — one direct mapping should raise it above its supporting ones", c.Strength)
	}
}

func TestCoverageCarriesTheDraftMarker(t *testing.T) {
	for _, fc := range BuildStandardsCoverage(nil, nil) {
		if fc.CatalogueStatus != CatalogueStatusValue() {
			t.Errorf("%s does not carry the catalogue status — the UI could present a draft mapping as reviewed", fc.Name)
		}
		if fc.Version == "" {
			t.Errorf("%s has no version", fc.Name)
		}
		if fc.Note == "" {
			t.Errorf("%s has no scope note — a framework shown without its limits reads as full coverage", fc.Name)
		}
	}
}

func TestControlsAreListedInHumanOrder(t *testing.T) {
	cov := BuildStandardsCoverage(nil, nil)
	iso := findFramework(t, cov, FrameworkISO27k)
	var ids []string
	for _, c := range iso.Controls {
		ids = append(ids, c.ID)
	}
	// Plain string sorting would put A.8.16 before A.8.7 and A.8.9.
	if len(ids) < 3 {
		t.Fatalf("expected several ISO controls, got %v", ids)
	}
	if !sort.SliceIsSorted(ids, func(i, j int) bool { return naturalLess(ids[i], ids[j]) }) {
		t.Errorf("ISO controls are out of order: %v", ids)
	}
	if ids[0] != "A.8.2" {
		t.Errorf("first ISO control is %q, expected A.8.2 — digit runs are being compared as text", ids[0])
	}
}

func TestNaturalLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"A.8.7", "A.8.16", true},
		{"A.8.16", "A.8.7", false},
		{"1.2", "1.10", true},
		{"1.10", "1.2", false},
		{"1.2.5", "1.2.7", true},
		{"CM-6", "CM-7", true},
		{"CM-7", "CM-7(1)", true},
		{"AC-4", "SC-7", true},
	}
	for _, c := range cases {
		if got := naturalLess(c.a, c.b); got != c.want {
			t.Errorf("naturalLess(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// ── The service-orphan guard ────────────────────────────────────────────────
//
// unusedServices decodes only name + q_ref on purpose, and screens the result against
// predefinedServices. These two tests pin the reasons, both of which cost a real debugging session
// on the lab device.

func TestPredefinedServicesCoverTheStockTable(t *testing.T) {
	// The names below are the ones the lab FGT80E (FortiOS 7.2.10) reports at q_ref 0 out of the
	// box. Every one of them must be recognised as predefined, or the report opens with dozens of
	// rows telling the admin to delete services FortiOS ships.
	stock := []string{
		"ALL_TCP", "ALL_UDP", "ALL_ICMP", "ALL_ICMP6", "GRE", "AH", "ESP", "AOL", "BGP", "DHCP",
		"FINGER", "GOPHER", "H323", "IKE", "Internet-Locator-Service", "IRC", "L2TP", "NetMeeting",
		"NFS", "NNTP", "NTP", "OSPF", "PC-Anywhere", "PING", "TIMESTAMP", "INFO_REQUEST",
		"INFO_ADDRESS", "ONC-RPC", "PPTP", "QUAKE", "RAUDIO", "REXEC", "RIP", "RLOGIN", "RSH",
		"SCCP", "SIP", "SIP-MSNmessenger", "SNMP", "SSH", "SYSLOG", "TALK", "TELNET", "TFTP",
		"MGCP", "UUCP", "VDOLIVE", "WAIS", "WINFRAME", "X-WINDOWS", "PING6", "MS-SQL", "MYSQL",
		"RDP", "VNC", "DHCP6", "SQUID", "SOCKS", "WINS", "RADIUS", "RADIUS-OLD", "CVSPSERVER",
		"AFS3", "TRACEROUTE", "RTSP", "MMS", "NONE", "FTP", "FTP_GET", "FTP_PUT",
	}
	for _, name := range stock {
		if !predefinedServices[name] {
			t.Errorf("%q is a stock FortiOS service but is not in predefinedServices — it would be reported as clutter to delete", name)
		}
	}
}

func TestPredefinedServicesDoesNotSwallowCustomNames(t *testing.T) {
	// A service someone actually created must still be reportable. HTTPS-Alt-9443 is a real one
	// from the lab device and is exactly the shape of name a customer invents.
	for _, name := range []string{"HTTPS-Alt-9443", "APP-Payments", "TCP-8443", ""} {
		if predefinedServices[name] {
			t.Errorf("%q is treated as a stock service — a genuinely orphaned custom object would be hidden", name)
		}
	}
}

// ── Title provenance ────────────────────────────────────────────────────────

func TestEveryControlSaysWhoWroteItsTitle(t *testing.T) {
	for _, check := range AuditChecks {
		for _, ref := range ControlsForCheck(check) {
			if ref.TitleSource != TitleOfficial && ref.TitleSource != TitleParaphrase {
				t.Errorf("%s: %s %s has title source %q — a reader cannot tell whether the wording is quotable",
					check, ref.Framework, ref.ID, ref.TitleSource)
			}
		}
	}
}

// ISO Annex A control NAMES are published short titles, so every row carries the real words. If one
// of these ever flips to paraphrase it means somebody edited a title by hand instead of correcting
// it against the publication.
//
// The reverse guard — that a framework whose text is NOT cleared for reproduction must be marked as
// paraphrased — went with PCI DSS. TitleParaphrase is still honoured everywhere and the marker is
// still rendered; there is simply nothing in the catalogue using it today.
func TestISOTitlesAreQuotable(t *testing.T) {
	for _, check := range AuditChecks {
		for _, ref := range ControlsForCheck(check) {
			if ref.FrameworkID == FrameworkISO27k && ref.TitleSource != TitleOfficial {
				t.Errorf("%s: %s %s is marked %q — Annex A control names are quoted, not summarised",
					check, ref.Framework, ref.ID, ref.TitleSource)
			}
		}
	}
}

func TestCoverageCarriesTitleSource(t *testing.T) {
	for _, fc := range BuildStandardsCoverage(nil, nil) {
		for _, c := range fc.Controls {
			if c.TitleSource == "" {
				t.Errorf("%s %s reached the coverage view with no title source", fc.Name, c.ID)
			}
		}
	}
}

// ── Methodology ─────────────────────────────────────────────────────────────

func TestMethodologyDefinesEverySeverityAndStatus(t *testing.T) {
	m := AuditMethodology()

	has := func(defs []Definition, term string) bool {
		for _, d := range defs {
			if d.Term == term {
				return d.Meaning != ""
			}
		}
		return false
	}

	for _, sev := range []AuditSeverity{SeverityHigh, SeverityMedium, SeverityLow} {
		if !has(m.SeverityBasis, string(sev)) {
			t.Errorf("severity %q has no written definition — the report would grade a customer's firewall on an unstated basis", sev)
		}
	}
	for _, st := range []string{ControlGap, ControlEvidenced, ControlIndeterminate, ControlAccepted, ControlObservation, ControlNotAssessed} {
		if !has(m.StatusBasis, st) {
			t.Errorf("control status %q has no written definition", st)
		}
	}
	for _, str := range []ControlStrength{StrengthDirect, StrengthSupporting} {
		if !has(m.StrengthBasis, string(str)) {
			t.Errorf("strength %q has no written definition", str)
		}
	}
}

// The methodology block is where a reader is told the limits. If it stops saying so, the report
// starts reading like a certification.
func TestMethodologyDisclaimsBeingAVerdict(t *testing.T) {
	note := strings.ToLower(AuditMethodology().Note)
	if !strings.Contains(note, "assessor") {
		t.Error("the methodology note no longer points at a qualified assessor")
	}
	if !strings.Contains(note, "own judgement") && !strings.Contains(note, "not a rating") {
		t.Error("the methodology note no longer says severity is this console's own judgement")
	}
}

// ── Rationale and citations ─────────────────────────────────────────────────

func TestEveryCheckHasASourcedRationale(t *testing.T) {
	for _, r := range AuditRationales() {
		if r.Summary == "" {
			t.Errorf("%s has no rationale — the page would present the check with no explanation at all", r.Check)
		}
		if len(r.Sources) == 0 {
			t.Errorf("%s cites nothing — its explanation would rest on our say-so alone, which is what this replaced", r.Check)
		}
		if len(r.Basis) == 0 {
			t.Errorf("%s has no directly-mapped control behind it", r.Check)
		}
	}
}

// A citation a reader cannot follow is decoration.
func TestEveryCitationCanBeLookedUp(t *testing.T) {
	for _, r := range AuditRationales() {
		for _, d := range r.Sources {
			switch {
			case d.ID == "":
				t.Errorf("%s cites a source with no identifier", r.Check)
			case d.Title == "":
				t.Errorf("%s cites %s with no title", r.Check, d.ID)
			case d.Publisher == "":
				t.Errorf("%s cites %s with no publisher", r.Check, d.ID)
			case !strings.HasPrefix(d.URL, "https://"):
				t.Errorf("%s cites %s with URL %q — a reader must be able to open it", r.Check, d.ID, d.URL)
			}
		}
	}
}

// Every check must cite the standard it maps to. This replaced a stronger guard: NIST SP 800-41,
// the publication about firewall rule bases specifically, used to be seeded into EVERY rationale,
// so a check with no control mapping still carried a citation. That citation went with the other
// NIST material, so the guarantee is now weaker and worth stating: a rationale is only as
// falsifiable as its mapping, and a check that maps to nothing would cite nothing.
//
// TestEveryCheckIsCitedByAControl above is what keeps that from happening, so the two are read
// together — this one fails second if a check is ever added without a control.
func TestEveryRationaleCitesItsStandard(t *testing.T) {
	for _, r := range AuditRationales() {
		var found bool
		for _, d := range r.Sources {
			if d.ID == docISO27001.ID {
				found = true
			}
		}
		if !found {
			t.Errorf("%s does not cite %s — its explanation rests on our say-so alone", r.Check, docISO27001.ID)
		}
	}
}

// Nothing this console cites may be reproduced. ISO/IEC's text is copyright, and marking it public
// domain would be the first move in pasting it into the product — which is the exact failure the
// whole standards layer was built to avoid. The flag survives the withdrawal of the NIST material
// so that a future public-domain source has somewhere honest to say so.
func TestNoSourceIsMarkedPublicDomain(t *testing.T) {
	for _, r := range AuditRationales() {
		for _, d := range r.Sources {
			if d.PublicDomain {
				t.Errorf("%s (published by %s) is marked public domain — nothing cited here may be reproduced",
					d.ID, d.Publisher)
			}
		}
	}
}

// The rationale must not quietly turn into a quotation. Nothing in this file is copied out of a
// standard, and a summary that starts carrying quote marks is the first sign that it has.
func TestRationalesAreSummariesNotQuotations(t *testing.T) {
	for _, r := range AuditRationales() {
		if strings.Contains(r.Summary, "\"") || strings.Contains(r.Summary, "“") {
			t.Errorf("%s reads as a quotation: %q — cite the document, do not reproduce it", r.Check, r.Summary)
		}
	}
}

func TestEveryFrameworkHasAPublication(t *testing.T) {
	for _, meta := range frameworkOrder {
		doc, ok := frameworkDoc[meta.ID]
		if !ok {
			t.Errorf("%s has no publication behind it — a control id with nowhere to look it up", meta.Name)
			continue
		}
		if !strings.HasPrefix(doc.URL, "https://") {
			t.Errorf("%s points at %q", meta.Name, doc.URL)
		}
	}
}

// ── Catalogue status is a deployment fact ───────────────────────────────────

func TestCatalogueStatusDefaultsToDraft(t *testing.T) {
	t.Setenv("AUDIT_CATALOGUE_STATUS", "")
	// A checkout with nothing configured must never claim an assessor signed the mapping off.
	if got := CatalogueStatusValue(); got != "draft" {
		t.Errorf("CatalogueStatusValue() = %q with no environment set, want %q", got, "draft")
	}
}

func TestCatalogueStatusFollowsTheEnvironment(t *testing.T) {
	t.Setenv("AUDIT_CATALOGUE_STATUS", "reviewed")
	if got := CatalogueStatusValue(); got != "reviewed" {
		t.Errorf("CatalogueStatusValue() = %q, want reviewed", got)
	}
	if got := AuditMethodology().CatalogueStatus; got != "reviewed" {
		t.Errorf("the methodology carries %q instead of the configured status", got)
	}
	for _, fc := range BuildStandardsCoverage(nil, nil) {
		if fc.CatalogueStatus != "reviewed" {
			t.Errorf("%s carries %q", fc.Name, fc.CatalogueStatus)
		}
	}
}

// ── Falsify-only links ──────────────────────────────────────────────────────
//
// The live case these exist for: the lab FortiGate has seven policies and every one of them is an
// accept, so policy-deny-no-logging found nothing and PCI 10.2.1.4 came back "evidenced" — while
// the device's log settings read `set fwpolicy-implicit-log disable` and invalid access attempts
// were going entirely unrecorded. Finding nothing had been mistaken for finding nothing wrong.

// The mechanism, exercised on a definition this test owns.
//
// It used to assert on PCI 10.2.1.4, which was the row that produced the rule. That row is now
// answerable — log-implicit-deny-off reads the blind spot policy-deny-no-logging could not see —
// so pinning the test to it would have meant either deleting the rule's only coverage or leaving
// the blind spot unread to keep a test green. Neither is a trade worth making: the rule is general,
// so the test is written against a general case.
func TestFalsifyOnlyEvidenceCannotEvidence(t *testing.T) {
	def := ControlDef{
		Framework: FrameworkISO27k, ID: "X.1", Title: "test control",
		AssessedBy: []CheckLink{falsifies("policy-deny-no-logging", "the part that would settle this is not read")},
	}

	clean := coverageFor(def, map[string]int{}, map[string]bool{})
	if clean.Status != ControlNotAssessed {
		t.Errorf("a control assessed only by a falsify-only check is %q on a clean scan, expected %q",
			clean.Status, ControlNotAssessed)
	}
	if !strings.Contains(clean.NotAssessed, "not read") {
		t.Errorf("the blind spot did not reach the reader: %q", clean.NotAssessed)
	}

	// Finding nothing proves nothing, but finding something settles it.
	fired := coverageFor(def, map[string]int{"policy-deny-no-logging": 1}, map[string]bool{})
	if fired.Status != ControlGap {
		t.Errorf("a falsify-only check that fired left the control %q, expected %q", fired.Status, ControlGap)
	}
	if fired.NotAssessed != "" {
		t.Errorf("a control with a gap still carries a not-assessed reason: %q", fired.NotAssessed)
	}
}

// One evidencing link is enough to make the control answerable; the falsify-only sibling then just
// adds a way for it to fail.
//
// It used to assert on PCI 10.2.1.4, the row that carried both kinds of link. No ISO Annex A row in
// the catalogue does today — A.8.32 is falsify-only outright — so the mixed control is built here.
// The rule is what matters and it is general: a falsify-only link must not veto a sibling that can
// actually evidence the control.
func TestFalsifyOnlyLinkDoesNotBlockAnEvidencingSibling(t *testing.T) {
	def := ControlDef{
		Framework: FrameworkISO27k, ID: "X.2", Title: "mixed evidence",
		AssessedBy: []CheckLink{
			dir("log-implicit-deny-off"),
			falsifies("policy-deny-no-logging", "the explicit deny rules cannot settle it alone"),
		},
	}

	clean := coverageFor(def, map[string]int{}, map[string]bool{})
	if clean.Status != ControlEvidenced {
		t.Errorf("a control with one evidencing link is %q on a clean scan, expected %q - the falsify-only sibling must not veto it",
			clean.Status, ControlEvidenced)
	}
	if clean.NotAssessed != "" {
		t.Errorf("an answerable control carries a not-assessed reason: %q", clean.NotAssessed)
	}
}

// Falsify-only is not "ignore this check". When it fires, it has settled the question — including
// through the full coverage builder, not just the single-control helper above.
func TestFalsifyOnlyEvidenceStillOpensAGap(t *testing.T) {
	cov := BuildStandardsCoverage([]AuditFinding{{Check: "change-unrecorded", Severity: SeverityMedium}}, nil)
	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.32"); c.Status != ControlGap {
		t.Errorf("ISO A.8.32 is %q with an unrecorded change against it, expected %q", c.Status, ControlGap)
	}
}

// Every falsify-only link has to say what it cannot see, or the not-assessed row it produces is a
// blank refusal rather than a disclosure.
func TestEveryFalsifyOnlyLinkNamesItsBlindSpot(t *testing.T) {
	for _, def := range controlUniverse {
		for _, link := range def.AssessedBy {
			if link.FalsifyOnly && strings.TrimSpace(link.Blind) == "" {
				t.Errorf("%s %s links %q as falsify-only without naming the blind spot",
					def.Framework, def.ID, link.Check)
			}
			if !link.FalsifyOnly && link.Blind != "" {
				t.Errorf("%s %s carries a blind-spot note on %q but is not falsify-only",
					def.Framework, def.ID, link.Check)
			}
		}
	}
}

package services

import (
	"strings"
	"testing"
	"time"
)

// The governance checks are a pure function of the evidence struct, so they are tested without a
// database — the same shape as the management-plane tests next door.
//
// The scenarios below are the ones that decide whether this layer is honest: a first scan must not
// claim a cadence, a quiet ledger must not claim approval, and a device this console has never
// backed up must say so rather than staying silent.

var govNow = time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

// healthyEvidence is a device this console has been looking after: reviewed last week, backed up
// after the last change, and nothing has moved since.
func healthyEvidence() GovernanceEvidence {
	return GovernanceEvidence{
		PreviousReviewAt: govNow.AddDate(0, 0, -7),
		HasPriorReview:   true,
		ReviewsReadable:  true,

		PreviousFingerprint: "abc123",
		CurrentFingerprint:  "abc123",

		ChangesSincePreviousReview: 0,
		LastChangeAt:               govNow.AddDate(0, 0, -20),
		HasChanges:                 true,
		LedgerReadable:             true,

		LastBackupAt:    govNow.AddDate(0, 0, -10),
		HasBackup:       true,
		BackupsReadable: true,
	}
}

func TestHealthyGovernanceRecordProducesNothing(t *testing.T) {
	found, undecided, notes := healthyEvidence().findings(govNow)
	if len(found) != 0 {
		t.Errorf("a device reviewed 7 days ago, backed up after its last change and unchanged since produced %d findings: %v",
			len(found), countChecks(found))
	}
	for check, yes := range undecided {
		if yes {
			t.Errorf("%s reported itself undetermined on a complete record", check)
		}
	}
	if len(notes) != 0 {
		t.Errorf("unexpected notes on a complete record: %v", notes)
	}
}

// ── Review cadence ──────────────────────────────────────────────────────────

func TestReviewCadenceBoundary(t *testing.T) {
	cases := []struct {
		daysAgo int
		want    int
	}{
		{7, 0},
		{reviewCadenceDays, 0},     // exactly six months is inside PCI DSS 1.2.7's window
		{reviewCadenceDays + 1, 1}, // a day past it is not
		{900, 1},
	}
	for _, tc := range cases {
		ev := healthyEvidence()
		ev.PreviousReviewAt = govNow.AddDate(0, 0, -tc.daysAgo)
		found, _, _ := ev.findings(govNow)
		if n := countChecks(found)["review-overdue"]; n != tc.want {
			t.Errorf("a review %d days ago produced %d findings, want %d", tc.daysAgo, n, tc.want)
		}
	}
}

// The trap this whole phase exists to avoid: a device nobody has ever reviewed must not read as a
// device reviewed on schedule. The scan in progress is not evidence of a cadence.
func TestFirstEverScanCannotEvidenceACadence(t *testing.T) {
	ev := healthyEvidence()
	ev.HasPriorReview = false
	ev.PreviousReviewAt = time.Time{}
	ev.PreviousFingerprint = ""

	found, undecided, notes := ev.findings(govNow)
	if n := countChecks(found)["review-overdue"]; n != 0 {
		t.Errorf("a first scan raised %d review findings - having no history is not the same as having lapsed", n)
	}
	if !undecided["review-overdue"] {
		t.Fatal("a first scan reported the review cadence as evaluated - it would read as evidence of a cadence that has never been demonstrated")
	}
	var said bool
	for _, n := range notes {
		if strings.Contains(n, "first review") {
			said = true
		}
	}
	if !said {
		t.Errorf("nothing explained why the cadence could not be evaluated: %v", notes)
	}

	// And it must reach the standards view as indeterminate, not as a pass.
	cov := BuildStandardsCoverage(nil, []string{"review-overdue"})
	iso := findFramework(t, cov, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlIndeterminate {
		t.Errorf("ISO A.8.9 is %q on a first scan, expected %q", c.Status, ControlIndeterminate)
	}
}

func TestUnreadableReviewHistoryIsUndetermined(t *testing.T) {
	ev := healthyEvidence()
	ev.ReviewsReadable = false
	ev.HasPriorReview = false

	found, undecided, _ := ev.findings(govNow)
	if countChecks(found)["review-overdue"] != 0 {
		t.Error("an unreadable history produced a finding")
	}
	if !undecided["review-overdue"] {
		t.Error("an unreadable history was not reported as undetermined")
	}
}

// ── Configuration baseline ──────────────────────────────────────────────────

func TestMissingBaselineIsReportedAndNotAlsoCalledStale(t *testing.T) {
	ev := healthyEvidence()
	ev.HasBackup = false
	ev.LastBackupAt = time.Time{}

	found, undecided, _ := ev.findings(govNow)
	got := countChecks(found)
	if got["config-no-baseline"] != 1 {
		t.Error("a device with no stored configuration was not reported")
	}
	if got["config-baseline-stale"] != 0 {
		t.Error("a baseline that does not exist was also reported as stale")
	}
	// Nor may it be left as "could not tell" — the answer is known and it is "there is none".
	if undecided["config-baseline-stale"] {
		t.Error("staleness was reported as undetermined when the baseline is known to be absent")
	}
}

func TestStaleBaselineIsMeasuredAgainstTheLastRecordedChange(t *testing.T) {
	ev := healthyEvidence()
	// Backed up, then changed. The baseline no longer describes the device.
	ev.LastBackupAt = govNow.AddDate(0, 0, -30)
	ev.LastChangeAt = govNow.AddDate(0, 0, -2)
	ev.HasChanges = true

	found, _, _ := ev.findings(govNow)
	if countChecks(found)["config-baseline-stale"] != 1 {
		t.Error("a baseline older than the last recorded change was not reported")
	}

	// Changed, then backed up: current, however old it is in absolute terms. Staleness is measured
	// against a change we know happened, not against a number somebody picked.
	ev.LastBackupAt = govNow.AddDate(0, 0, -2)
	ev.LastChangeAt = govNow.AddDate(0, 0, -400)
	found, _, _ = ev.findings(govNow)
	if n := countChecks(found)["config-baseline-stale"]; n != 0 {
		t.Errorf("a backup taken after the last change was reported stale (%d) - age alone is not the test", n)
	}
}

func TestUnreadableBackupsAreUndetermined(t *testing.T) {
	ev := healthyEvidence()
	ev.BackupsReadable = false
	ev.HasBackup = false

	found, undecided, _ := ev.findings(govNow)
	if len(found) != 0 {
		t.Errorf("unreadable backups produced findings: %v", countChecks(found))
	}
	if !undecided["config-no-baseline"] || !undecided["config-baseline-stale"] {
		t.Error("unreadable backups were not reported as undetermined")
	}
}

// ── Change attribution ──────────────────────────────────────────────────────

func TestConfigMovedWithNothingInTheLedger(t *testing.T) {
	ev := healthyEvidence()
	ev.CurrentFingerprint = "def456" // the configuration moved
	ev.ChangesSincePreviousReview = 0

	found, _, _ := ev.findings(govNow)
	if countChecks(found)["change-unrecorded"] != 1 {
		t.Fatal("a configuration change with no ledger entry was not reported")
	}
	for _, f := range found {
		if f.Check != "change-unrecorded" {
			continue
		}
		// The wording is the whole point. This finding is about the RECORD, and claiming it is
		// about authorisation would be a claim nothing here can support.
		low := strings.ToLower(f.Detail)
		if strings.Contains(low, "unapproved") || strings.Contains(low, "unauthorised") || strings.Contains(low, "unauthorized") {
			t.Errorf("the finding claims the change was unapproved, which nothing here can know: %q", f.Detail)
		}
		if !strings.Contains(low, "outside this console") {
			t.Errorf("the finding does not say the change was made outside this console: %q", f.Detail)
		}
	}
}

// A change the console DID make moves the fingerprint too. That is the normal case and must be
// silent, or the check would fire on every scan that follows any legitimate edit.
func TestConfigMovedWithTheLedgerAccountingForItIsSilent(t *testing.T) {
	ev := healthyEvidence()
	ev.CurrentFingerprint = "def456"
	ev.ChangesSincePreviousReview = 3

	found, _, _ := ev.findings(govNow)
	if n := countChecks(found)["change-unrecorded"]; n != 0 {
		t.Errorf("a change this console recorded was reported as unrecorded (%d findings)", n)
	}
}

// No stored fingerprint to compare against — the honest answer is "could not tell", not "nothing
// changed". Every device gets exactly one scan in this state.
func TestNoStoredFingerprintIsUndetermined(t *testing.T) {
	for _, ev := range []GovernanceEvidence{
		func() GovernanceEvidence { e := healthyEvidence(); e.PreviousFingerprint = ""; return e }(),
		func() GovernanceEvidence { e := healthyEvidence(); e.CurrentFingerprint = ""; return e }(),
	} {
		found, undecided, notes := ev.findings(govNow)
		if countChecks(found)["change-unrecorded"] != 0 {
			t.Error("a missing fingerprint produced a finding")
		}
		if !undecided["change-unrecorded"] {
			t.Error("a missing fingerprint was not reported as undetermined")
		}
		if len(notes) == 0 {
			t.Error("nothing explained why change attribution could not be evaluated")
		}
	}
}

func TestUnreadableLedgerIsUndetermined(t *testing.T) {
	ev := healthyEvidence()
	ev.LedgerReadable = false

	found, undecided, _ := ev.findings(govNow)
	if countChecks(found)["change-unrecorded"] != 0 {
		t.Error("an unreadable ledger produced a finding")
	}
	if !undecided["change-unrecorded"] {
		t.Error("an unreadable ledger was not reported as undetermined")
	}
}

// ── The controls these feed ─────────────────────────────────────────────────

// The rows this phase exists to turn green, checked end to end through the coverage builder.
func TestGovernanceEvidencesTheCadenceAndBaselineControls(t *testing.T) {
	cov := BuildStandardsCoverage(nil, nil)

	for _, tc := range []struct{ framework, id string }{
		// The PCI (1.2.7 review cadence, 1.2.8 baseline) and NIST (CM-2, CM-7(1)) rows this used to
		// check went with their frameworks. ISO/IEC 27001 folds both facts into one control.
		{FrameworkISO27k, "A.8.9"},
	} {
		fw := findFramework(t, cov, tc.framework)
		if c := findControl(t, fw, tc.id); c.Status != ControlEvidenced {
			t.Errorf("%s %s is %q on a clean scan, expected %q - this is a row Phase 3 was meant to make answerable",
				fw.Name, tc.id, c.Status, ControlEvidenced)
		}
	}
}

// And the rows it deliberately does NOT turn green. Authorisation is not observable, so a quiet
// ledger must not read as a change-control process.
func TestApprovalControlsStayUnassessedOnAQuietLedger(t *testing.T) {
	cov := BuildStandardsCoverage(nil, nil)

	for _, tc := range []struct{ framework, id string }{
		{FrameworkISO27k, "A.8.32"},
	} {
		fw := findFramework(t, cov, tc.framework)
		c := findControl(t, fw, tc.id)
		if c.Status != ControlNotAssessed {
			t.Errorf("%s %s is %q, expected %q - nothing this console holds records who authorised a change",
				fw.Name, tc.id, c.Status, ControlNotAssessed)
		}
		if !strings.Contains(strings.ToLower(c.NotAssessed), "authoris") && !strings.Contains(strings.ToLower(c.NotAssessed), "approval") {
			t.Errorf("%s %s does not explain that authorisation is the missing half: %q", fw.Name, tc.id, c.NotAssessed)
		}
	}

	// They must still be able to FAIL. A check that can never report anything is not a check.
	withFinding := BuildStandardsCoverage([]AuditFinding{{Check: "change-unrecorded", Severity: SeverityMedium}}, nil)
	iso := findFramework(t, withFinding, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.32"); c.Status != ControlGap {
		t.Errorf("ISO A.8.32 is %q with an unrecorded change against it, expected %q", c.Status, ControlGap)
	}
}

// ── applyGovernanceEvidence ─────────────────────────────────────────────────

func TestApplyGovernanceEvidenceFoldsIntoAFinishedReport(t *testing.T) {
	rep := &AuditReport{
		Counts:   map[string]int{},
		Findings: []AuditFinding{{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy 1"}},
	}
	rep.Standards = BuildStandardsCoverage(rep.Findings, nil)

	ev := healthyEvidence()
	ev.HasBackup = false // one governance finding

	applyGovernanceEvidence(rep, ev, govNow)

	if len(rep.Findings) != 2 {
		t.Fatalf("got %d findings after folding governance in, want 2", len(rep.Findings))
	}
	if rep.Counts[string(SeverityMedium)] != 1 {
		t.Errorf("the governance finding did not reach the severity counts: %v", rep.Counts)
	}

	var gov *AuditFinding
	for i := range rep.Findings {
		if rep.Findings[i].Check == "config-no-baseline" {
			gov = &rep.Findings[i]
		}
	}
	if gov == nil {
		t.Fatal("the governance finding is not in the report")
	}
	// Control references are attached in RunAudit for the device checks; a finding added afterwards
	// has to carry its own, or it reaches the UI with no standards at all.
	if len(gov.Controls) == 0 {
		t.Error("the governance finding carries no control references")
	}

	// And the coverage must have been rebuilt over both.
	iso := findFramework(t, rep.Standards, FrameworkISO27k)
	if c := findControl(t, iso, "A.8.9"); c.Status != ControlGap {
		t.Errorf("ISO A.8.9 is %q after a missing-baseline finding, expected %q", c.Status, ControlGap)
	}
}

// UndecidedChecks has to come back in the engine's declared order and without duplicates, or the
// note under the findings list reads as a jumble that changes between refreshes.
func TestApplyGovernanceEvidenceKeepsUndecidedOrdered(t *testing.T) {
	rep := &AuditReport{
		Counts:          map[string]int{},
		UndecidedChecks: []string{"policy-shadowed"},
	}
	rep.Standards = BuildStandardsCoverage(nil, rep.UndecidedChecks)

	ev := healthyEvidence()
	ev.HasPriorReview = false
	ev.PreviousFingerprint = ""

	applyGovernanceEvidence(rep, ev, govNow)

	order := map[string]int{}
	for i, c := range AuditChecks {
		order[c] = i
	}
	seen := map[string]bool{}
	last := -1
	for _, c := range rep.UndecidedChecks {
		if seen[c] {
			t.Errorf("%s appears twice in UndecidedChecks", c)
		}
		seen[c] = true
		if order[c] < last {
			t.Errorf("UndecidedChecks is out of declared order: %v", rep.UndecidedChecks)
		}
		last = order[c]
	}
	for _, want := range []string{"policy-shadowed", "review-overdue", "change-unrecorded"} {
		if !seen[want] {
			t.Errorf("%s is missing from UndecidedChecks: %v", want, rep.UndecidedChecks)
		}
	}
}

func TestApplyGovernanceEvidenceOnNilReportIsSafe(t *testing.T) {
	applyGovernanceEvidence(nil, healthyEvidence(), govNow)
}

// A caller with no database gets exactly the report it had before — the layer is additive, and a
// deployment without governance records is not a deployment with governance failures.
func TestNoRecordsAtAllProducesNoFindings(t *testing.T) {
	found, undecided, notes := GovernanceEvidence{}.findings(govNow)
	if len(found) != 0 {
		t.Errorf("an empty evidence struct produced findings: %v", countChecks(found))
	}
	for _, check := range []string{"review-overdue", "config-no-baseline", "config-baseline-stale", "change-unrecorded"} {
		if !undecided[check] {
			t.Errorf("%s was neither evaluated nor reported as undetermined", check)
		}
	}
	if len(notes) < 3 {
		t.Errorf("only %d notes for four unevaluable checks: %v", len(notes), notes)
	}
}

// Every governance check has to be one the engine declares and one the catalogue maps, or its
// findings are computed and then dropped.
func TestGovernanceChecksAreDeclaredAndMapped(t *testing.T) {
	known := map[string]bool{}
	for _, c := range AuditChecks {
		known[c] = true
	}
	for _, check := range []string{"review-overdue", "config-no-baseline", "config-baseline-stale", "change-unrecorded"} {
		if !known[check] {
			t.Errorf("%s is not in AuditChecks", check)
		}
		if len(ControlsForCheck(check)) == 0 {
			t.Errorf("%s maps to no control", check)
		}
		if RationaleFor(check).Summary == "" {
			t.Errorf("%s has no rationale", check)
		}
	}
}

// The fingerprint table list is what "the configuration changed" means. Anything runtime in it
// would make the check fire on a firewall nobody touched.
func TestFingerprintTablesAreConfigurationOnly(t *testing.T) {
	if len(fingerprintTables) < 5 {
		t.Errorf("only %d tables in the fingerprint - too narrow to notice a change", len(fingerprintTables))
	}
	seen := map[string]bool{}
	for _, table := range fingerprintTables {
		if seen[table] {
			t.Errorf("%s is listed twice", table)
		}
		seen[table] = true
		if strings.HasPrefix(table, "monitor/") {
			t.Errorf("%s is a monitor path - runtime counters would move the fingerprint on a device nobody touched", table)
		}
		if strings.HasPrefix(table, "/") || strings.Contains(table, "?") {
			t.Errorf("%s is not a bare CMDB table path", table)
		}
	}
	// The rule base and the objects it references are the minimum: a change to any of them is
	// exactly what this audit is about.
	for _, must := range []string{"firewall/policy", "firewall/address", "system/interface"} {
		if !seen[must] {
			t.Errorf("%s is missing from the fingerprint", must)
		}
	}
}

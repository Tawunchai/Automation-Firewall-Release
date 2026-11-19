package services

import (
	"strings"
	"testing"
)

// The projection is the claim this feature lives or dies on: it tells somebody what their firewall
// will look like after a change they have not made yet. Every test here is about that claim being
// arithmetic rather than optimism.

func find(check string, over ...func(*AuditFinding)) AuditFinding {
	f := AuditFinding{
		Check: check, Severity: SeverityHigh, Category: "Policy",
		Title: "finding for " + check, Subject: "policy 1",
		Fix: []string{"config firewall policy", "    edit 1", "        set logtraffic all", "    next", "end"},
	}
	for _, fn := range over {
		fn(&f)
	}
	return f
}

// A.8.17 Clock synchronization is assessed by exactly one check, which makes it the clean case:
// fix the one thing and the control closes.
func TestPlanClosesAControlWhenItsOnlyCheckIsFixed(t *testing.T) {
	findings := []AuditFinding{find("time-not-synced")}

	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.17")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if plan.Status != ControlGap {
		t.Errorf("before: want %q, got %q", ControlGap, plan.Status)
	}
	if !plan.Closes {
		t.Errorf("fixing the only check behind A.8.17 should close it; blocked=%q", plan.Blocked)
	}
	if plan.Blocked != "" {
		t.Errorf("a control that closes must carry no blocked reason, got %q", plan.Blocked)
	}
	if len(plan.Steps) != 1 || plan.Steps[0].Check != "time-not-synced" {
		t.Fatalf("want one step for time-not-synced, got %+v", plan.Steps)
	}
	if plan.Resolves != 1 {
		t.Errorf("Resolves = %d, want 1", plan.Resolves)
	}
}

// The dangerous case: a control fed by several checks, only some of which the plan covers. Saying
// "fixed" here would be the tool lying about the next scan.
func TestPlanSaysWhyAControlStaysOpen(t *testing.T) {
	// A.8.15 Logging is fed by four checks. Give it findings on two, then plan — the plan covers
	// both, so it closes. Now hold one of them back by making it undecidable instead.
	findings := []AuditFinding{
		find("policy-no-logging"),
		find("log-implicit-deny-off"),
	}
	plan, err := BuildRemediationPlan(nil, findings, []string{"log-no-remote"}, "A.8.15")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if plan.Closes {
		t.Error("A.8.15 must not close while log-no-remote could not be evaluated")
	}
	if !strings.Contains(plan.Blocked, "log-no-remote") {
		t.Errorf("the blocked reason must name the check that is holding it open, got %q", plan.Blocked)
	}
}

func TestPlanOnlyTouchesTheChecksBehindItsControl(t *testing.T) {
	findings := []AuditFinding{
		find("time-not-synced"),
		find("policy-any-any"),     // A.8.20, not A.8.17
		find("admin-unrestricted"), // A.8.2, not A.8.17
	}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.17")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	for _, s := range plan.Steps {
		if s.Check != "time-not-synced" {
			t.Errorf("plan for A.8.17 includes a step for %q, which does not feed it", s.Check)
		}
	}
}

// The whole framework moves, not just the control asked about. A plan that closes A.8.15 also
// clears policy-no-logging out of A.8.16, and a reader has to be told before they run it.
func TestProjectionReportsEveryControlThatMoves(t *testing.T) {
	findings := []AuditFinding{find("policy-no-logging")}

	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.15")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if len(plan.Projection) != len(isoUniverse) {
		t.Fatalf("projection covers %d controls, framework has %d", len(plan.Projection), len(isoUniverse))
	}
	if !plan.Projection[0].Target {
		t.Error("the control the plan was asked about must be first in the projection")
	}

	var moved []string
	for _, p := range plan.Projection {
		if p.Changed {
			moved = append(moved, p.ID)
		}
	}
	// policy-no-logging is direct evidence for A.8.15 and supporting evidence for A.8.16, so both
	// go from gap to evidenced.
	want := map[string]bool{"A.8.15": true, "A.8.16": true}
	for _, id := range moved {
		if !want[id] {
			t.Errorf("%s changed and should not have", id)
		}
		delete(want, id)
	}
	for id := range want {
		t.Errorf("%s should have changed and did not", id)
	}
}

func TestFrameworkTalliesMatchTheProjection(t *testing.T) {
	findings := []AuditFinding{find("policy-no-logging"), find("time-not-synced")}

	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.15")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	countBefore, countAfter := FrameworkTally{}, FrameworkTally{}
	for _, p := range plan.Projection {
		tally(&countBefore, p.Before)
		tally(&countAfter, p.After)
	}
	if countBefore != plan.Before {
		t.Errorf("Before tally %+v does not match the projection %+v", plan.Before, countBefore)
	}
	if countAfter != plan.After {
		t.Errorf("After tally %+v does not match the projection %+v", plan.After, countAfter)
	}
	// Fixing something must never make the framework worse.
	if plan.After.Gaps > plan.Before.Gaps {
		t.Errorf("gaps went up: %d → %d", plan.Before.Gaps, plan.After.Gaps)
	}
}

// Eleven policies missing one setting is one decision. Repeating the same block eleven times is how
// a plan stops being read to the end.
func TestIdenticalFixBlocksAreListedOnce(t *testing.T) {
	same := []string{"config log setting", "    set fwpolicy-implicit-log enable", "end"}
	findings := []AuditFinding{
		find("log-implicit-deny-off", func(f *AuditFinding) { f.Fix = same; f.Subject = "a" }),
		find("log-implicit-deny-off", func(f *AuditFinding) { f.Fix = same; f.Subject = "b" }),
		find("log-implicit-deny-off", func(f *AuditFinding) { f.Fix = same; f.Subject = "c" }),
	}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.15")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if len(plan.Steps) != 1 {
		t.Fatalf("want one step, got %d", len(plan.Steps))
	}
	step := plan.Steps[0]
	if len(step.CLI) != len(same) {
		t.Errorf("the same fix block was emitted %d times over: %v", len(step.CLI)/len(same), step.CLI)
	}
	if step.Findings != 3 {
		t.Errorf("Findings = %d, want 3 — deduplicating the CLI must not lose the count", step.Findings)
	}
	if len(step.Subjects) != 3 {
		t.Errorf("Subjects = %v, want all three", step.Subjects)
	}
}

// Different fix blocks are different work and all of them have to be listed.
func TestDifferentFixBlocksAreAllKept(t *testing.T) {
	findings := []AuditFinding{
		find("policy-no-logging", func(f *AuditFinding) { f.Fix = []string{"edit 1", "set logtraffic all"} }),
		find("policy-no-logging", func(f *AuditFinding) { f.Fix = []string{"edit 2", "set logtraffic all"} }),
	}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.15")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if got := len(plan.Steps[0].CLI); got != 4 {
		t.Errorf("CLI has %d lines, want 4 — two distinct blocks", got)
	}
}

// A step with no CLI must say what a person has to do instead. A step with neither says nothing at
// all, which is the one outcome worse than no plan.
func TestEveryStepEitherRunsOrExplains(t *testing.T) {
	for _, check := range AuditChecks {
		refs := ControlsForCheck(check)
		if len(refs) == 0 {
			continue
		}
		plan, err := BuildRemediationPlan(nil,
			[]AuditFinding{find(check, func(f *AuditFinding) { f.Fix = nil })}, nil, refs[0].ID)
		if err != nil {
			t.Fatalf("%s: %v", check, err)
		}
		if len(plan.Steps) == 0 {
			t.Errorf("%s produced no step at all", check)
			continue
		}
		s := plan.Steps[0]
		if len(s.CLI) == 0 && strings.TrimSpace(s.Manual) == "" {
			t.Errorf("%s has no fix CLI and no manual instruction — add one to manualRemediation in audit_remediation.go", check)
		}
	}
}

func TestManualRemediationNamesOnlyRealChecks(t *testing.T) {
	known := map[string]bool{}
	for _, c := range AuditChecks {
		known[c] = true
	}
	for check := range manualRemediation {
		if !known[check] {
			t.Errorf("manualRemediation describes %q, which the engine never emits", check)
		}
	}
}

// Clutter is not a control failure, and a plan must not present tidying it as closing anything.
func TestAdvisoryStepsAreMarked(t *testing.T) {
	findings := []AuditFinding{
		find("object-unused", func(f *AuditFinding) { f.Severity = SeverityLow; f.Category = "Objects" }),
	}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.9")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if len(plan.Steps) != 1 || !plan.Steps[0].Advisory {
		t.Fatalf("object-unused must produce an advisory step, got %+v", plan.Steps)
	}
	if plan.Status != ControlObservation {
		t.Errorf("A.8.9 with only advisory findings should be an observation, got %q", plan.Status)
	}
}

// An acceptance is a decision to live with a finding, not a reason to hide it from a fix plan — but
// somebody planning tonight's work needs to know it was already signed for.
func TestAcceptedFindingsAreCountedNotHidden(t *testing.T) {
	findings := []AuditFinding{
		find("time-not-synced"),
		find("time-not-synced", func(f *AuditFinding) { f.Accepted = &AcceptedRisk{Reason: "signed"} }),
	}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.17")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	s := plan.Steps[0]
	if s.Findings != 2 {
		t.Errorf("Findings = %d, want both", s.Findings)
	}
	if s.Accepted != 1 {
		t.Errorf("Accepted = %d, want 1", s.Accepted)
	}
}

func TestUnknownControlIsAnError(t *testing.T) {
	if _, err := BuildRemediationPlan(nil, nil, nil, "A.99.99"); err == nil {
		t.Error("planning for a control that does not exist must fail rather than return an empty plan")
	}
}

// A clean control has nothing to plan, and must say so rather than reporting a closure it did not
// cause.
func TestACleanControlPlansNothing(t *testing.T) {
	plan, err := BuildRemediationPlan(nil, nil, nil, "A.8.17")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	if len(plan.Steps) != 0 {
		t.Errorf("a clean control produced steps: %+v", plan.Steps)
	}
	if plan.Status != ControlEvidenced || !plan.Closes {
		t.Errorf("status %q closes %v — an already-evidenced control stays evidenced", plan.Status, plan.Closes)
	}
}

// The caveat has to travel with the numbers. A before/after table read as a promise about the
// firewall rather than about the next scan is the misreading this whole file is arranged around.
func TestPlanCarriesItsCaveat(t *testing.T) {
	plan, _ := BuildRemediationPlan(nil, []AuditFinding{find("time-not-synced")}, nil, "A.8.17")
	for _, want := range []string{"next scan", "Nothing here is executed"} {
		if !strings.Contains(plan.Note, want) {
			t.Errorf("the projection note does not mention %q", want)
		}
	}
}

// A governance check emits `# Nothing to run on the device …` as its "fix". Rendering that inside a
// terminal block captioned "you run this" tells the reader two opposite things at once.
func TestACommentOnlyFixIsNotPresentedAsACommand(t *testing.T) {
	findings := []AuditFinding{find("config-no-baseline", func(f *AuditFinding) {
		f.Fix = []string{
			"# Nothing to run on the device. Take one, then schedule it:",
			"#   Automation > Devices > Backup",
		}
	})}
	plan, err := BuildRemediationPlan(nil, findings, nil, "A.8.9")
	if err != nil {
		t.Fatalf("BuildRemediationPlan: %v", err)
	}
	s := plan.Steps[0]
	if len(s.CLI) != 0 {
		t.Errorf("comment lines were kept as runnable CLI: %v", s.CLI)
	}
	if !strings.Contains(s.Manual, "Nothing to run on the device") {
		t.Errorf("the guidance was lost rather than moved: %q", s.Manual)
	}
	if strings.Contains(s.Manual, "#") {
		t.Errorf("the comment marker should not survive into prose: %q", s.Manual)
	}
}

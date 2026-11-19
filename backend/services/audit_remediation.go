package services

import (
	"fmt"
	"sort"
	"strings"
)

// ── "So how do I close this gap, and what happens if I do?" ──────────────────
//
// The Audit page has been able to say WHAT is wrong and WHICH control it speaks to since the
// standards layer landed. It has never been able to answer the next question, which is the only one
// anybody actually acts on: what do I change, and does changing it close the control or not?
//
// Both halves of that were previously left to the reader. Every finding already carries fix CLI
// (AuditFinding.Fix), but it sat one per finding on the Findings tab, in no particular order, with
// no statement of what it would achieve — so "close A.8.15" meant opening the tab, filtering by
// eye for the three checks behind that control, and reading eleven separate CLI blocks. And the
// "does it close the control?" half was pure guesswork: a control is a function of several checks,
// so fixing the findings you can see does not necessarily move it.
//
// THE PROJECTION IS COMPUTED, NOT PROMISED. This is the part that has to be right. The "after"
// column is produced by taking the scan's own findings, removing the ones the plan resolves, and
// running the SAME coverageFor() the live report runs. It is not a rule of thumb and not a
// prediction — it is the report this console would have produced from the same firewall with those
// findings absent. That has one consequence worth stating out loud, and the UI states it: it
// answers "what would the NEXT SCAN say", not "will the firewall be secure". A control that stays
// a gap in the after column stays a gap because some other check behind it is still failing, and
// the plan says which.
//
// WHAT IT WILL NOT DO. It does not execute anything. Every step here is CLI the operator reads,
// checks and runs through Config Deploy or the terminal, exactly as AuditFinding.Fix always was.
// A page that both decides what is wrong with a firewall and rewrites it unattended is a page that
// can take a production network down because a heuristic fired, and nothing in this file is
// authorised to do that.
//
// WHERE THE AI IS, AND WHERE IT IS NOT. The steps below are computed by the audit engine — no
// model is involved in deciding what is wrong or what CLI fixes it. The model's job is the part
// that is genuinely language: sequencing the steps for a change window, naming what could break,
// and saying what to check afterwards. That lives in AuditRemediationAdvice in ai.go and is
// labelled as AI-written wherever it appears, because a suggestion about a live firewall that a
// reader mistakes for a computed fact is the failure mode this whole feature is built to avoid.

// RemediationStep is one class of finding, and the CLI that resolves it.
//
// Grouped by CHECK rather than per finding: eleven policies missing a logging setting is one
// decision and eleven near-identical commands, and presenting it as eleven steps is how a plan
// stops being read.
type RemediationStep struct {
	Check    string        `json:"check"`
	Title    string        `json:"title"`
	Severity AuditSeverity `json:"severity"`
	Category string        `json:"category"`
	// Why is this console's own one-line summary of the class — the same sentence the Findings tab
	// shows, from checkSummaries. Marked as ours in the UI, as everywhere else.
	Why string `json:"why"`
	// Findings is how many of this scan's findings this step covers.
	Findings int `json:"findings"`
	// Subjects are what it applies to, in the order the scan found them. Capped for display; Findings
	// is always the true count.
	Subjects []string `json:"subjects"`
	// CLI is the commands, in order, deduplicated. Empty when the engine has no automatic fix.
	CLI []string `json:"cli,omitempty"`
	// Manual is set exactly when CLI is empty: what a person has to do instead, and why no command
	// can do it. A step with neither is a step that says nothing.
	Manual string `json:"manual,omitempty"`
	// Accepted is how many of Findings already carry a signed acceptance. They are still listed —
	// an acceptance is a decision to live with a finding, not a reason to hide it from a fix plan —
	// but a reader deciding what to do tonight needs to know somebody already signed for them.
	Accepted int `json:"accepted"`
	// Advisory marks a step that tidies rather than protects. Fixing it moves an observation, never
	// a gap, and it must not be presented as though it closes a control.
	Advisory bool `json:"advisory"`

	// ── Why you should believe the command ──
	//
	// The two answers to "who says this is the fix?", and they answer different halves of it:
	// Verification is the DEVICE confirming the attribute exists on its own firmware and accepts
	// this value; Docs is the MANUFACTURER's page for the table, linked and never quoted. Neither
	// is a claim that the change is a good idea — that is what the control mapping and the
	// projection are for.
	Verification []FixVerification `json:"verification,omitempty"`
	// Verdict is the worst of Verification, so a badge cannot read "verified" because three of four
	// attributes were.
	Verdict FixVerifyStatus `json:"verdict,omitempty"`
	Docs    []VendorDoc     `json:"docs,omitempty"`
}

// ControlProjection is one control's standing before and after the plan.
type ControlProjection struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Before   string `json:"before"`
	After    string `json:"after"`
	Findings int    `json:"findings"`
	// Resolved is how many of those findings the plan removes.
	Resolved int `json:"resolved"`
	// Changed is Before != After, carried so the UI and the PDF cannot compute it two ways.
	Changed bool `json:"changed"`
	// Target marks the control the plan was asked about, as opposed to the ones that move with it.
	Target bool `json:"target,omitempty"`
}

// FrameworkTally is the framework's headline numbers at one point in time.
type FrameworkTally struct {
	Gaps          int `json:"gaps"`
	Indeterminate int `json:"indeterminate"`
	Observations  int `json:"observations"`
	Evidenced     int `json:"evidenced"`
	NotAssessed   int `json:"not_assessed"`
}

// RemediationPlan is everything the page needs to answer "how do I close this, and what changes".
type RemediationPlan struct {
	FrameworkID  string            `json:"framework_id"`
	Framework    string            `json:"framework"`
	ControlID    string            `json:"control_id"`
	ControlTitle string            `json:"control_title"`
	Status       string            `json:"status"`
	Steps        []RemediationStep `json:"steps"`
	// Projection covers every control in the framework, not only the one asked about: the checks
	// behind one control feed others, and a plan that closes A.8.15 while quietly moving A.8.16
	// should say so before it is run, not after.
	Projection []ControlProjection `json:"projection"`
	Before     FrameworkTally      `json:"before"`
	After      FrameworkTally      `json:"after"`
	// Resolves is the total number of findings the plan removes.
	Resolves int `json:"resolves"`
	// Closes reports whether the target control ends up evidenced. Named rather than left for the
	// reader to infer from two status strings.
	Closes bool `json:"closes"`
	// Blocked explains why the control does NOT close, when it does not. Always set when Closes is
	// false, and it is the most useful sentence on the page: it is the difference between "your fix
	// is incomplete" and "no configuration change can settle this here".
	Blocked string `json:"blocked,omitempty"`
	// Note is the standing caveat about what a projection is.
	Note string `json:"note"`

	// SchemaSource says which device and firmware the command checks were run against. A verdict
	// with no provenance is the same kind of unsourced claim this layer exists to remove.
	SchemaSource *SchemaSource `json:"schema_source,omitempty"`
	// EvidenceNote explains, in one place, what "verified" does and does not mean.
	EvidenceNote string `json:"evidence_note,omitempty"`
}

// evidenceNote is the sentence that has to travel with a verified badge, because "verified" is
// exactly the word a reader will over-read if nobody bounds it.
const evidenceNote = "Verified means this firewall's own schema confirms the attribute and accepts " +
	"the value — not that the change is safe to make now."

const projectionNote = "This is what the next scan would report, not a promise about the firewall. " +
	"Nothing here is executed — every command is yours to review and run."

// manualRemediation explains the checks the engine cannot write CLI for. Each sentence says what a
// person has to do and, implicitly, why a command cannot: the fix is not a firewall setting.
//
// It does not have to cover every check. Most checks emit CLI on the finding itself, and a few emit
// it for some findings and not others — a shadowed rule whose overlap this console cannot fully
// resolve, say. manualStepFor below is what guarantees a step is never silent whichever case it is.
var manualRemediation = map[string]string{
	"firmware-outdated": "Upgrade the device from the build it is running to the one FortiOS is offering. " +
		"That is a maintenance-window operation with a reboot, so it is deliberately not expressible as a " +
		"line of configuration — schedule it, take a configuration backup first, and confirm the running " +
		"version afterwards.",
	"review-overdue": "Review this firewall's rule base and record that you did. The evidence for a review " +
		"cadence is the record, not the configuration: nothing you can set on the device makes this control " +
		"answerable, which is why the check reads this console's own history instead.",
	"config-no-baseline": "Take a configuration backup, so there is a stored copy to compare the running " +
		"device against and to restore from. Backup / Recycle Bin does this and is what the check reads.",
	"config-baseline-stale": "Take a fresh configuration backup. The stored copy predates a change this " +
		"console recorded, so it no longer describes the running device and restoring from it would undo work.",
	"change-unrecorded": "Account for the configuration change this console did not make — who made it, " +
		"through which route, and why. This is a process fix rather than a device one: the firewall cannot " +
		"tell you that a change it accepted was authorised.",
	"time-not-synced": "Point the device at an NTP server it can actually reach and confirm the clock " +
		"settles. The command is on the finding itself; if it is already configured, the fix is the " +
		"reachability of the server rather than the setting.",
}

// allComments reports whether every line is a CLI comment — i.e. there is nothing to run.
func allComments(lines []string) bool {
	if len(lines) == 0 {
		return false
	}
	for _, l := range lines {
		if !strings.HasPrefix(strings.TrimSpace(l), "#") {
			return false
		}
	}
	return true
}

// stripComments turns comment lines into the sentence they were always meant to be.
func stripComments(lines []string) []string {
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		out = append(out, strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "#")))
	}
	return out
}

// manualStepFor is what a step says when it has no command to give.
//
// A step with no CLI and no sentence is the one outcome worse than having no plan at all: the
// reader is shown a numbered item, told it matters, and given nothing to do. Most of the time the
// answer is the specific one above. When it is not — a check that usually emits CLI producing a
// finding that did not — the generic line still points somewhere real rather than leaving a blank.
func manualStepFor(check string) string {
	if s, ok := manualRemediation[check]; ok {
		return s
	}
	return "This scan produced no automatic command for these findings. Open them on the Findings " +
		"tab: each one names the policy or object it is about, which is what the change has to be " +
		"written against."
}

// BuildRemediationPlan works out how to close one control, and what closing it would do.
//
// findings and undecided are the scan's own; controlID names the control. The plan is computed from
// the same tables the report is, so it can never recommend a fix for a check that does not feed the
// control it claims to close.
//
// dev is the firewall, and it is OPTIONAL. Given one, every command in the plan is checked against
// that device's own ?action=schema — which is the only authority that can say a FortiOS command is
// well-formed for the build it will run on. Given nil, the plan is identical minus those verdicts,
// so the tests below can pin the arithmetic without a firewall.
func BuildRemediationPlan(dev SchemaReader, findings []AuditFinding, undecided []string, controlID string) (RemediationPlan, error) {
	var def *ControlDef
	for i := range controlUniverse {
		if controlUniverse[i].ID == controlID {
			def = &controlUniverse[i]
			break
		}
	}
	if def == nil {
		return RemediationPlan{}, fmt.Errorf("no control %q in the catalogue", controlID)
	}

	plan := RemediationPlan{
		FrameworkID:  def.Framework,
		Framework:    frameworkName(def.Framework),
		ControlID:    def.ID,
		ControlTitle: def.Title,
		Note:         projectionNote,
		EvidenceNote: evidenceNote,
	}

	// The checks that feed THIS control. A fix for anything else does not belong in this plan,
	// however tempting it is to bundle the whole scan into one button.
	owned := map[string]CheckLink{}
	for _, link := range def.AssessedBy {
		owned[link.Check] = link
	}

	// Group the scan's findings by check, keeping only ours.
	type bucket struct {
		findings []AuditFinding
		cli      []string
		targets  []FixTarget
		seen     map[string]bool
	}
	buckets := map[string]*bucket{}
	for _, f := range findings {
		if _, ok := owned[f.Check]; !ok {
			continue
		}
		b := buckets[f.Check]
		if b == nil {
			b = &bucket{seen: map[string]bool{}}
			buckets[f.Check] = b
		}
		b.findings = append(b.findings, f)
		// Deduplicate whole fix blocks: eleven policies missing one setting produce eleven
		// near-identical blocks, and a plan that repeats itself eleven times is one nobody reads to
		// the end. The per-policy lines inside a block differ, so the key is the block.
		if len(f.Fix) > 0 {
			key := strings.Join(f.Fix, "\n")
			if !b.seen[key] {
				b.seen[key] = true
				b.cli = append(b.cli, f.Fix...)
				// The targets follow the CLI they were built with, so the evidence describes what
				// is actually on screen rather than every finding the step covers.
				b.targets = append(b.targets, f.FixTargets...)
			}
		}
	}

	// Steps, in AuditChecks order — worst first, hygiene last, the same order the page groups by.
	for _, check := range AuditChecks {
		b := buckets[check]
		if b == nil {
			continue
		}
		step := RemediationStep{
			Check:    check,
			Title:    b.findings[0].Title,
			Severity: b.findings[0].Severity,
			Category: b.findings[0].Category,
			Why:      checkSummaries[check],
			Findings: len(b.findings),
			CLI:      b.cli,
			Advisory: IsAdvisoryCheck(check),
		}
		for _, f := range b.findings {
			if f.Accepted != nil {
				step.Accepted++
			}
			if f.Subject != "" && len(step.Subjects) < 8 {
				step.Subjects = append(step.Subjects, f.Subject)
			}
		}
		// A "fix" that is nothing but comment lines is not CLI, whatever its type says. Several
		// governance checks emit `# Nothing to run on the device …`, and rendering that inside a
		// terminal block captioned "you run this" tells the reader two opposite things at once.
		if allComments(step.CLI) {
			step.Manual = strings.TrimSpace(strings.Join(stripComments(step.CLI), " "))
			step.CLI = nil
		}
		if len(step.CLI) == 0 && step.Manual == "" {
			step.Manual = manualStepFor(check)
		}
		// The evidence for the command. Both are skipped for a step with no CLI: there is nothing
		// to verify about a sentence telling somebody to take a backup.
		if len(step.CLI) > 0 {
			step.Docs = VendorDocsFor(b.targets)
			if dev != nil {
				step.Verification = VerifyFixTargets(dev, b.targets)
				step.Verdict = SummariseVerification(step.Verification)
			}
		}
		plan.Steps = append(plan.Steps, step)
		plan.Resolves += len(b.findings)
	}

	// ── The projection ──
	//
	// Re-read the whole framework with the resolved findings gone. Every control, not just this
	// one: the checks behind one control feed others, and a plan that silently moves a neighbour is
	// the thing a reader most needs told before they run it.
	resolvedChecks := map[string]bool{}
	for _, s := range plan.Steps {
		resolvedChecks[s.Check] = true
	}

	before := map[string]int{}
	after := map[string]int{}
	for _, f := range findings {
		before[f.Check]++
		if !resolvedChecks[f.Check] {
			after[f.Check]++
		}
	}
	undecidedSet := map[string]bool{}
	for _, c := range undecided {
		undecidedSet[c] = true
	}

	for _, d := range controlUniverse {
		if d.Framework != def.Framework {
			continue
		}
		b := coverageFor(d, before, undecidedSet)
		a := coverageFor(d, after, undecidedSet)
		proj := ControlProjection{
			ID: d.ID, Title: d.Title,
			Before: b.Status, After: a.Status,
			Findings: b.Findings, Resolved: b.Findings - a.Findings,
			Changed: b.Status != a.Status,
			Target:  d.ID == def.ID,
		}
		plan.Projection = append(plan.Projection, proj)
		tally(&plan.Before, b.Status)
		tally(&plan.After, a.Status)
		if d.ID == def.ID {
			plan.Status = b.Status
			plan.Closes = a.Status == ControlEvidenced
			if !plan.Closes {
				plan.Blocked = blockedReason(d, a, undecidedSet, after)
			}
		}
	}
	sort.SliceStable(plan.Projection, func(i, j int) bool {
		// The control asked about first, then the ones that move, then the rest.
		pi, pj := plan.Projection[i], plan.Projection[j]
		if pi.Target != pj.Target {
			return pi.Target
		}
		if pi.Changed != pj.Changed {
			return pi.Changed
		}
		return naturalLess(pi.ID, pj.ID)
	})
	return plan, nil
}

func tally(t *FrameworkTally, status string) {
	switch status {
	case ControlGap:
		t.Gaps++
	case ControlIndeterminate:
		t.Indeterminate++
	case ControlObservation:
		t.Observations++
	case ControlNotAssessed:
		t.NotAssessed++
	default:
		t.Evidenced++
	}
}

// blockedReason says, in one sentence a reader can act on, why the control does not come back
// evidenced even after the plan runs.
//
// It exists because "still a gap" on its own is the least useful thing a projection can say. There
// are only a few ways it happens and each has a different answer, so each gets its own sentence
// rather than one hedge covering all of them.
func blockedReason(def ControlDef, after ControlCoverage, undecided map[string]bool, counts map[string]int) string {
	switch after.Status {
	case ControlNotAssessed:
		if after.NotAssessed != "" {
			return after.NotAssessed
		}
		return "Nothing in this console assesses this control, so no configuration change here can settle it."
	case ControlIndeterminate:
		var stuck []string
		for _, link := range def.AssessedBy {
			if undecided[link.Check] && counts[link.Check] == 0 {
				stuck = append(stuck, link.Check)
			}
		}
		return "A check behind this control could not be evaluated on this device (" +
			strings.Join(stuck, ", ") + "), so the control stays undecided however much is fixed. " +
			"The scan's notes say what it could not read."
	case ControlObservation:
		return "What is left against this control is advisory — clutter in the rule base rather than " +
			"traffic that can pass. It was never a gap, and tidying it is optional."
	case ControlGap:
		var left []string
		for _, link := range def.AssessedBy {
			if counts[link.Check] > 0 {
				left = append(left, link.Check)
			}
		}
		if len(left) == 0 {
			return "The control stays open on evidence this plan does not cover."
		}
		return "Findings remain on " + strings.Join(left, ", ") +
			", which also feed this control. Closing it means fixing those too."
	}
	return ""
}

package services

import (
	"os"
	"sort"
	"strings"
	"unicode"
)

// ── Standards mapping for Audit / Review ─────────────────────────────────────
//
// The audit engine next door computes findings. This file answers the other question a customer
// asks: "says who?"
//
// THE LINE THIS FILE MUST NOT CROSS. A finding is a computation — it is either true of the config
// or it is not. A control mapping is an INTERPRETATION: a person decided that "this policy is
// shadowed" is evidence for "NSC rulesets are reviewed". Those two things carry different
// warranties, so they are kept in different files, the interpretation is marked as a draft until a
// qualified assessor signs it off (CatalogueStatus below), and nothing here is ever allowed to say
// the word "compliant".
//
// WHY FSBP IS NOT IN THIS TABLE. FortiGate publishes its own Security Rating with FSBP and PCI ids
// attached to each of ITS checks. Those ids belong to Fortinet's checks, not ours, and borrowing
// "the nearest one" would be inventing a mapping and then attributing it to the vendor. The relay
// that read that report is gone — it went with the Device Rating tab when this page was narrowed to
// ISO/IEC 27001 — so FSBP no longer appears in this product at all. Everything in the catalogue
// below is ours, and is labelled as ours; that is the rule the test below still enforces.
//
// WHY ONE FRAMEWORK. This layer carried four — PCI DSS, ISO/IEC 27001, NIST SP 800-53 and NIST
// CSF. Three were withdrawn on request and ISO/IEC 27001 is what remains, because it is the one
// this deployment is assessed against and a page that answers one standard properly is worth more
// than four it answers partially.
//
// Nothing about the LAYER is ISO-specific: frameworkOrder below and the tables in
// audit_control_universe.go are the whole framework surface, and coverage, statuses, the
// methodology card and the evidence PDF all walk them without naming a framework. Putting PCI or
// NIST back is those two edits and no others.
//
// The licensing rule that governed the old four still governs this one: control NAMES are quoted,
// the standard's body text is not. ISO/IEC 27001's text is copyright ISO/IEC, so it appears
// nowhere in this repository — the same reason CIS Benchmarks were never here, their
// recommendation text needing a CIS SecureSuite agreement to ship inside a product.

// CatalogueStatus travels with every response so the UI cannot quietly present a draft mapping as
// a reviewed one.
//
// It is an ENVIRONMENT setting, not a constant, and the default is "draft" on purpose. Hard-coding
// "reviewed" would mean the source tree itself asserts that a qualified assessor signed the mapping
// off — an assertion that would then ship to every deployment, including the ones where nobody has.
// Making it a deployment fact keeps that claim attached to the environment that can actually back
// it: a demo or simulation sets AUDIT_CATALOGUE_STATUS=reviewed in its own .env, and a fresh
// checkout still tells the truth.
func CatalogueStatusValue() string {
	if v := strings.TrimSpace(os.Getenv("AUDIT_CATALOGUE_STATUS")); v != "" {
		return v
	}
	return "draft"
}

// ControlStrength separates "this finding IS the evidence" from "this finding helps".
type ControlStrength string

const (
	// StrengthDirect — the finding is, on its own, evidence about that control.
	StrengthDirect ControlStrength = "direct"
	// StrengthSupporting — the finding contributes, but the control needs other evidence too.
	StrengthSupporting ControlStrength = "supporting"
)

// Framework ids — stable slugs used by the API and the UI.
//
// One entry, and it stays a named constant rather than an inlined string: the id is what a stored
// audit run, an exception and the evidence PDF are keyed on, so it must be impossible to typo in
// one place and not another.
const (
	FrameworkISO27k = "iso-27001"
)

// TitleSource says who wrote the words next to the control id.
//
// This exists because the first cut of this file did not have it, and that was a real defect: ISO
// and NIST rows carried the standards' actual control names while PCI rows carried summaries
// written here, and the UI rendered both identically. A reader could not tell which sentences were
// quotable and which were ours -- next to a genuine control number, that is exactly the kind of
// quiet overstatement this whole feature exists to avoid.
//
// Every row in the catalogue is TitleOfficial today, because ISO/IEC publishes its Annex A control
// NAMES and those are what the table carries. TitleParaphrase is kept rather than deleted: it is
// the guarantee that a future framework whose text cannot be quoted gets marked instead of blending
// in, and the UI still renders the marker for it.
type TitleSource string

const (
	// TitleOfficial -- the control's own name, as published. Safe to quote.
	TitleOfficial TitleSource = "official"
	// TitleParaphrase -- written here, summarising what the control is about. NOT quotable, and
	// shown with a marker so nobody attributes it to the publisher.
	TitleParaphrase TitleSource = "paraphrase"
)

// ControlRef is one control a finding speaks to.
type ControlRef struct {
	FrameworkID string          `json:"framework_id"`
	Framework   string          `json:"framework"`
	Version     string          `json:"version"`
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	TitleSource TitleSource     `json:"title_source"`
	Strength    ControlStrength `json:"strength"`
}

type frameworkMeta struct {
	ID        string
	Name      string
	Version   string
	Publisher string
	// Note is shown in the UI beside the framework name. It states the limit of what this tool
	// can say about that framework, in the framework's own terms.
	Note string
}

// frameworkOrder is the display order, and — since the withdrawal of the other three — the list of
// frameworks this console will talk about at all. It stays a slice rather than collapsing into a
// single value so that everything downstream keeps iterating: BuildStandardsCoverage, the UI's
// framework cards and the evidence PDF are written against "the frameworks", and a second one
// added here needs no other change in this layer.
var frameworkOrder = []frameworkMeta{
	{
		ID: FrameworkISO27k, Name: "ISO/IEC 27001", Version: "2022", Publisher: "ISO/IEC",
		Note: "The Annex A controls a network device configuration can speak to, assessed or not. Control names are as published; the body text of the standard is copyright ISO/IEC and is not reproduced here. The other Annex A controls are outside what any configuration review can observe and are not listed.",
	},
}

// Where AuditChecks and the catalogue live now: audit_control_universe.go.
//
// Both used to be written here, check-first. They are declared control-first in that file instead,
// and the check -> control map this file's helpers read is derived from it — see the header there
// for why the direction had to be inverted.

// ControlsForCheck returns the controls a check speaks to, in display order.
func ControlsForCheck(check string) []ControlRef {
	refs := controlCatalogue[check]
	if len(refs) == 0 {
		return nil
	}
	out := make([]ControlRef, len(refs))
	copy(out, refs)
	return out
}

// ── Coverage: the same data read from the standard's side ────────────────────

// Control statuses. Six, not two, because every pair of them that got merged along the way turned
// out to be the place where the tool started overstating what it knew:
//
//	evidenced vs indeterminate — "we looked and found nothing" is not "we could not look"
//	evidenced vs not-assessed  — "we looked and found nothing" is not "we never looked"
//	evidenced vs accepted      — "it is clean" is not "somebody signed for it"
//	gap       vs observation   — "traffic can pass that should not" is not "the table is untidy"
const (
	ControlGap           = "gap"           // at least one finding contradicts this control
	ControlEvidenced     = "evidenced"     // every contributing check ran and found nothing
	ControlIndeterminate = "indeterminate" // a contributing check could not decide
	// ControlAccepted — the only findings against it have a signed, unexpired acceptance. Kept
	// apart from "evidenced" on purpose: one means the firewall is clean, the other means somebody
	// decided to live with it, and a reader must never mistake the second for the first.
	ControlAccepted = "accepted"
	// ControlObservation — the only findings against it are advisory: clutter in the rule base
	// rather than traffic that can pass. Before this existed, five orphaned address objects marked
	// PCI 1.2.5 as failed, which is not a reading any assessor would accept.
	ControlObservation = "observation"
	// ControlNotAssessed — nothing in this console assesses this control. It is listed anyway,
	// with the reason, because a control missing from the table is indistinguishable from a control
	// that passed. This is the status that gives the other five an honest denominator.
	ControlNotAssessed = "not-assessed"
)

// statusRank decides which status wins when several checks disagree about one control.
//
// A real finding outranks "could not tell", which outranks "only clutter", which outranks a clean
// result. Acceptance is applied afterwards (see audit_exceptions.go) and never competes here.
func statusRank(status string) int {
	switch status {
	case ControlGap:
		return 4
	case ControlIndeterminate:
		return 3
	case ControlObservation:
		return 2
	case ControlEvidenced:
		return 1
	}
	return 0
}

type ControlCoverage struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	TitleSource TitleSource     `json:"title_source"`
	Status      string          `json:"status"`
	Strength    ControlStrength `json:"strength,omitempty"`
	// Checks are the audit checks that speak to this control — the "how do you know" answer.
	Checks   []string `json:"checks"`
	Findings int      `json:"findings"`
	// NotAssessed is why nothing here assesses the control. Set exactly when Status is
	// ControlNotAssessed, and phrased as something the reader can act on.
	NotAssessed string `json:"not_assessed,omitempty"`
}

type FrameworkCoverage struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Publisher string `json:"publisher"`
	Note      string `json:"note"`
	// Status of the mapping itself, not of the device.
	CatalogueStatus string            `json:"catalogue_status"`
	Controls        []ControlCoverage `json:"controls"`
	Gaps            int               `json:"gaps"`
	Evidenced       int               `json:"evidenced"`
	Indeterminate   int               `json:"indeterminate"`
	Accepted        int               `json:"accepted"`
	Observations    int               `json:"observations"`
	// NotAssessed is how many of Controls this console does not evaluate at all. It is the
	// denominator that was missing: "6 evidenced" means nothing until a reader can see it sits
	// beside eighteen rows nobody looked at.
	NotAssessed int `json:"not_assessed"`
	// Assessed is len(Controls) - NotAssessed, carried explicitly so the UI and the PDF cannot
	// compute it two different ways.
	Assessed int `json:"assessed"`
}

// BuildStandardsCoverage turns findings into a per-framework, per-control view.
//
// IT WALKS THE CONTROLS, NOT THE CHECKS. That is the whole difference between this and the version
// it replaced. Iterating the checks made the control list equal to "whatever we happen to check",
// so a clean scan produced a framework card reading "0 gaps, 6 evidenced" with no way for a reader
// to know that eighteen sibling requirements had never been looked at. Walking the universe in
// audit_control_universe.go means every framework carries its own denominator, and a control this
// console cannot evaluate says so in its own row instead of being absent.
//
// undecided lists checks the scan could not fully evaluate on this device (shadow detection gives
// up on FQDN/geography/dynamic objects, for instance). A control whose only evidence came from
// such a check is reported as indeterminate rather than as passing — claiming "evidenced" off a
// check that did not finish is the single most damaging thing a compliance tool can do.
func BuildStandardsCoverage(findings []AuditFinding, undecided []string) []FrameworkCoverage {
	countByCheck := map[string]int{}
	for _, f := range findings {
		countByCheck[f.Check]++
	}
	undecidedSet := map[string]bool{}
	for _, c := range undecided {
		undecidedSet[c] = true
	}

	// Findings from a check nothing maps would be computed and then silently dropped here. That is
	// a wiring mistake rather than a user-facing state, and a test catches it, but the count is
	// carried so a caller can assert on it rather than reading the code.
	byFramework := map[string][]ControlCoverage{}
	for _, def := range controlUniverse {
		byFramework[def.Framework] = append(byFramework[def.Framework], coverageFor(def, countByCheck, undecidedSet))
	}

	out := make([]FrameworkCoverage, 0, len(frameworkOrder))
	for _, meta := range frameworkOrder {
		fc := FrameworkCoverage{
			ID: meta.ID, Name: meta.Name, Version: meta.Version,
			Publisher: meta.Publisher, Note: meta.Note, CatalogueStatus: CatalogueStatusValue(),
			Controls: byFramework[meta.ID],
		}
		for _, cov := range fc.Controls {
			switch cov.Status {
			case ControlGap:
				fc.Gaps++
			case ControlIndeterminate:
				fc.Indeterminate++
			case ControlObservation:
				fc.Observations++
			case ControlNotAssessed:
				fc.NotAssessed++
			default:
				fc.Evidenced++
			}
		}
		fc.Assessed = len(fc.Controls) - fc.NotAssessed
		sort.Slice(fc.Controls, func(i, j int) bool {
			return naturalLess(fc.Controls[i].ID, fc.Controls[j].ID)
		})
		out = append(out, fc)
	}
	return out
}

// coverageFor decides one control's standing from the checks that assess it.
func coverageFor(def ControlDef, countByCheck map[string]int, undecided map[string]bool) ControlCoverage {
	cov := ControlCoverage{
		ID: def.ID, Title: def.Title, TitleSource: def.TitleSource,
	}

	if len(def.AssessedBy) == 0 {
		cov.Status = ControlNotAssessed
		cov.NotAssessed = def.NotAssessed
		return cov
	}

	cov.Status = ControlEvidenced
	cov.Strength = StrengthSupporting

	// canEvidence tracks whether ANY link is capable of saying the control is met. A control
	// assessed only by falsify-only checks cannot be evidenced by a quiet scan, however many of
	// them ran — see CheckLink.FalsifyOnly for the live case that produced this rule.
	canEvidence := false
	var blind []string

	for _, link := range def.AssessedBy {
		cov.Checks = append(cov.Checks, link.Check)
		cov.Findings += countByCheck[link.Check]

		// A control is only as weak as its strongest evidence: one direct mapping makes the control
		// directly evidenced even if three supporting ones also point at it.
		if link.Strength == StrengthDirect {
			cov.Strength = StrengthDirect
		}
		if link.FalsifyOnly {
			blind = append(blind, link.Blind)
		} else {
			canEvidence = true
		}

		candidate := ControlEvidenced
		switch {
		case countByCheck[link.Check] > 0 && IsAdvisoryCheck(link.Check):
			// Clutter, not exposure. It is worth saying out loud and it is not a control failure.
			candidate = ControlObservation
		case countByCheck[link.Check] > 0:
			// A finding is conclusive whichever kind of link produced it: a falsify-only check
			// cannot confirm the control, but when it fires it has disproved it.
			candidate = ControlGap
		case link.FalsifyOnly:
			// Nothing found, and this link could never have shown anything anyway. It contributes
			// no status at all rather than a quiet pass.
			continue
		case undecided[link.Check]:
			candidate = ControlIndeterminate
		}
		if statusRank(candidate) > statusRank(cov.Status) {
			cov.Status = candidate
		}
	}

	// A clean result off falsify-only evidence is not a result. Say so, in the words of whatever
	// the check could not see.
	if cov.Status == ControlEvidenced && !canEvidence {
		cov.Status = ControlNotAssessed
		cov.NotAssessed = strings.Join(blind, " ")
	}

	sort.Strings(cov.Checks)
	return cov
}

// naturalLess orders control ids the way a human reads them.
//
// Plain string ordering puts ISO's A.8.16 before A.8.7 and PCI's 1.10 before 1.2, which makes a
// compliance table look like it was assembled by a machine that cannot count. Comparing digit runs
// numerically fixes both.
func naturalLess(a, b string) bool {
	ai, bi := 0, 0
	for ai < len(a) && bi < len(b) {
		ac, bc := a[ai], b[bi]
		if isDigit(ac) && isDigit(bc) {
			as, bs := ai, bi
			for ai < len(a) && isDigit(a[ai]) {
				ai++
			}
			for bi < len(b) && isDigit(b[bi]) {
				bi++
			}
			an := strings.TrimLeft(a[as:ai], "0")
			bn := strings.TrimLeft(b[bs:bi], "0")
			if len(an) != len(bn) {
				return len(an) < len(bn)
			}
			if an != bn {
				return an < bn
			}
			continue
		}
		if ac != bc {
			return unicode.ToLower(rune(ac)) < unicode.ToLower(rune(bc))
		}
		ai++
		bi++
	}
	return len(a)-ai < len(b)-bi
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// ── Methodology: the console's own vocabulary, written down ─────────────────
//
// Severity, strength and control status are all OUR judgements. Until this block existed they were
// only implicit in the code, which meant the honest answer to "why is any/any/any High and a
// redundant rule Medium?" was "because someone typed it there". A customer challenged on a report
// cannot use that answer, and neither can an assessor.
//
// Both the Standards tab and the evidence PDF render this, so the definition a reader sees on
// screen is the same sentence that lands in the document.

// Definition is one term and what this console means by it.
type Definition struct {
	Term    string `json:"term"`
	Meaning string `json:"meaning"`
}

// Methodology is everything a reader needs to know about how to read the report.
type Methodology struct {
	CatalogueStatus string `json:"catalogue_status"`
	// CatalogueVersion is which revision of the mapping produced this report. A reader comparing
	// two reports needs it to tell "the firewall changed" from "we changed our mind".
	CatalogueVersion string       `json:"catalogue_version"`
	SeverityBasis    []Definition `json:"severity_basis"`
	StrengthBasis    []Definition `json:"strength_basis"`
	StatusBasis      []Definition `json:"status_basis"`
	Note             string       `json:"note"`
}

// AuditMethodology returns the definitions behind every judgement in the report.
func AuditMethodology() Methodology {
	return Methodology{
		CatalogueStatus:  CatalogueStatusValue(),
		CatalogueVersion: CatalogueVersion,
		SeverityBasis: []Definition{
			{string(SeverityHigh), "Traffic can pass that the rule base was not written to allow; or the firewall itself can be reached over a channel that does not protect what crosses it; or a rule can never take effect at all. The intended design and the enforced behaviour differ."},
			{string(SeverityMedium), "A protection the design assumes is in place is not being applied, the same decision is written twice, or something the firewall did leaves no record. It works, but not as it was meant to."},
			{string(SeverityLow), "Nothing is exposed. The configuration carries clutter, or a default left weaker than it needs to be, which makes review harder and hides real problems behind noise."},
		},
		StrengthBasis: []Definition{
			{string(StrengthDirect), "The finding is, on its own, evidence about that control."},
			{string(StrengthSupporting), "The finding contributes, but the control still needs evidence this console cannot produce."},
		},
		StatusBasis: []Definition{
			{ControlGap, "At least one finding from this scan contradicts the control — traffic can pass that the rule base was not written to allow, or a protection the control asks for is not applied."},
			{ControlObservation, "The only findings against this control are advisory: clutter in the rule base — a disabled rule, a rule that has never matched, an object nothing references. Worth tidying; not a control failure."},
			{ControlIndeterminate, "A check behind the control could not be evaluated on this device, so nothing was proven either way."},
			{ControlAccepted, "The only findings against this control carry a signed, unexpired acceptance. The risk was decided on, not removed."},
			{ControlEvidenced, "Every check behind the control ran, and none of them found anything against it."},
			{ControlNotAssessed, "This console does not evaluate this control at all. The row states what would have to be read for it to be answerable. It is listed rather than omitted, because a control missing from the table is indistinguishable from a control that passed."},
		},
		Note: "Severity is this console's own judgement, not a rating published by ISO/IEC. " +
			"The control list is the set of Annex A controls a firewall configuration could speak to, not the whole of Annex A, and rows marked not-assessed are part of that list on purpose. " +
			"This console assesses ISO/IEC 27001 only; a finding here says nothing about any other standard. " +
			"None of these statuses is a compliance verdict: only a qualified assessor decides whether a control is met.",
	}
}

// ── Why a class of finding matters, with a citation ──────────────────────────
//
// The Audit page used to explain each check with a one-line blurb hard-coded in the React file.
// It read as authoritative and was nothing of the kind: six sentences somebody typed, with no way
// for a reader to check them and nothing behind them but our say-so.
//
// The rationale now travels from here with a CITATION attached, and the one-line summary is still
// ours but is labelled as ours. So the page answers "who says an any/any/any rule is a problem?"
// with a document reference rather than with a tone of voice.
//
// WHAT IS DELIBERATELY NOT HERE: quotations. Not one line of any publication is reproduced in this
// file. Citing a document by name, publisher and URL is safe even for a licensed standard; pasting
// sentences out of ISO/IEC 27001 is not, and pasting sentences that nobody here has checked word
// for word would be worse than either — it is exactly the failure this whole feature was built to
// avoid. A reader who wants the wording follows the link.

// ReferenceDoc is a publication a reader can go and check.
type ReferenceDoc struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Publisher string `json:"publisher"`
	URL       string `json:"url"`
	// PublicDomain marks the sources whose text may be reproduced. ISO/IEC's is not, which is why
	// this file cites it and quotes nothing from it.
	PublicDomain bool `json:"public_domain"`
}

// The publications this console will cite.
//
// It used to cite five: ISO/IEC 27001, PCI DSS, NIST SP 800-53, NIST CSF, and — under EVERY check —
// NIST SP 800-41, the one publication about firewall rule bases specifically. The four framework
// documents went with their frameworks. SP 800-41 went with them on request, so a check's rationale
// now cites the standard it maps to and nothing else.
//
// Worth knowing when reading a finding: SP 800-41 was the citation behind the SENTENCE ("why is an
// any/any/any rule a problem?"), not behind a control mapping, so a check that maps to no Annex A
// control now carries a summary with no citation at all. That is a real loss of falsifiability and
// it is deliberate, not an oversight — putting it back is one entry here and one line in
// RationaleFor.
var (
	docISO27001 = ReferenceDoc{
		ID:        "ISO/IEC 27001:2022",
		Title:     "Information security, cybersecurity and privacy protection — Information security management systems — Requirements",
		Publisher: "ISO/IEC",
		URL:       "https://www.iso.org/standard/27001",
	}
)

// frameworkDoc maps a framework id to the publication behind it, so a control reference on screen
// can be turned into something the reader can open.
var frameworkDoc = map[string]ReferenceDoc{
	FrameworkISO27k: docISO27001,
}

// CheckRationale is why a whole class of finding is worth a human's attention.
type CheckRationale struct {
	Check string `json:"check"`
	// Summary is OURS. The UI says so; it is not dressed up as a quotation.
	Summary string `json:"summary"`
	// Basis is every control this class of finding speaks to, strongest mapping first. It is not
	// filtered down to the direct ones: policy-disabled and object-unused have only supporting
	// mappings — that is what makes them Low — and showing an empty list for them would read as
	// "no standard cares about this" rather than "no standard treats this as decisive on its own".
	Basis []ControlRef `json:"basis"`
	// Sources are publications, cited and never quoted.
	Sources []ReferenceDoc `json:"sources"`
}

var checkSummaries = map[string]string{
	"policy-any-any":          "A rule that matches every source, every destination and every service permits far more than anyone intended, and nothing below it can narrow what it already allowed.",
	"policy-no-inspection":    "Traffic on its way to the internet passes with no antivirus, web filter or application control applied to it.",
	"policy-no-antivirus":     "Inspection is switched on for this path and other profiles do run, but no antivirus profile is attached — so the one class of traffic nobody argues about, malware in a download, is unexamined.",
	"policy-insecure-service": "The rule deliberately permits a protocol that carries its credentials and its payload in clear text, so anyone on the path between the two ends can read or alter both.",
	"policy-no-logging":       "Sessions this rule allows are not recorded, so there is no evidence of what was permitted, and an investigation afterwards has nothing to work from.",
	"policy-deny-no-logging":  "Attempts this rule blocks are not recorded, so repeated attempts to reach something forbidden leave no trace at all.",

	// The management plane. These answer "who can reach the firewall itself", which is the first
	// question every framework asks and the one the scan could not answer at all until the system
	// reads were added.
	"mgmt-cleartext-access": "The firewall answers administrative requests over a protocol that carries the password and the session in clear text, so anyone on the path can read them and alter what comes back.",
	"admin-unrestricted":    "An administrator account carries no trusted-host restriction, so whoever obtains its password can use it from any network the firewall answers on.",
	"admin-timeout-long":    "An administrative session left idle stays usable, so an unattended screen is an open session on the firewall.",
	"admin-lockout-weak":    "Failed administrative logins are never locked out, so a password can be guessed at for as long as somebody cares to keep trying.",
	"intf-no-antispoof":     "Reverse-path checking is off, so a packet claiming to come from a network that does not live behind that interface is forwarded anyway.",
	"firmware-outdated":     "The device is running an older build than the one being offered, so published fixes for known vulnerabilities are not applied.",
	"log-implicit-deny-off": "Traffic no policy matches is dropped by the implicit deny rule, and that drop is written nowhere - so an attempt to reach something forbidden leaves no trace however often it is repeated.",
	"log-no-remote":         "Nothing forwards this device's logs anywhere, so the record is lost on a reset, rotated away under load, and editable by whoever gains administrative access.",
	"time-not-synced":       "The clock is not synchronised, so every timestamp this firewall writes is one nobody can line up against another system's - which is what makes an incident reconstructable.",

	// This console's own records. These are the only checks that read no device at all - see
	// audit_governance.go for why the evidence for a review cadence cannot come from the rule base.
	"review-overdue":        "A firewall nobody has looked at is not the same as a firewall with nothing wrong, and the state of the rule base cannot tell the two apart - only a record of when it was last reviewed can.",
	"config-no-baseline":    "No stored copy of this device's configuration exists, so there is nothing to compare the running config against, nothing to restore from, and no record of what it looked like before.",
	"config-baseline-stale": "The stored configuration predates a change this console recorded, so it no longer describes the running device and restoring from it would undo work nobody meant to undo.",
	"change-unrecorded":     "The configuration moved between two reviews with nothing in the change record to account for it, so this firewall is being altered by a route that leaves no trace here.",
	"policy-shadowed":       "FortiOS stops at the first matching rule, so a rule fully covered by one above it can never take effect — the written policy and the enforced policy differ.",
	"policy-no-traffic":     "A rule that has never matched a packet is either unnecessary or does not describe what its author believed it did.",
	"policy-disabled":       "A rule switched off but left in place carries no traffic and makes the table longer to review.",
	"object-unused":         "An address or service nothing references any more is one more object to read past when reviewing the rule base.",
}

// RationaleFor returns why a check exists, with its citations.
func RationaleFor(check string) CheckRationale {
	out := CheckRationale{Check: check, Summary: checkSummaries[check]}

	// Sources are derived from the mapping and are no longer seeded with a standing citation, so a
	// check that maps to no control carries none. See the note on the doc block above.
	seen := map[string]bool{}

	for _, ref := range controlCatalogue[check] {
		out.Basis = append(out.Basis, ref)
		if doc, ok := frameworkDoc[ref.FrameworkID]; ok && !seen[doc.ID] {
			seen[doc.ID] = true
			out.Sources = append(out.Sources, doc)
		}
	}
	sort.SliceStable(out.Basis, func(i, j int) bool {
		return out.Basis[i].Strength == StrengthDirect && out.Basis[j].Strength != StrengthDirect
	})
	return out
}

// AuditRationales returns the rationale for every check the engine can emit.
func AuditRationales() []CheckRationale {
	out := make([]CheckRationale, 0, len(AuditChecks))
	for _, c := range AuditChecks {
		out = append(out, RationaleFor(c))
	}
	return out
}

package services

import "sort"

// ── The control universe: standards read top-down ────────────────────────────
//
// WHY THIS FILE EXISTS. The first version of the standards layer was written the other way round:
// a table of check → controls, and coverage was computed by walking the CHECKS. That made the
// universe of controls equal to "whatever happened to have a check", which has one consequence
// that no amount of careful wording elsewhere could repair — the denominator was invented. A
// clean scan would report "ISO/IEC 27001: 0 gaps, 6 evidenced" while eight Annex A controls in
// the same scope had never been looked at, and a reader has no way to tell the difference between
// a control that passed and a control that was never on the list.
//
// So the direction is inverted here. This file declares EVERY control that a FortiGate
// configuration could speak to — and for each one, either the checks that assess it or the reason
// nothing does. Coverage walks THIS table; the check → control map next door is derived from it,
// so there is exactly one place where an interpretation lives.
//
// ONE FRAMEWORK, ON PURPOSE. This console used to carry four — PCI DSS, ISO/IEC 27001, NIST SP
// 800-53 and NIST CSF. Three were withdrawn on request; ISO/IEC 27001 is the one this deployment
// is assessed against, and the Annex A table below is now the whole universe. Putting a framework
// back means adding its table here and its row to frameworkOrder in audit_standards.go — nothing
// else in this layer is framework-specific, which is the property the inversion above bought.
//
// THE RULE FOR ADDING A ROW. A control belongs here if a firewall's configuration is capable of
// evidencing it, whether or not this console can do so yet. A control does NOT belong here if it
// is about a document, a person, or a system this console never reads — those Annex A controls
// are outside what any configuration review can observe, and listing them only to mark every one
// "not assessed" would pad the denominator without telling a reader anything.
//
// THE RULE FOR NotAssessed. It is a sentence a customer can act on: what would have to be read for
// the row to be answerable. "Not assessed" with no reason is how a tool hides the fact that it
// does not know.

// CatalogueVersion identifies the INTERPRETATION that produced a report, so a trend that crosses a
// revision of this file can be read as one line rather than as a firewall that suddenly changed.
//
// It exists because the column meant to record exactly this — AuditRun.CatalogueVersion — was
// being filled with CatalogueStatusValue(), which returns "draft" or "reviewed". That value does
// not move when the mapping does, so the one safeguard against misreading our own edits as the
// customer's regression had never worked. Status and version are different facts and are now
// stored as two.
//
// Bump the minor part when a control's mapping, strength or wording changes; the major part when
// the shape of the universe changes. 1.x was the check-first catalogue, where the control list was
// whatever happened to have a check. 2.0.0 was this file's first revision, with the rule base only.
//
//	2.1.0  the management plane - administrators, interfaces, clock, log destinations, firmware
//	2.2.0  this console's own records - review cadence, configuration baseline, change attribution
//	3.0.0  ISO/IEC 27001 only. PCI DSS, NIST SP 800-53 and NIST CSF were withdrawn from this
//	       console on request, so the universe is a different SHAPE, not a different mapping: the
//	       denominator on every report drops from 79 controls to 14 and a trend line that crosses
//	       this revision is comparing two different questions. That is exactly what a major bump
//	       is for, and why it must not be read as the firewall having improved.
const CatalogueVersion = "3.0.0"

// CheckLink is one audit check that assesses a control, and how much weight it carries.
type CheckLink struct {
	Check    string
	Strength ControlStrength

	// FalsifyOnly marks a link that can CONTRADICT the control but can never evidence it. Finding
	// something is conclusive; finding nothing proves nothing, because the check does not see the
	// part of the configuration that would settle the question.
	//
	// It exists because of a live overclaim. PCI 10.2.1.4 asks that invalid access attempts be
	// logged, and policy-deny-no-logging inspects the deny rules for exactly that. The lab
	// FortiGate has no deny rules at all — every one of its seven policies is an accept — so the
	// check found nothing and the control came back "evidenced". Meanwhile the device's own
	// `log setting` reads `set fwpolicy-implicit-log disable`: the implicit deny that actually
	// blocks everything writes no log, and invalid attempts were going entirely unrecorded. The
	// scan was right about what it looked at and wrong about what that meant.
	//
	// A control whose only links are falsify-only reports as not-assessed until something reads
	// the blind spot. That is the honest answer, and it is the one this whole file exists for.
	FalsifyOnly bool
	// Blind names what the check cannot see. Required when FalsifyOnly is set, and shown to the
	// reader as the not-assessed reason — a limitation nobody can read is not a disclosure.
	Blind string
}

// ControlDef is one control in the assessable universe.
type ControlDef struct {
	Framework   string
	ID          string
	Title       string
	TitleSource TitleSource

	// AssessedBy lists the checks that speak to this control. Empty means nothing in this console
	// assesses it — and then NotAssessed must say why.
	AssessedBy []CheckLink
	// NotAssessed is required exactly when AssessedBy is empty. Enforced by a test.
	NotAssessed string
}

// AuditChecks is every check slug the audit engine can emit, in display order.
//
// Order matters twice: it is the order findings are grouped in on the page, and it is the order a
// control row lists its evidence in. Worst first, hygiene last.
var AuditChecks = []string{
	// The rule base: what can cross the firewall.
	"policy-any-any",
	"policy-no-inspection",
	"policy-no-antivirus",
	"policy-insecure-service",
	"policy-shadowed",
	// The management plane: who can reach the firewall itself.
	"mgmt-cleartext-access",
	"admin-unrestricted",
	"admin-timeout-long",
	"admin-lockout-weak",
	"intf-no-antispoof",
	"firmware-outdated",
	// The record: whether any of it is written down.
	"policy-no-logging",
	"policy-deny-no-logging",
	"log-implicit-deny-off",
	"log-no-remote",
	"time-not-synced",
	// This console's own records: whether the firewall is reviewed, backed up, and changed on the
	// record. Nothing here reads the device - see audit_governance.go.
	"review-overdue",
	"config-no-baseline",
	"config-baseline-stale",
	"change-unrecorded",
	// Hygiene, last. These open observations, never gaps - see advisoryChecks.
	"policy-no-traffic",
	"policy-disabled",
	"object-unused",
}

// advisoryChecks are the ones that report clutter rather than exposure.
//
// They exist because a rule base nobody prunes becomes a rule base nobody reviews, so they are
// worth reporting — but a control must not be marked as FAILING because five address objects are
// unreferenced. Before this distinction existed, "any finding at all opens a gap" treated "you
// have an orphaned address" exactly like "you have a rule that permits everything", and on the lab
// device eleven of seventeen findings were hygiene: they alone turned PCI 1.2.5, PCI 1.2.7, ISO
// A.8.9 and CM-7(1) red. No assessor would accept that reading, and a scorecard driven by clutter
// is a scorecard nobody looks at twice.
//
// A finding from one of these opens an OBSERVATION on the control instead of a gap.
var advisoryChecks = map[string]bool{
	"policy-no-traffic": true,
	"policy-disabled":   true,
	"object-unused":     true,
}

// IsAdvisoryCheck reports whether a check records clutter rather than exposure.
func IsAdvisoryCheck(check string) bool { return advisoryChecks[check] }

// dir / sup / falsifies keep the tables below readable as tables.
func dir(check string) CheckLink { return CheckLink{Check: check, Strength: StrengthDirect} }
func sup(check string) CheckLink { return CheckLink{Check: check, Strength: StrengthSupporting} }

// falsifies links a check that can only ever contradict the control. See CheckLink.FalsifyOnly.
func falsifies(check, blind string) CheckLink {
	return CheckLink{Check: check, Strength: StrengthDirect, FalsifyOnly: true, Blind: blind}
}

// ── ISO/IEC 27001:2022, Annex A ──────────────────────────────────────────────
//
// The Annex A controls a network device configuration can speak to. Titles are the published
// control NAMES; the standard's body text is copyright ISO/IEC and appears nowhere here.
var isoUniverse = []ControlDef{
	{ID: "A.8.2", Title: "Privileged access rights",
		AssessedBy: []CheckLink{dir("admin-unrestricted")}},
	{ID: "A.8.5", Title: "Secure authentication",
		AssessedBy: []CheckLink{dir("admin-lockout-weak"), sup("admin-timeout-long"), sup("mgmt-cleartext-access")}},
	{ID: "A.8.7", Title: "Protection against malware",
		AssessedBy: []CheckLink{dir("policy-no-antivirus"), dir("policy-no-inspection")}},
	{ID: "A.8.8", Title: "Management of technical vulnerabilities",
		AssessedBy: []CheckLink{dir("firmware-outdated")}},
	{ID: "A.8.9", Title: "Configuration management",
		AssessedBy: []CheckLink{dir("policy-shadowed"), dir("config-no-baseline"), sup("config-baseline-stale"), sup("review-overdue"), sup("policy-disabled"), sup("policy-no-traffic"), sup("object-unused")}},
	{ID: "A.8.15", Title: "Logging",
		AssessedBy: []CheckLink{dir("policy-no-logging"), dir("policy-deny-no-logging"), dir("log-implicit-deny-off"), sup("log-no-remote")}},
	{ID: "A.8.16", Title: "Monitoring activities",
		AssessedBy: []CheckLink{sup("policy-no-inspection"), sup("policy-no-logging"), sup("log-no-remote")}},
	{ID: "A.8.17", Title: "Clock synchronization",
		AssessedBy: []CheckLink{dir("time-not-synced")}},
	{ID: "A.8.20", Title: "Networks security",
		AssessedBy: []CheckLink{dir("policy-any-any"), sup("policy-insecure-service"), sup("intf-no-antispoof"), sup("mgmt-cleartext-access")}},
	{ID: "A.8.21", Title: "Security of network services",
		AssessedBy: []CheckLink{dir("policy-insecure-service")}},
	{ID: "A.8.22", Title: "Segregation of networks",
		AssessedBy: []CheckLink{sup("policy-any-any")}},
	{ID: "A.8.23", Title: "Web filtering",
		AssessedBy: []CheckLink{sup("policy-no-inspection")}},
	{ID: "A.8.24", Title: "Use of cryptography",
		AssessedBy: []CheckLink{dir("mgmt-cleartext-access")}},
	{ID: "A.8.32", Title: "Change management",
		AssessedBy: []CheckLink{falsifies("change-unrecorded",
			"Authorisation is not recorded in any configuration, ledger entry or backup this console holds. A change made outside this console can be detected; a change made through it being properly approved cannot.")}},
}

// controlUniverse is the framework's table, stamped with its framework id and title source.
//
// The stamping happens here rather than on each row so the licensing rule for a publisher lives in
// exactly one place. Every row carries the publisher's own control NAME (TitleOfficial); nothing
// in this console paraphrases an ISO control, and the standard's body text is never reproduced.
// See TitleSource in audit_standards.go for why that distinction is load-bearing.
var controlUniverse = buildUniverse()

func buildUniverse() []ControlDef {
	out := make([]ControlDef, 0, len(isoUniverse))
	stamp := func(defs []ControlDef, framework string, src TitleSource) {
		for _, def := range defs {
			def.Framework = framework
			def.TitleSource = src
			out = append(out, def)
		}
	}
	stamp(isoUniverse, FrameworkISO27k, TitleOfficial)
	return out
}

// controlCatalogue is the check → controls view, DERIVED from the universe above.
//
// It used to be the source of truth and hand-written; it is now a projection, so a control can
// never be mapped from one direction and missing from the other. Everything that used to read it
// (ControlsForCheck, RationaleFor) keeps working unchanged.
var controlCatalogue = buildCheckCatalogue()

func buildCheckCatalogue() map[string][]ControlRef {
	fwIndex := map[string]int{}
	for i, meta := range frameworkOrder {
		fwIndex[meta.ID] = i
	}

	out := map[string][]ControlRef{}
	for _, def := range controlUniverse {
		for _, link := range def.AssessedBy {
			out[link.Check] = append(out[link.Check], ControlRef{
				FrameworkID: def.Framework,
				Framework:   frameworkName(def.Framework),
				Version:     frameworkVersion(def.Framework),
				ID:          def.ID,
				Title:       def.Title,
				TitleSource: def.TitleSource,
				Strength:    link.Strength,
			})
		}
	}
	// Display order inside a check: frameworks in the order the UI shows them, then control id the
	// way a human reads it. Deterministic, so two runs of the same scan produce the same document.
	for check := range out {
		refs := out[check]
		sort.SliceStable(refs, func(i, j int) bool {
			if fi, fj := fwIndex[refs[i].FrameworkID], fwIndex[refs[j].FrameworkID]; fi != fj {
				return fi < fj
			}
			return naturalLess(refs[i].ID, refs[j].ID)
		})
		out[check] = refs
	}
	return out
}

func frameworkName(id string) string {
	for _, m := range frameworkOrder {
		if m.ID == id {
			return m.Name
		}
	}
	return id
}

func frameworkVersion(id string) string {
	for _, m := range frameworkOrder {
		if m.ID == id {
			return m.Version
		}
	}
	return ""
}

package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// ── Audit: evidence from the console's own records ───────────────────────────
//
// The other two halves of this scan read the firewall. This one reads US.
//
// WHY IT HAD TO EXIST. Three controls were mapped, in the first version of the catalogue, from the
// state of the rule base: PCI 1.2.7 ("reviewed at least once every six months") and NIST CM-7(1)
// ("Periodic Review") were reported as directly evidenced because no shadowed policy was found.
// That is not what those controls ask. A rule base with nothing wrong in it is not evidence that
// anybody reviews it — an untouched firewall nobody has looked at since 2019 would pass exactly the
// same way. They were demoted to not-assessed, with a reason that said the evidence exists and is
// simply not read yet: this console records every scan it runs, every change it makes, and every
// configuration backup it takes.
//
// This file reads those three records. Nothing here touches a device.
//
// THE LINE THIS FILE MUST NOT CROSS, and it is a different line from the one in audit_standards.go.
// These records prove what happened THROUGH THIS CONSOLE. They cannot prove what happened outside
// it, and above all they cannot prove that anything was AUTHORISED. Who approved a change is not
// written in any configuration, any ledger row or any backup — so the change-control controls are
// linked falsify-only (see CheckLink.FalsifyOnly): an unrecorded change disproves them, and a quiet
// ledger evidences nothing.

// reviewCadenceDays is PCI DSS 1.2.7's six months, in days.
//
// Quoted, not chosen — the same requirement that caps an accepted risk at MaxExceptionDays. If the
// two ever need to differ they should stop sharing a comment, but today they are the same sentence
// in the same standard.
const reviewCadenceDays = 180

// fingerprintTables are the CMDB tables whose content decides whether "the configuration changed".
//
// They are the tables this audit is ABOUT: the rule base, the objects it references, the interfaces
// it runs on, the administrative settings and the logging that records it. A change anywhere in
// them moves the fingerprint; a counter ticking over does not, because none of these is runtime
// state.
// The service table is `firewall.service/custom`, with a DOT. FortiOS is inconsistent about this
// and `firewall/service/custom` returns HTTP 400 — which is how the first version of this list was
// wrong, and how it stayed silently wrong: a bad path made ConfigFingerprint return ok=false, the
// change check reported itself undetermined, and the report was honest about knowing nothing while
// the real problem was a typo. See svcPrimaryPath in fortigate_object.go, which had it right.
var fingerprintTables = []string{
	"firewall/policy",
	"firewall/address",
	"firewall/addrgrp",
	"firewall.service/custom",
	"router/static",
	"system/interface",
	"system/global",
	"system/admin",
	"log/setting",
}

// ConfigFingerprint hashes the device's configuration as it stands now.
//
// FortiOS stamps a `revision` on the envelope of every CMDB response, marking the state of that
// TABLE. There is no device-wide revision on 7.2.10, so the fingerprint is the combination of
// several — and it answers "was this device written to since the last review?", which is a slightly
// different question from "does it hold the same configuration". Creating an object and deleting it
// again leaves a different revision behind, so a change and its reversal are two changes here, not
// zero. See fgAPIResponse.Revision for what was measured on the live device.
//
// `count=1` is what makes this cheap. The revision covers the whole table however few rows are
// returned, so asking for one row drops the policy table from 42 KB to 6 KB and changes nothing
// about the answer.
//
// It returns no fingerprint at all if ANY table could not be read: one missing table would make
// today's value differ from yesterday's for a reason that has nothing to do with the customer's
// configuration, and "the config changed" is a claim this must never make by accident.
//
// The names of the tables that failed come back with it, and the caller says so in the report. That
// second return value is not decoration — the first version of fingerprintTables had a wrong path
// in it, every scan silently produced no fingerprint, and the change check dutifully reported
// itself as undetermined forever. A refusal nobody can see the reason for is indistinguishable
// from a feature that does not work.
func (f *FortiClient) ConfigFingerprint() (fingerprint string, failed []string) {
	revs := make([]string, len(fingerprintTables))
	bad := make([]string, len(fingerprintTables))

	fns := make([]func(), len(fingerprintTables))
	for i, table := range fingerprintTables {
		i, table := i, table
		fns[i] = func() {
			resp, err := f.do("GET", "/api/v2/cmdb/"+table+"?count=1", nil)
			if err != nil || strings.TrimSpace(resp.Revision) == "" {
				bad[i] = table
				return
			}
			revs[i] = table + "=" + resp.Revision
		}
	}
	Parallel(fns...)

	for _, table := range bad {
		if table != "" {
			failed = append(failed, table)
		}
	}
	if len(failed) > 0 {
		return "", failed
	}
	sort.Strings(revs)
	sum := sha256.Sum256([]byte(strings.Join(revs, "\n")))
	return hex.EncodeToString(sum[:]), nil
}

// ── What the console's records say ──────────────────────────────────────────

// GovernanceEvidence is the console's own record of this device, read once.
//
// Every section carries a Readable flag for the same reason the device reads do: a table that could
// not be queried must produce "could not tell", never a pass.
type GovernanceEvidence struct {
	// PreviousReviewAt is the newest audit run recorded BEFORE the one running now. It is the
	// previous review, which is what a cadence is measured between — the scan in progress is not
	// evidence that anybody reviewed this device last quarter.
	PreviousReviewAt time.Time
	HasPriorReview   bool
	ReviewsReadable  bool

	// PreviousFingerprint is the configuration fingerprint stored with that previous run, and
	// CurrentFingerprint is the one taken by the scan in progress. Unequal means the device was
	// written to in between — not necessarily that it now holds different settings.
	PreviousFingerprint string
	CurrentFingerprint  string

	// ChangesSincePreviousReview counts ledger entries for this device between the previous review
	// and now — the changes this console knows it made.
	ChangesSincePreviousReview int
	LastChangeAt               time.Time
	HasChanges                 bool
	LedgerReadable             bool

	LastBackupAt    time.Time
	HasBackup       bool
	BackupsReadable bool
}

// readGovernanceEvidence gathers what this console has recorded about one device.
//
// currentFingerprint may be empty when the device would not answer for it; the change-attribution
// check then reports itself as undetermined rather than guessing.
func readGovernanceEvidence(db *gorm.DB, deviceID uint, currentFingerprint string) GovernanceEvidence {
	ev := GovernanceEvidence{CurrentFingerprint: currentFingerprint}
	if db == nil || deviceID == 0 {
		return ev
	}

	// The previous review. Ordered by scanned_at rather than by id because a run is stored only
	// when the findings change, and the clock is what a cadence is measured on.
	var lastRun entity.AuditRun
	err := db.Where("network_device_id = ?", deviceID).
		Order("scanned_at DESC").First(&lastRun).Error
	switch {
	case err == nil:
		ev.ReviewsReadable = true
		ev.HasPriorReview = true
		ev.PreviousReviewAt = lastRun.ScannedAt
		ev.PreviousFingerprint = lastRun.ConfigRevision
	case err == gorm.ErrRecordNotFound:
		// Readable, and empty: this is the first review of this device. Not a failure, and not
		// evidence of a cadence either.
		ev.ReviewsReadable = true
	}

	// Changes this console made since that review.
	var lastChange entity.ChangeRecord
	q := db.Where("network_device_id = ?", deviceID)
	if ev.HasPriorReview {
		q = q.Where("created_at > ?", ev.PreviousReviewAt)
	}
	var n int64
	if q.Model(&entity.ChangeRecord{}).Count(&n).Error == nil {
		ev.LedgerReadable = true
		ev.ChangesSincePreviousReview = int(n)
	}
	if err := db.Where("network_device_id = ?", deviceID).
		Order("created_at DESC").First(&lastChange).Error; err == nil {
		ev.HasChanges = true
		ev.LastChangeAt = lastChange.CreatedAt
	} else if err != gorm.ErrRecordNotFound {
		ev.LedgerReadable = false
	}

	// The stored baseline.
	var backup entity.ConfigBackup
	switch err := db.Where("network_device_id = ?", deviceID).
		Order("created_at DESC").First(&backup).Error; {
	case err == nil:
		ev.BackupsReadable = true
		ev.HasBackup = true
		ev.LastBackupAt = backup.CreatedAt
	case err == gorm.ErrRecordNotFound:
		ev.BackupsReadable = true
	}

	return ev
}

// ── The checks ──────────────────────────────────────────────────────────────

// findings turns the console's records into findings, plus what could not be decided and why.
func (ev GovernanceEvidence) findings(now time.Time) (out []AuditFinding, undecided map[string]bool, notes []string) {
	undecided = map[string]bool{}

	// ── Review cadence ──
	switch {
	case !ev.ReviewsReadable:
		notes = append(notes, "this console's record of earlier scans could not be read — whether this device is reviewed on a cadence could not be evaluated")
		undecided["review-overdue"] = true
	case !ev.HasPriorReview:
		notes = append(notes, "this is the first review of this device that this console has recorded, so a review cadence cannot be evidenced yet — the next scan will have something to measure against")
		undecided["review-overdue"] = true
	default:
		if age := now.Sub(ev.PreviousReviewAt); age > time.Duration(reviewCadenceDays)*24*time.Hour {
			out = append(out, AuditFinding{
				Check: "review-overdue", Severity: SeverityMedium, Category: "Governance",
				Title: "The previous review of this firewall lapsed",
				Detail: fmt.Sprintf("the last review this console recorded was %s, %d days ago. PCI DSS 1.2.7 asks for network security control configurations to be reviewed at least once every six months (%d days); the gap before this scan was longer than that.",
					ev.PreviousReviewAt.UTC().Format("2 Jan 2006"), int(age.Hours()/24), reviewCadenceDays),
				Subject: "review cadence",
				Fix: []string{
					"# Nothing to run on the device. Schedule this scan so the gap cannot reopen:",
					"#   Automation > Calendar, or a routine that opens Audit / Review on this device",
				},
			})
		}
	}

	// ── The stored baseline ──
	switch {
	case !ev.BackupsReadable:
		notes = append(notes, "this console's configuration backups could not be read — whether a baseline exists could not be evaluated")
		undecided["config-no-baseline"] = true
		undecided["config-baseline-stale"] = true
	case !ev.HasBackup:
		out = append(out, AuditFinding{
			Check: "config-no-baseline", Severity: SeverityMedium, Category: "Governance",
			Title:   "No configuration baseline is held for this firewall",
			Detail:  "this console has never stored a configuration backup for this device. There is nothing to compare the running configuration against, nothing to restore from, and no record of what the firewall looked like before any of the changes in the ledger.",
			Subject: "configuration baseline",
			Fix: []string{
				"# Nothing to run on the device. Take one, then schedule it:",
				"#   Automation > Devices > Backup, and a recurring job to keep it current",
			},
		})
		// A baseline that does not exist cannot also be stale. Saying so keeps the second check
		// from reporting "could not tell" about something already reported as absent.
		undecided["config-baseline-stale"] = false
	case ev.HasChanges && ev.LastBackupAt.Before(ev.LastChangeAt):
		out = append(out, AuditFinding{
			Check: "config-baseline-stale", Severity: SeverityMedium, Category: "Governance",
			Title: "The stored baseline is older than the last recorded change",
			Detail: fmt.Sprintf("the newest configuration backup was taken %s, and this console recorded a change to the device on %s. The baseline no longer describes the running configuration, so a restore from it would undo work nobody meant to undo.",
				ev.LastBackupAt.UTC().Format("2 Jan 2006 15:04 UTC"), ev.LastChangeAt.UTC().Format("2 Jan 2006 15:04 UTC")),
			Subject: "configuration baseline",
			Fix: []string{
				"# Nothing to run on the device. Take a fresh backup:",
				"#   Automation > Devices > Backup",
			},
		})
	}

	// ── Changes made outside this console ──
	//
	// The fingerprint moved and the ledger is empty for that window: something rewrote this
	// firewall and it was not this console. That is a statement about the RECORD, not about
	// authorisation — the wording says so, because "unrecorded here" and "unapproved" are not the
	// same claim and only one of them is provable.
	switch {
	case !ev.LedgerReadable:
		notes = append(notes, "this console's change ledger could not be read — whether configuration changes are recorded could not be evaluated")
		undecided["change-unrecorded"] = true
	case ev.CurrentFingerprint == "" || ev.PreviousFingerprint == "":
		notes = append(notes, "no configuration fingerprint is stored from an earlier scan, so changes made outside this console could not be detected — from the next scan onward there will be one to compare against")
		undecided["change-unrecorded"] = true
	case ev.CurrentFingerprint != ev.PreviousFingerprint && ev.ChangesSincePreviousReview == 0:
		out = append(out, AuditFinding{
			Check: "change-unrecorded", Severity: SeverityMedium, Category: "Governance",
			Title: "The configuration changed, and this console did not do it",
			Detail: fmt.Sprintf("the firewall's configuration differs from what it was at the previous review on %s, and the change ledger holds no entry for this device in that window. Something rewrote this device outside this console — through its own GUI, its CLI, or another tool — so who made the change and what it replaced are not recorded anywhere here.",
				ev.PreviousReviewAt.UTC().Format("2 Jan 2006 15:04 UTC")),
			Subject: "change attribution",
			Fix: []string{
				"# Nothing to run on the device. Compare against the stored baseline to see what moved:",
				"#   Automation > Config Deploy > Diff, or Security > Change Ledger for what IS recorded",
			},
		})
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Subject < out[j].Subject })
	return out, undecided, notes
}

// ApplyAuditRecords folds everything this application knows into a finished scan: its own records
// first, then the sign-offs.
//
// It exists because more than one place runs an audit — the Audit page and the remediation apply
// flow among them — and every one of them has to apply the same layers in the same order or the
// same firewall reads differently depending on which screen you opened.
//
// Order matters. Governance first, so a finding it raises can itself be accepted; acceptances last,
// because they are the only layer allowed to change how a finding is counted.
func ApplyAuditRecords(db *gorm.DB, deviceID uint, rep *AuditReport, now time.Time) {
	if rep == nil {
		return
	}
	applyGovernanceEvidence(rep, readGovernanceEvidence(db, deviceID, rep.ConfigFingerprint), now)
	if active, err := ActiveExceptions(db, deviceID, now); err == nil {
		ApplyExceptions(rep, active)
	}
}

// applyGovernanceEvidence folds the console's own records into a finished scan.
//
// It runs after RunAudit and before ApplyExceptions, for the same reason ApplyExceptions runs after
// the scan at all: the audit engine stays a pure function of the device's configuration, and
// everything that depends on this application's database is layered on afterwards where it can be
// left out entirely — a caller that passes no evidence gets exactly the report it got before.
func applyGovernanceEvidence(rep *AuditReport, ev GovernanceEvidence, now time.Time) {
	if rep == nil {
		return
	}

	found, undecided, notes := ev.findings(now)

	seen := map[string]bool{}
	for _, n := range rep.Notes {
		seen[n] = true
	}
	for _, n := range notes {
		if !seen[n] {
			seen[n] = true
			rep.Notes = append(rep.Notes, n)
		}
	}

	for _, f := range found {
		f.Controls = ControlsForCheck(f.Check)
		rep.Findings = append(rep.Findings, f)
		rep.Counts[string(f.Severity)]++
	}

	// Merge into the undecided set. A false here is meaningful: config-baseline-stale is
	// deliberately un-marked when the baseline is absent rather than unreadable.
	current := map[string]bool{}
	for _, c := range rep.UndecidedChecks {
		current[c] = true
	}
	for check, yes := range undecided {
		if yes {
			current[check] = true
		}
	}
	rep.UndecidedChecks = rep.UndecidedChecks[:0]
	for _, check := range AuditChecks {
		if current[check] {
			rep.UndecidedChecks = append(rep.UndecidedChecks, check)
		}
	}

	sortFindings(rep.Findings)
	rep.Standards = BuildStandardsCoverage(rep.Findings, rep.UndecidedChecks)
}

package services

import (
	"testing"
	"time"

	"network_automation/entity"
)

func exc(check, subject string) entity.AuditException {
	return entity.AuditException{
		Check: check, Subject: subject,
		Reason:     "legacy payment terminal needs this path until Q4 migration",
		ApprovedBy: "ciso@example.com",
		ApprovedAt: time.Now().Add(-24 * time.Hour),
		ExpiresAt:  time.Now().Add(30 * 24 * time.Hour),
	}
}

func reportWith(findings ...AuditFinding) *AuditReport {
	rep := &AuditReport{Counts: map[string]int{}}
	for _, f := range findings {
		rep.Findings = append(rep.Findings, f)
		rep.Counts[string(f.Severity)]++
	}
	rep.Standards = BuildStandardsCoverage(rep.Findings, nil)
	return rep
}

// The rule the whole design rests on: an accepted finding is MARKED, never removed. A tool that
// deletes the row is a mute button, and a mute button is how audit tools become shelfware.
func TestAcceptedFindingStaysInTheReport(t *testing.T) {
	rep := reportWith(
		AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #5 Test-DMZ"},
		AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1 default"},
	)
	ApplyExceptions(rep, map[ExceptionKey]entity.AuditException{
		{"policy-any-any", "policy #5 Test-DMZ"}: exc("policy-any-any", "policy #5 Test-DMZ"),
	})

	if len(rep.Findings) != 2 {
		t.Fatalf("report has %d findings, want 2 — an acceptance must not delete anything", len(rep.Findings))
	}
	var accepted, open int
	for _, f := range rep.Findings {
		if f.Accepted != nil {
			accepted++
		} else {
			open++
		}
	}
	if accepted != 1 || open != 1 {
		t.Errorf("accepted=%d open=%d, want 1 and 1", accepted, open)
	}
	if rep.AcceptedCount != 1 {
		t.Errorf("AcceptedCount = %d, want 1", rep.AcceptedCount)
	}
}

func TestAcceptedFindingCarriesTheSignOff(t *testing.T) {
	rep := reportWith(AuditFinding{Check: "policy-disabled", Severity: SeverityLow, Subject: "policy #9"})
	e := exc("policy-disabled", "policy #9")
	ApplyExceptions(rep, map[ExceptionKey]entity.AuditException{{"policy-disabled", "policy #9"}: e})

	got := rep.Findings[0].Accepted
	if got == nil {
		t.Fatal("finding carries no acceptance")
	}
	// Every one of these is what an assessor asks for. Dropping any of them makes the acceptance
	// unusable as evidence.
	if got.ApprovedBy != e.ApprovedBy {
		t.Errorf("approver = %q, want %q", got.ApprovedBy, e.ApprovedBy)
	}
	if got.Reason != e.Reason {
		t.Errorf("reason was lost")
	}
	if !got.ExpiresAt.Equal(e.ExpiresAt) {
		t.Errorf("expiry was lost")
	}
}

func TestAcceptedFindingLeavesTheSeverityCounts(t *testing.T) {
	rep := reportWith(
		AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #5"},
		AuditFinding{Check: "policy-disabled", Severity: SeverityLow, Subject: "policy #9"},
	)
	ApplyExceptions(rep, map[ExceptionKey]entity.AuditException{
		{"policy-any-any", "policy #5"}: exc("policy-any-any", "policy #5"),
	})

	if rep.Counts["high"] != 0 {
		t.Errorf("high count = %d, want 0 — an accepted risk is no longer open", rep.Counts["high"])
	}
	if rep.Counts["low"] != 1 {
		t.Errorf("low count = %d, want 1", rep.Counts["low"])
	}
}

// The other half of the same idea: a control that is only clean because somebody signed a waiver
// must not read as "evidenced". Those are different facts and a reader has to be able to tell.
func TestAcceptedRiskDoesNotMasqueradeAsEvidenced(t *testing.T) {
	rep := reportWith(AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #5"})
	ApplyExceptions(rep, map[ExceptionKey]entity.AuditException{
		{"policy-any-any", "policy #5"}: exc("policy-any-any", "policy #5"),
	})

	var iso FrameworkCoverage
	for _, fw := range rep.Standards {
		if fw.ID == FrameworkISO27k {
			iso = fw
		}
	}
	var found bool
	for _, c := range iso.Controls {
		if c.ID != "A.8.20" {
			continue
		}
		found = true
		if c.Status != ControlAccepted {
			t.Errorf("ISO A.8.20 is %q, want %q — its only finding was waived, not fixed", c.Status, ControlAccepted)
		}
	}
	if !found {
		t.Fatal("ISO A.8.20 missing from coverage")
	}
	if iso.Accepted == 0 {
		t.Error("framework counted no accepted controls")
	}
}

// A check with one waived finding and one still open is simply a gap. The waiver changed nothing
// about the control's status, and claiming otherwise would understate the problem.
func TestOneOpenFindingKeepsTheControlAGap(t *testing.T) {
	rep := reportWith(
		AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #5"},
		AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1"},
	)
	ApplyExceptions(rep, map[ExceptionKey]entity.AuditException{
		{"policy-any-any", "policy #5"}: exc("policy-any-any", "policy #5"),
	})

	for _, fw := range rep.Standards {
		if fw.ID != FrameworkISO27k {
			continue
		}
		for _, c := range fw.Controls {
			if c.ID == "A.8.20" && c.Status != ControlGap {
				t.Errorf("ISO A.8.20 is %q, want %q — one finding is still open", c.Status, ControlGap)
			}
		}
	}
}

func TestNoExceptionsLeavesTheReportAlone(t *testing.T) {
	rep := reportWith(AuditFinding{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #5"})
	before := rep.Counts["high"]
	ApplyExceptions(rep, nil)
	if rep.Counts["high"] != before || rep.AcceptedCount != 0 {
		t.Error("a report with no exceptions was modified")
	}
}

func TestExceptionExpiryAndRevocation(t *testing.T) {
	now := time.Now()
	live := entity.AuditException{ExpiresAt: now.Add(time.Hour)}
	if !live.Active(now) {
		t.Error("an unexpired, unrevoked acceptance is not active")
	}
	lapsed := entity.AuditException{ExpiresAt: now.Add(-time.Hour)}
	if lapsed.Active(now) {
		t.Error("an expired acceptance is still active — a temporary waiver became permanent")
	}
	revoked := entity.AuditException{ExpiresAt: now.Add(time.Hour), RevokedAt: &now}
	if revoked.Active(now) {
		t.Error("a revoked acceptance is still active")
	}
}

// ── Trend fingerprinting ────────────────────────────────────────────────────

func TestFingerprintIgnoresScanTimeAndOrder(t *testing.T) {
	a := AuditReport{
		ScannedAt: time.Now(),
		Findings: []AuditFinding{
			{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1"},
			{Check: "policy-disabled", Severity: SeverityLow, Subject: "policy #9"},
		},
	}
	b := AuditReport{
		ScannedAt: time.Now().Add(3 * time.Hour),
		Findings: []AuditFinding{
			{Check: "policy-disabled", Severity: SeverityLow, Subject: "policy #9"},
			{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1"},
		},
	}
	// If the time or the ordering leaked into the hash, every automatic rescan would store a new
	// row and the trend chart would be a wall of identical points.
	if auditFingerprint(a) != auditFingerprint(b) {
		t.Error("the same findings hashed differently — the history would fill with duplicates")
	}
}

func TestFingerprintNoticesARealChange(t *testing.T) {
	base := AuditReport{Findings: []AuditFinding{{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #1"}}}

	fixed := AuditReport{}
	if auditFingerprint(base) == auditFingerprint(fixed) {
		t.Error("fixing every finding did not change the fingerprint")
	}

	elsewhere := AuditReport{Findings: []AuditFinding{{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy #2"}}}
	if auditFingerprint(base) == auditFingerprint(elsewhere) {
		t.Error("the same problem on a different policy hashed the same")
	}

	worse := AuditReport{Findings: []AuditFinding{{Check: "policy-any-any", Severity: SeverityMedium, Subject: "policy #1"}}}
	if auditFingerprint(base) == auditFingerprint(worse) {
		t.Error("a severity change did not register")
	}
}

// A device that stops being able to answer for its hit counters reports the same findings but a
// weaker claim, and the history has to be able to tell those apart.
func TestFingerprintCoversUndecidedChecks(t *testing.T) {
	a := AuditReport{Findings: []AuditFinding{{Check: "policy-any-any", Subject: "policy #1"}}}
	b := a
	b.UndecidedChecks = []string{"policy-no-traffic"}
	if auditFingerprint(a) == auditFingerprint(b) {
		t.Error("a scan that could no longer evaluate a check hashed identically to one that could")
	}
}

// ── History retention ───────────────────────────────────────────────────────

func runAt(id, device uint, daysAgo int) entity.AuditRun {
	r := entity.AuditRun{NetworkDeviceID: device, ScannedAt: time.Now().AddDate(0, 0, -daysAgo)}
	r.ID = id
	return r
}

func TestRetentionKeepsEverythingInsideTheWindow(t *testing.T) {
	rows := []entity.AuditRun{runAt(1, 1, 0), runAt(2, 1, 200), runAt(3, 1, 729)}
	if ids := auditRunsToPurge(rows, time.Now(), AuditRunRetention); len(ids) != 0 {
		t.Errorf("purged %v — nothing inside the retention window may be touched", ids)
	}
}

// The rule that a plain "delete older than N" would get wrong.
func TestRetentionKeepsTheOldestRunAsTheBaseline(t *testing.T) {
	rows := []entity.AuditRun{
		runAt(1, 1, 1200), // the baseline: the first scan this device ever had
		runAt(2, 1, 1000),
		runAt(3, 1, 900),
		runAt(4, 1, 10), // inside the window
	}
	ids := auditRunsToPurge(rows, time.Now(), AuditRunRetention)

	for _, id := range ids {
		if id == 1 {
			t.Error("the oldest run was purged — the trend loses the baseline it is measured from")
		}
		if id == 4 {
			t.Error("a run inside the retention window was purged")
		}
	}
	if len(ids) != 2 {
		t.Errorf("purged %v, want the two middle runs", ids)
	}
}

// Each device keeps its own baseline, not just the fleet's oldest device.
func TestRetentionKeepsABaselinePerDevice(t *testing.T) {
	rows := []entity.AuditRun{
		runAt(1, 1, 1200), runAt(2, 1, 1100),
		runAt(3, 2, 1000), runAt(4, 2, 950),
	}
	ids := auditRunsToPurge(rows, time.Now(), AuditRunRetention)

	purged := map[uint]bool{}
	for _, id := range ids {
		purged[id] = true
	}
	if purged[1] || purged[3] {
		t.Errorf("purged %v — every device keeps its own first scan", ids)
	}
	if !purged[2] || !purged[4] {
		t.Errorf("purged %v, want the second run of each device", ids)
	}
}

func TestRetentionOnEmptyHistory(t *testing.T) {
	if ids := auditRunsToPurge(nil, time.Now(), AuditRunRetention); len(ids) != 0 {
		t.Errorf("purged %v from an empty table", ids)
	}
}

// Two years covers the two annual audits a customer is likely to be asked about, plus the review
// between them. If somebody shortens it below a year the history stops being usable as evidence.
func TestRetentionSpansMoreThanOneAuditCycle(t *testing.T) {
	if AuditRunRetention < 365*24*time.Hour {
		t.Errorf("retention is %v — shorter than one annual audit cycle", AuditRunRetention)
	}
}

// A configuration change that alters no finding still has to be stored, or the revision the
// change-attribution check compares against goes stale and reports the same unattributed change
// forever.
func TestFingerprintNoticesAConfigChangeWithIdenticalFindings(t *testing.T) {
	findings := []AuditFinding{{Check: "policy-any-any", Severity: SeverityHigh, Subject: "policy 1"}}

	before := auditFingerprint(AuditReport{Findings: findings, ConfigFingerprint: "aaa"})
	after := auditFingerprint(AuditReport{Findings: findings, ConfigFingerprint: "bbb"})
	if before == after {
		t.Error("the same findings on a changed configuration hashed identically - the stored revision would never be refreshed")
	}

	// And the reverse: same configuration, same findings, same hash. Otherwise every scan stores a
	// row and the trend becomes a smear of duplicates again.
	if auditFingerprint(AuditReport{Findings: findings, ConfigFingerprint: "aaa"}) != before {
		t.Error("an identical scan hashed differently")
	}
}

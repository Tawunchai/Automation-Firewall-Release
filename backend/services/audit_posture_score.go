package services

// Security Posture Score — one headline number distilled from the Audit / Review engine.
//
// Nothing in the audit feature reduces its findings to a single grade: BuildStandardsCoverage
// (audit_standards.go) returns a per-control breakdown across the 14-control ISO/IEC 27001
// catalogue, and AuditReport.Counts carries severity totals, but a reader still has to add those
// up themselves to answer "is this firewall in good shape, yes or no". This file is that addition,
// built on numbers the audit engine already computes — it introduces no new scan, no new finding,
// and no new opinion about what counts as a gap.
//
// WHY THIS CAN GRADE HISTORY TOO, FOR FREE. entity.AuditRun / AuditTrendPoint (audit_history.go)
// already store exactly the eight counts this formula needs (gaps, evidenced, indeterminate,
// accepted, observations, high, medium, low) for every scan that was ever persisted. That means a
// trend sparkline is not a new migration or a backfill job — it is this same formula applied to
// rows that already exist.
//
// THE FORMULA, AND WHY IT IS TWO HALVES. A pure control-coverage score (evidenced vs gap, out of
// 14) is coarse — each control is worth ~7 points, so one finding can swing the grade by a whole
// letter. A pure severity-weighted score is granular but has no sense of BREADTH — ten low-severity
// findings on ten different controls look the same as one finding repeated ten times. Blending both
// gives a number that moves smoothly with small changes and still means something in terms of the
// standard a customer actually asked about.
type PostureCounts struct {
	// Control-coverage half — the 14-control ISO/IEC 27001 catalogue's status tally, exactly as
	// BuildStandardsCoverage / AuditTrendPoint already carry it.
	Gaps          int
	Evidenced     int
	Indeterminate int
	Accepted      int
	Observations  int
	// NotAssessed is excluded from the denominator on purpose: a control nothing here can speak to
	// is not a failing grade, it is a question this scan does not answer.

	// Severity half — raw finding counts, exactly as AuditReport.Counts already carries them.
	High   int
	Medium int
	Low    int
}

// PostureScore is the headline number plus enough of its own arithmetic to be explained rather
// than just trusted.
type PostureScore struct {
	Score         int    `json:"score"`          // 0-100
	Grade         string `json:"grade"`          // "A+".."F"
	CoverageScore int    `json:"coverage_score"` // the control-coverage half, 0-100
	SeverityScore int    `json:"severity_score"` // the severity half, 0-100
	Assessed      int    `json:"assessed"`       // controls this score actually had an opinion on
	TotalControls int    `json:"total_controls"` // the catalogue size (Assessed + not-assessed)
}

// coverageWeight.go would be the obvious reach, but a lookup table of six entries does not need
// its own file. accepted counts the same as evidenced — a formally accepted risk is a closed
// decision, not an open one, and a score that kept punishing it would argue against ever accepting
// a risk at all. indeterminate earns partial credit: the scan genuinely could not tell, which is
// worth less than a clean pass but is not the same failure as a confirmed gap.
const (
	creditEvidenced     = 1.0
	creditAccepted      = 1.0
	creditObservation   = 0.5
	creditIndeterminate = 0.25
	creditGap           = 0.0
)

// Severity weights are deliberately steep: one high-severity finding should visibly move the
// number, the way one unlocked door matters more than several unlabeled ones. Capped at 100 so a
// device with dozens of findings still reads as "0", not a meaningless negative.
const (
	weightHigh   = 8
	weightMedium = 3
	weightLow    = 1
)

// coverageWeight returns 70/30 — coverage leads because it is scoped to a named standard (ISO
// 27001) a customer can hold this console to; severity is the finer-grained second opinion under it.
const (
	coverageWeight = 0.7
	severityWeight = 0.3
)

// ComputePostureScore turns one scan's (or one stored trend point's) counts into a single grade.
func ComputePostureScore(c PostureCounts) PostureScore {
	assessed := c.Gaps + c.Evidenced + c.Indeterminate + c.Accepted + c.Observations

	coverage := 100.0
	if assessed > 0 {
		credit := float64(c.Evidenced)*creditEvidenced +
			float64(c.Accepted)*creditAccepted +
			float64(c.Observations)*creditObservation +
			float64(c.Indeterminate)*creditIndeterminate +
			float64(c.Gaps)*creditGap
		coverage = 100 * credit / float64(assessed)
	}

	penalty := float64(c.High)*weightHigh + float64(c.Medium)*weightMedium + float64(c.Low)*weightLow
	if penalty > 100 {
		penalty = 100
	}
	severity := 100 - penalty

	score := coverageWeight*coverage + severityWeight*severity
	rounded := int(score + 0.5)
	if rounded > 100 {
		rounded = 100
	}
	if rounded < 0 {
		rounded = 0
	}

	return PostureScore{
		Score:         rounded,
		Grade:         postureGrade(rounded),
		CoverageScore: int(coverage + 0.5),
		SeverityScore: int(severity + 0.5),
		Assessed:      assessed,
		TotalControls: len(controlUniverse),
	}
}

// postureGrade mirrors a school report card, not a vendor's own star rating — nothing here is
// calibrated against another product's score, it is a readable band over this formula's own 0-100.
func postureGrade(score int) string {
	switch {
	case score >= 97:
		return "A+"
	case score >= 93:
		return "A"
	case score >= 90:
		return "A-"
	case score >= 87:
		return "B+"
	case score >= 83:
		return "B"
	case score >= 80:
		return "B-"
	case score >= 77:
		return "C+"
	case score >= 73:
		return "C"
	case score >= 70:
		return "C-"
	case score >= 60:
		return "D"
	default:
		return "F"
	}
}

package services

import "testing"

func TestComputePostureScore_AllEvidencedNoFindingsIsAPlus(t *testing.T) {
	s := ComputePostureScore(PostureCounts{Evidenced: 14})
	if s.Score != 100 || s.Grade != "A+" {
		t.Errorf("expected 100/A+, got %d/%s", s.Score, s.Grade)
	}
}

func TestComputePostureScore_AllGapsWithEnoughHighFindingsIsZeroF(t *testing.T) {
	// 13 high findings * weightHigh(8) = 104, already past the 100-point penalty cap.
	s := ComputePostureScore(PostureCounts{Gaps: 14, High: 13})
	if s.Score != 0 || s.Grade != "F" {
		t.Errorf("expected 0/F, got %d/%s", s.Score, s.Grade)
	}
}

func TestComputePostureScore_AcceptedCountsTheSameAsEvidenced(t *testing.T) {
	a := ComputePostureScore(PostureCounts{Evidenced: 14})
	b := ComputePostureScore(PostureCounts{Accepted: 14})
	if a.Score != b.Score {
		t.Errorf("a formally accepted risk must score the same as evidenced: %d vs %d", a.Score, b.Score)
	}
}

func TestComputePostureScore_IndeterminateEarnsPartialNotZeroCredit(t *testing.T) {
	gap := ComputePostureScore(PostureCounts{Gaps: 1, Evidenced: 13})
	indeterminate := ComputePostureScore(PostureCounts{Indeterminate: 1, Evidenced: 13})
	if indeterminate.CoverageScore <= gap.CoverageScore {
		t.Errorf("indeterminate (%d) should score above an equivalent gap (%d)",
			indeterminate.CoverageScore, gap.CoverageScore)
	}
	if indeterminate.CoverageScore >= 100 {
		t.Errorf("indeterminate must not score as if it were fully evidenced, got %d", indeterminate.CoverageScore)
	}
}

func TestComputePostureScore_NotAssessedIsExcludedFromTheDenominator(t *testing.T) {
	// Only the 14 real controls should ever be assessed, but a defensive input with an inflated
	// catalogue should not quietly change the meaning of a perfect score.
	s := ComputePostureScore(PostureCounts{Evidenced: 10})
	if s.CoverageScore != 100 {
		t.Errorf("10/10 assessed, all evidenced, must be 100%% coverage, got %d", s.CoverageScore)
	}
}

func TestComputePostureScore_SeverityPenaltyCapsAtZeroNotNegative(t *testing.T) {
	s := ComputePostureScore(PostureCounts{Evidenced: 14, High: 100})
	if s.SeverityScore != 0 {
		t.Errorf("severity score must floor at 0, got %d", s.SeverityScore)
	}
	if s.Score < 0 {
		t.Errorf("score must never go negative, got %d", s.Score)
	}
}

func TestComputePostureScore_OneHighFindingVisiblyMovesTheScore(t *testing.T) {
	clean := ComputePostureScore(PostureCounts{Evidenced: 14})
	oneHigh := ComputePostureScore(PostureCounts{Evidenced: 14, High: 1})
	if clean.Score-oneHigh.Score < 2 {
		t.Errorf("one high-severity finding should move the score noticeably, got %d -> %d", clean.Score, oneHigh.Score)
	}
}

func TestComputePostureScore_AssessedAndTotalControlsAreReported(t *testing.T) {
	s := ComputePostureScore(PostureCounts{Evidenced: 10, Gaps: 2})
	if s.Assessed != 12 {
		t.Errorf("expected Assessed=12, got %d", s.Assessed)
	}
	if s.TotalControls != len(controlUniverse) {
		t.Errorf("expected TotalControls=%d (the real catalogue size), got %d", len(controlUniverse), s.TotalControls)
	}
}

func TestPostureGrade_BoundariesMatchTheirOwnBands(t *testing.T) {
	cases := []struct {
		score int
		want  string
	}{
		{100, "A+"}, {97, "A+"}, {96, "A"}, {93, "A"}, {92, "A-"}, {90, "A-"},
		{89, "B+"}, {83, "B"}, {80, "B-"}, {77, "C+"}, {73, "C"}, {70, "C-"},
		{69, "D"}, {60, "D"}, {59, "F"}, {0, "F"},
	}
	for _, c := range cases {
		if got := postureGrade(c.score); got != c.want {
			t.Errorf("postureGrade(%d) = %q, want %q", c.score, got, c.want)
		}
	}
}

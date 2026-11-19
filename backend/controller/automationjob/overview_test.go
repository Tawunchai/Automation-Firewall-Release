package automationjob

import (
	"testing"
	"time"
)

// NetworkOverview used to issue twelve round trips — eleven COUNT/SUM/GROUP BY statements plus a
// Preload — for a page that is polled. They collapse into four by letting Postgres compute each
// table's aggregates in one pass: GROUP BY (vendor, status) carries both breakdowns, and
// COUNT(*) FILTER carries the conditional counts alongside them.
//
// The cost of that is that the conditional columns arrive REPEATED per group and have to be folded
// back up in Go. These tests pin the folding, because getting it wrong would under-report on the
// dashboard silently — the numbers would still look plausible.

func ts(s string) *time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return &t
}

// ── Devices ──────────────────────────────────────────────────────────────────

func TestFoldDeviceStats_SumsAcrossGroups(t *testing.T) {
	// Two vendors x two statuses. Postgres emits the FILTER counts per group, so the whole-table
	// figure is their SUM — reading any single row would under-report.
	rows := []deviceStatRow{
		{Vendor: "fortinet", Status: "active", Count: 5, BackupEnabled: 3, NeverBackedUp: 2, Stale: 1},
		{Vendor: "fortinet", Status: "inactive", Count: 2, BackupEnabled: 1, NeverBackedUp: 0, Stale: 0},
		{Vendor: "cisco", Status: "active", Count: 4, BackupEnabled: 2, NeverBackedUp: 1, Stale: 3},
	}

	got := foldDeviceStats(rows)

	if got.Total != 11 {
		t.Errorf("Total = %d, want 11", got.Total)
	}
	if got.BackupEnabled != 6 {
		t.Errorf("BackupEnabled = %d, want 6", got.BackupEnabled)
	}
	if got.NeverBackedUp != 3 {
		t.Errorf("NeverBackedUp = %d, want 3", got.NeverBackedUp)
	}
	if got.Stale != 4 {
		t.Errorf("Stale = %d, want 4", got.Stale)
	}
}

func TestFoldDeviceStats_BreakdownsCollapseTheOtherDimension(t *testing.T) {
	// The single grouped query replaces two separate GROUP BY queries. Each breakdown must add up
	// the rows that share its key, ignoring the other dimension.
	rows := []deviceStatRow{
		{Vendor: "fortinet", Status: "active", Count: 5},
		{Vendor: "fortinet", Status: "inactive", Count: 2},
		{Vendor: "cisco", Status: "active", Count: 4},
	}

	got := foldDeviceStats(rows)

	if got.ByVendor["fortinet"] != 7 {
		t.Errorf("ByVendor[fortinet] = %d, want 7 (5 active + 2 inactive)", got.ByVendor["fortinet"])
	}
	if got.ByVendor["cisco"] != 4 {
		t.Errorf("ByVendor[cisco] = %d, want 4", got.ByVendor["cisco"])
	}
	if got.ByStatus["active"] != 9 {
		t.Errorf("ByStatus[active] = %d, want 9 (5 fortinet + 4 cisco)", got.ByStatus["active"])
	}
	if got.ByStatus["inactive"] != 2 {
		t.Errorf("ByStatus[inactive] = %d, want 2", got.ByStatus["inactive"])
	}
}

func TestFoldDeviceStats_LastBackupIsTheLatestAcrossGroups(t *testing.T) {
	// MAX(last_backup_at) is per group, so the answer is the max of the maxes — not the first row,
	// and not the last.
	rows := []deviceStatRow{
		{Vendor: "fortinet", Status: "active", Count: 1, LastBackupAt: ts("2026-07-27T05:36:30Z")},
		{Vendor: "fortinet", Status: "inactive", Count: 1, LastBackupAt: ts("2026-08-01T10:00:00Z")},
		{Vendor: "cisco", Status: "active", Count: 1, LastBackupAt: ts("2026-06-15T00:00:00Z")},
	}

	got := foldDeviceStats(rows)

	if got.LastBackupAt == nil {
		t.Fatal("LastBackupAt is nil")
	}
	if want := *ts("2026-08-01T10:00:00Z"); !got.LastBackupAt.Equal(want) {
		t.Errorf("LastBackupAt = %v, want %v", got.LastBackupAt, want)
	}
}

func TestFoldDeviceStats_IgnoresGroupsThatNeverBackedUp(t *testing.T) {
	// A group where every device has last_backup_at NULL yields NULL from MAX(). It must be
	// skipped, not treated as the zero time (which would sort as "the latest" or blank the field).
	rows := []deviceStatRow{
		{Vendor: "fortinet", Status: "active", Count: 1, LastBackupAt: nil},
		{Vendor: "fortinet", Status: "inactive", Count: 1, LastBackupAt: ts("2026-08-01T10:00:00Z")},
		{Vendor: "cisco", Status: "active", Count: 1, LastBackupAt: nil},
	}

	got := foldDeviceStats(rows)

	if got.LastBackupAt == nil {
		t.Fatal("a NULL group blanked the last-backup time")
	}
	if want := *ts("2026-08-01T10:00:00Z"); !got.LastBackupAt.Equal(want) {
		t.Errorf("LastBackupAt = %v, want %v", got.LastBackupAt, want)
	}
}

func TestFoldDeviceStats_EmptyInventory(t *testing.T) {
	got := foldDeviceStats(nil)

	if got.Total != 0 || got.BackupEnabled != 0 || got.NeverBackedUp != 0 || got.Stale != 0 {
		t.Errorf("empty inventory gave non-zero counts: %+v", got)
	}
	if got.LastBackupAt != nil {
		t.Errorf("LastBackupAt = %v, want nil", got.LastBackupAt)
	}
	// Non-nil maps: the response marshals these directly, and a nil map becomes JSON null where
	// the dashboard expects an object.
	if got.ByVendor == nil || got.ByStatus == nil {
		t.Error("breakdown maps must be empty objects, not nil — the UI iterates them")
	}
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

func TestFoldJobStats_TotalsAndBreakdown(t *testing.T) {
	rows := []jobStatRow{
		{Status: "SUCCESS", Count: 40, Last24h: 5},
		{Status: "FAILED", Count: 10, Last24h: 2},
		{Status: "QUEUED", Count: 3, Last24h: 3},
	}

	got := foldJobStats(rows)

	if got.Total != 53 {
		t.Errorf("Total = %d, want 53", got.Total)
	}
	if got.Last24h != 10 {
		t.Errorf("Last24h = %d, want 10", got.Last24h)
	}
	if got.ByStatus["SUCCESS"] != 40 || got.ByStatus["FAILED"] != 10 || got.ByStatus["QUEUED"] != 3 {
		t.Errorf("ByStatus = %v", got.ByStatus)
	}
}

func TestFoldJobStats_SuccessRateExcludesUnfinishedJobs(t *testing.T) {
	// SUCCESS / (SUCCESS + FAILED), NOT SUCCESS / Total. Jobs still QUEUED or RUNNING have not
	// failed — counting them against the rate would make a healthy system look broken the moment
	// a batch backup was queued.
	rows := []jobStatRow{
		{Status: "SUCCESS", Count: 8},
		{Status: "FAILED", Count: 2},
		{Status: "QUEUED", Count: 90},
		{Status: "RUNNING", Count: 10},
	}

	got := foldJobStats(rows)

	if got.SuccessRate != 80 {
		t.Errorf("SuccessRate = %.1f, want 80 — queued/running jobs must not count as failures", got.SuccessRate)
	}
}

func TestFoldJobStats_SuccessRateEdgeCases(t *testing.T) {
	cases := []struct {
		name string
		rows []jobStatRow
		want float64
		why  string
	}{
		{"no jobs at all", nil, 0,
			"there is nothing to divide by — must not be NaN"},
		{"only queued jobs", []jobStatRow{{Status: "QUEUED", Count: 5}}, 0,
			"nothing has finished yet — must not divide by zero"},
		{"all succeeded", []jobStatRow{{Status: "SUCCESS", Count: 7}}, 100, ""},
		{"all failed", []jobStatRow{{Status: "FAILED", Count: 7}}, 0, ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := foldJobStats(c.rows).SuccessRate
			if got != c.want {
				t.Errorf("SuccessRate = %v, want %v — %s", got, c.want, c.why)
			}
			if got != got { // NaN check
				t.Error("SuccessRate is NaN — it would serialise as invalid JSON")
			}
		})
	}
}

func TestFoldJobStats_EmptyIsNotNilMap(t *testing.T) {
	if foldJobStats(nil).ByStatus == nil {
		t.Error("ByStatus must be an empty object, not nil — the UI iterates it")
	}
}

// The stale threshold is quoted to the user as "7 days" on the dashboard, so it must stay 7 days.
func TestStaleBackupAgeIsSevenDays(t *testing.T) {
	if staleBackupAge != 7*24*time.Hour {
		t.Errorf("staleBackupAge = %v, want 168h — the dashboard labels this bucket '7 days'", staleBackupAge)
	}
}

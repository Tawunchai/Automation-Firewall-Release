package drift

import (
	"fmt"
	"testing"
	"time"

	"network_automation/entity"
)

func TestDriftWindowStart_IsViewerMidnightDaysMinusOneBack(t *testing.T) {
	// 2026-09-10 01:30 UTC is 08:30 in Bangkok (+420) but still 2026-09-09 in New York (-240).
	now := time.Date(2026, 9, 10, 1, 30, 0, 0, time.UTC)

	bkk := driftWindowStart(now, 7, 420)
	if got := bkk.Format("2006-01-02 15:04 -0700"); got != "2026-09-04 00:00 +0700" {
		t.Fatalf("Bangkok 7-day window starts %s, want 2026-09-04 00:00 +0700", got)
	}

	ny := driftWindowStart(now, 1, -240)
	if got := ny.Format("2006-01-02 15:04 -0700"); got != "2026-09-09 00:00 -0400" {
		t.Fatalf("New York 1-day window starts %s, want the viewer's today, 2026-09-09", got)
	}
}

func TestFoldDriftAnalytics_ZeroFillsEveryDayInTheWindow(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	daily, tables, totals := foldDriftAnalytics(from, 5, nil, nil)

	if len(daily) != 5 {
		t.Fatalf("got %d days, want 5 — a quiet day is data, not a gap", len(daily))
	}
	if daily[0].Date != "2026-09-01" || daily[4].Date != "2026-09-05" {
		t.Fatalf("days run %s..%s, want 2026-09-01..2026-09-05", daily[0].Date, daily[4].Date)
	}
	if len(tables) != 0 || totals != (DriftAnalyticsTotals{}) {
		t.Fatalf("empty input produced tables=%v totals=%+v", tables, totals)
	}
}

func TestFoldDriftAnalytics_SeparatesFailedFromWhatChanged(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	ledger := []ledgerBucket{
		{Day: "2026-09-02", Status: entity.ChangeStatusApplied, CMDBPath: "/api/v2/cmdb/firewall/policy", N: 3},
		{Day: "2026-09-02", Status: entity.ChangeStatusFailed, CMDBPath: "/api/v2/cmdb/firewall/policy", N: 2},
		{Day: "2026-09-03", Status: entity.ChangeStatusReverted, CMDBPath: "/api/v2/cmdb/firewall/address", N: 1},
	}
	daily, tables, totals := foldDriftAnalytics(from, 3, ledger, nil)

	// A rejected write never changed the device: counted as failed, never as a console change.
	if totals.Console != 4 || totals.Failed != 2 || totals.Reverted != 1 {
		t.Fatalf("totals = %+v, want console 4 (3 applied + 1 reverted), failed 2, reverted 1", totals)
	}
	if daily[1].Console != 3 || daily[1].Failed != 2 {
		t.Fatalf("Sep 2 = %+v, want console 3 failed 2", daily[1])
	}
	for _, tb := range tables {
		if tb.Table == "firewall/policy" && tb.Console != 3 {
			t.Fatalf("firewall/policy console = %d, want 3 — failed writes must not count", tb.Console)
		}
	}
}

func TestFoldDriftAnalytics_JoinsLedgerAndDriftOnTheSameTable(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	ledger := []ledgerBucket{
		{Day: "2026-09-01", Status: entity.ChangeStatusApplied, CMDBPath: "/api/v2/cmdb/vpn.ipsec/phase1-interface", N: 2},
	}
	findings := []findingBucket{
		// The diff speaks CLI, the ledger speaks REST — the same canonical table either way.
		{Day: "2026-09-01", CMDBPath: "vpn/ipsec/phase1-interface", N: 5},
	}
	daily, tables, totals := foldDriftAnalytics(from, 1, ledger, findings)

	if len(tables) != 1 {
		t.Fatalf("got %d tables, want the two notations merged into one: %+v", len(tables), tables)
	}
	got := tables[0]
	if got.Table != "vpn/ipsec/phase1-interface" || got.Label != "vpn ipsec phase1-interface" ||
		got.Console != 2 || got.Outside != 5 {
		t.Fatalf("table row = %+v", got)
	}
	if totals.Outside != 5 || daily[0].Outside != 5 {
		t.Fatalf("outside totals=%d day=%d, want 5", totals.Outside, daily[0].Outside)
	}
}

func TestFoldDriftAnalytics_OutOfWindowDayCountsInTotalsNotInColumns(t *testing.T) {
	// A clock skew between the app and the database can hand back a day the window did not draw.
	// It still happened, so the totals keep it; there is just no column to put it in.
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	findings := []findingBucket{{Day: "2026-09-09", CMDBPath: "firewall/address", N: 1}}
	daily, _, totals := foldDriftAnalytics(from, 2, nil, findings)
	if totals.Outside != 1 {
		t.Fatalf("outside = %d, want 1", totals.Outside)
	}
	for _, d := range daily {
		if d.Outside != 0 {
			t.Fatalf("day %s got the out-of-window finding", d.Date)
		}
	}
}

func TestRankDriftTables_CapsAndFoldsTheTailIntoOther(t *testing.T) {
	tables := map[string]*DriftAnalyticsTable{}
	for i := 0; i < DriftAnalyticsMaxTables+3; i++ {
		key := fmt.Sprintf("t/%02d", i)
		// t/00 is the biggest, t/10 the smallest.
		tables[key] = &DriftAnalyticsTable{Table: key, Label: key, Console: int64(100 - i)}
	}
	got := rankDriftTables(tables)

	if len(got) != DriftAnalyticsMaxTables+1 {
		t.Fatalf("got %d rows, want %d named + other", len(got), DriftAnalyticsMaxTables)
	}
	if got[0].Table != "t/00" {
		t.Fatalf("first row %s, want the busiest table first", got[0].Table)
	}
	other := got[len(got)-1]
	// The three smallest: 100-8, 100-9, 100-10.
	if other.Table != DriftAnalyticsOtherTable || other.Console != 92+91+90 {
		t.Fatalf("other = %+v, want the folded tail (273)", other)
	}
}

func TestRankDriftTables_TiesBreakOnNameSoRowsDoNotSwapOnRefresh(t *testing.T) {
	for run := 0; run < 20; run++ {
		got := rankDriftTables(map[string]*DriftAnalyticsTable{
			"b/b": {Table: "b/b", Console: 1},
			"a/a": {Table: "a/a", Console: 1},
			"c/c": {Table: "c/c", Outside: 1},
		})
		if got[0].Table != "a/a" || got[1].Table != "b/b" || got[2].Table != "c/c" {
			t.Fatalf("order %v is not stable", []string{got[0].Table, got[1].Table, got[2].Table})
		}
	}
}

func TestRankDriftTables_EmptyOtherIsNotDrawn(t *testing.T) {
	got := rankDriftTables(map[string]*DriftAnalyticsTable{
		"firewall/policy":        {Table: "firewall/policy", Console: 1},
		DriftAnalyticsOtherTable: {Table: DriftAnalyticsOtherTable},
	})
	if len(got) != 1 {
		t.Fatalf("got %+v, want the empty other bucket dropped", got)
	}
}

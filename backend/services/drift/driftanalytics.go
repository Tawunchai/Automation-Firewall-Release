package drift

import (
	"network_automation/services"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// Change analytics for the Configuration Drift page: both halves of "what changed on this
// firewall", counted side by side.
//
//	console  = Change Ledger rows that reached the device (applied, or applied and later reverted)
//	outside  = drift findings the ledger could NOT account for, dated by the run that found them
//
// The two are deliberately kept as separate series rather than summed. A ledger row is one write;
// a drift finding is one object that differed between two backups. They are both "a change", which
// is what lets them share an axis, but adding them would pretend they are the same unit.
//
// ── Why the aggregation happens in SQL ───────────────────────────────────────
//
// The ledger only grows — every write to every firewall, forever — and the page asks for a 90-day
// window across the fleet. Pulling rows to count them in Go would ship every before/after snapshot
// across the wire to throw them away. Instead each table is read ONCE, already grouped by (day,
// table, status); the result is a few hundred rows at most whatever the ledger's size, and the
// folding below turns them into chart series without another round trip.
//
// ── Whose "day"? ─────────────────────────────────────────────────────────────
//
// The viewer's. Timestamps on the page are rendered in the browser's zone, so a bar labelled
// "Sep 3" must count what the ledger below it lists under Sep 3. The client sends its UTC offset;
// the day boundary is computed from it in SQL with no dependence on the database session's
// TimeZone setting, which the application does not control.

// DriftAnalyticsMaxTables is how many tables the "where changes land" chart names before the rest
// fold into "other". Past about eight rows a horizontal bar chart stops being read.
const DriftAnalyticsMaxTables = 8

// DriftAnalyticsOtherTable is the bucket the long tail folds into.
const DriftAnalyticsOtherTable = "other"

// DriftAnalyticsDay is one column group of the per-day chart.
type DriftAnalyticsDay struct {
	Date    string `json:"date"`    // YYYY-MM-DD in the viewer's zone
	Console int64  `json:"console"` // writes through this console that reached the device
	Failed  int64  `json:"failed"`  // writes the device rejected — shown in the tooltip, not stacked
	Outside int64  `json:"outside"` // objects changed outside the console, by detection date
}

// DriftAnalyticsTable is one row of the per-table chart.
type DriftAnalyticsTable struct {
	Table   string `json:"table"` // canonical CMDB path, "firewall/policy"; "other" for the tail
	Label   string `json:"label"` // as the CLI writes it, "firewall policy"
	Console int64  `json:"console"`
	Outside int64  `json:"outside"`
}

// DriftAnalyticsTotals are the stat tiles above the charts.
type DriftAnalyticsTotals struct {
	Console  int64 `json:"console"`
	Failed   int64 `json:"failed"`
	Reverted int64 `json:"reverted"`
	Outside  int64 `json:"outside"`

	Runs      int64 `json:"runs"`
	DriftRuns int64 `json:"drift_runs"`
}

// DriftAnalytics is the whole response.
type DriftAnalytics struct {
	Days     int                   `json:"days"`
	From     time.Time             `json:"from"`
	DeviceID uint                  `json:"device_id,omitempty"`
	Totals   DriftAnalyticsTotals  `json:"totals"`
	Daily    []DriftAnalyticsDay   `json:"daily"`
	Tables   []DriftAnalyticsTable `json:"tables"`
}

// DriftAnalyticsQuery is what the caller asked for, already validated by the controller.
type DriftAnalyticsQuery struct {
	UserID   uint
	IsAdmin  bool
	DeviceID uint // 0 = every device the caller may see
	Days     int
	// OffsetMinutes is the viewer's UTC offset, EAST positive (Bangkok = +420). Note this is the
	// negation of JavaScript's getTimezoneOffset(); the client converts.
	OffsetMinutes int
	Now           time.Time
}

// ledgerBucket / findingBucket are the grouped rows the two SQL reads return.
type ledgerBucket struct {
	Day      string
	Status   string
	CMDBPath string
	N        int64
}

type findingBucket struct {
	Day      string
	CMDBPath string
	N        int64
}

// driftDayExpr is the SQL for "which of the viewer's days does created_at fall on".
//
// `AT TIME ZONE 'UTC'` turns the timestamptz into a plain UTC timestamp regardless of the session
// zone; adding the viewer's offset and truncating gives their calendar day. The offset is a bound
// parameter, never interpolated.
const driftDayExpr = "to_char((created_at AT TIME ZONE 'UTC') + make_interval(mins => ?), 'YYYY-MM-DD')"

// driftWindowStart is local midnight (days-1) days before now, in the viewer's zone, so a 7-day
// window is today plus the six before it — the same seven columns the chart draws.
func driftWindowStart(now time.Time, days, offsetMinutes int) time.Time {
	zone := time.FixedZone("viewer", offsetMinutes*60)
	local := now.In(zone)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, zone)
	return midnight.AddDate(0, 0, -(days - 1))
}

// BuildDriftAnalytics runs the four grouped reads and folds them.
//
// The device scope is resolved once and applied to every read, rather than once per query: for a
// non-admin each resolution is a grant lookup, and four identical lookups per page load is the kind
// of waste that only shows up once the grant table is large.
func BuildDriftAnalytics(db *gorm.DB, q DriftAnalyticsQuery) (DriftAnalytics, error) {
	from := driftWindowStart(q.Now, q.Days, q.OffsetMinutes)
	out := DriftAnalytics{Days: q.Days, From: from, DeviceID: q.DeviceID}

	scope := services.DeviceScopeFor(db, q.UserID, q.IsAdmin)
	narrow := func(tx *gorm.DB) *gorm.DB {
		tx = services.ApplyDeviceScope(tx, "network_device_id", scope)
		if q.DeviceID > 0 {
			tx = tx.Where("network_device_id = ?", q.DeviceID)
		}
		return tx
	}

	var ledger []ledgerBucket
	if err := narrow(db.Model(&entity.ChangeRecord{})).
		Select(driftDayExpr+" AS day, status, cmdb_path, COUNT(*) AS n", q.OffsetMinutes).
		Where("created_at >= ?", from).
		Group("day, status, cmdb_path").
		Scan(&ledger).Error; err != nil {
		return out, err
	}

	var findings []findingBucket
	if err := narrow(db.Model(&entity.DriftFinding{})).
		Select(driftDayExpr+" AS day, cmdb_path, COUNT(*) AS n", q.OffsetMinutes).
		Where("attributed = ? AND created_at >= ?", false, from).
		Group("day, cmdb_path").
		Scan(&findings).Error; err != nil {
		return out, err
	}

	var runs struct {
		Runs      int64
		DriftRuns int64
	}
	if err := narrow(db.Model(&entity.DriftRun{})).
		Select("COUNT(*) AS runs, COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS drift_runs",
			entity.DriftStatusDrift).
		Where("created_at >= ?", from).
		Scan(&runs).Error; err != nil {
		return out, err
	}

	out.Daily, out.Tables, out.Totals = foldDriftAnalytics(from, q.Days, ledger, findings)
	out.Totals.Runs = runs.Runs
	out.Totals.DriftRuns = runs.DriftRuns
	return out, nil
}

// foldDriftAnalytics turns the grouped rows into chart series. Pure, so the arithmetic is tested
// without a database.
//
// Every day in the window gets a row, zero or not: a gap in a time axis reads as "no data", and a
// quiet day is data.
func foldDriftAnalytics(from time.Time, days int, ledger []ledgerBucket, findings []findingBucket) (
	[]DriftAnalyticsDay, []DriftAnalyticsTable, DriftAnalyticsTotals,
) {
	daily := make([]DriftAnalyticsDay, days)
	index := make(map[string]int, days)
	for i := 0; i < days; i++ {
		d := from.AddDate(0, 0, i).Format("2006-01-02")
		daily[i] = DriftAnalyticsDay{Date: d}
		index[d] = i
	}

	var totals DriftAnalyticsTotals
	tables := map[string]*DriftAnalyticsTable{}
	table := func(raw string) *DriftAnalyticsTable {
		key := canonicalCMDBPath(raw)
		if key == "" {
			key = DriftAnalyticsOtherTable
		}
		t, ok := tables[key]
		if !ok {
			t = &DriftAnalyticsTable{Table: key, Label: strings.ReplaceAll(key, "/", " ")}
			tables[key] = t
		}
		return t
	}

	for _, b := range ledger {
		i, inWindow := index[b.Day]
		switch b.Status {
		case entity.ChangeStatusFailed:
			// A rejected write never changed the device. It is counted so the tile can say so, but
			// it does not belong in either series of "what changed".
			totals.Failed += b.N
			if inWindow {
				daily[i].Failed += b.N
			}
			continue
		case entity.ChangeStatusReverted:
			// Reverted = it DID apply, and was undone later. The undo is its own ledger row.
			totals.Reverted += b.N
		}
		totals.Console += b.N
		if inWindow {
			daily[i].Console += b.N
		}
		table(b.CMDBPath).Console += b.N
	}

	for _, b := range findings {
		totals.Outside += b.N
		if i, ok := index[b.Day]; ok {
			daily[i].Outside += b.N
		}
		table(b.CMDBPath).Outside += b.N
	}

	return daily, rankDriftTables(tables), totals
}

// rankDriftTables orders tables by total change and folds everything past the cap into "other".
//
// Ties break on the name so the order is stable between two loads of the same data — a chart whose
// rows swap places on refresh reads as if something changed.
func rankDriftTables(tables map[string]*DriftAnalyticsTable) []DriftAnalyticsTable {
	list := make([]DriftAnalyticsTable, 0, len(tables))
	var other *DriftAnalyticsTable
	for _, t := range tables {
		if t.Table == DriftAnalyticsOtherTable {
			other = t
			continue
		}
		list = append(list, *t)
	}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i].Console+list[i].Outside, list[j].Console+list[j].Outside
		if a != b {
			return a > b
		}
		return list[i].Table < list[j].Table
	})

	if len(list) > DriftAnalyticsMaxTables {
		if other == nil {
			other = &DriftAnalyticsTable{Table: DriftAnalyticsOtherTable, Label: DriftAnalyticsOtherTable}
		}
		for _, t := range list[DriftAnalyticsMaxTables:] {
			other.Console += t.Console
			other.Outside += t.Outside
		}
		list = list[:DriftAnalyticsMaxTables]
	}
	if other != nil && other.Console+other.Outside > 0 {
		list = append(list, *other)
	}
	return list
}

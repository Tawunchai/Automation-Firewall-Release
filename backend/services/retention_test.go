package services

import (
	"testing"
	"time"
)

// The retention rules, tested as rules.
//
// The delete itself is one line of GORM; what is worth pinning is what each sweep REFUSES to
// delete, because that is the part a later "simplify this to delete anything older than N" would
// quietly remove — and the symptom would be a device whose only stored configuration is gone,
// noticed the day somebody needs it.

var retentionNow = time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

func ago(d time.Duration) time.Time { return retentionNow.Add(-d) }

// backups builds n rows for one device, the newest `spacing` apart starting from `newest` ago.
func backups(deviceID uint, firstID uint, n int, newest, spacing time.Duration) []ConfigBackupRow {
	out := make([]ConfigBackupRow, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, ConfigBackupRow{
			ID:              firstID + uint(i),
			NetworkDeviceID: deviceID,
			CreatedAt:       ago(newest + time.Duration(i)*spacing),
		})
	}
	return out
}

func has(ids []uint, want uint) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func TestConfigBackupsKeepsEverythingInsideTheWindow(t *testing.T) {
	// A year of daily backups, all inside the retention window.
	rows := backups(1, 100, 300, 0, 24*time.Hour)

	if got := configBackupsToPurge(rows, nil, retentionNow); len(got) != 0 {
		t.Fatalf("purged %d rows that are all inside the retention window: %v", len(got), got)
	}
}

func TestConfigBackupsKeepsTheWorkingSetHoweverOld(t *testing.T) {
	// A device backed up daily and then abandoned three years ago: every row is outside the
	// window, so an age-only rule would delete all but the oldest.
	rows := backups(1, 100, 200, 3*365*24*time.Hour, 24*time.Hour)

	purge := configBackupsToPurge(rows, nil, retentionNow)

	// The newest ConfigBackupKeepPerDevice must survive. They are ids 100..100+N-1, since the
	// generator counts backwards in time from the newest.
	for i := 0; i < ConfigBackupKeepPerDevice; i++ {
		if id := uint(100 + i); has(purge, id) {
			t.Errorf("purged id %d, which is inside the newest %d for the device", id, ConfigBackupKeepPerDevice)
		}
	}
	if len(purge) == 0 {
		t.Fatal("purged nothing at all from 200 rows that are three years old")
	}
}

func TestConfigBackupsAlwaysKeepsTheDevicesFirstEver(t *testing.T) {
	// Two backups, both ancient. Without the oldest-survives rule the count floor alone would keep
	// both (2 < 60) — so push the device well past the floor to isolate the rule.
	rows := backups(1, 100, 120, 3*365*24*time.Hour, 24*time.Hour)
	oldest := rows[len(rows)-1].ID

	purge := configBackupsToPurge(rows, nil, retentionNow)

	if has(purge, oldest) {
		t.Errorf("purged id %d — the device's first-ever backup, the only record of how it was "+
			"configured when it came under management", oldest)
	}
}

func TestConfigBackupsKeepsWhatADriftRunPointsAt(t *testing.T) {
	rows := backups(1, 100, 120, 3*365*24*time.Hour, 24*time.Hour)

	// Pick two rows that the rules above would otherwise release.
	from, to := rows[100].ID, rows[99].ID
	referenced := map[uint]bool{from: true, to: true}

	purge := configBackupsToPurge(rows, referenced, retentionNow)

	if has(purge, from) || has(purge, to) {
		t.Errorf("purged a backup a drift run compares (%d → %d) — the run's findings are stated "+
			"as a diff between those two files and would become a claim with no evidence", from, to)
	}
	// And it must still be releasing the others, or this test would pass for the wrong reason.
	if len(purge) == 0 {
		t.Fatal("purged nothing, so the reference rule was not what protected those two rows")
	}
}

func TestConfigBackupsCountTheFloorPerDeviceNotGlobally(t *testing.T) {
	// Two devices, each with a handful of ancient backups. Neither reaches the count floor on its
	// own; a floor applied across the whole table would.
	rows := append(
		backups(1, 100, 5, 3*365*24*time.Hour, 24*time.Hour),
		backups(2, 200, 5, 3*365*24*time.Hour, 24*time.Hour)...,
	)

	if got := configBackupsToPurge(rows, nil, retentionNow); len(got) != 0 {
		t.Fatalf("purged %v — each device has only 5 backups, well inside the per-device floor of %d",
			got, ConfigBackupKeepPerDevice)
	}
}

func TestConfigBackupsOneDeviceDoesNotSpendAnothersBudget(t *testing.T) {
	// Device 1 is backed up constantly; device 2 twice, years ago. Device 2 must keep both.
	rows := append(
		backups(1, 100, 300, 3*365*24*time.Hour, 24*time.Hour),
		backups(2, 900, 2, 3*365*24*time.Hour, 24*time.Hour)...,
	)

	purge := configBackupsToPurge(rows, nil, retentionNow)

	for _, id := range []uint{900, 901} {
		if has(purge, id) {
			t.Errorf("purged id %d — device 2 has two backups in total and must keep both", id)
		}
	}
}

func TestConfigBackupRetentionHorizonsAreOrdered(t *testing.T) {
	// The snapshot bodies must not outlive the rows that carry them, and the ledger row must not
	// outlive the audit history it sits alongside as the same kind of evidence.
	if ChangeSnapshotRetention >= ChangeRecordRetention {
		t.Errorf("snapshots (%v) are kept at least as long as the rows holding them (%v)",
			ChangeSnapshotRetention, ChangeRecordRetention)
	}
	// Audit runs, drift runs and ledger rows are the same kind of thing — a record of what changed
	// on a firewall and when — so they are kept for the same two annual review cycles. Checked
	// separately rather than as one expression: the two are equal today, and `x != a || x != b`
	// over equal constants is a condition go vet is right to call suspect.
	if ChangeRecordRetention != AuditRunRetention {
		t.Errorf("the change ledger (%v) and audit history (%v) should share the evidence horizon",
			ChangeRecordRetention, AuditRunRetention)
	}
}

// The session sweep has no pure rule to test — it is one WHERE clause — but the constant behind it
// carries an assumption that would be dangerous to lose: a row may only be deleted once the token
// inside it can no longer authenticate anything.
func TestSessionRetentionOutlivesTheTokenByAWideMargin(t *testing.T) {
	const tokenLifetime = 24 * time.Hour // services.GenerateJWT

	if UserSessionRetention <= tokenLifetime {
		t.Fatalf("session rows are purged after %v but their tokens live %v — deleting one would "+
			"sign a working user out (middleware.sessionVerdict answers 401 when the row is gone)",
			UserSessionRetention, tokenLifetime)
	}
	if UserSessionRetention < 30*24*time.Hour {
		t.Errorf("session retention of %v leaves almost no margin over a %v token, and nothing about "+
			"a row says when its token expires", UserSessionRetention, tokenLifetime)
	}
}

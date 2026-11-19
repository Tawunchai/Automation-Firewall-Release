package services

import (
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Bounds on the four tables that only ever grew.
//
// Audit runs and drift runs were already bounded (audit_history.go, driftrunner.go). These four
// were not, and between them they hold everything heavy this console writes:
//
//	config_backups   the full FortiOS config text, measured at ~285 KB per row on the lab device.
//	                 A daily backup of ten firewalls is about a gigabyte a year.
//	change_records   two JSON snapshots per device write, before and after.
//	activity_logs    a row per sign-in, sign-out and password change, forever.
//	user_sessions    a row per login, kept long after the 24-hour token in it expired.
//
// The shape follows the two sweeps that already exist: a pure function decides WHICH rows may go,
// so the rule can be tested without a database, and a thin wrapper does the delete. That split
// matters more here than it looks — every one of these tables is something a person may later have
// to answer a question from, and "delete anything older than N" is wrong for three of the four.

// ── audit evidence retention ──────────────────────────────────────────────────
//
// ChangeRecordRetention, AuditRunRetention and DriftRunRetention (below, and in audit_history.go /
// driftrunner.go) are all the same 730 days because they answer the same question — "how long is
// evidence kept" — and the three sweeps should never disagree about it.
//
// This was briefly a configurable setting on /admin/service, on the theory that a compliance
// reviewer needs the number to be one somebody chose rather than a constant. It was removed
// because nothing was ever going to change it: the repo is younger than the window, so the knob
// had not expired a single row and would not until 2028, while being the one control on that page
// whose misuse destroyed evidence permanently. The window itself still applies — only the ability
// to retype it is gone.
//
// The other five tables in this file (backups, snapshots, activity, sessions, metrics) are
// deliberately NOT governed by this — their periods are tied to reasoning specific to each (a
// backup's working-set floor, a session row's margin against its JWT, the metrics table's row-count
// math), so one shared "evidence" number would be wrong for all of them.
const AuditEvidenceRetention = 730 * 24 * time.Hour

// ── config_backups ───────────────────────────────────────────────────────────

// ConfigBackupRetention is how long every backup is kept no matter what.
const ConfigBackupRetention = 365 * 24 * time.Hour

// ConfigBackupKeepPerDevice is the working set: the newest N backups of each device survive
// regardless of age.
//
// Age alone is the wrong rule for this table. A device backed up daily has a year of history and
// loses nothing when the oldest goes; a device backed up twice and then left alone for two years
// would lose BOTH under a pure age rule, and with them the only copy of its configuration this
// console holds. The count floor is what stops that.
const ConfigBackupKeepPerDevice = 60

// ConfigBackupRow is the subset of a backup the retention decision needs. Selecting it explicitly
// keeps the sweep from reading the Content column — the whole point is not to move that text.
type ConfigBackupRow struct {
	ID              uint
	NetworkDeviceID uint
	CreatedAt       time.Time
}

// configBackupsToPurge decides which stored backups may go.
//
// Four guarantees, and none of them is obvious from a SQL statement:
//
//   - nothing inside the retention window is touched;
//   - the newest ConfigBackupKeepPerDevice of each device survive, however old they are;
//   - the OLDEST backup of each device survives, because it is the only record of how the device
//     was configured when it came under management;
//   - a backup referenced by a drift run survives, because Config Drift's findings are stated as a
//     diff between two named backups and deleting either turns the run into a claim with no
//     evidence behind it.
//
// `referenced` is the set of backup ids drift runs point at (from_backup_id and to_backup_id).
func configBackupsToPurge(rows []ConfigBackupRow, referenced map[uint]bool, now time.Time) []uint {
	cutoff := now.Add(-ConfigBackupRetention)

	byDevice := map[uint][]ConfigBackupRow{}
	for _, r := range rows {
		byDevice[r.NetworkDeviceID] = append(byDevice[r.NetworkDeviceID], r)
	}

	var ids []uint
	for _, device := range byDevice {
		// Newest first, so the working set is the head of the slice.
		sortByCreatedDesc(device)

		oldest := device[len(device)-1].ID

		for i, r := range device {
			if i < ConfigBackupKeepPerDevice {
				continue // the working set
			}
			if r.ID == oldest {
				continue // the device's first-ever backup
			}
			if !r.CreatedAt.Before(cutoff) {
				continue // inside the retention window
			}
			if referenced[r.ID] {
				continue // a drift run's evidence
			}
			ids = append(ids, r.ID)
		}
	}
	return ids
}

// sortByCreatedDesc orders newest first. An insertion sort: these slices are one device's backups,
// so tens of rows, and the standard library's sort would need an import and a closure to say the
// same thing.
func sortByCreatedDesc(rows []ConfigBackupRow) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].CreatedAt.After(rows[j-1].CreatedAt); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// PurgeOldConfigBackups deletes stored backups past their retention and returns how many went.
func PurgeOldConfigBackups(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}

	var rows []ConfigBackupRow
	if err := db.Model(&entity.ConfigBackup{}).
		Select("id", "network_device_id", "created_at").
		Find(&rows).Error; err != nil {
		return 0
	}

	referenced := map[uint]bool{}
	var refs []struct{ FromBackupID, ToBackupID uint }
	if err := db.Model(&entity.DriftRun{}).
		Select("from_backup_id", "to_backup_id").Find(&refs).Error; err == nil {
		for _, r := range refs {
			referenced[r.FromBackupID] = true
			referenced[r.ToBackupID] = true
		}
	} else {
		// Could not read what the drift runs depend on. Deleting anything now risks removing a
		// run's evidence, and the table is bounded by the next sweep either way.
		return 0
	}

	ids := configBackupsToPurge(rows, referenced, now)
	if len(ids) == 0 {
		return 0
	}

	// Hard delete: a soft-deleted row still holds the config text this sweep exists to reclaim.
	res := db.Unscoped().Delete(&entity.ConfigBackup{}, ids)
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}

// ── change_records ───────────────────────────────────────────────────────────

// ChangeSnapshotRetention is how long the before/after bodies are kept.
//
// Shorter than the row itself on purpose. The snapshots exist to make a change REVERTIBLE, and
// reverting a six-month-old change by replaying its body is not an operation anyone should be
// offered — the object has moved on, and the replay would undo everything done to it since. The
// audit trail (who, what, when, against which device) is the part with a long life, and it is what
// survives.
const ChangeSnapshotRetention = 180 * 24 * time.Hour

// ChangeRecordRetention is how long the row itself is kept: the same two annual review cycles as
// the audit and drift history, because it is the same kind of evidence.
const ChangeRecordRetention = 730 * 24 * time.Hour

// PurgeOldChangeRecords bounds the change ledger and returns (snapshots blanked, rows deleted).
//
// Two passes, in this order, because the first is the one that reclaims almost all of the space and
// the second is the one that destroys evidence.
func PurgeOldChangeRecords(db *gorm.DB, now time.Time) (int, int) {
	if db == nil {
		return 0, 0
	}

	blanked := blankOldChangeSnapshots(db, now)

	var deleted int
	res := db.Unscoped().
		Where("created_at < ?", now.Add(-AuditEvidenceRetention)).
		Delete(&entity.ChangeRecord{})
	if res.Error == nil {
		deleted = int(res.RowsAffected)
	}
	return blanked, deleted
}

// blankOldChangeSnapshots clears the before/after bodies of changes past ChangeSnapshotRetention.
//
// The row stays. `revertability` already reads the snapshot's PRESENCE rather than its content
// (`has_before`), so a blanked update degrades into "no snapshot of the previous state was
// captured" and the Revert button stops being offered — which is the correct answer for a change
// this old, and is what the caller would have got anyway if the console had not been recording
// bodies back then.
//
// ⚠️ Policy MOVE rows are deliberately excluded. For a move, `has_before` means the OPPOSITE of
// what it means everywhere else: a move recorded the current way has no Before and is revertible by
// moving the policy back, while one carrying a Before predates position tracking and is refused for
// that reason (services.LedgerRevertability). Blanking those would flip a correctly-refused revert
// into an offered one that replays a position nobody stored. They are also the smallest rows in the
// table, so there is nothing to gain by including them.
func blankOldChangeSnapshots(db *gorm.DB, now time.Time) int {
	cutoff := now.Add(-ChangeSnapshotRetention)

	var candidates []entity.ChangeRecord
	if err := db.Model(&entity.ChangeRecord{}).
		Select("id", "resource_type", "path").
		Where("created_at < ?", cutoff).
		Where(`COALESCE("before", '') <> '' OR COALESCE("after", '') <> ''`).
		Find(&candidates).Error; err != nil {
		return 0
	}

	var ids []uint
	for _, r := range candidates {
		if IsPolicyMoveRecord(r) {
			continue
		}
		ids = append(ids, r.ID)
	}
	if len(ids) == 0 {
		return 0
	}

	res := db.Model(&entity.ChangeRecord{}).
		Where("id IN ?", ids).
		Updates(map[string]any{"before": "", "after": ""})
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}

// ── activity_logs ────────────────────────────────────────────────────────────

// ActivityLogRetention is how long the app's own audit trail is kept.
//
// A year rather than the two the device-facing evidence gets: these rows say that somebody signed
// in, not what they changed on a firewall — the ledger above answers that, and answers it for
// longer.
const ActivityLogRetention = 365 * 24 * time.Hour

// PurgeOldActivityLogs deletes app activity past its retention and returns how many went.
func PurgeOldActivityLogs(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}
	res := db.Unscoped().
		Where("created_at < ?", now.Add(-ActivityLogRetention)).
		Delete(&entity.ActivityLog{})
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}

// ── user_sessions ────────────────────────────────────────────────────────────

// UserSessionRetention is how long a session row is kept after it was created.
//
// It is NOT the session's lifetime — the token is, and services.GenerateJWT stamps it with 24
// hours. A row older than that cannot authenticate anything no matter what this sweep does, so
// deleting one can never sign somebody out. Ninety days is chosen for the Sessions page, which
// reads this table as sign-in history: the row is kept for as long as that history is worth
// showing, which is far longer than the row is worth anything to the auth path.
//
// The margin is deliberately enormous — 90 days against a 24-hour token — because the failure mode
// of getting this wrong is signing a working user out, and nothing about the row itself says when
// its token expires.
const UserSessionRetention = 90 * 24 * time.Hour

// PurgeOldUserSessions deletes sign-in records past their retention and returns how many went.
func PurgeOldUserSessions(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}
	cutoff := now.Add(-UserSessionRetention)
	res := db.Unscoped().
		Where("created_at < ?", cutoff).
		// last_seen as well as created_at: a session kept alive by use is current activity whatever
		// its age, and the Sessions page shows it as such. Belt and braces against a future change
		// that lengthens the token.
		Where("last_seen < ?", cutoff).
		Delete(&entity.UserSession{})
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}

// ── metric_samples ───────────────────────────────────────────────────────────
//
// The table that grows fastest by a wide margin, and the only one whose rate depends on the
// CONFIGURATION rather than on how much anybody uses the console: at one sample per five minutes,
// one device contributes 288 rows per subject per day, and a device with fifty policies, five
// tunnels and three SD-WAN members has about sixty subjects. That is ~17,000 rows a day per device,
// or roughly six million a year for ten firewalls.
//
// So it is bounded from the first line of code rather than after someone notices, which is the
// lesson of the four tables above.

// MetricSampleRetention is how long the raw five-minute samples are kept.
//
// Ninety days, not a year. Long enough for "was this tunnel flapping last quarter?" — which is the
// question the table exists to answer and the one Report Studio could never answer before — and
// short enough that the row count stays in the low millions without any downsampling machinery.
//
// Keeping a year at full resolution would mean roll-up tables, a second sweep to build them, and a
// reader that knows which table to consult for which window. That is worth building when somebody
// asks for a year; it is not worth building before the first chart exists.
const MetricSampleRetention = 90 * 24 * time.Hour

// PurgeOldMetricSamples deletes samples past the horizon and returns how many went.
//
// Unscoped is not needed here and is deliberately not used: entity.MetricSample carries no
// DeletedAt, so a plain Delete is a real DELETE. That is the whole reason it has no soft-delete
// field — on the biggest table in the schema, a "delete" that only set a timestamp would reclaim
// nothing at all, which is exactly the trap the change_records rule above had to be written around.
func PurgeOldMetricSamples(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}
	cutoff := now.Add(-MetricSampleRetention)
	res := db.Where("at < ?", cutoff).Delete(&entity.MetricSample{})
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}

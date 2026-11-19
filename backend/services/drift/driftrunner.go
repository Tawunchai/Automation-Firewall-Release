package drift

import (
	"errors"
	"fmt"
	"log"
	"network_automation/services"
	"network_automation/services/platform"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// Running a drift comparison and storing what it found.
//
// The analysis itself is in configdrift.go and touches no database; this file is the part that
// knows where the two backups and the ledger rows live. Split that way because the interesting
// logic — the diff, the attribution, the noise filtering — is then testable without a database,
// which is what configdrift_test.go relies on.

// maxDriftFindingsStored caps how many findings one run writes.
//
// A run that produces thousands of findings is not a security event, it is a firmware upgrade or a
// factory reset. Storing all of them would bloat the table and produce a page nobody can read, so
// the run keeps the first N (drift sorts first, so the unattributed ones survive the cut) and says
// in its summary that it truncated.
const maxDriftFindingsStored = 500

// maxDriftDetailBytes bounds one finding's stored diff. An object with a certificate in it can be
// enormous, and the list page shows a few lines.
const maxDriftDetailBytes = 4000

// AnalyseAndStoreDrift compares a device's newest backup against the previous one and records the
// outcome.
//
// toBackupID is the backup that just landed. Passing 0 means "whatever the newest one is", which
// is what the on-demand path uses.
//
// Returns the stored run. An error is only returned when nothing could be written at all — a
// comparison that fails is itself recorded, with status "error", because a detector that goes
// quiet must not look the same as a firewall that stopped changing.
func AnalyseAndStoreDrift(db *gorm.DB, deviceID uint, toBackupID uint, triggeredBy string) (entity.DriftRun, error) {
	if db == nil {
		return entity.DriftRun{}, errors.New("no database")
	}

	var curr entity.ConfigBackup
	q := db.Where("network_device_id = ?", deviceID)
	if toBackupID > 0 {
		q = q.Where("id = ?", toBackupID)
	}
	if err := q.Order("id DESC").First(&curr).Error; err != nil {
		return entity.DriftRun{}, fmt.Errorf("no backup to analyse: %w", err)
	}

	run := entity.DriftRun{
		NetworkDeviceID: deviceID,
		ToBackupID:      curr.ID,
		TriggeredBy:     triggeredBy,
	}

	var prev entity.ConfigBackup
	err := db.Where("network_device_id = ? AND id < ?", deviceID, curr.ID).
		Order("id DESC").First(&prev).Error

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// The device's first backup. There is nothing to compare against, and calling that "clean"
		// would claim an all-clear the platform has not earned.
		run.Status = entity.DriftStatusBaseline
		run.Summary = "first backup for this device — recorded as the baseline to compare against"
		if e := db.Create(&run).Error; e != nil {
			return entity.DriftRun{}, e
		}
		return run, nil
	case err != nil:
		run.Status = entity.DriftStatusError
		run.ErrorText = platform.TruncateUTF8(err.Error(), 400)
		run.Summary = "could not read the previous backup"
		_ = db.Create(&run).Error
		return run, err
	}

	run.FromBackupID = prev.ID

	// Ledger rows for the window between the two backups. Read before the diff so a database
	// problem is reported as an error run rather than as "everything is drift".
	from, to := LedgerWindowFor(prev.CreatedAt, curr.CreatedAt)
	var records []entity.ChangeRecord
	if err := db.Where("network_device_id = ? AND created_at BETWEEN ? AND ?", deviceID, from, to).
		Find(&records).Error; err != nil {
		run.Status = entity.DriftStatusError
		run.ErrorText = platform.TruncateUTF8("could not read the change ledger: "+err.Error(), 400)
		run.Summary = "the change ledger could not be read, so nothing could be attributed"
		_ = db.Create(&run).Error
		return run, err
	}

	// Both stored configurations are encrypted at rest (entity.ConfigBackup). A side that cannot be
	// decrypted is recorded as an ERROR run, the same as an unreadable ledger above — and for the
	// same reason. Comparing against an empty string would succeed and report the firewall's entire
	// configuration as unattributed drift, which is the loudest possible false alarm.
	prevContent, prevErr := platform.BackupContent(prev)
	currContent, currErr := platform.BackupContent(curr)
	if decErr := errors.Join(prevErr, currErr); decErr != nil {
		run.Status = entity.DriftStatusError
		run.ErrorText = platform.TruncateUTF8("could not read a stored configuration: "+decErr.Error(), 400)
		run.Summary = "a stored configuration could not be decrypted, so nothing could be compared"
		_ = db.Create(&run).Error
		return run, decErr
	}

	return finishDriftRun(db, run, AnalyseConfigDrift(prevContent, currContent, records), deviceID)
}

// finishDriftRun stores a completed comparison: the run row, then its findings.
//
// Split out of AnalyseAndStoreDrift when the two backups became encrypted, so that the "cannot
// read a side" path above has somewhere to return to without duplicating any of this. It takes the
// half-filled run by value and returns the stored one, exactly as its caller does.
func finishDriftRun(db *gorm.DB, run entity.DriftRun, report DriftReport, deviceID uint) (entity.DriftRun, error) {
	run.LinesAdded = report.LinesAdded
	run.LinesRemoved = report.LinesRemoved
	run.TotalChanges = len(report.Changes)
	run.AttributedCount = report.Attributed
	run.DriftCount = report.Drift
	run.Summary = report.Summary()
	if report.HasDrift() {
		run.Status = entity.DriftStatusDrift
	} else {
		run.Status = entity.DriftStatusClean
	}

	truncated := 0
	if len(report.Changes) > maxDriftFindingsStored {
		truncated = len(report.Changes) - maxDriftFindingsStored
		report.Changes = report.Changes[:maxDriftFindingsStored]
		run.Summary = fmt.Sprintf("%s — showing the first %d of %d",
			run.Summary, maxDriftFindingsStored, run.TotalChanges)
	}

	if err := db.Create(&run).Error; err != nil {
		return entity.DriftRun{}, err
	}

	findings := make([]entity.DriftFinding, 0, len(report.Changes))
	for _, c := range report.Changes {
		findings = append(findings, entity.DriftFinding{
			DriftRunID:      run.ID,
			NetworkDeviceID: deviceID,
			Table:           c.Table,
			CMDBPath:        c.CMDBPath,
			ResourceKey:     c.Key,
			Action:          c.Action,
			Detail:          platform.TruncateUTF8(c.Detail(), maxDriftDetailBytes),
			Attributed:      c.Attributed,
			AttributedTo:    platform.TruncateUTF8(c.AttributedTo, 300),
		})
	}
	if len(findings) > 0 {
		if err := db.CreateInBatches(&findings, 100).Error; err != nil {
			log.Printf("[drift] run %d stored but findings failed: %v", run.ID, err)
		}
	}
	if truncated > 0 {
		log.Printf("[drift] device %d: %d findings truncated from run %d", deviceID, truncated, run.ID)
	}

	run.Findings = findings
	return run, nil
}

// ── Automatic trigger ────────────────────────────────────────────────────────

// AnalyseDriftAfterBackup runs the comparison in the background once a backup lands.
//
// Off the request goroutine on purpose: this is called from the worker's result callback, and the
// worker is waiting on that HTTP response. A 33,000-line diff is fast (well under a second on the
// lab unit) but it is not the worker's business to wait for it, and a slow database must not turn
// into a worker timeout that marks a SUCCESSFUL backup as failed.
//
// Errors are logged, not propagated: the backup itself succeeded, and that is what the caller is
// reporting on.
func AnalyseDriftAfterBackup(db *gorm.DB, deviceID, backupID uint) {
	go func() {
		defer func() {
			// A panic in here must not take the process down with it — the analysis walks
			// arbitrary text off a device.
			if r := recover(); r != nil {
				log.Printf("[drift] panic analysing device %d backup %d: %v", deviceID, backupID, r)
			}
		}()
		start := time.Now()
		run, err := AnalyseAndStoreDrift(db, deviceID, backupID, "")
		if err != nil {
			log.Printf("[drift] device %d backup %d: %v", deviceID, backupID, err)
			return
		}
		log.Printf("[drift] device %d backup %d → %s (%s) in %v",
			deviceID, backupID, run.Status, run.Summary, time.Since(start))
	}()
}

// ── Read helpers for the notify sweep and the page ──────────────────────────

// LatestDriftRun returns the most recent run for a device, or false when there is none.
func LatestDriftRun(db *gorm.DB, deviceID uint) (entity.DriftRun, bool) {
	if db == nil {
		return entity.DriftRun{}, false
	}
	var run entity.DriftRun
	if err := db.Where("network_device_id = ?", deviceID).
		Order("id DESC").First(&run).Error; err != nil {
		return entity.DriftRun{}, false
	}
	return run, true
}

// StandingOutsideChangeCount counts the changes made outside this console that are still in place
// on a device, across every run. This is the number the alert fires on and the badge shows.
//
// "Still in place" is the whole definition: a finding leaves this count when the console UNDOES it
// (which also stamps `acknowledged`, see markFindingUndone), and in no other way. There used to be
// a second way — a person could sign a finding off by hand — and that release valve is gone, so a
// change nobody can undo object by object keeps counting until the backup before it is restored.
func StandingOutsideChangeCount(db *gorm.DB, deviceID uint) int64 {
	if db == nil {
		return 0
	}
	var n int64
	db.Model(&entity.DriftFinding{}).
		Where("network_device_id = ? AND attributed = ? AND acknowledged = ?", deviceID, false, false).
		Count(&n)
	return n
}

// ── Batched reads for the overview ───────────────────────────────────────────
//
// The page's device cards used to run LatestDriftRun + UnacknowledgedDriftCount + a backup count
// per device: 3N+1 queries for N firewalls, all on the page's first paint. These answer the same
// three questions for every device in one grouped query each, so the cost stops growing with the
// fleet. The single-device helpers above stay — the notify sweep asks about one device at a time.

// LatestDriftRuns returns the newest run of each listed device, keyed by device id. A device that
// has never been analysed is simply absent.
func LatestDriftRuns(db *gorm.DB, deviceIDs []uint) map[uint]entity.DriftRun {
	out := make(map[uint]entity.DriftRun, len(deviceIDs))
	if db == nil || len(deviceIDs) == 0 {
		return out
	}
	newest := db.Model(&entity.DriftRun{}).
		Select("MAX(id)").
		Where("network_device_id IN ?", deviceIDs).
		Group("network_device_id")
	var runs []entity.DriftRun
	if err := db.Where("id IN (?)", newest).Find(&runs).Error; err != nil {
		log.Printf("[drift] latest runs: %v", err)
		return out
	}
	for _, r := range runs {
		out[r.NetworkDeviceID] = r
	}
	return out
}

// countByDevice runs one `SELECT network_device_id, COUNT(*) … GROUP BY` and returns it as a map.
func countByDevice(q *gorm.DB, deviceIDs []uint) map[uint]int64 {
	out := make(map[uint]int64, len(deviceIDs))
	if len(deviceIDs) == 0 {
		return out
	}
	var rows []struct {
		NetworkDeviceID uint
		N               int64
	}
	if err := q.Select("network_device_id, COUNT(*) AS n").
		Where("network_device_id IN ?", deviceIDs).
		Group("network_device_id").
		Scan(&rows).Error; err != nil {
		log.Printf("[drift] grouped count: %v", err)
		return out
	}
	for _, r := range rows {
		out[r.NetworkDeviceID] = r.N
	}
	return out
}

// OpenDriftCounts is StandingOutsideChangeCount for many devices in one query.
func OpenDriftCounts(db *gorm.DB, deviceIDs []uint) map[uint]int64 {
	if db == nil {
		return map[uint]int64{}
	}
	return countByDevice(db.Model(&entity.DriftFinding{}).
		Where("attributed = ? AND acknowledged = ?", false, false), deviceIDs)
}

// BackupCounts says how many configuration backups each device has — the page only needs "any?",
// but a count costs the same as an existence check once it is grouped.
func BackupCounts(db *gorm.DB, deviceIDs []uint) map[uint]int64 {
	if db == nil {
		return map[uint]int64{}
	}
	return countByDevice(db.Model(&entity.ConfigBackup{}), deviceIDs)
}

// DriftRunRetention matches the audit history: two annual review cycles.
const DriftRunRetention = 730 * 24 * time.Hour

// PurgeOldDriftRuns deletes runs past their retention and returns how many went.
//
// Findings go with them — they are meaningless without the run that produced them, and GORM does
// not cascade, so the child rows are deleted explicitly first.
func PurgeOldDriftRuns(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}
	cutoff := now.Add(-services.AuditEvidenceRetention)

	var ids []uint
	if err := db.Model(&entity.DriftRun{}).Where("created_at < ?", cutoff).Pluck("id", &ids).Error; err != nil || len(ids) == 0 {
		return 0
	}
	db.Unscoped().Where("drift_run_id IN ?", ids).Delete(&entity.DriftFinding{})
	res := db.Unscoped().Delete(&entity.DriftRun{}, ids)
	return int(res.RowsAffected)
}

package drift

import (
	"network_automation/services"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"network_automation/entity"
)

// The drift runner's reads, against a real Postgres.
//
// configdiff_test.go and configdrift_test.go cover the DIFF — what counts as a change. This covers
// the queries that turn stored runs and findings into the numbers the console acts on, and each one
// here is a number somebody makes a decision from:
//
//   - StandingOutsideChangeCount is what the Config Drift badge shows and what the notify rule
//     fires on. Its definition is narrow on purpose — a finding leaves the count when the console
//     UNDOES it and in no other way — so counting an attributed or acknowledged finding would raise
//     an alarm about a change that is already accounted for.
//   - LatestDriftRuns / OpenDriftCounts / BackupCounts replaced 3N+1 queries with one grouped query
//     each. A GROUP BY that silently returns the wrong row per device is invisible in review and
//     wrong on every card of the overview, so the per-device attribution is what is asserted.
//   - PurgeOldDriftRuns must take the child findings with it: GORM does not cascade, and orphaned
//     findings keep being counted by the query above forever.
//
// Skipped unless DRIFT_DB_TEST_DSN names a database it may freely write to and empty. Point it at a
// throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name drift-pg postgres:16-alpine
//	DRIFT_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run Drift -v

func driftTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("DRIFT_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("DRIFT_DB_TEST_DSN not set — see the note at the top of driftrunner_db_test.go")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.NetworkDevice{},
		&entity.ConfigBackup{}, &entity.DriftRun{}, &entity.DriftFinding{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, m := range []any{
		&entity.DriftFinding{}, &entity.DriftRun{}, &entity.ConfigBackup{}, &entity.NetworkDevice{},
	} {
		if err := db.Unscoped().Where("1 = 1").Delete(m).Error; err != nil {
			t.Fatalf("clear: %v", err)
		}
	}
	return db
}

func driftDevice(t *testing.T, db *gorm.DB, name string) entity.NetworkDevice {
	t.Helper()
	d := entity.NetworkDevice{Name: name, MgmtIP: "10.10.20.90", Port: 22, Status: "active"}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	return d
}

func driftRun(t *testing.T, db *gorm.DB, deviceID uint, status string, at time.Time) entity.DriftRun {
	t.Helper()
	r := entity.DriftRun{NetworkDeviceID: deviceID, Status: status}
	if err := db.Create(&r).Error; err != nil {
		t.Fatalf("create run: %v", err)
	}
	if !at.IsZero() {
		if err := db.Model(&entity.DriftRun{}).Where("id = ?", r.ID).
			Update("created_at", at).Error; err != nil {
			t.Fatalf("backdate run: %v", err)
		}
	}
	return r
}

func driftFinding(t *testing.T, db *gorm.DB, runID, deviceID uint, attributed, acked bool) {
	t.Helper()
	f := entity.DriftFinding{
		DriftRunID: runID, NetworkDeviceID: deviceID,
		Attributed: attributed, Acknowledged: acked,
	}
	if err := db.Create(&f).Error; err != nil {
		t.Fatalf("create finding: %v", err)
	}
}

// ─── the number the badge and the alert both read ────────────────────────────

// Only a finding that is neither attributed to a console change nor undone counts. The other three
// combinations each mean "accounted for", and counting any of them is the console raising an alarm
// about a change it made itself.
func TestStandingOutsideChangeCount_CountsOnlyWhatIsStillUnexplained(t *testing.T) {
	db := driftTestDB(t)
	dev := driftDevice(t, db, "lab-80e")
	run := driftRun(t, db, dev.ID, "completed", time.Time{})

	driftFinding(t, db, run.ID, dev.ID, false, false) // outside change, still in place — counts
	driftFinding(t, db, run.ID, dev.ID, false, false) // a second one
	driftFinding(t, db, run.ID, dev.ID, true, false)  // the console did it — explained
	driftFinding(t, db, run.ID, dev.ID, false, true)  // undone by the console
	driftFinding(t, db, run.ID, dev.ID, true, true)   // both

	if got := StandingOutsideChangeCount(db, dev.ID); got != 2 {
		t.Errorf("standing outside changes = %d, want 2", got)
	}
}

// A finding belongs to the device it was found on. If the query did not filter by device, one noisy
// firewall would raise the badge on every other one.
func TestStandingOutsideChangeCount_IsPerDevice(t *testing.T) {
	db := driftTestDB(t)
	a := driftDevice(t, db, "fw-a")
	b := driftDevice(t, db, "fw-b")
	ra := driftRun(t, db, a.ID, "completed", time.Time{})
	rb := driftRun(t, db, b.ID, "completed", time.Time{})

	driftFinding(t, db, ra.ID, a.ID, false, false)
	driftFinding(t, db, ra.ID, a.ID, false, false)
	driftFinding(t, db, ra.ID, a.ID, false, false)
	driftFinding(t, db, rb.ID, b.ID, false, false)

	if got := StandingOutsideChangeCount(db, a.ID); got != 3 {
		t.Errorf("device a = %d, want 3", got)
	}
	if got := StandingOutsideChangeCount(db, b.ID); got != 1 {
		t.Errorf("device b = %d, want 1", got)
	}
}

func TestStandingOutsideChangeCount_IsZeroWithNoDatabase(t *testing.T) {
	if got := StandingOutsideChangeCount(nil, 1); got != 0 {
		t.Errorf("nil db returned %d", got)
	}
}

// ─── the latest run ──────────────────────────────────────────────────────────

func TestLatestDriftRun_ReturnsTheNewestAndSaysWhenThereIsNone(t *testing.T) {
	db := driftTestDB(t)
	dev := driftDevice(t, db, "lab-80e")

	if _, ok := LatestDriftRun(db, dev.ID); ok {
		t.Error("a device with no runs reported one")
	}

	driftRun(t, db, dev.ID, "completed", time.Time{})
	newest := driftRun(t, db, dev.ID, "failed", time.Time{})

	run, ok := LatestDriftRun(db, dev.ID)
	if !ok {
		t.Fatal("no run found after creating two")
	}
	if run.ID != newest.ID {
		t.Errorf("got run %d, want the newest (%d)", run.ID, newest.ID)
	}
	if run.Status != "failed" {
		t.Errorf("status = %q, want the newest run's", run.Status)
	}
}

func TestLatestDriftRun_IsSafeWithNoDatabase(t *testing.T) {
	if _, ok := LatestDriftRun(nil, 1); ok {
		t.Error("nil db reported a run")
	}
}

// ─── the batched reads behind the overview ───────────────────────────────────

// One grouped query per question, and the per-device attribution is the whole point: a GROUP BY
// that returns the right COUNT against the wrong device id is wrong on every card and looks fine.
func TestLatestDriftRuns_PicksTheNewestPerDevice(t *testing.T) {
	db := driftTestDB(t)
	a := driftDevice(t, db, "fw-a")
	b := driftDevice(t, db, "fw-b")
	c := driftDevice(t, db, "fw-c") // never analysed

	driftRun(t, db, a.ID, "old-a", time.Time{})
	newestA := driftRun(t, db, a.ID, "new-a", time.Time{})
	newestB := driftRun(t, db, b.ID, "only-b", time.Time{})

	got := LatestDriftRuns(db, []uint{a.ID, b.ID, c.ID})
	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2 (the unanalysed device must be absent)", len(got))
	}
	if got[a.ID].ID != newestA.ID || got[a.ID].Status != "new-a" {
		t.Errorf("device a got run %d (%q), want %d", got[a.ID].ID, got[a.ID].Status, newestA.ID)
	}
	if got[b.ID].ID != newestB.ID {
		t.Errorf("device b got run %d, want %d", got[b.ID].ID, newestB.ID)
	}
	if _, present := got[c.ID]; present {
		t.Error("a device that has never been analysed appeared in the map")
	}
}

func TestOpenDriftCounts_MatchesTheSingleDeviceCountPerDevice(t *testing.T) {
	db := driftTestDB(t)
	a := driftDevice(t, db, "fw-a")
	b := driftDevice(t, db, "fw-b")
	ra := driftRun(t, db, a.ID, "completed", time.Time{})
	rb := driftRun(t, db, b.ID, "completed", time.Time{})

	driftFinding(t, db, ra.ID, a.ID, false, false)
	driftFinding(t, db, ra.ID, a.ID, false, false)
	driftFinding(t, db, ra.ID, a.ID, true, false) // explained — must not count
	driftFinding(t, db, rb.ID, b.ID, false, false)

	counts := OpenDriftCounts(db, []uint{a.ID, b.ID})
	for _, dev := range []entity.NetworkDevice{a, b} {
		want := StandingOutsideChangeCount(db, dev.ID)
		if counts[dev.ID] != want {
			t.Errorf("%s: batched %d, single %d — the two disagree", dev.Name, counts[dev.ID], want)
		}
	}
	if counts[a.ID] != 2 {
		t.Errorf("device a = %d, want 2", counts[a.ID])
	}
}

func TestBackupCounts_CountsPerDeviceAndOmitsDevicesWithNone(t *testing.T) {
	db := driftTestDB(t)
	a := driftDevice(t, db, "fw-a")
	b := driftDevice(t, db, "fw-b")

	for i := 0; i < 3; i++ {
		if err := db.Create(&entity.ConfigBackup{NetworkDeviceID: a.ID}).Error; err != nil {
			t.Fatalf("create backup: %v", err)
		}
	}

	counts := BackupCounts(db, []uint{a.ID, b.ID})
	if counts[a.ID] != 3 {
		t.Errorf("device a = %d, want 3", counts[a.ID])
	}
	if n, present := counts[b.ID]; present && n != 0 {
		t.Errorf("device b has no backups but counted %d", n)
	}
}

// An empty id list must not become "WHERE id IN ()" — which Postgres rejects — nor a query over
// every device in the table.
func TestBatchedDriftReads_AreSafeOnEmptyInput(t *testing.T) {
	db := driftTestDB(t)
	if got := LatestDriftRuns(db, nil); len(got) != 0 {
		t.Errorf("LatestDriftRuns(nil ids) returned %d entries", len(got))
	}
	if got := OpenDriftCounts(db, nil); len(got) != 0 {
		t.Errorf("OpenDriftCounts(nil ids) returned %d entries", len(got))
	}
	if got := BackupCounts(db, nil); len(got) != 0 {
		t.Errorf("BackupCounts(nil ids) returned %d entries", len(got))
	}
	if got := LatestDriftRuns(nil, []uint{1}); len(got) != 0 {
		t.Errorf("LatestDriftRuns(nil db) returned %d entries", len(got))
	}
	if got := OpenDriftCounts(nil, []uint{1}); len(got) != 0 {
		t.Errorf("OpenDriftCounts(nil db) returned %d entries", len(got))
	}
	if got := BackupCounts(nil, []uint{1}); len(got) != 0 {
		t.Errorf("BackupCounts(nil db) returned %d entries", len(got))
	}
}

// ─── retention ───────────────────────────────────────────────────────────────

// The findings must go with their run. GORM does not cascade, and a finding whose run is gone is
// still counted by StandingOutsideChangeCount — so an incomplete purge does not just leak rows, it
// leaves a badge nobody can ever clear.
func TestPurgeOldDriftRuns_TakesTheFindingsWithTheRun(t *testing.T) {
	db := driftTestDB(t)
	dev := driftDevice(t, db, "lab-80e")
	now := time.Now()

	old := driftRun(t, db, dev.ID, "completed", now.Add(-services.AuditEvidenceRetention-48*time.Hour))
	driftFinding(t, db, old.ID, dev.ID, false, false)
	driftFinding(t, db, old.ID, dev.ID, false, false)

	fresh := driftRun(t, db, dev.ID, "completed", now.Add(-24*time.Hour))
	driftFinding(t, db, fresh.ID, dev.ID, false, false)

	if got := PurgeOldDriftRuns(db, now); got != 1 {
		t.Errorf("purged %d run(s), want 1", got)
	}

	var runs int64
	db.Model(&entity.DriftRun{}).Count(&runs)
	if runs != 1 {
		t.Errorf("%d run(s) left, want the one inside retention", runs)
	}
	var orphans int64
	db.Model(&entity.DriftFinding{}).Where("drift_run_id = ?", old.ID).Count(&orphans)
	if orphans != 0 {
		t.Errorf("%d finding(s) outlived their purged run — the badge can never be cleared", orphans)
	}
	if got := StandingOutsideChangeCount(db, dev.ID); got != 1 {
		t.Errorf("standing count after the purge = %d, want 1 (the surviving run's finding)", got)
	}
}

func TestPurgeOldDriftRuns_DoesNothingWhenEverythingIsFresh(t *testing.T) {
	db := driftTestDB(t)
	dev := driftDevice(t, db, "lab-80e")
	driftRun(t, db, dev.ID, "completed", time.Now().Add(-time.Hour))

	if got := PurgeOldDriftRuns(db, time.Now()); got != 0 {
		t.Errorf("purged %d run(s) from an empty-of-old-rows table", got)
	}
	if got := PurgeOldDriftRuns(nil, time.Now()); got != 0 {
		t.Errorf("nil db purged %d", got)
	}
}

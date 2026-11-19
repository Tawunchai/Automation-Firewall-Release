package scheduler

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"network_automation/config"
	"network_automation/entity"
)

// The scheduler's two database sweeps, against a real Postgres.
//
// Everything else in this package is proved without one (guard_cover_test.go, scheduler_test.go):
// the timer, the panic containment, the nil-database guards. These two are the ones that cannot
// be — they are SQL, and what they are worth is in which rows they touch and which they leave
// alone.
//
// Skipped unless SCHEDULER_DB_TEST_DSN names a database it may freely write to and empty. A
// throwaway container, never the project's own database:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name sched-pg postgres:16-alpine
//	SCHEDULER_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./scheduler/
//
// Stop that container before running `go test ./...` — with Docker up as well this machine runs
// out of paging file.

// sameInstant compares two timestamps with a microsecond of slack. Postgres stores timestamps to
// microseconds and Go keeps nanoseconds, so a value that made the round trip unchanged still fails
// a plain Equal — on Windows only sometimes, which is the worst kind of flake.
func sameInstant(a *time.Time, b time.Time) bool {
	if a == nil {
		return false
	}
	d := a.Sub(b)
	return d > -time.Millisecond && d < time.Millisecond
}

func schedulerTestDB(t *testing.T) {
	t.Helper()

	dsn := os.Getenv("SCHEDULER_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("SCHEDULER_DB_TEST_DSN not set — see the note at the top of scheduler_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}
	if err := db.AutoMigrate(&entity.NetworkDevice{}, &entity.AutomationJob{}); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	for _, table := range []string{"automation_jobs", "network_devices"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}
}

// ── markStaleJobs ───────────────────────────────────────────────────────────

// A job stuck in QUEUED is not a cosmetic problem: EnqueueDeviceBackup refuses to create a second
// backup job while one is active, so until the stale row is failed the user cannot press Backup
// again at all. That is the whole reason this sweep exists.
func TestMarkStaleJobsFreesTheDeviceAndLeavesTheFreshOnesAlone(t *testing.T) {
	schedulerTestDB(t)
	db := config.DB()

	// automation_jobs carries a foreign key to network_devices, so the jobs these rows describe
	// have to belong to a device that exists.
	device := entity.NetworkDevice{
		Name: "stale-jobs", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.1", APIPort: 443, Status: "active",
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatalf("seed device: %v", err)
	}

	old := time.Now().Add(-staleJobTimeout - time.Minute)
	type seed struct {
		status    string
		createdAt time.Time
		wantFixed bool
	}
	seeds := map[string]seed{
		"queued past the timeout":  {"QUEUED", old, true},
		"running past the timeout": {"RUNNING", old, true},
		"queued just now":          {"QUEUED", time.Now(), false},
		// A finished job is history. Rewriting one would turn a successful backup into a failure
		// in the ledger the user reads.
		"already succeeded, but old": {"SUCCESS", old, false},
		"already failed, and old":    {"FAILED", old, false},
	}

	ids := map[string]uint{}
	for name, s := range seeds {
		job := entity.AutomationJob{Type: "backup", Status: s.status, NetworkDeviceID: device.ID, TriggeredBy: "test"}
		if err := db.Create(&job).Error; err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
		// created_at is set by GORM, so it is forced afterwards rather than in the literal.
		if err := db.Model(&entity.AutomationJob{}).Where("id = ?", job.ID).
			UpdateColumn("created_at", s.createdAt).Error; err != nil {
			t.Fatalf("age %s: %v", name, err)
		}
		ids[name] = job.ID
	}

	markStaleJobs()

	for name, s := range seeds {
		var got entity.AutomationJob
		if err := db.First(&got, ids[name]).Error; err != nil {
			t.Fatalf("read back %s: %v", name, err)
		}
		if !s.wantFixed {
			if got.Status != s.status {
				t.Errorf("%s: status %q became %q — the sweep reached a row it should not have",
					name, s.status, got.Status)
			}
			continue
		}
		if got.Status != "FAILED" {
			t.Errorf("%s: status = %q, want FAILED — the device stays blocked", name, got.Status)
		}
		if got.FinishedAt == nil {
			t.Errorf("%s: no finished_at, so the row still reads as in flight", name)
		}
		// The sentence quotes the constant. It used to say "10 นาที" while the threshold was five,
		// which is exactly the drift this assertion exists to catch.
		if !strings.Contains(got.Result, staleJobTimeout.String()) {
			t.Errorf("%s: result %q does not quote the real timeout %v", name, got.Result, staleJobTimeout)
		}
	}
}

// ── runDue ──────────────────────────────────────────────────────────────────

// runDue picks devices by three conditions at once, and every one of them has been a bug in some
// scheduler somewhere: enabled, active, and actually due.
func TestRunDueOnlyTouchesDevicesThatAreEnabledActiveAndDue(t *testing.T) {
	schedulerTestDB(t)
	db := config.DB()

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	type seed struct {
		name        string
		enabled     bool
		status      string
		next        *time.Time
		wantTouched bool
	}
	seeds := []seed{
		{"due", true, "active", &past, true},
		{"not due yet", true, "active", &future, false},
		{"auto backup switched off", false, "active", &past, false},
		{"device is not active", true, "inactive", &past, false},
		// NULL means "never scheduled" — it must not read as "due since the beginning of time".
		{"never scheduled", true, "active", nil, false},
	}

	ids := map[string]uint{}
	for _, s := range seeds {
		d := entity.NetworkDevice{
			Name: s.name, Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.1", APIPort: 443, Status: s.status,
			BackupEnabled: s.enabled, BackupCron: "0 2 * * *", NextBackupAt: s.next,
		}
		if err := db.Create(&d).Error; err != nil {
			t.Fatalf("seed %s: %v", s.name, err)
		}
		ids[s.name] = d.ID
	}

	// Every enqueue fails here — there is no Redis and no credential — which is the point: the
	// sweep must still advance next_backup_at, or the same device is retried every minute until
	// somebody notices.
	runDue(context.Background(), time.Now())

	for _, s := range seeds {
		var got entity.NetworkDevice
		if err := db.First(&got, ids[s.name]).Error; err != nil {
			t.Fatalf("read back %s: %v", s.name, err)
		}
		switch {
		case s.wantTouched:
			if got.NextBackupAt == nil || !got.NextBackupAt.After(time.Now()) {
				t.Errorf("%s: next_backup_at = %v — a device that failed to enqueue would be "+
					"retried in the same minute, forever", s.name, got.NextBackupAt)
			}
		case s.next == nil:
			if got.NextBackupAt != nil {
				t.Errorf("%s: next_backup_at was set to %v by a sweep that should not have seen it",
					s.name, got.NextBackupAt)
			}
		default:
			if !sameInstant(got.NextBackupAt, *s.next) {
				t.Errorf("%s: next_backup_at moved to %v — the sweep reached a device it should "+
					"not have", s.name, got.NextBackupAt)
			}
		}
	}
}

// A cron expression the parser cannot read would otherwise be retried every single minute for
// ever, so the sweep switches that device's automatic backup off and says so.
func TestRunDueDisablesADeviceWhoseCronCannotBeParsed(t *testing.T) {
	schedulerTestDB(t)
	db := config.DB()

	past := time.Now().Add(-time.Hour)
	d := entity.NetworkDevice{
		Name: "broken-cron", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.1", APIPort: 443, Status: "active",
		BackupEnabled: true, BackupCron: "every other tuesday", NextBackupAt: &past,
	}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	runDue(context.Background(), time.Now())

	var got entity.NetworkDevice
	if err := db.First(&got, d.ID).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got.BackupEnabled {
		t.Error("a device with an unparseable cron is still enabled — the sweep will try it again " +
			"in sixty seconds, and every sixty seconds after that")
	}
	if !sameInstant(got.NextBackupAt, past) {
		t.Errorf("next_backup_at = %v, want it left alone — there is no next run to compute",
			got.NextBackupAt)
	}
}

// Shutting down mid-sweep stops before starting ANOTHER device, rather than halfway through one.
// A device not reached is still due on the next boot, because its next_backup_at was not advanced.
func TestRunDueStopsOnShutdownAndLeavesTheRestStillDue(t *testing.T) {
	schedulerTestDB(t)
	db := config.DB()

	past := time.Now().Add(-time.Hour)
	for _, name := range []string{"a", "b", "c"} {
		d := entity.NetworkDevice{
			Name: name, Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.1", APIPort: 443, Status: "active",
			BackupEnabled: true, BackupCron: "0 2 * * *", NextBackupAt: &past,
		}
		if err := db.Create(&d).Error; err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runDue(ctx, time.Now())

	var devices []entity.NetworkDevice
	if err := db.Find(&devices).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	for _, d := range devices {
		if !sameInstant(d.NextBackupAt, past) {
			t.Errorf("%s: next_backup_at = %v — a device skipped by a shutdown must stay due",
				d.Name, d.NextBackupAt)
		}
	}
}

// The hourly retention sweep runs four purges in a row. On a database with nothing old in it,
// every one must be a no-op that logs nothing and fails nothing — the sweep shares the tick that
// drives backups, so an error here would cost a backup round.
func TestRetentionSweepIsAQuietNoOpOnAFreshDatabase(t *testing.T) {
	schedulerTestDB(t)
	if err := config.DB().AutoMigrate(
		&entity.ConfigBackup{}, &entity.ChangeRecord{}, &entity.ActivityLog{}, &entity.UserSession{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}

	runRetentionSweep(time.Now()) // must not panic and must not fail the tick
}

package jobs

import (
	"os"
	"testing"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// EnqueueDeviceBackup's two guards, against a real Postgres.
//
// Both are about a row that must NOT be written, which is why they are worth a database: a second
// queued backup for a device that already has one, and a job for a device whose credential cannot
// be resolved at all.
//
// The second one is the expensive mistake. A device with no nominated automation account used to
// get a backup queued every night anyway; the worker picked it up minutes later, failed on the
// unmaintained login left on the device row, and reported "check username/password" — three
// retries against a firewall that locks an admin account after three failures, for a problem no
// amount of checking the firewall would have found.
//
// The paths past those two guards need Redis as well as Postgres and are left to the integration
// run. Skipped unless JOBS_DB_TEST_DSN names a throwaway database:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name jobs-pg postgres:16-alpine
//	JOBS_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./jobs/

const jobsTestCredKey = "9f2c4b1ea77d3568bb0c41d9e5a6f30c9f2c4b1ea77d3568bb0c41d9e5a6f30c"

func jobsTestDB(t *testing.T) {
	t.Helper()

	dsn := os.Getenv("JOBS_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("JOBS_DB_TEST_DSN not set — see the note at the top of jobs_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("CRED_ENC_KEY", jobsTestCredKey)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}
	if err := db.AutoMigrate(&entity.NetworkDevice{}, &entity.AutomationJob{}, &entity.DeviceCredential{}); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	for _, table := range []string{"automation_jobs", "device_credentials", "network_devices"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}
}

func jobsTestDevice(t *testing.T, withLogin bool) *entity.NetworkDevice {
	t.Helper()
	d := entity.NetworkDevice{
		Name: "FortiGate-80E-stub", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.1", APIPort: 443, Status: "active",
		BackupEnabled: true, BackupCron: "0 2 * * *",
	}
	if withLogin {
		enc, err := platform.EncryptSecret("not-a-real-password")
		if err != nil {
			t.Fatalf("EncryptSecret: %v", err)
		}
		d.Username, d.PasswordEnc = "admin", enc
	}
	if err := config.DB().Create(&d).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	return &d
}

func jobCount(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := config.DB().Model(&entity.AutomationJob{}).Count(&n).Error; err != nil {
		t.Fatalf("count jobs: %v", err)
	}
	return n
}

// A device with a backup already in flight gets the job it already has, not a second one. Without
// this, a page the user refreshes queues one job per refresh, and the worker runs every one of
// them against the same firewall.
func TestEnqueueDeviceBackupReturnsTheJobAlreadyInFlight(t *testing.T) {
	jobsTestDB(t)
	device := jobsTestDevice(t, true)

	for _, status := range []string{"QUEUED", "RUNNING"} {
		t.Run(status, func(t *testing.T) {
			if err := config.DB().Where("1 = 1").Delete(&entity.AutomationJob{}).Error; err != nil {
				t.Fatalf("clear jobs: %v", err)
			}
			existing := entity.AutomationJob{
				Type: "backup", Status: status, NetworkDeviceID: device.ID, TriggeredBy: "scheduler",
			}
			if err := config.DB().Create(&existing).Error; err != nil {
				t.Fatalf("seed job: %v", err)
			}

			job, active, err := EnqueueDeviceBackup(device, "user@test.invalid")
			if err != nil {
				t.Fatalf("refused outright: %v", err)
			}
			if !active {
				t.Fatal("a device with a backup already in flight was not reported as busy")
			}
			if job == nil || job.ID != existing.ID {
				t.Fatalf("got job %+v, want the one already in flight (id %d)", job, existing.ID)
			}
			if n := jobCount(t); n != 1 {
				t.Fatalf("%d job rows, want the single existing one — a refresh would queue one each time", n)
			}
		})
	}
}

// A finished backup is not in flight, so the next request is a real one — and gets past the guard
// to the credential step rather than being handed yesterday's job.
func TestEnqueueDeviceBackupIsNotBlockedByAFinishedJob(t *testing.T) {
	jobsTestDB(t)
	device := jobsTestDevice(t, false) // no login, so it stops at the credential step

	for _, status := range []string{"SUCCESS", "FAILED"} {
		done := entity.AutomationJob{
			Type: "backup", Status: status, NetworkDeviceID: device.ID, TriggeredBy: "scheduler",
		}
		if err := config.DB().Create(&done).Error; err != nil {
			t.Fatalf("seed %s: %v", status, err)
		}
	}

	_, active, err := EnqueueDeviceBackup(device, "user@test.invalid")
	if active {
		t.Fatal("a device whose last backup finished was reported as still busy")
	}
	if err == nil {
		t.Fatal("the request got past the credential step on a device with no account at all")
	}
}

// No nominated account, no job. The refusal has to happen BEFORE the row is written, or the
// scheduler's log is the only place the reason ever appears and the worker burns login attempts
// discovering it.
func TestEnqueueDeviceBackupWritesNoJobForADeviceWithNoAccount(t *testing.T) {
	jobsTestDB(t)
	device := jobsTestDevice(t, false)

	job, active, err := EnqueueDeviceBackup(device, "user@test.invalid")
	if err == nil {
		t.Fatal("a device with no automation account was accepted — the worker would spend three " +
			"login attempts finding that out")
	}
	if active {
		t.Error("reported as already busy, which it is not")
	}
	if job != nil {
		t.Errorf("a job was handed back anyway: %+v", job)
	}
	if n := jobCount(t); n != 0 {
		t.Errorf("%d job row(s) written for a device that cannot authenticate, want none", n)
	}
}

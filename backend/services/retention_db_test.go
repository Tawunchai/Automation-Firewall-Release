package services

import (
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
)

// The retention sweeps against a real Postgres.
//
// retention_test.go covers the RULES, which is where the thinking is. This covers the part a pure
// test cannot: that the SQL GORM builds from them is accepted by the database. Two things here are
// easy to get wrong and impossible to catch without a server —
//
//	· `before` and `after` are ordinary words and ordinary column names, and the snapshot sweep
//	  writes to both by name through a map. If they were not quoted correctly the UPDATE would fail
//	  at runtime, hourly, inside a scheduler goroutine where nobody is looking.
//	· Unscoped() on a soft-deleted model. Without it the "delete" is an UPDATE of deleted_at and the
//	  rows this exists to reclaim stay exactly where they are, while the sweep reports success.
//
// Skipped unless RETENTION_DB_TEST_DSN names a database it may freely write to and empty. Point it
// at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name retention-pg postgres:16-alpine
//	RETENTION_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run TestRetentionAgainstPostgres -v

func retentionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("RETENTION_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("RETENTION_DB_TEST_DSN not set — see the note at the top of retention_db_test.go")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// NetworkDevice, AppUser and Role come along because the five tables under test carry foreign
	// keys into them — AutoMigrate builds the constraints and fails without the targets.
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.NetworkDevice{},
		&entity.ConfigBackup{}, &entity.DriftRun{}, &entity.ChangeRecord{},
		&entity.ActivityLog{}, &entity.UserSession{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Each case starts from empty, so one failing case cannot make the next one pass.
	for _, m := range []any{
		&entity.ConfigBackup{}, &entity.DriftRun{}, &entity.ChangeRecord{},
		&entity.ActivityLog{}, &entity.UserSession{},
	} {
		if err := db.Unscoped().Where("1 = 1").Delete(m).Error; err != nil {
			t.Fatalf("clear: %v", err)
		}
	}

	// The parents every seeded row points at. Without them each insert fails on a foreign key, and
	// a sweep over an empty table happily reports "purged 0" — a green test that proved nothing,
	// which is exactly what the first draft of this file did. Hence the error check here and the
	// seed() helper below.
	//
	// Through GORM rather than raw INSERTs: the column names are the model's business, and hand-
	// written SQL got them wrong (app_roles.role, not role_name) while failing silently.
	role := entity.AppRole{Role: "admin"}
	role.ID = 1
	user := entity.AppUser{Email: "retention@test", Password: "x", FirstName: "R", LastName: "T", AppRoleID: 1}
	user.ID = 1
	device := entity.NetworkDevice{Name: "test-fgt", Vendor: "fortinet", Platform: "fortinet", MgmtIP: "10.0.0.1"}
	device.ID = 1
	for _, parent := range []any{&role, &user, &device} {
		if err := db.Where("id = 1").FirstOrCreate(parent).Error; err != nil {
			t.Fatalf("seed parent: %v", err)
		}
	}
	return db
}

// seed inserts a row and fails the test if the database refuses it. Every seed here goes through
// this: an unchecked Create turns a foreign-key rejection into a sweep over an empty table, which
// passes while testing nothing.
func seed(t *testing.T, db *gorm.DB, row any) {
	t.Helper()
	if err := db.Create(row).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
}

func TestRetentionAgainstPostgres(t *testing.T) {
	db := retentionTestDB(t)
	now := time.Now()
	old := now.Add(-3 * 365 * 24 * time.Hour)

	t.Run("config backups: the working set and the first-ever survive", func(t *testing.T) {
		// 70 ancient backups for one device. The newest 60 and the oldest 1 must remain: 9 go.
		for i := 0; i < 70; i++ {
			row := entity.ConfigBackup{NetworkDeviceID: 1, Content: "config x", Sha256: "s"}
			row.CreatedAt = old.Add(-time.Duration(i) * 24 * time.Hour)
			seed(t, db, &row)
		}

		if got := PurgeOldConfigBackups(db, now); got != 9 {
			t.Errorf("purged %d, want 9 (70 − 60 working set − 1 first-ever)", got)
		}

		// Unscoped, because a soft delete would leave the rows in place and still count them.
		var left int64
		db.Unscoped().Model(&entity.ConfigBackup{}).Count(&left)
		if left != 61 {
			t.Errorf("%d rows left in the table, want 61 — a soft delete reclaims nothing", left)
		}
	})

	t.Run("change ledger: snapshots blanked, audit trail kept", func(t *testing.T) {
		recent := entity.ChangeRecord{
			NetworkDeviceID: 1, Action: entity.ChangeActionUpdate, ResourceType: "address",
			CMDBPath: "firewall/address", ResourceKey: "a", Status: entity.ChangeStatusApplied,
			Before: `{"subnet":"10.0.0.0 255.0.0.0"}`, After: `{"subnet":"10.1.0.0 255.255.0.0"}`,
		}
		recent.CreatedAt = now.Add(-24 * time.Hour)

		stale := recent
		stale.ID = 0
		stale.CreatedAt = now.Add(-200 * 24 * time.Hour)

		move := entity.ChangeRecord{
			NetworkDeviceID: 1, Action: entity.ChangeActionUpdate, ResourceType: "firewall-policy",
			CMDBPath: "firewall/policy", ResourceKey: "3", Status: entity.ChangeStatusApplied,
			Path:   "/policy/device/1/firewall-policies/3/move",
			Before: `{"position":"after","target":2}`,
		}
		move.CreatedAt = now.Add(-200 * 24 * time.Hour)

		for _, r := range []*entity.ChangeRecord{&recent, &stale, &move} {
			seed(t, db, r)
		}

		blanked, deleted := PurgeOldChangeRecords(db, now)
		if blanked != 1 {
			t.Errorf("blanked %d snapshot bodies, want 1 — only the stale non-move row qualifies", blanked)
		}
		if deleted != 0 {
			t.Errorf("deleted %d rows, want 0 — nothing here is past the %v row retention", deleted, ChangeRecordRetention)
		}

		// A FRESH struct per lookup. Reusing one is a GORM trap: the struct keeps the primary key
		// from the previous First, and the next call ANDs it into the query, so the second lookup
		// matches nothing and silently leaves the first row's values in place — which reads exactly
		// like the sweep having blanked a row it never touched.
		reread := func(id uint) entity.ChangeRecord {
			var r entity.ChangeRecord
			if err := db.First(&r, id).Error; err != nil {
				t.Fatalf("re-read %d: %v", id, err)
			}
			return r
		}

		got := reread(stale.ID)
		if got.Before != "" || got.After != "" {
			t.Errorf("stale row still carries a snapshot (before=%q after=%q) — the quoted column "+
				"names did not reach the database", got.Before, got.After)
		}
		if got.ResourceKey == "" || got.Action == "" {
			t.Error("blanking the snapshot destroyed the audit trail; only the bodies should go")
		}

		got = reread(recent.ID)
		if got.Before == "" {
			t.Error("a change from yesterday lost its snapshot — it is still revertible and must keep it")
		}

		// The trap this rule exists for: for a MOVE, a Before means "recorded before positions were
		// kept, refuse the revert". Blanking one flips a correctly-refused undo into an offered one.
		got = reread(move.ID)
		if got.Before == "" {
			t.Error("a policy-move row was blanked — see blankOldChangeSnapshots for why that turns " +
				"a refused revert into an offered one that replays a position nobody stored")
		}
	})

	t.Run("activity logs and sessions go by age", func(t *testing.T) {
		al := entity.ActivityLog{AppUserID: 1, Action: "login"}
		al.CreatedAt = old
		fresh := entity.ActivityLog{AppUserID: 1, Action: "login"}
		fresh.CreatedAt = now
		seed(t, db, &al)
		seed(t, db, &fresh)

		if got := PurgeOldActivityLogs(db, now); got != 1 {
			t.Errorf("purged %d activity rows, want 1", got)
		}

		stale := entity.UserSession{AppUserID: 1, TokenHash: "a", LastSeen: old}
		stale.CreatedAt = old
		// Old row, but still being used: the belt-and-braces clause must keep it.
		revived := entity.UserSession{AppUserID: 1, TokenHash: "b", LastSeen: now}
		revived.CreatedAt = old
		seed(t, db, &stale)
		seed(t, db, &revived)

		if got := PurgeOldUserSessions(db, now); got != 1 {
			t.Errorf("purged %d sessions, want 1 — a row whose last_seen is recent is current activity", got)
		}
	})
}

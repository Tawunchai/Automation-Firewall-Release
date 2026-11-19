package services

import (
	"os"
	"strconv"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
)

// The password policy and the reuse check both read system_configs, so the parts that matter most
// — "the stored row wins over the default" and "a new password is compared against N old ones" —
// cannot be tested without a database. retention_db_test.go established this pattern; this is the
// same thing for the two tables below.
//
// Skipped unless SEED_DB_TEST_DSN names a database it may freely write to and empty. Point it at a
// throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name seedsec-pg postgres:16-alpine
//	SEED_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run TestPassword -v

func policyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("SEED_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("SEED_DB_TEST_DSN not set — see the note at the top of passwordpolicy_db_test.go")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Rows first, tables second. config/seed_db_test.go points at the same database and drops
	// app_users; any password_histories row left pointing at a user it took with it makes the
	// AutoMigrate below fail while it rebuilds the foreign key.
	if db.Migrator().HasTable(&entity.PasswordHistory{}) {
		db.Unscoped().Where("1 = 1").Delete(&entity.PasswordHistory{})
	}
	// AppRole and AppUser come along because password_histories carries a foreign key into
	// app_users — without a real user behind it every insert is rejected and the test would be
	// asserting against an empty table.
	if err := db.AutoMigrate(&entity.AppRole{}, &entity.AppUser{}, &entity.SystemConfig{}, &entity.PasswordHistory{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Only these two are emptied. app_users is left alone deliberately: other rows in this
	// throwaway database point at it, and every case here makes its own user anyway.
	for _, m := range []any{&entity.PasswordHistory{}, &entity.SystemConfig{}} {
		if err := db.Unscoped().Where("1 = 1").Delete(m).Error; err != nil {
			t.Fatalf("clear: %v", err)
		}
	}
	return db
}

// newTestUser inserts a user the history rows can point at, and returns its id.
func newTestUser(t *testing.T, db *gorm.DB) uint {
	t.Helper()
	role := entity.AppRole{Role: "tester"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	u := entity.AppUser{
		Email:    "history-" + strconv.Itoa(int(role.ID)) + "@example.test",
		Password: "irrelevant", FirstName: "History", LastName: "Test", AppRoleID: role.ID,
	}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

// With no rows at all — a fresh install — the defaults apply.
func TestPasswordPolicyDefaultsWithNoStoredRows(t *testing.T) {
	db := policyTestDB(t)

	p := GetPasswordPolicy(db)
	if p.MinLength < 12 || !p.RequireUppercase || !p.RequireNumber || !p.RequireSpecial {
		t.Errorf("fresh install policy = %+v, want length>=12 with all three complexity rules on", p)
	}
	if p.HistoryCount < 2 {
		t.Errorf("fresh install HistoryCount = %d, want more than one", p.HistoryCount)
	}
}

// Raising the defaults must not overrule a deployment that has already chosen. getPolicyCfg reads
// the row first and only falls back to the default when there is no row.
func TestStoredSystemConfigOverridesTheNewDefaults(t *testing.T) {
	db := policyTestDB(t)

	for key, val := range map[string]string{
		"password_min_length":        "8",
		"password_require_uppercase": "false",
		"password_require_number":    "false",
		"password_require_special":   "false",
		"password_history_count":     "1",
	} {
		if err := db.Create(&entity.SystemConfig{Key: key, Value: val}).Error; err != nil {
			t.Fatalf("seed %s: %v", key, err)
		}
	}

	p := GetPasswordPolicy(db)
	if p.MinLength != 8 {
		t.Errorf("MinLength = %d, want the operator's stored 8", p.MinLength)
	}
	if p.RequireUppercase || p.RequireNumber || p.RequireSpecial {
		t.Errorf("policy = %+v, want the operator's stored complexity flags (all off)", p)
	}
	if p.HistoryCount != 1 {
		t.Errorf("HistoryCount = %d, want the operator's stored 1", p.HistoryCount)
	}
}

// The bug: IsPasswordReused compared against exactly ONE previous hash, so alternating between two
// passwords passed forever.
func TestIsPasswordReusedComparesAgainstSeveralOldPasswords(t *testing.T) {
	db := policyTestDB(t)
	userID := newTestUser(t, db)

	hashed := func(pw string) string { return hashAt(t, pw, bcrypt.MinCost) }
	for _, pw := range []string{"old-1", "old-2", "old-3", "old-4"} {
		SavePasswordHistory(db, userID, hashed(pw))
	}

	// The default depth is 5, so all four are still off limits — in particular "old-1", which the
	// one-hash version would have waved through.
	for _, pw := range []string{"old-1", "old-2", "old-3", "old-4"} {
		if !IsPasswordReused(db, userID, pw) {
			t.Errorf("IsPasswordReused(%q) = false, want true — it is within the kept history", pw)
		}
	}
	if IsPasswordReused(db, userID, "never-used-at-all") {
		t.Error("IsPasswordReused rejected a password that was never used")
	}
	if other := newTestUser(t, db); IsPasswordReused(db, other, "old-1") {
		t.Error("IsPasswordReused read another user's history")
	}
}

// Depth follows password_history_count, the same way every other policy value follows its row.
func TestPasswordHistoryDepthIsConfigurable(t *testing.T) {
	db := policyTestDB(t)
	userID := newTestUser(t, db)

	if err := db.Create(&entity.SystemConfig{Key: "password_history_count", Value: "2"}).Error; err != nil {
		t.Fatalf("seed depth: %v", err)
	}
	for _, pw := range []string{"a", "b", "c"} {
		SavePasswordHistory(db, userID, hashAt(t, pw, bcrypt.MinCost))
	}

	if IsPasswordReused(db, userID, "a") {
		t.Error("\"a\" is three changes back and the configured depth is 2 — it should be allowed again")
	}
	for _, pw := range []string{"b", "c"} {
		if !IsPasswordReused(db, userID, pw) {
			t.Errorf("IsPasswordReused(%q) = false, want true at depth 2", pw)
		}
	}
}

// A row written by the old code holds one bare hash; it must keep blocking that password.
func TestLegacySingleHashHistoryStillBlocks(t *testing.T) {
	db := policyTestDB(t)
	userID := newTestUser(t, db)

	legacy := hashAt(t, "written-by-the-old-code", bcrypt.MinCost)
	if err := db.Create(&entity.PasswordHistory{AppUserID: userID, Password: legacy}).Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	if !IsPasswordReused(db, userID, "written-by-the-old-code") {
		t.Fatal("a pre-existing single-hash history row stopped being honoured")
	}

	// And the next change must extend it rather than lose it.
	SavePasswordHistory(db, userID, hashAt(t, "the-new-one", bcrypt.MinCost))
	if !IsPasswordReused(db, userID, "written-by-the-old-code") {
		t.Error("the legacy hash was dropped when a new password was recorded")
	}
	if !IsPasswordReused(db, userID, "the-new-one") {
		t.Error("the new password was not recorded")
	}
}

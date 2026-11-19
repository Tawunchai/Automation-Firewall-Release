package config

import (
	"os"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// SeedDatabase is the one place that decides what a brand-new deployment is born with — which
// login exists, and whether it can send mail as somebody. Both decisions are writes, so they
// cannot be checked without a database. Same pattern and same reasoning as retention_db_test.go.
//
// Skipped unless SEED_DB_TEST_DSN names a database it may freely write to and empty. Point it at a
// throwaway container, never at the console's own — this test DROPS the tables it uses:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name seedsec-pg postgres:16-alpine
//	SEED_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./config/ -run TestSeedDatabase -v

// seedTestDB points the package-level db at a throwaway database holding nothing, so every case
// starts from the "fresh install" the seed is written for.
func seedTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("SEED_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("SEED_DB_TEST_DSN not set — see the note at the top of seed_db_test.go")
	}

	conn, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	models := []any{
		&entity.AppRole{}, &entity.AppUser{}, &entity.SendEmail{}, &entity.CalendarEvent{},
		&entity.SystemConfig{}, &entity.NetworkDevice{}, &entity.UserDeviceAccess{},
	}
	// Dropped rather than emptied: a soft-deleted AppUser row still holds its email, and the seed
	// decides what to do by counting rows.
	if err := conn.Migrator().DropTable(models...); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if err := conn.AutoMigrate(models...); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	previous := db
	db = conn
	t.Cleanup(func() { db = previous })

	// EncryptSecret needs a key; this one is a test fixture and protects nothing.
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	return conn
}

// The seed used to create an outgoing-mail account from a real Gmail app password and a personal
// address, both literals in db.go. With nothing configured there must be no account at all.
func TestSeedDatabaseSkipsSendEmailWithoutEnv(t *testing.T) {
	conn := seedTestDB(t)
	t.Setenv("SEED_SMTP_EMAIL", "")
	t.Setenv("SEED_SMTP_APP_PASSWORD", "")

	SeedDatabase()

	var count int64
	conn.Model(&entity.SendEmail{}).Count(&count)
	if count != 0 {
		var row entity.SendEmail
		conn.First(&row)
		t.Fatalf("seeded %d SendEmail row(s) with no SEED_SMTP_* configured (first address: %q)", count, row.Email)
	}
}

func TestSeedDatabaseSeedsSendEmailFromEnv(t *testing.T) {
	conn := seedTestDB(t)
	const addr = "ops@example.test"
	const appPassword = "test-app-password-not-real"
	t.Setenv("SEED_SMTP_EMAIL", addr)
	t.Setenv("SEED_SMTP_APP_PASSWORD", appPassword)

	SeedDatabase()

	var row entity.SendEmail
	if err := conn.First(&row).Error; err != nil {
		t.Fatalf("no SendEmail row although both variables are set: %v", err)
	}
	if row.Email != addr {
		t.Errorf("seeded address = %q, want the configured one", row.Email)
	}
	if row.PassAppEnc == appPassword {
		t.Fatal("the app password is stored in clear")
	}
	plain, err := platform.DecryptSecret(row.PassAppEnc)
	if err != nil {
		t.Fatalf("stored app password does not decrypt: %v", err)
	}
	if plain != appPassword {
		t.Error("the stored app password is not the configured one")
	}
}

// SEED_ADMIN_PASSWORD must still beat the built-in default, or a deployment that set it would be
// reachable with the password that ships in the source.
func TestSeedDatabaseAdminPasswordComesFromEnv(t *testing.T) {
	conn := seedTestDB(t)
	const adminPassword = "admin-chosen-In-.env-1"
	t.Setenv("SEED_ADMIN_PASSWORD", adminPassword)

	SeedDatabase()

	for _, tc := range []struct{ email, password string }{
		{"admin@got.co.th", adminPassword},
	} {
		var u entity.AppUser
		if err := conn.Where("email = ?", tc.email).First(&u).Error; err != nil {
			t.Fatalf("%s was not seeded: %v", tc.email, err)
		}
		if !platform.CheckPasswordHash(tc.password, u.Password) {
			t.Errorf("%s does not accept the password from the environment", tc.email)
		}
		if platform.CheckPasswordHash(defaultSeedAdminPassword, u.Password) {
			t.Errorf("%s still accepts the built-in default although %s was set", tc.email, "SEED_ADMIN_PASSWORD")
		}
		// /auth/me skips the expiry check entirely while this is nil, so a seeded account could
		// never expire however the policy was set.
		if u.PasswordChangedAt == nil {
			t.Errorf("%s has no PasswordChangedAt — password expiry can never apply to it", tc.email)
		}
	}
}

// The password-policy rows a fresh install is born with have to be the raised ones, since those
// rows — not the Go fallbacks — are what services.GetPasswordPolicy reads from then on.
func TestSeedDatabaseSeedsTheRaisedPolicyDefaults(t *testing.T) {
	conn := seedTestDB(t)

	SeedDatabase()

	p := services.GetPasswordPolicy(conn)
	if p.MinLength < 12 || !p.RequireUppercase || !p.RequireNumber || !p.RequireSpecial {
		t.Errorf("a fresh install's stored policy = %+v, want length>=12 with every complexity rule on", p)
	}
	if p.HistoryCount < 2 {
		t.Errorf("a fresh install's HistoryCount = %d, want more than one", p.HistoryCount)
	}
}

// An operator's stored row is never overwritten by a later boot: the seed creates a row only when
// the key is absent.
func TestSeedDatabaseLeavesStoredPolicyRowsAlone(t *testing.T) {
	conn := seedTestDB(t)
	if err := conn.Create(&entity.SystemConfig{Key: "password_min_length", Value: "8"}).Error; err != nil {
		t.Fatalf("seed operator row: %v", err)
	}

	SeedDatabase()

	if p := services.GetPasswordPolicy(conn); p.MinLength != 8 {
		t.Errorf("MinLength = %d after seeding, want the operator's stored 8", p.MinLength)
	}
}

// Only the administrator is seeded now.
//
// user@got.co.th, a sample "John Doe" with the user role, was deleted from this deployment and the
// seed stopped creating it on 2026-11-18. Accounts are created by an administrator through /users
// and nowhere else, so a spare login on a fresh install is a second way in that nobody asked for.
// The `user` ROLE must survive — accounts are created against it.
func TestSeedDatabaseSeedsOnlyTheAdminAccount(t *testing.T) {
	conn := seedTestDB(t)
	t.Setenv("SEED_ADMIN_PASSWORD", "admin-chosen-In-.env-1")

	SeedDatabase()

	var users []entity.AppUser
	if err := conn.Find(&users).Error; err != nil {
		t.Fatalf("read app_users: %v", err)
	}
	if len(users) != 1 {
		got := make([]string, 0, len(users))
		for _, u := range users {
			got = append(got, u.Email)
		}
		t.Fatalf("seeded %d accounts (%v), want exactly admin@got.co.th", len(users), got)
	}
	if users[0].Email != "admin@got.co.th" {
		t.Errorf("the one seeded account is %q", users[0].Email)
	}

	var userRole entity.AppRole
	if err := conn.Where("role = ?", "user").First(&userRole).Error; err != nil {
		t.Errorf("the `user` role is gone, so an administrator can no longer create a non-admin: %v", err)
	}
}

// With nothing configured, a fresh install comes up with the password that is in the source. This
// is the owner's decision and it is what the boot log shouts about; the test exists so that
// changing the constant and forgetting the documentation is a red test rather than a surprise.
func TestSeedDatabaseFallsBackToTheBuiltInDefault(t *testing.T) {
	conn := seedTestDB(t)
	t.Setenv("SEED_ADMIN_PASSWORD", "")

	SeedDatabase()

	var u entity.AppUser
	if err := conn.Where("email = ?", "admin@got.co.th").First(&u).Error; err != nil {
		t.Fatalf("admin was not seeded: %v", err)
	}
	if !platform.CheckPasswordHash(defaultSeedAdminPassword, u.Password) {
		t.Error("the seeded admin does not accept defaultSeedAdminPassword")
	}
	// Published is one thing; trivially guessable by someone who has never seen the repository is
	// another. These four are what an unattended scanner tries first.
	for _, guess := range []string{"12345678", "", "admin", "password"} {
		if platform.CheckPasswordHash(guess, u.Password) {
			t.Errorf("the default admin password is guessable without the source (%q opened it)", guess)
		}
	}
	if u.PasswordChangedAt == nil {
		t.Error("admin has no PasswordChangedAt — password expiry could never apply to it")
	}
}

// ── The grant migration, with somebody to grant to ───────────────────────────
//
// seedDeviceAccess skips admins on purpose, so on a fresh install — which since bba9c8a seeds
// exactly one account, and that account is the admin — it finds nobody and the whole granting
// block never runs. Every test above therefore exercised only its early exit, and the rule the
// migration exists to enforce went unproved: coverage of config fell from 60.4% to 57.1% at that
// commit and nobody connected the two.
//
// What is proved here is the rule itself — every non-admin gets a row for every device, admins get
// none — because it decides who can reach which firewall.
func TestSeedDeviceAccessGrantsEveryNonAdminEveryDevice(t *testing.T) {
	conn := seedTestDB(t)
	t.Setenv("SEED_ADMIN_PASSWORD", "admin-chosen-In-.env-1")

	SeedDatabase() // roles, the admin account, and the "already migrated" flag

	// Undo the flag the seed just set, so the migration will run again with people present.
	// Unscoped: SystemConfig soft-deletes, and a soft-deleted row still holds the unique key, so
	// the migration's own Create would silently conflict and the flag would never come back.
	if err := conn.Unscoped().Where("key = ?", deviceAccessSeededKey).Delete(&entity.SystemConfig{}).Error; err != nil {
		t.Fatalf("clear the migration flag: %v", err)
	}

	var userRole, adminRole entity.AppRole
	if err := conn.Where("role = ?", "user").First(&userRole).Error; err != nil {
		t.Fatalf("read the user role: %v", err)
	}
	if err := conn.Where("role = ?", "admin").First(&adminRole).Error; err != nil {
		t.Fatalf("read the admin role: %v", err)
	}

	people := []entity.AppUser{
		{Email: "operator@got.co.th", AppRoleID: userRole.ID},
		{Email: "viewer@got.co.th", AppRoleID: userRole.ID},
		{Email: "second-admin@got.co.th", AppRoleID: adminRole.ID},
	}
	if err := conn.Create(&people).Error; err != nil {
		t.Fatalf("create people: %v", err)
	}
	devices := []entity.NetworkDevice{{Name: "fgt-a"}, {Name: "fgt-b"}}
	if err := conn.Create(&devices).Error; err != nil {
		t.Fatalf("create devices: %v", err)
	}
	// Counted, not assumed: SeedDatabase already created the lab FortiGate, so the expected number
	// of grants is (non-admins x EVERY device on the install), not just the two added here.
	var deviceCount int64
	conn.Model(&entity.NetworkDevice{}).Count(&deviceCount)

	seedDeviceAccess()

	var grants []entity.UserDeviceAccess
	if err := conn.Find(&grants).Error; err != nil {
		t.Fatalf("read grants: %v", err)
	}

	// Two non-admins × every device. The two admins (the seeded one and second-admin) get nothing:
	// they bypass the check entirely, so a row for them would be a grant that means nothing.
	want := 2 * int(deviceCount)
	if len(grants) != want {
		t.Fatalf("got %d grant(s), want %d — two non-admins over %d device(s)",
			len(grants), want, deviceCount)
	}
	byUser := map[uint][]uint{}
	for _, g := range grants {
		byUser[g.AppUserID] = append(byUser[g.AppUserID], g.NetworkDeviceID)
	}
	for _, p := range people[:2] {
		if got := len(byUser[p.ID]); got != int(deviceCount) {
			t.Errorf("%s holds %d grant(s), want one per device (%d)", p.Email, got, deviceCount)
		}
	}
	if got := len(byUser[people[2].ID]); got != 0 {
		t.Errorf("the second admin was granted %d device(s); admins bypass the check, so a row "+
			"for them is a grant that means nothing and a misleading count on the Users page", got)
	}

	// Running twice must not double the rows — an interrupted first start has to be able to finish.
	var flag entity.SystemConfig
	if err := conn.Where("key = ?", deviceAccessSeededKey).First(&flag).Error; err != nil {
		t.Errorf("the migration did not record that it ran: %v", err)
	}
	seedDeviceAccess()
	var again int64
	conn.Model(&entity.UserDeviceAccess{}).Count(&again)
	if again != int64(want) {
		t.Errorf("a second run left %d grant(s), want %d", again, want)
	}
}

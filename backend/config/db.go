package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

var db *gorm.DB

func DB() *gorm.DB {
	return db
}

func ConnectDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		if os.Getenv("GIN_MODE") == "release" {
			log.Fatal("[FATAL] DATABASE_URL is not set.")
		}
		dsn = "host=localhost port=5432 user=postgres password=123456 dbname=starter_web sslmode=disable"
		log.Println("[WARN] DATABASE_URL not set — using local dev fallback.")
	}

	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             2 * time.Second,
			LogLevel:                  logger.Silent,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	var database *gorm.DB
	var err error

	for i := 1; i <= 20; i++ {
		database, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger:      newLogger,
			PrepareStmt: true,
		})
		if err == nil {
			sqlDB, err2 := database.DB()
			if err2 == nil {
				sqlDB.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", 10))
				sqlDB.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", 50))
				sqlDB.SetConnMaxLifetime(30 * time.Minute)
				sqlDB.SetConnMaxIdleTime(5 * time.Minute)
				if pingErr := sqlDB.Ping(); pingErr == nil {
					db = database
					fmt.Println("✅ Database connected successfully")
					return
				} else {
					err = pingErr
				}
			} else {
				err = err2
			}
		}
		log.Printf("⏳ DB not ready (attempt %d/20): %v\n", i, err)
		time.Sleep(2 * time.Second)
	}
	log.Fatalf("❌ failed to connect to PostgreSQL after 20 attempts: %v", err)
}

func SetupDatabase() {
	if db == nil {
		log.Fatal("❌ database is nil, call ConnectDB() before SetupDatabase()")
	}

	err := db.AutoMigrate(
		&entity.OTP{},
		&entity.AppRole{},
		&entity.AppUser{},
		&entity.SendEmail{},
		&entity.ActivityLog{},
		&entity.Backup{},
		&entity.CalendarEvent{},
		&entity.UserSession{},
		&entity.SystemConfig{},
		&entity.UserTOTP{},
		&entity.UserBackupCode{},
		&entity.PasswordHistory{},
		&entity.NetworkDevice{},
		&entity.DeviceCredential{},
		&entity.AutomationJob{},
		&entity.ConfigBackup{},
		&entity.ConfigDeploy{},
		&entity.ConfigDeployResult{},
		&entity.ChangeRecord{},
		&entity.ChangeRequest{},
		&entity.DriftRun{},
		&entity.DriftFinding{},
		&entity.MetricSample{},
		&entity.UserDeviceAccess{},
		&entity.NotifyChannel{},
		&entity.NotifyRecipient{},
		&entity.NotifyRule{},
		&entity.NotifyRuleState{},
		&entity.NotifyEvent{},
		&entity.SSHHostKey{},
		&entity.DeviceTLSPin{},
		&entity.AuditRun{},
		&entity.AuditException{},
		&entity.TopologyDevice{},
	)
	if err != nil {
		log.Fatalf("❌ AutoMigrate failed: %v", err)
	}
	fmt.Println("✅ AutoMigrate completed")

	fixAppUserEmailUniqueIndex()
	dropSSHHostKeyHostOnlyIndex()
	createPerformanceIndexes()
}

// fixAppUserEmailUniqueIndex replaces the plain unique index on app_users.email with one scoped
// to live rows only.
//
// Found live: the Recycle Bin's Restore button returned a 500 on every soft-deleted user, 100% of
// the time. entity.AppUser.Email used to carry a plain `uniqueIndex` tag, and GORM's default
// Delete() only sets deleted_at — the row, and the email it holds, stays in the table. Restore's
// INSERT of a new row with that same email then collided with the "deleted" row's still-live index
// entry. The identical collision also silently blocked creating a brand-new account that happened
// to reuse a previously-deleted address, with nothing in the (correctly empty-looking) user list to
// explain why.
//
// Hard-deleting the old row instead of fixing the index was considered and rejected: ActivityLog,
// ChangeRecord and other tables carry a real foreign key to app_users(id) — this file's
// gorm.Config does not disable constraint creation — so removing the row outright would fail on any
// user with history, or, if a cascade were added instead, silently erase the audit trail the Change
// Ledger exists to keep. Scoping the index to `deleted_at IS NULL` leaves that row, and everything
// still pointing at it, exactly where it is; only its email becomes reusable again.
//
// Runs every boot, like createPerformanceIndexes below, and for the same reason: idempotent DDL,
// cheap to re-check, and a failure here should not be fatal — but IS worth a louder log than a
// missing performance index, since this one is a live-reproducible correctness bug, not a slowdown.
func fixAppUserEmailUniqueIndex() {
	// Two statements, two calls: this driver's Exec rejects a single string carrying more than
	// one command ("cannot insert multiple commands into a prepared statement") — found the hard
	// way the first time this ran against the live database.
	if err := db.Exec(`DROP INDEX IF EXISTS idx_app_users_email`).Error; err != nil {
		log.Printf("⚠️  could not drop app_users' old email index — "+
			"Recycle Bin Restore and re-registering a deleted email will keep failing until this runs: %v", err)
		return
	}
	const create = `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
	                   ON app_users (email) WHERE deleted_at IS NULL`
	if err := db.Exec(create).Error; err != nil {
		log.Printf("⚠️  could not scope app_users.email's unique index to live rows — "+
			"Recycle Bin Restore and re-registering a deleted email will keep failing until this runs: %v", err)
		return
	}
	fmt.Println("✅ app_users.email unique index scoped to live rows (deleted_at IS NULL)")
}

// dropSSHHostKeyHostOnlyIndex removes the unique index that used to sit on ssh_host_keys.host
// alone.
//
// SSHHostKey.Host carried a plain `uniqueIndex` when the table was created, so one firewall could
// hold exactly one pinned host key. That turned out to be wrong against the real device: the lab
// FGT80E offers BOTH an RSA and an ED25519 host key, and Go and paramiko negotiate different ones
// (entity.SSHHostKey spells out the measurement). The pin is keyed on (host, key_type) now — but
// AutoMigrate only ADDS the new composite index, and the old single-column one would keep
// rejecting the second row, with the insert failing on a unique violation and the job failing
// with it.
//
// Idempotent, like the function above it: IF EXISTS, every boot. AutoMigrate has already created
// idx_ssh_host_keys_host_type by the time this runs, so nothing is left unprotected in between.
func dropSSHHostKeyHostOnlyIndex() {
	if err := db.Exec(`DROP INDEX IF EXISTS idx_ssh_host_keys_host`).Error; err != nil {
		log.Printf("⚠️  could not drop ssh_host_keys' old host-only unique index — a device with "+
			"more than one host key algorithm will fail to pin the second one: %v", err)
		return
	}
	fmt.Println("✅ ssh_host_keys unique index is (host, key_type)")
}

// performanceIndexes are the composite indexes AutoMigrate cannot express.
//
// GORM builds indexes from struct tags, and CreatedAt lives in the embedded Base / gorm.Model —
// there is nowhere to hang an `index` tag on it, let alone a composite one. So the tables that are
// READ in created_at order were left with a single-column index on the filter column and nothing
// for the sort: Postgres could narrow the rows but then had to sort them on every request. That is
// invisible on a lab database and gets steadily worse in production, which is the worst shape a
// performance problem can have.
//
// Each entry below matches a query that actually exists; the comment names it. They are created
// CONCURRENTLY-free plain indexes with IF NOT EXISTS, so this is idempotent and safe to re-run on
// every boot alongside AutoMigrate.
var performanceIndexes = []struct{ name, ddl string }{
	{
		// activitylog.ListMyActivityLogs: WHERE app_user_id = ? ORDER BY created_at DESC
		// Supersedes the plain app_user_id index for this query — the sort comes free.
		"idx_activity_logs_user_created",
		`CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
		   ON activity_logs (app_user_id, created_at DESC)`,
	},
	{
		// activitylog.ListAllActivityLogs: ORDER BY created_at DESC LIMIT/OFFSET, over live rows
		// only. Partial on deleted_at IS NULL because that is exactly what the query asks for.
		"idx_activity_logs_created",
		`CREATE INDEX IF NOT EXISTS idx_activity_logs_created
		   ON activity_logs (created_at DESC) WHERE deleted_at IS NULL`,
	},
	{
		// Kept after the Session Management page was removed: its leading column still serves
		// otp.revokeAllUserSessions (WHERE app_user_id = ? AND is_revoked = false), which runs on
		// every password reset.
		"idx_user_sessions_user_created",
		`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_created
		   ON user_sessions (app_user_id, created_at DESC)`,
	},
	{
		// automationjob.NetworkOverview counts the last 24h, and scheduler.markStaleJobs sweeps
		// WHERE status IN (...) AND created_at < ?. status leads because it is the selective half.
		"idx_automation_jobs_status_created",
		`CREATE INDEX IF NOT EXISTS idx_automation_jobs_status_created
		   ON automation_jobs (status, created_at)`,
	},
	{
		// automationjob.WorkerResult looks up the previous backup to compare against:
		// WHERE network_device_id = ? ORDER BY id DESC LIMIT 1. Also serves ListDeviceBackups.
		"idx_config_backups_device_id_desc",
		`CREATE INDEX IF NOT EXISTS idx_config_backups_device_id_desc
		   ON config_backups (network_device_id, id DESC)`,
	},
	{
		// changeledger.ListChanges: the ledger timeline is always newest-first, usually scoped to
		// one device. This table only grows, so the sort is the half that would rot first.
		"idx_change_records_device_created",
		`CREATE INDEX IF NOT EXISTS idx_change_records_device_created
		   ON change_records (network_device_id, created_at DESC)`,
	},
	{
		// changeledger.ListChanges with no device filter — the all-devices timeline.
		"idx_change_records_created",
		`CREATE INDEX IF NOT EXISTS idx_change_records_created
		   ON change_records (created_at DESC) WHERE deleted_at IS NULL`,
	},
	{
		// drift.Summary (services.LatestDriftRuns: MAX(id) GROUP BY network_device_id) and the run
		// history filtered to one device, newest first. Both read the newest end of the index.
		"idx_drift_runs_device_id_desc",
		`CREATE INDEX IF NOT EXISTS idx_drift_runs_device_id_desc
		   ON drift_runs (network_device_id, id DESC)`,
	},
	{
		// The standing-outside-change count: the drift page's status strip and the notify sweep's
		// config-drift check on every tick. Partial on exactly the predicate they both use, so the
		// index only holds the changes that are still in place on a firewall.
		"idx_drift_findings_open",
		`CREATE INDEX IF NOT EXISTS idx_drift_findings_open
		   ON drift_findings (network_device_id)
		   WHERE attributed = false AND acknowledged = false AND deleted_at IS NULL`,
	},
	{
		// drift.Analytics: unattributed findings in a date window, grouped by day and table.
		"idx_drift_findings_unattributed_created",
		`CREATE INDEX IF NOT EXISTS idx_drift_findings_unattributed_created
		   ON drift_findings (created_at)
		   WHERE attributed = false AND deleted_at IS NULL`,
	},
}

// createPerformanceIndexes applies performanceIndexes. A failure is logged, not fatal: a missing
// index makes a query slower, never wrong, and refusing to boot over one would take the whole
// application down for a problem nobody would notice otherwise.
func createPerformanceIndexes() {
	created := 0
	for _, idx := range performanceIndexes {
		if err := db.Exec(idx.ddl).Error; err != nil {
			log.Printf("⚠️  index %s could not be created (queries still work, just slower): %v", idx.name, err)
			continue
		}
		created++
	}
	fmt.Printf("✅ Performance indexes verified (%d/%d)\n", created, len(performanceIndexes))
}

func tableHasAnyRows(model interface{}) bool {
	var count int64
	db.Model(model).Count(&count)
	return count > 0
}

// ensureReadonlyRole adds the two Phase A4 roles — "readonly" (reads everything, writes nothing)
// and "operator" (may edit device config like an admin, but cannot manage app-level settings, see
// user management, or approve a Change Request) — on EVERY boot, unlike the admin/user seed above
// which only runs once. AppRole already has rows on every deployment that existed before this
// shipped, so the one-time seed's tableHasAnyRows guard would skip these forever; FirstOrCreate
// makes a later boot a no-op instead of a duplicate.
func ensureReadonlyRole() {
	for _, name := range []string{"readonly", "operator"} {
		role := entity.AppRole{Role: name}
		if err := db.Where("role = ?", name).FirstOrCreate(&role).Error; err != nil {
			log.Printf("⚠️  could not ensure the %s role exists: %v", name, err)
			continue
		}
		fmt.Printf("✅ AppRole has %s\n", name)
	}
}

func SeedDatabase() {
	if db == nil {
		log.Fatal("❌ database is nil")
	}

	// ── 1. AppRole ────────────────────────────────────────────────────────────
	if tableHasAnyRows(&entity.AppRole{}) {
		fmt.Println("⏭️  Skip AppRole: already seeded")
	} else {
		roles := []entity.AppRole{
			{Role: "admin"},
			{Role: "user"},
		}
		if err := db.Create(&roles).Error; err != nil {
			log.Fatalf("❌ seed AppRole: %v", err)
		}
		fmt.Println("✅ Seeded AppRole (admin, user)")
	}
	ensureReadonlyRole()

	// ── 2. AppUser ────────────────────────────────────────────────────────────
	if tableHasAnyRows(&entity.AppUser{}) {
		fmt.Println("⏭️  Skip AppUser: already seeded")
		// Clear old /uploads/profiles/ path references (switched to base64)
		var existingUsers []entity.AppUser
		if err := db.Find(&existingUsers).Error; err == nil {
			for _, u := range existingUsers {
				if strings.HasPrefix(u.Profile, "/uploads/") {
					db.Model(&entity.AppUser{}).Where("id = ?", u.ID).Update("profile", "")
				}
			}
		}
	} else {
		var adminRole entity.AppRole
		if err := db.Where("role = ?", "admin").First(&adminRole).Error; err != nil {
			log.Fatalln("❌ admin role not found")
		}

		// ONE account is seeded, and it is the administrator.
		//
		// There used to be a second, user@got.co.th, a sample "John Doe" with the user role. It
		// was deleted from this deployment and nothing creates accounts except an administrator
		// through /users, so seeding a spare login was handing every fresh install a second way
		// in that nobody asked for. The `user` ROLE is still seeded above — accounts get created
		// against it; it just has no account of its own from the start.
		//
		// The password is the built-in default below unless SEED_ADMIN_PASSWORD says otherwise.
		// That default is PUBLIC by construction — it is in this file, so everyone who can read
		// the repository knows it — and the owner chose it deliberately on 2026-11-18 so that a
		// fresh install has a login that is known rather than one printed once into a container
		// log. Both halves of that bargain matter: the boot log says loudly that the default is
		// in use, and anything reachable by more than its owner must set SEED_ADMIN_PASSWORD
		// before its first boot, because changing it afterwards does nothing (this whole block is
		// skipped once app_users has a row).
		adminPlain, adminFromEnv := seedAccountPassword("SEED_ADMIN_PASSWORD", defaultSeedAdminPassword)
		adminPw, _ := platform.HashPassword(adminPlain)
		// /auth/me expires a password ExpiryDays after PasswordChangedAt and skips the check
		// entirely while it is nil (controller/auth/auth.go), so a seeded account could never
		// expire. Seeding time is the honest basis for it.
		seededAt := time.Now()

		users := []entity.AppUser{
			{
				Email:             "admin@got.co.th",
				Password:          adminPw,
				FirstName:         "Tawunchai",
				LastName:          "Burakhon",
				PhoneNumber:       "0935096372",
				Profile:           "", // profile ใช้ base64 แล้ว ไม่ต้องอ้าง path ไฟล์
				Location:          "Suranaree University of Technology",
				Position:          "System Administrator",
				AppRoleID:         adminRole.ID,
				PasswordChangedAt: &seededAt,
			},
		}
		if err := db.Create(&users).Error; err != nil {
			log.Fatalf("❌ seed AppUser: %v", err)
		}
		fmt.Println("✅ Seeded AppUser (admin)")
		announceSeededLogin("admin@got.co.th", adminPlain, "SEED_ADMIN_PASSWORD", adminFromEnv)
	}

	// ── 3. SendEmail ──────────────────────────────────────────────────────────
	if tableHasAnyRows(&entity.SendEmail{}) {
		fmt.Println("⏭️  Skip SendEmail: already seeded")
	} else if smtpEmail, smtpAppPassword, ok := smtpSeedFromEnv(); !ok {
		// Encryption at rest does nothing for a secret whose plaintext is in the .go file: a real
		// Gmail app password and a personal address were literals right here, and .gitleaks.toml
		// allowlists only *_test.go and .env.example, so nothing ever flagged them. No account is
		// better than a published one — outgoing mail stays off until someone configures it.
		log.Println("⚠️  Skip SendEmail: set SEED_SMTP_EMAIL and SEED_SMTP_APP_PASSWORD to seed the " +
			"outgoing-mail account, or add it from the app once it is running")
	} else {
		var seedUser entity.AppUser
		if err := db.First(&seedUser).Error; err != nil {
			log.Println("⚠️  Skip SendEmail: no AppUser")
		} else if encPassApp, err := platform.EncryptSecret(smtpAppPassword); err != nil {
			log.Printf("⚠️  Skip SendEmail: encrypt failed: %v", err)
		} else {
			db.Create(&entity.SendEmail{
				Email:            smtpEmail,
				PassAppEnc:       encPassApp,
				AppUserID:        seedUser.ID,
				TwoFactorEnabled: false,
			})
			fmt.Println("✅ Seeded SendEmail from SEED_SMTP_EMAIL")
		}
	}

	// ── 4. CalendarEvent ──────────────────────────────────────────────────────
	if tableHasAnyRows(&entity.CalendarEvent{}) {
		fmt.Println("⏭️  Skip CalendarEvent: already seeded")
	} else {
		var adminUser entity.AppUser
		if err := db.First(&adminUser).Error; err != nil {
			log.Println("⚠️  Skip CalendarEvent: no AppUser")
		} else {
			may := func(d, h, m int) time.Time {
				return time.Date(2026, time.May, d, h, m, 0, 0, time.UTC)
			}
			events := []entity.CalendarEvent{
				{Title: "Spruko Meetup", Description: "Monthly team meetup and sync", StartDate: may(2, 9, 0), EndDate: may(2, 11, 0), AllDay: false, Category: "office", Color: "#7C3AED", AppUserID: adminUser.ID},
				{Title: "Festival Day", Description: "Annual festival celebration", StartDate: may(4, 0, 0), EndDate: may(6, 23, 59), AllDay: true, Category: "festival", Color: "#EF4444", AppUserID: adminUser.ID},
				{Title: "Music Festival", Description: "Live music and performances", StartDate: may(4, 10, 0), EndDate: may(7, 18, 0), AllDay: false, Category: "other", Color: "#22C55E", AppUserID: adminUser.ID},
				{Title: "Lifestyle Conference", Description: "Annual lifestyle and wellness conference", StartDate: may(13, 8, 0), EndDate: may(13, 17, 0), AllDay: false, Category: "calendar", Color: "#7C3AED", AppUserID: adminUser.ID},
				{Title: "Team Weekly Brownbag", Description: "Weekly knowledge sharing session", StartDate: may(21, 12, 0), EndDate: may(21, 13, 0), AllDay: false, Category: "office", Color: "#F59E0B", AppUserID: adminUser.ID},
				{Title: "Harcates Birthday", Description: "Birthday party for Harcates", StartDate: may(4, 18, 0), EndDate: may(4, 21, 0), AllDay: false, Category: "birthday", Color: "#06B6D4", AppUserID: adminUser.ID},
				{Title: "My Rest Day", Description: "Personal rest and recharge", StartDate: may(7, 0, 0), EndDate: may(8, 23, 59), AllDay: true, Category: "holiday", Color: "#38BDF8", AppUserID: adminUser.ID},
				{Title: "Design Review", Description: "Q2 product design review session", StartDate: may(17, 14, 0), EndDate: may(17, 16, 0), AllDay: false, Category: "office", Color: "#38BDF8", AppUserID: adminUser.ID},
				{Title: "Memorial Day", Description: "National memorial day holiday", StartDate: may(18, 0, 0), EndDate: may(18, 23, 59), AllDay: true, Category: "holiday", Color: "#EF4444", AppUserID: adminUser.ID},
				{Title: "Attend Lea's Wedding", Description: "Wedding ceremony and reception", StartDate: may(22, 16, 0), EndDate: may(22, 21, 0), AllDay: false, Category: "timeline", Color: "#14B8A6", AppUserID: adminUser.ID},
			}
			if err := db.Create(&events).Error; err != nil {
				log.Fatalf("❌ seed CalendarEvent: %v", err)
			}
			fmt.Println("✅ Seeded CalendarEvent")
		}
	}

	// ── 5. SystemConfig ───────────────────────────────────────────────────────
	var totpCfg entity.SystemConfig
	if db.Where("key = ?", "totp_global_enabled").First(&totpCfg).Error != nil {
		db.Create(&entity.SystemConfig{Key: "totp_global_enabled", Value: "false"})
		fmt.Println("✅ Seeded SystemConfig: totp_global_enabled=false")
	}
	// The password-policy rows come from services.DefaultPasswordPolicyConfig so the seeded values
	// and the fallbacks services.GetPasswordPolicy uses when a row is missing cannot drift apart —
	// they were written out twice, and only the rows below were ever the policy anyone saw.
	//
	// Note every key here is created ONLY when it is absent, so an operator's stored value always
	// wins: raising these defaults changes fresh installs, never an existing database.
	defaults := map[string]string{
		// สวิตช์ใหญ่ของ email OTP — default เปิด เพื่อไม่ให้ระบบที่ใช้งานอยู่เสียพฤติกรรมเดิม
		// ตอน migrate (ปิดตัวนี้ = ปิด login OTP + reset OTP พร้อมกันที่ฝั่ง server)
		"two_step_enabled":  "true",
		"reset_otp_enabled": "true",
		// หมายเหตุ: "signup_otp_enabled" ถูกถอดออกแล้ว — ระบบนี้ไม่มี self-registration
		// บัญชีถูกสร้างโดย admin ผ่าน /users เท่านั้น แถวเก่าใน DB ปล่อยไว้ได้ ไม่มีใครอ่านแล้ว
	}
	for key, val := range services.DefaultPasswordPolicyConfig() {
		defaults[key] = val
	}
	for key, val := range defaults {
		var cfg entity.SystemConfig
		if db.Where("key = ?", key).First(&cfg).Error != nil {
			db.Create(&entity.SystemConfig{Key: key, Value: val})
		}
	}
	fmt.Println("✅ Seeded SystemConfig: password policy")

	// ── 6. NetworkDevice (FortiGate only) ────────────────────────────────────
	//
	// Policy & Objects used to be seeded here too — built-in addresses ("all", "none") and ~45
	// service definitions ("HTTP", "SSH", …) copied into local tables. Nothing ever read them:
	// every Policy & Objects page reads those objects from the FortiGate itself over REST, which
	// is the only source that can be right. The tables, their entities and the seeds are gone.
	seedNetworkDevices()

	// ── 7. Per-user device access (one-time migration) ───────────────────────
	seedDeviceAccess()

	// ── 8. SendEmail.PassApp encryption (one-time migration) ─────────────────
	migrateSendEmailPassAppEncryption()

	fmt.Println("✅ SeedDatabase completed")
}

// sendEmailPassAppEncryptedKey marks the PassApp-encryption backfill as done, so it runs exactly
// once.
const sendEmailPassAppEncryptedKey = "send_email_pass_app_encrypted"

// migrateSendEmailPassAppEncryption encrypts any send_emails.pass_app row left over from before
// this column was encrypted at rest (see controller/otp/send_email.go).
//
// Grandfathered the same way seedDeviceAccess grandfathers device grants: every row that exists
// at the moment this upgrade runs gets migrated once, and the flag below stops it running again.
// A row is skipped, not re-encrypted, if DecryptSecret already reads it — i.e. it was created or
// updated by the new encrypt-on-write path and running this twice (e.g. an interrupted boot) must
// not double-encrypt it.
func migrateSendEmailPassAppEncryption() {
	var flag entity.SystemConfig
	if db.Where("key = ?", sendEmailPassAppEncryptedKey).First(&flag).Error == nil {
		fmt.Println("⏭️  Skip SendEmail.PassApp encryption: already migrated")
		return
	}

	var rows []entity.SendEmail
	if err := db.Find(&rows).Error; err != nil {
		log.Printf("⚠️  SendEmail.PassApp migration: could not read rows: %v", err)
		return
	}

	migrated, failed := 0, 0
	for _, r := range rows {
		if strings.TrimSpace(r.PassAppEnc) == "" {
			continue
		}
		if _, err := platform.DecryptSecret(r.PassAppEnc); err == nil {
			continue // already ciphertext
		}
		enc, err := platform.EncryptSecret(r.PassAppEnc)
		if err != nil {
			log.Printf("⚠️  SendEmail.PassApp migration: id=%d encrypt failed: %v", r.ID, err)
			failed++
			continue
		}
		if err := db.Model(&entity.SendEmail{}).Where("id = ?", r.ID).Update("pass_app", enc).Error; err != nil {
			log.Printf("⚠️  SendEmail.PassApp migration: id=%d write failed: %v", r.ID, err)
			failed++
			continue
		}
		migrated++
	}

	db.Create(&entity.SystemConfig{Key: sendEmailPassAppEncryptedKey, Value: "1"})
	fmt.Printf("✅ SendEmail.PassApp encryption migrated: %d row(s) encrypted, %d failed, %d total\n",
		migrated, failed, len(rows))
}

// deviceAccessSeededKey marks the grandfather migration as done, so it runs exactly once.
const deviceAccessSeededKey = "device_access_seeded"

// seedDeviceAccess grandfathers the device grants in on the upgrade that introduced them.
//
// Before UserDeviceAccess existed, every signed-in user could reach every firewall. The new rule is
// "no grant, no device" (services.UserCanAccessDevice) — correct going forward, but applying it to
// an existing installation would silently lock every non-admin out of every device on the deploy
// that shipped it.
//
// So the upgrade takes the decision ONCE, with a record of it: every non-admin who exists at this
// moment is granted every device that exists at this moment, and the flag below stops it ever
// running again. From then on it is the admin's list to manage — a user created tomorrow starts
// with nothing, which is the behaviour the feature is for.
func seedDeviceAccess() {
	var flag entity.SystemConfig
	if db.Where("key = ?", deviceAccessSeededKey).First(&flag).Error == nil {
		fmt.Println("⏭️  Skip device access: already migrated")
		return
	}

	var adminRole entity.AppRole
	adminRoleID := uint(0)
	if db.Where("role = ?", "admin").First(&adminRole).Error == nil {
		adminRoleID = adminRole.ID
	}

	var users []entity.AppUser
	q := db.Model(&entity.AppUser{})
	if adminRoleID > 0 {
		// Admins are skipped on purpose: they bypass the check entirely, so a row for them would be
		// a grant that means nothing and a count on the Users page that misleads.
		q = q.Where("app_role_id <> ?", adminRoleID)
	}
	if err := q.Find(&users).Error; err != nil {
		log.Printf("⚠️  device access migration: could not read users: %v", err)
		return
	}

	var deviceIDs []uint
	db.Model(&entity.NetworkDevice{}).Pluck("id", &deviceIDs)

	granted := 0
	if len(users) > 0 && len(deviceIDs) > 0 {
		rows := make([]entity.UserDeviceAccess, 0, len(users)*len(deviceIDs))
		for _, u := range users {
			for _, did := range deviceIDs {
				rows = append(rows, entity.UserDeviceAccess{
					AppUserID: u.ID, NetworkDeviceID: did,
					Note: "granted automatically when per-user device access was introduced",
				})
			}
		}
		// Ignore conflicts rather than failing the boot: a partially-applied migration from an
		// interrupted previous start must be able to finish.
		if err := db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 200).Error; err != nil {
			log.Printf("⚠️  device access migration: could not grant: %v", err)
			return
		}
		granted = len(rows)
	}

	db.Create(&entity.SystemConfig{Key: deviceAccessSeededKey, Value: "1"})
	fmt.Printf("✅ Device access migrated: %d grant(s) for %d existing non-admin user(s) over %d device(s)\n",
		granted, len(users), len(deviceIDs))
}

// ── Where a seeded secret comes from ───────────────────────────────────────
//
// Never from a literal in this file. A literal here is a published secret: it is identical in
// every clone, every image and every deployment, and no amount of encryption at rest changes that
// because the plaintext is the source code. The three helpers below are the only ways this package
// obtains one.

// defaultSeedAdminPassword is what admin@got.co.th is created with when SEED_ADMIN_PASSWORD is
// not set. It is a KNOWN password, published with the source, and that is the point: the owner
// would rather a fresh install have a login they can type than one generated into a log line that
// scrolls away. See the longer note at the call site for what that costs and who must override it.
//
// It is eight characters, which is shorter than the 12 the password policy seeded a few lines
// below requires. Nothing re-checks an existing password against the policy, so the account logs
// in — but the FIRST password change will be held to 12, which is the intended direction of
// travel anyway.
const defaultSeedAdminPassword = "P@ssw0rd"

// seedAccountPassword returns the seed password for an app login: the value of envKey when it is
// set, otherwise fallback.
//
// The fallback used to be 32 random hex characters printed once at boot. It is now a fixed default
// (see above) by the owner's decision, which moves the risk rather than removing it: a random
// password is unguessable but unrecoverable if the log is gone, and a fixed one is the reverse.
// fromEnv is returned so the caller can say which of the two happened, loudly, in the boot log.
func seedAccountPassword(envKey, fallback string) (password string, fromEnv bool) {
	if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
		return v, true
	}
	return fallback, false
}

// announceSeededLogin says which password the seeded administrator was given, every time the seed
// runs — because by the time anyone reads this line the account already exists and is reachable.
//
// A CONFIGURED password is named but never printed: the operator already has it in .env, and the
// startup log is read, shipped and pasted by far more people than that file is. The BUILT-IN
// DEFAULT is a different case — printing it leaks nothing, since it is in the source — so the line
// is spent on saying plainly that this install is using a password strangers know.
func announceSeededLogin(email, password, envKey string, fromEnv bool) {
	if fromEnv {
		fmt.Printf("✅ Seeded login %s with the password from %s\n", email, envKey)
		return
	}
	log.Printf("\n"+
		"🔐 ───────────────────────────────────────────────────────────────────\n"+
		"🔐  SEEDED LOGIN — using the BUILT-IN DEFAULT password\n"+
		"🔐      %s\n"+
		"🔐      %s\n"+
		"🔐  This value lives in config/db.go, so anyone with the source knows it.\n"+
		"🔐  CHANGE IT at the first sign-in — or set %s before the\n"+
		"🔐  FIRST boot, because this seed is skipped once the table has a row.\n"+
		"🔐 ───────────────────────────────────────────────────────────────────",
		email, password, envKey)
}

// smtpSeedFromEnv returns the outgoing-mail account to seed, or ok=false when either half is
// missing. Both are required: an address with no app password cannot send, and an app password
// with no address has nothing to send as.
func smtpSeedFromEnv() (email, appPassword string, ok bool) {
	email = strings.TrimSpace(os.Getenv("SEED_SMTP_EMAIL"))
	appPassword = strings.TrimSpace(os.Getenv("SEED_SMTP_APP_PASSWORD"))
	if email == "" || appPassword == "" {
		return "", "", false
	}
	return email, appPassword, true
}

// seedNetworkDevices seeds a sample FortiGate device.
// Password is read from env SEED_DEVICE_PASSWORD — if not set, a placeholder is used.
// Update the password via the web UI before running backups.
func seedNetworkDevices() {
	if tableHasAnyRows(&entity.NetworkDevice{}) {
		fmt.Println("⏭️  Skip NetworkDevice: already seeded")
		return
	}

	password := os.Getenv("SEED_DEVICE_PASSWORD")
	placeholder := false
	if password == "" {
		password = "CHANGE_ME"
		placeholder = true
	}

	enc, err := platform.EncryptSecret(password)
	if err != nil {
		log.Printf("⚠️  seed NetworkDevice: encrypt failed: %v", err)
		return
	}

	device := entity.NetworkDevice{
		Name:        "FortiGate-80E",
		Vendor:      "fortinet",
		Platform:    "fortinet",
		MgmtIP:      "10.10.20.90", // the lab 80E; it moved off 10.0.99.201 in Nov 2026
		Port:        22,
		Site:        "HQ",
		Role:        "firewall",
		Status:      "active",
		Username:    "admin",
		PasswordEnc: enc,
	}

	if err := db.Create(&device).Error; err != nil {
		log.Fatalf("❌ seed NetworkDevice: %v", err)
	}

	if placeholder {
		fmt.Println("✅ Seeded NetworkDevice (FortiGate-80E) — ⚠️  password is placeholder, update via web UI before running backup (or set env SEED_DEVICE_PASSWORD)")
	} else {
		fmt.Println("✅ Seeded NetworkDevice (FortiGate-80E) with password from SEED_DEVICE_PASSWORD")
	}
}

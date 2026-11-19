package config

import (
	"fmt"
	"go/ast"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	gormschema "gorm.io/gorm/schema"

	"network_automation/entity"
)

// The shape of the database itself, against a real Postgres.
//
// SetupDatabase is the only thing that decides what tables this application has, and db.go's two
// index helpers decide what the database will and will not accept. None of that can be checked
// without a server: an AutoMigrate list is just a slice until Postgres is asked to honour it, and
// a partial unique index is indistinguishable from a plain one until two rows collide.
//
// Skipped unless SEED_DB_TEST_DSN names a database it may freely write to — the same variable
// seed_db_test.go uses, so one container serves the whole package. Point it at a throwaway one,
// never at the console's own; every case here CREATEs and DROPs a schema of its own:
//
//	docker run --rm -d -p 55433:5432 -e POSTGRES_PASSWORD=test --name config-pg postgres:16-alpine
//	SEED_DB_TEST_DSN="host=localhost port=55433 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./config/ -v

// freshSchemaDB points the package-level db at an EMPTY Postgres schema of its own and returns the
// connection plus the schema's name.
//
// A schema rather than seed_db_test.go's drop-and-migrate, because the questions below are about
// what the database contains as a whole — "are there exactly 33 tables", "does this index exist" —
// and those answers must not depend on what any other test in the package left behind.
func freshSchemaDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := os.Getenv("SEED_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("SEED_DB_TEST_DSN not set — see the note at the top of db_schema_db_test.go")
	}
	silent := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	admin, err := gorm.Open(postgres.Open(dsn), silent)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Lower-cased and bounded: an unquoted identifier is folded to lower case by Postgres, and a
	// test name can be long enough to pass the 63-byte limit.
	name := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		default:
			return '_'
		}
	}, t.Name())
	if len(name) > 24 {
		name = name[:24]
	}
	schemaName := fmt.Sprintf("cfg_%s_%d", name, time.Now().UnixNano()%1e9)

	if err := admin.Exec("CREATE SCHEMA " + schemaName).Error; err != nil {
		t.Fatalf("create schema: %v", err)
	}
	// search_path travels as an ordinary connection parameter, so every connection in this pool —
	// and therefore every statement db.go issues, including its unqualified CREATE INDEX — lands in
	// this schema and nowhere else.
	conn, err := gorm.Open(postgres.Open(dsn+" search_path="+schemaName), silent)
	if err != nil {
		t.Fatalf("connect to %s: %v", schemaName, err)
	}

	previous := db
	db = conn
	t.Cleanup(func() {
		db = previous
		if sqlDB, err := conn.DB(); err == nil {
			_ = sqlDB.Close()
		}
		if err := admin.Exec("DROP SCHEMA " + schemaName + " CASCADE").Error; err != nil {
			t.Logf("could not drop %s (harmless in a throwaway container): %v", schemaName, err)
		}
		if sqlDB, err := admin.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	// EncryptSecret needs a key; this one is a test fixture and protects nothing.
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	return conn, schemaName
}

func tablesIn(t *testing.T, conn *gorm.DB, schemaName string) []string {
	t.Helper()
	var names []string
	err := conn.Raw(`SELECT table_name FROM information_schema.tables
	                   WHERE table_schema = ? AND table_type = 'BASE TABLE'`, schemaName).
		Scan(&names).Error
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	sort.Strings(names)
	return names
}

func indexesIn(t *testing.T, conn *gorm.DB, schemaName string) map[string]int {
	t.Helper()
	var names []string
	if err := conn.Raw(`SELECT indexname FROM pg_indexes WHERE schemaname = ?`, schemaName).
		Scan(&names).Error; err != nil {
		t.Fatalf("list indexes: %v", err)
	}
	out := map[string]int{}
	for _, n := range names {
		out[n]++
	}
	return out
}

// migratedTables is the database this application is supposed to have.
//
// Written out rather than counted, so that losing an entity from SetupDatabase's AutoMigrate list
// — easy to do while editing a 33-line call — fails with the name of the table that disappeared
// instead of with "want 33, got 32". Changing this list is how a schema change is declared:
// deliberately, in the same commit as the entity.
var migratedTables = []string{
	"activity_logs",
	"app_roles",
	"app_users",
	"audit_exceptions",
	"audit_runs",
	"automation_jobs",
	"backups",
	"calendar_events",
	"change_records",
	"change_requests",
	"config_backups",
	"config_deploy_results",
	"config_deploys",
	"device_credentials",
	"device_tls_pins",
	"drift_findings",
	"drift_runs",
	"metric_samples",
	"network_devices",
	"notify_channels",
	"notify_events",
	"notify_recipients",
	"notify_rule_states",
	"notify_rules",
	"otps",
	"password_histories",
	"send_emails",
	"ssh_host_keys",
	"system_configs",
	"topology_devices",
	"user_backup_codes",
	"user_device_accesses",
	"user_sessions",
	"user_totps",
}

// implicitTables are created by AutoMigrate without anyone listing them.
//
// Kept separate from migratedTables on purpose, because the two lists answer different questions
// and one combined list could not answer either: migratedTables must match the entities in the
// AutoMigrate call exactly (that is what names a LOST entity), while a fresh database holds both.
//
// notify_rule_recipients is the join table GORM builds for the many2many on NotifyRule.Recipients
// (entity/notify.go). Nothing migrates it by name, so nothing would notice if the relationship
// were removed — which is why it is written down here rather than tolerated as "an extra table".
var implicitTables = []string{
	"notify_rule_recipients",
}

func diffSets(want, got []string) (missing, extra []string) {
	in := func(list []string) map[string]bool {
		m := map[string]bool{}
		for _, v := range list {
			m[v] = true
		}
		return m
	}
	wantSet, gotSet := in(want), in(got)
	for _, v := range want {
		if !gotSet[v] {
			missing = append(missing, v)
		}
	}
	for _, v := range got {
		if !wantSet[v] {
			extra = append(extra, v)
		}
	}
	return missing, extra
}

// A fresh deployment gets exactly these tables and nothing else. The count is asserted too, because
// AutoMigrate also creates tables nobody listed (a many2many join table, for one), and an
// unexpected table is a schema this file does not describe.
func TestSetupDatabaseMigratesEveryEntity(t *testing.T) {
	conn, schemaName := freshSchemaDB(t)

	SetupDatabase()

	want := append(append([]string{}, migratedTables...), implicitTables...)

	got := tablesIn(t, conn, schemaName)
	missing, extra := diffSets(want, got)
	for _, name := range missing {
		t.Errorf("table %q was not created — the entity it belongs to is no longer migrated", name)
	}
	for _, name := range extra {
		t.Errorf("table %q exists but is listed in neither migratedTables nor implicitTables — "+
			"add it to whichever it belongs to, deliberately", name)
	}
	if len(got) != len(want) {
		t.Errorf("a fresh install has %d tables, want %d", len(got), len(want))
	}
}

// autoMigrateEntities reads SetupDatabase's AutoMigrate call out of the source and returns the
// table name each argument will produce, computed with the same NamingStrategy GORM uses.
//
// This is the half that names a LOSS: the test above runs whatever the call lists, so dropping an
// entity from it would leave that test asserting a smaller schema against a smaller list of its
// own. Comparing the call's arguments with migratedTables catches the removal itself.
func autoMigrateEntities(t *testing.T) []string {
	t.Helper()
	fset, files := parsePackage(t)
	naming := gormschema.NamingStrategy{}

	var tables []string
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || selectorName(call.Fun) != "db.AutoMigrate" {
				return true
			}
			for _, arg := range call.Args {
				lit, _ := arg.(*ast.CompositeLit)
				if unary, ok := arg.(*ast.UnaryExpr); ok {
					lit, _ = unary.X.(*ast.CompositeLit)
				}
				if lit == nil {
					t.Errorf("%s: AutoMigrate argument is not an entity literal, so this test cannot "+
						"read the schema out of the source any more", fset.Position(arg.Pos()))
					continue
				}
				name := strings.TrimPrefix(selectorName(lit.Type), "entity.")
				tables = append(tables, naming.TableName(name))
			}
			return true
		})
	}
	if len(tables) == 0 {
		t.Fatal("no db.AutoMigrate call found in this package — this test would pass by seeing nothing")
	}
	return tables
}

func TestAutoMigrateListMatchesTheDocumentedSchema(t *testing.T) {
	got := autoMigrateEntities(t)

	missing, extra := diffSets(migratedTables, got)
	for _, name := range missing {
		t.Errorf("%q is in migratedTables but SetupDatabase no longer migrates it — "+
			"the table will be missing on a fresh install", name)
	}
	for _, name := range extra {
		t.Errorf("SetupDatabase migrates %q, which migratedTables does not list — "+
			"add it there so the loss of it would be noticed", name)
	}
	if len(got) != len(migratedTables) {
		t.Errorf("AutoMigrate lists %d entities, migratedTables has %d", len(got), len(migratedTables))
	}
}

// liveUser inserts a live row and returns its id.
func liveUser(t *testing.T, conn *gorm.DB, email string, roleID uint) uint {
	t.Helper()
	u := entity.AppUser{
		Email: email, Password: "not-a-real-hash", FirstName: "A", LastName: "B", AppRoleID: roleID,
	}
	if err := conn.Create(&u).Error; err != nil {
		t.Fatalf("insert %s: %v", email, err)
	}
	return u.ID
}

// The partial unique index, proved by the collision it exists to allow and the one it must still
// refuse. The index's NAME is not what matters — what matters is that a soft-deleted row stops
// reserving its email while two signed-in people still cannot share one.
//
// The bug it repairs was live and 100% reproducible: Recycle Bin's Restore returned a 500 for every
// soft-deleted user, because the "deleted" row's email was still in a plain unique index.
func TestFixAppUserEmailUniqueIndexFreesSoftDeletedEmails(t *testing.T) {
	conn, _ := freshSchemaDB(t)
	if err := conn.AutoMigrate(&entity.AppRole{}, &entity.AppUser{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	role := entity.AppRole{Role: "admin"}
	if err := conn.Create(&role).Error; err != nil {
		t.Fatalf("seed role: %v", err)
	}

	// The broken state this function is written to repair: the plain unique index AppUser.Email
	// used to carry as a struct tag.
	if err := conn.Exec(`CREATE UNIQUE INDEX idx_app_users_email ON app_users (email)`).Error; err != nil {
		t.Fatalf("recreate the old index: %v", err)
	}
	const addr = "recycled@example.test"
	id := liveUser(t, conn, addr, role.ID)
	if err := conn.Delete(&entity.AppUser{}, id).Error; err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	if err := conn.Create(&entity.AppUser{
		Email: addr, Password: "x", FirstName: "A", LastName: "B", AppRoleID: role.ID,
	}).Error; err == nil {
		t.Fatal("a plain unique index accepted the email of a soft-deleted row — the premise of this " +
			"test is gone, so it is no longer proving the repair")
	}

	fixAppUserEmailUniqueIndex()

	// Half one: a deleted address is reusable, and two deleted rows may hold the same one.
	second := liveUser(t, conn, addr, role.ID)
	if err := conn.Delete(&entity.AppUser{}, second).Error; err != nil {
		t.Fatalf("soft delete the second row: %v", err)
	}
	var deleted int64
	conn.Unscoped().Model(&entity.AppUser{}).Where("email = ? AND deleted_at IS NOT NULL", addr).Count(&deleted)
	if deleted != 2 {
		t.Fatalf("%d soft-deleted rows hold %s, want 2 — Restore and re-registering a deleted "+
			"address are still blocked", deleted, addr)
	}

	// Half two: and the constraint is still a constraint.
	liveUser(t, conn, addr, role.ID)
	err := conn.Create(&entity.AppUser{
		Email: addr, Password: "x", FirstName: "A", LastName: "B", AppRoleID: role.ID,
	}).Error
	if err == nil {
		t.Error("two LIVE users now share an email — the repair dropped the uniqueness instead of " +
			"scoping it, and two accounts can log in as the same address")
	}
}

// Running the repair against an already-repaired database must be a no-op, since it runs on every
// boot. It drops the index before recreating it, so the uniqueness has to survive the round trip.
func TestFixAppUserEmailUniqueIndexIsIdempotent(t *testing.T) {
	conn, _ := freshSchemaDB(t)
	if err := conn.AutoMigrate(&entity.AppRole{}, &entity.AppUser{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	role := entity.AppRole{Role: "admin"}
	conn.Create(&role)

	fixAppUserEmailUniqueIndex()
	fixAppUserEmailUniqueIndex()

	const addr = "twice@example.test"
	liveUser(t, conn, addr, role.ID)
	if err := conn.Create(&entity.AppUser{
		Email: addr, Password: "x", FirstName: "A", LastName: "B", AppRoleID: role.ID,
	}).Error; err == nil {
		t.Error("after a second boot nothing refuses a duplicate live email")
	}
}

// Every performance index must actually be created. The function logs a failure and carries on by
// design — a missing index makes a query slow, not wrong — which means a DDL that no longer matches
// the schema (a renamed table, a dropped column) would disappear into a log line nobody reads. This
// is the only thing that would notice.
func TestCreatePerformanceIndexesCreatesThemAll(t *testing.T) {
	conn, schemaName := freshSchemaDB(t)

	SetupDatabase() // AutoMigrate first: every DDL below names a real table and column.

	have := indexesIn(t, conn, schemaName)
	for _, idx := range performanceIndexes {
		if have[idx.name] == 0 {
			t.Errorf("index %s does not exist after SetupDatabase — its DDL no longer matches the "+
				"schema, and the query it serves is sorting on every request", idx.name)
		}
	}
	if len(performanceIndexes) == 0 {
		t.Fatal("performanceIndexes is empty — this test would pass by checking nothing")
	}
}

// It runs on every boot, so a second run must change nothing: no error, no duplicate.
func TestCreatePerformanceIndexesIsIdempotent(t *testing.T) {
	conn, schemaName := freshSchemaDB(t)
	SetupDatabase()
	before := indexesIn(t, conn, schemaName)

	createPerformanceIndexes()

	after := indexesIn(t, conn, schemaName)
	for _, idx := range performanceIndexes {
		if after[idx.name] != 1 {
			t.Errorf("%s exists %d times after a second boot, want exactly 1", idx.name, after[idx.name])
		}
	}
	if len(after) != len(before) {
		t.Errorf("a second boot changed the index count from %d to %d", len(before), len(after))
	}
}

package user

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// The user-management handlers, end to end, against a real database.
//
// authz_test.go covers the pure decision functions in authz.go, and they are all at 100%. That is
// not the same thing as covering the boundary: the incident this package is known for was not a
// wrong answer from a helper, it was handlers that never asked one. /users, /update-users/:id,
// /delete-users/:id, /create-users and /users/bulk-* ran behind "is the caller logged in" alone,
// so any account with curl could rewrite the admin's password or promote itself. A helper that
// decides correctly while a handler forgets to call it looks exactly like a fixed system from a
// unit test, so these tests go through the handlers and then READ THE ROW BACK — a 403 that still
// wrote the change is not a refusal.
//
// Everything here needs a database, so these follow the convention set by
// services/retention_db_test.go, controller/policyobject/device_handler_db_test.go and
// controller/auth/login_db_test.go: skipped unless one env var names a Postgres they may freely
// create, truncate and drop tables in. Point it at a throwaway container, NEVER at the console's
// own database — these tests truncate app_users:
//
//	docker run --rm -d -p 55436:5432 -e POSTGRES_PASSWORD=test --name user-pg postgres:16-alpine
//	USER_DB_TEST_DSN="host=localhost port=55436 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/user/ -cover -v
const userTestDSNEnv = "USER_DB_TEST_DSN"

const (
	// The seeded password every fixture account shares, and a replacement that satisfies the
	// policy the fixture stores (12 chars, upper, digit, special). Both are long enough that a
	// case about an authorisation decision is never answered by the password rules instead.
	userTestPassword = "Seed-Passw0rd!2024"
	userTestNewPass  = "Rotated-Passw0rd!99"

	userTestAdminEmail = "admin@test.invalid"
	userTestAliceEmail = "alice@test.invalid"
	userTestBobEmail   = "bob@test.invalid"
)

// userFixture is the seeded world a handler test runs against: one admin and two ordinary
// accounts, which is the smallest world in which "someone else's account" means anything.
type userFixture struct {
	DB *gorm.DB

	AdminRoleID uint
	UserRoleID  uint

	AdminID uint // the only admin — so the "last administrator" guards are live by default
	AliceID uint // a non-admin, the caller in the IDOR cases
	BobID   uint // a non-admin, the victim in the IDOR cases
}

// seededHash is the cost-4 hash of userTestPassword, computed once per test binary.
//
// bcrypt stores its cost inside the hash and CompareHashAndPassword reads the parameters back out,
// so a cost-4 hash verifies through platform.CheckPasswordHash exactly like a production cost-12
// one — and seeding three accounts per test does not cost a second of wall clock proving something
// none of these tests are about.
var seededHash string

func cheapUserHash(t *testing.T, plain string) string {
	t.Helper()
	b, err := bcrypt.GenerateFromPassword([]byte(plain), 4)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	return string(b)
}

// schemaOnce guards the connect-and-migrate half of the fixture: it is identical for every test
// and costs about half a second each time, which on a suite this size is most of the runtime.
var schemaOnce sync.Once

// buildUserTestSchema connects and brings up the tables these handlers touch.
func buildUserTestSchema(t *testing.T, dsn string) {
	t.Helper()

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatalf("config.DB() is nil after ConnectDB — %s did not connect", userTestDSNEnv)
	}

	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.Backup{}, &entity.PasswordHistory{}, &entity.SystemConfig{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}

	// The real unique index on app_users.email is PARTIAL — see config.fixAppUserEmailUniqueIndex.
	// AutoMigrate cannot express it (entity.AppUser deliberately carries no `uniqueIndex` tag), so
	// a fixture without this line would let the "a deleted address can be reused" test pass on a
	// table that has no uniqueness at all, which proves nothing about production.
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
	                     ON app_users (email) WHERE deleted_at IS NULL`).Error; err != nil {
		t.Fatalf("create partial email index: %v", err)
	}
}

// userTestDB seeds the three accounts and the stored password policy, from an empty schema.
func userTestDB(t *testing.T) *userFixture {
	t.Helper()

	dsn := os.Getenv(userTestDSNEnv)
	if dsn == "" {
		t.Skip(userTestDSNEnv + " not set — see the note at the top of fixture_db_test.go")
	}

	// Connecting and migrating is done once for the whole binary; only the seeding below is per
	// test. The isolation comes from the TRUNCATE, not from rebuilding the schema sixty times.
	t.Setenv("DATABASE_URL", dsn)
	schemaOnce.Do(func() { buildUserTestSchema(t, dsn) })

	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	// Start from empty every time, so one test's row cannot answer the next test's assertion.
	for _, table := range []string{
		"user_device_accesses", "network_devices", "password_histories",
		"backups", "system_configs", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	fx := &userFixture{DB: db}

	adminRole := entity.AppRole{Role: adminRoleName}
	userRole := entity.AppRole{Role: "user"}
	for _, r := range []*entity.AppRole{&adminRole, &userRole} {
		if err := db.Create(r).Error; err != nil {
			t.Fatalf("create role %s: %v", r.Role, err)
		}
	}
	fx.AdminRoleID, fx.UserRoleID = adminRole.ID, userRole.ID

	if seededHash == "" {
		seededHash = cheapUserHash(t, userTestPassword)
	}

	admin := entity.AppUser{
		Email: userTestAdminEmail, Password: seededHash,
		FirstName: "Test", LastName: "Admin", AppRoleID: adminRole.ID, AuthProvider: "local",
	}
	alice := entity.AppUser{
		Email: userTestAliceEmail, Password: seededHash,
		FirstName: "Alice", LastName: "Caller", AppRoleID: userRole.ID, AuthProvider: "local",
		PhoneNumber: "0800000001", Location: "Bangkok", Position: "NOC",
	}
	bob := entity.AppUser{
		Email: userTestBobEmail, Password: seededHash,
		FirstName: "Bob", LastName: "Victim", AppRoleID: userRole.ID, AuthProvider: "local",
		PhoneNumber: "0800000002", Location: "Chiang Mai", Position: "NOC",
	}
	for _, u := range []*entity.AppUser{&admin, &alice, &bob} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Email, err)
		}
	}
	fx.AdminID, fx.AliceID, fx.BobID = admin.ID, alice.ID, bob.ID

	// The password rules these handlers enforce are NOT this package's: they are whatever
	// /admin/password-policy stored in system_configs. Seeding the rows explicitly, instead of
	// leaning on services' fallback defaults, is what makes "a password that fails the policy is
	// refused" a statement about the configured policy rather than about a hardcoded number.
	for key, value := range map[string]string{
		"password_min_length":        "12",
		"password_require_uppercase": "true",
		"password_require_number":    "true",
		"password_require_special":   "true",
		"password_history_count":     "5",
	} {
		if err := db.Create(&entity.SystemConfig{Key: key, Value: value}).Error; err != nil {
			t.Fatalf("seed policy %s: %v", key, err)
		}
	}

	return fx
}

// addAdmin seeds a SECOND administrator, for the cases that must get past the "last administrator"
// guards to reach the behaviour under test.
func (fx *userFixture) addAdmin(t *testing.T, email string) uint {
	t.Helper()
	u := entity.AppUser{
		Email: email, Password: seededHash,
		FirstName: "Second", LastName: "Admin", AppRoleID: fx.AdminRoleID, AuthProvider: "local",
	}
	if err := fx.DB.Create(&u).Error; err != nil {
		t.Fatalf("create second admin: %v", err)
	}
	return u.ID
}

// reload reads a user row back out of the database, live rows only.
//
// Every refusal case below asserts against this and not against the status code: the bug this
// package is remembered for wrote the change, and a handler that answers 403 after saving is
// indistinguishable from a correct one until something reads the row.
func (fx *userFixture) reload(t *testing.T, id uint) entity.AppUser {
	t.Helper()
	var u entity.AppUser
	if err := fx.DB.Preload("AppRole").First(&u, id).Error; err != nil {
		t.Fatalf("reload user %d: %v", id, err)
	}
	return u
}

// roleOf returns the role name currently stored for a user — the field a privilege escalation has
// to move, so it is read from the database rather than from any response body.
func (fx *userFixture) roleOf(t *testing.T, id uint) string {
	t.Helper()
	u := fx.reload(t, id)
	if u.AppRole == nil {
		t.Fatalf("user %d has no role loaded", id)
	}
	return u.AppRole.Role
}

// asUser aims a handler at a target id the way the router would: the path, the :id param, and the
// user_id / user_role that middleware.Authorizes stamps on the context from the JWT.
//
// role "" and callerID 0 model a request that somehow reached a handler with nothing set, which
// must always fail closed rather than read as a privileged caller.
func asUser(t *testing.T, method, path string, callerID uint, role string, targetID uint, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	var reader *bytes.Buffer
	if body != "" {
		reader = bytes.NewBufferString(body)
	} else {
		reader = bytes.NewBufferString("")
	}
	c.Request = httptest.NewRequest(method, path, reader)
	if body != "" {
		c.Request.Header.Set("Content-Type", "application/json")
	}
	if targetID != 0 {
		c.Params = gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(targetID), 10)}}
	}
	if role != "" {
		c.Set("user_role", role)
	}
	if callerID != 0 {
		c.Set("user_id", callerID)
	}
	return c, rec
}

// decodeJSON unmarshals a response body, failing the test if it is not JSON at all.
func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder, into any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("response is not JSON (%d): %s", rec.Code, rec.Body.String())
	}
}

// assertForbidden is the shared shape of an authorisation refusal: 403, and nothing that looks
// like account data in the body.
func assertForbidden(t *testing.T, rec *httptest.ResponseRecorder, what string) {
	t.Helper()
	if rec.Code != http.StatusForbidden {
		t.Fatalf("%s: status = %d, want 403: %s", what, rec.Code, rec.Body.String())
	}
}

// canStillSignIn repeats the lookup auth.Login performs — a case-insensitive match on email over
// LIVE rows — and reports whether an account with this address is still reachable by it.
//
// Login's own refusal paths are controller/auth's tests to own. What belongs here is the half this
// package is responsible for: after DeleteUserByID, the row the sign-in lookup needs must be gone.
func canStillSignIn(t *testing.T, db *gorm.DB, email string) bool {
	t.Helper()
	var u entity.AppUser
	err := db.Where("LOWER(email) = LOWER(?)", email).First(&u).Error
	switch {
	case err == nil:
		return platform.CheckPasswordHash(userTestPassword, u.Password)
	case errors.Is(err, gorm.ErrRecordNotFound):
		return false
	default:
		t.Fatalf("sign-in lookup for %s: %v", email, err)
		return false
	}
}

package devicecredential

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// The three handlers that log into a firewall, refused at the budget.
//
// devicecredential_limit_test.go covers the budget as a thing; this file proves the handlers
// actually consult it, and — the property that matters — that they do so BEFORE the login. Each
// test asserts the side effect a real attempt would have left behind (a stored row, a fresh
// last_tested_at, a changed username) is absent.
//
// DB-backed, because every one of these handlers reads its device and credential out of Postgres
// before it gets near the budget. Skipped unless the same env var the topologydevice tests use
// names a throwaway Postgres — never the console's own database:
//
//	docker run --rm -d -p 55440:5432 -e POSTGRES_PASSWORD=test --name topo-pg postgres:16-alpine
//	DEVICEACCESS_DB_TEST_DSN="host=localhost port=55440 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/devicecredential/ -v
//
// The firewall rows point at TEST-NET-2 addresses that route nowhere, so a regression that let a
// login through fails on an unroutable address rather than reaching a device.

const (
	credAdminUserID = uint(1)
	credPlainUserID = uint(2)
	// A real 32-byte key so EncryptSecret/DecryptSecret work. It guards nothing: the only secret it
	// ever protects is the literal below, in a database this test truncates.
	credTestKey = "9f2c4b1ea77d3568bb0c41d9e5a6f30c9f2c4b1ea77d3568bb0c41d9e5a6f30c"
)

func credTestDevice(t *testing.T) entity.NetworkDevice {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dsn := os.Getenv("DEVICEACCESS_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("DEVICEACCESS_DB_TEST_DSN not set — see the note at the top of devicecredential_db_test.go")
	}
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("CRED_ENC_KEY", credTestKey)
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{}, &entity.DeviceCredential{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	for _, table := range []string{
		"device_credentials", "user_device_accesses", "network_devices", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// user_device_accesses has a foreign key to app_users, so the grant below needs real accounts.
	role := entity.AppRole{Role: "admin"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	for _, u := range []entity.AppUser{
		{Email: "admin@test.invalid", Password: "x", FirstName: "Test", LastName: "Admin", AppRoleID: role.ID},
		{Email: "user@test.invalid", Password: "x", FirstName: "Test", LastName: "User", AppRoleID: role.ID},
	} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Email, err)
		}
	}

	device := entity.NetworkDevice{
		Name: "FortiGate-stub", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.1", APIPort: 443, Port: 22, Status: "active",
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	if err := db.Create(&entity.UserDeviceAccess{
		AppUserID: credPlainUserID, NetworkDeviceID: device.ID, GrantedByID: credAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}

	// The budget is package-level and in memory — clear this pair before and after, or one test's
	// spent budget decides another test's result.
	clearBudget(t, [2]uint{credPlainUserID, device.ID})
	return device
}

// spendTheBudget charges the pair the two failures that close it.
func spendTheBudget(uid, deviceID uint) {
	recordVerifyOutcome(uid, deviceID, testStatusFail, true)
	recordVerifyOutcome(uid, deviceID, testStatusFail, true)
}

func credRequest(t *testing.T, method, path, body string, uid uint, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	if body != "" {
		c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
	} else {
		c.Request = httptest.NewRequest(method, path, nil)
	}
	c.Params = params
	c.Set("user_id", uid)
	c.Set("user_role", "user")
	return c, rec
}

// seedCredential stores one working-looking credential for the caller, so Update and Test have
// something to act on.
func seedCredential(t *testing.T, deviceID uint) entity.DeviceCredential {
	t.Helper()
	enc, err := platform.EncryptSecret("not-a-real-password")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	cred := entity.DeviceCredential{
		AppUserID: credPlainUserID, NetworkDeviceID: deviceID,
		Username: "operator", PasswordEnc: enc,
	}
	if err := config.DB().Create(&cred).Error; err != nil {
		t.Fatalf("seed credential: %v", err)
	}
	return cred
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestCreateIsRefusedOnceTheBudgetIsSpentAndStoresNothing(t *testing.T) {
	device := credTestDevice(t)
	spendTheBudget(credPlainUserID, device.ID)

	c, rec := credRequest(t, http.MethodPost, "/me/device-credentials",
		`{"network_device_id":`+strconv.Itoa(int(device.ID))+`,"username":"operator","password":"guess"}`,
		credPlainUserID)
	Create(c)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — a third wrong password reached the firewall and locked the account: %s",
			rec.Code, rec.Body.String())
	}
	var n int64
	if err := config.DB().Model(&entity.DeviceCredential{}).Count(&n).Error; err != nil {
		t.Fatalf("count credentials: %v", err)
	}
	if n != 0 {
		t.Fatalf("%d credential(s) stored by a refused create", n)
	}
}

// Nothing above the budget changes the ordinary path: with a clean budget the handler runs on to
// the real login. It cannot reach the (unroutable) device, which is exactly the unreachable case
// verify() saves anyway — the point here is that the request was NOT refused at the gate.
func TestCreateWithAnUntouchedBudgetIsNotThrottled(t *testing.T) {
	device := credTestDevice(t)

	c, rec := credRequest(t, http.MethodPost, "/me/device-credentials",
		`{"network_device_id":`+strconv.Itoa(int(device.ID))+`,"username":"operator","password":"pw"}`,
		credPlainUserID)
	Create(c)

	if rec.Code == http.StatusTooManyRequests {
		t.Fatalf("a first save was throttled: %s", rec.Body.String())
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

func TestUpdateIsRefusedOnceTheBudgetIsSpentAndChangesNothing(t *testing.T) {
	device := credTestDevice(t)
	cred := seedCredential(t, device.ID)
	spendTheBudget(credPlainUserID, device.ID)

	id := strconv.Itoa(int(cred.ID))
	c, rec := credRequest(t, http.MethodPut, "/me/device-credentials/"+id,
		`{"username":"renamed","password":"guess"}`, credPlainUserID,
		gin.Param{Key: "id", Value: id})
	Update(c)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429: %s", rec.Code, rec.Body.String())
	}
	var after entity.DeviceCredential
	if err := config.DB().First(&after, cred.ID).Error; err != nil {
		t.Fatalf("read the credential back: %v", err)
	}
	if after.Username != "operator" {
		t.Fatalf("username = %q, want unchanged — the refusal came after the write", after.Username)
	}
	if after.LastTestedAt != nil {
		t.Fatal("last_tested_at was written, so a login was attempted despite the refusal")
	}
}

// ── Test ────────────────────────────────────────────────────────────────────

// The one a user can hold the button down on. The assertion that matters is last_tested_at: a real
// attempt always writes it, so its absence is proof the refusal happened before the login.
func TestTestIsRefusedOnceTheBudgetIsSpentWithoutAttemptingALogin(t *testing.T) {
	device := credTestDevice(t)
	cred := seedCredential(t, device.ID)
	spendTheBudget(credPlainUserID, device.ID)

	id := strconv.Itoa(int(cred.ID))
	c, rec := credRequest(t, http.MethodPost, "/me/device-credentials/"+id+"/test", "",
		credPlainUserID, gin.Param{Key: "id", Value: id})
	Test(c)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429: %s", rec.Code, rec.Body.String())
	}
	var after entity.DeviceCredential
	if err := config.DB().First(&after, cred.ID).Error; err != nil {
		t.Fatalf("read the credential back: %v", err)
	}
	if after.LastTestedAt != nil || after.LastTestStatus != "" {
		t.Fatalf("the row carries a test result (%v / %q), so the firewall was logged into",
			after.LastTestedAt, after.LastTestStatus)
	}
}

// The access check at :195 is the half that was already right. Pinned here because the two guards
// now sit next to each other, and a device the caller was never granted must still be a 404 — not a
// 429, and certainly not a login.
func TestCreateStillRefusesADeviceTheCallerWasNotGranted(t *testing.T) {
	credTestDevice(t)

	other := entity.NetworkDevice{
		Name: "FortiGate-someone-elses", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.9", APIPort: 443, Port: 22, Status: "active",
	}
	if err := config.DB().Create(&other).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}

	c, rec := credRequest(t, http.MethodPost, "/me/device-credentials",
		`{"network_device_id":`+strconv.Itoa(int(other.ID))+`,"username":"operator","password":"pw"}`,
		credPlainUserID)
	Create(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

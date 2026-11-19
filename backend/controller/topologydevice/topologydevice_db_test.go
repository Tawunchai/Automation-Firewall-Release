package topologydevice

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
)

// A pin names TWO ids, and only one of them was ever checked.
//
// OwnerUserID is scoped properly — find() filters it, so nobody can read or edit somebody else's
// pin. DeviceID is the other one: it names the FIREWALL this server logs into and runs
// `execute ping <ip>` on. Until the fix these handlers only asked whether that firewall existed, so
// any signed-in user could pin a host and have a firewall they were never granted probe it — a host
// scanner pivoting through another team's device (the production one included), spending logins
// against an account FortiOS locks after three failures.
//
// These tests are DB-backed because the grant lives in a table: the thing under test IS the query
// in services.UserCanAccessDevice. Skipped unless an env var names a Postgres these tests may
// freely create and truncate tables in — point it at a throwaway container, never at the console's
// own database:
//
//	docker run --rm -d -p 55440:5432 -e POSTGRES_PASSWORD=test --name topo-pg postgres:16-alpine
//	DEVICEACCESS_DB_TEST_DSN="host=localhost port=55440 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/topologydevice/ -v
//
// No firewall is reached by any test here: every case either refuses before a login, or exercises a
// handler (Create/Update) that never dials at all.

const (
	topoAdminUserID = uint(1)
	topoPlainUserID = uint(2)
)

type topoFixture struct {
	granted   entity.NetworkDevice // the firewall topoPlainUserID is allowed to use
	ungranted entity.NetworkDevice // one they were never given
}

func topoTestDB(t *testing.T) topoFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dsn := os.Getenv("DEVICEACCESS_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("DEVICEACCESS_DB_TEST_DSN not set — see the note at the top of topologydevice_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{}, &entity.TopologyDevice{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	// Start from empty, so one test's grant cannot make another test's refusal pass.
	for _, table := range []string{
		"topology_devices", "user_device_accesses", "network_devices", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// user_device_accesses carries a foreign key to app_users, so a grant needs real accounts —
	// a grant for a user id that does not exist is refused by the database rather than by the code
	// under test.
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

	// Two firewalls on TEST-NET addresses that route nowhere. Nothing here should dial them, and if
	// a refusal ever regresses into a real attempt, it fails on an unroutable address rather than
	// reaching a device.
	fx := topoFixture{
		granted: entity.NetworkDevice{
			Name: "FortiGate-granted", Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.1", APIPort: 443, Port: 22, Status: "active",
		},
		ungranted: entity.NetworkDevice{
			Name: "FortiGate-someone-elses", Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.2", APIPort: 443, Port: 22, Status: "active",
		},
	}
	if err := db.Create(&fx.granted).Error; err != nil {
		t.Fatalf("create granted device: %v", err)
	}
	if err := db.Create(&fx.ungranted).Error; err != nil {
		t.Fatalf("create ungranted device: %v", err)
	}
	return fx
}

func grantTopoDevice(t *testing.T, deviceID uint) {
	t.Helper()
	if err := config.DB().Create(&entity.UserDeviceAccess{
		AppUserID: topoPlainUserID, NetworkDeviceID: deviceID, GrantedByID: topoAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}
}

// topoRequest aims a handler at the package's routes the way the router would.
func topoRequest(t *testing.T, method, path, body string, userID uint, role string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
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
	c.Set("user_id", userID)
	c.Set("user_role", role)
	return c, rec
}

func createBody(name, ip string, firewallID uint) string {
	return `{"name":"` + name + `","ip_address":"` + ip +
		`","kind":"switch","device_id":` + strconv.FormatUint(uint64(firewallID), 10) + `}`
}

func countPins(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := config.DB().Model(&entity.TopologyDevice{}).Count(&n).Error; err != nil {
		t.Fatalf("count pins: %v", err)
	}
	return n
}

// seedPin writes a pin straight to the table, which is how a row that predates the access check (or
// outlives a revoked grant) gets into these tests.
func seedPin(t *testing.T, owner, firewallID uint) entity.TopologyDevice {
	t.Helper()
	pin := entity.TopologyDevice{
		OwnerUserID: owner, DeviceID: firewallID,
		Name: "core-sw", IPAddress: "198.51.100.77", Kind: "switch",
		PingIntervalSeconds: 60, Enabled: true, LastStatus: entity.TopologyStatusUnknown,
	}
	if err := config.DB().Create(&pin).Error; err != nil {
		t.Fatalf("seed pin: %v", err)
	}
	return pin
}

// ── Create ──────────────────────────────────────────────────────────────────

// The hole itself: a firewall the caller was never granted must not be made to ping for them, and
// the refusal must leave nothing behind for the sweep to pick up later.
func TestCreateRefusesAFirewallTheCallerWasNotGranted(t *testing.T) {
	fx := topoTestDB(t)

	c, rec := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("scanner", "198.51.100.77", fx.ungranted.ID), topoPlainUserID, "user")
	Create(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a user pinned a host onto a firewall they were never granted: %s",
			rec.Code, rec.Body.String())
	}
	if n := countPins(t); n != 0 {
		t.Fatalf("%d pin(s) written by a refused create — the sweep would ping it anyway", n)
	}
}

func TestCreateAcceptsAFirewallTheCallerWasGranted(t *testing.T) {
	fx := topoTestDB(t)
	grantTopoDevice(t, fx.granted.ID)

	c, rec := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("core-sw", "198.51.100.77", fx.granted.ID), topoPlainUserID, "user")
	Create(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 for a granted firewall: %s", rec.Code, rec.Body.String())
	}
	var pin entity.TopologyDevice
	if err := config.DB().First(&pin).Error; err != nil {
		t.Fatalf("read the pin back: %v", err)
	}
	if pin.DeviceID != fx.granted.ID || pin.OwnerUserID != topoPlainUserID {
		t.Fatalf("pin stored as device=%d owner=%d, want device=%d owner=%d",
			pin.DeviceID, pin.OwnerUserID, fx.granted.ID, topoPlainUserID)
	}
}

// An admin is not filtered by grants anywhere else in the console, and must not be here either.
func TestCreateLetsAnAdminPinAnyFirewall(t *testing.T) {
	fx := topoTestDB(t)

	c, rec := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("core-sw", "198.51.100.77", fx.ungranted.ID), topoAdminUserID, "admin")
	Create(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 — an admin has no grant list to be filtered by: %s",
			rec.Code, rec.Body.String())
	}
}

// For somebody who can act on it, a typo still gets the message that names the problem.
func TestCreateStillTellsAnAdminTheFirewallDoesNotExist(t *testing.T) {
	topoTestDB(t)

	c, rec := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("core-sw", "198.51.100.77", 9999), topoAdminUserID, "admin")
	Create(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "does not exist") {
		t.Errorf("the refusal does not say the firewall is unknown: %s", rec.Body.String())
	}
}

// And for everybody else the two cases must be indistinguishable: an ungranted firewall and one
// that does not exist both answer 404, so the console never confirms which firewalls it holds.
func TestANonAdminCannotTellAnUngrantedFirewallFromAnAbsentOne(t *testing.T) {
	fx := topoTestDB(t)

	c1, rec1 := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("a", "198.51.100.77", fx.ungranted.ID), topoPlainUserID, "user")
	Create(c1)
	c2, rec2 := topoRequest(t, http.MethodPost, "/topology-devices",
		createBody("b", "198.51.100.78", 9999), topoPlainUserID, "user")
	Create(c2)

	if rec1.Code != http.StatusNotFound || rec2.Code != http.StatusNotFound {
		t.Fatalf("ungranted answered %d and absent answered %d, want 404 for both", rec1.Code, rec2.Code)
	}
	if rec1.Body.String() != rec2.Body.String() {
		t.Errorf("the two refusals differ, so existence is observable:\n ungranted: %s\n absent:    %s",
			rec1.Body.String(), rec2.Body.String())
	}
}

// ── Update ──────────────────────────────────────────────────────────────────

// An edit may MOVE a pin to another firewall, so the gate would be worth nothing if it only applied
// on create.
func TestUpdateRefusesMovingAPinToAnUngrantedFirewall(t *testing.T) {
	fx := topoTestDB(t)
	grantTopoDevice(t, fx.granted.ID)
	pin := seedPin(t, topoPlainUserID, fx.granted.ID)

	c, rec := topoRequest(t, http.MethodPatch, "/topology-devices/"+strconv.Itoa(int(pin.ID)),
		createBody("core-sw", "198.51.100.77", fx.ungranted.ID), topoPlainUserID, "user",
		gin.Param{Key: "id", Value: strconv.Itoa(int(pin.ID))})
	Update(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	var after entity.TopologyDevice
	if err := config.DB().First(&after, pin.ID).Error; err != nil {
		t.Fatalf("read the pin back: %v", err)
	}
	if after.DeviceID != fx.granted.ID {
		t.Fatalf("the pin moved to firewall %d despite the refusal", after.DeviceID)
	}
}

func TestUpdateAllowsAnEditWithinAGrantedFirewall(t *testing.T) {
	fx := topoTestDB(t)
	grantTopoDevice(t, fx.granted.ID)
	pin := seedPin(t, topoPlainUserID, fx.granted.ID)

	c, rec := topoRequest(t, http.MethodPatch, "/topology-devices/"+strconv.Itoa(int(pin.ID)),
		createBody("core-sw-renamed", "198.51.100.77", fx.granted.ID), topoPlainUserID, "user",
		gin.Param{Key: "id", Value: strconv.Itoa(int(pin.ID))})
	Update(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "core-sw-renamed") {
		t.Errorf("the edit did not take: %s", rec.Body.String())
	}
}

// ── the two check paths ─────────────────────────────────────────────────────

// A row that predates the check — or outlives a revoked grant — must not be pinged either. This is
// the case that proves the fix is not only at the front door.
func TestCheckNowRefusesAPinWhoseFirewallIsNotGranted(t *testing.T) {
	fx := topoTestDB(t)
	pin := seedPin(t, topoPlainUserID, fx.ungranted.ID)

	c, rec := topoRequest(t, http.MethodPost, "/topology-devices/"+strconv.Itoa(int(pin.ID))+"/check",
		"", topoPlainUserID, "user", gin.Param{Key: "id", Value: strconv.Itoa(int(pin.ID))})
	CheckNow(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	// The refusal happened before any login: a check that ran would have written a reading.
	var after entity.TopologyDevice
	if err := config.DB().First(&after, pin.ID).Error; err != nil {
		t.Fatalf("read the pin back: %v", err)
	}
	if after.LastCheckedAt != nil {
		t.Fatal("the pin carries a fresh reading, so the firewall was logged into after all")
	}
}

// CheckAll keeps the pin listed — it is the caller's own row — and says why it was skipped, without
// resolving a login for a firewall they may not reach.
func TestCheckAllSkipsAPinWhoseFirewallIsNotGranted(t *testing.T) {
	fx := topoTestDB(t)
	pin := seedPin(t, topoPlainUserID, fx.ungranted.ID)

	c, rec := topoRequest(t, http.MethodPost, "/topology/recheck", "", topoPlainUserID, "user")
	CheckAll(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var after entity.TopologyDevice
	if err := config.DB().First(&after, pin.ID).Error; err != nil {
		t.Fatalf("read the pin back: %v", err)
	}
	if after.LastStatus != entity.TopologyStatusUnknown {
		t.Errorf("last_status = %q, want unknown — an ungranted firewall reported a reading", after.LastStatus)
	}
	if !strings.Contains(after.LastError, "access") {
		t.Errorf("last_error = %q, which does not tell the owner why the pin was skipped", after.LastError)
	}
}

package configdeploy

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
)

// Per-user device access on the two paths in this package that had none.
//
// ── Why these tests exist ────────────────────────────────────────────────────
//
//  1. ROLLBACK had no grant check at all. loadRollbackTarget took :id, loaded the ConfigBackup and
//     then the device named by backup.NetworkDeviceID, and never asked whether the caller holds
//     that firewall. Every rollback handler goes through it, and a FortiOS configuration restore
//     replaces the whole configuration and REBOOTS the unit — so any signed-in admin/operator
//     could reboot and overwrite any firewall in the database.
//
//  2. The DEPLOY HISTORY was not scoped. List returned the newest 100 ConfigDeploy rows to
//     everybody and Get loaded any one of them by id with its children preloaded. A
//     ConfigDeployResult.Output is the raw CLI a firewall printed, and a `query` deploy is
//     effectively a `show` — so the history handed any logged-in user other people's firewall
//     configuration.
//
// Both halves need a database: the grant lookup is a table. So, by the convention
// controller/policyobject/device_handler_db_test.go set, these are skipped unless an env var names
// a Postgres they may freely create and TRUNCATE tables in. Point it at a throwaway container,
// never at the console's own database:
//
//	docker run --rm -d -p 55438:5432 -e POSTGRES_PASSWORD=test --name deploy-pg postgres:16-alpine
//	CONFIGDEPLOY_DB_TEST_DSN="host=localhost port=55438 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/configdeploy/ -cover -v
//	docker rm -f deploy-pg
//
// ── No firewall is contacted, and the tests prove it ─────────────────────────
//
// Every device row here is created WITHOUT a username or a stored credential, so
// services.ResolveDeviceLogin — the first step on the way to the wire, and the step immediately
// after the new access check — fails locally with ErrNoDeviceLogin. That gives the ordering
// assertions a precise shape: a caller who is allowed through is stopped by
// "no usable credential for this device", while a caller who is refused never sees that sentence
// at all. services.AcquireFortiClient, which is the call that would open a socket, is never
// reached on any path in this file.

const (
	// The grant-holding and grant-less accounts. Both are given the `operator` role on the request
	// context: rollback is gated on canDeploy first, so `user` would be refused with a 403 before
	// the grant check and would prove nothing about it. An operator who may deploy, but not to
	// THIS firewall, is the case that was open.
	deployGrantedUserID  = uint(2)
	deployUngrantedUser  = uint(3)
	deployAdminUserID    = uint(1)
	deployOperatorRole   = "operator"
	deployPlainUserRole  = "user"
	deployAdminUserRole  = "admin"
	deployValidConfigHdr = "#config-version=FGT80E-7.2.10-FW-build1706-240918:opmode=0:vdom=0\n"

	// What a leak would look like. Asserted as absent on every refusal, so a test that stops
	// failing because the handler started answering 200 with the row still fails on the contents.
	otherDeviceOutput = "SECRET-CLI-OUTPUT-FROM-A-FIREWALL-YOU-WERE-NOT-GRANTED"
	otherDeployCmd    = "show full-configuration # on the firewall you were not granted"
	ownDeviceOutput   = "output-from-my-own-firewall"
	ownDeployCmd      = "show system interface # on my own firewall"
)

// deployFixture is the world these tests reason about: two firewalls, one granted to
// deployGrantedUserID and one not, with a backup and a deploy apiece.
type deployFixture struct {
	MyDevice    entity.NetworkDevice
	TheirDevice entity.NetworkDevice

	MyBackup      entity.ConfigBackup
	TheirBackup   entity.ConfigBackup
	TheirEmptyBak entity.ConfigBackup // same firewall, no stored config text

	MyDeploy        entity.ConfigDeploy
	TheirDeploy     entity.ConfigDeploy
	MixedDeploy     entity.ConfigDeploy // one child on each firewall
	ChildlessDeploy entity.ConfigDeploy // never got as far as writing its per-device rows
}

// setupDeployAccess points config.DB() at the throwaway Postgres, rebuilds only the tables these
// handlers touch, and returns the fixture.
func setupDeployAccess(t *testing.T) deployFixture {
	t.Helper()

	dsn := os.Getenv("CONFIGDEPLOY_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("CONFIGDEPLOY_DB_TEST_DSN not set — see the note at the top of access_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{}, &entity.DeviceCredential{},
		&entity.ConfigBackup{}, &entity.ConfigDeploy{}, &entity.ConfigDeployResult{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	// Start from empty every time: one test's grant must not be what makes another test's refusal
	// pass, and a leftover deploy row would be counted by the List assertions.
	for _, table := range []string{
		"config_deploy_results", "config_deploys", "config_backups",
		"user_device_accesses", "device_credentials", "network_devices", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// user_device_accesses carries a foreign key to app_users, so the accounts these tests grant
	// and refuse have to be real rows — the database, not the code under test, would reject a
	// grant for a user id that does not exist.
	role := entity.AppRole{Role: "admin"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	for _, u := range []entity.AppUser{
		{Email: "admin@test.invalid", Password: "x", FirstName: "Test", LastName: "Admin", AppRoleID: role.ID},
		{Email: "granted@test.invalid", Password: "x", FirstName: "Test", LastName: "Granted", AppRoleID: role.ID},
		{Email: "ungranted@test.invalid", Password: "x", FirstName: "Test", LastName: "Ungranted", AppRoleID: role.ID},
	} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Email, err)
		}
	}

	// No Username and no PasswordEnc on either device, and no DeviceCredential rows: see the note
	// at the top of the file. 198.51.100.x is TEST-NET-2 and is never routed anywhere.
	fx := deployFixture{
		MyDevice: entity.NetworkDevice{
			Name: "lab-80E-granted", Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.1", APIPort: 443, Port: 22, Status: "active",
		},
		TheirDevice: entity.NetworkDevice{
			Name: "prod-ungranted", Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.2", APIPort: 443, Port: 22, Status: "active",
		},
	}
	for _, d := range []*entity.NetworkDevice{&fx.MyDevice, &fx.TheirDevice} {
		if err := db.Create(d).Error; err != nil {
			t.Fatalf("create device %s: %v", d.Name, err)
		}
	}

	// The one grant in this world.
	if err := db.Create(&entity.UserDeviceAccess{
		AppUserID: deployGrantedUserID, NetworkDeviceID: fx.MyDevice.ID, GrantedByID: deployAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}

	fx.MyBackup = entity.ConfigBackup{
		NetworkDeviceID: fx.MyDevice.ID,
		Content:         deployValidConfigHdr + "config system global\nset hostname lab-80E\nend\n",
		Lines:           4, SizeBytes: 64,
	}
	fx.TheirBackup = entity.ConfigBackup{
		NetworkDeviceID: fx.TheirDevice.ID,
		Content:         deployValidConfigHdr + "config system global\nset hostname prod\nend\n",
		Lines:           4, SizeBytes: 64,
	}
	// A row with no config text at all. loadRollbackTarget answers that with a 400, and the 400 is
	// what tells a caller the row exists — which is why the access check has to come first.
	fx.TheirEmptyBak = entity.ConfigBackup{NetworkDeviceID: fx.TheirDevice.ID, Content: ""}
	for _, b := range []*entity.ConfigBackup{&fx.MyBackup, &fx.TheirBackup, &fx.TheirEmptyBak} {
		if err := db.Create(b).Error; err != nil {
			t.Fatalf("create backup: %v", err)
		}
	}

	fx.MyDeploy = entity.ConfigDeploy{CommandText: ownDeployCmd, Mode: "query", Status: "SUCCESS", TotalDevices: 1}
	fx.TheirDeploy = entity.ConfigDeploy{CommandText: otherDeployCmd, Mode: "query", Status: "SUCCESS", TotalDevices: 1}
	fx.MixedDeploy = entity.ConfigDeploy{CommandText: otherDeployCmd + " (mixed)", Mode: "config", Status: "SUCCESS", TotalDevices: 2}
	fx.ChildlessDeploy = entity.ConfigDeploy{CommandText: otherDeployCmd + " (childless)", Mode: "config", Status: "FAILED"}
	for _, d := range []*entity.ConfigDeploy{&fx.MyDeploy, &fx.TheirDeploy, &fx.MixedDeploy, &fx.ChildlessDeploy} {
		if err := db.Create(d).Error; err != nil {
			t.Fatalf("create deploy: %v", err)
		}
	}
	for _, r := range []entity.ConfigDeployResult{
		{ConfigDeployID: fx.MyDeploy.ID, NetworkDeviceID: fx.MyDevice.ID,
			DeviceName: fx.MyDevice.Name, Status: "SUCCESS", Output: ownDeviceOutput},
		{ConfigDeployID: fx.TheirDeploy.ID, NetworkDeviceID: fx.TheirDevice.ID,
			DeviceName: fx.TheirDevice.Name, Status: "SUCCESS", Output: otherDeviceOutput},
		{ConfigDeployID: fx.MixedDeploy.ID, NetworkDeviceID: fx.MyDevice.ID,
			DeviceName: fx.MyDevice.Name, Status: "SUCCESS", Output: ownDeviceOutput},
		{ConfigDeployID: fx.MixedDeploy.ID, NetworkDeviceID: fx.TheirDevice.ID,
			DeviceName: fx.TheirDevice.Name, Status: "SUCCESS", Output: otherDeviceOutput},
	} {
		if err := db.Create(&r).Error; err != nil {
			t.Fatalf("create deploy result: %v", err)
		}
	}

	return fx
}

// ── request helpers ─────────────────────────────────────────────────────────

func backupRequest(method, path string, backupID uint, userID uint, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	url := fmt.Sprintf("/backups/%d/%s", backupID, path)
	if body == "" {
		c.Request = httptest.NewRequest(method, url, nil)
	} else {
		c.Request = httptest.NewRequest(method, url, strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
	}
	c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(backupID)}}
	c.Set("user_id", userID)
	c.Set("user_role", role)
	return c, rec
}

func deployRequest(method, url string, params gin.Params, userID uint, role string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, url, nil)
	c.Params = params
	c.Set("user_id", userID)
	c.Set("user_role", role)
	return c, rec
}

// noCredentialStop is the message from services.ResolveDeviceLogin's failure, which is the step
// immediately after the access check and the last one before a socket would be opened. Seeing it
// means the caller was let through; not seeing it on a 404 means the refusal came first.
const noCredentialStop = "no usable credential for this device"

func countDeploys(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := config.DB().Model(&entity.ConfigDeploy{}).Count(&n).Error; err != nil {
		t.Fatalf("count deploys: %v", err)
	}
	return n
}

// ── Hole 1: rollback ────────────────────────────────────────────────────────

// The hole itself. An operator may deploy, so canDeploy lets them in; nothing then asked whether
// this particular firewall was ever granted to them. 404 rather than 403, and worded exactly like
// a missing backup, so the inventory cannot be enumerated by backup id.
func TestRollbackRefusesABackupFromAnUngrantedDevice(t *testing.T) {
	fx := setupDeployAccess(t)
	before := countDeploys(t)

	c, rec := backupRequest(http.MethodPost, "rollback", fx.TheirBackup.ID,
		deployUngrantedUser, deployOperatorRole, `{"confirm":true}`)
	Rollback(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — an operator with no grant for %q must not be able to "+
			"reboot it, and 403 would confirm the firewall exists: %s",
			rec.Code, fx.TheirDevice.Name, rec.Body.String())
	}
	body := rec.Body.String()
	// The refusal must not leak the device, nor reach the credential step, nor leave an audit row
	// claiming a restore was attempted.
	for _, leak := range []string{fx.TheirDevice.Name, fx.TheirDevice.MgmtIP, noCredentialStop, "FGT80E"} {
		if strings.Contains(body, leak) {
			t.Errorf("the 404 carries %q — the handler got further than the access check:\n%s", leak, body)
		}
	}
	if got := countDeploys(t); got != before {
		t.Errorf("deploy rows went %d → %d: the refusal happened AFTER the audit row was written", before, got)
	}
}

// The other half: the same role, on the firewall that WAS granted, gets through. It is stopped one
// step later, at the credential lookup, which is the first step on the way to the device — so this
// pins both "allowed through" and "the access check is the step before the device".
func TestRollbackServesTheOperatorTheDeviceWasGrantedTo(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := backupRequest(http.MethodPost, "rollback", fx.MyBackup.ID,
		deployGrantedUserID, deployOperatorRole, `{"confirm":true}`)
	Rollback(c)

	if rec.Code == http.StatusNotFound {
		t.Fatalf("a granted operator was told the backup does not exist: %s", rec.Body.String())
	}
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), noCredentialStop) {
		t.Fatalf("status = %d body = %s; want 400 %q — past the access check and stopped at the "+
			"credential lookup, the step before any socket is opened",
			rec.Code, rec.Body.String(), noCredentialStop)
	}
}

// An admin holds every device by the rule in services/deviceaccess.go — they can edit and delete
// the devices themselves, so a grant table that hid one from them would be theatre. The new check
// must not have cost them that.
func TestRollbackDoesNotBlockAnAdmin(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := backupRequest(http.MethodPost, "rollback", fx.TheirBackup.ID,
		deployAdminUserID, deployAdminUserRole, `{"confirm":true}`)
	Rollback(c)

	if rec.Code == http.StatusNotFound {
		t.Fatalf("an admin was refused a backup of %q: %s", fx.TheirDevice.Name, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), noCredentialStop) {
		t.Fatalf("status = %d body = %s; an admin should reach the credential lookup",
			rec.Code, rec.Body.String())
	}
}

// The ordering, observable rather than argued. A backup row with no config text answers 400
// ("backup นี้ไม่มีเนื้อ config ให้ย้อนกลับ") — which is itself a statement that the row exists. An
// ungranted caller must get the same 404 as for any other backup of that firewall, while an admin
// does see the 400. If the access check ever slides below the content check, this test goes red.
func TestAnUngrantedCallerCannotTellAnEmptyBackupFromAMissingOne(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := backupRequest(http.MethodPost, "rollback", fx.TheirEmptyBak.ID,
		deployUngrantedUser, deployOperatorRole, `{"confirm":true}`)
	Rollback(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: a 400 tells an ungranted caller that backup #%d exists: %s",
			rec.Code, fx.TheirEmptyBak.ID, rec.Body.String())
	}

	// Same row, an admin: the 400 proves the content check is still there and still after the
	// access check, rather than the 404 above coming from something unrelated.
	c, rec = backupRequest(http.MethodPost, "rollback", fx.TheirEmptyBak.ID,
		deployAdminUserID, deployAdminUserRole, `{"confirm":true}`)
	Rollback(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("admin on the empty backup: status = %d, want 400 from the content check: %s",
			rec.Code, rec.Body.String())
	}
}

// loadRollbackTarget is the single door, so the gate is pinned on the door itself and not only
// through one handler: anything added to this package that calls it inherits the check.
func TestLoadRollbackTargetIsTheChokepoint(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := backupRequest(http.MethodPost, "rollback", fx.TheirBackup.ID,
		deployUngrantedUser, deployOperatorRole, "")
	backup, device, content, ok := loadRollbackTarget(c)
	if ok || backup != nil || device != nil || content != "" {
		t.Fatalf("loadRollbackTarget handed an ungranted caller backup=%v device=%v content=%q",
			backup, device, content)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}

	c, rec = backupRequest(http.MethodPost, "rollback", fx.MyBackup.ID,
		deployGrantedUserID, deployOperatorRole, "")
	backup, device, content, ok = loadRollbackTarget(c)
	if !ok {
		t.Fatalf("loadRollbackTarget refused the granted operator: %d %s", rec.Code, rec.Body.String())
	}
	if device.ID != fx.MyDevice.ID || backup.ID != fx.MyBackup.ID {
		t.Fatalf("resolved backup #%d on device #%d, want #%d on #%d",
			backup.ID, device.ID, fx.MyBackup.ID, fx.MyDevice.ID)
	}

	// It is also the single place the stored configuration is DECRYPTED, and the plaintext it
	// returns — not backup.Content — is what the handlers send to the firewall. A restore replaces
	// the whole configuration and reboots the unit, so a door that handed back ciphertext, or an
	// empty string, would brick it.
	if content == "" {
		t.Fatal("loadRollbackTarget returned no configuration for a backup that has one")
	}
	if !strings.HasPrefix(content, "#config-version") {
		t.Fatalf("the configuration handed to the restore is not a configuration file: %q", content)
	}
}

// RollbackPreview shares the door, so it is scoped by the same change — worth pinning separately
// because it is the handler that reports the device's name, model and the backup's size, and it is
// a GET, so it is the one an ungranted caller would reach for first.
func TestRollbackPreviewIsScopedByTheSameCheck(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := backupRequest(http.MethodGet, "rollback-preview", fx.TheirBackup.ID,
		deployUngrantedUser, deployOperatorRole, "")
	RollbackPreview(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), fx.TheirDevice.Name) {
		t.Errorf("the preview named %q to a caller who was never granted it:\n%s",
			fx.TheirDevice.Name, rec.Body.String())
	}

	c, rec = backupRequest(http.MethodGet, "rollback-preview", fx.MyBackup.ID,
		deployGrantedUserID, deployOperatorRole, "")
	RollbackPreview(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("granted operator: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), fx.MyDevice.Name) {
		t.Errorf("the preview of the caller's own device does not name it:\n%s", rec.Body.String())
	}
}

// ── Hole 2: the deploy history ──────────────────────────────────────────────

// List returned the newest 100 rows to everybody. It must now return only the deploys whose
// devices the caller holds.
func TestListShowsOnlyTheCallersOwnDeploys(t *testing.T) {
	setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys", nil, deployGrantedUserID, deployPlainUserRole)
	List(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, ownDeployCmd) {
		t.Errorf("the caller's own deploy is missing from their history:\n%s", body)
	}
	if strings.Contains(body, otherDeployCmd) {
		t.Errorf("the history carries a deploy against a firewall the caller was never granted:\n%s", body)
	}
}

// A user holding no grants at all sees an empty history, never the fleet's. "No grants" must not
// collapse into "no filter" — that is how this kind of check quietly stops existing.
func TestListShowsNothingToAUserWithNoGrants(t *testing.T) {
	setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys", nil, deployUngrantedUser, deployPlainUserRole)
	List(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with an empty list: %s", rec.Code, rec.Body.String())
	}
	for _, leak := range []string{ownDeployCmd, otherDeployCmd} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Fatalf("a user with no grants was shown %q:\n%s", leak, rec.Body.String())
		}
	}
}

func TestListShowsEveryDeployToAnAdmin(t *testing.T) {
	setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys", nil, deployAdminUserID, deployAdminUserRole)
	List(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	for _, want := range []string{ownDeployCmd, otherDeployCmd, "(mixed)", "(childless)"} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("an admin's history is missing %q — the scope must not filter an admin:\n%s",
				want, rec.Body.String())
		}
	}
}

// Get loaded any deploy by id with Preload("Results"). A ConfigDeployResult.Output is the raw CLI
// the firewall printed, so this is the row that actually leaked a configuration.
func TestGetRefusesADeployAgainstAnUngrantedDevice(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.TheirDeploy.ID)}}, deployGrantedUserID, deployPlainUserRole)
	Get(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (never 403, never a partial row): %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	// Spelled out so a regression is unmistakable: this is what the row would have shown.
	for _, leak := range []string{otherDeviceOutput, otherDeployCmd, fx.TheirDevice.Name} {
		if strings.Contains(body, leak) {
			t.Fatalf("the refusal still carried %q — that is the raw CLI output of a firewall the "+
				"caller was never granted:\n%s", leak, body)
		}
	}
}

func TestGetServesTheCallersOwnDeployWithItsResults(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.MyDeploy.ID)}}, deployGrantedUserID, deployPlainUserRole)
	Get(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for the caller's own deploy: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), ownDeviceOutput) {
		t.Errorf("the deploy came back without its own results:\n%s", rec.Body.String())
	}
}

// A deploy that touched one granted and one ungranted firewall. Stripping the ungranted children
// out would answer with a row that misreports what the deploy did, so the whole deploy is not the
// caller's — 404, with neither device's output in the body.
func TestGetRefusesADeployThatStraddlesTheGrantBoundary(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.MixedDeploy.ID)}}, deployGrantedUserID, deployPlainUserRole)
	Get(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a partially visible deploy is not the caller's: %s",
			rec.Code, rec.Body.String())
	}
	for _, leak := range []string{otherDeviceOutput, ownDeviceOutput} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Fatalf("the refusal carried %q, so the row was partly rendered:\n%s", leak, rec.Body.String())
		}
	}

	// An admin sees the whole thing, both devices included.
	c, rec = deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.MixedDeploy.ID)}}, deployAdminUserID, deployAdminUserRole)
	Get(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin on the mixed deploy: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	for _, want := range []string{otherDeviceOutput, ownDeviceOutput} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("an admin's view of the mixed deploy is missing %q:\n%s", want, rec.Body.String())
		}
	}
}

func TestGetServesAnyDeployToAnAdmin(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.TheirDeploy.ID)}}, deployAdminUserID, deployAdminUserRole)
	Get(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — an admin is not filtered: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), otherDeviceOutput) {
		t.Errorf("an admin's view came back without the results:\n%s", rec.Body.String())
	}
}

// A deploy whose per-device rows were never written (it failed before them) has no device to scope
// it by. It is therefore invisible to a non-admin: fail closed, and there is no device output in
// such a row to miss.
func TestAChildlessDeployIsNotVisibleToANonAdmin(t *testing.T) {
	fx := setupDeployAccess(t)

	c, rec := deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.ChildlessDeploy.ID)}}, deployGrantedUserID, deployPlainUserRole)
	Get(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a deploy with no device rows: %s", rec.Code, rec.Body.String())
	}

	c, rec = deployRequest(http.MethodGet, "/config-deploys/x",
		gin.Params{{Key: "id", Value: fmt.Sprint(fx.ChildlessDeploy.ID)}}, deployAdminUserID, deployAdminUserRole)
	Get(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

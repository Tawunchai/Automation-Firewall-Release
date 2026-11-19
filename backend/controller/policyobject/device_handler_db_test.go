package policyobject

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// A device-proxy handler, end to end, with no firewall anywhere.
//
// This is what the seam in device_session.go was for. A handler here runs its REAL decisions — the
// per-user access check, which stored credential to log in as, the read-only refusal, the mapping
// of what the firewall said onto an HTTP status — while the device itself is a stub that answers
// from the test. Before the seam there was no way to write any of this: buildClient returned a
// concrete *services.FortiClient, so reaching a handler meant reaching a real FortiGate, and ten
// handler files in this package sat at exactly 0.0%.
//
// The access check and the credential lookup are the half that needs a database, so these tests
// follow the convention already set by services/retention_db_test.go: skipped unless an env var
// names a Postgres they may freely create tables in. Point it at a throwaway container, never at
// the console's own database:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name policyobject-pg postgres:16-alpine
//	POLICYOBJECT_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/policyobject/ -run TestDeviceHandler -v

const (
	testAdminUserID = uint(1)
	testPlainUserID = uint(2)
	// A real 32-byte key, so EncryptSecret works. It guards nothing: the only secret it ever
	// protects is the literal below it, in a database this test creates and drops.
	testCredKey = "9f2c4b1ea77d3568bb0c41d9e5a6f30c9f2c4b1ea77d3568bb0c41d9e5a6f30c"
)

// handlerTestDevice brings up the schema these handlers touch and returns a device to aim at.
func handlerTestDevice(t *testing.T) entity.NetworkDevice {
	t.Helper()

	dsn := os.Getenv("POLICYOBJECT_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("POLICYOBJECT_DB_TEST_DSN not set — see the note at the top of device_handler_db_test.go")
	}

	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("CRED_ENC_KEY", testCredKey)
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	// Only the tables the device-proxy session layer reads. Not config.SetupDatabase(), which
	// migrates all 33 and seeds them: this test is about a handler, not about the schema.
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{}, &entity.DeviceCredential{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	// Start from empty every time, so one test's grant cannot make another test's refusal pass.
	for _, table := range []string{"user_device_accesses", "device_credentials", "network_devices", "app_users", "app_roles"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// user_device_accesses carries a foreign key to app_users, so the two accounts these tests
	// grant and refuse have to be real rows — a grant for a user id that does not exist is
	// rejected by the database, not by the code under test.
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

	enc, err := platform.EncryptSecret("not-a-real-password")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	// The shared device account (ResolveAutomationLogin step 2) — the simplest login that resolves
	// without a per-user credential row, which keeps these tests about the handler.
	device := entity.NetworkDevice{
		Name: "FortiGate-80E-stub", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.1", APIPort: 443, Status: "active",
		Username: "admin", PasswordEnc: enc,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	return device
}

// deviceRequest aims a handler at one device as one user, the way the router would.
func deviceRequest(t *testing.T, method, tail string, deviceID uint, userID uint, role string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	return deviceJSONRequest(t, method, tail, deviceID, userID, role, "")
}

// deviceJSONRequest is deviceRequest for a WRITE: it carries a JSON body, and any extra route
// params the handler reads out of the path itself (:name, :policyId, :category).
//
// The path and the params have to agree, because two different things read them: the handler reads
// c.Param, while getDeviceInfo's read-only check reads the real URL (deviceRouteTail →
// services.ResolveChangeTarget). A test that set only the param would be exercising the handler
// against a route the change classifier does not recognise, and the read-only refusal it is
// supposed to prove would quietly not apply.
func deviceJSONRequest(
	t *testing.T,
	method, tail string,
	deviceID uint, userID uint, role string,
	body string,
	params ...gin.Param,
) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	idStr := itoa(deviceID)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	c.Request = httptest.NewRequest(method, "/policy/device/"+idStr+"/"+tail, reader)
	if body != "" {
		c.Request.Header.Set("Content-Type", "application/json")
	}

	c.Params = append(gin.Params{{Key: "deviceId", Value: idStr}}, params...)
	c.Set("user_id", userID)
	c.Set("user_role", role)
	return c, rec
}

// grantDevice gives testPlainUserID access to one device, which is what makes the difference
// between the 404 an ungranted user gets and the handler actually running.
func grantDevice(t *testing.T, deviceID uint) {
	t.Helper()
	if err := config.DB().Create(&entity.UserDeviceAccess{
		AppUserID: testPlainUserID, NetworkDeviceID: deviceID, GrantedByID: testAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}
}

func itoa(u uint) string {
	if u == 0 {
		return "0"
	}
	var b []byte
	for u > 0 {
		b = append([]byte{byte('0' + u%10)}, b...)
		u /= 10
	}
	return string(b)
}

// ── the happy path ──────────────────────────────────────────────────────────

func TestDeviceHandlerServesWhatTheFirewallAnswered(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{
		addresses: []services.FGAddress{{Name: "LAN-10.0.0.0"}, {Name: "DMZ-host"}},
		policies:  []services.FGPolicy{{PolicyID: 1, SrcAddr: []services.FGName{{Name: "LAN-10.0.0.0"}}}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	DeviceListAddresses(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{"LAN-10.0.0.0", "DMZ-host"} {
		if !strings.Contains(body, want) {
			t.Errorf("the answer does not carry %q:\n%s", want, body)
		}
	}
}

// ── the access check, which is the point of the chokepoint ──────────────────

// A user with no grant for this device is told the device does not exist, not that they may not
// have it: 404 rather than 403, so the console does not confirm the existence of firewalls a user
// was never given.
func TestDeviceHandlerRefusesAUserWithNoGrant(t *testing.T) {
	device := handlerTestDevice(t)
	// The stub would answer happily if the handler ever got that far. It must not.
	withDeviceClient(t, &stubClient{addresses: []services.FGAddress{{Name: "LEAKED"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testPlainUserID, "user")
	DeviceListAddresses(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "LEAKED") {
		t.Fatal("the handler reached the device for a user who was never granted it")
	}
}

func TestDeviceHandlerServesAUserWhoWasGrantedTheDevice(t *testing.T) {
	device := handlerTestDevice(t)
	if err := config.DB().Create(&entity.UserDeviceAccess{
		AppUserID: testPlainUserID, NetworkDeviceID: device.ID, GrantedByID: testAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}
	withDeviceClient(t, &stubClient{addresses: []services.FGAddress{{Name: "LAN-10.0.0.0"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testPlainUserID, "user")
	DeviceListAddresses(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a granted user: %s", rec.Code, rec.Body.String())
	}
}

func TestDeviceHandlerRefusesADeviceThatIsNotThere(t *testing.T) {
	handlerTestDevice(t)
	withDeviceClient(t, &stubClient{}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", 9999, testAdminUserID, "admin")
	DeviceListAddresses(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// ── what the firewall said, through a real handler ──────────────────────────

// The error contract, proven where it actually matters: not on respondDeviceError in isolation, but
// on a handler answering a request. A -5 must reach the client as 409 with fortios_code -5, because
// fortiosError.ts compares that number and has no text fallback.
func TestDeviceHandlerPassesTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{
		addressesErr: &services.DeviceError{
			Code: services.FGErrDuplicate, HTTPStatus: 500, Text: "duplicate entry",
		},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	DeviceListAddresses(c)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got := body["fortios_code"]; got != float64(services.FGErrDuplicate) {
		t.Fatalf("fortios_code = %v, want %d", got, services.FGErrDuplicate)
	}
}

// A device that never answered is the one case 502 is right for — and it must not arrive carrying a
// fortios_code, or the client would read it as a refusal the firewall never made.
func TestDeviceHandlerReportsAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{addressesErr: errTransport{}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	DeviceListAddresses(c)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "fortios_code") {
		t.Fatalf("a transport failure carried a device code:\n%s", rec.Body.String())
	}
}

// ── the read-only role ──────────────────────────────────────────────────────

// A read-only account may see every page a normal user can and change none of them. The refusal is
// 403 and it happens before the device is touched at all.
func TestDeviceHandlerRefusesAWriteFromAReadOnlyAccount(t *testing.T) {
	device := handlerTestDevice(t)
	if err := config.DB().Create(&entity.UserDeviceAccess{
		AppUserID: testPlainUserID, NetworkDeviceID: device.ID, GrantedByID: testAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}
	withDeviceClient(t, &stubClient{}, nil)

	c, rec := deviceRequest(t, http.MethodPost, "addresses", device.ID, testPlainUserID, "readonly")
	di, ok := getDeviceInfo(c)

	if ok {
		t.Fatalf("getDeviceInfo allowed a write from a read-only account (device %q)", di.Device.Name)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

// The same account on a READ is allowed — that is what makes the role useful rather than a lockout.
func TestDeviceHandlerAllowsAReadFromAReadOnlyAccount(t *testing.T) {
	device := handlerTestDevice(t)
	if err := config.DB().Create(&entity.UserDeviceAccess{
		AppUserID: testPlainUserID, NetworkDeviceID: device.ID, GrantedByID: testAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant access: %v", err)
	}
	withDeviceClient(t, &stubClient{addresses: []services.FGAddress{{Name: "LAN-10.0.0.0"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testPlainUserID, "readonly")
	DeviceListAddresses(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a read-only READ: %s", rec.Code, rec.Body.String())
	}
}

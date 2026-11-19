package automationjob

import (
	"encoding/json"
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

// Per-user device access on the job history and on the dashboard overview.
//
// Two holes, both on the paths that answer about MANY devices at once — the same way BackupBatch's
// went missing while its single-device sibling TriggerBackup always checked:
//
//	GET /jobs      — the most recent N AutomationJob rows for everybody, Preload("NetworkDevice").
//	                 A job carries the Result the worker produced and the preload hands over the
//	                 device row with it, so any signed-in account learned which firewalls exist and
//	                 what happened on them.
//	GET /jobs/:id  — any job by a sequential id off the URL, with no check at all.
//	GET /network/  — four raw-SQL aggregates over network_devices / automation_jobs /
//	       overview    config_backups with no scoping, so a user granted ONE firewall saw
//	                 fleet-wide counts: how many devices exist, their statuses, how many have
//	                 never been backed up, the total size of every stored configuration.
//
// These are real end-to-end tests rather than the source-reading compromise of
// batch_backup_scope_test.go, because the whole question here is which ROWS come back — scoping
// that lives inside the SQL GORM builds, and inside raw SQL. That needs a database, so they follow
// the convention set by controller/policyobject/device_handler_db_test.go and
// services/retention_db_test.go: skipped unless an env var names a Postgres they may freely create
// and truncate tables in. Point it at a throwaway container, NEVER at the console's own database:
//
//	docker run --rm -d -p 55439:5432 -e POSTGRES_PASSWORD=test --name jobs-pg postgres:16-alpine
//	AUTOMATIONJOB_DB_TEST_DSN="host=localhost port=55439 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/automationjob/ -cover -v
//	docker rm -f jobs-pg

const (
	jobsAdminUserID = uint(1)
	jobsPlainUserID = uint(2)
	// A third real account, granted nothing — the fail-closed case. "No grants" must mean "no
	// rows", never "all rows", which is how a filter like this quietly stops existing.
	jobsUngrantedUserID = uint(3)

	// Device B stands for the firewall this hole actually exposed, and its strings are
	// recognisable on purpose: if any of them appears in a response, something leaked.
	deviceBName = "Firewall-Real"
	jobBResult  = "FAILED: set psksecret ENC LEAKED-FROM-FIREWALL-REAL"
	jobAResult  = "backup ok — +4/-1 lines"
)

// scopeFixture is the two-device world every test below asserts against: device A granted to the
// plain user, device B granted to nobody but reachable by an admin.
type scopeFixture struct {
	deviceA, deviceB entity.NetworkDevice
	jobA, jobB       entity.AutomationJob
}

// jobsScopeFixture brings up the schema these handlers touch and seeds that world.
func jobsScopeFixture(t *testing.T) scopeFixture {
	t.Helper()

	dsn := os.Getenv("AUTOMATIONJOB_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("AUTOMATIONJOB_DB_TEST_DSN not set — see the note at the top of jobs_scope_db_test.go")
	}

	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	// Only the tables these handlers read. Not config.SetupDatabase(), which migrates all of them
	// and seeds: this is about two handlers, not about the schema.
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.NetworkDevice{}, &entity.UserDeviceAccess{},
		&entity.AutomationJob{}, &entity.ConfigBackup{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	// Start from empty every time, so one test's grant cannot make another test's refusal pass.
	for _, table := range []string{
		"user_device_accesses", "config_backups", "automation_jobs",
		"network_devices", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// user_device_accesses carries a foreign key to app_users, so the accounts these tests grant
	// and refuse have to be real rows — a grant for a user id that does not exist is rejected by
	// the database, not by the code under test.
	role := entity.AppRole{Role: "admin"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	for _, u := range []entity.AppUser{
		{Email: "admin@test.invalid", Password: "x", FirstName: "Test", LastName: "Admin", AppRoleID: role.ID},
		{Email: "user@test.invalid", Password: "x", FirstName: "Test", LastName: "User", AppRoleID: role.ID},
		{Email: "nobody@test.invalid", Password: "x", FirstName: "Test", LastName: "Nobody", AppRoleID: role.ID},
	} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Email, err)
		}
	}

	// Same vendor (this platform only speaks to Fortinet) but different statuses, so the overview's
	// by_status breakdown shows whether device B leaked: a caller who may not reach it must not see
	// an "inactive" bucket at all, not merely a smaller total.
	fx := scopeFixture{
		deviceA: entity.NetworkDevice{
			Name: "lab-fgt-80e", Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.1", Port: 22, APIPort: 443, Status: "active",
			BackupEnabled: true,
		},
		deviceB: entity.NetworkDevice{
			Name: deviceBName, Vendor: "fortinet", Platform: "fortinet",
			MgmtIP: "198.51.100.254", Port: 22, APIPort: 443, Status: "inactive",
			BackupEnabled: true,
		},
	}
	for _, d := range []*entity.NetworkDevice{&fx.deviceA, &fx.deviceB} {
		if err := db.Create(d).Error; err != nil {
			t.Fatalf("create device %s: %v", d.Name, err)
		}
	}

	// One job each, with different statuses for the same reason as the device statuses above.
	fx.jobA = entity.AutomationJob{
		Type: "backup", Status: "SUCCESS", NetworkDeviceID: fx.deviceA.ID,
		TriggeredBy: "user@test.invalid", Result: jobAResult,
	}
	fx.jobB = entity.AutomationJob{
		Type: "backup", Status: "FAILED", NetworkDeviceID: fx.deviceB.ID,
		TriggeredBy: "admin@test.invalid", Result: jobBResult,
	}
	for _, j := range []*entity.AutomationJob{&fx.jobA, &fx.jobB} {
		if err := db.Create(j).Error; err != nil {
			t.Fatalf("create job: %v", err)
		}
	}

	// Different sizes, so the overview's total_size_bytes cannot accidentally agree.
	for _, b := range []entity.ConfigBackup{
		{NetworkDeviceID: fx.deviceA.ID, AutomationJobID: fx.jobA.ID, SizeBytes: 1000, Lines: 10},
		{NetworkDeviceID: fx.deviceB.ID, AutomationJobID: fx.jobB.ID, SizeBytes: 7000, Lines: 70},
	} {
		if err := db.Create(&b).Error; err != nil {
			t.Fatalf("create backup: %v", err)
		}
	}

	// The one grant in this world: the plain user holds device A and nothing else.
	if err := db.Create(&entity.UserDeviceAccess{
		AppUserID: jobsPlainUserID, NetworkDeviceID: fx.deviceA.ID, GrantedByID: jobsAdminUserID,
	}).Error; err != nil {
		t.Fatalf("grant device A: %v", err)
	}

	return fx
}

// jobsRequest aims a handler at a URL as one account, the way the router would.
func jobsRequest(t *testing.T, target string, userID uint, role string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	c.Params = append(gin.Params{}, params...)
	c.Set("user_id", userID) // uint, as middleware/authorization.go stamps it
	c.Set("user_role", role)
	return c, rec
}

// listJobsAs calls ListJobs and returns the ids it answered with, plus the raw body.
func listJobsAs(t *testing.T, query string, userID uint, role string) ([]uint, string) {
	t.Helper()
	c, rec := jobsRequest(t, "/jobs"+query, userID, role)
	ListJobs(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("ListJobs status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []entity.AutomationJob `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	ids := make([]uint, 0, len(body.Data))
	for _, j := range body.Data {
		ids = append(ids, j.ID)
	}
	return ids, rec.Body.String()
}

func hasID(ids []uint, want uint) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

// ── GET /jobs ────────────────────────────────────────────────────────────────

// Asserted by id, not by count: a handler that returned "some two rows" would satisfy a count and
// still be the hole.
func TestListJobsShowsOnlyTheDevicesTheCallerWasGranted(t *testing.T) {
	fx := jobsScopeFixture(t)

	ids, body := listJobsAs(t, "", jobsPlainUserID, "user")

	if !hasID(ids, fx.jobA.ID) {
		t.Errorf("the granted device's job #%d is missing from %v", fx.jobA.ID, ids)
	}
	if hasID(ids, fx.jobB.ID) {
		t.Errorf("job #%d on an ungranted device was listed (ids = %v)", fx.jobB.ID, ids)
	}
	// The Preload is half the leak: even without the job row, the device name and IP would be a
	// disclosure of which firewalls this platform manages.
	for _, leak := range []string{deviceBName, jobBResult, "198.51.100.254"} {
		if strings.Contains(body, leak) {
			t.Errorf("the response carries %q:\n%s", leak, body)
		}
	}
}

func TestListJobsShowsEveryDeviceToAnAdmin(t *testing.T) {
	fx := jobsScopeFixture(t)

	ids, body := listJobsAs(t, "", jobsAdminUserID, "admin")

	if !hasID(ids, fx.jobA.ID) || !hasID(ids, fx.jobB.ID) {
		t.Fatalf("an admin must see both jobs (#%d and #%d), got %v", fx.jobA.ID, fx.jobB.ID, ids)
	}
	if !strings.Contains(body, deviceBName) {
		t.Errorf("the admin's list lost the device preload:\n%s", body)
	}
}

// The scope has to compose with the handler's own device_id filter rather than being an either/or:
// asking for an ungranted device by name must answer with nothing, not with that device's history.
func TestListJobsDeviceFilterCannotCrossTheGrant(t *testing.T) {
	fx := jobsScopeFixture(t)

	ids, body := listJobsAs(t, "?device_id="+strconv.Itoa(int(fx.deviceB.ID)), jobsPlainUserID, "user")

	if len(ids) != 0 {
		t.Errorf("?device_id=<ungranted> answered with %v, want nothing", ids)
	}
	if strings.Contains(body, jobBResult) {
		t.Errorf("the response carries the ungranted device's job result:\n%s", body)
	}
}

// Granted nothing means no rows — not every row, which is the direction this kind of filter fails
// in when it is written as "if there are no ids, skip the filter".
func TestListJobsIsEmptyForACallerWithNoGrants(t *testing.T) {
	jobsScopeFixture(t)

	ids, _ := listJobsAs(t, "", jobsUngrantedUserID, "user")

	if len(ids) != 0 {
		t.Errorf("a caller with no grants was shown %v", ids)
	}
}

// ── GET /jobs/:id ────────────────────────────────────────────────────────────

func TestGetJobIsNotFoundForADeviceTheCallerWasNotGranted(t *testing.T) {
	fx := jobsScopeFixture(t)

	c, rec := jobsRequest(t, "/jobs/2", jobsPlainUserID, "user",
		gin.Param{Key: "id", Value: strconv.Itoa(int(fx.jobB.ID))})
	GetJob(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (never 403 — which firewalls exist is not public): %s",
			rec.Code, rec.Body.String())
	}
	for _, leak := range []string{jobBResult, deviceBName, "198.51.100.254", "FAILED"} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("the refusal carries %q:\n%s", leak, rec.Body.String())
		}
	}
}

// The refusal and the genuine miss must be indistinguishable, or the status code still answers
// "does job #N exist?" for anybody willing to walk 1..N.
func TestGetJobRefusalLooksExactlyLikeAMissingJob(t *testing.T) {
	fx := jobsScopeFixture(t)

	ungranted, rec1 := jobsRequest(t, "/jobs/2", jobsPlainUserID, "user",
		gin.Param{Key: "id", Value: strconv.Itoa(int(fx.jobB.ID))})
	GetJob(ungranted)

	missing, rec2 := jobsRequest(t, "/jobs/999999", jobsPlainUserID, "user",
		gin.Param{Key: "id", Value: "999999"})
	GetJob(missing)

	if rec1.Code != rec2.Code || rec1.Body.String() != rec2.Body.String() {
		t.Errorf("ungranted job answered %d %s, missing job answered %d %s — they must match",
			rec1.Code, rec1.Body.String(), rec2.Code, rec2.Body.String())
	}
}

func TestGetJobServesAJobOnAGrantedDevice(t *testing.T) {
	fx := jobsScopeFixture(t)

	c, rec := jobsRequest(t, "/jobs/1", jobsPlainUserID, "user",
		gin.Param{Key: "id", Value: strconv.Itoa(int(fx.jobA.ID))})
	GetJob(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a granted device: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), jobAResult) {
		t.Errorf("the answer does not carry the job result:\n%s", rec.Body.String())
	}
}

func TestGetJobServesEitherJobToAnAdmin(t *testing.T) {
	fx := jobsScopeFixture(t)

	c, rec := jobsRequest(t, "/jobs/2", jobsAdminUserID, "admin",
		gin.Param{Key: "id", Value: strconv.Itoa(int(fx.jobB.ID))})
	GetJob(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for an admin: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), jobBResult) {
		t.Errorf("an admin must still get the whole job:\n%s", rec.Body.String())
	}
}

// ── GET /network/overview ────────────────────────────────────────────────────

// overviewAs calls NetworkOverview and returns the decoded response.
func overviewAs(t *testing.T, userID uint, role string) map[string]any {
	t.Helper()
	c, rec := jobsRequest(t, "/network/overview", userID, role)
	NetworkOverview(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("NetworkOverview status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	return body
}

// num reads a nested number out of the overview, failing with the path rather than a nil panic.
func num(t *testing.T, body map[string]any, path ...string) float64 {
	t.Helper()
	cur := any(body)
	for i, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("%v is not an object at %q", path[:i], key)
		}
		cur, ok = m[key]
		if !ok {
			t.Fatalf("the overview has no %v", path[:i+1])
		}
	}
	f, ok := cur.(float64)
	if !ok {
		t.Fatalf("%v = %#v, want a number", path, cur)
	}
	return f
}

func obj(t *testing.T, body map[string]any, path ...string) map[string]any {
	t.Helper()
	cur := any(body)
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("%v is not an object", path)
		}
		cur = m[key]
	}
	m, ok := cur.(map[string]any)
	if !ok {
		t.Fatalf("%v = %#v, want an object", path, cur)
	}
	return m
}

// Every aggregate is the caller's estate, not the fleet's. Two devices, one granted — so every
// figure that comes back must be device A's alone, and device B must not be visible even as a
// bucket key or a byte count.
func TestNetworkOverviewCountsOnlyTheCallersDevices(t *testing.T) {
	fx := jobsScopeFixture(t)

	body := overviewAs(t, jobsPlainUserID, "user")

	if got := num(t, body, "devices", "total"); got != 1 {
		t.Errorf("devices.total = %v, want 1 (device A only)", got)
	}
	if got := num(t, body, "devices", "backup_enabled"); got != 1 {
		t.Errorf("devices.backup_enabled = %v, want 1", got)
	}
	// The breakdowns must not even carry device B's bucket: a key is a disclosure of its own.
	if byStatus := obj(t, body, "devices", "by_status"); byStatus["active"] != float64(1) || byStatus["inactive"] != nil {
		t.Errorf("devices.by_status = %#v, want {active:1} with no inactive bucket", byStatus)
	}
	if byVendor := obj(t, body, "devices", "by_vendor"); byVendor["fortinet"] != float64(1) {
		t.Errorf("devices.by_vendor = %#v, want {fortinet:1}", byVendor)
	}
	if got := num(t, body, "jobs", "total"); got != 1 {
		t.Errorf("jobs.total = %v, want 1", got)
	}
	if byStatus := obj(t, body, "jobs", "by_status"); byStatus["SUCCESS"] != float64(1) || byStatus["FAILED"] != nil {
		t.Errorf("jobs.by_status = %#v, want {SUCCESS:1} — the ungranted device's failure leaked", byStatus)
	}
	if got := num(t, body, "backups", "total"); got != 1 {
		t.Errorf("backups.total = %v, want 1", got)
	}
	if got := num(t, body, "backups", "total_size_bytes"); got != 1000 {
		t.Errorf("backups.total_size_bytes = %v, want 1000 (device B's 7000 is not theirs to count)", got)
	}
	if got := num(t, body, "attention", "never_backed_up"); got != 1 {
		t.Errorf("attention.never_backed_up = %v, want 1", got)
	}

	recent, ok := body["recent_jobs"].([]any)
	if !ok {
		t.Fatalf("recent_jobs = %#v, want an array", body["recent_jobs"])
	}
	if len(recent) != 1 {
		t.Fatalf("recent_jobs has %d entries, want 1: %#v", len(recent), recent)
	}
	if first := recent[0].(map[string]any); first["id"] != float64(fx.jobA.ID) {
		t.Errorf("recent_jobs[0].id = %v, want %d", first["id"], fx.jobA.ID)
	}
	if raw, _ := json.Marshal(body); strings.Contains(string(raw), deviceBName) {
		t.Errorf("the overview names the ungranted device:\n%s", raw)
	}
}

func TestNetworkOverviewIsFleetWideForAnAdmin(t *testing.T) {
	jobsScopeFixture(t)

	body := overviewAs(t, jobsAdminUserID, "admin")

	if got := num(t, body, "devices", "total"); got != 2 {
		t.Errorf("devices.total = %v, want 2 — an admin is never filtered", got)
	}
	if got := num(t, body, "jobs", "total"); got != 2 {
		t.Errorf("jobs.total = %v, want 2", got)
	}
	if got := num(t, body, "backups", "total_size_bytes"); got != 8000 {
		t.Errorf("backups.total_size_bytes = %v, want 8000", got)
	}
	if recent, _ := body["recent_jobs"].([]any); len(recent) != 2 {
		t.Errorf("recent_jobs has %d entries, want 2", len(recent))
	}
	if raw, _ := json.Marshal(body); !strings.Contains(string(raw), deviceBName) {
		t.Errorf("the admin's overview lost a device:\n%s", raw)
	}
}

// No grants means zeros, and the empty shapes the page iterates — not a nil map and not the fleet.
func TestNetworkOverviewIsEmptyForACallerWithNoGrants(t *testing.T) {
	jobsScopeFixture(t)

	body := overviewAs(t, jobsUngrantedUserID, "user")

	for _, path := range [][]string{
		{"devices", "total"}, {"devices", "backup_enabled"},
		{"jobs", "total"}, {"jobs", "last_24h"}, {"jobs", "success_rate"},
		{"backups", "total"}, {"backups", "total_size_bytes"},
		{"attention", "never_backed_up"}, {"attention", "stale"},
	} {
		if got := num(t, body, path...); got != 0 {
			t.Errorf("%v = %v, want 0 for a caller with no grants", path, got)
		}
	}
	if recent, ok := body["recent_jobs"].([]any); !ok || len(recent) != 0 {
		t.Errorf("recent_jobs = %#v, want an empty array", body["recent_jobs"])
	}
	if obj(t, body, "devices", "by_vendor") == nil {
		t.Error("by_vendor must be an empty object, not null — the UI iterates it")
	}
}

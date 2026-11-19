package automationjob

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// TriggerBackup, ListDeviceBackups and BackupBatch were the three handlers in this package at 0%.
// Between them they are the whole write path: "back up this firewall", "back up all of mine", and
// the list that leads to /backups/:id/content — which hands over a complete FortiOS configuration.
//
// Every test below is skipped unless AUTOMATIONJOB_DB_TEST_DSN is set; the container is in the
// header of jobs_scope_db_test.go. These go through the real handlers, the real grant lookup and
// real TCP sockets on loopback, because what is being asserted is an ORDER of decisions:
//
//	device exists → caller holds a grant → the device answers → a login is nominated → queue it
//
// and the status code each step refuses with. The order is the security property. If the
// reachability probe ran before the grant check, "back up device 7" would tell an account that
// holds no grant whether device 7 is up, which is the enumeration the 404 exists to prevent.

// Redis is pointed at a port nothing listens on, for the whole test binary.
//
// platform.Redis() is a sync.Once singleton, so this has to happen before the FIRST call to it —
// package initialisation is the only place that is guaranteed. Why point it at a dead port rather
// than leave it at its default: these tests must behave the same on a machine where the project's
// own compose stack happens to be running as on a bare checkout, and "the queue is unavailable" is
// a path worth covering deliberately rather than a condition to avoid. Nothing in this package
// needs a working queue — the one path that would (a backup that is really enqueued) is noted at
// the bottom of this file.
func init() {
	if os.Getenv("REDIS_URL") == "" {
		// 1 is reserved (tcpmux) and nothing in this project ever binds it, so a dial is refused
		// immediately rather than timing out.
		_ = os.Setenv("REDIS_URL", "redis://127.0.0.1:1/0")
	}
}

// jobsWriteFixture is jobsScopeFixture plus what the write path needs: the tables LogActivity and
// the credential lookup touch, an encryption key, and a worker secret.
func jobsWriteFixture(t *testing.T) scopeFixture {
	t.Helper()
	fx := jobsScopeFixture(t) // skips when no DSN is configured

	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("WORKER_SHARED_SECRET", "unit-test-worker-secret-not-a-real-one-0123456789")

	if err := config.DB().AutoMigrate(&entity.ActivityLog{}, &entity.DeviceCredential{}); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	return fx
}

// openPort returns a loopback port that accepts TCP for the rest of the test.
//
// A real socket, not a stubbed dialer: services.CheckReachability's dialer is a package-private
// var in services, so the only honest way to make a device "reachable" from here is to be
// reachable. The listener is never Accept()ed — the kernel completes the handshake from the
// backlog, which is all the probe checks.
func openPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

// closedPort returns a loopback port nothing is listening on, so a dial is REFUSED rather than
// timing out. The fixture's own addresses are in 198.51.100.0/24 (TEST-NET-2), which black-holes:
// a probe there costs the full timeout, and these tests measure how fast a refusal comes back.
func closedPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return port
}

// pointAt rewrites a device's management address, so a test can decide whether that device answers.
func pointAt(t *testing.T, deviceID uint, port int) {
	t.Helper()
	if err := config.DB().Model(&entity.NetworkDevice{}).Where("id = ?", deviceID).
		Updates(map[string]any{"mgmt_ip": "127.0.0.1", "port": port}).Error; err != nil {
		t.Fatalf("point device %d at 127.0.0.1:%d: %v", deviceID, port, err)
	}
}

// nominateLogin gives a device the legacy automation credential on its own row — the one
// services.ResolveAutomationLogin falls back to — so the "nobody nominated an account" refusal is
// out of the way and a test can reach the step after it.
func nominateLogin(t *testing.T, deviceID uint) {
	t.Helper()
	enc, err := platform.EncryptSecret("not-a-real-firewall-password")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	if err := config.DB().Model(&entity.NetworkDevice{}).Where("id = ?", deviceID).
		Updates(map[string]any{"username": "automation", "password_enc": enc}).Error; err != nil {
		t.Fatalf("nominate a login for device %d: %v", deviceID, err)
	}
}

// postAs aims a POST handler at a device id as one account, the way the router would.
func postAs(t *testing.T, target, body string, userID uint, role string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = append(gin.Params{}, params...)
	c.Set("user_id", userID)
	c.Set("user_role", role)
	c.Set("user_email", "caller@test.invalid")
	return c, rec
}

func jobRowsFor(t *testing.T, deviceID uint) []entity.AutomationJob {
	t.Helper()
	var out []entity.AutomationJob
	if err := config.DB().Where("network_device_id = ?", deviceID).Order("id").Find(&out).Error; err != nil {
		t.Fatalf("read back the jobs for device %d: %v", deviceID, err)
	}
	return out
}

func idParam(id uint) gin.Param {
	return gin.Param{Key: "id", Value: strconv.FormatUint(uint64(id), 10)}
}

// ── TriggerBackup ────────────────────────────────────────────────────────────

func TestTriggerBackupIsNotFoundForADeviceThatDoesNotExist(t *testing.T) {
	jobsWriteFixture(t)

	c, rec := postAs(t, "/devices/4242/backup", "", jobsAdminUserID, "admin",
		gin.Param{Key: "id", Value: "4242"})
	TriggerBackup(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "device not found") {
		t.Errorf("body = %s, want the device-not-found message", rec.Body.String())
	}
}

// The grant check must come BEFORE the device is contacted, and nothing may be queued.
//
// Asserted on the clock as well as on the body: device B is in TEST-NET-2, so a probe of it costs
// the full services.DefaultReachabilityTimeout. A refusal that arrives in milliseconds is proof
// that no socket was opened — which is the real property, because a 404 that took three seconds
// has already told the caller that device B exists and is not answering.
func TestTriggerBackupRefusesAnUngrantedDeviceWithoutTouchingIt(t *testing.T) {
	fx := jobsWriteFixture(t)

	c, rec := postAs(t, "/devices/x/backup", "", jobsPlainUserID, "user", idParam(fx.deviceB.ID))
	start := time.Now()
	TriggerBackup(c)
	elapsed := time.Since(start)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if elapsed > time.Second {
		t.Errorf("the refusal took %v. The reachability probe runs before the grant check, so "+
			"this answer tells a caller with no grant whether device %d is up", elapsed, fx.deviceB.ID)
	}
	if got := jobRowsFor(t, fx.deviceB.ID); len(got) != 1 {
		// One is the fixture's own historical job; a second would be one this call queued.
		t.Errorf("device B has %d job rows, want the 1 the fixture seeded — a refused caller "+
			"queued work on a firewall they hold no grant for", len(got))
	}
	// Same wording as a device that is not there: a different message would confirm it exists.
	if !strings.Contains(rec.Body.String(), "device not found") {
		t.Errorf("body = %s — the refusal must be indistinguishable from a missing device",
			rec.Body.String())
	}
}

func TestTriggerBackupAnswers502WhenTheDeviceDoesNotAnswer(t *testing.T) {
	fx := jobsWriteFixture(t)
	pointAt(t, fx.deviceA.ID, closedPort(t))

	c, rec := postAs(t, "/devices/x/backup", "", jobsPlainUserID, "user", idParam(fx.deviceA.ID))
	TriggerBackup(c)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	// The frontend shows the device as unreachable off this flag, not off the status code.
	if reachable, ok := body["reachable"].(bool); !ok || reachable {
		t.Errorf(`the response is missing "reachable": false — got %v`, body)
	}
	if got := jobRowsFor(t, fx.deviceA.ID); len(got) != 1 {
		t.Errorf("device A has %d job rows, want the 1 the fixture seeded: a device that did not "+
			"answer must not leave a job in the queue for the worker to fail on later", len(got))
	}
}

// The one refusal that is NOT about infrastructure, and the reason it is told apart.
//
// "Nobody has nominated an account for scheduled work on this device" used to arrive as
// "queue unavailable (redis?)", which sends the reader to look at Redis — which is working fine.
// It is a 400 carrying the real message, and this pins both.
func TestTriggerBackupAnswers400WhenNobodyNominatedALogin(t *testing.T) {
	fx := jobsWriteFixture(t)
	pointAt(t, fx.deviceA.ID, openPort(t)) // reachable, so the probe is not what refuses

	c, rec := postAs(t, "/devices/x/backup", "", jobsPlainUserID, "user", idParam(fx.deviceA.ID))
	TriggerBackup(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "redis") {
		t.Errorf("a device with no nominated account was reported as a queue problem: %s", body)
	}
	if !strings.Contains(body, "Device") || !strings.Contains(body, "Credentials") {
		t.Errorf("the message does not say where to fix it (Profile ▸ Device Credentials): %s", body)
	}
	if got := jobRowsFor(t, fx.deviceA.ID); len(got) != 1 {
		t.Errorf("device A has %d job rows, want the 1 the fixture seeded: a device that cannot "+
			"authenticate must not be queued at all", len(got))
	}
}

// A queue that cannot be reached is a 503 — and, crucially, the job row it already created is left
// FAILED and finished, not QUEUED.
//
// A QUEUED row with nothing in Redis to match it is the worst outcome available: the device looks
// busy for ever, so TriggerBackup's own duplicate guard then refuses every later attempt with
// "there is already a backup running" and only the scheduler's five-minute stale sweep can clear
// it. The handler has to leave the row in a state somebody can retry from.
func TestTriggerBackupAnswers503AndFailsTheJobWhenTheQueueIsUnreachable(t *testing.T) {
	fx := jobsWriteFixture(t)
	pointAt(t, fx.deviceA.ID, openPort(t))
	nominateLogin(t, fx.deviceA.ID)

	c, rec := postAs(t, "/devices/x/backup", "", jobsPlainUserID, "user", idParam(fx.deviceA.ID))
	TriggerBackup(c)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", rec.Code, rec.Body.String())
	}

	rows := jobRowsFor(t, fx.deviceA.ID)
	if len(rows) != 2 {
		t.Fatalf("device A has %d job rows, want 2 (the fixture's plus this attempt): %+v",
			len(rows), rows)
	}
	queued := rows[len(rows)-1]
	if queued.Status != "FAILED" {
		t.Errorf("the job this attempt created is %q. A row left QUEUED with nothing in the queue "+
			"to match it makes the device look permanently busy: every later Backup is refused as "+
			"a duplicate until the scheduler's stale sweep notices", queued.Status)
	}
	if queued.FinishedAt == nil {
		t.Error("the failed job has no finished_at, so the history shows it as still running")
	}
	if queued.Result == "" {
		t.Error("the failed job carries no result text, so nothing on screen says why")
	}
}

// The duplicate guard: a second Backup while one is outstanding returns the job already in flight
// rather than queueing another login to the same firewall.
func TestTriggerBackupReportsTheRunningJobInsteadOfQueueingASecond(t *testing.T) {
	fx := jobsWriteFixture(t)
	pointAt(t, fx.deviceA.ID, openPort(t))
	nominateLogin(t, fx.deviceA.ID)

	outstanding := entity.AutomationJob{
		Type: "backup", Status: "QUEUED", NetworkDeviceID: fx.deviceA.ID,
		TriggeredBy: "someone.else@test.invalid",
	}
	if err := config.DB().Create(&outstanding).Error; err != nil {
		t.Fatalf("seed an outstanding job: %v", err)
	}

	c, rec := postAs(t, "/devices/x/backup", "", jobsPlainUserID, "user", idParam(fx.deviceA.ID))
	TriggerBackup(c)

	// 200, not 202: nothing was accepted for processing.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			JobID  uint   `json:"job_id"`
			Status string `json:"status"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	if body.Data.JobID != outstanding.ID {
		t.Errorf("answered with job #%d, want the outstanding #%d", body.Data.JobID, outstanding.ID)
	}
	if body.Message == "" {
		t.Error("no message, so the screen reports a fresh backup that was never started")
	}
	if rows := jobRowsFor(t, fx.deviceA.ID); len(rows) != 2 {
		t.Errorf("device A has %d job rows, want 2 (the fixture's and the outstanding one) — a "+
			"third means the duplicate guard did not hold", len(rows))
	}
}

// ── ListDeviceBackups ────────────────────────────────────────────────────────

func TestListDeviceBackupsRefusesACallerWithoutAGrant(t *testing.T) {
	fx := jobsWriteFixture(t)

	c, rec := jobsRequest(t, "/devices/x/backups", jobsPlainUserID, "user", idParam(fx.deviceB.ID))
	ListDeviceBackups(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	// The fixture's device-B backup is 7000 bytes / 70 lines. Neither number may appear.
	for _, leak := range []string{"7000", deviceBName} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("the refusal carries %q:\n%s", leak, rec.Body.String())
		}
	}
}

// The happy path, and the column this list deliberately does NOT read.
//
// ConfigBackup.Content is about a megabyte of encrypted FortiOS configuration per row. The query
// names its columns precisely so a list of a hundred backups does not drag a hundred megabytes out
// of Postgres — and so the ciphertext does not travel to a browser that has no use for it.
func TestListDeviceBackupsServesTheDeviceAndLeavesTheContentBehind(t *testing.T) {
	fx := jobsWriteFixture(t)

	// A second backup on device A, so "ordered newest first" is observable, with a content column
	// whose ciphertext is recognisable if it ever leaves the database.
	marker := "CIPHERTEXT-THAT-MUST-NOT-TRAVEL"
	newer := entity.ConfigBackup{
		NetworkDeviceID: fx.deviceA.ID, AutomationJobID: fx.jobA.ID,
		SizeBytes: 2048, Lines: 20, Content: marker, Sha256: "sha-newer",
	}
	if err := config.DB().Create(&newer).Error; err != nil {
		t.Fatalf("seed a second backup: %v", err)
	}

	c, rec := jobsRequest(t, "/devices/x/backups", jobsPlainUserID, "user", idParam(fx.deviceA.ID))
	ListDeviceBackups(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []entity.ConfigBackup `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	if len(body.Data) != 2 {
		t.Fatalf("got %d backups, want the 2 on device A: %+v", len(body.Data), body.Data)
	}
	if body.Data[0].ID != newer.ID {
		t.Errorf("the list is not newest-first: first row is #%d, want #%d",
			body.Data[0].ID, newer.ID)
	}
	for _, b := range body.Data {
		if b.NetworkDeviceID != fx.deviceA.ID {
			t.Errorf("backup #%d belongs to device %d, not to the one asked for",
				b.ID, b.NetworkDeviceID)
		}
		if b.Content != "" {
			t.Errorf("backup #%d came back with its content column read. This list is served for "+
				"every device page; reading a ~1MB encrypted configuration per row to render a "+
				"table of sizes is the cost this query's explicit column list avoids", b.ID)
		}
	}
	if strings.Contains(rec.Body.String(), marker) {
		t.Errorf("the stored ciphertext reached the response body:\n%s", rec.Body.String())
	}
}

// ── BackupBatch ──────────────────────────────────────────────────────────────

// activeUngrantedDevice adds a THIRD firewall: active (so the batch's own status filter does not
// exclude it) and granted to nobody. The fixture's device B is inactive, so without this a scoped
// and an unscoped batch would answer the same and prove nothing.
func activeUngrantedDevice(t *testing.T, port int) entity.NetworkDevice {
	t.Helper()
	d := entity.NetworkDevice{
		Name: "Firewall-NotYours", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "127.0.0.1", Port: port, APIPort: 443, Status: "active", BackupEnabled: true,
	}
	if err := config.DB().Create(&d).Error; err != nil {
		t.Fatalf("create the ungranted active device: %v", err)
	}
	return d
}

func batchAs(t *testing.T, body string, userID uint, role string) map[string]any {
	t.Helper()
	c, rec := postAs(t, "/devices/batch-backup", body, userID, role)
	BackupBatch(c)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	return out
}

func numField(t *testing.T, body map[string]any, key string) int {
	t.Helper()
	v, ok := body[key].(float64)
	if !ok {
		t.Fatalf("the response has no numeric %q: %v", key, body)
	}
	return int(v)
}

// "Back up everything" has to mean everything the caller was GRANTED, never everything in the
// inventory. Each device in that set is logged into and has its whole running configuration
// written into this platform's store, where /backups/:id/content then hands it back.
func TestBackupBatchCoversOnlyTheCallersDevices(t *testing.T) {
	fx := jobsWriteFixture(t)
	dead := closedPort(t)
	pointAt(t, fx.deviceA.ID, dead)
	notYours := activeUngrantedDevice(t, dead)

	body := batchAs(t, `{}`, jobsPlainUserID, "user")

	if got := numField(t, body, "total"); got != 1 {
		t.Errorf("total = %d, want 1 (device A alone). Device %d is active and granted to nobody; "+
			"an empty device_ids list means \"all of mine\", never \"all of them\"",
			got, notYours.ID)
	}
	// Nothing was queued on either: both point at a closed port.
	if got := numField(t, body, "unreachable"); got != 1 {
		t.Errorf("unreachable = %d, want 1", got)
	}
	if got := numField(t, body, "queued"); got != 0 {
		t.Errorf("queued = %d, want 0 — the device did not answer", got)
	}
	if rows := jobRowsFor(t, notYours.ID); len(rows) != 0 {
		t.Errorf("the ungranted device has %d job row(s); the batch reached a firewall this "+
			"caller holds no grant for", len(rows))
	}
}

// The ids come from the request body, so naming one explicitly must not be a way around the grant.
func TestBackupBatchCannotBeAimedAtAnUngrantedDevice(t *testing.T) {
	fx := jobsWriteFixture(t)
	dead := closedPort(t)
	pointAt(t, fx.deviceA.ID, dead)
	notYours := activeUngrantedDevice(t, dead)

	body := batchAs(t,
		`{"device_ids":[`+strconv.FormatUint(uint64(notYours.ID), 10)+`]}`,
		jobsPlainUserID, "user")

	if got := numField(t, body, "total"); got != 0 {
		t.Errorf("total = %d, want 0: asking for an ungranted device by id answered with it", got)
	}
	if rows := jobRowsFor(t, notYours.ID); len(rows) != 0 {
		t.Errorf("the ungranted device has %d job row(s) after being named explicitly", len(rows))
	}
}

func TestBackupBatchCoversTheWholeInventoryForAnAdmin(t *testing.T) {
	fx := jobsWriteFixture(t)
	dead := closedPort(t)
	pointAt(t, fx.deviceA.ID, dead)
	activeUngrantedDevice(t, dead)

	body := batchAs(t, `{}`, jobsAdminUserID, "admin")

	// Device A and the ungranted one. The fixture's device B is status=inactive, which this
	// endpoint excludes by design — a batch is not a reason to log into a decommissioned unit.
	if got := numField(t, body, "total"); got != 2 {
		t.Errorf("total = %d, want 2 (both ACTIVE devices; the inactive one is excluded)", got)
	}
	if got := numField(t, body, "unreachable"); got != 2 {
		t.Errorf("unreachable = %d, want 2", got)
	}
}

// A caller granted nothing must get an empty batch, not the whole inventory — the direction a
// filter like this fails in when it is written as "no ids, so skip the filter".
func TestBackupBatchIsEmptyForACallerWithNoGrants(t *testing.T) {
	fx := jobsWriteFixture(t)
	dead := closedPort(t)
	pointAt(t, fx.deviceA.ID, dead)
	activeUngrantedDevice(t, dead)

	body := batchAs(t, `{}`, jobsUngrantedUserID, "user")

	if got := numField(t, body, "total"); got != 0 {
		t.Errorf("total = %d, want 0 for an account that was granted no device", got)
	}
}

// A body that is not JSON at all must not be a 400: the schema is one optional field, and
// "back up all of mine" is the documented meaning of an empty body. Pinned because the handler
// discards the bind error deliberately, which reads like a mistake.
func TestBackupBatchTreatsAnUnreadableBodyAsAllOfMine(t *testing.T) {
	fx := jobsWriteFixture(t)
	pointAt(t, fx.deviceA.ID, closedPort(t))

	body := batchAs(t, `this is not json`, jobsPlainUserID, "user")

	if got := numField(t, body, "total"); got != 1 {
		t.Errorf("total = %d, want 1 — an unreadable body means \"all of mine\"", got)
	}
}

// ── Deliberately not covered here ────────────────────────────────────────────
//
// The 202 on the way out of TriggerBackup, and a non-zero `queued` from BackupBatch, are the only
// two paths in this file that need a working Redis: both end in
// services.IssueJobCredential → platform.Redis().Set. Standing a Redis up would make these tests
// depend on a second container and would prove one more statement — that LPUSH was called — which
// platform's own queue_payload_test.go already covers, and which says nothing about the decisions
// this file is about. The refusals above are the paths that carry the rules.

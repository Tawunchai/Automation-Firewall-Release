package automationjob

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
)

// The two /internal/jobs/:id callbacks and the worker health tile.
//
// WorkerStart and WorkerHealth were at 0%; WorkerResult was at 61% with only its SUCCESS path
// covered (backup_encryption_db_test.go goes through it to prove the ciphertext). What is missing
// is every refusal — and these two endpoints are the only ones in this backend that are
// authenticated by a shared secret instead of a session, so their refusal IS their security model:
// they write job statuses and stored configurations straight into the database and are reachable
// without a cookie.
//
// Skipped unless AUTOMATIONJOB_DB_TEST_DSN is set, except the WorkerHealth cases, which need no
// database. REDIS_URL is pointed at a dead port in trigger_backup_cover_test.go's init.

const goodWorkerSecret = "unit-test-worker-secret-not-a-real-one-0123456789"

// workerCall posts to a worker callback with whatever secret the test chooses.
func workerCall(t *testing.T, jobID uint, secret, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	id := strconv.FormatUint(uint64(jobID), 10)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/jobs/"+id+"/result", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if secret != "" {
		c.Request.Header.Set("X-Worker-Secret", secret)
	}
	c.Params = gin.Params{{Key: "id", Value: id}}
	return c, rec
}

func readJob(t *testing.T, id uint) entity.AutomationJob {
	t.Helper()
	var job entity.AutomationJob
	if err := config.DB().First(&job, id).Error; err != nil {
		t.Fatalf("read back job #%d: %v", id, err)
	}
	return job
}

// ── WorkerResult: the refusals ───────────────────────────────────────────────

// The whole point of the shared secret. These endpoints carry no session, so a wrong — or
// absent — secret is the only thing between an anonymous caller and writing "SUCCESS, here is the
// configuration" for any job id.
func TestWorkerResultRefusesABadSecretAndChangesNothing(t *testing.T) {
	fx := encryptionFixture(t)
	before := readJob(t, fx.jobA.ID)

	cases := map[string]string{
		"no header at all":         "",
		"the wrong secret":         "not-the-secret",
		"the right length, wrong":  strings.Repeat("x", len(goodWorkerSecret)),
		"a prefix of the real one": goodWorkerSecret[:8],
	}

	for name, secret := range cases {
		t.Run(name, func(t *testing.T) {
			c, rec := workerCall(t, fx.jobA.ID, secret,
				`{"status":"SUCCESS","result":"forged","content":"config"}`)
			WorkerResult(c)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
			after := readJob(t, fx.jobA.ID)
			if after.Status != before.Status || after.Result != before.Result {
				t.Errorf("the job was written to by an unauthenticated caller: %q/%q → %q/%q",
					before.Status, before.Result, after.Status, after.Result)
			}
			if strings.Contains(rec.Body.String(), "ok") {
				t.Errorf("the refusal reads as a success: %s", rec.Body.String())
			}
		})
	}
}

// An authenticated worker reporting a job id that is not there. 404, not a row created out of thin
// air — the id comes off the URL and the worker is the only caller, so a mismatch means the job was
// purged while the worker held it.
func TestWorkerResultIsNotFoundForAJobThatIsGone(t *testing.T) {
	encryptionFixture(t)

	c, rec := workerCall(t, 987654, goodWorkerSecret, `{"status":"SUCCESS","result":"ok"}`)
	WorkerResult(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	var jobs int64
	config.DB().Model(&entity.AutomationJob{}).Count(&jobs)
	if jobs != 2 {
		t.Errorf("there are now %d job rows, want the fixture's 2 — a callback for an unknown "+
			"id created something", jobs)
	}
}

// A body the worker could not have produced. 400 with the bind error, and the job untouched:
// the alternative — defaulting the missing fields — would mark a job SUCCESS with an empty status.
func TestWorkerResultRefusesABodyItCannotRead(t *testing.T) {
	fx := encryptionFixture(t)
	before := readJob(t, fx.jobA.ID)

	for _, body := range []string{`not json at all`, `{"status":`, `{"size_bytes":"not a number"}`} {
		c, rec := workerCall(t, fx.jobA.ID, goodWorkerSecret, body)
		WorkerResult(c)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want 400: %s", body, rec.Code, rec.Body.String())
			continue
		}
		if after := readJob(t, fx.jobA.ID); after.Status != before.Status {
			t.Errorf("body %q left the job as %q (was %q)", body, after.Status, before.Status)
		}
	}
}

// ── WorkerResult: the FAILED path ────────────────────────────────────────────

// A failed job whose device has no nominated account must come back carrying the real diagnosis.
//
// diagnose.go's rule is unit-tested on its own; what is NOT otherwise proved is that WorkerResult
// actually applies it — it only does so when req.Status is FAILED and only after loading the
// device, and the whole feature is invisible if that branch is skipped. The worker's own wording
// ("login ไม่ผ่าน") sends the reader to the firewall to check a password that is not the problem.
func TestWorkerResultAnnotatesAnAuthFailureOnTheUnmaintainedLogin(t *testing.T) {
	fx := encryptionFixture(t)
	// The legacy credential on the device row — the one no screen maintains — is what makes the
	// annotation apply. nominateLogin writes exactly that.
	nominateLogin(t, fx.deviceA.ID)

	c, rec := workerCall(t, fx.jobA.ID, goodWorkerSecret,
		`{"status":"FAILED","result":"login ไม่ผ่าน (ตรวจ username/password)"}`)
	WorkerResult(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	job := readJob(t, fx.jobA.ID)
	if job.Status != "FAILED" {
		t.Errorf("job status = %q, want FAILED", job.Status)
	}
	if !strings.Contains(job.Result, "use for scheduled work") {
		t.Errorf("the stored result is %q.\nIt should also say that the job used the old login on "+
			"the device record, because the operator's next click is in Profile ▸ Device "+
			"Credentials and not on the firewall", job.Result)
	}
	if job.FinishedAt == nil {
		t.Error("a finished job has no finished_at, so the history shows it as still running")
	}
}

// The other half of the same rule: a failure that is NOT about credentials must be passed through
// untouched. Appending credential advice to "device unreachable" would send the reader to the
// wrong place just as surely.
func TestWorkerResultLeavesANonAuthFailureAsTheWorkerWroteIt(t *testing.T) {
	fx := encryptionFixture(t)
	nominateLogin(t, fx.deviceA.ID)

	const asWritten = "timeout waiting for the prompt after `show full-configuration`"
	c, rec := workerCall(t, fx.jobA.ID, goodWorkerSecret,
		`{"status":"FAILED","result":"`+asWritten+`"}`)
	WorkerResult(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if job := readJob(t, fx.jobA.ID); job.Result != asWritten {
		t.Errorf("the result was rewritten:\n got %q\nwant %q", job.Result, asWritten)
	}
}

// ── WorkerResult: an unchanged configuration ─────────────────────────────────

// The same sha256 as the previous backup means the firewall's configuration did not change, and
// the row is NOT stored again.
//
// This is what keeps config_backups from growing by a megabyte per device per night for ever.
// It is also the branch that decides what the Backups list says, so getting it wrong is visible
// twice: as unbounded growth and as a history full of identical restore points.
func TestWorkerResultStoresNoSecondCopyOfAnUnchangedConfiguration(t *testing.T) {
	fx := encryptionFixture(t)
	config.DB().Model(&entity.AutomationJob{}).Where("id = ?", fx.jobA.ID).
		Updates(map[string]any{"status": "RUNNING", "type": "backup"})

	// The fixture seeded a backup row for device A with no sha256; give it one to collide with.
	const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if err := config.DB().Model(&entity.ConfigBackup{}).
		Where("network_device_id = ?", fx.deviceA.ID).
		Update("sha256", sha).Error; err != nil {
		t.Fatalf("set the previous sha256: %v", err)
	}
	var before int64
	config.DB().Model(&entity.ConfigBackup{}).Where("network_device_id = ?", fx.deviceA.ID).Count(&before)

	body, _ := json.Marshal(map[string]any{
		"status": "SUCCESS", "result": "backup ok", "sha256": sha,
		"content": sampleDeviceConfig(), "lines": 9, "size_bytes": 300,
	})
	c, rec := workerCall(t, fx.jobA.ID, goodWorkerSecret, string(body))
	WorkerResult(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var after int64
	config.DB().Model(&entity.ConfigBackup{}).Where("network_device_id = ?", fx.deviceA.ID).Count(&after)
	if after != before {
		t.Errorf("config_backups for device A went from %d to %d rows. An identical configuration "+
			"must not be stored again — that is a megabyte per device per night for ever", before, after)
	}
	job := readJob(t, fx.jobA.ID)
	if !strings.Contains(job.Result, "no config change") {
		t.Errorf("the job result is %q, and does not say the configuration was unchanged", job.Result)
	}

	// The run still happened, so the device's last_backup_at moves: the dashboard's "never backed
	// up / stale" counts are built from that column, and a device whose nightly backup succeeds
	// with no changes is neither.
	var device entity.NetworkDevice
	if err := config.DB().First(&device, fx.deviceA.ID).Error; err != nil {
		t.Fatalf("read back the device: %v", err)
	}
	if device.LastBackupAt == nil {
		t.Error("last_backup_at was not set. A successful backup that found no changes is still a " +
			"successful backup, and the dashboard counts a null here as \"never backed up\"")
	}
}

// ── WorkerStart ──────────────────────────────────────────────────────────────

func TestWorkerStartMarksTheJobRunning(t *testing.T) {
	fx := encryptionFixture(t)

	id := strconv.FormatUint(uint64(fx.jobA.ID), 10)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/jobs/"+id+"/start", nil)
	c.Request.Header.Set("X-Worker-Secret", goodWorkerSecret)
	c.Params = gin.Params{{Key: "id", Value: id}}
	WorkerStart(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	job := readJob(t, fx.jobA.ID)
	if job.Status != "RUNNING" {
		t.Errorf("job status = %q, want RUNNING", job.Status)
	}
	if job.StartedAt == nil {
		t.Error("started_at was not set, so the scheduler's stale sweep and the UI have no " +
			"moment to measure the job from")
	}
}

func TestWorkerStartRefusesABadSecret(t *testing.T) {
	fx := encryptionFixture(t)
	before := readJob(t, fx.jobA.ID)

	id := strconv.FormatUint(uint64(fx.jobA.ID), 10)
	for _, secret := range []string{"", "not-the-secret"} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodPost, "/internal/jobs/"+id+"/start", nil)
		if secret != "" {
			c.Request.Header.Set("X-Worker-Secret", secret)
		}
		c.Params = gin.Params{{Key: "id", Value: id}}
		WorkerStart(c)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("secret %q: status = %d, want 401", secret, rec.Code)
		}
		if after := readJob(t, fx.jobA.ID); after.Status != before.Status || after.StartedAt != nil {
			t.Errorf("secret %q: an unauthenticated caller marked job #%d as %q",
				secret, fx.jobA.ID, after.Status)
		}
	}
}

// An authenticated start for a job id that no longer exists answers 200 and writes nothing.
//
// Pinned because it looks like a missing 404. It is deliberate: this callback is fire-and-forget
// from the worker's side — its answer is discarded — so the only thing a 404 would buy is a line in
// the worker's log about a job somebody deleted while it was starting. The property that matters is
// that nothing is created, which is what the row count asserts.
func TestWorkerStartIsAHarmlessNoOpForAnUnknownJob(t *testing.T) {
	encryptionFixture(t)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/jobs/987654/start", nil)
	c.Request.Header.Set("X-Worker-Secret", goodWorkerSecret)
	c.Params = gin.Params{{Key: "id", Value: "987654"}}
	WorkerStart(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var jobs int64
	config.DB().Model(&entity.AutomationJob{}).Count(&jobs)
	if jobs != 2 {
		t.Errorf("there are now %d job rows, want the fixture's 2", jobs)
	}
}

// ── WorkerHealth ─────────────────────────────────────────────────────────────

// No database: this reads one Redis key.
//
// The property worth pinning is that an unreachable queue is an ANSWER, not an error. The console
// renders a "worker offline" tile from this; a 500 or a hung request would blank the tile instead
// of saying what is wrong, which is the same mistake as a page that reports "no data" when it
// could not read.
func TestWorkerHealthReportsOfflineRatherThanFailing(t *testing.T) {
	// REDIS_URL points at a port nothing listens on — see the init in
	// trigger_backup_cover_test.go.
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/worker/health", nil)
	WorkerHealth(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — an unreachable queue must be reported, not raised: %s",
			rec.Code, rec.Body.String())
	}
	var body struct {
		Online   bool   `json:"online"`
		LastSeen any    `json:"last_seen"`
		Message  string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v\n%s", err, rec.Body.String())
	}
	if body.Online {
		t.Errorf("online = true with no Redis to read a heartbeat from: %s", rec.Body.String())
	}
	if body.LastSeen != nil {
		t.Errorf("last_seen = %v, want null when there is no heartbeat", body.LastSeen)
	}
	if body.Message == "" {
		t.Error("no message, so the tile says \"offline\" and nothing about why")
	}
}

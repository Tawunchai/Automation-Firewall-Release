package ai

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"network_automation/entity"

	"github.com/gin-gonic/gin"
)

// /ai/diagnose-job takes a job id straight out of the request body, reads
// that row for any signed-in account, and sends what is on it to Anthropic: the device's name and
// management IP, the job's failure text, the exact CLI that was pushed, and the before/after diff
// of the firewall's configuration. The analysis then comes back to the caller. GenerateConfig in
// the same file has checked services.UserCanAccessDevice since it was written; this one never did,
// so it was both an IDOR over the job id space and a way to read out devices the caller holds no
// grant for. /ai/explain-deploy was the same shape and was covered here too; it was deleted on
// 2026-11-19 because nothing ever called it, and its two cases went with it.
//
// The guards exercised here are the real ones. Only the row lookups are supplied — config.DB() is
// a package-level handle with no test seam, which is why jobByID is a variable. As in controller/automationjob, the two roles stand for the two sides of the rule in
// services/deviceaccess.go: admin reaches every device, a non-admin with no grant row reaches none.
//
// The granted case deliberately uses a row whose STATUS stops the request one step later (a job
// that did not fail). That is what makes "the caller got past
// authorization" observable without the test making a paid API call to Anthropic.

const authzDeviceID = 42

func withStubJob(t *testing.T, job entity.AutomationJob, found bool) {
	t.Helper()
	original := jobByID
	jobByID = func(uint) (entity.AutomationJob, bool) { return job, found }
	t.Cleanup(func() { jobByID = original })
}

func authzCtx(path, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	c.Request = r
	c.Set("user_id", uint(9))
	c.Set("user_role", role)
	return c, rec
}

func failedJob() entity.AutomationJob {
	return entity.AutomationJob{
		Type: "backup", Status: "FAILED", NetworkDeviceID: authzDeviceID,
		Result: "authentication failed for admin@10.0.99.201",
	}
}

func TestDiagnoseJobRefusesADeviceTheCallerWasNotGranted(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")
	withStubJob(t, failedJob(), true)
	c, rec := authzCtx("/ai/diagnose-job", "user", `{"job_id":7}`)

	DiagnoseJob(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a user with no grant for device %d must not have the job's "+
			"device name, management IP and failure text sent to Anthropic on their behalf",
			rec.Code, authzDeviceID)
	}
}

func TestDiagnoseJobLetsAGrantedCallerThrough(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")
	// A job that SUCCEEDED: the status check is the step immediately after authorization, so a 400
	// from it means the grant check passed — and nothing is sent to Anthropic.
	job := failedJob()
	job.Status = "SUCCESS"
	withStubJob(t, job, true)
	c, rec := authzCtx("/ai/diagnose-job", "admin", `{"job_id":7}`)

	DiagnoseJob(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — an admin must get past the grant check and be stopped by "+
			"the FAILED-only rule instead", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "FAILED") {
		t.Fatalf("400 but not from the status rule: %s", rec.Body.String())
	}
}

// A row that does not exist and a row the caller may not have must be indistinguishable, or the
// 404 is only a differently-worded 403 and the id space is still walkable.
func TestMissingRowAndUngrantedRowAnswerTheSame(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")

	withStubJob(t, entity.AutomationJob{}, false)
	cMissing, recMissing := authzCtx("/ai/diagnose-job", "admin", `{"job_id":7}`)
	DiagnoseJob(cMissing)

	withStubJob(t, failedJob(), true)
	cUngranted, recUngranted := authzCtx("/ai/diagnose-job", "user", `{"job_id":7}`)
	DiagnoseJob(cUngranted)

	if recMissing.Code != recUngranted.Code || recMissing.Body.String() != recUngranted.Body.String() {
		t.Fatalf("missing job answered %d %s, ungranted job answered %d %s — they must match",
			recMissing.Code, recMissing.Body.String(), recUngranted.Code, recUngranted.Body.String())
	}
}

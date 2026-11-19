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
	"network_automation/services/platform"
)

// A stored backup is the firewall's whole configuration, and it used to sit in Postgres in the
// clear — IPsec pre-shared keys, SNMP communities, RADIUS secrets, administrator password hashes —
// next to a password_enc column of the SAME device that was AES-256-GCM encrypted.
//
// These tests go through the real write path (the worker callback) and the real read paths
// (/backups/:id/content and /backups/:id/download), because the only thing worth proving is that
// the ciphertext is what lands in the table AND that every reader still gets the configuration
// back. Either half on its own is a bug: ciphertext nobody can read is a lost restore point.
//
// Skipped unless AUTOMATIONJOB_DB_TEST_DSN is set — the container is in the header of
// jobs_scope_db_test.go.

// The strings that must never be readable in the table. They are the shapes a real FortiGate
// export uses, so a grep for them is the same grep an attacker with database access would run.
const (
	backupPSK       = "SuperSecretPreSharedKey123"
	backupCommunity = "private-snmp-community"
	backupHostname  = "NGFW-Testing"
)

func sampleDeviceConfig() string {
	return "#config-version=FGT80E-7.2.10-FW-build1706-230207:opmode=0:vdom=0\n" +
		"config system global\n    set hostname \"" + backupHostname + "\"\nend\n" +
		"config system snmp community\n    edit 1\n        set name \"" + backupCommunity + "\"\n    next\nend\n" +
		"config vpn ipsec phase1-interface\n    edit \"to-branch\"\n" +
		"        set psksecret " + backupPSK + "\n    next\nend\n"
}

// encryptionFixture is jobsScopeFixture plus the two things the write path needs: a worker secret
// to authenticate the callback, and an encryption key to store the configuration under.
func encryptionFixture(t *testing.T) scopeFixture {
	t.Helper()
	fx := jobsScopeFixture(t) // skips when no DSN is configured

	t.Setenv("WORKER_SHARED_SECRET", "unit-test-worker-secret-not-a-real-one-0123456789")
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")

	// A successful backup kicks off drift analysis in a goroutine. Migrating its tables keeps that
	// from erroring into the test output; nothing here asserts on it.
	if err := config.DB().AutoMigrate(
		&entity.DriftRun{}, &entity.DriftFinding{}, &entity.ChangeRecord{},
	); err != nil {
		t.Fatalf("AutoMigrate drift tables: %v", err)
	}
	return fx
}

// reportBackup plays the worker reporting a finished backup for a job.
func reportBackup(t *testing.T, jobID uint, content string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"status":     "SUCCESS",
		"result":     "backup ok",
		"git_commit": "deadbeef",
		"sha256":     "sha-" + strconv.FormatUint(uint64(jobID), 10),
		"path":       "devices/lab-fgt-80e.conf",
		"size_bytes": len(content),
		"lines":      strings.Count(content, "\n"),
		"content":    content,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost,
		"/internal/jobs/"+strconv.FormatUint(uint64(jobID), 10)+"/result", strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("X-Worker-Secret", "unit-test-worker-secret-not-a-real-one-0123456789")
	c.Params = gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(jobID), 10)}}
	WorkerResult(c)
	return rec
}

func newestBackup(t *testing.T, deviceID uint) entity.ConfigBackup {
	t.Helper()
	var b entity.ConfigBackup
	if err := config.DB().Where("network_device_id = ? AND content <> ''", deviceID).
		Order("id DESC").First(&b).Error; err != nil {
		t.Fatalf("read the backup back: %v", err)
	}
	return b
}

// backupRequest aims one of the three /backups/:id handlers at a row as one account.
func backupRequest(t *testing.T, backupID uint, userID uint, role string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	id := strconv.FormatUint(uint64(backupID), 10)
	c.Request = httptest.NewRequest(http.MethodGet, "/backups/"+id+"/content", nil)
	c.Params = gin.Params{{Key: "id", Value: id}}
	c.Set("user_id", userID)
	c.Set("user_role", role)
	return c, rec
}

// ── the write ────────────────────────────────────────────────────────────────

func TestTheWorkerCallbackStoresTheConfigurationEncrypted(t *testing.T) {
	fx := encryptionFixture(t)

	cfg := sampleDeviceConfig()
	if rec := reportBackup(t, fx.jobA.ID, cfg); rec.Code != http.StatusOK {
		t.Fatalf("worker callback = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	stored := newestBackup(t, fx.deviceA.ID)
	if stored.Content == cfg {
		t.Fatal("the configuration is in the database verbatim")
	}
	for _, secret := range []string{backupPSK, backupCommunity, backupHostname, "psksecret", "config system"} {
		if strings.Contains(stored.Content, secret) {
			t.Errorf("%q is readable in the stored backup", secret)
		}
	}
	if !strings.HasPrefix(stored.Content, "v") || !strings.Contains(stored.Content, ":") {
		t.Errorf("the stored value carries no key-version prefix, so it cannot be rotated: %q",
			truncateForMessage(stored.Content))
	}

	// The metadata the list page shows is NOT encrypted — it has to stay queryable, and none of it
	// is a secret.
	if stored.Lines == 0 || stored.SizeBytes == 0 || stored.Sha256 == "" {
		t.Errorf("metadata was lost: lines=%d size=%d sha=%q", stored.Lines, stored.SizeBytes, stored.Sha256)
	}
}

// ── the reads ────────────────────────────────────────────────────────────────

func TestBothBackupReadersReturnThePlaintextConfiguration(t *testing.T) {
	fx := encryptionFixture(t)

	cfg := sampleDeviceConfig()
	if rec := reportBackup(t, fx.jobA.ID, cfg); rec.Code != http.StatusOK {
		t.Fatalf("worker callback = %d: %s", rec.Code, rec.Body.String())
	}
	stored := newestBackup(t, fx.deviceA.ID)

	// GET /backups/:id/content — what the page renders.
	c, rec := backupRequest(t, stored.ID, jobsPlainUserID, "user")
	GetBackupContent(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("content status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v (%s)", err, rec.Body.String())
	}
	if body.Data.Content != cfg {
		t.Fatalf("the page would show a configuration that is not the one taken:\n got %q\nwant %q",
			truncateForMessage(body.Data.Content), truncateForMessage(cfg))
	}

	// GET /backups/:id/download — what a restore-by-hand uses. A .conf file of ciphertext is
	// useless, and an empty one is worse: it looks like the firewall had no configuration.
	c2, rec2 := backupRequest(t, stored.ID, jobsPlainUserID, "user")
	DownloadBackup(c2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("download status = %d, want 200: %s", rec2.Code, rec2.Body.String())
	}
	if rec2.Body.String() != cfg {
		t.Fatalf("the downloaded file is not the configuration:\n%s", truncateForMessage(rec2.Body.String()))
	}
}

// Rows taken before this change are plaintext and must keep working — a backup is what you reach
// for on the worst day of the quarter, and the key must not become a prerequisite for reading
// history.
func TestABackupStoredBeforeEncryptionStillReads(t *testing.T) {
	fx := encryptionFixture(t)

	cfg := sampleDeviceConfig()
	legacy := entity.ConfigBackup{
		NetworkDeviceID: fx.deviceA.ID, AutomationJobID: fx.jobA.ID,
		Sha256: "legacy", Lines: 7, SizeBytes: len(cfg),
		Content: cfg, // written straight in, the way every existing row was
	}
	if err := config.DB().Create(&legacy).Error; err != nil {
		t.Fatalf("seed a legacy row: %v", err)
	}

	c, rec := backupRequest(t, legacy.ID, jobsPlainUserID, "user")
	DownloadBackup(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("a pre-existing plaintext backup answered %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != cfg {
		t.Fatal("a pre-existing plaintext backup did not come back as it was stored")
	}
}

// The failure that must never be silent. A row that announces itself as encrypted and will not
// decrypt is a platform fault, and the reader has to say so — an empty 200 reads as "this firewall
// has no configuration", and the same string reaches FortiClient.RestoreConfigFile on the rollback
// path, where it would replace a whole configuration with nothing.
func TestAnUndecryptableBackupIsReportedNotBlanked(t *testing.T) {
	fx := encryptionFixture(t)

	var corrupt entity.ConfigBackup
	corrupt.NetworkDeviceID = fx.deviceA.ID
	corrupt.AutomationJobID = fx.jobA.ID
	corrupt.Lines = 7
	if err := platform.SetBackupContent(&corrupt, sampleDeviceConfig()); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}
	// Flip the last byte of the base64 payload: valid ciphertext shape, failing GCM tag.
	corrupt.Content = corrupt.Content[:len(corrupt.Content)-2] + "=="
	if err := config.DB().Create(&corrupt).Error; err != nil {
		t.Fatalf("seed a corrupt row: %v", err)
	}

	for name, h := range map[string]gin.HandlerFunc{
		"content":  GetBackupContent,
		"download": DownloadBackup,
	} {
		t.Run(name, func(t *testing.T) {
			c, rec := backupRequest(t, corrupt.ID, jobsPlainUserID, "user")
			h(c)
			if rec.Code == http.StatusOK {
				t.Fatalf("an undecryptable backup answered 200 with %q — that is a configuration "+
					"this platform cannot read, reported as one it can", truncateForMessage(rec.Body.String()))
			}
			if rec.Code != http.StatusInternalServerError {
				t.Errorf("status = %d, want 500", rec.Code)
			}
		})
	}
}

func truncateForMessage(s string) string {
	if len(s) > 160 {
		return s[:160] + "…"
	}
	return s
}

package platform

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// คิวงาน automation ระหว่าง Go (ผู้สั่ง) กับ Python worker (ผู้ทำ)
// ใช้ Redis list: Go LPUSH, worker BRPOP

const JobQueueKey = "automation:jobs"
const ConfigQueueKey = "automation:config"

// leakedWorkerSecrets are values that must never authenticate a worker. The first shipped as the
// docker-compose default, so it is public — and these callbacks write job results, config-deploy
// outcomes and compliance verdicts straight into the database.
var leakedWorkerSecrets = map[string]bool{
	"dev-worker-secret-change-me": true,
	"change-me":                   true,
	"changeme":                    true,
}

const minWorkerSecretLen = 16

// workerSecret = shared secret ที่ worker ใช้ยืนยันตัวกับ backend (header X-Worker-Secret)
//
// No fallback: an unset secret must not silently become a value anyone can read off GitHub.
// ValidateWorkerSecret stops the server at startup, so by the time this runs it is set.
func workerSecret() string { return os.Getenv("WORKER_SHARED_SECRET") }

// ValidateWorkerSecret is the startup guard, mirroring ValidateCredKeyConfig.
func ValidateWorkerSecret() error {
	raw := os.Getenv("WORKER_SHARED_SECRET")
	switch {
	case strings.TrimSpace(raw) == "":
		return errors.New("WORKER_SHARED_SECRET is not set — generate one with `openssl rand -hex 32` and set it for BOTH the backend and the worker")
	case leakedWorkerSecrets[strings.ToLower(strings.TrimSpace(raw))]:
		return errors.New("WORKER_SHARED_SECRET is set to a well-known placeholder value; anyone could post forged job results to /internal/*. Generate a real secret with `openssl rand -hex 32`")
	case len(raw) < minWorkerSecretLen:
		return fmt.Errorf("WORKER_SHARED_SECRET must be at least %d characters (got %d)", minWorkerSecretLen, len(raw))
	}
	return nil
}

// WorkerAuthOK compares the presented X-Worker-Secret against the configured one.
//
// The comparison is constant-time: this is a bearer secret checked on an unauthenticated endpoint,
// so a plain `!=` leaks its length and prefix through timing. An empty configured secret never
// matches, so a misconfigured server fails closed rather than accepting every caller.
func WorkerAuthOK(presented string) bool {
	want := workerSecret()
	if want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(want)) == 1
}

var (
	rdb     *redis.Client
	rdbOnce sync.Once
)

func redisURL() string {
	if u := os.Getenv("REDIS_URL"); u != "" {
		return u
	}
	return "redis://localhost:6379/0"
}

// Redis คืน client (lazy singleton)
func Redis() *redis.Client {
	rdbOnce.Do(func() {
		opt, err := redis.ParseURL(redisURL())
		if err != nil {
			// fallback แบบ default ถ้า parse ไม่ได้
			opt = &redis.Options{Addr: "localhost:6379"}
		}
		rdb = redis.NewClient(opt)
	})
	return rdb
}

// BackupJobMessage = payload ที่ worker ต้องใช้ทำ backup
//
// It carries NO credential. CredentialToken is exchanged for one at
// POST /internal/job-credentials, once, when the worker is about to connect — see
// services/jobcredential.go for why the decrypted password used to be here and what that cost.
type BackupJobMessage struct {
	JobID    uint   `json:"job_id"`
	DeviceID uint   `json:"device_id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Platform string `json:"platform"`
	// CredentialToken names this job and its device. Single use, 30-minute life, no secret in it.
	CredentialToken string `json:"credential_token"`
	Type            string `json:"type"` // "backup"
}

// EnqueueBackup ดันงานเข้า Redis ให้ worker หยิบไปทำ
func EnqueueBackup(msg BackupJobMessage) error {
	msg.Type = "backup"
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Redis().LPush(ctx, JobQueueKey, data).Err()
}

// ── Config deploy (push config หลายอุปกรณ์พร้อมกัน) ───────────────────────────

// ConfigDeviceTarget = อุปกรณ์ปลายทาง 1 ตัว + result_id (งานลูก)
//
// Like BackupJobMessage, it carries a token rather than the credential itself. Each target gets
// its OWN token: a deploy fans out to several firewalls, the logins can differ per device, and one
// token redeemed for the wrong unit would be a login attempt against a device that locks its admin
// account after three failures.
type ConfigDeviceTarget struct {
	ResultID uint   `json:"result_id"` // entity.ConfigDeployResult.ID — worker อ้างกลับเวลารายงานผล
	DeviceID uint   `json:"device_id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Platform string `json:"platform"`
	// CredentialToken names this result row and its device. Single use, 30-minute life.
	CredentialToken string `json:"credential_token"`
}

// ConfigJobMessage = payload งาน push config 1 ครั้ง (1 แม่ → หลาย target)
type ConfigJobMessage struct {
	DeployID uint                 `json:"deploy_id"`
	Type     string               `json:"type"`     // "config"
	Commands []string             `json:"commands"` // CLI lines (แตกจาก CommandText แล้ว)
	Targets  []ConfigDeviceTarget `json:"targets"`
}

// EnqueueConfig ดันงาน push config เข้า Redis (คนละ queue กับ backup)
func EnqueueConfig(msg ConfigJobMessage) error {
	msg.Type = "config"
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Redis().LPush(ctx, ConfigQueueKey, data).Err()
}

// EnqueueQuery ดันงาน "อ่าน" ข้อมูลจากอุปกรณ์ (get/show/diagnose) เข้าคิวเดียวกับ config
// — worker แยกพฤติกรรมตาม Type: รัน send_command() ต่อบรรทัด แล้วคืน output ดิบ ไม่มี diff/rollback
func EnqueueQuery(msg ConfigJobMessage) error {
	msg.Type = "query"
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Redis().LPush(ctx, ConfigQueueKey, data).Err()
}

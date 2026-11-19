package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"network_automation/services/platform"
	"time"
)

// Getting the firewall's password out of the job queue.
//
// ── What was wrong ───────────────────────────────────────────────────────────
//
// BackupJobMessage and ConfigDeviceTarget used to carry `Username` and `Password` — the DECRYPTED
// device credential — and that message is LPUSHed into Redis, which this project runs with
// `--appendonly yes`. So every backup and every config push appended an administrator password for
// a firewall, in clear, to a file on disk that nothing ever rewrites. The device's own
// `password_enc` column beside it is AES-256-GCM with a versioned key; the queue undid that for
// the duration of the AOF, which is forever.
//
// ── What replaces it ─────────────────────────────────────────────────────────
//
// The queue now carries a TOKEN. The token names a job and a device — no secret — and the worker
// exchanges it, over the internal network and under its own X-Worker-Secret, for the credential at
// the moment it is about to connect (POST /internal/job-credentials). The backend resolves the
// login the same way the enqueue side used to, straight from the encrypted column.
//
// Three properties that matter, in order of how much they are worth:
//
//   - nothing secret is ever written to the AOF. The claim is {kind, job, device, user}.
//   - the token is SINGLE USE and expires. A copy of the queue message taken later is worthless,
//     which the old payload emphatically was not.
//   - the credential is resolved at redeem time, so a password rotated between enqueue and run is
//     the one the worker uses — the old message would have carried the stale one and failed the
//     login three times, which on FortiOS locks the account.
//
// The enqueue side still resolves the login once, and throws the secret away: a device whose
// credential cannot be read must fail THERE, where there is a user watching, rather than minutes
// later inside the worker.
//
// ── Why Redis and not a map in this process ──────────────────────────────────
//
// A map would not survive a backend restart, and a job that was queued a minute before a deploy
// would then fail with "unknown token" for a reason nobody could see. Redis already holds the
// queue itself, so a token that outlives the backend but not the queue is the consistent choice.
// It holds no secret, so it does not reintroduce what this file exists to remove.

// JobCredentialTTL bounds how long a queued job may wait before its credential token is refused.
//
// Thirty minutes is far longer than the queue's normal latency (seconds) and far shorter than a
// backup schedule's period, so a token that is still being presented after it is either a job that
// has been stuck since before the last restart, or a replay.
const JobCredentialTTL = 30 * time.Minute

// JobCredentialKinds.
const (
	JobCredentialBackup = "backup"
	JobCredentialConfig = "config"
)

// JobCredentialClaim is what a token stands for. No secret, by design.
type JobCredentialClaim struct {
	Kind     string `json:"kind"`
	JobID    uint   `json:"job_id"`
	ResultID uint   `json:"result_id,omitempty"`
	DeviceID uint   `json:"device_id"`
	// UserID is whose credential to resolve: the person who pressed the button on a config deploy.
	// Zero means "the device's automation account", which is what a scheduled backup runs as.
	UserID uint `json:"user_id,omitempty"`
}

// ErrNoSuchJobCredential is returned for a token that was never issued, has expired, or has
// already been redeemed. One error for all three on purpose: the caller is a worker that should
// retry nothing, and an attacker probing tokens learns the same thing either way.
var ErrNoSuchJobCredential = errors.New("this job credential token is not valid")

func jobCredentialKey(token string) string { return "automation:jobcred:" + token }

// IssueJobCredential mints a single-use token for a queued job.
func IssueJobCredential(claim JobCredentialClaim) (string, error) {
	token, err := platform.RandomHex(32)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(claim)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := platform.Redis().Set(ctx, jobCredentialKey(token), data, JobCredentialTTL).Err(); err != nil {
		return "", fmt.Errorf("could not store the job credential token: %w", err)
	}
	return token, nil
}

// RedeemJobCredential consumes a token and returns what it stood for.
//
// GETDEL: the read and the delete are one round trip and one atomic operation, so two workers
// presenting the same token cannot both be served — which is what "single use" has to mean when
// the thing being handed out is an administrator password.
func RedeemJobCredential(token string) (JobCredentialClaim, error) {
	var claim JobCredentialClaim
	if token == "" {
		return claim, ErrNoSuchJobCredential
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	data, err := platform.Redis().GetDel(ctx, jobCredentialKey(token)).Bytes()
	if err != nil || len(data) == 0 {
		return claim, ErrNoSuchJobCredential
	}
	if err := json.Unmarshal(data, &claim); err != nil {
		return claim, ErrNoSuchJobCredential
	}
	return claim, nil
}

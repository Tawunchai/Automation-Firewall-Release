package platform

import (
	"strings"
	"testing"
)

// WORKER_SHARED_SECRET is the ONLY thing standing in front of /internal/jobs/:id/result,
// /internal/config-deploys/:id/device-result and /internal/compliance/:id/result — endpoints that
// write job outcomes, deploy results and compliance verdicts straight into the database with no
// user session involved.
//
// It used to default to "dev-worker-secret-change-me" in three separate places (services/queue.go
// and two controllers), so forging a callback needed nothing but the public repo.

const goodWorkerSecret = "3b91f47e2ac508d6194bf3072ec5a8d6417fe0b93c28da5617fb40e9c2385a71"

func TestValidateWorkerSecret_RejectsLeakedAndMissing(t *testing.T) {
	for _, tc := range []struct{ name, secret, want string }{
		{"leaked default", "dev-worker-secret-change-me", "placeholder"},
		{"leaked default, odd case", "Dev-Worker-Secret-Change-Me", "placeholder"},
		{"unset", "", "not set"},
		{"blank", "   ", "not set"},
		{"too short", "hunter2", "at least"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WORKER_SHARED_SECRET", tc.secret)
			err := ValidateWorkerSecret()
			if err == nil {
				t.Fatalf("secret %q was accepted", tc.secret)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestValidateWorkerSecret_AcceptsRealSecret(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", goodWorkerSecret)
	if err := ValidateWorkerSecret(); err != nil {
		t.Fatalf("a 64-hex secret was rejected: %v", err)
	}
}

func TestWorkerAuthOK_MatchesOnlyTheConfiguredSecret(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", goodWorkerSecret)

	if !WorkerAuthOK(goodWorkerSecret) {
		t.Error("the configured secret was rejected")
	}
	for _, bad := range []string{
		"",
		"dev-worker-secret-change-me",
		goodWorkerSecret + "x", // longer
		goodWorkerSecret[:len(goodWorkerSecret)-1], // truncated
		strings.ToUpper(goodWorkerSecret),          // case must matter
	} {
		if WorkerAuthOK(bad) {
			t.Errorf("secret %q was accepted", bad)
		}
	}
}

// Fail closed: with nothing configured, NO presented value may authenticate — including the empty
// string a caller sends by simply omitting the header.
func TestWorkerAuthOK_UnconfiguredRejectsEverything(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "")

	for _, presented := range []string{"", "anything", "dev-worker-secret-change-me"} {
		if WorkerAuthOK(presented) {
			t.Errorf("with no secret configured, %q authenticated", presented)
		}
	}
}

// workerSecret must not resurrect a fallback: an unset variable reads back as empty, which
// WorkerAuthOK then refuses.
func TestWorkerSecret_HasNoFallback(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "")
	if got := workerSecret(); got != "" {
		t.Errorf("workerSecret() = %q, want empty — a default here is the bug", got)
	}
}

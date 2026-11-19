package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// The other half of platform's queue-payload test: the CLAIM a job-credential token stands for
// travels through the same Redis as the payloads, and jobcredential.go is in this package, so the
// case lives here. (See services/platform/queue_payload_test.go for the payloads themselves and
// for why a secret in that Redis is permanent.)
// A claim is what the token stands for, and it travels through the same Redis. It must name the
// job, not carry the answer.
func TestAJobCredentialClaimHoldsNoSecret(t *testing.T) {
	data, err := json.Marshal(JobCredentialClaim{
		Kind: JobCredentialConfig, JobID: 1, ResultID: 2, DeviceID: 3, UserID: 4,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	lowered := strings.ToLower(string(data))
	for _, b := range []string{"password", "secret", "username"} {
		if strings.Contains(lowered, b) {
			t.Errorf("the claim carries %q: %s", b, data)
		}
	}
}

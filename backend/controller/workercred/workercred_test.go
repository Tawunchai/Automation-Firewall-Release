package workercred

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// This endpoint hands out a firewall administrator's password. Everything below is about the
// cases where it must NOT.

func request(t *testing.T, secret, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/job-credentials", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if secret != "" {
		c.Request.Header.Set("X-Worker-Secret", secret)
	}
	Redeem(c)
	return w
}

func TestACallerWithoutTheWorkerSecretGetsNothing(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "a-real-worker-secret-value")

	redeemed := false
	old := redeemJobCredential
	redeemJobCredential = func(string) (services.JobCredentialClaim, error) {
		redeemed = true
		return services.JobCredentialClaim{}, nil
	}
	defer func() { redeemJobCredential = old }()

	for _, c := range []struct{ name, secret string }{
		{"no header at all", ""},
		{"the wrong secret", "not-the-secret"},
		{"a prefix of the real one", "a-real-worker"},
	} {
		w := request(t, c.secret, `{"token":"anything"}`)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", c.name, w.Code)
		}
	}
	if redeemed {
		t.Error("a token was looked up for an unauthenticated caller — the secret must be checked first")
	}
}

// Unknown, expired and already-spent are one answer: the worker can do nothing different with any
// of them, and three different answers would say which tokens exist.
func TestAnInvalidTokenIsA404AndSaysWhatToDo(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "a-real-worker-secret-value")

	old := redeemJobCredential
	redeemJobCredential = func(string) (services.JobCredentialClaim, error) {
		return services.JobCredentialClaim{}, services.ErrNoSuchJobCredential
	}
	defer func() { redeemJobCredential = old }()

	w := request(t, "a-real-worker-secret-value", `{"token":"spent"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
	if !strings.Contains(w.Body.String(), "already used") {
		t.Errorf("body = %s — the worker writes this into the job's result row, so it has to "+
			"tell a person what happened", w.Body.String())
	}
}

func TestARequestWithoutATokenIsRefusedBeforeAnythingIsLookedUp(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "a-real-worker-secret-value")

	redeemed := false
	old := redeemJobCredential
	redeemJobCredential = func(string) (services.JobCredentialClaim, error) {
		redeemed = true
		return services.JobCredentialClaim{}, services.ErrNoSuchJobCredential
	}
	defer func() { redeemJobCredential = old }()

	if w := request(t, "a-real-worker-secret-value", `not json`); w.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status = %d, want 400", w.Code)
	}
	if redeemed {
		t.Error("a malformed body still reached the token store")
	}
}

// The happy path, with both halves stubbed: what matters is that the reply carries the login and
// NOTHING else — this response crosses the internal network on every job.
func TestTheReplyCarriesTheLoginAndNothingElse(t *testing.T) {
	t.Setenv("WORKER_SHARED_SECRET", "a-real-worker-secret-value")

	oldRedeem, oldLookup, oldResolve := redeemJobCredential, lookupDevice, resolveLogin
	defer func() { redeemJobCredential, lookupDevice, resolveLogin = oldRedeem, oldLookup, oldResolve }()

	var gotClaim services.JobCredentialClaim
	redeemJobCredential = func(token string) (services.JobCredentialClaim, error) {
		return services.JobCredentialClaim{
			Kind: services.JobCredentialConfig, JobID: 3, ResultID: 9, DeviceID: 1, UserID: 7,
		}, nil
	}
	lookupDevice = func(id uint) (entity.NetworkDevice, error) {
		if id != 1 {
			t.Errorf("looked up device %d, not the one the claim names", id)
		}
		return entity.NetworkDevice{Name: "lab-80e"}, nil
	}
	resolveLogin = func(claim services.JobCredentialClaim, _ *entity.NetworkDevice) (services.DeviceLogin, error) {
		gotClaim = claim
		return services.DeviceLogin{Username: "svc", Password: "s3cret"}, nil
	}

	w := request(t, "a-real-worker-secret-value", `{"token":"good"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if body["username"] != "svc" || body["password"] != "s3cret" {
		t.Errorf("body = %v", body)
	}
	if len(body) != 2 {
		t.Errorf("the reply carries %d fields (%v) — the job message already has the rest, and "+
			"every extra field here is one more thing crossing the network with a password", len(body), body)
	}

	// The claim decides WHOSE credential: a config deploy runs as the person who pressed the
	// button, a scheduled backup as the device's automation account (UserID 0).
	if gotClaim.UserID != 7 {
		t.Errorf("resolved as user %d, want the one in the claim", gotClaim.UserID)
	}
}

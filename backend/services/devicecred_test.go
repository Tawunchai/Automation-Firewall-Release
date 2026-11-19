package services

import (
	"errors"
	"network_automation/services/platform"
	"os"
	"strings"
	"testing"

	"network_automation/entity"
)

// UserIDOf is the one place the gin context value is turned into a user id, and a wrong answer here
// is silent: 0 means "no signed-in user", which makes ResolveDeviceLogin fall back to the shared
// account. The device would then log the change against `admin` while the console believes it acted
// as the person — exactly the confusion the feature removes.
func TestUserIDOf(t *testing.T) {
	if got := UserIDOf(uint(7)); got != 7 {
		t.Errorf("UserIDOf(uint(7)) = %d, want 7", got)
	}
	for name, v := range map[string]any{
		"nil":     nil,
		"int":     int(7), // the type gin would hold if a caller ever c.Set an int
		"string":  "7",
		"float64": float64(7), // what a JSON round-trip would produce
	} {
		if got := UserIDOf(v); got != 0 {
			t.Errorf("UserIDOf(%s) = %d, want 0 — a value that is not a uint must not be read as a user", name, got)
		}
	}
}

// ── ResolveDeviceLogin ────────────────────────────────────────────────────────

// withCredKey sets a usable encryption key for the duration of a test.
func withCredKey(t *testing.T) {
	t.Helper()
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
}

func TestResolveDeviceLogin_FallsBackToTheSharedAccount(t *testing.T) {
	withCredKey(t)

	enc, err := platform.EncryptSecret("shared-pw")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	device := entity.NetworkDevice{Username: "admin", PasswordEnc: enc}
	device.ID = 1

	// db == nil and userID == 0 are the two shapes a background job takes (scheduler, worker
	// callback). Neither has a person behind it, so neither may borrow anyone's account.
	for _, tc := range []struct {
		name   string
		userID uint
	}{
		{"no signed-in user", 0},
		{"a user, but no database", 9},
	} {
		t.Run(tc.name, func(t *testing.T) {
			login, err := ResolveDeviceLogin(nil, tc.userID, &device)
			if err != nil {
				t.Fatalf("ResolveDeviceLogin: %v", err)
			}
			if login.Username != "admin" || login.Password != "shared-pw" {
				t.Errorf("got %q/%q, want the device's own credential", login.Username, login.Password)
			}
			if login.Personal || login.CredentialID != 0 {
				t.Errorf("Personal=%v CredentialID=%d, want the shared credential to be marked as such",
					login.Personal, login.CredentialID)
			}
		})
	}
}

func TestResolveDeviceLogin_ReportsAnUndecryptableSharedSecret(t *testing.T) {
	withCredKey(t)

	device := entity.NetworkDevice{Username: "admin", PasswordEnc: "v1:not-base64-at-all"}
	device.ID = 1

	if _, err := ResolveDeviceLogin(nil, 0, &device); err == nil {
		t.Fatal("a password that cannot be decrypted must be an error, not an empty password sent to the firewall")
	}
}

func TestResolveDeviceLogin_RejectsANilDevice(t *testing.T) {
	if _, err := ResolveDeviceLogin(nil, 1, nil); err == nil {
		t.Fatal("want an error for a nil device")
	}
}

// ── IsDeviceAuthFailure ───────────────────────────────────────────────────────

// The save path refuses a credential the firewall rejected and accepts one it merely could not
// reach. Getting that boundary wrong is expensive in one direction: a stored bad password is
// retried on every page load, and FortiOS locks an admin account after three consecutive failures.
func TestIsDeviceAuthFailure(t *testing.T) {
	authErrors := []string{
		"FortiGate authentication failed (wrong credentials or account locked)",
		"FortiGate API error: HTTP 401 — session expired or invalid credentials",
		"FortiGate API error: HTTP 403 — admin profile may not allow REST API write access",
	}
	for _, msg := range authErrors {
		if !IsDeviceAuthFailure(errors.New(msg)) {
			t.Errorf("IsDeviceAuthFailure(%q) = false, want true", msg)
		}
	}

	reachabilityErrors := []string{
		"FortiGate login failed: dial tcp 10.0.99.201:443: i/o timeout",
		"FortiGate API request failed: connection refused",
		"FortiGate login is temporarily disabled for this device: 2 consecutive failures",
	}
	for _, msg := range reachabilityErrors {
		if IsDeviceAuthFailure(errors.New(msg)) {
			t.Errorf("IsDeviceAuthFailure(%q) = true, want false — an unreachable device says nothing about the password", msg)
		}
	}

	if IsDeviceAuthFailure(nil) {
		t.Error("IsDeviceAuthFailure(nil) = true, want false")
	}
}

// ── Session pool keying ───────────────────────────────────────────────────────

// Two people on one firewall must not share a session. If they did, the second person's changes
// would be made over a session logged in as the first, and the device's event log — the entire
// point of per-user credentials — would name the wrong person.
func TestSessionKey_SeparatesAccountsOnTheSameDevice(t *testing.T) {
	// Two people's own credentials for one firewall. They are separate rows, so they get separate
	// sessions — even when both accounts happen to be called the same thing, which is the case this
	// used to get wrong (see TestSessionKey_SeparatesCredentialsSharingAUsername).
	alice := sessionKey(1, "10.0.99.201", 443, DeviceLogin{Username: "alice", CredentialID: 1}.PoolScope())
	bob := sessionKey(1, "10.0.99.201", 443, DeviceLogin{Username: "bob", CredentialID: 2}.PoolScope())
	if alice == bob {
		t.Fatalf("sessionKey collides across accounts: %q", alice)
	}
	// InvalidateAllDeviceSessions matches on the "<id>|" prefix, so the device id must stay first.
	if !strings.HasPrefix(alice, "1|") {
		t.Errorf("sessionKey = %q, want it to start with the device id so InvalidateAllDeviceSessions still matches", alice)
	}
}

// ── Credential encryption round-trip ──────────────────────────────────────────

// A personal credential is stored with the same versioned AES-256-GCM helpers the device's own
// password uses, so it survives a key rotation the same way.
func TestDeviceCredentialSecretSurvivesKeyRotation(t *testing.T) {
	t.Setenv("CRED_ENC_KEY", "unit-test-key-v1-0123456789abcdef")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")

	v1, err := platform.EncryptSecret("my-own-firewall-password")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}

	// Rotate: a new active version, with v1 still configured so old ciphertext stays readable.
	os.Setenv("CRED_ENC_KEY_V2", "unit-test-key-v2-fedcba9876543210")
	t.Cleanup(func() { os.Unsetenv("CRED_ENC_KEY_V2") })
	t.Setenv("CRED_ENC_KEY_VERSION", "2")

	plain, err := platform.DecryptSecret(v1)
	if err != nil || plain != "my-own-firewall-password" {
		t.Fatalf("DecryptSecret(v1 ciphertext) = %q, %v — a rotation must not lock people out of their own credential", plain, err)
	}

	v2, err := platform.ReencryptSecret(v1)
	if err != nil {
		t.Fatalf("ReencryptSecret: %v", err)
	}
	if platform.CredKeyVersion(v2) != 2 {
		t.Errorf("re-encrypted key version = %d, want 2", platform.CredKeyVersion(v2))
	}
	if got, _ := platform.DecryptSecret(v2); got != "my-own-firewall-password" {
		t.Errorf("DecryptSecret(v2) = %q, want the original", got)
	}
}

// TouchDeviceCredential is called on every device request, so it must be free when there is nothing
// to record and must never panic on a nil database.
func TestTouchDeviceCredential_NoopsWithoutWork(t *testing.T) {
	TouchDeviceCredential(nil, 0)
	TouchDeviceCredential(nil, 5)
	ForgetDeviceCredentialTouch(5)
}

// ── the automation account ───────────────────────────────────────────────────
//
// A device no longer carries a login of its own on the Devices form, so unattended work — auto
// backup, compliance, the Notify sweep — runs as an account somebody nominated for it. The order
// below is the whole contract, and each branch of it fails in a way somebody would have to debug at
// 3am if it were wrong.

func TestResolveAutomationLogin_FallsBackToTheLegacyStoredAccount(t *testing.T) {
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("CRED_ENC_KEY", "9f2c4b1ea77d3568bb0c41d9e5a6f30c9f2c4b1ea77d3568bb0c41d9e5a6f30c")
	enc, err := platform.EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}

	// A device added BEFORE the form stopped asking for a login. Its schedules must keep running.
	device := &entity.NetworkDevice{Name: "FGT-LAB", Username: "admin", PasswordEnc: enc}
	device.ID = 1

	login, err := ResolveAutomationLogin(nil, device)
	if err != nil {
		t.Fatalf("a grandfathered device lost its automation account: %v", err)
	}
	if login.Username != "admin" || login.Password != "P@ssw0rd" {
		t.Errorf("login = %+v, want the stored account", login)
	}
	if login.Personal {
		t.Errorf("the device's own stored account is not a person's")
	}
}

// A device added through the new form has no login at all. That must be a NAMED condition, not a
// generic failure — it is a 30-second fix in the console, and the message has to say so.
func TestResolveAutomationLogin_NoAccountIsItsOwnError(t *testing.T) {
	device := &entity.NetworkDevice{Name: "FGT-NEW"}
	device.ID = 2

	_, err := ResolveAutomationLogin(nil, device)

	if err == nil {
		t.Fatal("a device with no account resolved a login")
	}
	if !errors.Is(err, ErrNoDeviceLogin) {
		t.Errorf("error %v does not wrap ErrNoDeviceLogin — callers cannot tell it apart from an outage", err)
	}
	for _, want := range []string{"FGT-NEW", "Device Credentials"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q, so nobody knows what to fix", err, want)
		}
	}
}

// ── the pool scope ───────────────────────────────────────────────────────────

func TestDeviceLogin_PoolScope(t *testing.T) {
	// The device's own automation slot.
	if got := (DeviceLogin{Username: "admin"}).PoolScope(); got != "automation" {
		t.Errorf("automation scope = %q", got)
	}
	// A person's credential is identified by its ROW, so two people called `admin` do not collide.
	a := DeviceLogin{Username: "admin", CredentialID: 7}.PoolScope()
	b := DeviceLogin{Username: "admin", CredentialID: 8}.PoolScope()
	if a == b {
		t.Errorf("two credentials sharing a username collided on scope %q", a)
	}
	// A password being tested gets a slot of its own, so a typo cannot open the breaker for the
	// account that is already working.
	if probeLogin("admin", "x").PoolScope() == (DeviceLogin{Username: "admin"}).PoolScope() {
		t.Error("a credential test shares the automation account's pool slot")
	}
}

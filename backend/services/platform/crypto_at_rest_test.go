package platform

import (
	"strings"
	"testing"
	"time"

	otplib "github.com/pquerna/otp/totp"
	"network_automation/entity"
)

// Two columns that held secrets in the clear, and the replay guard that goes with one of them.
//
// Everything here is pure: no database, no firewall. What is being pinned is the rule, and the
// rule is the part that is easy to get subtly wrong —
//
//	· a row written BEFORE the column was encrypted must still read back. Backups are what you
//	  reach for on the worst day of the quarter, and a migration that makes the old ones
//	  unreadable is worse than the plaintext it replaced.
//	· a row that IS encrypted and will not decrypt must be an ERROR, never a best-effort empty
//	  string. ConfigBackup.Content goes to FortiClient.RestoreConfigFile, which replaces the whole
//	  configuration and reboots the unit.
//	· the step a TOTP code belongs to has to be identified exactly, because that number is what
//	  stops the code being spent twice.

func withAtRestKey(t *testing.T) {
	t.Helper()
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
}

// ── telling ciphertext from plaintext ────────────────────────────────────────

func TestVersionPrefixedOnlyMatchesTheRealFormat(t *testing.T) {
	encrypted := []string{"v1:abc", "v2:abc", "v10:", "v1:"}
	for _, s := range encrypted {
		if !versionPrefixed(s) {
			t.Errorf("%q was not recognised as versioned ciphertext", s)
		}
	}

	// A false positive here means a plaintext firewall configuration is treated as ciphertext and
	// the restore is refused — or worse, a plaintext TOTP seed stops working. These are the shapes
	// that must NOT match.
	plain := []string{
		"",
		"#config-version=FGT80E-7.2.10-FW-build1706-230207:opmode=0",
		"JBSWY3DPEHPK3PXP",
		"v:abc",      // no number
		"vx:abc",     // not a number
		"v-1:abc",    // not digits
		"v+1:abc",    // not digits
		"v1abc",      // no colon
		"version: 2", // a word that happens to start with v
		"config system global\nset hostname lab\nend",
	}
	for _, s := range plain {
		if versionPrefixed(s) {
			t.Errorf("%q was mistaken for versioned ciphertext", s)
		}
	}
}

// ── ConfigBackup.Content ─────────────────────────────────────────────────────

const sampleConfig = "#config-version=FGT80E-7.2.10-FW-build1706-230207:opmode=0\n" +
	"config system global\nset hostname NGFW-Testing\nend\n" +
	"config vpn ipsec phase1-interface\nedit \"to-branch\"\nset psksecret ENC verysecret\nnext\nend\n"

func TestBackupContentRoundTrips(t *testing.T) {
	withAtRestKey(t)

	var b entity.ConfigBackup
	if err := SetBackupContent(&b, sampleConfig); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}
	if b.Content == sampleConfig {
		t.Fatal("the configuration was stored in plaintext")
	}
	if strings.Contains(b.Content, "psksecret") || strings.Contains(b.Content, "NGFW-Testing") {
		t.Fatal("the stored value still contains readable configuration")
	}
	if !versionPrefixed(b.Content) {
		t.Fatalf("the stored value carries no key-version prefix: %q", b.Content)
	}

	got, err := BackupContent(b)
	if err != nil {
		t.Fatalf("BackupContent: %v", err)
	}
	if got != sampleConfig {
		t.Fatalf("round trip changed the configuration:\n got %q\nwant %q", got, sampleConfig)
	}
}

// Every row already in the database is plaintext. A read must hand it back untouched, and must do
// so even with no key configured at all — the key protects new writes, it must not become a
// prerequisite for reading history.
func TestBackupContentReadsAPlaintextRowWrittenBeforeThisChange(t *testing.T) {
	t.Setenv("CRED_ENC_KEY", "")
	t.Setenv("CRED_ENC_KEY_VERSION", "")

	b := entity.ConfigBackup{Content: sampleConfig}
	got, err := BackupContent(b)
	if err != nil {
		t.Fatalf("a pre-existing plaintext backup failed to read: %v", err)
	}
	if got != sampleConfig {
		t.Fatalf("got %q, want the row as it stands", got)
	}
}

// An empty backup stays empty rather than becoming a ciphertext of "". rollback.go distinguishes
// "this backup has no configuration in it" (a 400 the operator can act on) from "the key is
// wrong" (a platform fault), and that distinction has to survive storage.
func TestSetBackupContentLeavesAnEmptyBackupEmpty(t *testing.T) {
	withAtRestKey(t)

	var b entity.ConfigBackup
	if err := SetBackupContent(&b, ""); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}
	if b.Content != "" {
		t.Fatalf("an empty configuration was stored as %q", b.Content)
	}
	got, err := BackupContent(b)
	if err != nil || got != "" {
		t.Fatalf("BackupContent(empty) = %q, %v", got, err)
	}
}

// The case that would brick a firewall. A row that announces itself as encrypted and does not
// decrypt must produce an error, so that rollback refuses — never ("", nil), which would be
// handed to a configuration restore as "replace everything with nothing".
func TestBackupContentRefusesCiphertextItCannotDecrypt(t *testing.T) {
	withAtRestKey(t)

	var b entity.ConfigBackup
	b.ID = 42
	if err := SetBackupContent(&b, sampleConfig); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}

	// The key is rotated away without the old version being kept, which is the realistic way this
	// happens.
	t.Setenv("CRED_ENC_KEY", "a-completely-different-key-0123456789abc")

	got, err := BackupContent(b)
	if err == nil {
		t.Fatal("an undecryptable backup was reported as readable — a restore would wipe the device")
	}
	if got != "" {
		t.Fatalf("a failed decrypt returned content anyway: %q", got)
	}
	// The message has to name the backup and the key, or the operator cannot act on it.
	for _, want := range []string{"#42", "CRED_ENC_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not mention %q: %v", want, err)
		}
	}
}

// Truncation is the other way a stored configuration goes bad, and GCM is what catches it.
func TestBackupContentRefusesTruncatedCiphertext(t *testing.T) {
	withAtRestKey(t)

	var b entity.ConfigBackup
	if err := SetBackupContent(&b, sampleConfig); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}
	b.Content = b.Content[:len(b.Content)-8]

	if _, err := BackupContent(b); err == nil {
		t.Fatal("a truncated configuration was accepted as valid")
	}
}

// ── UserTOTP.Secret ──────────────────────────────────────────────────────────

const sampleSeed = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"

func TestTOTPSecretRoundTrips(t *testing.T) {
	withAtRestKey(t)

	var row entity.UserTOTP
	if err := SetTOTPSecret(&row, sampleSeed); err != nil {
		t.Fatalf("SetTOTPSecret: %v", err)
	}
	if row.Secret == sampleSeed {
		t.Fatal("the TOTP seed was stored in plaintext")
	}

	got, err := TOTPSecret(row)
	if err != nil {
		t.Fatalf("TOTPSecret: %v", err)
	}
	if got != sampleSeed {
		t.Fatalf("round trip changed the seed: got %q, want %q", got, sampleSeed)
	}
}

// Users enrolled before this change have a plaintext seed, and their phone still works. Signing in
// must not start failing for them.
func TestTOTPSecretReadsASeedEnrolledBeforeThisChange(t *testing.T) {
	t.Setenv("CRED_ENC_KEY", "")
	t.Setenv("CRED_ENC_KEY_VERSION", "")

	got, err := TOTPSecret(entity.UserTOTP{Secret: sampleSeed})
	if err != nil {
		t.Fatalf("a pre-existing plaintext seed failed to read: %v", err)
	}
	if got != sampleSeed {
		t.Fatalf("got %q, want the seed as stored", got)
	}
}

// A seed that will not decrypt is an error, not an empty string: validateTOTPStep("", code) would
// answer "wrong code", which tells the user to check their phone about a problem in the key
// configuration.
func TestTOTPSecretRefusesCiphertextItCannotDecrypt(t *testing.T) {
	withAtRestKey(t)

	var row entity.UserTOTP
	if err := SetTOTPSecret(&row, sampleSeed); err != nil {
		t.Fatalf("SetTOTPSecret: %v", err)
	}
	t.Setenv("CRED_ENC_KEY", "a-completely-different-key-0123456789abc")

	got, err := TOTPSecret(row)
	if err == nil {
		t.Fatal("an undecryptable seed was reported as readable")
	}
	if got != "" {
		t.Fatalf("a failed decrypt returned a seed anyway: %q", got)
	}
}

// Both columns are encrypted by the same versioned helpers, so ReencryptSecret moves them to a new
// key exactly as it does a device password. Without that, /admin/rotate-cred-key would silently
// leave two kinds of secret behind on the old key.
func TestAtRestSecretsSurviveAKeyRotation(t *testing.T) {
	t.Setenv("CRED_ENC_KEY", "unit-test-key-v1-0123456789abcdef")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")

	var b entity.ConfigBackup
	if err := SetBackupContent(&b, sampleConfig); err != nil {
		t.Fatalf("SetBackupContent: %v", err)
	}
	if v := CredKeyVersion(b.Content); v != 1 {
		t.Fatalf("stored under key version %d, want 1", v)
	}

	// Rotate, keeping v1 readable — the documented procedure in crypto.go.
	t.Setenv("CRED_ENC_KEY_V2", "unit-test-key-v2-fedcba9876543210")
	t.Setenv("CRED_ENC_KEY_VERSION", "2")

	rotated, err := ReencryptSecret(b.Content)
	if err != nil {
		t.Fatalf("ReencryptSecret: %v", err)
	}
	if v := CredKeyVersion(rotated); v != 2 {
		t.Fatalf("re-encrypted under key version %d, want 2", v)
	}

	b.Content = rotated
	got, err := BackupContent(b)
	if err != nil || got != sampleConfig {
		t.Fatalf("after rotation the configuration reads as %q, %v", got, err)
	}
}

// ── which step a code belongs to ─────────────────────────────────────────────

// The replay guard is only as good as this: the step has to be the one the code was actually
// generated for, or the guard either refuses valid codes or lets a replay through.
func TestValidateTOTPStepIdentifiesTheStepTheCodeWasMadeFor(t *testing.T) {
	// A fixed instant, mid-step, so the test does not change behaviour depending on when it runs.
	now := time.Unix(1_800_000_015, 0)

	for _, offset := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		at := now.Add(offset)
		code, err := otplib.GenerateCode(sampleSeed, at)
		if err != nil {
			t.Fatalf("generate a code: %v", err)
		}
		step, ok := validateTOTPStep(sampleSeed, code, now)
		if !ok {
			t.Fatalf("a code from %v was rejected — ValidateTOTP accepts one step either side", offset)
		}
		if want := TOTPStepAt(at); step != want {
			t.Errorf("a code from %v was attributed to step %d, want %d", offset, step, want)
		}
	}
}

// Outside the skew the answer is no, with no step. Accepting two steps either side would double
// the window a captured code is useful for.
func TestValidateTOTPStepRejectsCodesOutsideTheSkew(t *testing.T) {
	now := time.Unix(1_800_000_015, 0)

	for _, offset := range []time.Duration{-90 * time.Second, -60 * time.Second, 60 * time.Second, 90 * time.Second} {
		code, err := otplib.GenerateCode(sampleSeed, now.Add(offset))
		if err != nil {
			t.Fatalf("generate a code: %v", err)
		}
		if step, ok := validateTOTPStep(sampleSeed, code, now); ok {
			t.Errorf("a code from %v was accepted (step %d)", offset, step)
		}
	}
}

func TestValidateTOTPStepRejectsRubbish(t *testing.T) {
	now := time.Now()
	for _, code := range []string{"", "000000", "12345", "abcdef"} {
		if _, ok := validateTOTPStep(sampleSeed, code, now); ok {
			// "000000" is a real code for some step of some secret, so a failure here is only
			// meaningful for this seed at this moment — which is exactly what is being checked.
			t.Errorf("%q was accepted", code)
		}
	}
	if _, ok := validateTOTPStep("", "123456", now); ok {
		t.Error("a code was accepted against an empty secret")
	}
}

// The arithmetic the guard's comparison depends on: steps are 30 seconds wide and increase.
func TestTOTPStepAtIsThirtySecondsWide(t *testing.T) {
	base := time.Unix(1_800_000_000, 0)
	if a, b := TOTPStepAt(base), TOTPStepAt(base.Add(29*time.Second)); a != b {
		t.Errorf("29 seconds apart gave different steps (%d, %d)", a, b)
	}
	if a, b := TOTPStepAt(base), TOTPStepAt(base.Add(30*time.Second)); b != a+1 {
		t.Errorf("30 seconds later is step %d, want %d", b, a+1)
	}
}

// AcceptTOTPCode needs a row that exists; without one there is nowhere to record the spend, and a
// code that cannot be spent must not be accepted.
func TestAcceptTOTPCodeRefusesWithoutAStoredEnrolment(t *testing.T) {
	if _, err := AcceptTOTPCode(nil, nil, "123456", time.Now()); err == nil {
		t.Error("a code was checked with no database and no enrolment")
	}
	if _, err := AcceptTOTPCode(nil, &entity.UserTOTP{}, "123456", time.Now()); err == nil {
		t.Error("a code was checked against an unsaved enrolment (id 0)")
	}
}

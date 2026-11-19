package platform

import (
	"fmt"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"gorm.io/gorm"

	"network_automation/entity"
)

// Secrets that are not device credentials, but are stored in the same database.
//
// crypto.go protects NetworkDevice.PasswordEnc with AES-256-GCM. Two other columns hold material
// that is just as sensitive and were kept in the clear:
//
//   - ConfigBackup.Content — the device's entire `show full-configuration`. That file contains
//     IPsec pre-shared keys, SNMP communities, RADIUS secrets and administrator password hashes,
//     so a plaintext backup of a firewall hands over everything the encrypted password_enc column
//     of the SAME device was protecting.
//   - UserTOTP.Secret — the base32 seed of a user's authenticator. Anyone who can read it can mint
//     that account's second factor forever, and unlike a password it is never rotated.
//
// Both go through one pair of accessors per entity, below, built on EncryptSecret/DecryptSecret so
// they inherit the versioned "vN:" ciphertext format and the existing key-rotation machinery
// (ReencryptSecret, /admin/rotate-cred-key).
//
// The accessors live here and not on the entities because entity may not import services — the
// cycle would be entity → services → entity.
//
// ── Reading rows written before this change ──────────────────────────────────
//
// Every row already in the database is plaintext, and a backup is the thing you reach for on the
// worst day of the quarter. So a read NEVER fails because a value is not encrypted: a stored value
// without the "vN:" prefix is returned exactly as it is. A value WITH the prefix must decrypt, and
// a failure is an error the caller reports — see the note on decryptAtRest.
//
// Nothing migrates the old rows in bulk. They are re-encrypted the next time they are written
// (a TOTP re-enrolment, a fresh backup), and the ones that are never rewritten stay readable.

// versionPrefixed reports whether a stored value carries the "v<N>:" prefix EncryptSecret writes.
//
// Deliberately strict — N must be one or more digits and nothing else — because the alternative
// reading of a false positive is "treat a plaintext firewall configuration as ciphertext and
// refuse to restore it". A FortiOS configuration file starts with "#config-version=", and a base32
// TOTP seed is uppercase A-Z and 2-7, so neither can collide with a lowercase "v" followed by
// digits and a colon.
func versionPrefixed(stored string) bool {
	rest, ok := strings.CutPrefix(stored, credKeyVersionPrefix)
	if !ok {
		return false
	}
	idx := strings.Index(rest, ":")
	if idx <= 0 {
		return false
	}
	for _, r := range rest[:idx] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// decryptAtRest returns a stored value as plaintext, whichever form it is in.
//
// The error case matters more than it looks. ConfigBackup.Content is handed to
// FortiClient.RestoreConfigFile, and a FortiOS configuration restore REPLACES the whole
// configuration and reboots the unit: restoring an empty or truncated string would brick the
// firewall. So this returns ("", err) and never a best-effort empty string — callers must refuse
// to proceed, not proceed with nothing.
func decryptAtRest(stored, what string) (string, error) {
	if !versionPrefixed(stored) {
		return stored, nil // written before this column was encrypted
	}
	plain, err := DecryptSecret(stored)
	if err != nil {
		return "", fmt.Errorf("%s is encrypted but could not be decrypted (wrong or missing %s?): %w",
			what, credKeyEnvName(CredKeyVersion(stored)), err)
	}
	return plain, nil
}

// encryptAtRest encrypts a value for storage, leaving an empty value empty.
//
// An empty string is stored empty on purpose: there is no secret in it, and the "has this backup
// got any content at all" checks (rollback.go) stay answerable without a key.
func encryptAtRest(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	return EncryptSecret(plain)
}

// ── ConfigBackup.Content ─────────────────────────────────────────────────────

// BackupContent returns a stored backup's configuration file as plaintext.
//
// Takes the row by value: this is a read, and no caller should be able to mistake it for one that
// decrypts the row in place.
func BackupContent(b entity.ConfigBackup) (string, error) {
	return decryptAtRest(b.Content, fmt.Sprintf("the stored configuration of backup #%d", b.ID))
}

// SetBackupContent encrypts a configuration file into the row, ready to be saved.
//
// It does NOT write to the database — the caller still does the Create/Save — so the same function
// serves the worker callback, the pre-deploy snapshot and any test.
func SetBackupContent(b *entity.ConfigBackup, content string) error {
	if b == nil {
		return fmt.Errorf("SetBackupContent: nil backup")
	}
	enc, err := encryptAtRest(content)
	if err != nil {
		return fmt.Errorf("could not encrypt the configuration for storage: %w", err)
	}
	b.Content = enc
	return nil
}

// ── UserTOTP.Secret ──────────────────────────────────────────────────────────

// TOTPSecret returns a user's authenticator seed as plaintext.
func TOTPSecret(t entity.UserTOTP) (string, error) {
	return decryptAtRest(t.Secret, "the stored TOTP secret")
}

// SetTOTPSecret encrypts an authenticator seed into the row, ready to be saved.
func SetTOTPSecret(t *entity.UserTOTP, secret string) error {
	if t == nil {
		return fmt.Errorf("SetTOTPSecret: nil record")
	}
	enc, err := encryptAtRest(secret)
	if err != nil {
		return fmt.Errorf("could not encrypt the TOTP secret for storage: %w", err)
	}
	t.Secret = enc
	return nil
}

// ── Spending a TOTP code exactly once ────────────────────────────────────────
//
// A code is valid for its own 30-second step and the library accepts one step either side, so the
// same six digits work for roughly 90 seconds. RFC 6238 §5.2 requires a verifier to accept each
// one only once, and ValidateTOTP cannot help with that: it answers yes/no and never says WHICH
// step matched, so there is nothing to record.
//
// validateTOTPStep answers the same question and also names the step, which is the piece
// UserTOTP.LastTOTPStep stores. It lives beside the secret accessors because it is the other half
// of protecting the same seed, and because services/totp.go is owned elsewhere this round.

// totpPeriod and totpSkewSteps mirror what services.ValidateTOTP (and therefore every code already
// issued by this platform) accepts: a 30-second step, one step of tolerance either way.
const (
	totpPeriod    = 30
	totpSkewSteps = 1
)

// TOTPStepAt returns the time step a moment falls in. Exported for the replay guard's tests.
func TOTPStepAt(t time.Time) int64 {
	return t.Unix() / totpPeriod
}

// validateTOTPStep reports whether code is valid for secret at the given moment, and if so which
// time step it belongs to.
//
// The step is returned so the caller can refuse one that has already been spent. Skew is walked
// here, one step at a time with the library's own skew set to zero, because a single
// totp.Validate call with Skew=1 collapses three steps into one boolean.
//
// The current step is tried first: when two steps somehow produce the same digits, attributing the
// code to "now" is the reading that does not retroactively invalidate a code the user has not
// reached yet.
func validateTOTPStep(secret, code string, now time.Time) (int64, bool) {
	if secret == "" || code == "" {
		return 0, false
	}
	opts := totp.ValidateOpts{
		Period:    totpPeriod,
		Skew:      0,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	}
	current := TOTPStepAt(now)
	for _, delta := range []int64{0, -totpSkewSteps, totpSkewSteps} {
		step := current + delta
		ok, err := totp.ValidateCustom(code, secret, time.Unix(step*totpPeriod, 0), opts)
		if err == nil && ok {
			return step, true
		}
	}
	return 0, false
}

// AcceptTOTPCode validates a six-digit code against a stored enrolment and SPENDS it, so the same
// code cannot be presented a second time.
//
// This is the only way either verify path (enrolment confirm and sign-in) should check a TOTP
// code: it is where the seed is decrypted, where the step is worked out, and where the step is
// claimed — all three in one place, because getting two of the three right is the same as getting
// none of them right.
//
// Returns:
//
//	(true, nil)   the code is valid, was not already spent, and is now recorded as spent
//	(false, nil)  the code is wrong, or it is a replay — the caller must not distinguish them in
//	              what it tells the client: "already used" confirms to whoever captured a code that
//	              they had the right digits
//	(false, err)  the enrolment could not be read, or the spend could not be recorded. The caller
//	              must REFUSE, not fall through: accepting a code whose step could not be stored
//	              hands out a session with no replay protection at all.
//
// The claim is a compare-and-set in one statement (`last_totp_step < step`) rather than a read
// followed by a write, so two requests arriving with the same captured code at the same moment
// cannot both be told they were first — which is exactly the race an attacker racing the real user
// would be trying to win.
func AcceptTOTPCode(db *gorm.DB, row *entity.UserTOTP, code string, now time.Time) (bool, error) {
	if db == nil || row == nil || row.ID == 0 {
		return false, fmt.Errorf("AcceptTOTPCode: no enrolment to check against")
	}

	secret, err := TOTPSecret(*row)
	if err != nil {
		return false, err
	}

	step, ok := validateTOTPStep(secret, code, now)
	if !ok {
		return false, nil
	}

	// Named column, never Save of the struct: GORM drops zero-value fields from a Save when the
	// field has a `default` tag, and the default would then win.
	res := db.Model(&entity.UserTOTP{}).
		Where("id = ? AND last_totp_step < ?", row.ID, step).
		Update("last_totp_step", step)
	if res.Error != nil {
		return false, fmt.Errorf("could not record that the code was used: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return false, nil // this step was already spent — a replay
	}

	row.LastTOTPStep = step
	return true, nil
}

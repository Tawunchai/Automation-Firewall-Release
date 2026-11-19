package platform

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"testing"

	"golang.org/x/crypto/ssh"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
)

// CheckOrPinFingerprint against a real database.
//
// sshhostkey_test.go pins the RULE without a database. This pins the part that needs one: that the
// first key is really written, that the second connection is really compared against the row
// rather than re-pinned, and that a changed key is refused even on the tenth attempt.
//
// It matters more than it would for an ordinary table, because this one function is now the ONLY
// contact the trust-on-first-use rule has with storage, and two different programs reach it — the
// Go SSH dialler through VerifyOrPinHostKey, and the Python worker through
// POST /internal/ssh-host-key. A bug here lets a firewall be "known" to one of them and unknown to
// the other.
//
// Skipped unless HOSTKEY_DB_TEST_DSN names a database it may freely write to and empty. Point it at
// a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55436:5432 -e POSTGRES_PASSWORD=test --name hostkey-pg postgres:16-alpine
//	HOSTKEY_DB_TEST_DSN="host=localhost port=55436 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run TestHostKeyStore -v

func hostKeyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("HOSTKEY_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("HOSTKEY_DB_TEST_DSN not set — see the note at the top of sshhostkey_db_test.go")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.AutoMigrate(&entity.SSHHostKey{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Exec("TRUNCATE TABLE ssh_host_keys RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("clear: %v", err)
	}

	// The store is package-level state, so it is restored even on failure: leaving a test's
	// database wired would make every later test in this package write into it.
	saved := hostKeyStore()
	SetHostKeyStore(db)
	t.Cleanup(func() { SetHostKeyStore(saved) })

	return db
}

// mustGenerateEd25519 makes a throwaway host key.
//
// A real key, rather than a made-up fingerprint string, for one test: the fingerprint that reaches
// the database then comes from ssh.FingerprintSHA256 itself, which is the exact spelling
// worker/host_keys.py has to reproduce in Python. A hand-written constant would agree with itself
// and prove nothing about that.
func mustGenerateEd25519(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	return priv
}

const (
	hostKeyTestHost  = "10.10.20.90:22"
	hostKeyTestFirst = "SHA256:AAAAtheFirstKeyThisConsoleEverSawOnThisHost"
	hostKeyTestOther = "SHA256:BBBBsomeoneElsesKeyOnTheSameAddress00000000"
)

func TestHostKeyStorePinsTheFirstKeyAndThenComparesAgainstIt(t *testing.T) {
	db := hostKeyTestDB(t)

	// 1. Never seen: remembered.
	verdict, expected, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestFirst)
	if err != nil {
		t.Fatalf("first sighting: %v", err)
	}
	if verdict != HostKeyVerdictPinned {
		t.Fatalf("verdict = %q, want %q", verdict, HostKeyVerdictPinned)
	}
	if expected != "" {
		t.Errorf("expected = %q on a first sighting; there is nothing to compare against", expected)
	}

	var row entity.SSHHostKey
	if err := db.Where("host = ?", hostKeyTestHost).First(&row).Error; err != nil {
		t.Fatalf("nothing was written: %v", err)
	}
	if row.Fingerprint != hostKeyTestFirst || row.KeyType != "ssh-ed25519" {
		t.Errorf("stored %s %s", row.KeyType, row.Fingerprint)
	}
	if row.FirstSeenAt.IsZero() || row.LastSeenAt.IsZero() {
		t.Error("first_seen_at / last_seen_at were not set")
	}
	firstSeen := row.FirstSeenAt

	// 2. Same key: confirmed, and still exactly one row.
	verdict, _, err = CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestFirst)
	if err != nil {
		t.Fatalf("second sighting: %v", err)
	}
	if verdict != HostKeyVerdictMatch {
		t.Fatalf("verdict = %q, want %q — the key was re-pinned instead of compared",
			verdict, HostKeyVerdictMatch)
	}
	var n int64
	db.Model(&entity.SSHHostKey{}).Where("host = ?", hostKeyTestHost).Count(&n)
	if n != 1 {
		t.Fatalf("%d rows for one host; a second pin means neither is ever checked", n)
	}

	// first_seen_at is the evidence of WHEN this console first trusted the host. Touching it on
	// every connection would erase that.
	db.Where("host = ?", hostKeyTestHost).First(&row)
	if !row.FirstSeenAt.Equal(firstSeen) {
		t.Errorf("first_seen_at moved from %v to %v", firstSeen, row.FirstSeenAt)
	}
}

// A changed key is refused every time, and the stored pin is left alone.
//
// The tempting shortcut when a firmware upgrade regenerates a key is to accept the new one and
// update the row. That would make the check decorative: whoever can present a key once can present
// it repeatedly, so "it has been like this for a while" is not evidence of anything.
func TestHostKeyStoreNeverAcceptsOrOverwritesAChangedKey(t *testing.T) {
	db := hostKeyTestDB(t)

	if _, _, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestFirst); err != nil {
		t.Fatalf("pin: %v", err)
	}

	for i := 1; i <= 10; i++ {
		// Same algorithm, different key: a CHANGED key, not a second algorithm.
		verdict, expected, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestOther)
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if verdict != HostKeyVerdictMismatch {
			t.Fatalf("attempt %d: verdict = %q, want %q", i, verdict, HostKeyVerdictMismatch)
		}
		if expected != hostKeyTestFirst {
			t.Fatalf("attempt %d: expected = %q, want the stored %q — an operator cannot compare "+
				"fingerprints without it", i, expected, hostKeyTestFirst)
		}
	}

	var row entity.SSHHostKey
	db.Where("host = ? AND key_type = ?", hostKeyTestHost, "ssh-ed25519").First(&row)
	if row.Fingerprint != hostKeyTestFirst {
		t.Fatalf("the stored pin became %q — ten refusals overwrote it", row.Fingerprint)
	}
	if row.KeyType != "ssh-ed25519" {
		t.Errorf("key_type became %q", row.KeyType)
	}
}

// One pin per host:port. A firewall reachable on two ports is two hosts, and the same address on a
// different port must not inherit the first one's key.
func TestHostKeyStoreKeysOnHostAndPortTogether(t *testing.T) {
	hostKeyTestDB(t)

	if _, _, err := CheckOrPinFingerprint("10.10.20.90:22", "ssh-ed25519", hostKeyTestFirst); err != nil {
		t.Fatalf("pin :22: %v", err)
	}
	verdict, _, err := CheckOrPinFingerprint("10.10.20.90:2222", "ssh-ed25519", hostKeyTestOther)
	if err != nil {
		t.Fatalf("pin :2222: %v", err)
	}
	if verdict != HostKeyVerdictPinned {
		t.Errorf("verdict = %q for a different port, want %q", verdict, HostKeyVerdictPinned)
	}
}

// The case that was found by running this against the real firewall, and the reason the unique key
// is a pair.
//
// The lab FGT80E holds both an RSA and an ED25519 host key. Go's x/crypto/ssh default preference
// negotiates ssh-rsa; paramiko 4.0's negotiates ssh-ed25519. Both are genuine keys of that one
// firewall. Keyed on the host alone, the console pinned whichever it met first and then refused
// the other half of its own system on every backup, with a message saying the host key had
// changed — a false alarm that reads exactly like an attack in progress.
func TestHostKeyStoreHoldsOnePinPerAlgorithmOfTheSameDevice(t *testing.T) {
	db := hostKeyTestDB(t)

	const (
		rsaFP = "SHA256:Ps3dldtCQRF1dNSVDXoyzU5BXp6re3FVzQf58jSV0Lo" // what Go negotiated, live
		edFP  = "SHA256:3xeq9NF7B+widM/aNiiqcaA3gupfZgh3IxPY0FCFOUs" // what paramiko negotiated
	)

	// The Go side meets it first and pins the RSA key.
	if v, _, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-rsa", rsaFP); err != nil || v != HostKeyVerdictPinned {
		t.Fatalf("pin ssh-rsa: verdict %q err %v", v, err)
	}

	// The worker then arrives with the ED25519 key of the SAME device. It must be pinned in its
	// own right, not read as the RSA pin having changed.
	v, expected, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", edFP)
	if err != nil {
		t.Fatalf("pin ssh-ed25519: %v", err)
	}
	if v != HostKeyVerdictPinned {
		t.Fatalf("verdict = %q (expected %q), want %q — the second algorithm of one device was "+
			"read as a changed key, which is the false alarm this keying exists to prevent",
			v, expected, HostKeyVerdictPinned)
	}

	// Two rows, one host, and each now verifies against itself.
	var n int64
	db.Model(&entity.SSHHostKey{}).Where("host = ?", hostKeyTestHost).Count(&n)
	if n != 2 {
		t.Fatalf("%d rows for a host with two host keys, want 2", n)
	}
	for _, c := range []struct{ keyType, fp string }{{"ssh-rsa", rsaFP}, {"ssh-ed25519", edFP}} {
		if v, _, err := CheckOrPinFingerprint(hostKeyTestHost, c.keyType, c.fp); err != nil || v != HostKeyVerdictMatch {
			t.Errorf("%s: verdict %q err %v, want %q", c.keyType, v, err, HostKeyVerdictMatch)
		}
	}

	// And a wrong key of an algorithm that IS pinned is still refused — the per-algorithm keying
	// must not have turned the check into a formality.
	v, expected, err = CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestOther)
	if err != nil {
		t.Fatalf("changed ed25519 key: %v", err)
	}
	if v != HostKeyVerdictMismatch || expected != edFP {
		t.Errorf("verdict %q / expected %q, want %q / %q", v, expected, HostKeyVerdictMismatch, edFP)
	}
}

// A fingerprint with no algorithm beside it is refused, rather than stored under the empty type
// where no client would ever look it up again.
func TestHostKeyStoreRefusesAnEmptyKeyType(t *testing.T) {
	db := hostKeyTestDB(t)

	if _, _, err := CheckOrPinFingerprint(hostKeyTestHost, "", hostKeyTestFirst); err == nil {
		t.Fatal("a fingerprint with no key type was accepted")
	}
	var n int64
	db.Model(&entity.SSHHostKey{}).Count(&n)
	if n != 0 {
		t.Errorf("%d rows written for an empty key type", n)
	}
}

// An empty fingerprint is a bug in the caller, and must not be allowed to read as "no pin yet" and
// create a row that then matches nothing.
func TestHostKeyStoreRefusesAnEmptyFingerprint(t *testing.T) {
	db := hostKeyTestDB(t)

	if _, _, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", ""); err == nil {
		t.Fatal("an empty fingerprint was accepted")
	}
	var n int64
	db.Model(&entity.SSHHostKey{}).Count(&n)
	if n != 0 {
		t.Errorf("%d rows written for an empty fingerprint", n)
	}
}

// With no store wired, every caller gets ErrHostKeyStoreUnset and nobody gets a verdict.
//
// This is the branch a boot-order mistake in main.go reaches. The one answer it must never produce
// is "match" — the Go dialler turns this into a refusal and the HTTP endpoint into a 503, and both
// depend on being able to tell this error apart from a database failure.
func TestHostKeyStoreUnsetIsItsOwnError(t *testing.T) {
	saved := hostKeyStore()
	SetHostKeyStore(nil)
	defer SetHostKeyStore(saved)

	verdict, _, err := CheckOrPinFingerprint(hostKeyTestHost, "ssh-ed25519", hostKeyTestFirst)
	if !errors.Is(err, ErrHostKeyStoreUnset) {
		t.Fatalf("err = %v, want ErrHostKeyStoreUnset", err)
	}
	if verdict != "" {
		t.Errorf("verdict = %q with no store", verdict)
	}
}

// And the Go dialler's callback really does go through the same store, so the worker and the
// console cannot disagree about a host they have both met.
//
// It is one table or it is nothing: two stores would each learn their own first key, possibly from
// different connections, and each would then verify happily against it.
func TestHostKeyCallbackAndTheWorkerEndpointShareOnePin(t *testing.T) {
	db := hostKeyTestDB(t)

	// A real key, so the fingerprint is the one ssh.FingerprintSHA256 produces rather than a
	// string this test made up — which is exactly what the worker has to reproduce in Python.
	signer, err := ssh.NewSignerFromKey(mustGenerateEd25519(t))
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	pub := signer.PublicKey()
	fp := ssh.FingerprintSHA256(pub)

	// The Go dialler meets it first and pins it.
	if err := VerifyOrPinHostKey("FortiGate-80E")(hostKeyTestHost, nil, pub); err != nil {
		t.Fatalf("the Go side refused a first connection: %v", err)
	}

	// The worker then presents the SAME fingerprint, measured in Python, and must be told "match"
	// — not pinned again.
	verdict, _, err := CheckOrPinFingerprint(hostKeyTestHost, pub.Type(), fp)
	if err != nil {
		t.Fatalf("worker check: %v", err)
	}
	if verdict != HostKeyVerdictMatch {
		t.Fatalf("verdict = %q, want %q — the two halves are not reading one pin",
			verdict, HostKeyVerdictMatch)
	}
	var n int64
	db.Model(&entity.SSHHostKey{}).Where("host = ?", hostKeyTestHost).Count(&n)
	if n != 1 {
		t.Fatalf("%d rows for one host", n)
	}

	// And a different key refuses on both paths.
	other, err := ssh.NewSignerFromKey(mustGenerateEd25519(t))
	if err != nil {
		t.Fatalf("second signer: %v", err)
	}
	if err := VerifyOrPinHostKey("FortiGate-80E")(hostKeyTestHost, nil, other.PublicKey()); err == nil {
		t.Error("the Go side accepted a changed key")
	}
	verdict, expected, err := CheckOrPinFingerprint(
		hostKeyTestHost, other.PublicKey().Type(), ssh.FingerprintSHA256(other.PublicKey()))
	if err != nil {
		t.Fatalf("worker check of a changed key: %v", err)
	}
	if verdict != HostKeyVerdictMismatch || expected != fp {
		t.Errorf("worker got %q / %q, want %q / %q", verdict, expected, HostKeyVerdictMismatch, fp)
	}
}

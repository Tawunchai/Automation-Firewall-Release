package platform

import (
	"crypto/tls"
	"crypto/x509"
	"os"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
)

// checkOrPinCertificate against a real database.
//
// This check sits in front of EVERY FortiGate REST call — every page of this console reads the
// firewall through it — so the thing to get right is not only that a changed certificate is
// refused, but that an unchanged one is never mistaken for a changed one. A false positive here
// takes the whole console down.
//
// Skipped unless TLSPIN_DB_TEST_DSN names a database it may freely write to and empty. Point it at
// a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55437:5432 -e POSTGRES_PASSWORD=test --name tlspin-pg postgres:16-alpine
//	TLSPIN_DB_TEST_DSN="host=localhost port=55437 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run TestTLSPin -v

func tlsPinTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TLSPIN_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("TLSPIN_DB_TEST_DSN not set — see the note at the top of tlspin_db_test.go")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.AutoMigrate(&entity.DeviceTLSPin{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Exec("TRUNCATE TABLE device_tls_pins RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("clear: %v", err)
	}

	saved := tlsPinStore()
	SetTLSPinStore(db)
	t.Cleanup(func() { SetTLSPinStore(saved) })

	return db
}

const tlsPinTestHost = "10.10.20.90:443"

func TestTLSPinRemembersTheFirstCertificateAndConfirmsItAfterwards(t *testing.T) {
	db := tlsPinTestDB(t)
	cert := testCert(t)

	verdict, expected, err := checkOrPinCertificate(tlsPinTestHost, cert)
	if err != nil {
		t.Fatalf("first sighting: %v", err)
	}
	if verdict != HostKeyVerdictPinned {
		t.Fatalf("verdict = %q, want %q", verdict, HostKeyVerdictPinned)
	}
	if expected != "" {
		t.Errorf("expected = %q on a first sighting", expected)
	}

	var row entity.DeviceTLSPin
	if err := db.Where("host = ?", tlsPinTestHost).First(&row).Error; err != nil {
		t.Fatalf("nothing was written: %v", err)
	}
	if row.Fingerprint != certFingerprint(cert) {
		t.Errorf("stored fingerprint %q", row.Fingerprint)
	}
	// Recorded for the person who will have to decide whether a future change is legitimate. An
	// expiry that has just passed is the ordinary explanation, and without it they cannot see that.
	if row.Subject != "FortiGate" || row.Issuer != "FortiGate" {
		t.Errorf("subject/issuer stored as %q/%q", row.Subject, row.Issuer)
	}
	if row.NotAfter.IsZero() {
		t.Error("not_after was not recorded, so an expired certificate cannot be told from a swapped one")
	}

	// The same certificate, ten more times: confirmed, never re-pinned, and still one row.
	for i := 0; i < 10; i++ {
		verdict, _, err := checkOrPinCertificate(tlsPinTestHost, cert)
		if err != nil || verdict != HostKeyVerdictMatch {
			t.Fatalf("connection %d: verdict %q err %v, want %q — a false mismatch here empties "+
				"every page of the console", i+2, verdict, err, HostKeyVerdictMatch)
		}
	}
	var n int64
	db.Model(&entity.DeviceTLSPin{}).Where("host = ?", tlsPinTestHost).Count(&n)
	if n != 1 {
		t.Fatalf("%d rows for one host", n)
	}
}

// A different certificate on the same host is refused every time, and the pin is left alone.
func TestTLSPinRefusesAChangedCertificateAndKeepsThePin(t *testing.T) {
	db := tlsPinTestDB(t)
	original := testCert(t)
	replacement := testCert(t) // a second, independently generated self-signed certificate

	if _, _, err := checkOrPinCertificate(tlsPinTestHost, original); err != nil {
		t.Fatalf("pin: %v", err)
	}

	for i := 1; i <= 5; i++ {
		verdict, expected, err := checkOrPinCertificate(tlsPinTestHost, replacement)
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if verdict != HostKeyVerdictMismatch {
			t.Fatalf("attempt %d: verdict = %q, want %q", i, verdict, HostKeyVerdictMismatch)
		}
		if expected != certFingerprint(original) {
			t.Fatalf("attempt %d: expected = %q, want the stored one", i, expected)
		}
	}

	var row entity.DeviceTLSPin
	db.Where("host = ?", tlsPinTestHost).First(&row)
	if row.Fingerprint != certFingerprint(original) {
		t.Fatal("five refusals overwrote the pin — the check would then verify against whatever " +
			"presented itself most recently")
	}
}

// And the dialler's own check turns that verdict into a refused connection whose message names
// both fingerprints, because a person has to compare them against the firewall's GUI.
func TestTLSPinDiallerRefusesWithBothFingerprintsInTheMessage(t *testing.T) {
	tlsPinTestDB(t)
	original := testCert(t)
	replacement := testCert(t)

	cs := func(c *x509.Certificate) tls.ConnectionState {
		return tls.ConnectionState{PeerCertificates: []*x509.Certificate{c}}
	}

	if err := VerifyPinnedCertificate(tlsPinTestHost, cs(original)); err != nil {
		t.Fatalf("the first connection was refused: %v", err)
	}
	if err := VerifyPinnedCertificate(tlsPinTestHost, cs(original)); err != nil {
		t.Fatalf("the second connection to the same device was refused: %v", err)
	}

	err := VerifyPinnedCertificate(tlsPinTestHost, cs(replacement))
	if err == nil {
		t.Fatal("a changed certificate was accepted")
	}
	msg := err.Error()
	for _, want := range []string{
		certFingerprint(original),    // what to expect
		certFingerprint(replacement), // what arrived
		"has changed",
		"regenerating", // so an administrator who just replaced it reads it correctly
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("the refusal does not mention %q:\n%s", want, msg)
		}
	}
}

// One pin per host:port, so the same firewall on a second port is a second identity rather than
// inheriting the first one's certificate.
func TestTLSPinKeysOnHostAndPort(t *testing.T) {
	tlsPinTestDB(t)

	if _, _, err := checkOrPinCertificate("10.10.20.90:443", testCert(t)); err != nil {
		t.Fatalf("pin :443: %v", err)
	}
	verdict, _, err := checkOrPinCertificate("10.10.20.90:8443", testCert(t))
	if err != nil {
		t.Fatalf("pin :8443: %v", err)
	}
	if verdict != HostKeyVerdictPinned {
		t.Errorf("verdict = %q on a different port, want %q", verdict, HostKeyVerdictPinned)
	}
}

// Clearing a pin — what controller/hostpin does — must let the next connection pin afresh.
//
// Asserted here because the clear has to be a HARD delete: a soft-deleted row stays invisible to
// the check (it reads under GORM's default scope) while still occupying the unique index, so the
// next connection would fail to insert instead of remembering the new certificate. The clear would
// look like it worked and the device would be unreachable for a different reason.
func TestTLSPinClearedPinIsRePinnedOnTheNextConnection(t *testing.T) {
	db := tlsPinTestDB(t)
	original := testCert(t)
	replacement := testCert(t)

	if _, _, err := checkOrPinCertificate(tlsPinTestHost, original); err != nil {
		t.Fatalf("pin: %v", err)
	}
	if err := db.Unscoped().Where("host = ?", tlsPinTestHost).
		Delete(&entity.DeviceTLSPin{}).Error; err != nil {
		t.Fatalf("clear: %v", err)
	}

	verdict, _, err := checkOrPinCertificate(tlsPinTestHost, replacement)
	if err != nil {
		t.Fatalf("after clearing: %v", err)
	}
	if verdict != HostKeyVerdictPinned {
		t.Fatalf("verdict = %q after the pin was cleared, want %q — an administrator who cleared "+
			"it would still be locked out", verdict, HostKeyVerdictPinned)
	}

	var n int64
	db.Model(&entity.DeviceTLSPin{}).Where("host = ?", tlsPinTestHost).Count(&n)
	if n != 1 {
		t.Errorf("%d rows after a clear and a re-pin", n)
	}
}

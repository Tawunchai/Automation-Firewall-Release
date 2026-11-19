package platform

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

// The certificate-pinning rule, without a database.
//
// sshhostkey_test.go does the same for port 22 and the decision function is shared, so what is
// left to pin here is the part that is specific to TLS: the fingerprint is of the LEAF's DER bytes
// and matches what openssl prints, a handshake with no certificate is refused, and a missing store
// is PERMISSIVE — the one deliberate asymmetry with the SSH side.

// testCert builds a self-signed certificate shaped like the one FortiOS presents: subject and
// issuer the same, no authority above it. Generated rather than embedded so the test carries no
// expiry of its own.
func testCert(t *testing.T) *x509.Certificate {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "FortiGate"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert
}

// certFingerprint must be the number a person can compare with the device's own GUI — the SHA-256
// of the leaf's DER bytes, lowercase hex, which is what `openssl x509 -fingerprint -sha256` prints
// once its colons are removed.
func TestCertFingerprintIsTheSHA256OfTheLeafDER(t *testing.T) {
	cert := testCert(t)
	fp := certFingerprint(cert)

	if len(fp) != 64 {
		t.Fatalf("fingerprint %q is %d characters, want 64 hex characters", fp, len(fp))
	}
	if _, err := hex.DecodeString(fp); err != nil {
		t.Errorf("fingerprint is not hex: %v", err)
	}
	if fp != strings.ToLower(fp) {
		t.Errorf("fingerprint %q is not lowercase; openssl prints uppercase but with colons, and "+
			"one spelling has to be chosen and kept", fp)
	}

	// Stable across calls, and it is the certificate that decides it.
	if again := certFingerprint(cert); again != fp {
		t.Errorf("two calls gave %q and %q", fp, again)
	}
}

// With no store wired, the check is PERMISSIVE and says so loudly.
//
// This is the one place the TLS rule differs from the SSH one, and it is a choice about blast
// radius rather than an oversight: refusing every HTTPS call on a boot-order bug would empty every
// page of this console, including the ones an administrator needs to find out why. The SSH side
// refuses, because the worst case there is a failed backup.
func TestCertificateCheckWithoutAStoreIsPermissiveAndDistinguishable(t *testing.T) {
	saved := tlsPinStore()
	SetTLSPinStore(nil)
	defer SetTLSPinStore(saved)

	// The service layer reports the condition as its own error …
	verdict, _, err := checkOrPinCertificate("10.10.20.90:443", testCert(t))
	if !errors.Is(err, ErrTLSPinStoreUnset) {
		t.Fatalf("err = %v, want ErrTLSPinStoreUnset", err)
	}
	if verdict != "" {
		t.Errorf("verdict = %q with no store", verdict)
	}

	// … and the dialler's check turns exactly that condition into "allow".
	cs := tls.ConnectionState{PeerCertificates: []*x509.Certificate{testCert(t)}}
	if err := VerifyPinnedCertificate("10.10.20.90:443", cs); err != nil {
		t.Errorf("the dialler refused the connection with no store configured: %v — every page of "+
			"the console would be empty and nothing would say why", err)
	}
}

// A handshake that somehow produced no certificate is refused rather than pinned.
//
// Nothing would be left to compare against, so "allow" here means allowing an unidentified peer,
// and "pin" would store an empty fingerprint that then matches the next unidentified peer.
func TestCertificateCheckRefusesAHandshakeWithNoCertificate(t *testing.T) {
	if err := VerifyPinnedCertificate("10.10.20.90:443", tls.ConnectionState{}); err == nil {
		t.Fatal("a TLS connection presenting no certificate was accepted")
	}
	if _, _, err := checkOrPinCertificate("10.10.20.90:443", nil); err == nil {
		t.Fatal("a nil certificate was accepted")
	}
}

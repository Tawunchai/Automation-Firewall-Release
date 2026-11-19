package platform

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Trust on first use for the firewalls' HTTPS certificates — see entity.DeviceTLSPin for why.
//
// This is the same rule as sshhostkey.go applies on port 22, deliberately written to look like it:
// one pin per host:port, a first sighting is remembered, a change is refused every time, and there
// is no "accept and re-pin" branch.

// tlsPinDB is set once at boot by main.go, next to SetHostKeyStore.
//
// Package-level rather than threaded through, for the same reason: the check happens inside the
// shared http.Transport's dialler, which is a package variable built at init and has nowhere to
// receive a database.
var (
	tlsPinMu sync.RWMutex
	tlsPinDB *gorm.DB
)

// SetTLSPinStore gives the certificate checker its database.
func SetTLSPinStore(db *gorm.DB) {
	tlsPinMu.Lock()
	defer tlsPinMu.Unlock()
	tlsPinDB = db
}

func tlsPinStore() *gorm.DB {
	tlsPinMu.RLock()
	defer tlsPinMu.RUnlock()
	return tlsPinDB
}

// ErrTLSPinStoreUnset is what the dialler gets when main.go never wired the store.
//
// It does NOT refuse the connection. That is the one place this file deliberately differs from
// sshhostkey.go, and the reason is blast radius: an SSH refusal fails a backup, while refusing
// every HTTPS call would empty every page of this console, including the one an administrator
// would use to understand why. A missing store is a server bug, not a device problem, so it is
// logged loudly and the connection proceeds exactly as it did before this file existed.
var ErrTLSPinStoreUnset = errors.New("device certificate pinning is not configured")

// certFingerprint is the SHA-256 of a certificate's DER bytes, lowercase hex.
//
// The same number `openssl x509 -fingerprint -sha256` prints (without its colons) and the same one
// FortiOS shows in its own GUI, so the string stored here is the string a person compares by eye.
func certFingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}

// checkOrPinCertificate applies the trust-on-first-use rule to one host's leaf certificate.
//
// Returns one of the HostKeyVerdict* constants — the same three words the SSH side and the worker
// use, so there is one vocabulary for "this is the first time", "this is the same as before" and
// "this is not what we pinned".
func checkOrPinCertificate(hostport string, leaf *x509.Certificate) (verdict, expected string, err error) {
	if leaf == nil {
		return "", "", errors.New("no certificate to check")
	}
	db := tlsPinStore()
	if db == nil {
		return "", "", ErrTLSPinStoreUnset
	}

	presented := certFingerprint(leaf)

	var row entity.DeviceTLSPin
	readErr := db.Where("host = ?", hostport).First(&row).Error
	if readErr != nil && readErr != gorm.ErrRecordNotFound {
		return "", "", fmt.Errorf("could not read the stored certificate for %s: %w", hostport, readErr)
	}

	now := time.Now()
	// hostKeyDecision, reused rather than rewritten: the rule is the rule, and two copies of it
	// would be two things to keep in step.
	switch hostKeyDecision(row.Fingerprint, presented) {
	case hostKeyMatch:
		// Touched, not rewritten. The fingerprint must not be updatable by the thing being checked.
		db.Model(&entity.DeviceTLSPin{}).Where("id = ?", row.ID).Update("last_seen_at", now)
		return HostKeyVerdictMatch, "", nil

	case hostKeyPin:
		if createErr := db.Create(&entity.DeviceTLSPin{
			Host:        hostport,
			Fingerprint: presented,
			Subject:     leaf.Subject.CommonName,
			Issuer:      leaf.Issuer.CommonName,
			NotAfter:    leaf.NotAfter,
			FirstSeenAt: now,
			LastSeenAt:  now,
		}).Error; createErr != nil {
			return "", "", createErr
		}
		log.Printf("[tls] first HTTPS connection to %s: pinning certificate %s (subject %q, expires %s)",
			hostport, presented, leaf.Subject.CommonName, leaf.NotAfter.Format("2006-01-02"))
		return HostKeyVerdictPinned, "", nil

	default:
		return HostKeyVerdictMismatch, row.Fingerprint, nil
	}
}

// VerifyPinnedCertificate is what the shared transport's dialler calls after each handshake.
//
// It takes the address it dialled rather than reading tls.ConnectionState.ServerName, because
// ServerName is EMPTY when the host is an IP address — measured against the lab 80E, where
// VerifyConnection saw ServerName "" on both a fresh and a repeat handshake. Every device in this
// console is reached by management IP, so a check keyed on ServerName would have keyed every
// firewall in the fleet under one empty string.
func VerifyPinnedCertificate(hostport string, cs tls.ConnectionState) error {
	if len(cs.PeerCertificates) == 0 {
		return fmt.Errorf("%s completed a TLS handshake but presented no certificate", hostport)
	}
	leaf := cs.PeerCertificates[0]

	verdict, expected, err := checkOrPinCertificate(hostport, leaf)
	if errors.Is(err, ErrTLSPinStoreUnset) {
		// Permissive, and the only permissive branch in either pinning file. See
		// ErrTLSPinStoreUnset: refusing here would take the whole console down over a boot-order
		// bug, including the pages needed to diagnose it.
		log.Printf("[tls] ⚠️  certificate pinning is NOT configured — %s was accepted unchecked; "+
			"this is a server misconfiguration (main.go must call services.SetTLSPinStore)", hostport)
		return nil
	}
	if err != nil {
		// A database that cannot be read is also not the device's fault, and the same reasoning
		// applies: log it and carry on rather than blanking the console.
		log.Printf("[tls] ⚠️  could not check the pinned certificate for %s, accepting it unchecked: %v",
			hostport, err)
		return nil
	}
	if verdict != HostKeyVerdictMismatch {
		return nil
	}

	log.Printf("[tls] CERTIFICATE MISMATCH for %s: expected %s, got %s",
		hostport, expected, certFingerprint(leaf))
	// Read by a person on screen, not wrapped by another error, so it is a paragraph with
	// sentences in it.
	//lint:ignore ST1005 user-facing explanation, not a wrapped error fragment
	return fmt.Errorf(
		"the HTTPS certificate of %s has changed.\n"+
			"  expected: %s\n"+
			"  received: %s (subject %q, issuer %q, expires %s)\n"+
			"Refusing to send credentials. This is what an intercepted connection looks like; it is "+
			"also what replacing or regenerating the device's certificate looks like. Compare the "+
			"fingerprint in the firewall's own GUI, and if it is genuinely the new one, an "+
			"administrator can clear the stored certificate for this host.",
		hostport, expected, certFingerprint(leaf),
		leaf.Subject.CommonName, leaf.Issuer.CommonName, leaf.NotAfter.Format("2006-01-02"))
}

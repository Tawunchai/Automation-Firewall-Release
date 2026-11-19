package platform

import (
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
	"network_automation/entity"
)

// Trust on first use for SSH host keys — see entity.SSHHostKey for why this exists.

// hostKeyDB is set once at boot by main.go.
//
// A package-level handle rather than a parameter threaded through every SSH call site, because the
// three of them (the uptime probe, the Config Deploy terminal, the ping/traceroute diagnostics)
// build their ssh.ClientConfig in three different files and none of them has a database to pass.
// services does not import config, so main wires it after ConnectDB.
var (
	hostKeyMu sync.RWMutex
	hostKeyDB *gorm.DB
)

// SetHostKeyStore gives the host-key checker its database.
//
// Until it is called, VerifyOrPinHostKey has nowhere to remember anything and says so — it does not
// quietly fall back to accepting every key, because a boot-order mistake would then silently
// restore exactly the behaviour this replaced.
func SetHostKeyStore(db *gorm.DB) {
	hostKeyMu.Lock()
	defer hostKeyMu.Unlock()
	hostKeyDB = db
}

func hostKeyStore() *gorm.DB {
	hostKeyMu.RLock()
	defer hostKeyMu.RUnlock()
	return hostKeyDB
}

// hostKeyVerdict is what a lookup means, kept separate from the database so the rule can be tested.
type hostKeyVerdict int

const (
	hostKeyPin    hostKeyVerdict = iota // never seen: remember it and continue
	hostKeyMatch                        // same key as last time: continue
	hostKeyChange                       // different key: refuse
)

// hostKeyDecision is the whole rule.
//
// `stored` empty means no row. Note what it does NOT do: there is no "accept and update" branch. A
// key that changed is refused every time, including the tenth time, because an attacker who can
// present a key once can present it repeatedly and "it has been like this for a while" is not
// evidence of anything.
func hostKeyDecision(stored, presented string) hostKeyVerdict {
	switch {
	case stored == "":
		return hostKeyPin
	case stored == presented:
		return hostKeyMatch
	default:
		return hostKeyChange
	}
}

// The three answers CheckOrPinFingerprint can give, named so that the Go caller, the HTTP reply
// and the Python worker all use one vocabulary instead of three.
const (
	HostKeyVerdictPinned   = "pinned"   // never seen before: now remembered
	HostKeyVerdictMatch    = "match"    // the same key as last time
	HostKeyVerdictMismatch = "mismatch" // a DIFFERENT key: the caller must refuse
)

// ErrHostKeyStoreUnset is what every caller gets when main.go never wired the store.
//
// A sentinel rather than a plain string, because the one thing no caller may do is treat it as
// "allow": the permissive branch is the vulnerability this file exists to close, so a boot-order
// mistake has to be loud at the call site rather than silently trusting whatever answered.
var ErrHostKeyStoreUnset = errors.New("SSH host key checking is not configured")

// CheckOrPinFingerprint applies the trust-on-first-use rule to a fingerprint somebody ELSE
// measured, and is the whole of the rule's contact with the database.
//
// It exists because two different programs have to reach the same verdict from the same pins. The
// Go side hands it a key it is holding mid-handshake; the Python worker hands it a fingerprint it
// read off the device on a throwaway connection that carried no credentials
// (worker/host_keys.py). One table, one decision, one vocabulary — a second store on the worker
// would mean a firewall could be "known" to one half of this system and unknown to the other.
//
// `expected` is returned only on a mismatch, so the caller can show both fingerprints; on the
// other two answers there is nothing to compare against.
func CheckOrPinFingerprint(hostport, keyType, fingerprint string) (verdict, expected string, err error) {
	if fingerprint == "" {
		return "", "", errors.New("no host key fingerprint to check")
	}
	db := hostKeyStore()
	if db == nil {
		return "", "", ErrHostKeyStoreUnset
	}

	if keyType == "" {
		// Without it the lookup below would match a row stored under the empty type, or create
		// one, and the pin would then be keyed on something no client ever presents again.
		return "", "", errors.New("no host key type to check")
	}

	// Keyed on the PAIR. The lab FGT80E offers both an RSA and an ED25519 host key, and Go and
	// paramiko negotiate different ones against it — see entity.SSHHostKey for the measurement.
	var row entity.SSHHostKey
	readErr := db.Where("host = ? AND key_type = ?", hostport, keyType).First(&row).Error
	if readErr != nil && readErr != gorm.ErrRecordNotFound {
		return "", "", fmt.Errorf("could not read the stored host key for %s: %w", hostport, readErr)
	}

	now := time.Now()
	switch hostKeyDecision(row.Fingerprint, fingerprint) {
	case hostKeyMatch:
		// Touched, not rewritten: last_seen is useful and the fingerprint must not be updatable by
		// the thing being checked.
		db.Model(&entity.SSHHostKey{}).Where("id = ?", row.ID).Update("last_seen_at", now)
		return HostKeyVerdictMatch, "", nil

	case hostKeyPin:
		if createErr := db.Create(&entity.SSHHostKey{
			Host:        hostport,
			KeyType:     keyType,
			Fingerprint: fingerprint,
			FirstSeenAt: now,
			LastSeenAt:  now,
		}).Error; createErr != nil {
			return "", "", createErr
		}
		return HostKeyVerdictPinned, "", nil

	default:
		return HostKeyVerdictMismatch, row.Fingerprint, nil
	}
}

// VerifyOrPinHostKey returns the ssh.HostKeyCallback every SSH client in this application uses.
//
// label names the thing being connected to in error messages ("FortiGate-80E"), because
// "10.10.20.90:22" alone does not tell an operator which of their firewalls to go and look at.
func VerifyOrPinHostKey(label string) ssh.HostKeyCallback {
	return func(hostport string, _ net.Addr, key ssh.PublicKey) error {
		if key == nil {
			return fmt.Errorf("%s (%s) presented no host key", label, hostport)
		}
		presented := ssh.FingerprintSHA256(key)

		verdict, expected, err := CheckOrPinFingerprint(hostport, key.Type(), presented)
		if errors.Is(err, ErrHostKeyStoreUnset) {
			// Deliberately fatal to the connection rather than permissive. This only happens if the
			// store was never wired at boot, which is a bug in main.go.
			return fmt.Errorf(
				"SSH host key checking is not configured, refusing to connect to %s (%s) — "+
					"this is a server misconfiguration, not a problem with the device", label, hostport)
		}
		if err != nil {
			return err
		}

		switch verdict {
		case HostKeyVerdictMatch:
			return nil

		case HostKeyVerdictPinned:
			log.Printf("[ssh] first connection to %s (%s): pinning host key %s %s",
				label, hostport, key.Type(), presented)
			return nil

		default:
			log.Printf("[ssh] HOST KEY MISMATCH for %s (%s): expected %s, got %s",
				label, hostport, expected, presented)
			// This is read by a person on screen, not wrapped by another error, so it is a
			// paragraph with sentences in it. ST1005's "no trailing punctuation" rule is about
			// errors that get concatenated; applying it here would mean deleting the full stop
			// from the middle of an explanation.
			//lint:ignore ST1005 user-facing explanation, not a wrapped error fragment
			return fmt.Errorf(
				"the %s SSH host key for %s (%s) has changed.\n"+
					"  expected: %s\n"+
					"  received: %s\n"+
					"Refusing to send credentials. This is what an intercepted connection looks like; "+
					"it is also what a firmware upgrade that regenerated the key looks like. Compare "+
					"the fingerprint on the device's own console, and if it is genuinely the new one, "+
					"an administrator can clear the stored key for this host.",
				key.Type(), label, hostport, expected, presented)
		}
	}
}

// PreferredHostKeyAlgorithms is the host key preference every SSH dial in this application shares.
//
// It exists because of a measurement, not a preference. The lab FGT80E holds both an RSA and an
// ED25519 host key, and the two SSH clients in this system disagreed about which to ask for:
//
//	x/crypto/ssh, left to its defaults  →  ssh-rsa
//	paramiko 4.0, left to its defaults  →  ssh-ed25519
//
// Both were verifying a real key of that firewall, correctly, and pinning a different one. Keying
// the pin on (host, key_type) is what makes that safe (entity.SSHHostKey); this makes it unusual.
// With both halves asking for ED25519 first, one firewall normally has ONE pinned key, so the
// "a type never seen before is pinned on first sight" window is not somewhere the system lives
// day to day.
//
// It is a PREFERENCE, listing everything x/crypto/ssh supports, not a restriction to ED25519: a
// device that has no ED25519 key — an older FortiOS, or one whose key was never regenerated — must
// still be reachable, and it then lands on the same next-best choice paramiko would pick.
var PreferredHostKeyAlgorithms = []string{
	ssh.KeyAlgoED25519,
	ssh.KeyAlgoECDSA256,
	ssh.KeyAlgoECDSA384,
	ssh.KeyAlgoECDSA521,
	ssh.KeyAlgoRSASHA512,
	ssh.KeyAlgoRSASHA256,
	// Last, and still present: FortiOS 7.2 offers it, and dropping it would turn a working
	// firewall into an unreachable one for the sake of an ordering.
	ssh.KeyAlgoRSA,
}

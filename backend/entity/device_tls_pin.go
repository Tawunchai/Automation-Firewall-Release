package entity

import "time"

// DeviceTLSPin pins the HTTPS certificate a firewall presented the first time this console reached
// its REST API.
//
// ── Why ──────────────────────────────────────────────────────────────────────
//
// Every FortiGate REST call goes through one shared transport with InsecureSkipVerify, so the
// console accepted whatever certificate answered on port 443 — and then posted an administrator's
// username and password to /logincheck over it. That is the same hole
// [[entity.SSHHostKey]] closes on port 22, on the path that carries far more traffic: every page of
// this console reads the device over it.
//
// Verification against a CA cannot be the answer. FortiOS ships a self-signed certificate
// (subject and issuer both "FortiGate" on the lab 80E), there is no authority to check it against,
// and requiring one would mean no device worked at all. Self-signed is precisely the case
// trust-on-first-use exists for: nobody can verify the first certificate, but every certificate
// after it can be compared with the first.
//
// ── The rule ─────────────────────────────────────────────────────────────────
//
//	no row for this host   → remember what it presented, and continue
//	row matches            → continue
//	row differs            → REFUSE, and say so
//
// The third outcome also fires when an administrator legitimately regenerates or replaces the
// certificate, which is indistinguishable from an interception and must be treated as one.
// Clearing the row is a deliberate act — see controller/hostpin.
//
// ── Why this is its own table and not a row in ssh_host_keys ─────────────────
//
// They answer the same question about different protocols, and keeping them apart means neither
// one's columns have to be optional. An SSH pin has a key algorithm; a TLS pin has a subject, an
// issuer and an expiry worth showing to whoever is deciding whether a change is legitimate. One
// table with both would have four columns that are empty half the time.
type DeviceTLSPin struct {
	Base

	// Host is "address:port" as dialled, matching the SSH pins' key, so a device reachable on two
	// ports pins each separately.
	Host string `gorm:"size:255;uniqueIndex" json:"host"`

	// Fingerprint is the SHA-256 of the LEAF certificate's DER bytes, lowercase hex — the same
	// number `openssl x509 -fingerprint -sha256` prints, so an operator can compare it with what
	// the device's own GUI shows without converting anything.
	//
	// The leaf, not the chain: a self-signed certificate IS the chain, and pinning the chain would
	// mean re-pinning whenever an intermediate the device never had changed.
	Fingerprint string `gorm:"size:128" json:"fingerprint"`

	// Subject, Issuer and NotAfter are recorded for the human, not for the check. The check is the
	// fingerprint alone; these are what makes "the certificate changed" a decision somebody can
	// actually make — an expiry that has just passed is the ordinary explanation.
	Subject  string    `gorm:"size:255" json:"subject"`
	Issuer   string    `gorm:"size:255" json:"issuer"`
	NotAfter time.Time `json:"not_after"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

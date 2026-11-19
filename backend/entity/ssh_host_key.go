package entity

import "time"

// SSHHostKey pins the host key a firewall presented the first time this console reached it.
//
// ── Why ──────────────────────────────────────────────────────────────────────
//
// Every SSH connection in this system used ssh.InsecureIgnoreHostKey(): the uptime probe, the
// Config Deploy terminal, and the ping/traceroute diagnostics. That accepts whatever answers on
// port 22 without checking it is the same machine as last time — so anything positioned on the
// management network can present its own key, and the console hands it an administrator's password
// in plaintext. It is the one place in this application where a passive network position converts
// into full control of a firewall.
//
// The comment that used to justify it — "the devices carry self-signed host keys" — is true and
// beside the point. Self-signed is exactly the case trust-on-first-use is for: nobody can verify
// the first key, but every key after it can be checked against the first.
//
// ── The rule ─────────────────────────────────────────────────────────────────
//
//	no row for this host   → remember what it presented, and continue
//	row matches            → continue
//	row differs            → REFUSE, and say so
//
// The third outcome also fires on a legitimate firmware upgrade that regenerated the key, which is
// indistinguishable from an interception and must be treated as one. Clearing the row is a
// deliberate act by an administrator who has checked the fingerprint on the device's console —
// which is what "verifying a host key" has always meant.
//
// ── One pin per host AND key type ────────────────────────────────────────────
//
// The unique key is (host, key_type) together, the way OpenSSH's known_hosts keeps one line per
// host per algorithm. That is not theoretical tidiness; it was measured on the lab FGT80E at
// 10.10.20.90, which holds BOTH an RSA and an ED25519 host key:
//
//	Go's x/crypto/ssh default preference  negotiates ssh-rsa      SHA256:Ps3dldtCQRF1dNSV…
//	paramiko 4.0's default preference     negotiates ssh-ed25519  SHA256:3xeq9NF7B+widM/a…
//
// Both fingerprints are correct and both belong to the same firewall. Keyed on the host alone, the
// console's own SSH probe would pin whichever it saw first and the Python worker would then be
// refused on every backup with "the host key has changed" — a false alarm indistinguishable from
// an attack. Keyed on the pair, each algorithm is pinned once and compared against itself.
//
// What this costs, stated plainly: a key type never seen for a host is pinned on first sight even
// when another type is already known for it. Refusing instead was considered and rejected — the
// two clients above legitimately negotiate different types against the same device, so the first
// connection would lock the other out permanently. services.PreferredHostKeyAlgorithms narrows the
// window the other way, by having the Go side ask for the algorithm paramiko also asks for.
type SSHHostKey struct {
	Base

	// Host is "address:port" as dialled, so a device reachable on two ports pins each separately.
	Host string `gorm:"size:255;uniqueIndex:idx_ssh_host_keys_host_type" json:"host"`

	// KeyType is the algorithm the device offered, e.g. "ssh-ed25519", "ecdsa-sha2-nistp256".
	KeyType string `gorm:"size:64;uniqueIndex:idx_ssh_host_keys_host_type" json:"key_type"`

	// Fingerprint is the SHA256 form OpenSSH prints, so an operator can compare it with what
	// `ssh-keygen -lf` or the device's own console shows without converting anything.
	Fingerprint string `gorm:"size:128" json:"fingerprint"`

	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

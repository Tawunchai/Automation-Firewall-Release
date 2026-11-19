package platform

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// เข้ารหัส credential ของอุปกรณ์ (เช่น password FortiGate) ด้วย AES-256-GCM
//
// รองรับ key rotation แบบมีเวอร์ชัน — ciphertext เก็บในรูปแบบ "v<N>:base64(nonce||ciphertext)"
//   - version 1 (หรือ ciphertext แบบเดิมที่ไม่มี prefix "vN:") = sha256(CRED_ENC_KEY)
//   - version > 1 = sha256(CRED_ENC_KEY_V<N>) — ตั้งตอน rotate key
//
// CRED_ENC_KEY_VERSION = เวอร์ชันที่ใช้เข้ารหัสค่า "ใหม่" (default = 1)
//
// วิธี rotate:
//  1. ตั้ง env ใหม่ CRED_ENC_KEY_V2=<ค่าลับใหม่> และ CRED_ENC_KEY_VERSION=2 (คง CRED_ENC_KEY เดิมไว้ —
//     ยังใช้ถอด ciphertext เวอร์ชัน 1 ที่ยังไม่ได้ re-encrypt)
//  2. เรียก ReencryptSecret() กับทุก credential ที่เก็บไว้ (ผ่าน endpoint /admin/rotate-cred-key)
//  3. เมื่อ credential ทุกตัว re-encrypt เป็น v2 ครบแล้ว ค่อยถอน CRED_ENC_KEY (v1) ออกได้

const credKeyVersionPrefix = "v"

// currentCredKeyVersion คืนเวอร์ชัน key ที่ใช้เข้ารหัสค่า "ใหม่" (จาก env CRED_ENC_KEY_VERSION, default 1)
func currentCredKeyVersion() int {
	raw := os.Getenv("CRED_ENC_KEY_VERSION")
	if raw == "" {
		return 1
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 1
	}
	return n
}

// CurrentCredKeyVersion = exported wrapper ของ currentCredKeyVersion (ใช้เทียบใน rotate endpoint)
func CurrentCredKeyVersion() int {
	return currentCredKeyVersion()
}

// CredKeyVersion อ่านเวอร์ชัน key ที่ใช้เข้ารหัส ciphertext ที่กำหนด
// (ciphertext แบบเดิมที่ไม่มี prefix "vN:" ถือเป็น version 1)
func CredKeyVersion(enc string) int {
	if rest, ok := strings.CutPrefix(enc, credKeyVersionPrefix); ok {
		if idx := strings.Index(rest, ":"); idx > 0 {
			if n, err := strconv.Atoi(rest[:idx]); err == nil {
				return n
			}
		}
	}
	return 1
}

// leakedCredKeys are key values that must never protect a real credential. The first shipped as
// the default in docker-compose.yml and is quoted in the repo's docs, so it is public: anything
// encrypted with it is plaintext to anyone who can read the database.
var leakedCredKeys = map[string]bool{
	"dev-cred-key-change-me-in-production": true,
	"change-me":                            true,
	"changeme":                             true,
}

// minCredKeyLen is the shortest key accepted. The value is hashed to 32 bytes either way, so this
// bounds the GUESSABLE input, not the AES key size.
const minCredKeyLen = 16

// credKeyEnvName returns the env var holding a given key version's secret.
func credKeyEnvName(version int) string {
	if version <= 1 {
		return "CRED_ENC_KEY"
	}
	return fmt.Sprintf("CRED_ENC_KEY_V%d", version)
}

// credKeyForVersion คืน AES-256 key (32 ไบต์) สำหรับ key version ที่ระบุ
//
// There is deliberately NO fallback. This key protects the admin passwords of real firewalls, and
// a silent default meant every install shared one publicly-known key — the same class of mistake
// JWT_SECRET already guards against with a hard failure at startup (see GetJWTSecret).
// It only requires the key to be SET. Strength is enforced on the ACTIVE key at startup instead
// (ValidateCredKeyConfig) — a superseded version must stay usable for DECRYPTION even if it is the
// old leaked default, or rotating away from that default would be impossible.
func credKeyForVersion(version int) ([]byte, error) {
	envName := credKeyEnvName(version)
	raw := os.Getenv(envName)
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("%s is not set, so credentials encrypted with key version %d cannot be read", envName, version)
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil // 32 ไบต์ = AES-256
}

// ValidateCredKeyConfig checks the key NEW secrets will be encrypted with, at startup, so a
// misconfigured deployment fails immediately and loudly rather than silently protecting a real
// firewall's admin password with a value published in docker-compose.yml.
//
// Scope is deliberate: only the active version is held to this standard. Older versions are exempt
// because their sole remaining job is to decrypt legacy ciphertext during a rotation.
func ValidateCredKeyConfig() error {
	version := currentCredKeyVersion()
	envName := credKeyEnvName(version)
	raw := os.Getenv(envName)

	switch {
	case strings.TrimSpace(raw) == "":
		return fmt.Errorf("device credential encryption is not configured: %s is not set — generate one with `openssl rand -hex 32`", envName)
	case leakedCredKeys[strings.ToLower(strings.TrimSpace(raw))]:
		return fmt.Errorf("device credential encryption is not safe: %s is a well-known placeholder value, so anyone who can read the database can decrypt every device password. Generate a real key with `openssl rand -hex 32`, set it as CRED_ENC_KEY_V2 with CRED_ENC_KEY_VERSION=2, then POST /admin/rotate-cred-key", envName)
	case len(raw) < minCredKeyLen:
		return fmt.Errorf("device credential encryption is weak: %s must be at least %d characters (got %d)", envName, minCredKeyLen, len(raw))
	}
	return nil
}

// EncryptSecret เข้ารหัสด้วย key เวอร์ชัน "ปัจจุบัน" (CRED_ENC_KEY_VERSION)
// คืน "v<N>:base64(nonce||ciphertext)"
func EncryptSecret(plain string) (string, error) {
	version := currentCredKeyVersion()
	key, err := credKeyForVersion(version)
	if err != nil {
		return "", err
	}
	ct, err := sealSecret(key, plain)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%d:%s", credKeyVersionPrefix, version, ct), nil
}

// DecryptSecret ถอดค่าที่ EncryptSecret สร้างไว้
// รองรับทั้งรูปแบบใหม่ "vN:base64(...)" และรูปแบบเดิม base64(...) ตรง ๆ (= version 1)
func DecryptSecret(enc string) (string, error) {
	version := 1
	payload := enc
	if rest, ok := strings.CutPrefix(enc, credKeyVersionPrefix); ok {
		if idx := strings.Index(rest, ":"); idx > 0 {
			if n, err := strconv.Atoi(rest[:idx]); err == nil {
				version = n
				payload = rest[idx+1:]
			}
		}
	}
	key, err := credKeyForVersion(version)
	if err != nil {
		return "", err
	}
	return openSecret(key, payload)
}

// ReencryptSecret ถอดรหัส ciphertext เดิม (key version ใดก็ได้ที่ตั้งค่า env ไว้)
// แล้วเข้ารหัสใหม่ด้วย key เวอร์ชัน "ปัจจุบัน" — ใช้ตอน rotate CRED_ENC_KEY
func ReencryptSecret(enc string) (string, error) {
	plain, err := DecryptSecret(enc)
	if err != nil {
		return "", err
	}
	return EncryptSecret(plain)
}

func sealSecret(key []byte, plain string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

func openSecret(key []byte, b64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

package platform

import (
	"strings"
	"testing"
)

// CRED_ENC_KEY protects the admin passwords of real firewalls. It used to fall back to
// "dev-cred-key-change-me-in-production" whenever it was unset — a value printed in
// docker-compose.yml, the repo docs and git history, so every install shared one public key and
// anyone with database read access could decrypt every device credential.
//
// The rule these tests pin: the key NEW secrets are encrypted with must be present, unique and
// long enough, checked at startup. A SUPERSEDED version stays readable even if it is the old
// leaked default, because otherwise you could never rotate away from it.

func withEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

const goodKey = "9f2c41ab7de05318bc6a4f97e2d108536ba7cf49e01d2a6b8c3f5079de41ab26"

func TestValidateCredKeyConfig_RejectsLeakedDefault(t *testing.T) {
	withEnv(t, map[string]string{
		"CRED_ENC_KEY_VERSION": "1",
		"CRED_ENC_KEY":         "dev-cred-key-change-me-in-production",
	})

	err := ValidateCredKeyConfig()
	if err == nil {
		t.Fatal("the published docker-compose default was accepted as a credential key")
	}
	// The message has to tell an operator what to do, not just that something is wrong.
	for _, want := range []string{"CRED_ENC_KEY", "openssl rand -hex 32", "rotate-cred-key"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error message is missing %q: %v", want, err)
		}
	}
}

func TestValidateCredKeyConfig_RejectsUnsetAndShort(t *testing.T) {
	for _, tc := range []struct{ name, key, want string }{
		{"unset", "", "not set"},
		{"blank", "   ", "not set"},
		{"too short", "abc123", "at least"},
		{"other placeholder", "change-me", "placeholder"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withEnv(t, map[string]string{"CRED_ENC_KEY_VERSION": "1", "CRED_ENC_KEY": tc.key})
			err := ValidateCredKeyConfig()
			if err == nil {
				t.Fatalf("key %q was accepted", tc.key)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestValidateCredKeyConfig_AcceptsRealKey(t *testing.T) {
	withEnv(t, map[string]string{"CRED_ENC_KEY_VERSION": "1", "CRED_ENC_KEY": goodKey})
	if err := ValidateCredKeyConfig(); err != nil {
		t.Fatalf("a 64-hex key was rejected: %v", err)
	}
}

// Only the ACTIVE version is held to the strength rules. With version 2 active, a leaked v1 key is
// irrelevant to startup — and must stay usable for decryption so rotation can run.
func TestValidateCredKeyConfig_ChecksTheActiveVersionOnly(t *testing.T) {
	withEnv(t, map[string]string{
		"CRED_ENC_KEY_VERSION": "2",
		"CRED_ENC_KEY":         "dev-cred-key-change-me-in-production", // legacy, still needed to read v1
		"CRED_ENC_KEY_V2":      goodKey,
	})
	if err := ValidateCredKeyConfig(); err != nil {
		t.Fatalf("v2 active with a good key should pass, got: %v", err)
	}

	// And the reverse: a good v1 does not excuse a missing v2.
	withEnv(t, map[string]string{"CRED_ENC_KEY": goodKey, "CRED_ENC_KEY_V2": ""})
	if err := ValidateCredKeyConfig(); err == nil {
		t.Fatal("v2 active with CRED_ENC_KEY_V2 unset should fail")
	}
}

// The whole point of keeping an old key: rotation must be able to read what it wrote.
func TestRotation_LeakedV1StillDecryptsIntoV2(t *testing.T) {
	// Encrypt under the old (leaked) key, version 1.
	withEnv(t, map[string]string{
		"CRED_ENC_KEY_VERSION": "1",
		"CRED_ENC_KEY":         "dev-cred-key-change-me-in-production",
	})
	oldCipher, err := EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("encrypt with v1: %v", err)
	}
	if !strings.HasPrefix(oldCipher, "v1:") {
		t.Fatalf("ciphertext = %q, want a v1: prefix", oldCipher[:8])
	}

	// Switch the active version to 2, keeping v1 available.
	t.Setenv("CRED_ENC_KEY_VERSION", "2")
	t.Setenv("CRED_ENC_KEY_V2", goodKey)

	newCipher, err := ReencryptSecret(oldCipher)
	if err != nil {
		t.Fatalf("rotate v1 → v2: %v", err)
	}
	if !strings.HasPrefix(newCipher, "v2:") {
		t.Errorf("rotated ciphertext = %q, want a v2: prefix", newCipher[:8])
	}
	if CredKeyVersion(newCipher) != 2 {
		t.Errorf("CredKeyVersion = %d, want 2", CredKeyVersion(newCipher))
	}

	// Drop the leaked key entirely — the rotated value must still open.
	t.Setenv("CRED_ENC_KEY", "")
	plain, err := DecryptSecret(newCipher)
	if err != nil {
		t.Fatalf("decrypt after retiring v1: %v", err)
	}
	if plain != "P@ssw0rd" {
		t.Errorf("plaintext = %q, want the original", plain)
	}
}

// Once the old key is gone, legacy ciphertext must fail loudly rather than decrypt to junk.
func TestDecrypt_MissingLegacyKeyIsAnError(t *testing.T) {
	withEnv(t, map[string]string{
		"CRED_ENC_KEY_VERSION": "1",
		"CRED_ENC_KEY":         goodKey,
	})
	ct, err := EncryptSecret("secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	t.Setenv("CRED_ENC_KEY", "")
	if _, err := DecryptSecret(ct); err == nil {
		t.Fatal("decryption succeeded with no key configured")
	} else if !strings.Contains(err.Error(), "CRED_ENC_KEY") {
		t.Errorf("error = %v, want it to name the missing env var", err)
	}
}

// Round-trip sanity: AES-256-GCM, so the same plaintext must never produce the same ciphertext.
func TestEncryptSecret_RoundTripAndNonceIsUnique(t *testing.T) {
	withEnv(t, map[string]string{"CRED_ENC_KEY_VERSION": "1", "CRED_ENC_KEY": goodKey})

	a, err := EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	b, err := EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if a == b {
		t.Error("two encryptions of the same plaintext are identical — the nonce is not random")
	}
	for _, ct := range []string{a, b} {
		got, err := DecryptSecret(ct)
		if err != nil || got != "P@ssw0rd" {
			t.Errorf("round trip = %q, %v", got, err)
		}
	}
}

// A tampered ciphertext must fail the GCM tag check, not return partial plaintext.
func TestDecryptSecret_RejectsTamperedCiphertext(t *testing.T) {
	withEnv(t, map[string]string{"CRED_ENC_KEY_VERSION": "1", "CRED_ENC_KEY": goodKey})
	ct, err := EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	body := []byte(ct)
	body[len(body)-2] ^= 0x01 // flip a bit inside the base64 payload
	if _, err := DecryptSecret(string(body)); err == nil {
		t.Error("a tampered ciphertext decrypted successfully")
	}
}

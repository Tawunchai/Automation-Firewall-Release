package services

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"regexp"
	"strings"
)

// The last line between an example secret and a real firewall.
//
// ── Why a prompt rule was not enough ─────────────────────────────────────────
//
// The system prompt's FortiOS examples used to carry working-looking secrets — one pre-shared key
// repeated across all three IPsec examples, an HA password, a local-user password. The rules a few
// lines further down said "generate a real, unique one", but a few-shot example beats prose every
// time: the model's cheapest move is to copy the line it was shown. The user then applies that CLI
// verbatim, and a tunnel comes up with a pre-shared key that is written in this repository.
//
// The examples now carry an obvious non-value (exampleSecretMarker) instead. This file is what
// makes that safe rather than merely likely: if the marker — or any of the old literals, which may
// still be in a cached prompt or a saved conversation — reaches the command list, it is replaced
// with a freshly generated secret before anything can be deployed. Deterministic code, not a
// hope about the next model.

// exampleSecretMarker is the value the prompt's examples carry. It is deliberately not a plausible
// secret: if it ever shows up in a proposal, that is a copy, not a choice.
const exampleSecretMarker = "EXAMPLE-ONLY-DO-NOT-EMIT-THIS-STRING"

// knownExampleSecrets are the literals the prompt used to teach. They are kept here precisely
// BECAUSE they were removed from the prompt: a conversation saved before this change, or a cached
// prefix that has not expired, can still produce them.
var knownExampleSecrets = map[string]bool{
	exampleSecretMarker:    true,
	"StrongPSK@2024!XYZ":   true,
	"VpnPass@2024!":        true,
	"HAPass@2024!":         true,
	"LdapPass@2024!":       true,
	"RadiusSecret@2024":    true,
	"S3cret@2024!":         true,
	"P@ssw0rd":             true,
	"changeme":             true,
	"<UNKNOWN>":            true,
	"<password>":           true,
	"<PASSWORD>":           true,
	"ChangeMe123!":         true,
	"FortiPassword123!":    true,
	"StrongPassword@2024!": true,
}

// secretFieldRe matches the FortiOS lines that set a secret, capturing the field name and the
// quoted value. Only fields whose value IS a credential are listed — `set password-protected any`
// on a file filter is not one, which is why this matches on the exact field name rather than on
// the substring "password".
var secretFieldRe = regexp.MustCompile(`^(\s*set\s+(psksecret|passwd|password|secret|secondary-secret|ppk-secret|auth-password-l1|auth-password-l2|priv-password-l1|priv-password-l2)\s+)"([^"]*)"(\s*.*)$`)

// replaceExampleSecrets rewrites any command line that sets a secret to one of the values the
// prompt's examples contain. The replacement is a freshly generated strong secret.
//
// It returns the rewritten commands and the fields it had to fix, so the caller can tell the user
// — a generated credential nobody is told about is a credential nobody can use.
func replaceExampleSecrets(commands []string) ([]string, []string) {
	var fixed []string
	out := make([]string, len(commands))
	copy(out, commands)

	for i, line := range out {
		m := secretFieldRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		value := m[3]
		if !knownExampleSecrets[value] && !strings.Contains(value, exampleSecretMarker) {
			continue
		}
		// The trailing group holds the example's "← never copy this" annotation, which must not
		// travel into the device's configuration either.
		out[i] = m[1] + `"` + generateSecret() + `"`
		fixed = append(fixed, m[2])
	}

	if len(fixed) > 0 {
		// No value, generated or copied, is ever logged.
		log.Printf("[ai] replaced %d example secret(s) from the prompt with generated values: %s",
			len(fixed), strings.Join(fixed, ", "))
	}
	return out, fixed
}

// secretAlphabet excludes the characters that make a secret painful to use in this context:
// quotes and backslashes would have to be escaped in FortiOS CLI, and the visually ambiguous
// 0/O/1/l/I cause support calls when someone types the value by hand off a screen.
const secretAlphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_=+@#%"

// generateSecret returns a 32-character random secret, which satisfies the strongest rule in the
// prompt (PSK: 16+ with mixed case and specials) with room to spare.
//
// crypto/rand, not math/rand: this value protects a VPN tunnel or an administrative account.
func generateSecret() string {
	const n = 32
	var b strings.Builder
	b.Grow(n)
	max := big.NewInt(int64(len(secretAlphabet)))
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			// crypto/rand failing is not something to paper over with a weaker source: a
			// predictable PSK is worse than no proposal. The caller's command list is left with
			// the marker, which the UI shows and the user can see is wrong.
			log.Printf("[ai] could not generate a secret: %v", err)
			return exampleSecretMarker
		}
		b.WriteByte(secretAlphabet[idx.Int64()])
	}
	return b.String()
}

// noteGeneratedSecrets appends one line to an explanation naming the fields that were regenerated.
//
// It says which FIELDS, never the values: the values are in the CLI the user is about to read and
// apply, and repeating a credential into a second place is how it ends up somewhere it should not
// be. See [[ai-transcript-off-disk]] for why the transcript is not a vault.
func noteGeneratedSecrets(explanation string, fields []string) string {
	if len(fields) == 0 {
		return explanation
	}
	note := fmt.Sprintf(
		"\n\n⚠️ The proposal contained an example value from the assistant's own reference material for: %s. "+
			"It has been replaced with a generated secret, which is in the CLI above — copy it somewhere safe "+
			"before you apply, because the device will not show it again.",
		strings.Join(uniqueStrings(fields), ", "))
	return strings.TrimRight(explanation, " \n") + note
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

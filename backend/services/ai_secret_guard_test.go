package services

import (
	"strings"
	"testing"
)

// The failure these guard against: the model copies a secret out of its own reference examples,
// the user applies the CLI verbatim, and a VPN tunnel or an admin account ends up with a
// credential that is written in this repository.

func TestExampleSecretsAreReplaced(t *testing.T) {
	cases := []struct {
		name  string
		line  string
		field string
	}{
		{"the marker the prompt examples now carry", `        set psksecret "EXAMPLE-ONLY-DO-NOT-EMIT-THIS-STRING"`, "psksecret"},
		{"the marker with the example's trailing annotation", `    set passwd "EXAMPLE-ONLY-DO-NOT-EMIT-THIS-STRING"   ← GENERATE a unique password`, "passwd"},
		{"a literal the prompt used to teach", `        set psksecret "StrongPSK@2024!XYZ"`, "psksecret"},
		{"the HA password that used to be in the examples", `    set password "HAPass@2024!"`, "password"},
		{"a RADIUS secret", `        set secret "RadiusSecret@2024"`, "secret"},
		{"a secondary RADIUS secret", `        set secondary-secret "RadiusSecret@2024"`, "secondary-secret"},
		{"a placeholder the rules forbid", `        set passwd "<UNKNOWN>"`, "passwd"},
		{"the device password that was once in this repo's docs", `        set password "P@ssw0rd"`, "password"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, fixed := replaceExampleSecrets([]string{"config vpn ipsec phase1-interface", c.line, "next", "end"})

			if len(fixed) != 1 || fixed[0] != c.field {
				t.Fatalf("fields fixed = %v, want [%s]", fixed, c.field)
			}
			got := out[1]
			for bad := range knownExampleSecrets {
				if strings.Contains(got, bad) {
					t.Errorf("the example secret %q survived: %s", bad, got)
				}
			}
			// The example's annotation must not travel into the device's configuration.
			if strings.Contains(got, "←") || strings.Contains(got, "GENERATE") {
				t.Errorf("the example's annotation was deployed as part of the line: %s", got)
			}
			if !strings.HasPrefix(strings.TrimSpace(got), "set "+c.field+` "`) || !strings.HasSuffix(got, `"`) {
				t.Errorf("the rewritten line is not valid FortiOS CLI: %s", got)
			}
		})
	}
}

func TestARealSecretIsLeftAlone(t *testing.T) {
	// A secret the USER typed, or one the model generated properly, must survive untouched —
	// rewriting it would lock the user out of something they just configured.
	in := []string{
		`        set psksecret "kP4vT8nQ2wL6xB9mZ3sH5dJ1gY0cA7rF"`,
		`        set passwd "the-password-the-user-told-us"`,
		// Not a credential field at all, despite the word: a file filter's match criterion.
		`                set password-protected any`,
		// Not a `set` line.
		`    edit "password"`,
	}
	out, fixed := replaceExampleSecrets(in)
	if len(fixed) != 0 {
		t.Errorf("fields were rewritten that should not have been: %v", fixed)
	}
	for i := range in {
		if out[i] != in[i] {
			t.Errorf("line %d was modified:\n got: %s\nwant: %s", i, out[i], in[i])
		}
	}
}

func TestGeneratedSecretsAreStrongAndDifferent(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		s := generateSecret()
		if len(s) != 32 {
			t.Fatalf("length %d, want 32", len(s))
		}
		if seen[s] {
			t.Fatal("the same secret was generated twice — the source is not random")
		}
		seen[s] = true
		// Must survive being pasted inside a FortiOS double-quoted value.
		if strings.ContainsAny(s, `"'\ `) {
			t.Errorf("the secret contains a character that breaks CLI quoting: %q", s)
		}
	}
}

// Two tunnels in one proposal must not end up sharing a key.
func TestEachOccurrenceGetsItsOwnSecret(t *testing.T) {
	in := []string{
		`    set psksecret "EXAMPLE-ONLY-DO-NOT-EMIT-THIS-STRING"`,
		`    set psksecret "EXAMPLE-ONLY-DO-NOT-EMIT-THIS-STRING"`,
	}
	out, fixed := replaceExampleSecrets(in)
	if len(fixed) != 2 {
		t.Fatalf("fixed %d fields, want 2", len(fixed))
	}
	if out[0] == out[1] {
		t.Error("both tunnels were given the same pre-shared key")
	}
}

// A generated credential nobody is told about is a credential nobody can use — the device will not
// show it again. The note names the FIELD and never repeats the value.
func TestTheUserIsToldWhichFieldWasRegenerated(t *testing.T) {
	got := noteGeneratedSecrets("Creating the tunnel.", []string{"psksecret", "psksecret", "passwd"})
	if !strings.Contains(got, "Creating the tunnel.") {
		t.Error("the original explanation was lost")
	}
	if !strings.Contains(got, "psksecret") || !strings.Contains(got, "passwd") {
		t.Errorf("the note does not name the fields: %s", got)
	}
	if strings.Count(got, "psksecret") != 1 {
		t.Errorf("the duplicate field was listed twice: %s", got)
	}
	if unchanged := noteGeneratedSecrets("nothing to say", nil); unchanged != "nothing to say" {
		t.Errorf("an explanation was modified with no secrets to report: %q", unchanged)
	}
}

// The guard runs on the path both the streaming and non-streaming answers go through, with or
// without a live device snapshot — a device that was unreachable must not disable it.
func TestTheGuardRunsWithoutADeviceSnapshot(t *testing.T) {
	s := &ConfigSuggestion{
		Mode:        "config",
		Commands:    []string{`    set psksecret "StrongPSK@2024!XYZ"`},
		Explanation: "a tunnel",
	}
	applyDeviceFacts(s, nil)
	if strings.Contains(s.Commands[0], "StrongPSK@2024!XYZ") {
		t.Error("an example pre-shared key reached the caller because the device was unreachable")
	}
	if !strings.Contains(s.Explanation, "psksecret") {
		t.Errorf("the user was not told: %s", s.Explanation)
	}
}

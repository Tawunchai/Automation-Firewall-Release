package services

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// The prompt is the assistant's behaviour, so the move from Go string constants to embedded text
// files had to change nothing about it. These are the two halves of "nothing changed": the shape
// the sections are assembled into, and the bytes themselves.

func TestFortinetPromptKeepsItsOriginalShape(t *testing.T) {
	sections := map[string]string{
		"CLI reference":     fortinetCLIReference,
		"workflow patterns": fortinetWorkflowPatterns,
		"best practices":    fortinetBestPractices,
		"reuse conditions":  objectReuseConditions,
	}
	for name, text := range sections {
		if !strings.HasPrefix(text, "\n") {
			t.Errorf("%s no longer opens with a newline — it did as a raw string literal, and the "+
				"prompt is assembled by concatenation", name)
		}
		if strings.HasSuffix(text, "\n") {
			t.Errorf("%s now ends with a newline, which it did not before", name)
		}
		if strings.TrimSpace(text) == "" {
			t.Errorf("%s is empty — the embed found a file but not its contents", name)
		}
	}
}

// The checksums of the three sections as they were when they lived in ai_prompt_fortinet.go as
// `const` raw string literals.
//
// This is deliberately a DIFFERENT kind of assertion from the one above: it does not describe the
// text, it pins it. A failure here is not a bug — editing the prompt is ordinary work — it is a
// prompt change asking to be acknowledged, because a one-word edit to the CLI reference changes
// what the model emits onto a live firewall and is invisible in a diff full of prose. Update the
// checksum in the same commit as the edit, and say in the message what the model will do
// differently.
func TestFortinetPromptBytesAreTheOnesTheModelWasTunedOn(t *testing.T) {
	want := map[string]struct{ sum, when string }{
		"CLI reference": {
			"9983f7b553856d647325555290921b6896d5ab909dc5b98aad9fb8f1e942c5ff",
			"moved out of ai_prompt_fortinet.go, 2026-11-18",
		},
		"workflow patterns": {
			"9bd1dfb52e1b9f564a98899ad09ff11e76d43b4c98bf4fd28f75bef91157206b",
			"moved out of ai_prompt_fortinet.go, 2026-11-18",
		},
		"best practices": {
			"571449aaa8301fe20c1c6d83b91cdbda6e31a74114a1977f7777295e7ec319a2",
			"moved out of ai_prompt_fortinet.go, 2026-11-18",
		},
		"reuse conditions": {
			"bbb803ed8fca347d477e41dc972b3bd670b9da25117305c29c5381f671f461fd",
			"moved out of ai.go, 2026-11-18",
		},
	}
	got := map[string]string{
		"reuse conditions":  sum(objectReuseConditions),
		"CLI reference":     sum(fortinetCLIReference),
		"workflow patterns": sum(fortinetWorkflowPatterns),
		"best practices":    sum(fortinetBestPractices),
	}
	for name, w := range want {
		if got[name] != w.sum {
			t.Errorf("%s changed since it was %s.\n  was:  %s\n  now:  %s\n\n"+
				"If you meant to edit the prompt, put the new checksum in this test in the same "+
				"commit and say what the model will do differently. If you did not, something "+
				"rewrote prompts/*.txt — check for a reformatted or re-encoded file.",
				name, w.when, w.sum, got[name])
		}
	}
}

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

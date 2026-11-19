package services

import (
	_ "embed"
	"strings"
)

// The FortiOS prompt text the AI Assistant is built on: the CLI the model is taught to emit, the
// multi-step workflows it must follow, and the practices it should recommend.
//
// ── Why this is three text files and not three string constants ─────────────
//
// It was 1,421 lines and 64 KB of Go source, over both of this repo's size ratchets at once, for
// a file containing no code at all — 62 KB of it was prose inside raw string literals. The same
// shape audit_reference_data.go had (58 KB, 165 lines: it counted as one of the smallest files in
// its package while being the largest), and it goes the same way: the prose becomes a data file
// the code reads, so editing the prompt is editing a text file and reviewing it is reading a text
// diff rather than a Go diff.
//
// ── The bytes the model receives do not change ──────────────────────────────
//
// The three constants were raw string literals that opened with a newline — `const x = ` then the
// backtick then a line break — and closed with no trailing one. The .txt files are stored the way
// a text file normally is, with no leading blank line and one trailing newline, so that an editor
// or a formatter cannot quietly "fix" them into something else; the three variables below restore
// the exact original shape. TestFortinetPromptKeepsItsOriginalShape pins that, because the prompt
// IS the assistant's behaviour (the project skill, rule 4) and a refactor is the wrong moment to
// change a single byte of it.

//go:embed prompts/fortinet_cli_reference.txt
var fortinetCLIReferenceFile string

//go:embed prompts/fortinet_workflow_patterns.txt
var fortinetWorkflowPatternsFile string

//go:embed prompts/fortinet_best_practices.txt
var fortinetBestPracticesFile string

// objectReuseConditions are the mandatory pre-generation rules the AI must apply before proposing
// any create/edit config - object reuse, interface inference, NAT, AntiVirus, and impact analysis.
//
// It came out of ai.go for the same reason as the three above: 17.6 KB of the file's 58 KB was
// this one raw string literal, and prose in a Go literal is prose nobody reviews. ai.go is 39 KB
// now and under the byte ceiling. Same promptSection() restoration, same checksum test: the bytes
// the model receives are unchanged.
//
//go:embed prompts/object_reuse_conditions.txt
var objectReuseConditionsFile string

// promptSection restores a section to the shape it had as a raw string literal: a leading newline,
// and no trailing one.
func promptSection(file string) string {
	return "\n" + strings.TrimRight(file, "\n")
}

var (
	fortinetCLIReference     = promptSection(fortinetCLIReferenceFile)
	fortinetWorkflowPatterns = promptSection(fortinetWorkflowPatternsFile)
	fortinetBestPractices    = promptSection(fortinetBestPracticesFile)
	objectReuseConditions    = promptSection(objectReuseConditionsFile)
)

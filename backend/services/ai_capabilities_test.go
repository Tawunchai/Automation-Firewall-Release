package services

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The capability contract in the system prompt is only worth having if it is TRUE, and what makes
// it true is the applier on the other side of the wire. So this test reads the frontend's
// REST_SECTIONS out of the TypeScript source and compares it, member for member, with the Go list
// the prompt is rendered from.
//
// It reads the file rather than duplicating the list because a duplicated list is the thing that
// drifts. The whole gap this closed — a prompt confidently teaching sections the console cannot
// apply — came from the prompt and the applier being written by different hands at different times.
const restSectionsTSPath = "../../frontend/src/pages/ai-assistant/applyViaREST.ts"

var restSectionsBlockRe = regexp.MustCompile(`(?s)const REST_SECTIONS = new Set\(\[(.*?)\]\)`)
var restSectionsEntryRe = regexp.MustCompile(`"([^"]+)"`)

func TestCapabilityContractMatchesFrontendRESTSections(t *testing.T) {
	src, err := os.ReadFile(restSectionsTSPath)
	if err != nil {
		t.Fatalf("cannot read %s — if applyViaREST.ts moved, this test must follow it: %v", restSectionsTSPath, err)
	}
	m := restSectionsBlockRe.FindSubmatch(src)
	if m == nil {
		t.Fatalf("REST_SECTIONS is no longer a `new Set([...])` literal in %s — the prompt's capability "+
			"contract is generated from the Go twin of that list and nothing else checks them against "+
			"each other", restSectionsTSPath)
	}

	ts := map[string]bool{}
	for _, e := range restSectionsEntryRe.FindAllSubmatch(m[1], -1) {
		ts[string(e[1])] = true
	}
	if len(ts) == 0 {
		t.Fatal("parsed zero sections out of REST_SECTIONS")
	}

	goSet := map[string]bool{}
	for _, s := range consoleRESTSections {
		if goSet[s] {
			t.Errorf("consoleRESTSections lists %q twice", s)
		}
		goSet[s] = true
	}

	var missingInGo, missingInTS []string
	for s := range ts {
		if !goSet[s] {
			missingInGo = append(missingInGo, s)
		}
	}
	for s := range goSet {
		if !ts[s] {
			missingInTS = append(missingInTS, s)
		}
	}
	sort.Strings(missingInGo)
	sort.Strings(missingInTS)

	if len(missingInGo) > 0 {
		t.Errorf("applyViaREST.ts can apply %v, but consoleRESTSections does not list them — the model is "+
			"not being told it can propose these", missingInGo)
	}
	if len(missingInTS) > 0 {
		t.Errorf("consoleRESTSections claims %v, but applyViaREST.ts cannot apply them — the prompt is "+
			"promising the user a wizard that does not exist", missingInTS)
	}
}

// consoleRESTSections must be sorted: the list is rendered into the PROMPT-CACHED block, so its
// order has to be a property of the source, not of whoever appended last.
func TestConsoleRESTSectionsIsSorted(t *testing.T) {
	if !sort.StringsAreSorted(consoleRESTSections) {
		t.Error("consoleRESTSections must be sorted — it is rendered into the cached prompt prefix")
	}
	out := restSectionsForPrompt()
	if !sort.StringsAreSorted(out) {
		t.Error("restSectionsForPrompt must return a sorted list for the same reason")
	}
	if len(out) >= len(consoleRESTSections) {
		t.Error("restSectionsForPrompt should drop the dotted schedule twins and the two tables that " +
			"only travel inside a profile")
	}
	// Two exact entries, because they are the ones the model gets wrong by itself: the spelling it
	// should write, and the one it must not be told it can deploy on its own.
	for _, want := range []string{"firewall schedule recurring", "firewall policy"} {
		if !hasSection(out, want) {
			t.Errorf("the prompt's tier-1 list no longer offers %q", want)
		}
	}
	for _, unwanted := range []string{"firewall.schedule recurring", "webfilter urlfilter", "dnsfilter domain-filter"} {
		if hasSection(out, unwanted) {
			t.Errorf("%q must not be advertised as a standalone capability", unwanted)
		}
	}
}

// The three tiers all have to be there, and the contract has to say what tier 2 COSTS — the whole
// point of the block is that "FortiOS accepts it" and "this console can carry it out safely" are
// different questions.
func TestCapabilityContractStatesAllThreeTiers(t *testing.T) {
	c := capabilityContract()
	for _, want := range []string{
		"TIER 1",
		"TIER 2",
		"TIER 3",
		"NO field validation, NO wizard",    // what tier 2 costs the user
		"NEVER mix tier 1 and tier 2",       // the trap: one unknown section demotes the whole answer
		"Network ▸ Interfaces is READ-ONLY", // the one write this product removed on purpose
		"config firewall policy",            // generated, not hand-written
	} {
		if !strings.Contains(c, want) {
			t.Errorf("capability contract no longer says %q:\n%s", want, c)
		}
	}
	// It must not forbid ANSWERING about tier 2/3 — a firewall engineer asking how HA works should
	// get an answer, not a refusal. That sentence is the difference between a capability contract
	// and a gag.
	if !strings.Contains(c, "answer questions about any of it freely") {
		t.Error("the contract must still allow query-mode answers about everything it will not write")
	}
}

// The contract is interpolated into staticSystemPrompt, which is the prompt-cached block. A bug
// here (a stray verb, the wrong argument order) would not fail the build — it would quietly ship a
// prompt with a %!s(MISSING) in it.
func TestStaticSystemPromptCarriesTheContract(t *testing.T) {
	p := staticSystemPrompt(platformPrompts["fortinet"])
	// Only "%!" — every fmt error starts with it, and the prompt's own prose legitimately
	// contains the words MISSING and EXTRA.
	if strings.Contains(p, "%!") {
		t.Fatalf("staticSystemPrompt has a format-verb error:\n%s", firstLines(p, 40))
	}
	if !strings.Contains(p, "TIER 1 — BUILT OBJECT BY OBJECT") {
		t.Error("the capability contract is not in the static system prompt")
	}
	// Order matters: the contract has to come before the FortiOS reference it qualifies, or the
	// model reads 1,400 lines of "here is how to configure HA" before being told not to.
	if strings.Index(p, "TIER 1 — BUILT OBJECT BY OBJECT") > strings.Index(p, "=== FORTIOS CLI REFERENCE ===") {
		t.Error("the capability contract must come BEFORE the CLI reference")
	}
}

func hasSection(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func firstLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, "\n")
}

package services

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// ── The bug this engine replaces ────────────────────────────────────────────
//
// The old comparison was a set difference:
//
//	setA := Set(linesA); setB := Set(linesB)
//	for l in linesA: if l not in setB -> "- l"
//
// Every test in this block is a change that a set difference reports as NOTHING, because the
// changed line's exact text still appears somewhere in the other file. A FortiGate config is
// mostly repeated boilerplate, so this is not a corner case — it is the common case.

// setDifference reproduces the old algorithm, so the tests can assert that it was blind and the
// new one is not. Keeping it here is the clearest possible regression guard: if someone ever
// "simplifies" DiffConfigs back to a set difference, these fail.
func setDifference(a, b string) (added, removed int) {
	sa := map[string]bool{}
	sb := map[string]bool{}
	for _, l := range strings.Split(a, "\n") {
		sa[l] = true
	}
	for _, l := range strings.Split(b, "\n") {
		sb[l] = true
	}
	for _, l := range strings.Split(a, "\n") {
		if !sb[l] {
			removed++
		}
	}
	for _, l := range strings.Split(b, "\n") {
		if !sa[l] {
			added++
		}
	}
	return added, removed
}

func TestDiffConfigs_SeesAMoveThatSetDifferenceCannot(t *testing.T) {
	// A policy moved from position 1 to position 2 — the classic firewall change that alters
	// behaviour completely and rewrites no line text at all.
	before := `config firewall policy
    edit 1
        set name "allow-web"
    next
    edit 2
        set name "deny-all"
    next
end`
	after := `config firewall policy
    edit 1
        set name "deny-all"
    next
    edit 2
        set name "allow-web"
    next
end`

	if a, r := setDifference(before, after); a != 0 || r != 0 {
		t.Fatalf("fixture is not actually set-difference-blind (added=%d removed=%d)", a, r)
	}

	added, removed := CountConfigChanges(DiffConfigs(before, after))
	if added == 0 || removed == 0 {
		t.Errorf("DiffConfigs missed a reordered rule base: +%d/-%d", added, removed)
	}
}

func TestDiffConfigs_SeesAValueThatExistsElsewhere(t *testing.T) {
	// Two address objects SWAP subnets. Both line texts still exist in both files, so a set
	// difference reports nothing at all — while the firewall now points each name at the other's
	// network, which is as behaviour-changing as an edit gets.
	before := `config firewall address
    edit "a"
        set subnet 10.0.0.0 255.255.255.0
    next
    edit "b"
        set subnet 10.0.1.0 255.255.255.0
    next
end`
	after := `config firewall address
    edit "a"
        set subnet 10.0.1.0 255.255.255.0
    next
    edit "b"
        set subnet 10.0.0.0 255.255.255.0
    next
end`

	if a, r := setDifference(before, after); a != 0 || r != 0 {
		t.Fatalf("fixture is not set-difference-blind (added=%d removed=%d)", a, r)
	}
	added, removed := CountConfigChanges(DiffConfigs(before, after))
	if added == 0 || removed == 0 {
		t.Errorf("DiffConfigs missed a swap that changes what each name resolves to: +%d/-%d", added, removed)
	}
}

func TestDiffConfigs_IgnoresTheVolatileHeader(t *testing.T) {
	// FortiOS stamps a new conf_file_ver on every export. Two identical configs must compare
	// equal, or drift detection reports every nightly backup as a change.
	before := "#config-version=FGT80E-7.2.10\n#conf_file_ver=111111\nconfig system global\n    set hostname \"a\"\nend"
	after := "#config-version=FGT80E-7.2.10\n#conf_file_ver=999999\nconfig system global\n    set hostname \"a\"\nend"

	if added, removed := CountConfigChanges(DiffConfigs(before, after)); added != 0 || removed != 0 {
		t.Errorf("volatile header counted as a change: +%d/-%d", added, removed)
	}
	if s := unifiedConfigDiff(DiffConfigs(before, after), 2); s != "" {
		t.Errorf("rendered a diff for two identical configs:\n%s", s)
	}
}

func TestDiffConfigs_IdenticalIsEmpty(t *testing.T) {
	cfg := "config firewall address\n    edit \"a\"\n        set subnet 10.0.0.0 255.255.255.0\n    next\nend"
	if added, removed := CountConfigChanges(DiffConfigs(cfg, cfg)); added != 0 || removed != 0 {
		t.Errorf("identical configs differ: +%d/-%d", added, removed)
	}
}

// The whole point of patience over LCS: a real backup is 33,000 lines and the header changes on
// line 2, so a naive O(n·m) would be a billion cells on every nightly run.
func TestDiffConfigs_LargeFileIsFast(t *testing.T) {
	var before, after strings.Builder
	before.WriteString("#conf_file_ver=1\n")
	after.WriteString("#conf_file_ver=2\n")
	for i := 0; i < 4000; i++ {
		block := fmt.Sprintf("config firewall address\n    edit \"addr-%d\"\n        set subnet 10.%d.%d.0 255.255.255.0\n    next\nend\n",
			i, i/256, i%256)
		before.WriteString(block)
		if i == 2500 {
			after.WriteString("config firewall address\n    edit \"addr-2500\"\n        set subnet 203.0.113.0 255.255.255.0\n    next\nend\n")
			continue
		}
		after.WriteString(block)
	}

	start := time.Now()
	ops := DiffConfigs(before.String(), after.String())
	elapsed := time.Since(start)

	added, removed := CountConfigChanges(ops)
	if added != 1 || removed != 1 {
		t.Errorf("20,000-line diff found +%d/-%d, want +1/-1", added, removed)
	}
	if elapsed > 3*time.Second {
		t.Errorf("diff of 20,000 lines took %v — patience anchors are not doing their job", elapsed)
	}
}

// ── Structural addressing ───────────────────────────────────────────────────

func TestAddressChangedLines_AttributesToTheObject(t *testing.T) {
	before := `config firewall address
    edit "web"
        set subnet 10.0.0.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set name "p1"
    next
end`
	after := `config firewall address
    edit "web"
        set subnet 10.9.9.0 255.255.255.0
    next
    edit "sneaky"
        set subnet 203.0.113.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set name "p1"
    next
end`

	lines := AddressChangedLines(DiffConfigs(before, after))
	if len(lines) == 0 {
		t.Fatal("no changed lines addressed")
	}
	for _, l := range lines {
		if l.Address.Table != "firewall address" {
			t.Errorf("line %q addressed to %q, want firewall address", strings.TrimSpace(l.Line), l.Address.Table)
		}
		if l.Address.CMDBPath != "firewall/address" {
			t.Errorf("CMDBPath = %q", l.Address.CMDBPath)
		}
		if l.Address.Key == "" {
			t.Errorf("line %q has no object key", strings.TrimSpace(l.Line))
		}
	}
	// The policy block is untouched and must contribute nothing.
	for _, l := range lines {
		if strings.Contains(l.Line, "p1") {
			t.Error("an unchanged policy line leaked into the changed set")
		}
	}
}

// A new object's `edit` line must belong to the object it opens, not to the table — otherwise a
// creation reports as "the table changed" with no name to show.
func TestConfigTracker_EditLineBelongsToItsOwnObject(t *testing.T) {
	var tr configTracker
	tr.feed("config firewall address")
	got := tr.feed(`    edit "sneaky"`)
	if got.Key != "sneaky" {
		t.Errorf("edit line addressed to key %q, want sneaky", got.Key)
	}
	if got.Table != "firewall address" {
		t.Errorf("table = %q", got.Table)
	}

	inner := tr.feed("        set subnet 203.0.113.0 255.255.255.0")
	if inner.Key != "sneaky" {
		t.Errorf("a line inside the object addressed to key %q", inner.Key)
	}

	tr.feed("    next")
	after := tr.feed("    edit \"other\"")
	if after.Key != "other" {
		t.Errorf("after next, key = %q", after.Key)
	}

	tr.feed("    next")
	tr.feed("end")
	if outside := tr.feed("config system global"); !outside.IsZero() {
		t.Errorf("after end, address should be empty, got %+v", outside)
	}
}

func TestUnifiedConfigDiff_RendersContext(t *testing.T) {
	before := "a\nb\nc\nd\ne\nf\ng"
	after := "a\nb\nc\nX\ne\nf\ng"
	out := unifiedConfigDiff(DiffConfigs(before, after), 1)
	if !strings.Contains(out, "- d") || !strings.Contains(out, "+ X") {
		t.Errorf("diff missing the change:\n%s", out)
	}
	if !strings.Contains(out, "  c") || !strings.Contains(out, "  e") {
		t.Errorf("diff missing context lines:\n%s", out)
	}
	if strings.Contains(out, "  a") {
		t.Errorf("context=1 should not reach line a:\n%s", out)
	}
}

package unit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// A coverage ratchet, in the shape of the layout one next door.
//
// ── Why a floor and not a target ─────────────────────────────────────────────
//
// A target invites the argument nobody wins: 40% or 45%, and for which package. A floor asks a
// question with an answer: did this change make a package LESS provable than it already was? A
// package that gains coverage records the gain and keeps it, and nobody has to agree on a number.
//
// ── Why it reads a profile instead of measuring ──────────────────────────────
//
// A test cannot measure the coverage of the packages around it while it is itself one of them. So
// the CI job runs the suite with -coverprofile and hands the file here through COVERAGE_PROFILE.
// With that variable unset — which is every local run — this skips, exactly like the DB-gated
// tests do.
//
// ── Why the numbers it records are the WITH-DATABASE ones ────────────────────
//
// Half of what this repository can prove without a firewall needs Postgres: the device-proxy
// handler tests, the scheduler's two SQL sweeps, the auth package. Those tests skip when their DSN
// is unset, and a budget recorded from a run where they skipped would be a floor so low that
// deleting them all would pass it. The CI job sets every DSN; see the `coverage` job in
// .github/workflows/ci.yml, and regenerate from a run with the same variables set.
//
//	Regenerate:
//	  UPDATE_COVERAGE_BUDGET=1 COVERAGE_PROFILE=coverage.out go test ./test/ -run TestCoverage

const coverageBudgetFile = "coverage-budget.json"

// coverageSlack is how far a package may move before this says anything, in percentage points.
//
// Not zero: a handful of tests read a clock or a map, and a package that legitimately measures
// 41.37% one run and 41.36% the next would otherwise fail a gate for no reason anybody can act on.
// Small enough that a deleted test file is still caught — the smallest test file in this repository
// moves its package by more than this.
const coverageSlack = 0.5

// packageCoverage reads a Go coverage profile and returns percent-of-statements per package.
func packageCoverage(t *testing.T, path string) map[string]float64 {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil && !filepath.IsAbs(path) {
		// `go test` runs each test with its own package directory as the working directory, so a
		// relative path written for the backend root ("coverage.out") lands here in test/.
		raw, err = os.ReadFile(filepath.Join("..", path))
	}
	if err != nil {
		t.Fatalf("COVERAGE_PROFILE names %s, which cannot be read from %s or its parent: %v",
			path, mustWD(t), err)
	}

	type counter struct{ total, covered int }
	per := map[string]*counter{}

	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "mode:") {
			continue
		}
		// network_automation/services/drift/configdrift.go:12.34,56.78 9 1
		fields := strings.Fields(line)
		if len(fields) != 3 {
			t.Fatalf("profile line is not <block> <statements> <count>: %q", line)
		}
		stmts, err1 := strconv.Atoi(fields[1])
		count, err2 := strconv.Atoi(fields[2])
		if err1 != nil || err2 != nil {
			t.Fatalf("profile line has non-numeric counts: %q", line)
		}
		file := fields[0][:strings.LastIndex(fields[0], ":")]
		pkg := file[:strings.LastIndex(file, "/")]

		c := per[pkg]
		if c == nil {
			c = &counter{}
			per[pkg] = c
		}
		c.total += stmts
		if count > 0 {
			c.covered += stmts
		}
	}

	out := make(map[string]float64, len(per))
	for pkg, c := range per {
		if c.total == 0 {
			continue
		}
		// Rounded to two decimals so the recorded file is stable and reviewable, rather than
		// carrying seventeen digits that change on every regeneration.
		out[pkg] = float64(int(float64(c.covered)/float64(c.total)*10000+0.5)) / 100
	}
	return out
}

func mustWD(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		return "the working directory"
	}
	return wd
}

func TestCoverageDoesNotDrop(t *testing.T) {
	profile := os.Getenv("COVERAGE_PROFILE")
	if profile == "" {
		t.Skip("COVERAGE_PROFILE not set — see the note at the top of coverage_budget_test.go")
	}
	current := packageCoverage(t, profile)

	if os.Getenv("UPDATE_COVERAGE_BUDGET") != "" {
		out, err := json.MarshalIndent(current, "", "  ")
		if err != nil {
			t.Fatalf("encode budget: %v", err)
		}
		if err := os.WriteFile(coverageBudgetFile, append(out, '\n'), 0o644); err != nil {
			t.Fatalf("write %s: %v", coverageBudgetFile, err)
		}
		t.Logf("%s written: %d package(s)", coverageBudgetFile, len(current))
		return
	}

	raw, err := os.ReadFile(coverageBudgetFile)
	if err != nil {
		t.Fatalf("%s is missing — regenerate it with "+
			"`UPDATE_COVERAGE_BUDGET=1 COVERAGE_PROFILE=%s go test ./test/ -run TestCoverage`: %v",
			coverageBudgetFile, profile, err)
	}
	var budget map[string]float64
	if err := json.Unmarshal(raw, &budget); err != nil {
		t.Fatalf("%s is not valid JSON: %v", coverageBudgetFile, err)
	}

	var dropped, gained, added, gone []string
	for pkg, got := range current {
		floor, known := budget[pkg]
		if !known {
			added = append(added, fmt.Sprintf("  %-55s %.2f%%", pkg, got))
			continue
		}
		switch {
		case got < floor-coverageSlack:
			dropped = append(dropped, fmt.Sprintf("  %-55s %.2f%%  was %.2f%%  (−%.2f)",
				pkg, got, floor, floor-got))
		case got > floor+coverageSlack:
			gained = append(gained, fmt.Sprintf("  %-55s %.2f%%  was %.2f%%  (+%.2f)",
				pkg, got, floor, got-floor))
		}
	}
	for pkg, floor := range budget {
		if _, still := current[pkg]; !still {
			gone = append(gone, fmt.Sprintf("  %-55s was %.2f%%", pkg, floor))
		}
	}
	sort.Strings(dropped)
	sort.Strings(gained)
	sort.Strings(added)
	sort.Strings(gone)

	regenerate := fmt.Sprintf("UPDATE_COVERAGE_BUDGET=1 COVERAGE_PROFILE=%s go test ./test/ -run TestCoverage", profile)

	if len(dropped) > 0 {
		t.Errorf("coverage fell in %d package(s):\n%s\n\n"+
			"Something that used to be proved is not proved any more. Put the test back, or cover "+
			"the code another way. If the drop is deliberate — code deleted, a package reshaped — "+
			"lower the floor in the same change with:\n  %s",
			len(dropped), strings.Join(dropped, "\n"), regenerate)
	}
	if len(gained) > 0 {
		t.Errorf("coverage rose in %d package(s) and the floor was not raised with it:\n%s\n\n"+
			"A gain that is not recorded can be undone silently by the next change. Lock it in:\n  %s",
			len(gained), strings.Join(gained, "\n"), regenerate)
	}
	if len(added) > 0 {
		t.Errorf("%d package(s) are not in the budget:\n%s\n\n"+
			"A new package starts with the floor it is born at, so it can only improve from there:\n  %s",
			len(added), strings.Join(added, "\n"), regenerate)
	}
	if len(gone) > 0 {
		t.Errorf("%d package(s) in the budget produced no coverage at all:\n%s\n\n"+
			"Either the package was removed or renamed — in which case drop it from the budget in "+
			"the same change — or its whole test suite stopped running, which is the thing this "+
			"gate exists to notice:\n  %s",
			len(gone), strings.Join(gone, "\n"), regenerate)
	}
}

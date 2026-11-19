package services

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Nothing in this package may send a DELETE to a FortiGate except through a table that was handed
// an mkey.
//
// DELETE /api/v2/cmdb/firewall/address answers 200 and empties the table. It happened here once —
// every policy on the lab device — and the guard since then has been a PreToolUse hook watching a
// terminal, plus everyone remembering. cmdbPath.Delete makes the collection URL inexpressible, but
// only for as long as it is the only door, and `f.do("DELETE", …)` is one line away from being
// written again.
//
// Two files are allowed to say DELETE, and both have their own guard:
//
//   - fortigate_cmdb.go is the door itself.
//   - changeledger.go builds a revert request, where BuildRevertRequest refuses an undo of a
//     create whose mkey was never recorded, for exactly this reason — see its comment, and
//     TestBuildRevertRequest_NeverDeletesACollection.
//
// This test reads source, so it needs no FortiGate and no database.
func TestNoDeleteIsSentOutsideTheTableType(t *testing.T) {
	allowed := map[string]bool{
		"fortigate_cmdb.go": true,
		"changeledger.go":   true,
	}
	// f.do("DELETE", …) in any spelling, including the fire-and-forget form with no result.
	sendsDelete := regexp.MustCompile(`\.do\(\s*(?:"DELETE"|http\.MethodDelete)`)

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no .go files found — this guard would pass vacuously")
	}
	for _, path := range files {
		name := filepath.Base(path)
		if allowed[name] || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if sendsDelete.MatchString(line) {
				t.Errorf("%s:%d sends its own DELETE — use a cmdbPath/cmdbTable and pass the mkey:\n\t%s",
					name, i+1, strings.TrimSpace(line))
			}
		}
	}
}

// Every table this package addresses is declared with both halves filled in.
//
// A cmdbPath with an empty path would send a DELETE to /api/v2/cmdb/ — and one with an empty noun
// makes the refusal it writes ("refusing to DELETE … not one ") unreadable at the moment someone
// most needs to read it.
func TestEveryDeclaredTableIsComplete(t *testing.T) {
	decl := regexp.MustCompile(`cmdbPath\{path: "([^"]*)", noun: "([^"]*)"\}`)

	files, _ := filepath.Glob("*.go")
	seen := 0
	for _, path := range files {
		name := filepath.Base(path)
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, m := range decl.FindAllStringSubmatch(string(src), -1) {
			seen++
			p, noun := m[1], m[2]
			switch {
			case strings.TrimSpace(p) == "":
				t.Errorf("%s: a table with no path", name)
			case strings.HasPrefix(p, "/") || strings.Contains(p, "/api/v2/"):
				// The prefix is the type's job. A path carrying it would produce
				// /api/v2/cmdb//api/v2/cmdb/… and 404 every call on that table.
				t.Errorf("%s: table %q carries the /api/v2/cmdb/ prefix itself", name, p)
			case strings.HasSuffix(p, "/"):
				t.Errorf("%s: table %q ends in a slash", name, p)
			case strings.TrimSpace(noun) == "":
				t.Errorf("%s: table %q has no noun, so its refusals read as a blank", name, p)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no cmdbPath declarations found — the search pattern no longer matches")
	}
}

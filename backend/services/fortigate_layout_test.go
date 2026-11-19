package services

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fortigate.go was a single 7,798-line file that every feature had to touch: adding a Web Filter
// field, a VPN template and a static-route option all landed in the same place, so every branch
// conflicted with every other one, and finding the call you wanted meant scrolling past five
// unrelated domains. It was split into fortigate_<domain>.go files, purely by moving code.
//
// These tests keep it split. They are cheap and they fail loudly, which is the point: nothing else
// notices a file quietly growing back, and by the time anyone does, the merge conflicts have
// already happened.

// maxFileLines is a ceiling with room to grow, not a target. The largest domain file today is
// ~1,300 lines; a file past 1,600 is a signal that it holds more than one domain and should be
// split again, exactly as fortigate.go was.
const maxFileLines = 1600

func fortigateSourceFiles(t *testing.T) []string {
	t.Helper()
	matches, err := filepath.Glob("fortigate*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	var out []string
	for _, m := range matches {
		if !strings.HasSuffix(m, "_test.go") {
			out = append(out, m)
		}
	}
	if len(out) < 10 {
		t.Fatalf("found only %d fortigate source files (%v) — the domain split is gone", len(out), out)
	}
	return out
}

func TestFortiGateFilesStaySplit(t *testing.T) {
	for _, name := range fortigateSourceFiles(t) {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		lines := bytes.Count(src, []byte("\n")) + 1
		if lines > maxFileLines {
			t.Errorf("%s is %d lines, over the %d ceiling — split it by domain into another "+
				"fortigate_<domain>.go rather than letting one file own several",
				name, lines, maxFileLines)
		}
	}
}

// The base file holds the client and the shared types; everything domain-specific was moved out.
// If it is the biggest file again, the split has been undone from the inside.
func TestFortiGateBaseFileIsNotTheBiggest(t *testing.T) {
	files := fortigateSourceFiles(t)

	sizes := make(map[string]int, len(files))
	for _, name := range files {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		sizes[name] = bytes.Count(src, []byte("\n")) + 1
	}

	base := sizes["fortigate.go"]
	if base == 0 {
		t.Fatal("fortigate.go not found")
	}
	for name, n := range sizes {
		if name != "fortigate.go" && n > base {
			return // something else is bigger, which is what we want
		}
	}
	t.Errorf("fortigate.go is the largest fortigate file at %d lines — domain code is collecting "+
		"in the base file again; it should hold only the client, the shared types and the "+
		"conversion helpers", base)
}

// The one thing a mechanical split can silently break: a domain file that forgets it is part of
// this package, or that declares its own. Cheap to check, impossible to debug from the symptom.
func TestFortiGateFilesAreOnePackage(t *testing.T) {
	for _, name := range fortigateSourceFiles(t) {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !bytes.HasPrefix(src, []byte("package services\n")) &&
			!bytes.HasPrefix(src, []byte("package services\r\n")) {
			t.Errorf("%s does not start with `package services`", name)
		}
	}
}

package services

import (
	"regexp"
	"sort"
	"strings"
)

// Configuration diffing, and the structural parse that gives every changed line an address.
//
// ── Why this replaces what was here ──────────────────────────────────────────
//
// Two places compared FortiGate configurations, and both used a SET DIFFERENCE:
//
//	setA := new Set(linesA); setB := new Set(linesB)
//	linesA.forEach(l => { if (!setB.has(l)) diff.push("- " + l) })   // device/index.tsx
//
// A set difference cannot see order, and it collapses duplicates. A FortiGate configuration is
// tens of thousands of lines of which most are repeats — `next`, `end`, `        set status
// enable` occur thousands of times each — so any line whose exact text appears ANYWHERE in the
// other file counts as unchanged. Moving a policy, reordering a rule base, or changing a value to
// one that already exists elsewhere all come out as "no change".
//
// That is tolerable for a human eyeballing a viewer. It is useless as the basis for "did somebody
// change this firewall behind our back", which is what configdrift.go asks of it.
//
// ── Why patience diff rather than plain LCS ──────────────────────────────────
//
// FortiGate stamps `#conf_file_ver=<a new number every time>` on line 2 of every backup, so the
// common prefix of two backups is ONE line. A textbook LCS over 33,000 lines is O(n·m) — a
// billion cells — and it is also the wrong shape: the useful anchors in a config file are the
// `edit "name"` lines, which are unique, and patience diff is built around exactly that.
//
// Patience: take the lines that occur EXACTLY ONCE on both sides, find the longest increasing
// subsequence of their positions, and recurse between consecutive anchors. Near-linear on real
// configs, and the hunks it produces line up with objects instead of cutting across them.

// ── Config-file line classification ─────────────────────────────────────────

// volatileConfigLine matches header lines FortiOS rewrites on every export. They carry no
// configuration and, left in, they make every backup differ from every other backup.
var volatileConfigLine = regexp.MustCompile(`^#(conf_file_ver|config-version|buildno|global_vdom)=`)

// isVolatileConfigLine reports whether a line changes on its own between two identical configs.
func isVolatileConfigLine(line string) bool {
	return volatileConfigLine.MatchString(strings.TrimSpace(line))
}

// ── Diff ────────────────────────────────────────────────────────────────────

// DiffOp is one edit in a diff.
type DiffOp struct {
	// Kind is "+" (only in B), "-" (only in A) or " " (common).
	Kind string
	Line string
	// AIndex / BIndex are 0-based line numbers in the respective file, or -1 when the line is not
	// present on that side. Used to attribute a change to the object it sits inside.
	AIndex int
	BIndex int
}

// DiffConfigs compares two configuration files and returns the edits, ignoring the volatile
// header lines FortiOS rewrites on every export.
//
// Common lines are included so a caller can walk the result and keep structural context (which
// `config` block and which `edit` it is inside). Callers that only want changes filter on Kind.
func DiffConfigs(before, after string) []DiffOp {
	a := splitConfigLines(before)
	b := splitConfigLines(after)
	ops := make([]DiffOp, 0, len(a)/8+16)
	patienceDiff(a, b, 0, len(a), 0, len(b), &ops)
	return ops
}

func splitConfigLines(s string) []string {
	// Normalise CRLF: a config fetched over REST and the same config fetched over SSH differ in
	// line endings, and every line would otherwise read as changed.
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// patienceDiff appends the edits between a[aLo:aHi] and b[bLo:bHi].
func patienceDiff(a, b []string, aLo, aHi, bLo, bHi int, out *[]DiffOp) {
	// Trim the matching head and tail first. On two backups of the same device this removes the
	// overwhelming majority of the file before any real work happens.
	for aLo < aHi && bLo < bHi && a[aLo] == b[bLo] {
		*out = append(*out, DiffOp{Kind: " ", Line: a[aLo], AIndex: aLo, BIndex: bLo})
		aLo++
		bLo++
	}
	tail := make([]DiffOp, 0, 8)
	for aHi > aLo && bHi > bLo && a[aHi-1] == b[bHi-1] {
		aHi--
		bHi--
		tail = append(tail, DiffOp{Kind: " ", Line: a[aHi], AIndex: aHi, BIndex: bHi})
	}
	defer func() {
		// tail was collected back to front.
		for i := len(tail) - 1; i >= 0; i-- {
			*out = append(*out, tail[i])
		}
	}()

	switch {
	case aLo == aHi && bLo == bHi:
		return
	case aLo == aHi:
		for i := bLo; i < bHi; i++ {
			*out = append(*out, DiffOp{Kind: "+", Line: b[i], AIndex: -1, BIndex: i})
		}
		return
	case bLo == bHi:
		for i := aLo; i < aHi; i++ {
			*out = append(*out, DiffOp{Kind: "-", Line: a[i], AIndex: i, BIndex: -1})
		}
		return
	}

	anchors := uniqueCommonAnchors(a, b, aLo, aHi, bLo, bHi)
	if len(anchors) == 0 {
		// No line is unique on both sides in this region — a block of repeated boilerplate. Emit
		// it as a straight replacement rather than recursing forever.
		for i := aLo; i < aHi; i++ {
			*out = append(*out, DiffOp{Kind: "-", Line: a[i], AIndex: i, BIndex: -1})
		}
		for i := bLo; i < bHi; i++ {
			*out = append(*out, DiffOp{Kind: "+", Line: b[i], AIndex: -1, BIndex: i})
		}
		return
	}

	prevA, prevB := aLo, bLo
	for _, an := range anchors {
		patienceDiff(a, b, prevA, an.aIdx, prevB, an.bIdx, out)
		*out = append(*out, DiffOp{Kind: " ", Line: a[an.aIdx], AIndex: an.aIdx, BIndex: an.bIdx})
		prevA, prevB = an.aIdx+1, an.bIdx+1
	}
	patienceDiff(a, b, prevA, aHi, prevB, bHi, out)
}

type anchor struct{ aIdx, bIdx int }

// uniqueCommonAnchors returns the longest increasing run of lines that appear exactly once in
// each side of the region — the patience-diff anchor set.
func uniqueCommonAnchors(a, b []string, aLo, aHi, bLo, bHi int) []anchor {
	countA := make(map[string]int, aHi-aLo)
	posA := make(map[string]int, aHi-aLo)
	for i := aLo; i < aHi; i++ {
		countA[a[i]]++
		posA[a[i]] = i
	}
	countB := make(map[string]int, bHi-bLo)
	posB := make(map[string]int, bHi-bLo)
	for i := bLo; i < bHi; i++ {
		countB[b[i]]++
		posB[b[i]] = i
	}

	cands := make([]anchor, 0, 32)
	for line, ca := range countA {
		if ca != 1 || countB[line] != 1 {
			continue
		}
		cands = append(cands, anchor{aIdx: posA[line], bIdx: posB[line]})
	}
	if len(cands) == 0 {
		return nil
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].aIdx < cands[j].aIdx })
	return longestIncreasingByB(cands)
}

// longestIncreasingByB keeps the longest subsequence whose bIdx also increases — the anchors that
// are in the same relative order on both sides. Anything else is a move, and treating a move as an
// anchor would drag unrelated hunks together. O(n log n) patience sort.
func longestIncreasingByB(cands []anchor) []anchor {
	if len(cands) == 0 {
		return nil
	}
	tails := make([]int, 0, len(cands)) // index into cands of each pile's top
	prev := make([]int, len(cands))     // back-pointer for reconstruction
	for i := range prev {
		prev[i] = -1
	}
	for i, c := range cands {
		lo, hi := 0, len(tails)
		for lo < hi {
			mid := (lo + hi) / 2
			if cands[tails[mid]].bIdx < c.bIdx {
				lo = mid + 1
			} else {
				hi = mid
			}
		}
		if lo > 0 {
			prev[i] = tails[lo-1]
		}
		if lo == len(tails) {
			tails = append(tails, i)
		} else {
			tails[lo] = i
		}
	}

	out := make([]anchor, 0, len(tails))
	for i := tails[len(tails)-1]; i >= 0; i = prev[i] {
		out = append(out, cands[i])
	}
	for l, r := 0, len(out)-1; l < r; l, r = l+1, r-1 {
		out[l], out[r] = out[r], out[l]
	}
	return out
}

// ── Structural address of a line ────────────────────────────────────────────
//
// A changed line on its own says nothing useful — `        set dstintf "port1"` could belong to
// any of two hundred objects. Drift reporting needs the OBJECT, so the diff is walked while
// tracking the `config …` / `edit …` / `next` / `end` nesting the file is built from:
//
//	config firewall address          ← table
//	    edit "sneaky-backdoor"       ← mkey
//	        set subnet 203.0.113.0 255.255.255.0
//	    next
//	end

var (
	configLineRe = regexp.MustCompile(`^\s*config\s+(.+?)\s*$`)
	editLineRe   = regexp.MustCompile(`^\s*edit\s+"?([^"]*)"?\s*$`)
	endLineRe    = regexp.MustCompile(`^\s*end\s*$`)
	nextLineRe   = regexp.MustCompile(`^\s*next\s*$`)
)

// IsCMDBEditLine reports a CLI line that opens an object inside a table — `edit "LAN-NET"`.
//
// It is exported because the drift package asks the same question of a diff line and must get the
// same answer; a second regular expression there would be a second definition of "this line names
// an object", and the two would drift apart the first time FortiOS changed the spelling.
func IsCMDBEditLine(line string) bool { return editLineRe.MatchString(line) }

// ConfigAddress is where in the configuration tree a line sits.
type ConfigAddress struct {
	// Table is the CLI path with spaces, as the file writes it: "firewall address".
	Table string
	// CMDBPath is the same thing with slashes, as the REST API and the change ledger spell it:
	// "firewall/address". These two notations are the whole reason this type exists — the diff
	// speaks CLI and the ledger speaks CMDB, and drift matching has to join them.
	CMDBPath string
	// Key is the mkey of the `edit` block, or "" for a line at table level.
	Key string
}

// IsZero reports an address that names nothing — a line outside any config block.
func (a ConfigAddress) IsZero() bool { return a.Table == "" }

// String renders the address the way a person reads it.
func (a ConfigAddress) String() string {
	if a.Key == "" {
		return a.Table
	}
	return a.Table + " / " + a.Key
}

// configTracker follows the nesting as lines are fed to it in file order.
type configTracker struct {
	tables []string // stack of `config` paths
	keys   []string // stack of `edit` mkeys, parallel to tables
}

// feed advances the tracker over one line and returns the address that line belongs to.
//
// The address is computed BEFORE applying a `config`/`end` on the same line, so the `config
// firewall address` line itself belongs to its parent, not to the block it opens — which is what
// makes "this whole table appeared" read correctly.
func (t *configTracker) feed(line string) ConfigAddress {
	at := t.current()

	switch {
	case configLineRe.MatchString(line):
		table := configLineRe.FindStringSubmatch(line)[1]
		t.tables = append(t.tables, table)
		t.keys = append(t.keys, "")
	case endLineRe.MatchString(line):
		if n := len(t.tables); n > 0 {
			t.tables = t.tables[:n-1]
			t.keys = t.keys[:n-1]
		}
	case editLineRe.MatchString(line):
		if n := len(t.keys); n > 0 {
			t.keys[n-1] = editLineRe.FindStringSubmatch(line)[1]
			// The `edit` line belongs to the object it opens, not to the table — otherwise a
			// newly created object reports as a change to the table with no key.
			return t.current()
		}
	case nextLineRe.MatchString(line):
		if n := len(t.keys); n > 0 {
			t.keys[n-1] = ""
		}
	}
	return at
}

func (t *configTracker) current() ConfigAddress {
	if len(t.tables) == 0 {
		return ConfigAddress{}
	}
	// Nested tables (`config firewall policy` → `config … ` inside an object) are joined so the
	// address stays unique; in practice the outermost is what the ledger records.
	table := strings.Join(t.tables, " ")
	key := ""
	for i := len(t.keys) - 1; i >= 0; i-- {
		if t.keys[i] != "" {
			key = t.keys[i]
			break
		}
	}
	return ConfigAddress{
		Table:    table,
		CMDBPath: strings.ReplaceAll(t.tables[0], " ", "/"),
		Key:      key,
	}
}

// AddressedDiffLine is one changed line with the object it belongs to.
type AddressedDiffLine struct {
	Kind    string // "+" or "-"
	Line    string
	Address ConfigAddress
}

// AddressChangedLines walks a diff and attaches a structural address to every changed line.
//
// Both sides are tracked separately: a removed line's address comes from the BEFORE file's
// nesting and an added line's from the AFTER file's, because a block that was deleted entirely
// exists in only one of them.
func AddressChangedLines(ops []DiffOp) []AddressedDiffLine {
	var beforeT, afterT configTracker
	out := make([]AddressedDiffLine, 0, 64)

	for _, op := range ops {
		switch op.Kind {
		case " ":
			beforeT.feed(op.Line)
			afterT.feed(op.Line)
		case "-":
			addr := beforeT.feed(op.Line)
			if !isVolatileConfigLine(op.Line) {
				out = append(out, AddressedDiffLine{Kind: "-", Line: op.Line, Address: addr})
			}
		case "+":
			addr := afterT.feed(op.Line)
			if !isVolatileConfigLine(op.Line) {
				out = append(out, AddressedDiffLine{Kind: "+", Line: op.Line, Address: addr})
			}
		}
	}
	return out
}

// ── Rendering ───────────────────────────────────────────────────────────────

// unifiedConfigDiff renders a diff the way DiffView already expects to read one, with `context`
// unchanged lines around each hunk.
func unifiedConfigDiff(ops []DiffOp, context int) string {
	if context < 0 {
		context = 0
	}
	changed := make([]int, 0, 64)
	for i, op := range ops {
		if op.Kind != " " && !isVolatileConfigLine(op.Line) {
			changed = append(changed, i)
		}
	}
	if len(changed) == 0 {
		return ""
	}

	keep := make([]bool, len(ops))
	for _, i := range changed {
		lo, hi := i-context, i+context
		if lo < 0 {
			lo = 0
		}
		if hi >= len(ops) {
			hi = len(ops) - 1
		}
		for j := lo; j <= hi; j++ {
			keep[j] = true
		}
	}

	var sb strings.Builder
	gap := false
	for i, op := range ops {
		if !keep[i] {
			gap = true
			continue
		}
		if gap && sb.Len() > 0 {
			sb.WriteString("@@\n")
		}
		gap = false
		sb.WriteString(op.Kind)
		sb.WriteString(" ")
		sb.WriteString(op.Line)
		sb.WriteString("\n")
	}
	return strings.TrimSuffix(sb.String(), "\n")
}

// CountConfigChanges returns how many lines were added and removed, ignoring volatile headers.
func CountConfigChanges(ops []DiffOp) (added, removed int) {
	for _, op := range ops {
		if isVolatileConfigLine(op.Line) {
			continue
		}
		switch op.Kind {
		case "+":
			added++
		case "-":
			removed++
		}
	}
	return added, removed
}

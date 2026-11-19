package services

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// A webfilter table id is an MKEY the author picks, and the AI picks it from a list of what is
// already taken. That list comes from the device and is usually right — but "usually" is doing a
// lot of work when the consequence is a live block list being edited by a proposal the user read
// as creating a new one.
//
// ── Why this warns instead of renumbering ────────────────────────────────────
//
// The obvious fix is to renumber a colliding table to the next free id. It was not done, because a
// collision is AMBIGUOUS in a way that matters:
//
//   - Over REST, writing a table that exists replaces it, and renumbering would be right.
//   - Over SSH — which is the path this guard exists for, the one with no validators —
//     `config webfilter urlfilter / edit 3 / config entries / edit 7 / set url … / next / end`
//     ADDS an entry to table 3 and leaves everything else in it alone. That is a legitimate
//     "add this domain to the existing block list", and renumbering it would silently create a
//     SECOND table that nothing references, leaving the user convinced the site is blocked.
//
// VERIFIED LIVE on the lab 80E (FortiOS 7.2.10), 2026-11-18 — both halves, which until then were
// reasoning rather than measurement:
//
//   - a throwaway urlfilter table was created with entries 1 and 2, then the CLI block above was
//     run over SSH with `edit 7`. The device answered "new entry '7' added" and the table came
//     back holding 1, 2 AND 7, with its name and comment untouched. `edit 1` on an EXISTING entry
//     likewise changed only that entry and left 2 and 7 alone.
//   - the same table, PUT over REST with an `entries` array of one, came back holding that one
//     entry and nothing else. REST replaces.
//
// So the two paths really do mean different things for the same id, the ambiguity this guard
// refuses to resolve is real, and warning remains the only move that is correct either way.
//
// Nothing in the CLI distinguishes the two intents reliably. So this does the one thing that is
// correct either way: it tells the person about to press Apply that the id is live, and names it.
// A human can tell "add to the existing list" from "make a new one"; a regex cannot.

var (
	webfilterTableHeaderRe = regexp.MustCompile(`^\s*config\s+webfilter\s+(urlfilter|content)\s*$`)
	// The DNS Filter's Static Domain Filter is the same thing in another table: keyed by a number
	// the author picks, so `edit 3` on a live id edits that block list. It is guarded here too
	// because it is the one the AI writes most often ("block facebook at DNS").
	dnsTableHeaderRe = regexp.MustCompile(`^\s*config\s+dnsfilter\s+domain-filter\s*$`)
	editIDRe         = regexp.MustCompile(`^\s*edit\s+(\d+)\s*$`)
	endRe            = regexp.MustCompile(`^\s*end\s*$`)
)

// tableKindLabel turns an inUse map key into the words a person reads in the warning.
func tableKindLabel(kind string) string {
	if kind == "dns-domain-filter" {
		return "dnsfilter domain-filter table"
	}
	return "webfilter " + kind + " table"
}

// liveTableIDsNamed returns the table ids a command list writes to that are already on the device,
// keyed by table kind.
func liveTableIDsNamed(commands []string, inUse map[string][]int) map[string][]int {
	if len(inUse) == 0 {
		return nil
	}
	taken := map[string]map[int]bool{}
	for kind, ids := range inUse {
		m := make(map[int]bool, len(ids))
		for _, id := range ids {
			m[id] = true
		}
		taken[kind] = m
	}

	hits := map[string][]int{}
	kind := ""
	depth := 0
	for _, line := range commands {
		if m := webfilterTableHeaderRe.FindStringSubmatch(line); m != nil {
			kind, depth = m[1], 0
			continue
		}
		if dnsTableHeaderRe.MatchString(line) {
			kind, depth = "dns-domain-filter", 0
			continue
		}
		if kind == "" {
			continue
		}
		// Only the OUTER `edit <id>` names a table. Inside `config entries` the same syntax names
		// an entry within it, which is not an mkey anyone can collide with.
		if strings.HasPrefix(strings.TrimSpace(line), "config ") {
			depth++
			continue
		}
		if endRe.MatchString(line) {
			if depth == 0 {
				kind = ""
			} else {
				depth--
			}
			continue
		}
		if depth != 0 {
			continue
		}
		if m := editIDRe.FindStringSubmatch(line); m != nil {
			id, err := strconv.Atoi(m[1])
			if err != nil || !taken[kind][id] {
				continue
			}
			if !containsInt(hits[kind], id) {
				hits[kind] = append(hits[kind], id)
			}
		}
	}
	for kind := range hits {
		sort.Ints(hits[kind])
	}
	return hits
}

func containsInt(xs []int, want int) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

// warnOnLiveTableIDs appends a warning to the explanation naming every numerically keyed filter
// table (webfilter urlfilter/content, dnsfilter domain-filter) the proposal writes to that already
// exists on the device.
//
// The warning is in the explanation rather than in a log line because the person who needs it is
// the one reading the proposal with their finger over Apply.
func warnOnLiveTableIDs(commands []string, explanation string, inUse map[string][]int) string {
	hits := liveTableIDsNamed(commands, inUse)
	if len(hits) == 0 {
		return explanation
	}

	kinds := make([]string, 0, len(hits))
	for kind := range hits {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)

	var parts []string
	for _, kind := range kinds {
		ids := make([]string, 0, len(hits[kind]))
		for _, id := range hits[kind] {
			ids = append(ids, strconv.Itoa(id))
		}
		parts = append(parts, fmt.Sprintf("%s %s", tableKindLabel(kind), strings.Join(ids, ", ")))
	}

	return strings.TrimRight(explanation, " \n") + fmt.Sprintf(
		"\n\n⚠️ This proposal writes to %s, which ALREADY EXISTS on the device. "+
			"A table id is the table's key: applying this edits that table rather than creating a new one. "+
			"If you meant to add to the existing list, that is what will happen. If you meant a NEW list, "+
			"ask for it to use a free id before you apply.",
		strings.Join(parts, " and "))
}

// Package services - AI Assistant: converts plain-language requests into FortiOS CLI commands
// using the Anthropic Claude API (FortiGate / FortiOS only).
package services

import (
	"log"
	"regexp"
	"strconv"
	"strings"
)

// Sanitizers: what is taken out of the model's answer before anyone sees it.
//
// Each of these exists because the model produced something the firewall would have accepted and the
// operator did not want - a web filter that repeats one already on the device, an app list that does
// the same, a signature id that does not exist. They run between the model and the wizard.

func dropRedundantWebFilters(commands []string, facts *deviceFacts) []string {
	if len(commands) == 0 || len(facts.wfCoverage) == 0 {
		return commands
	}
	blocks := splitTopLevelCLIBlocks(commands)

	// Every URL the proposal would BLOCK, gathered from its urlfilter tables (the table lives in a
	// separate top-level block from the profile that references it).
	proposedURLs := map[string]bool{}
	for _, blk := range blocks {
		if !reWebfilterURLTable.MatchString(commands[blk.start]) {
			continue
		}
		var url string
		for _, l := range commands[blk.start:blk.end] {
			if m := reSetURL.FindStringSubmatch(l); m != nil {
				url = strings.ToLower(strings.Trim(m[1], `"`))
			} else if m := reAction.FindStringSubmatch(l); m != nil && url != "" {
				if strings.EqualFold(m[1], "block") {
					proposedURLs[url] = true
				}
				url = ""
			}
		}
	}
	if len(proposedURLs) == 0 {
		return commands
	}

	// Which profile blocks are redundant? (name exists AND every proposed URL is already blocked)
	redundant := false
	for _, blk := range blocks {
		if !reWebfilterProfile.MatchString(commands[blk.start]) {
			continue
		}
		name := ""
		for _, l := range commands[blk.start:blk.end] {
			if m := reEditName.FindStringSubmatch(l); m != nil {
				name = m[1]
				break
			}
		}
		blocked, exists := facts.wfCoverage[name]
		if !exists {
			return commands // a NEW profile — keep everything
		}
		for u := range proposedURLs {
			if !blocked[u] {
				return commands // adds a URL the profile doesn't block yet — keep everything
			}
		}
		redundant = true
		log.Printf("[ai] dropped redundant web filter profile %q — every URL it blocks is already blocked there", name)
	}
	if !redundant {
		return commands
	}

	// Drop the profile blocks and the urlfilter tables that only existed to feed them.
	out := make([]string, 0, len(commands))
	for _, blk := range blocks {
		head := commands[blk.start]
		if reWebfilterProfile.MatchString(head) || reWebfilterURLTable.MatchString(head) {
			continue
		}
		out = append(out, commands[blk.start:blk.end]...)
	}
	return out
}

type cliBlock struct{ start, end int } // [start,end) — end is past the closing "end"

// splitTopLevelCLIBlocks indexes each top-level `config … end` block, balanced so a nested
// `config entries … end` never closes its parent.
func splitTopLevelCLIBlocks(commands []string) []cliBlock {
	blocks := make([]cliBlock, 0, 4)
	i := 0
	for i < len(commands) {
		if !reConfigLine.MatchString(commands[i]) {
			i++
			continue
		}
		start, depth := i, 0
		for i < len(commands) {
			if reConfigLine.MatchString(commands[i]) {
				depth++
			} else if reEndLine.MatchString(commands[i]) {
				depth--
				if depth == 0 {
					i++
					break
				}
			}
			i++
		}
		blocks = append(blocks, cliBlock{start, i})
	}
	return blocks
}

// dropRedundantAppLists removes any "config application list" block that would block NOTHING the
// named sensor doesn't already block. When an existing sensor already covers the request the model
// is told to return no config — but it likes to re-state the profile anyway, which shows the user a
// pointless Apply button (and risks a duplicate-name error). Whether a proposal actually changes
// anything is a fact about the device, so it is decided here rather than left to the prompt.
var (
	reAppListHeader = regexp.MustCompile(`(?i)^\s*config\s+application\s+list\s*$`)
	reConfigLine    = regexp.MustCompile(`(?i)^\s*config\b`)
	reEndLine       = regexp.MustCompile(`(?i)^\s*end\b`)
	reEditName      = regexp.MustCompile(`(?i)^\s*edit\s+"?([^"\n]+?)"?\s*$`)
	reApps          = regexp.MustCompile(`(?i)^\s*set\s+application\s+([\d\s]+)$`)
	reCats          = regexp.MustCompile(`(?i)^\s*set\s+category\s+([\d\s]+)$`)
	reAction        = regexp.MustCompile(`(?i)^\s*set\s+action\s+(\S+)`)

	reWebfilterProfile  = regexp.MustCompile(`(?i)^\s*config\s+webfilter\s+profile\s*$`)
	reWebfilterURLTable = regexp.MustCompile(`(?i)^\s*config\s+webfilter\s+urlfilter\s*$`)
	reSetURL            = regexp.MustCompile(`(?i)^\s*set\s+url\s+(.+?)\s*$`)
)

func dropRedundantAppLists(commands []string, facts *deviceFacts) []string {
	if len(commands) == 0 || len(facts.appCoverage) == 0 {
		return commands
	}
	out := make([]string, 0, len(commands))
	i := 0
	for i < len(commands) {
		if !reAppListHeader.MatchString(commands[i]) {
			out = append(out, commands[i])
			i++
			continue
		}
		// Collect the whole block (balanced on config/end).
		start := i
		depth := 0
		for i < len(commands) {
			l := commands[i]
			if reConfigLine.MatchString(l) {
				depth++
			} else if reEndLine.MatchString(l) {
				depth--
				if depth == 0 {
					i++
					break
				}
			}
			i++
		}
		block := commands[start:i]

		// What would this block newly block? (sensor name, app ids, categories with a blocking action)
		name := ""
		propApps, propCats := map[int]bool{}, map[int]bool{}
		pendingCats := []int{}
		for _, l := range block {
			if name == "" {
				if m := reEditName.FindStringSubmatch(l); m != nil {
					name = m[1]
					continue
				}
			}
			if m := reApps.FindStringSubmatch(l); m != nil {
				for _, t := range strings.Fields(m[1]) {
					if n, e := strconv.Atoi(t); e == nil {
						propApps[n] = true
					}
				}
				continue
			}
			if m := reCats.FindStringSubmatch(l); m != nil {
				pendingCats = pendingCats[:0]
				for _, t := range strings.Fields(m[1]) {
					if n, e := strconv.Atoi(t); e == nil {
						pendingCats = append(pendingCats, n)
					}
				}
				continue
			}
			if m := reAction.FindStringSubmatch(l); m != nil && isBlockingAction(m[1]) {
				for _, c := range pendingCats {
					propCats[c] = true
				}
			}
		}

		cov, exists := facts.appCoverage[name]
		if !exists {
			out = append(out, block...) // new sensor — keep it
			continue
		}
		adds := false
		for id := range propApps {
			if !cov.apps[id] {
				adds = true
				break
			}
		}
		if !adds {
			for c := range propCats {
				if !cov.cats[c] {
					adds = true
					break
				}
			}
		}
		if adds {
			out = append(out, block...)
			continue
		}
		log.Printf("[ai] dropped redundant application list %q — it blocks nothing the device isn't already blocking", name)
	}
	return out
}

// sanitizeAppSignatureCommands repairs every "set application …" line of an application list:
//   - a signature NAME (the model sometimes writes one) is resolved to its numeric id;
//   - an id the device's signature database doesn't have is DROPPED (it would match nothing);
//   - duplicates are removed;
//   - FAMILY COMPLETION: if the line contains a family's ROOT signature (e.g. 15832 "Facebook"), every
//     other signature of that family (Facebook.App, Facebook_Chat, Facebook.Messenger.*, …) is added.
//     Naming the root app means "this app", and a partial list is a failed block. A line that names
//     only specific variants (no root) is left alone — that is deliberate fine-grained intent.
func sanitizeAppSignatureCommands(commands []string, meta AppControlMetadata) []string {
	if len(commands) == 0 || len(meta.Applications) == 0 {
		return commands
	}
	byID := make(map[int]AppSignatureMeta, len(meta.Applications))
	idByName := make(map[string]int, len(meta.Applications))
	familyIDs := map[string][]int{}
	rootID := map[string]int{} // family → the id of the signature named exactly like the family
	for _, a := range meta.Applications {
		byID[a.ID] = a
		idByName[strings.ToLower(a.Name)] = a.ID
		f := appFamily(a.Name)
		familyIDs[f] = append(familyIDs[f], a.ID)
		if strings.EqualFold(a.Name, f) {
			rootID[f] = a.ID
		}
	}

	reSetApp := regexp.MustCompile(`(?i)^(\s*set\s+application\s+)(.+?)\s*$`)
	reEditLine := regexp.MustCompile(`(?i)^\s*edit\b`)
	reNextLine := regexp.MustCompile(`(?i)^\s*next\b`)

	// PASS 1 — clean each "set application" line.
	cleaned := map[int][]int{}
	dropped := map[int]bool{} // lines removed because their whole entry is bogus
	for idx, line := range commands {
		m := reSetApp.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ids := make([]int, 0, 16)
		seen := map[int]bool{}
		add := func(id int) {
			if _, ok := byID[id]; ok && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		for _, tok := range strings.Fields(m[2]) {
			tok = strings.Trim(tok, `"'`)
			if n, err := strconv.Atoi(tok); err == nil {
				add(n)
			} else if id, ok := idByName[strings.ToLower(tok)]; ok {
				add(id) // the model wrote a NAME — resolve it rather than emit invalid CLI
			}
		}
		// Family completion for every family whose root signature is present.
		for _, id := range append([]int(nil), ids...) {
			f := appFamily(byID[id].Name)
			if root, ok := rootID[f]; ok && seen[root] {
				for _, fid := range familyIDs[f] {
					add(fid)
				}
			}
		}

		if len(ids) > 0 {
			cleaned[idx] = ids
			if len(ids) != len(strings.Fields(m[2])) {
				log.Printf("[ai] set application: %d token(s) → %d real signature id(s) (names resolved, unknown ids dropped, family completed)",
					len(strings.Fields(m[2])), len(ids))
			}
			continue
		}

		// Not one real id survived (the model invented every one — this device has no such app).
		// The whole entry must go: an entry left carrying "set action block" with no application and
		// no category matches the FortiOS default (category 0 = EVERY app), so a request to block one
		// app would black-hole all traffic. Delete edit…next around this line.
		start, end := idx, idx
		for start > 0 && !reEditLine.MatchString(commands[start]) {
			start--
		}
		for end < len(commands)-1 && !reNextLine.MatchString(commands[end]) {
			end++
		}
		if !reEditLine.MatchString(commands[start]) || !reNextLine.MatchString(commands[end]) {
			dropped[idx] = true // malformed — at least drop the dangerous line itself
			continue
		}
		for i := start; i <= end; i++ {
			dropped[i] = true
		}
		log.Printf("[ai] dropped an application-list entry whose signature ids are all unknown to this device "+
			"(the model invented them); lines %d-%d", start, end)
	}

	// PASS 2 — emit, substituting the cleaned id lists and skipping dropped entries.
	out := make([]string, 0, len(commands))
	for idx, line := range commands {
		if dropped[idx] {
			continue
		}
		if ids, ok := cleaned[idx]; ok {
			m := reSetApp.FindStringSubmatch(line)
			parts := make([]string, 0, len(ids))
			for _, id := range ids {
				parts = append(parts, strconv.Itoa(id))
			}
			out = append(out, m[1]+strings.Join(parts, " "))
			continue
		}
		out = append(out, line)
	}
	return out
}

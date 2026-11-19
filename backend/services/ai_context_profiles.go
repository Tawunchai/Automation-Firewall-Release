// Package services - AI Assistant: the Security Profiles half of the live device context.
package services

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// What the assistant is told about the profiles this firewall already has: App Control sensors and
// how much of each app family they really cover, Web Filter and DNS Filter profiles and what each
// one actually blocks, and which urlfilter/content table ids are taken.
//
// Moved out of ai_context.go unchanged when that file crossed the 48 KB byte ceiling. The cut is
// along the seam the file already had: everything above it reads OBJECTS (addresses, services,
// users, schedules, routes, VIPs), everything here reads PROFILES and has to judge coverage rather
// than list rows — which is why these functions carry the matching and alias tables and the ones
// above do not.

// appFamily is the product a signature belongs to — the part of its name before the first "." or
// "_" ("YouTube_HD.Streaming" → "YouTube"). Coverage is judged per family: blocking "Facebook" but
// not "Facebook_Chat" leaves the app reachable, which is exactly the mistake to surface.
func appFamily(name string) string {
	if i := strings.IndexAny(name, "._"); i > 0 {
		return name[:i]
	}
	return name
}

// existingAppListsContext lists every application sensor on the device together with WHAT IT
// ACTUALLY BLOCKS — per-family signature coverage ("Facebook 1/44") and blocked categories.
//
// Names and comments lie: this device has "Block-Social-App" commented "Block Facebook, YouTube,
// Facebook Messenger Apps" that in reality blocks 3 signatures out of 54. Reuse must therefore be
// decided on real coverage, so the model is given the numbers rather than the label.
func existingAppListsContext(fc *FortiClient, meta AppControlMetadata) (string, map[string]appListCoverage) {
	coverage := map[string]appListCoverage{}
	profiles, err := fc.GetSecurityProfiles("application-control")
	if err != nil || len(profiles) == 0 {
		return "", coverage
	}

	catName := make(map[int]string, len(meta.Categories))
	for _, c := range meta.Categories {
		catName[c.ID] = c.Name
	}
	// Signature id → family, and the total number of signatures in each family.
	familyOf := make(map[int]string, len(meta.Applications))
	familyTotal := map[string]int{}
	for _, a := range meta.Applications {
		f := appFamily(a.Name)
		familyOf[a.ID] = f
		familyTotal[f]++
	}

	// Fetch every sensor's real contents in parallel — each GetAppControlProfile is its own
	// round trip, and doing them one after another made this a slow leg of the live context.
	// Results are indexed, so the rendered text stays byte-identical regardless of finish order
	// (the system prompt is cached — a reordered prompt would miss the cache every time).
	named := make([]FGSecurityProfile, 0, 12)
	for _, p := range profiles {
		if p.Name != "" {
			named = append(named, p)
			if len(named) >= 12 {
				break
			}
		}
	}
	forms := make([]*AppControlProfileForm, len(named))
	var fetchWG sync.WaitGroup
	for i, p := range named {
		fetchWG.Add(1)
		go func(i int, name string) {
			defer fetchWG.Done()
			if form, e := fc.GetAppControlProfile(name); e == nil {
				forms[i] = &form
			}
		}(i, p.Name)
	}
	fetchWG.Wait()

	var b strings.Builder
	b.WriteString("\nEXISTING APPLICATION CONTROL LISTS — what each one ACTUALLY blocks. Judge REUSE on THESE NUMBERS,\n" +
		"never on the profile's name or comment (a sensor called \"Block-Social-App\" may cover almost nothing):\n")

	for i, p := range named {
		if forms[i] == nil {
			continue
		}
		form := *forms[i]

		// Blocked signatures, grouped by family → "Facebook 1/44".
		blockedByFamily := map[string]int{}
		blockedApps := map[int]bool{}
		for _, o := range form.Overrides {
			if !strings.EqualFold(o.Type, "application") || !isBlockingAction(o.Action) {
				continue
			}
			for _, a := range o.Applications {
				blockedApps[a.ID] = true
				if f, ok := familyOf[a.ID]; ok {
					blockedByFamily[f]++
				}
			}
		}
		fams := make([]string, 0, len(blockedByFamily))
		for f := range blockedByFamily {
			fams = append(fams, f)
		}
		sort.Strings(fams)
		cover := make([]string, 0, len(fams))
		for _, f := range fams {
			cover = append(cover, fmt.Sprintf("%s %d/%d", f, blockedByFamily[f], familyTotal[f]))
		}

		// Blocked categories (grid + filter overrides).
		blockedCats := map[int]bool{}
		for _, c := range form.Categories {
			if isBlockingAction(c.Action) {
				blockedCats[c.Category] = true
			}
		}
		for _, o := range form.Overrides {
			if strings.EqualFold(o.Type, "filter") && isBlockingAction(o.Action) {
				for _, c := range o.Categories {
					blockedCats[c] = true
				}
			}
		}
		catNames := make([]string, 0, len(blockedCats))
		for id := range blockedCats {
			catNames = append(catNames, defaultStr(catName[id], fmt.Sprintf("#%d", id)))
		}
		sort.Strings(catNames)

		appPart := "none"
		if len(cover) > 0 {
			appPart = strings.Join(cover, ", ")
		}
		catPart := "none"
		if len(catNames) > 0 {
			catPart = strings.Join(catNames, ", ")
		}
		b.WriteString(fmt.Sprintf("  - %s: blocked apps (blocked/total in family): %s | blocked categories: %s\n",
			p.Name, appPart, catPart))
		coverage[p.Name] = appListCoverage{apps: blockedApps, cats: blockedCats}
	}
	return b.String(), coverage
}

// isBlockingAction — only block/quarantine actually stop traffic; monitor/allow do not, so they
// must never count towards "this profile already covers it".
func isBlockingAction(a string) bool {
	s := strings.ToLower(strings.TrimSpace(a))
	return s == "block" || s == "quarantine" || s == "reset" || s == "deny"
}

// webfilterTableIDContext tells the model which webfilter/urlfilter and webfilter/content table ids
// are already taken. These tables are keyed by a number the author picks, so CLI that says `edit 1`
// on a live id OVERWRITES that table — name, entries and all. The chat's "Apply" button deploys the
// model's CLI verbatim, so a colliding id would silently destroy an existing block list.
func webfilterTableIDContext(fc *FortiClient) (string, map[string][]int) {
	urlIDs := fc.GetWebfilterTableIDs("urlfilter")
	contentIDs := fc.GetWebfilterTableIDs("content")
	// The DNS Filter's Static Domain Filter is the same kind of numerically keyed table and was
	// missing from this section, which is how the prompt's DNS example came to pair `edit 0` with
	// `set domain-filter-table 0`: with no list of real ids there was nothing for the model to name.
	dnsIDs := fc.GetDNSDomainFilterTableIDs()
	inUse := map[string][]int{"urlfilter": urlIDs, "content": contentIDs, "dns-domain-filter": dnsIDs}
	if len(urlIDs) == 0 && len(contentIDs) == 0 && len(dnsIDs) == 0 {
		return "", inUse
	}
	fmtIDs := func(ids []int) string {
		if len(ids) == 0 {
			return "none"
		}
		parts := make([]string, 0, len(ids))
		for _, id := range ids {
			parts = append(parts, strconv.Itoa(id))
		}
		return strings.Join(parts, ", ")
	}
	nextFree := func(ids []int) int {
		taken := map[int]bool{}
		for _, id := range ids {
			taken[id] = true
		}
		for i := 1; ; i++ {
			if !taken[i] {
				return i
			}
		}
	}
	return fmt.Sprintf(
		"\nFILTER TABLE IDS ALREADY IN USE (a table id is a MKEY — reusing one OVERWRITES that table):\n"+
			"  webfilter urlfilter:      %s  → use id %d for a NEW url filter table\n"+
			"  webfilter content:        %s  → use id %d for a NEW content filter table\n"+
			"  dnsfilter domain-filter:  %s  → use id %d for a NEW domain filter table\n"+
			"The profile's \"set urlfilter-table <id>\" / \"set bword-table <id>\" / \"set domain-filter-table <id>\"\n"+
			"MUST point at the id you just created. Write that id in BOTH places — never \"edit 0\" for the table\n"+
			"(FortiOS then picks the id itself and you cannot reference it).\n",
		fmtIDs(urlIDs), nextFree(urlIDs), fmtIDs(contentIDs), nextFree(contentIDs),
		fmtIDs(dnsIDs), nextFree(dnsIDs)), inUse
}

// existingWebFilterContext lists each web-filter profile's REAL blocking content — the Static URL
// Filter domains it blocks and how many FortiGuard categories it blocks — for the same
// reuse-on-facts reason as the application sensors above.
func existingWebFilterContext(fc *FortiClient) (string, map[string]map[string]bool) {
	coverage := map[string]map[string]bool{}
	profiles, err := fc.GetSecurityProfiles("webfilter")
	if err != nil || len(profiles) == 0 {
		return "", coverage
	}
	// Parallel fetch — GetWebFilterProfile costs THREE round trips each (the profile, its URL
	// filter table, and its content filter table), so serialising a handful of profiles was the
	// single slowest leg of the live context. Indexed results keep the rendered text
	// byte-identical regardless of finish order (the prompt is cached; reordering = cache miss).
	named := make([]FGSecurityProfile, 0, 12)
	for _, p := range profiles {
		if p.Name != "" {
			named = append(named, p)
			if len(named) >= 12 {
				break
			}
		}
	}
	forms := make([]*WebFilterProfileForm, len(named))
	var fetchWG sync.WaitGroup
	for i, p := range named {
		fetchWG.Add(1)
		go func(i int, name string) {
			defer fetchWG.Done()
			if form, e := fc.GetWebFilterProfile(name); e == nil {
				forms[i] = &form
			}
		}(i, p.Name)
	}
	fetchWG.Wait()

	var b strings.Builder
	b.WriteString("\nEXISTING WEB FILTER PROFILES — what each one ACTUALLY blocks (judge reuse on this, not the name):\n")
	for i, p := range named {
		if forms[i] == nil {
			continue
		}
		form := *forms[i]
		blocked := map[string]bool{}
		urls := make([]string, 0, 12)
		for _, u := range form.URLFilterEntries {
			if !strings.EqualFold(u.Action, "block") || u.Status == "disable" {
				continue
			}
			blocked[strings.ToLower(strings.TrimSpace(u.URL))] = true
			if len(urls) < 12 {
				urls = append(urls, u.URL)
			}
		}
		if len(blocked) > len(urls) {
			urls = append(urls, "…")
		}
		blockedCats := 0
		for _, c := range form.Categories {
			if isBlockingAction(c.Action) {
				blockedCats++
			}
		}
		urlPart := "none"
		if len(urls) > 0 {
			urlPart = strings.Join(urls, ", ")
		}
		b.WriteString(fmt.Sprintf("  - %s: blocked URLs: %s | blocked FortiGuard categories: %d\n",
			p.Name, urlPart, blockedCats))
		coverage[p.Name] = blocked
	}
	return b.String(), coverage
}

// existingDNSFilterContext lists each DNS-filter profile's REAL blocking content — the Static
// Domain Filter domains it blocks and how many FortiGuard categories it blocks — for the same
// reuse-on-facts reason as the web filters and application sensors above. A DNS profile's name
// says nothing about which domains it actually covers.
func existingDNSFilterContext(fc *FortiClient) (string, map[string]map[string]bool) {
	coverage := map[string]map[string]bool{}
	profiles, err := fc.GetSecurityProfiles("dnsfilter")
	if err != nil || len(profiles) == 0 {
		return "", coverage
	}
	// Parallel fetch — GetDNSFilterProfile costs TWO round trips each (the profile and its Static
	// Domain Filter table). Indexed results keep the rendered text byte-identical regardless of
	// finish order (the prompt is cached; reordering = cache miss).
	named := make([]FGSecurityProfile, 0, 12)
	for _, p := range profiles {
		if p.Name != "" {
			named = append(named, p)
			if len(named) >= 12 {
				break
			}
		}
	}
	forms := make([]*DNSFilterProfileForm, len(named))
	var wg sync.WaitGroup
	for i, p := range named {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			if form, e := fc.GetDNSFilterProfile(name); e == nil {
				forms[i] = &form
			}
		}(i, p.Name)
	}
	wg.Wait()

	var b strings.Builder
	b.WriteString("\nEXISTING DNS FILTER PROFILES — what each one ACTUALLY blocks (judge reuse on this, not the name):\n")
	for i, p := range named {
		if forms[i] == nil {
			continue
		}
		form := *forms[i]
		blocked := map[string]bool{}
		domains := make([]string, 0, 12)
		for _, d := range form.DomainFilterEntries {
			if !strings.EqualFold(d.Action, "block") || strings.EqualFold(d.Status, "disable") {
				continue
			}
			blocked[strings.ToLower(strings.TrimSpace(d.Domain))] = true
			if len(domains) < 12 {
				domains = append(domains, d.Domain)
			}
		}
		if len(blocked) > len(domains) {
			domains = append(domains, "…")
		}
		blockedCats := 0
		for _, c := range form.Categories {
			// Only "block" is a real block here — the DNS filter has no warning/authenticate, and
			// "monitor" logs without stopping anything.
			if strings.EqualFold(c.Action, "block") {
				blockedCats++
			}
		}
		domainPart := "none"
		if len(domains) > 0 {
			domainPart = strings.Join(domains, ", ")
		}
		b.WriteString(fmt.Sprintf("  - %s: blocked domains: %s | blocked FortiGuard categories: %d | category filter: %s\n",
			p.Name, domainPart, blockedCats, map[bool]string{true: "on", false: "off"}[form.FortiGuardCategoryFilter]))
		coverage[p.Name] = blocked
	}
	return b.String(), coverage
}

// appSignatureStopWords are prompt words that would match half the signature database and drown
// out the real brand names ("block the video app", "web traffic", …).
// ⚠️ Every ACTION word belongs here. A real signature is named "PC.Monitor" and another
// "Campaign.Monitor", so leaving "monitor" out let the phrase "monitor the other categories" pull
// those two into the context — and the model then dutifully blocked them (observed live).
var appSignatureStopWords = map[string]bool{
	"the": true, "and": true, "for": true, "all": true, "any": true, "app": true, "apps": true,
	"application": true, "applications": true, "block": true, "allow": true, "deny": true,
	"monitor": true, "quarantine": true, "pass": true, "log": true, "logging": true,
	"enable": true, "disable": true, "action": true, "actions": true, "set": true,
	"control": true, "list": true, "profile": true, "sensor": true, "policy": true, "user": true,
	"users": true, "traffic": true, "internet": true, "web": true, "site": true, "sites": true,
	"website": true, "websites": true, "create": true, "new": true, "with": true, "from": true,
	"only": true, "not": true, "use": true, "using": true, "name": true, "named": true,
	"category": true, "categories": true, "filter": true, "network": true, "test": true,
	"signature": true, "signatures": true, "every": true, "other": true, "others": true,
	"rest": true, "group": true, "groups": true, "port": true, "ports": true, "service": true,
}

// appControlContext renders the application category taxonomy plus the application signatures the
// user's request actually refers to. The device ships ~2,400 signatures — far too many to inline —
// so signatures are selected by matching the prompt's words against signature names ("block
// facebook and youtube" → every Facebook* and YouTube* id). This is what lets the AI emit a real
// "set application <ids>" override instead of inventing ids. When the prompt names no recognisable
// app, the most popular signatures are listed instead so the AI still has genuine ids to work with.
func appControlContext(meta AppControlMetadata, prompt string) string {
	if len(meta.Categories) == 0 {
		return ""
	}
	var b strings.Builder

	cats := make([]string, 0, len(meta.Categories))
	catName := make(map[int]string, len(meta.Categories))
	for _, c := range meta.Categories {
		cats = append(cats, fmt.Sprintf("%d=%s", c.ID, c.Name))
		catName[c.ID] = c.Name
	}
	fmt.Fprintf(&b, "\nAPPLICATION CATEGORIES (id=name — the category grid must cover every one of these):\n  %s\n",
		strings.Join(cats, ", "))

	if len(meta.Applications) == 0 {
		return b.String()
	}

	matched, unmatchedWords := matchAppSignatures(meta.Applications, prompt)
	header := "APPLICATION SIGNATURES — CANDIDATES matched by keyword against this request. Quote these EXACT ids in\n" +
		"\"set application\" (never invent an id), but SELECT only the ones that really belong to the app(s) the user\n" +
		"named — a keyword match can drag in an unrelated product, so ignore any entry that is not that app:\n"
	switch {
	case len(matched) > 0:
		// Keyword hits — the normal path.
	case len(unmatchedWords) > 0:
		// The request NAMED something this device's database does not have. Say so bluntly: the
		// model's instinct is to invent plausible ids, which would build a sensor that matches
		// nothing at all (observed live — this FGT80E's database has zero TikTok signatures).
		matched = topAppSignatures(meta.Applications, 25)
		header = fmt.Sprintf(
			"⚠️ NO APPLICATION SIGNATURE ON THIS DEVICE MATCHES: %s\n"+
				"This device's application database (%d signatures) simply does not contain that app. You MUST NOT invent\n"+
				"ids and MUST NOT emit an application override for it. Tell the user plainly that Application Control\n"+
				"cannot see this app on this device, and offer the WEB FILTER Static URL Filter (block its domains) as the\n"+
				"way to block it. The most popular signatures are listed only as reference:\n",
			strings.Join(unmatchedWords, ", "), len(meta.Applications))
	default:
		// The request named NO application at all — "add a policy from LAN to WAN", a greeting, or
		// any prompt whose words are not app names.
		//
		// This case used to fall into the warning above with an EMPTY list of unmatched words, so
		// the model was told that nothing on the device matches — followed by no words at all —
		// and instructed to refuse. It is the difference between "you asked for X and this device
		// has no X" and "you did not ask about applications". Before the alias table in
		// matchAppSignatures, EVERY Thai prompt landed here, which is how a firewall console came
		// to refuse ordinary work in its own main language.
		matched = topAppSignatures(meta.Applications, 25)
		header = fmt.Sprintf(
			"APPLICATION SIGNATURES — the request names no particular application, so these are the most popular\n"+
				"signatures on this device, for REFERENCE only. Quote an id from this list (never invent one) if the\n"+
				"answer needs one, and do not add an application override the user did not ask for. The device knows\n"+
				"%d signatures in total; ask the user which app they mean if that matters:\n",
			len(meta.Applications))
	}
	fmt.Fprintf(&b, "\n%s", header)
	for _, a := range matched {
		b.WriteString(fmt.Sprintf("  - %d = %s [%s, risk %d, popularity %d]\n",
			a.ID, a.Name, catName[a.Category], a.Risk, a.Popularity))
	}
	b.WriteString(fmt.Sprintf("(%d signatures shown of %d on the device)\n", len(matched), len(meta.Applications)))
	return b.String()
}

// stripQuoted removes every "…" / '…' / “…” span from a prompt. Quoted text names an object the
// user is creating, so it must not be treated as an application to match.
func stripQuoted(s string) string {
	var b strings.Builder
	inQuote := rune(0)
	for _, r := range s {
		switch {
		case inQuote != 0:
			if r == inQuote || (inQuote == '“' && r == '”') {
				inQuote = 0
			}
		case r == '"' || r == '\'' || r == '“':
			inQuote = r
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// matchAppSignatures selects the signatures whose name contains a meaningful word from the prompt
// (case-insensitive, separators stripped so "YouTube_Video.Play" matches "youtube"). Results are
// ordered most-popular-first and capped, so even a broad word like "google" stays bounded.
// It also returns the candidate words that matched nothing, so the caller can tell the model
// outright that the device has no such application (rather than let it invent one).
func matchAppSignatures(apps []AppSignatureMeta, prompt string) ([]AppSignatureMeta, []string) {
	const maxSignatures = 120

	fold := func(s string) string {
		var f strings.Builder
		for _, r := range strings.ToLower(s) {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				f.WriteRune(r)
			}
		}
		return f.String()
	}

	// Prompt → candidate words (letters/digits only, ≥3 chars, not a stop word). QUOTED text is
	// stripped first: a quoted span is an OBJECT NAME the user is choosing ("AI-AC-Social"), not an
	// application they want matched — without this, naming a profile "…-Social" pulled Socialtext and
	// Sproutsocial into the candidate list, and the model then blocked them (observed live).
	seen := map[string]bool{}
	words := make([]string, 0, 8)
	for _, w := range strings.FieldsFunc(strings.ToLower(stripQuoted(prompt)), func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
	}) {
		if len(w) < 3 || appSignatureStopWords[w] || seen[w] {
			continue
		}
		seen[w] = true
		words = append(words, w)
	}
	// ── Thai and Chinese prompts used to produce ZERO candidate words ────────────
	//
	// The loop above keeps [a-z0-9] only, so "บล็อกเฟสบุ๊คตอนกลางคืน" — an ordinary request in this
	// product's own main language — yielded nothing, and the caller then told the model that the
	// device has no matching signature at all. The AI dutifully refused a job the firewall can do,
	// in Thai, having been handed an empty list of "words that matched nothing".
	//
	// Signature NAMES are Latin (Facebook_Video.Play), so the fix is at the input end: map the
	// spellings people actually type to the Latin keyword the database uses.
	for _, w := range aliasCandidates(prompt) {
		if seen[w] {
			continue
		}
		seen[w] = true
		words = append(words, w)
	}
	if len(words) == 0 {
		return nil, nil
	}

	out := make([]AppSignatureMeta, 0, maxSignatures)
	hit := map[string]bool{}
	for _, a := range apps {
		name := fold(a.Name)
		matchedThis := false
		for _, w := range words {
			if strings.Contains(name, w) {
				hit[w] = true
				matchedThis = true
			}
		}
		if matchedThis {
			out = append(out, a)
		}
	}
	unmatched := make([]string, 0, len(words))
	for _, w := range words {
		if !hit[w] {
			unmatched = append(unmatched, w)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Popularity > out[j].Popularity })
	if len(out) > maxSignatures {
		out = out[:maxSignatures]
	}
	return out, unmatched
}

// topAppSignatures returns the n most popular signatures — the fallback when the prompt names no
// recognisable application, so the AI always has real ids rather than a temptation to guess.
func topAppSignatures(apps []AppSignatureMeta, n int) []AppSignatureMeta {
	out := make([]AppSignatureMeta, len(apps))
	copy(out, apps)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Popularity > out[j].Popularity })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// webFilterContext lists the FortiGuard category ids a category-based web filter needs, and states
// the device's licence status — an unlicensed device rates nothing, so category filtering there is
// inert and the AI must fall back to the Static URL Filter.
func webFilterContext(meta WebFilterMetadata) string {
	if len(meta.Categories) == 0 {
		return ""
	}
	var b strings.Builder
	if meta.WebFilterLicensed {
		b.WriteString("\nWEB FILTER: FortiGuard web-filtering IS licensed — category filtering works on this device.\n")
	} else {
		b.WriteString("\nWEB FILTER: FortiGuard web-filtering is NOT licensed on this device — FortiGuard CATEGORY " +
			"filtering rates nothing and blocks NOTHING here. Use the Static URL Filter for named sites.\n")
	}
	items := make([]string, 0, len(meta.Categories))
	for _, c := range meta.Categories {
		items = append(items, fmt.Sprintf("%d=%s", c.ID, c.Name))
	}
	fmt.Fprintf(&b, "FORTIGUARD CATEGORIES (id=name, for \"config ftgd-wf/config filters\"):\n  %s\n",
		strings.Join(items, ", "))
	return b.String()
}

// appNameAliases maps the spellings people type to the Latin keyword FortiGuard signature names
// use. Substring matching, because Thai is written without spaces between words — "เฟสบุ๊ค" arrives
// inside a longer run of characters, not as a token.
//
// Transliteration is not standardised, so the common variants are all listed: a user writing
// "ยูทูป" rather than "ยูทูบ" is not making a mistake worth failing over. The list covers what this
// console is actually asked to block; it is not meant to be exhaustive, and an app that is missing
// degrades to the neutral reference list rather than to a refusal (see the caller).
//
// Generic words are included deliberately (เกม → game, วิดีโอ → video): they match broad families of
// signatures, and a broad candidate list is bounded and sorted by popularity further down, whereas
// no candidates at all is what caused the bug.
var appNameAliases = map[string]string{
	// Thai — social
	"เฟสบุ๊ค": "facebook", "เฟสบุ๊ก": "facebook", "เฟซบุ๊ค": "facebook", "เฟซบุ๊ก": "facebook", "เฟส": "facebook",
	"ไลน์": "line", "อินสตาแกรม": "instagram", "อินสตาร์แกรม": "instagram", "ไอจี": "instagram",
	"ทวิตเตอร์": "twitter", "ทวีตเตอร์": "twitter", "เอ็กซ์": "twitter",
	"ติ๊กต็อก": "tiktok", "ติ๊กตอก": "tiktok", "ติ๊กต่อก": "tiktok", "ทิกทอก": "tiktok",
	"วีแชท": "wechat", "วอทส์แอป": "whatsapp", "วอทแอพ": "whatsapp", "เทเลแกรม": "telegram", "ดิสคอร์ด": "discord",
	// Thai — video, music, games
	"ยูทูบ": "youtube", "ยูทูป": "youtube", "ยูทิวบ์": "youtube",
	"เน็ตฟลิกซ์": "netflix", "เนตฟลิก": "netflix", "ทวิตช์": "twitch", "สปอติฟาย": "spotify",
	"สตีม": "steam", "โรบล็อก": "roblox", "ไมน์คราฟต์": "minecraft", "วาโลแรนต์": "valorant",
	// Thai — work, shopping, downloads
	"ซูม": "zoom", "สไกป์": "skype", "ทีมส์": "teams", "กูเกิล": "google", "กูเกิ้ล": "google",
	"ช้อปปี้": "shopee", "ลาซาด้า": "lazada", "ทอร์เรนต์": "torrent", "บิททอร์เรนต์": "bittorrent",
	// Thai — generic words that name whole families of signatures
	"เกม": "game", "วิดีโอ": "video", "วีดีโอ": "video", "สตรีม": "stream", "โซเชียล": "social",
	"ดาวน์โหลด": "download", "อีเมล": "mail", "แชท": "chat", "ประชุม": "meeting",
	// Chinese
	"脸书": "facebook", "微信": "wechat", "抖音": "tiktok", "优酷": "youku", "哔哩哔哩": "bilibili",
	"百度": "baidu", "淘宝": "taobao", "腾讯": "tencent", "微博": "weibo", "游戏": "game", "视频": "video",
}

// aliasCandidates returns the Latin keywords implied by a prompt's non-Latin text.
//
// SORTED, because this list ends up inside the cached half of the system prompt: map iteration
// order in Go is deliberately random, so returning them unsorted would make the same question
// produce a different prompt each time and the prompt cache would never hit.
func aliasCandidates(prompt string) []string {
	p := strings.ToLower(stripQuoted(prompt))
	seen := map[string]bool{}
	out := make([]string, 0, 4)
	for alias, word := range appNameAliases {
		if seen[word] || !strings.Contains(p, alias) {
			continue
		}
		seen[word] = true
		out = append(out, word)
	}
	sort.Strings(out)
	return out
}

package services

import (
	"strings"
	"testing"
)

// The LAST gate between the model and a live firewall.
//
// These four functions can each DELETE part of the model's answer — a whole profile block, a whole
// `edit … next` entry, individual signature ids — and the user never sees what was taken out. That
// makes them the most consequential untested code in the AI path: an over-eager sanitizer silently
// ships a proposal that does less than the chat says it does, and an under-eager one ships the
// thing it exists to catch. Both failures look like success.
//
// Written as goldens — the exact lines in, the exact lines out — because the interesting property
// is not "did it drop something" but "did it leave everything ELSE exactly as it was". A sanitizer
// that mangles the policy while dropping a redundant profile is how a confirmation dialog comes to
// describe config that is not what gets applied.

func cliLines(s string) []string {
	return strings.Split(strings.Trim(s, "\n"), "\n")
}

func joinCLI(lines []string) string { return strings.Join(lines, "\n") }

// ── splitTopLevelCLIBlocks ───────────────────────────────────────────────────

// The block splitter underneath everything else. `config entries` inside a profile must not close
// its parent — get that wrong and a sanitizer deletes from the middle of one block to the middle of
// the next.
func TestSplitTopLevelCLIBlocksBalancesNestedConfig(t *testing.T) {
	cmds := cliLines(`
config webfilter urlfilter
    edit 3
        set name "Block-Social"
        config entries
            edit 1
                set url "*.facebook.com"
                set action block
            next
        end
    next
end
config firewall policy
    edit 0
        set name "P1"
    next
end`)

	blocks := splitTopLevelCLIBlocks(cmds)
	if len(blocks) != 2 {
		t.Fatalf("got %d top-level blocks, want 2 — a nested `config entries … end` closed its parent", len(blocks))
	}
	if !strings.Contains(cmds[blocks[0].start], "webfilter urlfilter") {
		t.Errorf("first block starts at %q", cmds[blocks[0].start])
	}
	if !strings.Contains(cmds[blocks[1].start], "firewall policy") {
		t.Errorf("second block starts at %q", cmds[blocks[1].start])
	}
	// [start,end) covers the block and nothing after it.
	if got := joinCLI(cmds[blocks[1].start:blocks[1].end]); !strings.HasSuffix(got, "end") ||
		strings.Contains(got, "urlfilter") {
		t.Errorf("the second block's range is wrong:\n%s", got)
	}
}

// An UNCLOSED block (a truncated answer) must not make the splitter run off the end or swallow
// the lines before it.
func TestSplitTopLevelCLIBlocksSurvivesAnUnclosedBlock(t *testing.T) {
	cmds := cliLines(`
config firewall address
    edit "LAN"
        set subnet 10.0.0.0 255.255.255.0
    next`)
	blocks := splitTopLevelCLIBlocks(cmds)
	if len(blocks) != 1 {
		t.Fatalf("got %d blocks, want 1", len(blocks))
	}
	if blocks[0].end != len(cmds) {
		t.Errorf("an unclosed block should run to the end of the input: end=%d, len=%d", blocks[0].end, len(cmds))
	}
}

// ── dropRedundantWebFilters ──────────────────────────────────────────────────

const webFilterProposal = `config webfilter urlfilter
    edit 3
        set name "WF-Table"
        config entries
            edit 1
                set url "*.facebook.com"
                set action block
            next
        end
    next
end
config webfilter profile
    edit "WF-Social"
        set comment "block social"
        config web
            set urlfilter-table 3
        end
    next
end
config firewall policy
    edit 0
        set name "Allow-LAN-Out"
        set webfilter-profile "WF-Social"
    next
end`

func TestDropRedundantWebFiltersKeepsANewProfile(t *testing.T) {
	// "WF-Social" is not on the device at all: nothing may be dropped, however well another
	// profile covers the same URLs.
	facts := &deviceFacts{wfCoverage: map[string]map[string]bool{
		"Some-Other-Profile": {"*.facebook.com": true},
	}}
	in := cliLines(webFilterProposal)
	out := dropRedundantWebFilters(in, facts)
	if joinCLI(out) != joinCLI(in) {
		t.Errorf("a profile the device does not have must be left alone:\n%s", joinCLI(out))
	}
}

func TestDropRedundantWebFiltersKeepsAProfileThatAddsAURL(t *testing.T) {
	// The profile exists and blocks ONE of the two proposed URLs. It is an improvement, so the
	// whole answer stays — this is the branch that decides "partly covered" is not "covered".
	proposal := strings.Replace(webFilterProposal,
		`                set url "*.facebook.com"`,
		`                set url "*.facebook.com"
                set action block
            next
            edit 2
                set url "*.fbcdn.net"`, 1)
	facts := &deviceFacts{wfCoverage: map[string]map[string]bool{
		"WF-Social": {"*.facebook.com": true},
	}}
	in := cliLines(proposal)
	out := dropRedundantWebFilters(in, facts)
	if len(out) != len(in) {
		t.Errorf("a profile that adds *.fbcdn.net must not be dropped:\n%s", joinCLI(out))
	}
}

// THE GOLDEN. Fully redundant: the profile exists and already blocks every URL proposed. The
// profile block and the urlfilter table that fed it go; the POLICY — which is the part the user
// actually asked for — stays, byte for byte.
func TestDropRedundantWebFiltersDropsOnlyTheProfileAndItsTable(t *testing.T) {
	facts := &deviceFacts{wfCoverage: map[string]map[string]bool{
		"WF-Social": {"*.facebook.com": true},
	}}
	out := dropRedundantWebFilters(cliLines(webFilterProposal), facts)

	want := `config firewall policy
    edit 0
        set name "Allow-LAN-Out"
        set webfilter-profile "WF-Social"
    next
end`
	if joinCLI(out) != want {
		t.Errorf("golden mismatch.\n--- got ---\n%s\n--- want ---\n%s", joinCLI(out), want)
	}
}

// No coverage information at all (the device could not be read) means no sanitising: an unreadable
// device is not an empty one, and dropping a profile because we could not check it would be the
// worst possible reading of "best effort".
func TestDropRedundantWebFiltersDoesNothingWithoutCoverage(t *testing.T) {
	in := cliLines(webFilterProposal)
	if got := dropRedundantWebFilters(in, &deviceFacts{}); joinCLI(got) != joinCLI(in) {
		t.Error("with no wfCoverage nothing may be dropped")
	}
}

// ── dropRedundantAppLists ────────────────────────────────────────────────────

const appListProposal = `config application list
    edit "AppCtrl-FB"
        set comment "block facebook"
        config entries
            edit 1
                set application 15832 16000
                set action block
            next
        end
    next
end
config firewall policy
    edit 0
        set name "Allow-LAN-Out"
        set application-list "AppCtrl-FB"
    next
end`

func TestDropRedundantAppListsKeepsASensorThatAddsASignature(t *testing.T) {
	facts := &deviceFacts{appCoverage: map[string]appListCoverage{
		"AppCtrl-FB": {apps: map[int]bool{15832: true}, cats: map[int]bool{}},
	}}
	in := cliLines(appListProposal)
	if got := dropRedundantAppLists(in, facts); len(got) != len(in) {
		t.Errorf("16000 is not blocked yet, so the sensor must stay:\n%s", joinCLI(got))
	}
}

func TestDropRedundantAppListsDropsOnlyTheSensorBlock(t *testing.T) {
	facts := &deviceFacts{appCoverage: map[string]appListCoverage{
		"AppCtrl-FB": {apps: map[int]bool{15832: true, 16000: true}, cats: map[int]bool{}},
	}}
	out := dropRedundantAppLists(cliLines(appListProposal), facts)
	want := `config firewall policy
    edit 0
        set name "Allow-LAN-Out"
        set application-list "AppCtrl-FB"
    next
end`
	if joinCLI(out) != want {
		t.Errorf("golden mismatch.\n--- got ---\n%s\n--- want ---\n%s", joinCLI(out), want)
	}
}

// A category entry only counts when its action BLOCKS. A monitor entry adds no coverage, so a
// sensor made only of monitor entries is redundant against a sensor that blocks them.
func TestDropRedundantAppListsIgnoresMonitorOnlyCategories(t *testing.T) {
	proposal := `config application list
    edit "AppCtrl-Cats"
        config entries
            edit 1
                set category 23
                set action monitor
            next
        end
    next
end`
	facts := &deviceFacts{appCoverage: map[string]appListCoverage{
		"AppCtrl-Cats": {apps: map[int]bool{}, cats: map[int]bool{}},
	}}
	out := dropRedundantAppLists(cliLines(proposal), facts)
	if len(out) != 0 {
		t.Errorf("a monitor-only entry blocks nothing new, so the block is redundant:\n%s", joinCLI(out))
	}
}

// ── sanitizeAppSignatureCommands ─────────────────────────────────────────────

func appMetaFixture() AppControlMetadata {
	return AppControlMetadata{Applications: []AppSignatureMeta{
		{ID: 15832, Name: "Facebook"},
		{ID: 15833, Name: "Facebook_Chat"},
		{ID: 15834, Name: "Facebook.App"},
		{ID: 20001, Name: "YouTube"},
		{ID: 30001, Name: "Socialtext"},
	}}
}

// Three repairs in one line: a NAME becomes an id, an invented id disappears, and naming the family
// ROOT pulls in the rest of the family (a partial block is a failed block).
func TestSanitizeAppSignaturesResolvesNamesAndCompletesTheFamily(t *testing.T) {
	in := cliLines(`config application list
    edit "AppCtrl"
        config entries
            edit 1
                set application 15832 YouTube 999999
                set action block
            next
        end
    next
end`)
	out := sanitizeAppSignatureCommands(in, appMetaFixture())
	line := ""
	for _, l := range out {
		if strings.Contains(l, "set application") {
			line = strings.TrimSpace(l)
		}
	}
	for _, want := range []string{"15832", "15833", "15834", "20001"} {
		if !strings.Contains(line, want) {
			t.Errorf("%s is missing from %q — the Facebook family and the resolved YouTube name must all be there", want, line)
		}
	}
	if strings.Contains(line, "999999") {
		t.Errorf("an id this device does not have was kept: %q", line)
	}
	if strings.Contains(line, "30001") {
		t.Errorf("Socialtext is not Facebook and must not be pulled in by family completion: %q", line)
	}
	// Everything that is not the signature line is untouched.
	if len(out) != len(in) {
		t.Errorf("the line count changed — nothing should have been dropped here:\n%s", joinCLI(out))
	}
}

// THE DANGEROUS ONE. Not one proposed id exists, so the entry has no application left. FortiOS
// treats an entry with neither application nor category as category 0 — EVERY app — so leaving
// `set action block` behind would turn "block this one app" into "block all traffic". The whole
// `edit … next` has to go.
func TestSanitizeAppSignaturesDeletesAnEntryWithNoRealIDs(t *testing.T) {
	in := cliLines(`config application list
    edit "AppCtrl"
        config entries
            edit 1
                set application 777777 888888
                set action block
            next
            edit 2
                set application 20001
                set action block
            next
        end
    next
end`)
	out := sanitizeAppSignatureCommands(in, appMetaFixture())
	got := joinCLI(out)
	if strings.Contains(got, "777777") || strings.Contains(got, "888888") {
		t.Errorf("an invented id survived:\n%s", got)
	}
	// The giveaway that the deletion was entry-shaped: exactly one `edit` survives inside entries,
	// and no orphan `set action block` is left without an application line.
	if n := strings.Count(got, "set action block"); n != 1 {
		t.Errorf("want exactly one surviving action line, got %d:\n%s", n, got)
	}
	if !strings.Contains(got, "set application 20001") {
		t.Errorf("the valid entry was taken with it:\n%s", got)
	}
	// And the enclosing blocks are still balanced — a deletion that eats an `end` produces CLI the
	// device rejects wholesale.
	if strings.Count(got, "config ") != strings.Count(got, "end") {
		t.Errorf("config/end are no longer balanced:\n%s", got)
	}
}

// An empty signature database means we cannot judge, so nothing may be touched. This is the
// device-unreachable path, and it must not strip every id the model proposed.
func TestSanitizeAppSignaturesDoesNothingWithoutASignatureDB(t *testing.T) {
	in := cliLines("    set application 15832 999999")
	if got := sanitizeAppSignatureCommands(in, AppControlMetadata{}); joinCLI(got) != joinCLI(in) {
		t.Errorf("with no signature DB the line must pass through unchanged: %q", joinCLI(got))
	}
}

// ── sanitizeDNSFilterCommands ────────────────────────────────────────────────

// The DNS filter sanitizer has its own test file (ai_dnsfilter_test.go); this is the one property
// that belongs with the others — it must not touch CLI that has no dnsfilter profile in it, since
// `set action allow` is perfectly legal in the DOMAIN table and in a web filter.
func TestDNSFilterSanitizerLeavesOtherSectionsAlone(t *testing.T) {
	in := cliLines(`config webfilter profile
    edit "WF"
        config ftgd-wf
            config filters
                edit 1
                    set category 26
                    set action allow
                next
            end
        end
    next
end`)
	if got := sanitizeDNSFilterCommands(in); joinCLI(got) != joinCLI(in) {
		t.Errorf("a web filter's own allow must survive:\n%s", joinCLI(got))
	}
}

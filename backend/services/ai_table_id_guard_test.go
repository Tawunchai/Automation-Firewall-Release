package services

import (
	"strings"
	"testing"
)

var liveTables = map[string][]int{"urlfilter": {1, 3}, "content": {2}}

func TestALiveTableIDIsCalledOut(t *testing.T) {
	cmds := []string{
		"config webfilter urlfilter",
		"    edit 3",
		`        set name "Staff-Web-urls"`,
		"        config entries",
		"            edit 1",
		`                set url "example.com"`,
		"                set type simple",
		"                set action block",
		"            next",
		"        end",
		"    next",
		"end",
	}
	got := warnOnLiveTableIDs(cmds, "Blocking example.com.", liveTables)

	if !strings.Contains(got, "Blocking example.com.") {
		t.Error("the explanation was replaced instead of appended to")
	}
	if !strings.Contains(got, "urlfilter table 3") {
		t.Errorf("the live table id is not named: %s", got)
	}
}

// The entry ids INSIDE `config entries` use the same syntax and are not table keys. Treating them
// as collisions would warn on nearly every proposal, and a warning that always fires is one nobody
// reads.
func TestEntryIDsInsideATableAreNotTableIDs(t *testing.T) {
	cmds := []string{
		"config webfilter urlfilter",
		"    edit 9", // free
		"        config entries",
		"            edit 1", // same number as a LIVE table id, but it is an entry
		`                set url "a.example"`,
		"            next",
		"            edit 2",
		`                set url "b.example"`,
		"            next",
		"        end",
		"    next",
		"end",
	}
	if got := warnOnLiveTableIDs(cmds, "x", liveTables); got != "x" {
		t.Errorf("warned about entry ids: %s", got)
	}
}

func TestAFreeTableIDIsSilent(t *testing.T) {
	cmds := []string{
		"config webfilter urlfilter",
		"    edit 4",
		`        set name "New-list"`,
		"    next",
		"end",
	}
	if got := warnOnLiveTableIDs(cmds, "all good", liveTables); got != "all good" {
		t.Errorf("warned about a free id: %s", got)
	}
}

func TestTheContentTableIsTrackedSeparately(t *testing.T) {
	// urlfilter 2 is free; content 2 is taken. The kinds must not share a namespace.
	urlfilter := []string{"config webfilter urlfilter", "    edit 2", "    next", "end"}
	if got := warnOnLiveTableIDs(urlfilter, "x", liveTables); got != "x" {
		t.Errorf("urlfilter 2 is free but was flagged: %s", got)
	}

	content := []string{"config webfilter content", "    edit 2", "    next", "end"}
	got := warnOnLiveTableIDs(content, "x", liveTables)
	if !strings.Contains(got, "content table 2") {
		t.Errorf("content 2 is taken and was not flagged: %s", got)
	}
}

func TestSeveralCollisionsAreListedOnce(t *testing.T) {
	cmds := []string{
		"config webfilter urlfilter",
		"    edit 1",
		"    next",
		"    edit 3",
		"    next",
		"    edit 1", // the same table twice
		"    next",
		"end",
	}
	got := warnOnLiveTableIDs(cmds, "x", liveTables)
	if strings.Count(got, "table 1, 3") != 1 {
		t.Errorf("ids are not listed once, in order: %s", got)
	}
}

// Nothing to compare against — a device whose context failed to load must not produce a warning
// built on an empty list.
func TestNoDeviceFactsMeansNoWarning(t *testing.T) {
	cmds := []string{"config webfilter urlfilter", "    edit 3", "    next", "end"}
	if got := warnOnLiveTableIDs(cmds, "x", nil); got != "x" {
		t.Errorf("warned with no device data: %s", got)
	}
	if got := warnOnLiveTableIDs(cmds, "x", map[string][]int{}); got != "x" {
		t.Errorf("warned with an empty id map: %s", got)
	}
}

// Other sections use `edit <number>` too (firewall policy, ips sensor entries). They are not
// webfilter tables and must not be read as one.
func TestOtherSectionsAreIgnored(t *testing.T) {
	cmds := []string{
		"config firewall policy",
		"    edit 1",
		`        set name "P"`,
		"    next",
		"end",
		"config ips sensor",
		`    edit "S"`,
		"        config entries",
		"            edit 3",
		"            next",
		"        end",
		"    next",
		"end",
	}
	if got := warnOnLiveTableIDs(cmds, "x", liveTables); got != "x" {
		t.Errorf("a non-webfilter section was read as a table: %s", got)
	}
}

// The DNS Filter's Static Domain Filter is the same hazard in another table, and it is the one the
// AI writes most often ("block facebook at DNS"). It was added to the guard at the same time as the
// prompt stopped pairing `edit 0` with `set domain-filter-table 0` — because with real ids in play
// a collision becomes possible where before the CLI simply never worked.
func TestALiveDNSDomainFilterTableIsCalledOut(t *testing.T) {
	live := map[string][]int{"urlfilter": {1}, "content": nil, "dns-domain-filter": {7, 8}}
	cmds := []string{
		"config dnsfilter domain-filter",
		"    edit 8",
		`        set name "DNS-Block-Social"`,
		"        config entries",
		"            edit 1",
		`                set domain "*.facebook.com"`,
		"                set type wildcard",
		"                set action block",
		"            next",
		"        end",
		"    next",
		"end",
	}
	got := warnOnLiveTableIDs(cmds, "Blocking facebook at DNS.", live)
	if !strings.Contains(got, "dnsfilter domain-filter table 8") {
		t.Errorf("the live domain-filter table is not named: %s", got)
	}
	// The wording has to say what applying it DOES — the whole point is that the user cannot tell
	// "add to the existing list" from "make a new one" without being told which they are getting.
	if !strings.Contains(got, "ALREADY EXISTS") {
		t.Errorf("the warning does not say the table is live: %s", got)
	}

	// A free id in the same table is silent.
	free := append([]string(nil), cmds...)
	free[1] = "    edit 9"
	if got := warnOnLiveTableIDs(free, "x", live); got != "x" {
		t.Errorf("a free domain-filter id must not warn: %s", got)
	}
}

// The two kinds are counted separately: urlfilter 8 being free does not make domain-filter 8 free.
func TestTableKindsDoNotShareTheirIDSpace(t *testing.T) {
	live := map[string][]int{"urlfilter": {8}, "dns-domain-filter": {3}}
	dns := []string{"config dnsfilter domain-filter", "    edit 8", "    next", "end"}
	if got := warnOnLiveTableIDs(dns, "x", live); got != "x" {
		t.Errorf("domain-filter 8 is free — a urlfilter with that id is a different table: %s", got)
	}
	url := []string{"config webfilter urlfilter", "    edit 3", "    next", "end"}
	if got := warnOnLiveTableIDs(url, "x", live); got != "x" {
		t.Errorf("urlfilter 3 is free — a domain-filter with that id is a different table: %s", got)
	}
}

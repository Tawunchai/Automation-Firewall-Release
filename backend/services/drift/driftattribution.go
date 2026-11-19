package drift

import (
	"network_automation/services"
	"sort"
	"strings"
	"time"
)

// Putting a name to a change the Change Ledger cannot account for.
//
// A drift finding says an object changed on the firewall between two backups and that no write this
// console made explains it. The device's own config-change log (fortigate_configevent.go) says who
// changed what, and when. This file is the join — pure, so every rule below can be pinned by a test
// instead of being argued about over a live device.
//
// ── WHY THIS IS A MATCH AND NOT A LOOKUP ─────────────────────────────────────
// There is no shared identifier. A finding is derived from two config FILES; an event is a line the
// device wrote at the time. They agree on the table and the object name and on nothing else, so the
// join is (table, object, inside the window) and the result is a candidate, never a certainty.
//
// The window is the honest part. A backup comparison can only say the change happened after the
// earlier backup and before the later one, so every event for that object in that span is a
// candidate. Several may be — somebody can edit the same policy four times between backups — and
// all of them are returned, newest first, rather than picking one and hiding the rest.
//
// ── THE THREE ANSWERS ────────────────────────────────────────────────────────
// "We don't know" is not one answer, it is two, and telling them apart is the whole point:
//
//	matched       the log named somebody
//	out-of-reach  the change is older than the log still holds. NOT unexplained — unreadable.
//	              The device keeps configuration events in a rolling memory buffer (no log disk),
//	              so this is the normal answer for anything old, and it must never read as "nobody".
//	unexplained   the window IS inside the log's reach and still nothing matched. That is worth
//	              looking at: a restored backup, a firmware upgrade rewriting defaults, or a rename
//	              that makes the object in the file and the object in the log two different names.
const (
	AttributionMatched     = "matched"
	AttributionOutOfReach  = "out-of-reach"
	AttributionUnexplained = "unexplained"
)

// attributionGrace widens the window at both ends before an event is considered.
//
// It exists because the two clocks and the two acts do not line up: a backup is taken at a moment
// the console records, the device writes its log line when it flushes (the probe saw an Add written
// after a Delete that followed it), and the device's clock is its own. Five minutes is wide enough
// to survive that and far narrower than any backup interval, so it cannot pull in a change from a
// different comparison window.
const attributionGrace = 5 * time.Minute

// AttributableFinding is the part of a drift finding this join needs.
type AttributableFinding struct {
	ID     uint
	Table  string // FortiOS table as the CLI writes it: "firewall address"
	Key    string // the object's mkey
	Action string // entity.DriftAction — created | modified | deleted

	// From and To are the two backups the finding sits between. From is zero when the finding came
	// from the device's first comparison, which has no earlier backup; the window is then open at
	// the start and only To bounds it.
	From time.Time
	To   time.Time
}

// DriftAttribution is what the log could say about one finding.
type DriftAttribution struct {
	FindingID uint   `json:"finding_id"`
	Status    string `json:"status"`
	// Events are every config-change event that matches this object inside the window, newest
	// first. Empty unless Status is AttributionMatched.
	Events []services.ConfigChangeEvent `json:"events,omitempty"`
}

// AttributeFindings joins findings to config-change events.
//
// Pure: it reads nothing and writes nothing. `page` is one read of the device's log, and its From/To
// are what decides out-of-reach — not a duration constant, because how far the buffer reaches
// depends on how busy the device has been.
func AttributeFindings(findings []AttributableFinding, page services.ConfigEventPage) map[uint]DriftAttribution {
	out := make(map[uint]DriftAttribution, len(findings))

	// Bucket the events by (table, object) once, so a fleet-sized finding list does not rescan the
	// whole log per row.
	byObject := make(map[string][]services.ConfigChangeEvent, len(page.Events))
	for _, ev := range page.Events {
		if ev.Object == "" {
			continue // a settings table — no object to join a finding to
		}
		k := attributionKey(ev.Path, ev.Object)
		byObject[k] = append(byObject[k], ev)
	}

	for _, f := range findings {
		att := DriftAttribution{FindingID: f.ID, Status: AttributionUnexplained}

		for _, ev := range byObject[attributionKey(f.Table, f.Key)] {
			if withinWindow(ev.At, f.From, f.To) {
				att.Events = append(att.Events, ev)
			}
		}

		switch {
		case len(att.Events) > 0:
			att.Status = AttributionMatched
			sortEventsForFinding(att.Events, f.Action)
		case !reachesWindow(page, f):
			att.Status = AttributionOutOfReach
		}
		out[f.ID] = att
	}
	return out
}

// attributionKey normalises a table name and an object into one comparable string.
//
// The device writes a CLI table with spaces ("firewall address", "firewall service custom") and the
// log writes the same table with dots ("firewall.address", "firewall.service.custom") — confirmed
// against the device for both a two-word and a three-word table. Replacing one with the other makes
// them the same string in both directions, which is why this normalises rather than converting.
//
// The object name is lower-cased with the table. FortiOS preserves the case you typed but treats
// two names differing only in case as the same object, so matching case-sensitively would lose a
// real attribution over a capital letter.
func attributionKey(table, object string) string {
	t := strings.ToLower(strings.TrimSpace(table))
	t = strings.ReplaceAll(t, " ", ".")
	return t + "\x00" + strings.ToLower(strings.TrimSpace(object))
}

// withinWindow reports whether an event falls between the two backups, allowing for the grace.
//
// An event with no timestamp is NOT matched: it would be placed by the object name alone, which is
// how a change from months ago ends up presented as the answer to this one.
func withinWindow(at, from, to time.Time) bool {
	if at.IsZero() || to.IsZero() {
		return false
	}
	if at.After(to.Add(attributionGrace)) {
		return false
	}
	// A first comparison has no earlier backup: anything up to `to` belongs to it.
	if from.IsZero() {
		return true
	}
	return !at.Before(from.Add(-attributionGrace))
}

// reachesWindow reports whether the log read could have contained this finding's change at all.
//
// Only the OLD end matters. If the oldest row the device still holds is newer than the end of the
// window, the change happened before anything the buffer remembers and the log simply cannot
// answer. A log with no rows at all reaches nothing.
func reachesWindow(page services.ConfigEventPage, f AttributableFinding) bool {
	if len(page.Events) == 0 || page.From.IsZero() || f.To.IsZero() {
		return false
	}
	return !page.From.After(f.To.Add(attributionGrace))
}

// sortEventsForFinding puts the most useful event first: the one whose action agrees with what the
// comparison found, then the most recent.
//
// The finding says the object was created, changed or deleted between the backups; the log may hold
// several events for it. An `Add` explains a "created" finding in a way a later `Edit` does not, so
// it leads even when it is older.
func sortEventsForFinding(events []services.ConfigChangeEvent, driftAction string) {
	want := logActionFor(driftAction)
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		ai, bi := strings.EqualFold(a.Action, want), strings.EqualFold(b.Action, want)
		if ai != bi {
			return ai
		}
		return a.At.After(b.At)
	})
}

// logActionFor maps the comparison's verb to the device's. Returns "" for anything unrecognised,
// which simply means no action is preferred and the newest event leads.
func logActionFor(driftAction string) string {
	switch driftAction {
	case DriftActionCreated:
		return "Add"
	case DriftActionDeleted:
		return "Delete"
	case DriftActionModified:
		return "Edit"
	}
	return ""
}

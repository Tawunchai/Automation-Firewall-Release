package drift

import (
	"network_automation/services"
	"testing"
	"time"
)

// The join between a drift finding and the firewall's config-change log. Every rule here is one a
// person reads as a sentence next to somebody's name, so each is pinned rather than trusted.

var (
	base  = time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	older = base.Add(-2 * time.Hour) // the earlier backup
	newer = base.Add(2 * time.Hour)  // the backup that revealed the change
)

func event(at time.Time, over ...func(*services.ConfigChangeEvent)) services.ConfigChangeEvent {
	ev := services.ConfigChangeEvent{
		At: at, User: "admin", Via: "ssh", SourceIP: "10.0.0.9",
		Action: "Edit", Path: "firewall.address", Object: "web-01",
	}
	for _, f := range over {
		f(&ev)
	}
	return ev
}

func finding(over ...func(*AttributableFinding)) AttributableFinding {
	f := AttributableFinding{
		ID: 1, Table: "firewall address", Key: "web-01",
		Action: DriftActionModified, From: older, To: newer,
	}
	for _, o := range over {
		o(&f)
	}
	return f
}

func pageOf(events ...services.ConfigChangeEvent) services.ConfigEventPage {
	p := services.ConfigEventPage{Events: events, Total: len(events)}
	for _, e := range events {
		if e.At.IsZero() {
			continue
		}
		if p.From.IsZero() || e.At.Before(p.From) {
			p.From = e.At
		}
		if p.To.IsZero() || e.At.After(p.To) {
			p.To = e.At
		}
	}
	return p
}

func TestAttributeFindings_NamesWhoever(t *testing.T) {
	got := AttributeFindings([]AttributableFinding{finding()}, pageOf(event(base)))
	att := got[1]
	if att.Status != AttributionMatched {
		t.Fatalf("status = %q, want matched", att.Status)
	}
	if len(att.Events) != 1 || att.Events[0].User != "admin" || att.Events[0].SourceIP != "10.0.0.9" {
		t.Fatalf("got %+v", att.Events)
	}
}

// The log writes a table with dots and the comparison writes it with spaces. Confirmed on the
// device for both a two-word and a three-word table; if this normalisation breaks, every row on the
// page reads "unexplained" while the answer sits in the log.
func TestAttributeFindings_TableSpellingsAgree(t *testing.T) {
	cases := []struct{ table, cfgpath string }{
		{"firewall address", "firewall.address"},
		{"firewall service custom", "firewall.service.custom"},
		{"vpn.ipsec phase1-interface", "vpn.ipsec.phase1-interface"},
		{"FIREWALL ADDRESS", "firewall.address"},
	}
	for _, tc := range cases {
		f := finding(func(f *AttributableFinding) { f.Table = tc.table })
		ev := event(base, func(e *services.ConfigChangeEvent) { e.Path = tc.cfgpath })
		if got := AttributeFindings([]AttributableFinding{f}, pageOf(ev))[1]; got.Status != AttributionMatched {
			t.Errorf("%q vs %q → %s, want matched", tc.table, tc.cfgpath, got.Status)
		}
	}
}

// FortiOS preserves the case you typed but treats names differing only in case as one object.
func TestAttributeFindings_ObjectNameCaseDoesNotLoseTheAnswer(t *testing.T) {
	f := finding(func(f *AttributableFinding) { f.Key = "Web-01" })
	if got := AttributeFindings([]AttributableFinding{f}, pageOf(event(base)))[1]; got.Status != AttributionMatched {
		t.Fatalf("status = %q, want matched", got.Status)
	}
}

func TestAttributeFindings_IgnoresAnotherObject(t *testing.T) {
	ev := event(base, func(e *services.ConfigChangeEvent) { e.Object = "web-02" })
	if got := AttributeFindings([]AttributableFinding{finding()}, pageOf(ev))[1]; got.Status == AttributionMatched {
		t.Fatalf("matched a different object: %+v", got.Events)
	}
}

// The distinction the whole feature rests on. A change older than the buffer must read as "the
// firewall no longer remembers", never as "nobody did it" — the second is an accusation.
func TestAttributeFindings_OldChangeIsOutOfReachNotUnexplained(t *testing.T) {
	// The only rows left are a week newer than the window this finding sits in.
	page := pageOf(event(base.Add(7*24*time.Hour), func(e *services.ConfigChangeEvent) { e.Object = "other" }))
	got := AttributeFindings([]AttributableFinding{finding()}, page)[1]
	if got.Status != AttributionOutOfReach {
		t.Fatalf("status = %q, want out-of-reach", got.Status)
	}
}

// …and the opposite: the log DOES cover the window and still has nothing. That is a real finding
// about the finding, and must not be softened into "out of reach".
func TestAttributeFindings_InReachWithNoRowIsUnexplained(t *testing.T) {
	page := pageOf(event(older.Add(-time.Hour), func(e *services.ConfigChangeEvent) { e.Object = "other" }))
	got := AttributeFindings([]AttributableFinding{finding()}, page)[1]
	if got.Status != AttributionUnexplained {
		t.Fatalf("status = %q, want unexplained", got.Status)
	}
}

func TestAttributeFindings_EmptyLogIsOutOfReach(t *testing.T) {
	got := AttributeFindings([]AttributableFinding{finding()}, services.ConfigEventPage{})[1]
	if got.Status != AttributionOutOfReach {
		t.Fatalf("status = %q, want out-of-reach", got.Status)
	}
}

// A change outside the two backups is somebody else's change to the same object. Matching it would
// put a name and a time on this row that belong to a different one.
func TestAttributeFindings_RejectsEventsOutsideTheWindow(t *testing.T) {
	for _, at := range []time.Time{older.Add(-time.Hour), newer.Add(time.Hour)} {
		// Give the page reach over the window, so a rejection cannot hide as out-of-reach.
		page := pageOf(event(at), event(older.Add(-90*time.Minute), func(e *services.ConfigChangeEvent) { e.Object = "other" }))
		if got := AttributeFindings([]AttributableFinding{finding()}, page)[1]; got.Status == AttributionMatched {
			t.Errorf("event at %v matched a window of %v..%v", at, older, newer)
		}
	}
}

// The device flushes its log after the fact and runs its own clock, so a few minutes either side is
// the same change — but only a few.
func TestAttributeFindings_GraceCoversTheFlushButNotAnHour(t *testing.T) {
	if got := AttributeFindings([]AttributableFinding{finding()}, pageOf(event(newer.Add(time.Minute))))[1]; got.Status != AttributionMatched {
		t.Errorf("a minute past the backup → %s, want matched", got.Status)
	}
	if got := AttributeFindings([]AttributableFinding{finding()}, pageOf(event(newer.Add(6*time.Minute))))[1]; got.Status == AttributionMatched {
		t.Error("six minutes past the backup matched; the grace is five")
	}
}

// The first comparison a device ever runs has no earlier backup. Its findings would otherwise be
// unattributable for want of a lower bound.
func TestAttributeFindings_FirstComparisonHasAnOpenStart(t *testing.T) {
	f := finding(func(f *AttributableFinding) { f.From = time.Time{} })
	page := pageOf(event(base.Add(-30 * 24 * time.Hour)))
	if got := AttributeFindings([]AttributableFinding{f}, page)[1]; got.Status != AttributionMatched {
		t.Fatalf("status = %q, want matched", got.Status)
	}
}

// A row the device sent without a timestamp cannot be placed, and placing it by name alone is how a
// change from months ago is presented as the answer to this one.
func TestAttributeFindings_UndatedEventIsNeverTheAnswer(t *testing.T) {
	page := pageOf(event(time.Time{}), event(older.Add(-time.Hour), func(e *services.ConfigChangeEvent) { e.Object = "other" }))
	if got := AttributeFindings([]AttributableFinding{finding()}, page)[1]; got.Status == AttributionMatched {
		t.Fatalf("an undated row was used: %+v", got.Events)
	}
}

// Somebody can edit the same object several times between two backups. All of them are the answer,
// and the one whose action matches what the comparison found leads.
func TestAttributeFindings_KeepsEveryEventAndLeadsWithTheMatchingAction(t *testing.T) {
	add := event(base.Add(-time.Hour), func(e *services.ConfigChangeEvent) { e.Action = "Add"; e.User = "somchai" })
	edit1 := event(base, func(e *services.ConfigChangeEvent) { e.Action = "Edit"; e.User = "nok" })
	edit2 := event(base.Add(time.Minute), func(e *services.ConfigChangeEvent) { e.Action = "Edit"; e.User = "lek" })

	f := finding(func(f *AttributableFinding) { f.Action = DriftActionCreated })
	got := AttributeFindings([]AttributableFinding{f}, pageOf(edit1, add, edit2))[1]
	if len(got.Events) != 3 {
		t.Fatalf("kept %d events, want all 3", len(got.Events))
	}
	if got.Events[0].User != "somchai" {
		t.Errorf("a created finding led with %q; the Add explains it", got.Events[0].User)
	}

	// With no action preference, the newest leads.
	f2 := finding(func(f *AttributableFinding) { f.Action = "something-else" })
	got2 := AttributeFindings([]AttributableFinding{f2}, pageOf(edit1, add, edit2))[1]
	if got2.Events[0].User != "lek" {
		t.Errorf("led with %q, want the newest", got2.Events[0].User)
	}
}

// A settings table (log.setting) has no object, so it can never be the answer to a finding about
// one — and must not become a wildcard that matches every finding with an empty key.
func TestAttributeFindings_SettingsRowsAreNotCandidates(t *testing.T) {
	ev := event(base, func(e *services.ConfigChangeEvent) { e.Path = "log.setting"; e.Object = "" })
	f := finding(func(f *AttributableFinding) { f.Table = "log setting"; f.Key = "" })
	if got := AttributeFindings([]AttributableFinding{f}, pageOf(ev))[1]; got.Status == AttributionMatched {
		t.Fatalf("a settings row was matched: %+v", got.Events)
	}
}

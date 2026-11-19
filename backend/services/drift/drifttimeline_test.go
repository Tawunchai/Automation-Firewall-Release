package drift

import (
	"network_automation/services"
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

func createdOutside(table, key string) entity.DriftFinding {
	return entity.DriftFinding{
		Table: table, CMDBPath: canonicalCMDBPath(table), ResourceKey: key, Action: DriftActionCreated,
	}
}

func TestCLITableRESTPath_MatchesTheDevicesOwnTree(t *testing.T) {
	// Each of these answered 200 on the lab FGT80E at the path on the right.
	cases := map[string]string{
		"firewall address":            "firewall/address",
		"vpn ipsec phase1-interface":  "vpn.ipsec/phase1-interface",
		"firewall ssh local-key":      "firewall.ssh/local-key",
		"vpn certificate local":       "vpn.certificate/local",
		"firewall service custom":     "firewall.service/custom",
		"firewall schedule recurring": "firewall.schedule/recurring",
		"system autoupdate tunneling": "system.autoupdate/tunneling",
		"user local":                  "user/local",
	}
	for table, want := range cases {
		got, ok := cLITableRESTPath(table)
		if !ok || got != want {
			t.Errorf("%q → %q (ok=%t), want %q", table, got, ok, want)
		}
	}
}

func TestCLITableRESTPath_RefusesAnythingThatIsNotATable(t *testing.T) {
	for _, table := range []string{"", "firewall", "firewall address/../../system", "firewall add?ress", "firewall addr%2f"} {
		if got, ok := cLITableRESTPath(table); ok {
			t.Errorf("%q was accepted as %q — an odd token must never reach a URL", table, got)
		}
	}
}

func TestOutsideUndoPlan_OnlyATopLevelCreateWithAKeyQualifies(t *testing.T) {
	plan := OutsideUndoPlan(createdOutside("firewall address", "rogue-host"))
	if plan.Path != "/api/v2/cmdb/firewall/address" {
		t.Fatalf("path = %q (%s), want the address collection", plan.Path, plan.Reason)
	}

	undone := uint(9)
	refused := map[string]entity.DriftFinding{
		"modified": {Table: "firewall address", CMDBPath: "firewall/address", ResourceKey: "x", Action: DriftActionModified},
		"deleted":  {Table: "firewall address", CMDBPath: "firewall/address", ResourceKey: "x", Action: DriftActionDeleted},
		"keyless":  createdOutside("firewall address", "  "),
		"attributed": func() entity.DriftFinding {
			f := createdOutside("firewall address", "x")
			f.Attributed = true
			return f
		}(),
		"already undone": func() entity.DriftFinding {
			f := createdOutside("firewall address", "x")
			f.UndoChangeID = &undone
			return f
		}(),
		// A child list inside another object: its key is the CHILD's, so a delete against the outer
		// table would aim at the wrong thing.
		"nested":      {Table: "system sdwan health-check", CMDBPath: "system/sdwan", ResourceKey: "ping-8.8.8.8", Action: DriftActionCreated},
		"single word": {Table: "firewall", CMDBPath: "firewall", ResourceKey: "x", Action: DriftActionCreated},
	}
	for name, f := range refused {
		plan := OutsideUndoPlan(f)
		if plan.Path != "" {
			t.Errorf("%s: offered an undo at %q", name, plan.Path)
		}
		if plan.Reason == "" {
			t.Errorf("%s: refused with no reason — the page would show a dead control", name)
		}
	}
}

// The DELETE this undo sends must name the object. A DELETE at the collection URL empties the whole
// FortiOS table — the accident this codebase has already had once.
func TestOutsideUndo_DeleteIsAlwaysByKeyNeverAtTheCollection(t *testing.T) {
	for _, table := range []string{"firewall address", "vpn ipsec phase1-interface", "user local"} {
		f := createdOutside(table, "obj/with slash")
		plan := OutsideUndoPlan(f)
		req, err := services.BuildRevertRequest(entity.ChangeActionCreate, plan.Path, f.ResourceKey, nil)
		if err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		if req.Method != "DELETE" || !strings.HasPrefix(req.Path, plan.Path+"/") || req.Path == plan.Path+"/" {
			t.Fatalf("%s: %s %s — not a by-key delete", table, req.Method, req.Path)
		}
		if strings.Contains(strings.TrimPrefix(req.Path, plan.Path+"/"), "/") {
			t.Fatalf("%s: key was not escaped: %s", table, req.Path)
		}
	}
}

func TestUndoOutsideCreate_RefusesBeforeTouchingTheDevice(t *testing.T) {
	// nil db and nil client: if the refusal did not come first, this would panic.
	f := entity.DriftFinding{Table: "firewall address", CMDBPath: "firewall/address", ResourceKey: "x", Action: DriftActionModified}
	if _, err := UndoOutsideCreate(nil, nil, f, entity.ChangeRecord{}); err == nil {
		t.Fatal("an edit made outside the console was accepted for per-object undo")
	}
}

func TestOutsideItem_PicksTheFallbackAndTheWindow(t *testing.T) {
	from := time.Date(2026, 9, 4, 16, 24, 0, 0, time.UTC)
	to := time.Date(2026, 9, 10, 15, 41, 0, 0, time.UTC)
	run := entity.DriftRun{FromBackupID: 6, ToBackupID: 7}
	run.ID = 5
	taken := map[uint]time.Time{6: from, 7: to}

	created := outsideItem(createdOutside("firewall address", "rogue"), run, taken)
	if created.Fallback != FallbackUndo || created.Action != "create" {
		t.Fatalf("created → %+v, want an undo of a create", created)
	}
	if created.WindowFrom == nil || !created.WindowFrom.Equal(from) || created.WindowTo == nil || !created.WindowTo.Equal(to) {
		t.Fatalf("window = %v..%v, want the two backups' times", created.WindowFrom, created.WindowTo)
	}

	edited := outsideItem(entity.DriftFinding{Table: "system interface", CMDBPath: "system/interface",
		ResourceKey: "wan1", Action: DriftActionModified}, run, taken)
	if edited.Fallback != FallbackRestore || edited.RestoreBackupID != 6 || edited.Action != "update" {
		t.Fatalf("edited → %+v, want restore of backup 6 (the one BEFORE the change)", edited)
	}

	undone := uint(3)
	gone := createdOutside("firewall address", "rogue")
	gone.UndoChangeID = &undone
	if it := outsideItem(gone, run, taken); it.Fallback != FallbackNone || it.UndoNote == "" {
		t.Fatalf("already undone → %+v, want no control and a reason", it)
	}
}

func TestConsoleItem_UsesTheLedgerRulesAndTheCLITableName(t *testing.T) {
	r := entity.ChangeRecord{Action: entity.ChangeActionCreate, Status: entity.ChangeStatusApplied,
		CMDBPath: "/api/v2/cmdb/vpn.ipsec/phase1-interface", ResourceKey: "to-branch"}
	it := consoleItem(r, false, true)
	if it.Fallback != FallbackUndo || it.Table != "vpn ipsec phase1-interface" {
		t.Fatalf("got %+v", it)
	}
	r.Status = entity.ChangeStatusFailed
	if it := consoleItem(r, false, true); it.Fallback != FallbackNone || !strings.Contains(it.UndoNote, "never applied") {
		t.Fatalf("failed write → %+v, want no undo with the reason", it)
	}
}

func TestValidTimelineFilter(t *testing.T) {
	for _, f := range []string{"all", "console", "outside", "failed"} {
		if !ValidTimelineFilter(f) {
			t.Errorf("%q rejected", f)
		}
	}
	// "review" was the fifth chip until the review workflow was removed. It must be rejected like
	// any other unknown filter rather than quietly served as something else — the counts no longer
	// publish it, so a caller asking for it is working from a stale idea of this endpoint. (The
	// page itself never sends it: readFilter in pages/drift/index.tsx drops an unknown ?show=.)
	for _, f := range []string{"everything", "review"} {
		if ValidTimelineFilter(f) {
			t.Errorf("%q accepted", f)
		}
	}
}

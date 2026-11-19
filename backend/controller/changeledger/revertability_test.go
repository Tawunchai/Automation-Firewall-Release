package changeledger

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

// revertability is what the Revert button binds to. Every "no" below is a case where pressing the
// button would either do nothing or do something wrong, so each one is pinned here — a
// false-positive on the create branch in particular would offer a DELETE with no key, and that
// wipes a whole FortiOS table.

func applied(action string) entity.ChangeRecord {
	return entity.ChangeRecord{
		Action:       action,
		Status:       entity.ChangeStatusApplied,
		CMDBPath:     "/api/v2/cmdb/firewall/address",
		ResourceKey:  "LAN",
		ResourceType: "address",
		Before:       `{"name":"LAN"}`,
	}
}

func TestRevertability_AppliedChangesAreRevertible(t *testing.T) {
	for _, action := range []string{entity.ChangeActionCreate, entity.ChangeActionUpdate, entity.ChangeActionDelete} {
		ok, why := revertability(applied(action))
		if !ok {
			t.Errorf("%s change was not revertible: %s", action, why)
		}
	}
}

// Reverting a create issues a DELETE. Without a key that DELETE lands on the collection URL and
// FortiOS empties the entire table.
func TestRevertability_KeylessCreateIsNeverOffered(t *testing.T) {
	rec := applied(entity.ChangeActionCreate)
	rec.ResourceKey = ""

	ok, why := revertability(rec)
	if ok {
		t.Fatalf("a keyless create was offered for revert — that DELETE would clear the table")
	}
	if !strings.Contains(why, "key") {
		t.Errorf("reason = %q, want it to name the missing key", why)
	}
}

// Restoring "the previous state" with no snapshot of it would silently do nothing.
func TestRevertability_RequiresASnapshotToRestore(t *testing.T) {
	for _, action := range []string{entity.ChangeActionUpdate, entity.ChangeActionDelete} {
		rec := applied(action)
		rec.Before = ""
		if ok, _ := revertability(rec); ok {
			t.Errorf("%s with no Before snapshot was offered for revert", action)
		}
	}

	rec := applied(entity.ChangeActionUpdate)
	rec.ResourceKey = ""
	if ok, _ := revertability(rec); ok {
		t.Errorf("update with no object key was offered for revert")
	}
}

// A change that never applied has nothing to undo; offering it would make an operator think the
// firewall is in a state it is not.
func TestRevertability_FailedChangesAreNotRevertible(t *testing.T) {
	rec := applied(entity.ChangeActionUpdate)
	rec.Status = entity.ChangeStatusFailed

	ok, why := revertability(rec)
	if ok {
		t.Fatalf("a failed change was offered for revert")
	}
	if !strings.Contains(why, "never applied") {
		t.Errorf("reason = %q, want it to say the change never applied", why)
	}
}

func TestRevertability_AlreadyRevertedIsNotOfferedTwice(t *testing.T) {
	rec := applied(entity.ChangeActionDelete)
	now := time.Now()
	rec.Status = entity.ChangeStatusReverted
	rec.RevertedAt = &now

	if ok, why := revertability(rec); ok {
		t.Errorf("an already-reverted change was offered again (%s)", why)
	}
}

// Reverting a revert would ping-pong the object. The original change is the one to act on.
func TestRevertability_ARevertIsNotItselfRevertible(t *testing.T) {
	rec := applied(entity.ChangeActionCreate)
	original := uint(7)
	rec.RevertOfID = &original

	ok, why := revertability(rec)
	if ok {
		t.Fatalf("a revert entry was offered for revert")
	}
	if !strings.Contains(why, "original") {
		t.Errorf("reason = %q, want it to point at the original change", why)
	}
}

// Without a recorded table there is nowhere to send the inverse request.
func TestRevertability_RequiresACMDBPath(t *testing.T) {
	rec := applied(entity.ChangeActionUpdate)
	rec.CMDBPath = ""

	if ok, _ := revertability(rec); ok {
		t.Errorf("a change with no CMDB path was offered for revert")
	}
}

func TestRevertability_UnknownActionIsRefused(t *testing.T) {
	rec := applied("teleport")

	if ok, _ := revertability(rec); ok {
		t.Errorf("an unknown action was offered for revert")
	}
}

// ── inverse action ───────────────────────────────────────────────────────────

func TestInverseAction(t *testing.T) {
	cases := map[string]string{
		entity.ChangeActionCreate: entity.ChangeActionDelete,
		entity.ChangeActionDelete: entity.ChangeActionCreate,
		entity.ChangeActionUpdate: entity.ChangeActionUpdate,
	}
	for in, want := range cases {
		if got := inverseAction(in); got != want {
			t.Errorf("inverseAction(%q) = %q, want %q", in, got, want)
		}
	}
}

// ── row rendering ────────────────────────────────────────────────────────────

// A corrupted snapshot must not emit invalid JSON into the middle of the API response.
func TestRawOrNil_RejectsInvalidJSON(t *testing.T) {
	if got := rawOrNil(`{"name":"LAN"}`); string(got) != `{"name":"LAN"}` {
		t.Errorf("valid JSON was dropped: %s", got)
	}
	if got := rawOrNil("not json at all"); got != nil {
		t.Errorf("invalid JSON leaked into the response: %s", got)
	}
	if got := rawOrNil("   "); got != nil {
		t.Errorf("blank snapshot rendered as %s, want nil", got)
	}
}

func TestToChangeRow_CarriesTheSnapshotsAndTheVerdict(t *testing.T) {
	rec := applied(entity.ChangeActionUpdate)
	rec.ID = 42
	rec.After = `{"name":"LAN","subnet":"10.0.0.0 255.0.0.0"}`
	rec.NetworkDevice = &entity.NetworkDevice{Name: "FGT-LAB"}

	row := toChangeRow(rec)

	if row.ID != 42 || row.DeviceName != "FGT-LAB" {
		t.Errorf("row = %+v, want id 42 on FGT-LAB", row)
	}
	if !row.Revertible {
		t.Errorf("a complete update row should be revertible (%s)", row.RevertNote)
	}
	var after map[string]interface{}
	if err := json.Unmarshal(row.After, &after); err != nil {
		t.Fatalf("After is not valid JSON: %v", err)
	}
	if after["subnet"] == nil {
		t.Errorf("the After snapshot lost its fields: %s", row.After)
	}
}

// The ledger list reads rows WITHOUT their snapshot bodies (see ListChanges) and decides the Revert
// button from a presence flag instead. If the two ever disagreed, the list would offer a revert the
// server then refuses — or, worse, hide one that is safe. Every case above must give the same verdict
// through both doors.
func TestRevertability_LeanListAgreesWithFullRecord(t *testing.T) {
	cases := []entity.ChangeRecord{}
	for _, action := range []string{entity.ChangeActionCreate, entity.ChangeActionUpdate, entity.ChangeActionDelete, "move"} {
		for _, before := range []string{"", `{"name":"LAN"}`} {
			for _, key := range []string{"", "LAN"} {
				for _, status := range []string{entity.ChangeStatusApplied, entity.ChangeStatusFailed, entity.ChangeStatusReverted} {
					rec := applied(action)
					rec.Before, rec.ResourceKey, rec.Status = before, key, status
					cases = append(cases, rec)
				}
			}
		}
	}
	for _, rec := range cases {
		fullOK, fullWhy := revertability(rec)
		lean := toChangeRowWith(rec, rec.Before != "", rec.After != "")
		if lean.Revertible != fullOK || lean.RevertNote != fullWhy {
			t.Errorf("%s/%s key=%q before=%t: list says (%t, %q), full record says (%t, %q)",
				rec.Action, rec.Status, rec.ResourceKey, rec.Before != "",
				lean.Revertible, lean.RevertNote, fullOK, fullWhy)
		}
		if lean.Before != nil || lean.After != nil {
			t.Errorf("a lean row carried a snapshot body")
		}
	}
}

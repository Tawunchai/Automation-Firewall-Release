package services

import (
	"encoding/json"
	"strings"
	"testing"

	"network_automation/entity"
)

// A policy move in the change ledger is undone by moving the policy back, not by replaying a body.
// Replaying the body is what the ledger used to do: the device said success, the row said
// "reverted", and the policy stayed where it had been moved to.

func moveRow(before, after string) entity.ChangeRecord {
	return entity.ChangeRecord{
		ResourceType: "firewall-policy", Action: entity.ChangeActionUpdate, Status: entity.ChangeStatusApplied,
		CMDBPath: "/api/v2/cmdb/firewall/policy", ResourceKey: "8",
		Path: "/policy/device/1/firewall-policies/8/move", Before: before, After: after,
	}
}

func TestIsPolicyMoveRecord(t *testing.T) {
	if !IsPolicyMoveRecord(moveRow("", "{}")) {
		t.Error("PUT …/firewall-policies/8/move is a move")
	}
	toggle := moveRow("{}", "{}")
	toggle.Path = "/policy/device/1/firewall-policies/8/toggle"
	if IsPolicyMoveRecord(toggle) {
		t.Error("a toggle rewrites the body and is undone by replaying it — not a move")
	}
	edit := moveRow("{}", "{}")
	edit.Path = "/policy/device/1/firewall-policies/8"
	if IsPolicyMoveRecord(edit) {
		t.Error("an edit is not a move")
	}
	if !IsPolicyMoveRecord(entity.ChangeRecord{ResourceType: LedgerTypeFixMove}) {
		t.Error("a Troubleshooting fix's move is a move")
	}
	if IsPolicyMoveRecord(entity.ChangeRecord{ResourceType: LedgerTypeFixPlaceNew}) {
		t.Error("placing a policy the same fix created has nothing of its own to move back")
	}
}

func TestMoveRecordFromRequest_RemembersWhereThePolicyWas(t *testing.T) {
	order := []int{2, 5, 6, 1, 7, 8, 4, 9} // the lab's order, read live with format=policyid

	rec := MoveRecordFromRequest(order, 8, []byte(`{"position":"before","ref_id":7}`))
	if rec.Position != "before" || rec.Ref != 7 || rec.Restore == nil || *rec.Restore != (FixMovePlace{Position: "before", Ref: 4}) {
		t.Fatalf("#8 sat before #4; got %+v restore %+v", rec, rec.Restore)
	}
	if last := MoveRecordFromRequest(order, 9, []byte(`{"ref_id":2}`)); last.Restore == nil ||
		*last.Restore != (FixMovePlace{Position: "after", Ref: 4}) || last.Position != "before" {
		t.Fatalf("#9 was last, so it sat after #4 (and an omitted position means before); got %+v", last)
	}
	if blind := MoveRecordFromRequest(nil, 8, []byte(`{"ref_id":7}`)); blind.Restore != nil {
		t.Error("with no order read, the place is unknown — never guessed")
	}
}

func TestRevertPolicyMove_RefusesWithoutAPlace(t *testing.T) {
	// No device is touched on this path — the zero client would fail loudly if it were.
	f := &FortiClient{}
	noPlace, _ := json.Marshal(FixMoveRecord{Position: "before", Ref: 7})
	if err := f.RevertPolicyMove(moveRow("", string(noPlace))); err == nil || !strings.Contains(err.Error(), "previous position") {
		t.Fatalf("a move with no recorded place must refuse, got %v", err)
	}
	if err := f.RevertPolicyMove(moveRow("", "not json")); err == nil {
		t.Fatal("an unreadable record must refuse")
	}
}

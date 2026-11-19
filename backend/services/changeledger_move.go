package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"network_automation/entity"
)

// A policy MOVE in the change ledger.
//
// A move changes a policy's POSITION, not its body. The ledger was built around bodies — snapshot
// the object, and undo a change by writing the old snapshot back — and it recorded moves the same
// way. Reverting one therefore PUT the policy's unchanged body back onto it: the device answered
// success, the ledger marked the move "reverted", and the policy stayed exactly where it had been
// moved to. A button that reports an undo it did not do is worse than no button.
//
// So a move is recorded by where it sits instead: its neighbour before the move (the policy that
// followed it, or the one before it when it was last). Revert moves it back next to that neighbour.
// Before is left empty for a move on purpose — the body-replay revert refuses a row without one, so
// nothing can reach the old, wrong path by accident.
//
// Moves recorded before this existed carry a body snapshot and no position. They are marked as not
// revertable, with the reason, rather than offered a revert that cannot put them back.

// Ledger resource types for the two moves the Troubleshooting fix writes.
const (
	// LedgerTypeFixMove is an existing policy moved above the deny that shadowed it.
	LedgerTypeFixMove = "troubleshoot-fix:" + FixOpMovePolicy
	// LedgerTypeFixPlaceNew places the policy the same fix created. Undoing the fix deletes that
	// policy, so this row has nothing of its own to undo.
	LedgerTypeFixPlaceNew = "troubleshoot-fix:place-new-policy"
)

// IsPolicyMoveRecord reports whether a ledger row recorded a policy move — by the console's
// Firewall Policy page (…/firewall-policies/<id>/move) or by a Troubleshooting fix.
func IsPolicyMoveRecord(r entity.ChangeRecord) bool {
	if r.ResourceType == LedgerTypeFixMove {
		return true
	}
	return r.ResourceType == "firewall-policy" &&
		strings.HasSuffix(strings.TrimRight(r.Path, "/"), "/move") &&
		strings.Contains(r.Path, "/firewall-policies/")
}

// PolicyOrder returns the policy ids in table order — all a move changes, and a fraction of the
// size of the full table (format=policyid, verified on 7.2.10: [2,5,6,1,7,8,4,9]).
func (f *FortiClient) PolicyOrder() ([]int, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/policy?format=policyid", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		PolicyID int `json:"policyid"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse the policy order: %w", err)
	}
	out := make([]int, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.PolicyID)
	}
	return out, nil
}

// neighbourOfIDs is where a policy sits in an ordered list of ids: before the one that follows it,
// or after the one before it when it is last. Nil when it is not there, or alone.
func neighbourOfIDs(order []int, id int) *FixMovePlace {
	for i, pid := range order {
		if pid != id {
			continue
		}
		if i+1 < len(order) {
			return &FixMovePlace{Position: "before", Ref: order[i+1]}
		}
		if i > 0 {
			return &FixMovePlace{Position: "after", Ref: order[i-1]}
		}
	}
	return nil
}

// MoveRecordFromRequest is a move row's After: where the request put the policy, and — from the
// order read BEFORE the move — where it came from. order may be nil when that read failed; the row
// then has no Restore, and a revert says so instead of guessing.
func MoveRecordFromRequest(order []int, policyID int, reqBody []byte) FixMoveRecord {
	var body struct {
		Position string `json:"position"`
		RefID    int    `json:"ref_id"`
	}
	_ = json.Unmarshal(reqBody, &body)
	pos := body.Position
	if pos != "after" {
		pos = "before" // MovePolicy's own default
	}
	return FixMoveRecord{Position: pos, Ref: body.RefID, Restore: neighbourOfIDs(order, policyID)}
}

// PolicyIDOf reads a policy id out of a route mkey; 0 when it is not one.
func PolicyIDOf(mkey string) int { return atoiOr0(mkey) }

// RevertPolicyMove moves a policy back to where a move row says it came from.
func (f *FortiClient) RevertPolicyMove(r entity.ChangeRecord) error {
	var rec FixMoveRecord
	if err := json.Unmarshal([]byte(r.After), &rec); err != nil || rec.Restore == nil {
		return fmt.Errorf("the policy's previous position was not recorded, so it cannot be moved back automatically")
	}
	id := atoiOr0(r.ResourceKey)
	if id <= 0 {
		return fmt.Errorf("no policy id was recorded for this move")
	}
	return f.MovePolicy(id, rec.Restore.Position, rec.Restore.Ref)
}

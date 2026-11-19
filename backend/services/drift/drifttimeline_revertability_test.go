package drift

import (
	"encoding/json"
	"network_automation/services"
	"strings"
	"testing"

	"network_automation/entity"
)

// moveRow is the ledger row a policy move writes, as changeledger_move_test.go builds it — copied
// rather than exported, because a test fixture is not API.
func moveRow(before, after string) entity.ChangeRecord {
	return entity.ChangeRecord{
		ResourceType: "firewall-policy", Action: entity.ChangeActionUpdate, Status: entity.ChangeStatusApplied,
		CMDBPath: "/api/v2/cmdb/firewall/policy", ResourceKey: "8",
		Path: "/policy/device/1/firewall-policies/8/move", Before: before, After: after,
	}
}

func TestLedgerRevertability_Moves(t *testing.T) {
	after, _ := json.Marshal(services.FixMoveRecord{Position: "before", Ref: 7, Restore: &services.FixMovePlace{Position: "before", Ref: 4}})

	if ok, why := LedgerRevertability(moveRow("", string(after)), false); !ok {
		t.Fatalf("a move recorded with its place can be reverted, got %q", why)
	}

	// Recorded the old way: a body and no place. Offering Revert here is the bug being fixed.
	old := moveRow(`{"policyid":8,"name":"x"}`, `{"policyid":8,"name":"x"}`)
	if ok, why := LedgerRevertability(old, true); ok || !strings.Contains(why, "previous position") {
		t.Fatalf("an old move row must not offer a revert that moves nothing; got ok=%v %q", ok, why)
	}

	if ok, _ := LedgerRevertability(entity.ChangeRecord{
		ResourceType: services.LedgerTypeFixPlaceNew, Action: entity.ChangeActionUpdate, Status: entity.ChangeStatusApplied,
		CMDBPath: "/api/v2/cmdb/firewall/policy", ResourceKey: "9",
	}, false); ok {
		t.Error("a placement of a policy the fix created is undone by undoing the fix")
	}

	done := moveRow("", string(after))
	done.Status = entity.ChangeStatusReverted
	if ok, why := LedgerRevertability(done, false); ok || why != "already reverted" {
		t.Errorf("status still comes first, got ok=%v %q", ok, why)
	}
}

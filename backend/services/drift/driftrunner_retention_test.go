package drift

import (
	"testing"

	"network_automation/services"
)

// Audit runs, drift runs and ledger rows are the same kind of thing — a record of what changed on a
// firewall and when — so they are kept for the same two annual review cycles. The ledger's own half
// of this is services/retention_test.go; this half lives here because drift is the package allowed
// to see both constants.
func TestDriftHistorySharesTheEvidenceHorizon(t *testing.T) {
	if services.ChangeRecordRetention != DriftRunRetention {
		t.Errorf("the change ledger (%v) and drift history (%v) should share the evidence horizon",
			services.ChangeRecordRetention, DriftRunRetention)
	}
}

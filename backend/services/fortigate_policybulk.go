package services

import (
	"encoding/json"
	"fmt"
)

// Firewall Policy — clone one rule, and act on several at once.
//
// Both exist because the table was one-rule-at-a-time in a job that is not. Writing the eleventh
// near-identical egress rule by hand is how a table ends up with eleven rules that are subtly
// different, and turning off a block of rules during a maintenance window meant eleven clicks and
// eleven chances to click the wrong row.

// GetPolicy reads one firewall/policy by its policyid.
//
// Read back from the device rather than picked out of a cached list: a clone copies EVERY field,
// including the ones no form in this console exposes, and a list that was fetched a minute ago
// would silently copy a stale version of the rule.
func (f *FortiClient) GetPolicy(policyID int) (*FGPolicy, error) {
	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/firewall/policy/%d", policyID), nil)
	if err != nil {
		return nil, err
	}
	var policies []FGPolicy
	if err := json.Unmarshal(resp.Results, &policies); err != nil {
		return nil, fmt.Errorf("failed to parse policy %d: %w", policyID, err)
	}
	if len(policies) == 0 {
		return nil, fmt.Errorf("policy %d not found", policyID)
	}
	return &policies[0], nil
}

// ClonePolicy copies a rule, names the copy, and places it directly after the original.
//
// Three decisions, each of which is the safe half of a choice:
//
//   - The copy is created DISABLED, whatever the original's status. A clone lands in the middle of
//     a first-match table; if it were enabled it would start deciding traffic the instant it
//     existed, before anyone had edited the one field they cloned it to change.
//
//   - policyid is cleared so the device allocates a new one. Sending the original's id is how you
//     overwrite the rule you meant to copy.
//
//   - It is placed immediately AFTER the source. A clone that appears at the bottom of the table
//     has a different meaning from the rule it came from, because everything between them now
//     matches first — so "same place, one row down" is the only position that preserves intent.
//
// A failed move is not a failed clone: the copy exists and is disabled, so the caller is told the
// position could not be set rather than being left thinking nothing happened.
func (f *FortiClient) ClonePolicy(policyID int, newName string) (*FGPolicy, error) {
	src, err := f.GetPolicy(policyID)
	if err != nil {
		return nil, err
	}

	copyOf := *src
	copyOf.PolicyID = 0 // omitempty → the device allocates
	copyOf.Name = newName
	copyOf.Status = "disable"

	created, err := f.CreatePolicy(copyOf)
	if err != nil {
		return nil, err
	}
	if created != nil && created.PolicyID != 0 {
		if mvErr := f.MovePolicy(created.PolicyID, "after", policyID); mvErr != nil {
			return created, fmt.Errorf("policy %d cloned as %d, but it could not be moved next to "+
				"the original: %w", policyID, created.PolicyID, mvErr)
		}
	}
	return created, nil
}

// BulkResult is one policy's outcome in a bulk operation.
type BulkResult struct {
	PolicyID int    `json:"policy_id"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

// BulkPolicyStatus enables or disables several policies and reports each one separately.
//
// It does NOT stop at the first failure and it does not roll back. A partial result is the honest
// outcome of a sequence of independent writes to a live firewall: rolling back would mean issuing
// more writes to undo writes that succeeded, which is a second chance to get it wrong. The caller
// gets the list and decides.
//
// Sequential on purpose, unlike the parallel reads elsewhere in this package. These are writes to
// one device's config; FortiOS serialises them anyway, and issuing them together makes the order
// in which they land — and therefore which one a `cfg-save automatic` unit persists first —
// something nobody can reason about afterwards.
func (f *FortiClient) BulkPolicyStatus(ids []int, enable bool) []BulkResult {
	out := make([]BulkResult, 0, len(ids))
	for _, id := range ids {
		if err := f.TogglePolicyStatus(id, enable); err != nil {
			out = append(out, BulkResult{PolicyID: id, OK: false, Error: err.Error()})
			continue
		}
		out = append(out, BulkResult{PolicyID: id, OK: true})
	}
	return out
}

// BulkDeletePolicies removes several policies, highest id first.
//
// The ordering matters. Deleting by policyid is stable, but the caller's list came from a table
// the operator was looking at, and deleting from the bottom up means the rows still to be deleted
// keep the sequence positions they had on screen — so a partial failure leaves a table that still
// looks like the one the operator was reading, rather than one that has shifted under them.
func (f *FortiClient) BulkDeletePolicies(ids []int) []BulkResult {
	sorted := make([]int, len(ids))
	copy(sorted, ids)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j] > sorted[i] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	out := make([]BulkResult, 0, len(sorted))
	for _, id := range sorted {
		if err := f.DeletePolicy(id); err != nil {
			out = append(out, BulkResult{PolicyID: id, OK: false, Error: err.Error()})
			continue
		}
		out = append(out, BulkResult{PolicyID: id, OK: true})
	}
	return out
}

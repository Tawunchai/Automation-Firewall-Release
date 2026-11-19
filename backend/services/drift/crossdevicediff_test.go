package drift

import "testing"

// countByAction's partition is what the page's summary line reads — getting "only in A" and "only
// in B" backwards would tell an operator the wrong device is missing an object.

func TestCountByAction(t *testing.T) {
	changes := []DriftChange{
		{Key: "created-on-b", Action: DriftActionCreated},
		{Key: "created-on-b-2", Action: DriftActionCreated},
		{Key: "deleted-vs-a", Action: DriftActionDeleted},
		{Key: "modified-1", Action: DriftActionModified},
		{Key: "modified-2", Action: DriftActionModified},
		{Key: "modified-3", Action: DriftActionModified},
	}

	onlyInA, onlyInB, differs := countByAction(changes)

	// AnalyseConfigDrift is called as (before=A, after=B): an object "created" exists in B but not
	// A, and "deleted" exists in A but not B — see the comment on CompareDevices.
	if onlyInA != 1 {
		t.Errorf("onlyInA = %d, want 1 (the one DriftActionDeleted entry)", onlyInA)
	}
	if onlyInB != 2 {
		t.Errorf("onlyInB = %d, want 2 (the two DriftActionCreated entries)", onlyInB)
	}
	if differs != 3 {
		t.Errorf("differs = %d, want 3 (the three DriftActionModified entries)", differs)
	}
}

func TestCountByAction_Empty(t *testing.T) {
	onlyInA, onlyInB, differs := countByAction(nil)
	if onlyInA != 0 || onlyInB != 0 || differs != 0 {
		t.Errorf("counts on an empty diff = (%d, %d, %d), want all zero", onlyInA, onlyInB, differs)
	}
}

func TestCompareDevices_RefusesComparingADeviceToItself(t *testing.T) {
	// Pure validation — must not need a database to reject this, since the same-device case is the
	// one a caller is most likely to hit by a stale default in a dropdown.
	if _, err := CompareDevices(nil, 1, 1); err == nil {
		t.Error("comparing a device to itself was not rejected")
	}
}

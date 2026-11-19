package services

import "testing"

// applyImpactChange is the part of Impact Preview with real correctness risk — the move case is a
// splice-then-insert, and getting the index arithmetic wrong silently previews the wrong table.
// PreviewPolicyChangeImpact itself (the device I/O + replay) is left to live verification, the same
// way TracePolicyPath's own orchestration is — see fortigate_troubleshoot_live_test.go — while its
// pure core (walkPolicyTable) is unit-tested directly in fortigate_troubleshoot_walk_test.go. This
// file follows the same split.

func pol(id int, name string) FGPolicy {
	return FGPolicy{PolicyID: id, Name: name, SrcIntf: []FGName{{Name: "lan"}}, DstIntf: []FGName{{Name: "wan1"}}}
}

func ids(policies []FGPolicy) []int {
	out := make([]int, len(policies))
	for i, p := range policies {
		out[i] = p.PolicyID
	}
	return out
}

func TestApplyImpactChange_CreateAppendsAtTheEnd(t *testing.T) {
	base := []FGPolicy{pol(1, "a"), pol(2, "b")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactCreate, Policy: pol(0, "new")})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 3 || out[2].Name != "new" {
		t.Fatalf("expected the new policy appended, got %+v", ids(out))
	}
	// The input slice must not be mutated — a caller runs this twice (once for "before" is just the
	// original, but a second unrelated preview reusing the same base slice must not see this one's
	// edit).
	if len(base) != 2 {
		t.Fatalf("base slice was mutated, len=%d", len(base))
	}
}

func TestApplyImpactChange_UpdateReplacesInPlaceByID(t *testing.T) {
	base := []FGPolicy{pol(1, "a"), pol(2, "b"), pol(3, "c")}
	replacement := pol(99, "renamed") // PolicyID in Policy is ignored for update — PolicyID field wins
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactUpdate, PolicyID: 2, Policy: replacement})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 3 {
		t.Fatalf("update must not change the count, got %d", len(out))
	}
	if out[1].PolicyID != 2 || out[1].Name != "renamed" {
		t.Fatalf("expected policy 2 replaced in place, got %+v", out[1])
	}
}

func TestApplyImpactChange_UpdateUnknownPolicyIsAnError(t *testing.T) {
	_, err := applyImpactChange([]FGPolicy{pol(1, "a")}, ImpactPreviewChange{Op: ImpactUpdate, PolicyID: 404})
	if err == nil {
		t.Fatal("expected an error for a policy id that does not exist")
	}
}

func TestApplyImpactChange_DeleteRemovesExactlyOne(t *testing.T) {
	base := []FGPolicy{pol(1, "a"), pol(2, "b"), pol(3, "c")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactDelete, PolicyID: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(out); got[0] != 1 || got[1] != 3 || len(got) != 2 {
		t.Fatalf("expected [1 3], got %v", got)
	}
}

func TestApplyImpactChange_MoveBeforeAnEarlierPolicy(t *testing.T) {
	// 1 2 3 4 5, move 4 to before 2 -> 1 4 2 3 5
	base := []FGPolicy{pol(1, "a"), pol(2, "b"), pol(3, "c"), pol(4, "d"), pol(5, "e")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactMove, PolicyID: 4, Position: "before", RefID: 2})
	if err != nil {
		t.Fatal(err)
	}
	want := []int{1, 4, 2, 3, 5}
	got := ids(out)
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestApplyImpactChange_MoveAfterALaterPolicy(t *testing.T) {
	// 1 2 3 4 5, move 1 to after 3 -> 2 3 1 4 5
	base := []FGPolicy{pol(1, "a"), pol(2, "b"), pol(3, "c"), pol(4, "d"), pol(5, "e")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactMove, PolicyID: 1, Position: "after", RefID: 3})
	if err != nil {
		t.Fatal(err)
	}
	want := []int{2, 3, 1, 4, 5}
	got := ids(out)
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestApplyImpactChange_MoveToItselfIsANoOp(t *testing.T) {
	base := []FGPolicy{pol(1, "a"), pol(2, "b"), pol(3, "c")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactMove, PolicyID: 2, Position: "before", RefID: 2})
	if err != nil {
		t.Fatal(err)
	}
	want := []int{1, 2, 3}
	got := ids(out)
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestApplyImpactChange_MoveUnknownPolicyOrRefIsAnError(t *testing.T) {
	base := []FGPolicy{pol(1, "a"), pol(2, "b")}
	if _, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactMove, PolicyID: 404, RefID: 2}); err == nil {
		t.Error("expected an error for an unknown moved policy")
	}
	if _, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactMove, PolicyID: 1, RefID: 404}); err == nil {
		t.Error("expected an error for an unknown reference policy")
	}
}

func TestApplyImpactChange_DeepCopiesSoTheLiveTableCanNeverBeMutated(t *testing.T) {
	// Policy 1 is untouched by this change — out[0] is still a clone of base[0], and the whole
	// point of applyImpactChange is that a caller can hold both the live table and the proposed one
	// at once (to run walkPolicyTable against each) without one write reaching the other.
	base := []FGPolicy{pol(1, "a"), pol(2, "b")}
	out, err := applyImpactChange(base, ImpactPreviewChange{Op: ImpactUpdate, PolicyID: 2, Policy: pol(2, "renamed")})
	if err != nil {
		t.Fatal(err)
	}
	out[0].SrcIntf[0].Name = "mutated"
	if base[0].SrcIntf[0].Name == "mutated" {
		t.Fatal("mutating the proposed table's untouched policies must not reach the original")
	}
}

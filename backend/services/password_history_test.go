package services

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func hashAt(t *testing.T, password string, cost int) string {
	t.Helper()
	b, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		t.Fatalf("bcrypt at cost %d: %v", cost, err)
	}
	return string(b)
}

// A column written by the old single-hash code holds one bare hash and must still be understood,
// or every user's history would silently read as empty on the first boot after this change.
func TestSplitPasswordHistoryReadsTheOldSingleHashColumn(t *testing.T) {
	old := hashAt(t, "whatever", bcrypt.MinCost)

	got := splitPasswordHistory(old)
	if len(got) != 1 || got[0] != old {
		t.Fatalf("splitPasswordHistory(one bare hash) = %#v, want exactly that hash", got)
	}
	if n := len(splitPasswordHistory("")); n != 0 {
		t.Errorf("splitPasswordHistory(\"\") returned %d entries, want 0", n)
	}
}

func TestPrependPasswordHistoryKeepsNewestNFirst(t *testing.T) {
	existing := []string{"c", "b", "a"}

	got := prependPasswordHistory(existing, "d", 3)
	if len(got) != 3 || got[0] != "d" || got[1] != "c" || got[2] != "b" {
		t.Fatalf("prependPasswordHistory(..., keep=3) = %#v, want [d c b]", got)
	}

	// keep=1 is the old behaviour, and must still be reachable.
	if got := prependPasswordHistory(existing, "d", 1); len(got) != 1 || got[0] != "d" {
		t.Errorf("keep=1 = %#v, want [d]", got)
	}
	// A nonsense value must not switch history off…
	if got := prependPasswordHistory(existing, "d", 0); len(got) != 1 {
		t.Errorf("keep=0 kept %d entries, want the newest one", len(got))
	}
	// …nor make every password change unboundedly expensive.
	long := make([]string, MaxPasswordHistory+10)
	for i := range long {
		long[i] = "h"
	}
	if got := prependPasswordHistory(long, "d", MaxPasswordHistory+10); len(got) != MaxPasswordHistory {
		t.Errorf("keep above the ceiling kept %d entries, want %d", len(got), MaxPasswordHistory)
	}
}

// The reuse check has to look past the most recent password. Comparing against one hash let anyone
// alternate between two passwords forever, which is the whole thing history exists to stop.
func TestMatchesAnyHashLooksPastTheNewestEntry(t *testing.T) {
	hashes := []string{
		hashAt(t, "newest", bcrypt.MinCost),
		hashAt(t, "middle", bcrypt.MinCost),
		hashAt(t, "oldest", bcrypt.MinCost),
	}

	for _, pw := range []string{"newest", "middle", "oldest"} {
		if !matchesAnyHash(pw, hashes) {
			t.Errorf("matchesAnyHash(%q) = false, want true — it is in the kept history", pw)
		}
	}
	if matchesAnyHash("never-used-before", hashes) {
		t.Error("matchesAnyHash matched a password that is not in the history")
	}
	if matchesAnyHash("oldest", hashes[:1]) {
		t.Error("matchesAnyHash looked outside the slice it was given")
	}
}

// A whole round trip through the stored-column format, which is where a depth of N either survives
// or quietly collapses back to 1.
func TestPasswordHistoryRoundTripKeepsFive(t *testing.T) {
	stored := ""
	for _, pw := range []string{"pw1", "pw2", "pw3", "pw4", "pw5", "pw6"} {
		stored = joinPasswordHistory(
			prependPasswordHistory(splitPasswordHistory(stored), hashAt(t, pw, bcrypt.MinCost), 5))
	}

	kept := splitPasswordHistory(stored)
	if len(kept) != 5 {
		t.Fatalf("kept %d hashes, want 5", len(kept))
	}
	for _, pw := range []string{"pw2", "pw3", "pw4", "pw5", "pw6"} {
		if !matchesAnyHash(pw, kept) {
			t.Errorf("%q fell out of a 5-deep history", pw)
		}
	}
	if matchesAnyHash("pw1", kept) {
		t.Error("pw1 should have been pushed out of a 5-deep history")
	}
}

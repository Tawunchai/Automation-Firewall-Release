package services

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// The other half of platform's TestExistingCost10HashesStillVerify: the reuse check must keep
// matching a history entry written at the OLD bcrypt cost. It compares with the same
// platform.CheckPasswordHash, which reads the cost out of the hash rather than from the constant,
// so raising the constant to 12 cannot silently stop an old entry from counting as a reuse — which
// would let somebody set their previous password again and be told it was new.
func TestMatchesAnyHashAcceptsACost10Entry(t *testing.T) {
	legacy, err := bcrypt.GenerateFromPassword([]byte("stored-before-the-change"), 10)
	if err != nil {
		t.Fatalf("bcrypt at cost 10: %v", err)
	}
	if cost, _ := bcrypt.Cost(legacy); cost != 10 {
		t.Fatalf("fixture is cost %d, not the cost-10 hash this test is about", cost)
	}
	if !matchesAnyHash("stored-before-the-change", []string{string(legacy)}) {
		t.Error("a cost-10 history entry stopped matching")
	}
	if matchesAnyHash("a-different-password", []string{string(legacy)}) {
		t.Error("matchesAnyHash matched a password that is not in the history")
	}
}

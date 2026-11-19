package platform

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHashPasswordUsesCost12(t *testing.T) {
	hash, err := HashPassword("a-password-to-store")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatalf("bcrypt.Cost: %v", err)
	}
	if cost != 12 {
		t.Errorf("new hashes are written at cost %d, want 12 (bcrypt.DefaultCost is 10)", cost)
	}
	if !CheckPasswordHash("a-password-to-store", hash) {
		t.Error("a hash this package just wrote does not verify")
	}
}

// Everyone already in app_users was hashed at cost 10. Raising the cost must not lock them out:
// bcrypt stores its parameters inside the hash, and CompareHashAndPassword reads them from there
// rather than from the constant, so the two costs coexist and only new writes move to 12.
func TestExistingCost10HashesStillVerify(t *testing.T) {
	legacy, err := bcrypt.GenerateFromPassword([]byte("stored-before-the-change"), 10)
	if err != nil {
		t.Fatalf("bcrypt at cost 10: %v", err)
	}
	if cost, _ := bcrypt.Cost(legacy); cost != 10 {
		t.Fatalf("fixture is cost %d, not the cost-10 hash this test is about", cost)
	}

	if !CheckPasswordHash("stored-before-the-change", string(legacy)) {
		t.Fatal("an existing cost-10 hash no longer verifies — every pre-existing user is locked out")
	}
	if CheckPasswordHash("the-wrong-password", string(legacy)) {
		t.Error("CheckPasswordHash accepted the wrong password against a cost-10 hash")
	}
}

package platform

import (
	"os"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"network_automation/entity"
)

// A used OTP has to actually go.
//
// entity.OTP embeds gorm.Model, so a plain Delete under GORM's default scope is an UPDATE of
// deleted_at: the row stayed in the table forever, Code and all. Every password reset, every
// sign-up and every email second factor left one behind, so the otps table grew into a permanent
// list of six-digit codes against email addresses — and the code that generated it says, in its
// own doc comment, that it "deletes any existing OTP for the email".
//
// This is exactly the class of bug retention_db_test.go describes as impossible to catch without a
// server: an UPDATE of deleted_at succeeds, GORM reports success, and no reader sees the row. Only
// an Unscoped look at the table tells the truth.
//
// Skipped unless OTP_DB_TEST_DSN names a database it may freely create tables in and empty. Point
// it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55441:5432 -e POSTGRES_PASSWORD=test --name otp-pg postgres:16-alpine
//	OTP_DB_TEST_DSN="host=localhost port=55441 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run OTP -v
//	docker rm -f otp-pg

func otpTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("OTP_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("OTP_DB_TEST_DSN not set — see the note at the top of otp_db_test.go")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.AutoMigrate(&entity.OTP{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Exec("TRUNCATE TABLE otps RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return db
}

// countOTPRows reports how many rows really exist for an address, soft-deleted ones included.
func countOTPRows(t *testing.T, db *gorm.DB, email string) int64 {
	t.Helper()
	var n int64
	if err := db.Unscoped().Model(&entity.OTP{}).Where("email = ?", email).Count(&n).Error; err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return n
}

const otpTestEmail = "otp-rows@test.invalid"

func TestSaveOTPLeavesNoSpentCodeBehind(t *testing.T) {
	db := otpTestDB(t)

	var codes []string
	for i := 0; i < 4; i++ {
		code, err := SaveOTP(db, otpTestEmail)
		if err != nil {
			t.Fatalf("SaveOTP #%d: %v", i+1, err)
		}
		codes = append(codes, code)

		// One row per address, every time — not one more row per request.
		if n := countOTPRows(t, db, otpTestEmail); n != 1 {
			t.Fatalf("after %d requests the table holds %d row(s) for %s, want 1: the spent codes "+
				"are only soft-deleted and stay readable forever", i+1, n, otpTestEmail)
		}
	}

	// And none of the superseded codes is still retrievable. This is the assertion that matters:
	// an attacker with database read access was being handed every code this address was ever sent.
	for _, spent := range codes[:len(codes)-1] {
		var n int64
		if err := db.Unscoped().Model(&entity.OTP{}).
			Where("email = ? AND code = ?", otpTestEmail, spent).Count(&n).Error; err != nil {
			t.Fatalf("look for a spent code: %v", err)
		}
		if n != 0 {
			t.Errorf("a superseded OTP is still in the table")
		}
	}

	// The newest one is the one that works, and it is the only one there.
	var live entity.OTP
	if err := db.Where("email = ?", otpTestEmail).First(&live).Error; err != nil {
		t.Fatalf("read the live OTP: %v", err)
	}
	if live.Code != codes[len(codes)-1] {
		t.Errorf("the stored code is %q, want the one just issued", live.Code)
	}
	if live.Verified {
		t.Error("a freshly issued OTP is already marked verified")
	}
	if live.ExpiresAt == 0 {
		t.Error("the OTP was stored with no expiry, so it never ages out")
	}
}

// Clearing one address must not clear another's. Unscoped widens what a Delete removes, and it
// would be easy to widen the WHERE with it.
func TestSaveOTPOnlyClearsTheAddressItWasAskedAbout(t *testing.T) {
	db := otpTestDB(t)

	const other = "someone-else@test.invalid"
	if _, err := SaveOTP(db, other); err != nil {
		t.Fatalf("SaveOTP for the other address: %v", err)
	}
	theirs, err := SaveOTP(db, otpTestEmail)
	if err != nil {
		t.Fatalf("SaveOTP: %v", err)
	}
	_ = theirs

	if n := countOTPRows(t, db, other); n != 1 {
		t.Fatalf("the other address now has %d row(s), want 1 — one user's request wiped another's code", n)
	}
	if n := countOTPRows(t, db, otpTestEmail); n != 1 {
		t.Fatalf("the requesting address has %d row(s), want 1", n)
	}
}

package backupcodes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// Backup codes are the way back in when someone loses their authenticator, so they are the last
// door into an account. This package had no test file at all.
//
// What matters about a backup code is not the HTTP status: it is that the code is shown once and
// stored only as a hash, that generating a new set really invalidates the old one, and that the
// count the user sees matches what the database would accept.
//
// Skipped unless BACKUPCODES_DB_TEST_DSN names a database it may freely create tables in and
// empty. Point it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55437:5432 -e POSTGRES_PASSWORD=test --name totp-pg postgres:16-alpine
//	BACKUPCODES_DB_TEST_DSN="host=localhost port=55437 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/backupcodes/ -v

func init() { gin.SetMode(gin.TestMode) }

// codeShape is the format the user is shown: eight characters as XXXX-XXXX, from an alphabet that
// deliberately drops 0, O, I and 1 so a handwritten code can be read back.
var codeShape = regexp.MustCompile(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$`)

func backupTestDB(t *testing.T) (*gorm.DB, uint) {
	t.Helper()

	dsn := os.Getenv("BACKUPCODES_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("BACKUPCODES_DB_TEST_DSN not set — see the note at the top of backupcodes_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	// ActivityLog: Generate writes one from a goroutine, so the table has to exist or that write
	// errors into the test output for no reason.
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.UserTOTP{},
		&entity.UserBackupCode{}, &entity.ActivityLog{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	for _, table := range []string{"user_backup_codes", "user_totps", "activity_logs", "app_users", "app_roles"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	role := entity.AppRole{Role: "user"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	user := entity.AppUser{
		Email: "backup-user@test.invalid", Password: "not-a-real-hash",
		FirstName: "Test", LastName: "User", AppRoleID: role.ID,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return db, user.ID
}

// verifiedTOTP is the precondition Generate enforces: codes only exist for an account that has
// already proved it holds a TOTP secret.
func verifiedTOTP(t *testing.T, db *gorm.DB, userID uint) {
	t.Helper()
	if err := db.Create(&entity.UserTOTP{
		AppUserID: userID, Secret: "JBSWY3DPEHPK3PXP", IsVerified: true,
	}).Error; err != nil {
		t.Fatalf("seed a verified TOTP enrolment: %v", err)
	}
}

func as(method, target string, userID interface{}, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	if body != "" {
		c.Request = httptest.NewRequest(method, target, strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
	} else {
		c.Request = httptest.NewRequest(method, target, nil)
	}
	if userID != nil {
		c.Set("user_id", userID)
	}
	return c, rec
}

// generate runs the handler and returns the codes it showed the user.
func generate(t *testing.T, userID uint) []string {
	t.Helper()
	c, rec := as(http.MethodPost, "/backup-codes/generate", userID, "")
	Generate(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("Generate = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Codes []string `json:"codes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	return body.Codes
}

// ── who is asking ───────────────────────────────────────────────────────────

func TestBothHandlersRefuseARequestWithNoUser(t *testing.T) {
	backupTestDB(t)

	for name, h := range map[string]gin.HandlerFunc{"Generate": Generate, "GetStatus": GetStatus} {
		t.Run(name, func(t *testing.T) {
			c, rec := as(http.MethodPost, "/backup-codes/x", nil, "")
			h(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s answered %d, want 401: %s", name, rec.Code, rec.Body.String())
			}
		})
	}
}

// This package's getUserID accepts uint and float64 but NOT int, while the identical helper in
// controller/totp also accepts int. The two were written separately and drifted.
//
// It is harmless only for as long as the middleware never puts an int there: the day it does, a
// user would be able to reach their TOTP settings and be told "unauthorized" by this endpoint,
// which reads as a broken account rather than as a type mismatch. Pinned here so the difference is
// a recorded fact and not a surprise.
func TestGetUserIDAcceptsUintAndFloatButNotInt(t *testing.T) {
	cases := []struct {
		name   string
		set    interface{}
		wantID uint
		wantOK bool
	}{
		{"uint", uint(7), 7, true},
		{"float64 from JSON", float64(7), 7, true},
		{"int is NOT accepted here, unlike controller/totp", int(7), 0, false},
		{"zero is nobody", uint(0), 0, false},
		{"a string is not an id", "7", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("user_id", tc.set)
			gotID, gotOK := getUserID(c)
			if gotID != tc.wantID || gotOK != tc.wantOK {
				t.Fatalf("getUserID = (%d, %v), want (%d, %v)", gotID, gotOK, tc.wantID, tc.wantOK)
			}
		})
	}
}

// ── the precondition ────────────────────────────────────────────────────────

// Codes are a way around TOTP, so they must not exist for an account that has no TOTP: otherwise
// "generate backup codes" would be a way to create a second password nobody asked for.
func TestGenerateRefusesAnAccountWithoutVerifiedTOTP(t *testing.T) {
	db, userID := backupTestDB(t)

	// No enrolment at all.
	c, rec := as(http.MethodPost, "/backup-codes/generate", userID, "")
	Generate(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("with no TOTP: %d, want 400: %s", rec.Code, rec.Body.String())
	}

	// An enrolment that was started but never verified is not good enough either.
	if err := db.Create(&entity.UserTOTP{
		AppUserID: userID, Secret: "JBSWY3DPEHPK3PXP", IsVerified: false,
	}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	c2, rec2 := as(http.MethodPost, "/backup-codes/generate", userID, "")
	Generate(c2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("with an unverified TOTP: %d, want 400: %s", rec2.Code, rec2.Body.String())
	}

	var stored int64
	db.Model(&entity.UserBackupCode{}).Where("app_user_id = ?", userID).Count(&stored)
	if stored != 0 {
		t.Errorf("%d code(s) were stored for an account with no verified TOTP", stored)
	}
}

// ── what the user is given ──────────────────────────────────────────────────

func TestGenerateShowsEightDistinctCodesInTheDocumentedShape(t *testing.T) {
	db, userID := backupTestDB(t)
	verifiedTOTP(t, db, userID)

	codes := generate(t, userID)

	if len(codes) != 8 {
		t.Fatalf("got %d codes, want 8", len(codes))
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if !codeShape.MatchString(code) {
			t.Errorf("code %q is not XXXX-XXXX from the reduced alphabet", code)
		}
		if seen[code] {
			t.Errorf("code %q was handed out twice in one set", code)
		}
		seen[code] = true
	}
}

// The one thing that must never be true: a code sitting in the database in a readable form. Anyone
// who can read the table could otherwise sign in as the user without the password or the
// authenticator.
func TestGeneratedCodesAreStoredOnlyAsHashes(t *testing.T) {
	db, userID := backupTestDB(t)
	verifiedTOTP(t, db, userID)

	codes := generate(t, userID)

	var rows []entity.UserBackupCode
	if err := db.Where("app_user_id = ?", userID).Find(&rows).Error; err != nil {
		t.Fatalf("read the codes: %v", err)
	}
	if len(rows) != 8 {
		t.Fatalf("%d rows stored, want 8", len(rows))
	}

	for _, code := range codes {
		plain := strings.ReplaceAll(code, "-", "")
		for _, row := range rows {
			if row.CodeHash == plain || strings.Contains(row.CodeHash, plain) {
				t.Fatalf("code %q is readable in the database (%q)", code, row.CodeHash)
			}
		}
	}

	// And the hash has to be the hash OF that code — stored safely but unusable would be just as
	// broken as stored in the clear.
	matched := 0
	for _, code := range codes {
		plain := strings.ReplaceAll(code, "-", "")
		for _, row := range rows {
			if platform.CheckPasswordHash(plain, row.CodeHash) {
				matched++
				break
			}
		}
	}
	if matched != len(codes) {
		t.Errorf("only %d of %d codes the user was shown verify against a stored hash", matched, len(codes))
	}
}

// Generating a new set is how a user reacts to a leaked sheet of codes, so the previous set has to
// stop counting. GetStatus is the user's only window onto that.
func TestGeneratingAgainReplacesTheOldSetRatherThanAddingToIt(t *testing.T) {
	db, userID := backupTestDB(t)
	verifiedTOTP(t, db, userID)

	first := generate(t, userID)
	second := generate(t, userID)

	if len(second) != 8 {
		t.Fatalf("the second set has %d codes, want 8", len(second))
	}

	// What the user sees: still eight, not sixteen.
	c, rec := as(http.MethodGet, "/backup-codes/status", userID, "")
	GetStatus(c)
	var st struct {
		Total     int64 `json:"total"`
		Used      int64 `json:"used"`
		Remaining int64 `json:"remaining"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("status body: %v", err)
	}
	if st.Total != 8 || st.Remaining != 8 || st.Used != 0 {
		t.Fatalf("after regenerating, status reads total=%d used=%d remaining=%d; want 8/0/8",
			st.Total, st.Used, st.Remaining)
	}

	// And no code from the first sheet still verifies against a live row.
	var live []entity.UserBackupCode
	if err := db.Where("app_user_id = ?", userID).Find(&live).Error; err != nil {
		t.Fatalf("read live codes: %v", err)
	}
	for _, code := range first {
		plain := strings.ReplaceAll(code, "-", "")
		for _, row := range live {
			if platform.CheckPasswordHash(plain, row.CodeHash) {
				t.Fatalf("a code from the replaced sheet (%q) still matches a live row", code)
			}
		}
	}

	// Recorded, not asserted as desirable: the replaced rows are SOFT-deleted, so eight bcrypt
	// hashes of invalidated codes stay in the table for good. The counts above are right because
	// GORM's default scope hides them, and the codes cannot be used. It is the same retention
	// smell Phase 2 lists for used OTPs (services/otp.go keeps those too) — noted here so the fix
	// covers both tables when someone gets to it.
	var all int64
	db.Unscoped().Model(&entity.UserBackupCode{}).Where("app_user_id = ?", userID).Count(&all)
	if all != 16 {
		t.Logf("note: %d total rows including soft-deleted (expected 16 — 8 live + 8 invalidated)", all)
	}
}

// ── the count the user acts on ──────────────────────────────────────────────

func TestStatusCountsAUsedCodeAsSpent(t *testing.T) {
	db, userID := backupTestDB(t)
	verifiedTOTP(t, db, userID)
	generate(t, userID)

	// Spend two, the way a sign-in with a backup code does.
	var rows []entity.UserBackupCode
	if err := db.Where("app_user_id = ?", userID).Limit(2).Find(&rows).Error; err != nil {
		t.Fatalf("read codes: %v", err)
	}
	now := time.Now()
	for _, row := range rows {
		if err := db.Model(&entity.UserBackupCode{}).Where("id = ?", row.ID).
			Update("used_at", now).Error; err != nil {
			t.Fatalf("mark used: %v", err)
		}
	}

	c, rec := as(http.MethodGet, "/backup-codes/status", userID, "")
	GetStatus(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var st struct {
		Total     int64 `json:"total"`
		Used      int64 `json:"used"`
		Remaining int64 `json:"remaining"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("body: %v", err)
	}
	if st.Total != 8 || st.Used != 2 || st.Remaining != 6 {
		t.Fatalf("status reads total=%d used=%d remaining=%d; want 8/2/6", st.Total, st.Used, st.Remaining)
	}
}

func TestStatusIsZeroForAUserWhoNeverGeneratedAny(t *testing.T) {
	_, userID := backupTestDB(t)

	c, rec := as(http.MethodGet, "/backup-codes/status", userID, "")
	GetStatus(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"total":0`) ||
		!strings.Contains(rec.Body.String(), `"remaining":0`) {
		t.Fatalf("a user with no codes reads as %s", rec.Body.String())
	}
}

// ── the generator itself ────────────────────────────────────────────────────

// generateCode is the only source of randomness here. A repeat across a large sample, or a
// character outside the reduced alphabet, would both be serious.
func TestGenerateCodeDrawsFromTheReducedAlphabetAndDoesNotRepeat(t *testing.T) {
	const n = 500
	seen := make(map[string]bool, n)
	allowed := codeShape.String()

	for i := 0; i < n; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		if len(code) != codeLen {
			t.Fatalf("code %q is %d characters, want %d", code, len(code), codeLen)
		}
		for _, r := range code {
			if !strings.ContainsRune(charset, r) {
				t.Fatalf("code %q contains %q, which is not in the alphabet (%s)", code, r, allowed)
			}
		}
		if seen[code] {
			t.Fatalf("generateCode repeated %q within %d draws", code, n)
		}
		seen[code] = true
	}
}

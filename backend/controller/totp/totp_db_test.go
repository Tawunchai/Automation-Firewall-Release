package totp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	otplib "github.com/pquerna/otp/totp"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services/platform"
)

// The TOTP handlers, against a real database and a real authenticator.
//
// toggle_test.go covers the toggle DECISION, but it does so against a copy of the logic
// (`resolve`), which is why this package reported 0.0% coverage while having a test file: nothing
// here had ever run a handler. These tests run the handlers.
//
// Two of them are regression tests for bugs whose fixes are only visible in the database — the
// Unscoped deletes in SetupInit and Disable. UserTOTP embeds gorm.Model, so a soft delete leaves
// the row in place still holding the unique index on app_user_id; without Unscoped, setting up TOTP
// a second time fails forever with a 500. A test that only reads the HTTP response cannot see that,
// so these go and look at the row.
//
// Skipped unless TOTP_DB_TEST_DSN names a database it may freely create tables in and empty. Point
// it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55437:5432 -e POSTGRES_PASSWORD=test --name totp-pg postgres:16-alpine
//	TOTP_DB_TEST_DSN="host=localhost port=55437 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/totp/ -v

func init() { gin.SetMode(gin.TestMode) }

const totpTestEmail = "totp-user@test.invalid"

// totpTestDB brings up the schema these handlers touch and returns the user they act for.
func totpTestDB(t *testing.T) (*gorm.DB, uint) {
	t.Helper()

	dsn := os.Getenv("TOTP_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("TOTP_DB_TEST_DSN not set — see the note at the top of totp_db_test.go")
	}
	t.Setenv("DATABASE_URL", dsn)
	// UserTOTP.Secret is encrypted at rest, so SetupInit needs a key to write one. This fixture
	// value protects nothing — the same pattern as config/seed_db_test.go.
	t.Setenv("CRED_ENC_KEY", "unit-test-key-not-a-real-secret-0123456789")
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	// ActivityLog is here because nothing in this package writes it, but a sibling handler does it
	// from a goroutine; migrating it keeps a stray write from erroring into the test's output.
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.UserTOTP{},
		&entity.SystemConfig{}, &entity.ActivityLog{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	for _, table := range []string{"user_totps", "system_configs", "activity_logs", "app_users", "app_roles"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	role := entity.AppRole{Role: "user"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	user := entity.AppUser{
		Email: totpTestEmail, Password: "not-a-real-hash",
		FirstName: "Test", LastName: "User", AppRoleID: role.ID,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return db, user.ID
}

// as builds a request acting as one user in one role. userID of 0 means "no user_id in the
// context at all", which is how an unauthenticated request reaches a handler.
func as(method, target string, userID uint, role, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	if reader != nil {
		c.Request = httptest.NewRequest(method, target, reader)
		c.Request.Header.Set("Content-Type", "application/json")
	} else {
		c.Request = httptest.NewRequest(method, target, nil)
	}
	if userID != 0 {
		c.Set("user_id", userID)
	}
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

// currentCode is the code the user's authenticator app would be showing right now.
func currentCode(t *testing.T, secret string) string {
	t.Helper()
	code, err := otplib.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate a valid code: %v", err)
	}
	return code
}

func storedTOTP(t *testing.T, db *gorm.DB, userID uint) entity.UserTOTP {
	t.Helper()
	var row entity.UserTOTP
	if err := db.Where("app_user_id = ?", userID).First(&row).Error; err != nil {
		t.Fatalf("read the TOTP row: %v", err)
	}
	return row
}

// enrolledSecret is the base32 seed the user's authenticator holds — i.e. the stored column put
// back through the at-rest decryption. Tests that need to GENERATE a code use this; tests that are
// checking what the column itself contains use storedTOTP().Secret.
func enrolledSecret(t *testing.T, db *gorm.DB, userID uint) string {
	t.Helper()
	secret, err := platform.TOTPSecret(storedTOTP(t, db, userID))
	if err != nil {
		t.Fatalf("decrypt the stored TOTP secret: %v", err)
	}
	if secret == "" {
		t.Fatal("the stored enrolment decrypts to an empty secret")
	}
	return secret
}

// ── who is asking ───────────────────────────────────────────────────────────

// Every handler in this package starts at getUserID, and a request with no user must never reach a
// database read. 401, not 500 and not a lookup for user 0.
func TestEveryHandlerRefusesARequestWithNoUser(t *testing.T) {
	totpTestDB(t)

	for name, h := range map[string]gin.HandlerFunc{
		"GetStatus":     GetStatus,
		"SetupInit":     SetupInit,
		"SetupVerify":   SetupVerify,
		"ToggleEnabled": ToggleEnabled,
		"Disable":       Disable,
	} {
		t.Run(name, func(t *testing.T) {
			c, rec := as(http.MethodPost, "/totp/x", 0, "", `{"code":"123456"}`)
			h(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s answered %d, want 401: %s", name, rec.Code, rec.Body.String())
			}
		})
	}
}

// The middleware may hand the id over as any of three types depending on where it came from, and
// a zero is not a user.
func TestGetUserIDAcceptsEveryShapeTheMiddlewareUses(t *testing.T) {
	cases := []struct {
		name   string
		set    interface{}
		wantID uint
		wantOK bool
	}{
		{"uint", uint(7), 7, true},
		{"int", int(7), 7, true},
		{"float64 from JSON", float64(7), 7, true},
		{"zero uint is nobody", uint(0), 0, false},
		{"zero int is nobody", int(0), 0, false},
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

	t.Run("missing entirely", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		if id, ok := getUserID(c); ok || id != 0 {
			t.Fatalf("getUserID = (%d, %v), want (0, false)", id, ok)
		}
	})
}

// ── setting it up ───────────────────────────────────────────────────────────

func TestSetupInitStoresAnUnverifiedEnrolment(t *testing.T) {
	db, userID := totpTestDB(t)

	c, rec := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body SetupInitResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not the documented shape: %v (%s)", err, rec.Body.String())
	}
	if body.QRImage == "" {
		t.Error("no QR image was returned, so there is nothing for the user to scan")
	}

	row := storedTOTP(t, db, userID)
	if row.Secret == "" {
		t.Error("the enrolment was stored without a secret")
	}
	// At rest it must be CIPHERTEXT. A seed in the clear hands anyone with database read access
	// this account's second factor forever, and unlike a password it is never rotated.
	seed := enrolledSecret(t, db, userID)
	if row.Secret == seed {
		t.Error("the TOTP seed is stored in plaintext")
	}
	if !strings.HasPrefix(row.Secret, "v") || !strings.Contains(row.Secret, ":") {
		t.Errorf("the stored secret does not carry the versioned ciphertext prefix: %q", row.Secret)
	}
	if row.LastTOTPStep != 0 {
		t.Errorf("a brand-new enrolment already has a spent step (%d)", row.LastTOTPStep)
	}
	if row.IsVerified {
		t.Error("a brand-new enrolment is already verified — nobody has proved they hold the secret yet")
	}
}

// The bug this is here for: UserTOTP embeds gorm.Model, so the old row survived a soft delete and
// kept the unique index on app_user_id. setup-init therefore worked exactly ONCE per user and
// every attempt after that answered 500. The fix is the Unscoped delete; this proves it, and it
// would fail again the moment someone drops Unscoped.
func TestSetupInitCanBeRunAgainAndReplacesTheOldSecret(t *testing.T) {
	db, userID := totpTestDB(t)

	c1, rec1 := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first setup-init = %d: %s", rec1.Code, rec1.Body.String())
	}
	first := storedTOTP(t, db, userID).Secret
	firstSeed := enrolledSecret(t, db, userID)

	c2, rec2 := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second setup-init = %d, want 200 — the soft-deleted row is holding the unique index again: %s",
			rec2.Code, rec2.Body.String())
	}

	// Compared as SEEDS, not as stored columns: every encryption uses a fresh nonce, so two
	// ciphertexts of the same seed differ and a column comparison would pass even if the user had
	// been handed the same secret back.
	if enrolledSecret(t, db, userID) == firstSeed {
		t.Error("the second setup kept the first secret, so a user cannot actually re-enrol")
	}

	// The old secret must be GONE, not soft-deleted: it is a live credential until it is really
	// removed, and the handler's own comment says so.
	var leftovers int64
	if err := db.Unscoped().Model(&entity.UserTOTP{}).
		Where("app_user_id = ? AND secret = ?", userID, first).Count(&leftovers).Error; err != nil {
		t.Fatalf("count leftovers: %v", err)
	}
	if leftovers != 0 {
		t.Errorf("the previous TOTP secret is still in the table (%d row(s)) — a soft delete does not remove a credential", leftovers)
	}
}

func TestSetupInitRefusesAUserThatIsNotThere(t *testing.T) {
	totpTestDB(t)

	c, rec := as(http.MethodPost, "/totp/setup-init", 9999, "user", "")
	SetupInit(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// ── proving you hold the secret ─────────────────────────────────────────────

func TestSetupVerifyAcceptsTheRealCodeAndTurnsTOTPOn(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	secret := enrolledSecret(t, db, userID)

	c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user",
		`{"code":"`+currentCode(t, secret)+`"}`)
	SetupVerify(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// Both flags, in the database. The response says both are true; login reads
	// `is_verified = true AND is_enabled = true`, so a response that disagreed with the row would
	// show "TOTP enabled" on a screen while login quietly skipped it — the exact bug
	// toggle_test.go was written for.
	row := storedTOTP(t, db, userID)
	if !row.IsVerified || !row.IsEnabled {
		t.Fatalf("stored is_verified=%v is_enabled=%v, want both true", row.IsVerified, row.IsEnabled)
	}
}

func TestSetupVerifyRefusesAForgedCode(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)

	for _, code := range []string{"000000", "123456", "999999"} {
		c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+code+`"}`)
		SetupVerify(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("code %q answered %d, want 400: %s", code, rec.Code, rec.Body.String())
		}
	}

	if row := storedTOTP(t, db, userID); row.IsVerified {
		t.Fatal("a refused code still marked the enrolment verified")
	}
}

// A code of the wrong SHAPE must not reach the validator at all — the binding is `len=6`.
func TestSetupVerifyRefusesACodeOfTheWrongShape(t *testing.T) {
	_, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)

	for _, body := range []string{`{"code":""}`, `{"code":"12345"}`, `{"code":"1234567"}`, `{}`, ``} {
		c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user", body)
		SetupVerify(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q answered %d, want 400: %s", body, rec.Code, rec.Body.String())
		}
	}
}

func TestSetupVerifyRefusesAUserWhoNeverStarted(t *testing.T) {
	_, userID := totpTestDB(t)

	c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"123456"}`)
	SetupVerify(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// ── the button that has to do what it says ──────────────────────────────────

// toggle_test.go proves the DECISION against a copy of it. This proves the handler and the row,
// which is where the original bug actually lived: the screen said "Enable", the endpoint toggled,
// and a verified user ended up with is_enabled=false and no TOTP prompt at login.
func TestToggleEnabledObeysTheButtonAndStoresIt(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	secret := enrolledSecret(t, db, userID)
	cv, _ := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+currentCode(t, secret)+`"}`)
	SetupVerify(cv)

	cases := []struct {
		name string
		body string
		want bool
	}{
		{"explicit disable, from enabled", `{"enabled":false}`, false},
		{"explicit disable again is still disabled", `{"enabled":false}`, false},
		{"explicit enable, from disabled", `{"enabled":true}`, true},
		{"explicit enable again is still enabled", `{"enabled":true}`, true},
		{"no body toggles", ``, false},
		{"no body toggles back", ``, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := as(http.MethodPatch, "/totp/toggle-enabled", userID, "user", tc.body)
			ToggleEnabled(c)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
			}

			var body struct {
				IsEnabled bool `json:"is_enabled"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			if body.IsEnabled != tc.want {
				t.Errorf("response says is_enabled=%v, want %v", body.IsEnabled, tc.want)
			}
			// And the row, which is what login reads. `is_enabled` is `gorm:"default:true"`, so a
			// handler that wrote it with Create instead of Update could not store false at all.
			if got := storedTOTP(t, db, userID).IsEnabled; got != tc.want {
				t.Errorf("stored is_enabled=%v, want %v — the response and the database disagree", got, tc.want)
			}
		})
	}
}

func TestToggleEnabledRefusesAnEnrolmentThatWasNeverVerified(t *testing.T) {
	_, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)

	c, rec := as(http.MethodPatch, "/totp/toggle-enabled", userID, "user", `{"enabled":true}`)
	ToggleEnabled(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — an unverified enrolment is not something to switch on: %s",
			rec.Code, rec.Body.String())
	}
}

// ── removing it ─────────────────────────────────────────────────────────────

// "Disable" is documented as deleting the secret. A soft delete would leave the secret in the
// table AND keep the unique index taken, so the user could never set TOTP up again.
func TestDisableReallyRemovesTheSecret(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)

	c, rec := as(http.MethodDelete, "/totp/disable", userID, "user", "")
	Disable(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var left int64
	if err := db.Unscoped().Model(&entity.UserTOTP{}).
		Where("app_user_id = ?", userID).Count(&left).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Errorf("%d TOTP row(s) survived — the secret is still there and the unique index is still taken", left)
	}

	// And the user can enrol again, which is the whole point.
	c2, rec2 := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c2)
	if rec2.Code != http.StatusOK {
		t.Errorf("re-enrolling after Disable answered %d: %s", rec2.Code, rec2.Body.String())
	}
}

// ── status ──────────────────────────────────────────────────────────────────

func TestGetStatusReportsWhatIsActuallyStored(t *testing.T) {
	db, userID := totpTestDB(t)

	// Nothing set up at all.
	c, rec := as(http.MethodGet, "/totp/status", userID, "user", "")
	GetStatus(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var before TOTPStatusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &before); err != nil {
		t.Fatalf("body: %v", err)
	}
	if before.IsVerified || before.IsEnabled {
		t.Errorf("a user with no enrolment reads as verified=%v enabled=%v", before.IsVerified, before.IsEnabled)
	}

	// Enrolled and verified.
	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	secret := enrolledSecret(t, db, userID)
	cv, _ := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+currentCode(t, secret)+`"}`)
	SetupVerify(cv)

	c2, rec2 := as(http.MethodGet, "/totp/status", userID, "user", "")
	GetStatus(c2)
	var after TOTPStatusResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &after); err != nil {
		t.Fatalf("body: %v", err)
	}
	if !after.IsVerified || !after.IsEnabled {
		t.Errorf("after verifying, status reads verified=%v enabled=%v", after.IsVerified, after.IsEnabled)
	}
}

// ── the master switch ───────────────────────────────────────────────────────

// The global switch decides whether login demands a code from anyone, so it is admin-only. The
// refusal has to come from the server: a non-admin who can flip it can turn 2FA off for everybody.
func TestTheGlobalSwitchIsAdminOnly(t *testing.T) {
	_, userID := totpTestDB(t)

	for _, role := range []string{"user", "operator", "readonly", ""} {
		t.Run("role="+role, func(t *testing.T) {
			cg, recg := as(http.MethodGet, "/totp/global", userID, role, "")
			GetGlobal(cg)
			if recg.Code != http.StatusForbidden {
				t.Errorf("GetGlobal as %q answered %d, want 403: %s", role, recg.Code, recg.Body.String())
			}

			ct, rect := as(http.MethodPatch, "/totp/global-toggle", userID, role, "")
			ToggleGlobal(ct)
			if rect.Code != http.StatusForbidden {
				t.Errorf("ToggleGlobal as %q answered %d, want 403: %s", role, rect.Code, rect.Body.String())
			}
		})
	}
}

func TestAnAdminCanTurnTheGlobalSwitchOnAndOff(t *testing.T) {
	db, userID := totpTestDB(t)

	// With no row at all the switch reads off, and the first toggle has to CREATE the row rather
	// than fail — this is the branch an install that never touched 2FA takes.
	cg, recg := as(http.MethodGet, "/totp/global", userID, "admin", "")
	GetGlobal(cg)
	if recg.Code != http.StatusOK || !strings.Contains(recg.Body.String(), `"enabled":false`) {
		t.Fatalf("with no stored setting the switch reads %d %s, want enabled:false", recg.Code, recg.Body.String())
	}

	for _, want := range []bool{true, false, true} {
		c, rec := as(http.MethodPatch, "/totp/global-toggle", userID, "admin", "")
		ToggleGlobal(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
		}

		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("body: %v", err)
		}
		if body.Enabled != want {
			t.Fatalf("toggle reported enabled=%v, want %v", body.Enabled, want)
		}

		var cfg entity.SystemConfig
		if err := db.Where("key = ?", "totp_global_enabled").First(&cfg).Error; err != nil {
			t.Fatalf("the setting was not stored: %v", err)
		}
		if (cfg.Value == "true") != want {
			t.Fatalf("stored value %q disagrees with the answer %v", cfg.Value, want)
		}
	}

	// Exactly one row, however many times it was flipped.
	var rows int64
	db.Model(&entity.SystemConfig{}).Where("key = ?", "totp_global_enabled").Count(&rows)
	if rows != 1 {
		t.Errorf("the switch is stored in %d rows — toggling is creating duplicates", rows)
	}
}

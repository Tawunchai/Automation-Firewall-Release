package auth

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	otplib "github.com/pquerna/otp/totp"
	"network_automation/entity"
	middlewares "network_automation/middleware"
	"network_automation/services/platform"
)

// The second half of a sign-in.
//
// /auth/login hands back a pending token when the account has TOTP; these two endpoints turn that
// into a session. Until 2026-11-13 nothing counted attempts here, and nothing stopped a correct
// code being presented twice inside its window — both now have guards, and neither guard had a
// test, which is the same as not having one.
//
// Skipped unless AUTH_DB_TEST_DSN is set — see the header of login_db_test.go for the container.

// Distinct secrets per test, because claimTOTPCode's spent-code map is package-level and lives for
// 90 seconds: two tests sharing a secret would be generating the same six digits in the same window
// and the second would be refused as a replay for a reason that has nothing to do with what it is
// testing.
const (
	secretVerifyOK       = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	secretVerifyReplay   = "KRSXG5A6KRSXG5A6KRSXG5A6KRSXG5A6"
	secretVerifyThrottle = "MFRGGZDFMZTWQ2LKMFRGGZDFMZTWQ2LK"
	secretVerifyReset    = "NBSWY3DPEB3W64TMNBSWY3DPEB3W64TM"
	secretVerifyShared   = "ONSWG4TFORZGK5BAONSWG4TFORZGK5BA"
)

// verifiableTOTP gives the user a verified enrolment with a known secret and clears any throttle
// left over from an earlier test.
func verifiableTOTP(t *testing.T, fx *authFixture, userID uint, secret string) {
	t.Helper()
	if err := fx.DB.Create(&entity.UserTOTP{
		AppUserID: userID, Secret: secret, IsVerified: true,
	}).Error; err != nil {
		t.Fatalf("seed a verified enrolment: %v", err)
	}
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(userID))
	t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(userID)) })
}

func pendingToken(t *testing.T, userID uint, email string) string {
	t.Helper()
	tok, err := platform.GenerateTwoFAPendingToken(userID, email)
	if err != nil {
		t.Fatalf("generate a pending token: %v", err)
	}
	return tok
}

func codeNow(t *testing.T, secret string) string {
	t.Helper()
	code, err := otplib.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate a valid code: %v", err)
	}
	return code
}

// ── the key the budget hangs on ─────────────────────────────────────────────

// The counter is keyed on the ACCOUNT, not the source address, because an attacker chooses how
// many addresses to come from but not which account the pending token names.
func TestTwoFactorKeyIsPerAccount(t *testing.T) {
	if got, want := twoFactorKey(42), "2fa:42"; got != want {
		t.Fatalf("twoFactorKey(42) = %q, want %q", got, want)
	}
	if twoFactorKey(1) == twoFactorKey(2) {
		t.Fatal("two accounts share one budget, so one user's failures would lock out another")
	}
}

// ── what may even be asked ──────────────────────────────────────────────────

func TestVerifyTOTPRefusesAMalformedRequest(t *testing.T) {
	authTestDB(t)

	for _, body := range []string{
		``,
		`{}`,
		`{"code":"123456"}`,                      // no pending token
		`{"pending_token":"x"}`,                  // no code
		`{"pending_token":"x","code":"12345"}`,   // five digits
		`{"pending_token":"x","code":"1234567"}`, // seven
		`{"pending_token":"x","code":""}`,        // empty
	} {
		c, rec := postJSON(t, "/auth/verify-totp", body)
		VerifyTOTP(c)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q answered %d, want 400: %s", body, rec.Code, rec.Body.String())
		}
		assertNoUsableAuthCookie(t, rec)
	}
}

// A pending token is the only thing saying the password was already checked. A forged or expired
// one must get nowhere near the account.
func TestVerifyTOTPRefusesAForgedPendingToken(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyOK)

	for name, tok := range map[string]string{
		"not a JWT":            "not-a-token",
		"empty-ish":            "a.b.c",
		"a JWT signed by none": "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoxLCJ0eXBlIjoiMmZhX3BlbmRpbmcifQ.",
	} {
		t.Run(name, func(t *testing.T) {
			c, rec := postJSON(t, "/auth/verify-totp",
				`{"pending_token":"`+tok+`","code":"`+codeNow(t, secretVerifyOK)+`"}`)
			VerifyTOTP(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
			assertNoUsableAuthCookie(t, rec)
		})
	}
}

// An account with no TOTP cannot be brute-forced, so asking about it must NOT spend the budget —
// otherwise anyone holding a pending token could lock the owner out of their own second factor.
func TestVerifyTOTPOnAnAccountWithoutTOTPDoesNotSpendTheBudget(t *testing.T) {
	fx := authTestDB(t)
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID))
	t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID)) })

	tok := pendingToken(t, fx.UserID, "user@test.invalid")
	for i := 0; i < 8; i++ { // more than the limiter's 5
		c, rec := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"123456"}`)
		VerifyTOTP(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d answered %d, want 400: %s", i+1, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "too many") {
			t.Fatalf("attempt %d was throttled; asking about an account with no TOTP must not count as a guess", i+1)
		}
	}
	if middlewares.TwoFactorAccountLimiter.Blocked(twoFactorKey(fx.UserID)) {
		t.Fatal("the account is now throttled, so a pending token alone can lock a user out")
	}
}

// ── the code itself ─────────────────────────────────────────────────────────

func TestVerifyTOTPAcceptsTheRealCodeAndSignsTheUserIn(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyOK)

	tok := pendingToken(t, fx.UserID, "user@test.invalid")
	c, rec := postJSON(t, "/auth/verify-totp",
		`{"pending_token":"`+tok+`","code":"`+codeNow(t, secretVerifyOK)+`"}`)
	VerifyTOTP(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	ck := authCookie(rec)
	if ck == nil || ck.Value == "" {
		t.Fatal("the sign-in completed but set no session cookie")
	}

	var body struct {
		User struct {
			ID    uint   `json:"id"`
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v (%s)", err, rec.Body.String())
	}
	if body.User.ID != fx.UserID {
		t.Errorf("signed in as user %d, want %d", body.User.ID, fx.UserID)
	}
	if body.User.Role == "" {
		t.Error("the answer carries no role, so the client cannot tell what this account may do")
	}
}

func TestVerifyTOTPRefusesAWrongCodeAndCountsIt(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyThrottle)

	tok := pendingToken(t, fx.UserID, "user@test.invalid")
	c, rec := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
	VerifyTOTP(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	assertNoUsableAuthCookie(t, rec)
}

// RFC 6238 §5.2: a verifier accepts each code once. The library accepts one step either side, so
// the same six digits are arithmetically valid for about 90 seconds — which is long enough for a
// code read over a shoulder, screenshotted, or captured on a phishing page to be presented by
// somebody else. This is the guard that closes that window.
func TestVerifyTOTPRefusesTheSameCodeASecondTime(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyReplay)

	code := codeNow(t, secretVerifyReplay)
	tok := pendingToken(t, fx.UserID, "user@test.invalid")

	c1, rec1 := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"`+code+`"}`)
	VerifyTOTP(c1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("the first use answered %d, want 200: %s", rec1.Code, rec1.Body.String())
	}

	// Same code, same account, still inside its window — and a fresh pending token, because an
	// attacker replaying a captured code would have minted their own.
	c2, rec2 := postJSON(t, "/auth/verify-totp",
		`{"pending_token":"`+pendingToken(t, fx.UserID, "user@test.invalid")+`","code":"`+code+`"}`)
	VerifyTOTP(c2)

	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("the SAME code was accepted twice (status %d) — a captured code is reusable for its whole ~90s window: %s",
			rec2.Code, rec2.Body.String())
	}
	assertNoUsableAuthCookie(t, rec2)

	// And the refusal must read exactly like a wrong code. "Already used" would confirm to whoever
	// captured it that they had the right digits.
	if strings.Contains(strings.ToLower(rec2.Body.String()), "already") ||
		strings.Contains(strings.ToLower(rec2.Body.String()), "used") {
		t.Errorf("the replay refusal admits the digits were right: %s", rec2.Body.String())
	}
}

// Five wrong codes is the budget; the sixth attempt is refused outright with 429 rather than
// checked, and the wording explains itself because the caller already proved they hold the password.
func TestVerifyTOTPThrottlesAfterFiveWrongCodes(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.AdminID, secretVerifyThrottle)

	tok := pendingToken(t, fx.AdminID, "admin@test.invalid")
	for i := 0; i < 5; i++ {
		c, rec := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
		VerifyTOTP(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d answered %d, want 400: %s", i+1, rec.Code, rec.Body.String())
		}
	}

	c, rec := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
	VerifyTOTP(c)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("the sixth attempt answered %d, want 429: %s", rec.Code, rec.Body.String())
	}

	// Even the RIGHT code is refused while the account is throttled — otherwise the budget would
	// only slow down an attacker who was already failing.
	cOK, recOK := postJSON(t, "/auth/verify-totp",
		`{"pending_token":"`+tok+`","code":"`+codeNow(t, secretVerifyThrottle)+`"}`)
	VerifyTOTP(cOK)
	if recOK.Code != http.StatusTooManyRequests {
		t.Fatalf("a correct code was still processed while throttled (%d): %s", recOK.Code, recOK.Body.String())
	}
	assertNoUsableAuthCookie(t, recOK)
}

// Somebody who fat-fingers two digits every morning is not an attack: a correct code clears what
// preceded it, the same rule a correct password follows in Login.
func TestACorrectCodeClearsTheFailuresBeforeIt(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyReset)

	tok := pendingToken(t, fx.UserID, "user@test.invalid")
	for i := 0; i < 4; i++ { // one short of the budget
		c, rec := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
		VerifyTOTP(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d answered %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}

	c, rec := postJSON(t, "/auth/verify-totp",
		`{"pending_token":"`+tok+`","code":"`+codeNow(t, secretVerifyReset)+`"}`)
	VerifyTOTP(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("the correct code answered %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if middlewares.TwoFactorAccountLimiter.Blocked(twoFactorKey(fx.UserID)) {
		t.Error("the account is still throttled after a correct code")
	}
}

// ── the way back in ─────────────────────────────────────────────────────────

// seedBackupCode gives the user one recovery code and returns it in plain text.
func seedBackupCode(t *testing.T, fx *authFixture, userID uint, plain string) {
	t.Helper()
	if err := fx.DB.Create(&entity.UserBackupCode{
		AppUserID: userID, CodeHash: cheapHash(t, plain),
	}).Error; err != nil {
		t.Fatalf("seed a backup code: %v", err)
	}
}

func TestVerifyBackupCodeSignsInAndBurnsTheCode(t *testing.T) {
	fx := authTestDB(t)
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID))
	t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID)) })
	seedBackupCode(t, fx, fx.UserID, "ABCD2345")

	tok := pendingToken(t, fx.UserID, "user@test.invalid")
	c, rec := postJSON(t, "/auth/verify-backup-code",
		`{"pending_token":"`+tok+`","backup_code":"ABCD-2345"}`)
	VerifyBackupCode(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if ck := authCookie(rec); ck == nil || ck.Value == "" {
		t.Fatal("the sign-in completed but set no session cookie")
	}

	// Single use: the row is burned, so the same sheet of codes cannot be used twice.
	var row entity.UserBackupCode
	if err := fx.DB.Where("app_user_id = ?", fx.UserID).First(&row).Error; err != nil {
		t.Fatalf("read the code back: %v", err)
	}
	if row.UsedAt == nil {
		t.Fatal("the code was accepted but not marked used — the same code works again")
	}

	// And proving it, rather than trusting the column.
	c2, rec2 := postJSON(t, "/auth/verify-backup-code",
		`{"pending_token":"`+pendingToken(t, fx.UserID, "user@test.invalid")+`","backup_code":"ABCD-2345"}`)
	VerifyBackupCode(c2)
	if rec2.Code == http.StatusOK {
		t.Fatal("a spent backup code signed the user in a second time")
	}
	assertNoUsableAuthCookie(t, rec2)
}

// A code is read off paper or a screenshot, so the shapes a human types all have to work.
func TestVerifyBackupCodeAcceptsTheShapesAHumanTypes(t *testing.T) {
	for _, typed := range []string{"ABCD2345", "abcd2345", "ABCD-2345", "abcd-2345", " ABCD 2345 ", "AbCd-2345"} {
		t.Run(typed, func(t *testing.T) {
			fx := authTestDB(t)
			middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID))
			t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID)) })
			seedBackupCode(t, fx, fx.UserID, "ABCD2345")

			body, err := json.Marshal(map[string]string{
				"pending_token": pendingToken(t, fx.UserID, "user@test.invalid"),
				"backup_code":   typed,
			})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			c, rec := postJSON(t, "/auth/verify-backup-code", string(body))
			VerifyBackupCode(c)
			if rec.Code != http.StatusOK {
				t.Fatalf("%q answered %d, want 200: %s", typed, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestVerifyBackupCodeRefusesAWrongCode(t *testing.T) {
	fx := authTestDB(t)
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID))
	t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID)) })
	seedBackupCode(t, fx, fx.UserID, "ABCD2345")

	c, rec := postJSON(t, "/auth/verify-backup-code",
		`{"pending_token":"`+pendingToken(t, fx.UserID, "user@test.invalid")+`","backup_code":"ZZZZ9999"}`)
	VerifyBackupCode(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	assertNoUsableAuthCookie(t, rec)
}

func TestVerifyBackupCodeTellsAUserWithNoCodesWhatToDo(t *testing.T) {
	fx := authTestDB(t)
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID))
	t.Cleanup(func() { middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(fx.UserID)) })

	c, rec := postJSON(t, "/auth/verify-backup-code",
		`{"pending_token":"`+pendingToken(t, fx.UserID, "user@test.invalid")+`","backup_code":"ABCD2345"}`)
	VerifyBackupCode(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "backup codes") {
		t.Errorf("the refusal does not say the account has no codes, so the user cannot act on it: %s", rec.Body.String())
	}
}

// The two endpoints share ONE budget on purpose: an attacker alternating between a six-digit code
// and a recovery code must not get two.
func TestTheTwoSecondFactorEndpointsShareOneBudget(t *testing.T) {
	fx := authTestDB(t)
	verifiableTOTP(t, fx, fx.UserID, secretVerifyShared)
	seedBackupCode(t, fx, fx.UserID, "ABCD2345")

	tok := pendingToken(t, fx.UserID, "user@test.invalid")

	// Alternate: 3 wrong TOTP codes, 2 wrong backup codes — five failures across both doors.
	for i := 0; i < 3; i++ {
		c, _ := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
		VerifyTOTP(c)
	}
	for i := 0; i < 2; i++ {
		c, _ := postJSON(t, "/auth/verify-backup-code", `{"pending_token":"`+tok+`","backup_code":"ZZZZ9999"}`)
		VerifyBackupCode(c)
	}

	// Both doors must now be shut.
	c1, rec1 := postJSON(t, "/auth/verify-totp", `{"pending_token":"`+tok+`","code":"000000"}`)
	VerifyTOTP(c1)
	if rec1.Code != http.StatusTooManyRequests {
		t.Errorf("verify-totp answered %d after five failures across both endpoints, want 429: %s",
			rec1.Code, rec1.Body.String())
	}

	c2, rec2 := postJSON(t, "/auth/verify-backup-code",
		`{"pending_token":"`+tok+`","backup_code":"ABCD-2345"}`)
	VerifyBackupCode(c2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("verify-backup-code answered %d, want 429 — the two endpoints are not sharing a budget: %s",
			rec2.Code, rec2.Body.String())
	}
	assertNoUsableAuthCookie(t, rec2)
}

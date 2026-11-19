package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	middlewares "network_automation/middleware"
	"network_automation/services"
	"network_automation/services/platform"
)

// The login boundary, end to end, against a real database and no firewall.
//
// session_test.go covers the token-hash half of authentication, which is pure. This covers the
// decisions: who is let in, who is refused, what the refusal says, and — the assertion that
// matters most — that nothing on a failure path hands back a usable auth_token cookie. Everything
// below /admin trusts that cookie, so a single early `setAuthCookie` on a path that should have
// refused is a full bypass of the console, and nothing but a test like this would notice.
//
// Login needs app_users, app_roles, system_configs, user_totps, user_sessions and send_emails to
// decide anything at all, so these follow the convention set by services/retention_db_test.go and
// controller/policyobject/device_handler_db_test.go: skipped unless one env var names a Postgres
// they may freely create, truncate and drop tables in. Point it at a throwaway container, never at
// the console's own database:
//
//	docker run --rm -d -p 55434:5432 -e POSTGRES_PASSWORD=test --name auth-pg postgres:16-alpine
//	AUTH_DB_TEST_DSN="host=localhost port=55434 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/auth/ -v
//
// The same variable drives every DB test in this package and in controller/user, controller/totp
// and controller/backupcodes.

const (
	authTestDSNEnv = "AUTH_DB_TEST_DSN"

	// Long enough to pass LoginInput's `min=8` binding, so a case meant to test the PASSWORD
	// CHECK is not quietly answered by the request validator instead.
	authTestPassword = "correct-horse-battery"

	// A JWT secret for this test binary only. services.GetJWTSecret calls log.Fatal when
	// JWT_SECRET is unset, which would take the whole package down rather than fail one test.
	authTestJWTSecret = "test-only-jwt-secret-for-the-auth-package-tests"

	authTestAdminEmail   = "admin@test.invalid"
	authTestUserEmail    = "user@test.invalid"
	authTestDeletedEmail = "gone@test.invalid"
)

// authFixture is the seeded world a login test runs against.
type authFixture struct {
	DB        *gorm.DB
	AdminID   uint
	UserID    uint
	DeletedID uint
	AdminRole uint
	UserRole  uint
}

// cheapHash hashes at bcrypt cost 4 instead of services.HashPassword's 12.
//
// bcrypt writes its cost into the hash and CompareHashAndPassword reads the parameters back out of
// it, so a cost-4 hash verifies through services.CheckPasswordHash exactly like a production one —
// and the suite does not spend a quarter of a second per seeded account proving something these
// tests are not about.
func cheapHash(t *testing.T, plain string) string {
	t.Helper()
	b, err := bcrypt.GenerateFromPassword([]byte(plain), 4)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	return string(b)
}

// authTestDB brings up the schema the auth handlers touch and seeds three accounts.
func authTestDB(t *testing.T) *authFixture {
	t.Helper()

	dsn := os.Getenv(authTestDSNEnv)
	if dsn == "" {
		t.Skip(authTestDSNEnv + " not set — see the note at the top of login_db_test.go")
	}

	t.Setenv("JWT_SECRET", authTestJWTSecret)
	t.Setenv("DATABASE_URL", dsn)

	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB — the DSN did not connect")
	}

	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{},
		&entity.SystemConfig{}, &entity.SendEmail{},
		&entity.UserTOTP{}, &entity.UserBackupCode{},
		&entity.OTP{}, &entity.UserSession{}, &entity.ActivityLog{},
		&entity.PasswordHistory{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	// Every test starts from empty, so one test's config row or session cannot make the next
	// test's assertion pass.
	for _, table := range []string{
		"activity_logs", "user_sessions", "otps", "user_backup_codes", "user_totps",
		"password_histories", "send_emails", "system_configs", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	// services.MaintenanceStatus keeps a 5-second cache, so a state left behind by an earlier test
	// would outlive the truncate above and decide this one.
	services.InvalidateMaintenanceCache()

	fx := &authFixture{DB: db}

	adminRole := entity.AppRole{Role: "admin"}
	userRole := entity.AppRole{Role: "user"}
	for _, r := range []*entity.AppRole{&adminRole, &userRole} {
		if err := db.Create(r).Error; err != nil {
			t.Fatalf("create role %s: %v", r.Role, err)
		}
	}
	fx.AdminRole, fx.UserRole = adminRole.ID, userRole.ID

	hash := cheapHash(t, authTestPassword)
	admin := entity.AppUser{
		Email: authTestAdminEmail, Password: hash,
		FirstName: "Test", LastName: "Admin", AppRoleID: adminRole.ID, AuthProvider: "local",
	}
	plain := entity.AppUser{
		Email: authTestUserEmail, Password: hash,
		FirstName: "Test", LastName: "User", AppRoleID: userRole.ID, AuthProvider: "local",
	}
	gone := entity.AppUser{
		Email: authTestDeletedEmail, Password: hash,
		FirstName: "Deleted", LastName: "Account", AppRoleID: userRole.ID, AuthProvider: "local",
	}
	for _, u := range []*entity.AppUser{&admin, &plain, &gone} {
		if err := db.Create(u).Error; err != nil {
			t.Fatalf("create user %s: %v", u.Email, err)
		}
	}
	fx.AdminID, fx.UserID, fx.DeletedID = admin.ID, plain.ID, gone.ID

	// The repo has no "inactive" flag on an account; the closest thing to a disabled account is a
	// soft-deleted one, which is what DeleteUserByID leaves behind. It must not be able to sign in.
	if err := db.Delete(&entity.AppUser{}, gone.ID).Error; err != nil {
		t.Fatalf("soft-delete %s: %v", gone.Email, err)
	}

	// LoginAccountLimiter is a package-level counter in middleware, so failures charged by one test
	// are still charged when the next one runs. Clear the accounts these tests use.
	for _, e := range []string{authTestAdminEmail, authTestUserEmail, authTestDeletedEmail} {
		resetLoginThrottle(e)
	}

	return fx
}

func resetLoginThrottle(email string) {
	middlewares.LoginAccountLimiter.Reset("acct:" + strings.ToLower(strings.TrimSpace(email)))
}

// postJSON aims a handler at a body the way the router would.
func postJSON(t *testing.T, path, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c, rec
}

// authCookie returns the auth_token cookie the response set, or nil.
func authCookie(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == "auth_token" {
			return ck
		}
	}
	return nil
}

// assertNoUsableAuthCookie is the assertion every failure case shares. A cleared cookie (empty
// value, negative MaxAge) is fine; a cookie carrying a token is a bypass.
func assertNoUsableAuthCookie(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	ck := authCookie(rec)
	if ck == nil {
		return
	}
	if ck.Value != "" && ck.MaxAge >= 0 {
		t.Fatalf("a refused request still set a usable auth_token cookie (%d chars, MaxAge=%d) — "+
			"everything behind the console trusts this cookie", len(ck.Value), ck.MaxAge)
	}
}

// ── The login table ──────────────────────────────────────────────────────────

func TestLoginBoundary(t *testing.T) {
	fx := authTestDB(t)

	cases := []struct {
		name string
		body string
		want int
		// wantCookie: a session cookie must be issued (only ever true for a real sign-in).
		wantCookie bool
	}{
		{
			name: "correct credentials",
			body: `{"email":"` + authTestUserEmail + `","password":"` + authTestPassword + `"}`,
			want: http.StatusOK, wantCookie: true,
		},
		{
			name: "correct credentials, different case in the address",
			body: `{"email":"` + strings.ToUpper(authTestUserEmail) + `","password":"` + authTestPassword + `"}`,
			want: http.StatusOK, wantCookie: true,
		},
		{
			name: "wrong password for a real account",
			body: `{"email":"` + authTestUserEmail + `","password":"not-the-password"}`,
			want: http.StatusUnauthorized,
		},
		{
			name: "unknown email",
			body: `{"email":"nobody@test.invalid","password":"` + authTestPassword + `"}`,
			want: http.StatusUnauthorized,
		},
		{
			// A soft-deleted account is the repo's "disabled account": DeleteUserByID leaves the
			// row in place with deleted_at set. GORM's default scope excludes it, so the lookup
			// misses and the answer is the same 401 as an address that never existed.
			name: "soft-deleted account with the right password",
			body: `{"email":"` + authTestDeletedEmail + `","password":"` + authTestPassword + `"}`,
			want: http.StatusUnauthorized,
		},
		{
			name: "empty body",
			body: ``,
			want: http.StatusBadRequest,
		},
		{
			name: "empty JSON object",
			body: `{}`,
			want: http.StatusBadRequest,
		},
		{
			name: "password missing",
			body: `{"email":"` + authTestUserEmail + `"}`,
			want: http.StatusBadRequest,
		},
		{
			name: "email missing",
			body: `{"password":"` + authTestPassword + `"}`,
			want: http.StatusBadRequest,
		},
		{
			name: "email is not an address",
			body: `{"email":"not-an-email","password":"` + authTestPassword + `"}`,
			want: http.StatusBadRequest,
		},
		{
			// The `min=8` binding answers before the password is ever compared, so a short guess
			// never reaches bcrypt. Pinned because moving that rule would change this status.
			name: "password shorter than the binding allows",
			body: `{"email":"` + authTestUserEmail + `","password":"short"}`,
			want: http.StatusBadRequest,
		},
		{
			name: "malformed JSON",
			body: `{"email":`,
			want: http.StatusBadRequest,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// A case's own failures must not spend the next case's budget.
			resetLoginThrottle(authTestUserEmail)
			resetLoginThrottle("nobody@test.invalid")
			resetLoginThrottle(authTestDeletedEmail)

			c, rec := postJSON(t, "/auth/login", tc.body)
			Login(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}

			if tc.wantCookie {
				ck := authCookie(rec)
				if ck == nil || ck.Value == "" {
					t.Fatal("a successful sign-in set no auth_token cookie")
				}
				if !ck.HttpOnly {
					t.Error("the auth cookie is readable from JavaScript")
				}
				// The cookie must name a session row, or middleware.Authorizes rejects it on the
				// very next request — createSession is synchronous for exactly this reason.
				var sessions int64
				fx.DB.Model(&entity.UserSession{}).
					Where("token_hash = ? AND is_revoked = false", hashToken(ck.Value)).
					Count(&sessions)
				if sessions != 1 {
					t.Errorf("the issued token has %d session rows, want 1 — Authorizes would "+
						"reject it as a session that no longer exists", sessions)
				}
				return
			}

			assertNoUsableAuthCookie(t, rec)
			if strings.Contains(rec.Body.String(), "pending_token") {
				t.Error("a refused login handed back a pending token")
			}
		})
	}
}

// ── User enumeration ─────────────────────────────────────────────────────────

// The three ways to be refused at the password step must be indistinguishable. If "no such user"
// read differently from "wrong password", the login form would be an unauthenticated oracle for
// "does this person have an account on this console" — which is exactly what CheckUserEmail was
// rewritten to stop giving away (see its comment in auth.go).
func TestLoginDoesNotDistinguishUnknownEmailFromWrongPassword(t *testing.T) {
	authTestDB(t)

	bodies := map[string]string{
		"unknown email":     `{"email":"nobody@test.invalid","password":"` + authTestPassword + `"}`,
		"wrong password":    `{"email":"` + authTestUserEmail + `","password":"not-the-password"}`,
		"soft-deleted user": `{"email":"` + authTestDeletedEmail + `","password":"` + authTestPassword + `"}`,
		"another unknown":   `{"email":"someone.else@test.invalid","password":"` + authTestPassword + `"}`,
	}

	type answer struct {
		code int
		body string
	}
	got := map[string]answer{}
	for name, body := range bodies {
		resetLoginThrottle(authTestUserEmail)
		c, rec := postJSON(t, "/auth/login", body)
		Login(c)
		got[name] = answer{rec.Code, rec.Body.String()}
	}

	var first string
	for name := range got {
		first = name
		break
	}
	for name, a := range got {
		if a.code != got[first].code || a.body != got[first].body {
			t.Errorf("%q answered %d %s but %q answered %d %s — the difference tells an "+
				"unauthenticated caller which addresses have accounts here",
				name, a.code, a.body, first, got[first].code, got[first].body)
		}
	}
}

// Running out of attempts must read the same way too, or the throttle itself becomes the oracle:
// "this account is locked" confirms the account exists. auth.go says so explicitly; this holds it.
func TestLoginThrottleAnswersLikeAWrongPassword(t *testing.T) {
	authTestDB(t)

	const target = authTestUserEmail
	resetLoginThrottle(target)

	wrong := `{"email":"` + target + `","password":"not-the-password"}`

	// LoginAccountLimiter allows 10 failures per account per 15 minutes.
	var lastBody string
	for i := 0; i < 10; i++ {
		c, rec := postJSON(t, "/auth/login", wrong)
		Login(c)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i+1, rec.Code)
		}
		lastBody = rec.Body.String()
	}

	// The 11th is refused by the throttle rather than by the password check.
	c, rec := postJSON(t, "/auth/login", wrong)
	Login(c)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("throttled attempt: status = %d, want 401", rec.Code)
	}
	if rec.Body.String() != lastBody {
		t.Errorf("throttled answer %q differs from a wrong-password answer %q — the wording "+
			"confirms the account exists", rec.Body.String(), lastBody)
	}
	assertNoUsableAuthCookie(t, rec)

	// And it really is locked now: the CORRECT password is refused too, with no cookie.
	c, rec = postJSON(t, "/auth/login", `{"email":"`+target+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("correct password on a throttled account: status = %d, want 401", rec.Code)
	}
	assertNoUsableAuthCookie(t, rec)

	resetLoginThrottle(target)
}

// A correct password clears whatever typos preceded it — somebody who mistypes twice every morning
// must never accumulate their way into a lockout.
func TestLoginResetsTheThrottleOnSuccess(t *testing.T) {
	authTestDB(t)
	resetLoginThrottle(authTestUserEmail)

	for i := 0; i < 9; i++ {
		c, _ := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"not-the-password"}`)
		Login(c)
	}
	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("correct password after 9 typos: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// 10 more failures would have to be charged from zero to lock the account again.
	for i := 0; i < 10; i++ {
		c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"not-the-password"}`)
		Login(c)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("post-success attempt %d: status = %d, want 401", i+1, rec.Code)
		}
	}
	resetLoginThrottle(authTestUserEmail)
}

// ── Maintenance mode ─────────────────────────────────────────────────────────

// Maintenance mode locks everyone out except an admin, who is the only person who can switch it
// off. The gate runs AFTER the password check on purpose, so the refusal is 503 — and it must not
// come with a cookie, or the user would be signed in to a console that refuses to serve them.
func TestLoginUnderMaintenanceLetsOnlyAdminsIn(t *testing.T) {
	fx := authTestDB(t)
	if err := fx.DB.Create(&entity.SystemConfig{Key: services.MaintenanceKey, Value: "true"}).Error; err != nil {
		t.Fatalf("enable maintenance: %v", err)
	}
	services.InvalidateMaintenanceCache()
	t.Cleanup(services.InvalidateMaintenanceCache)

	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("non-admin under maintenance: status = %d, want 503: %s", rec.Code, rec.Body.String())
	}
	assertNoUsableAuthCookie(t, rec)

	c, rec = postJSON(t, "/auth/login", `{"email":"`+authTestAdminEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin under maintenance: status = %d, want 200 (they are the one who turns it "+
			"off): %s", rec.Code, rec.Body.String())
	}
	if ck := authCookie(rec); ck == nil || ck.Value == "" {
		t.Error("the admin was admitted but got no session cookie")
	}
}

// ── The second factor is not a session ───────────────────────────────────────

// When TOTP is required, /auth/login must answer with a PENDING token and nothing else. A pending
// token is not a credential: middleware.Authorizes does not accept it, and it is handed to a caller
// who has proved only the first of two factors. If this path ever also set auth_token, the second
// factor would be decorative — the browser would already be signed in.
func TestLoginWithTOTPRequiredIssuesNoSessionCookie(t *testing.T) {
	fx := authTestDB(t)
	if err := fx.DB.Create(&entity.SystemConfig{Key: "totp_global_enabled", Value: "true"}).Error; err != nil {
		t.Fatalf("enable global TOTP: %v", err)
	}
	if err := fx.DB.Create(&entity.UserTOTP{
		AppUserID: fx.UserID, Secret: "JBSWY3DPEHPK3PXP", IsVerified: true, IsEnabled: true,
	}).Error; err != nil {
		t.Fatalf("seed TOTP: %v", err)
	}

	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if body["requires_totp"] != true {
		t.Fatalf("requires_totp = %v, want true: %s", body["requires_totp"], rec.Body.String())
	}
	if _, ok := body["pending_token"].(string); !ok {
		t.Fatal("no pending_token in the response")
	}
	assertNoUsableAuthCookie(t, rec)

	var sessions int64
	fx.DB.Model(&entity.UserSession{}).Count(&sessions)
	if sessions != 0 {
		t.Errorf("%d session rows were written for a login that has not finished its second factor", sessions)
	}
}

// The global switch is what makes TOTP optional, so it has to be the thing that decides. With it
// off, a verified-and-enabled enrolment is skipped and the sign-in completes — today's behaviour,
// pinned so a change to the gate is a visible change.
func TestLoginSkipsTOTPWhenTheGlobalSwitchIsOff(t *testing.T) {
	fx := authTestDB(t)
	if err := fx.DB.Create(&entity.SystemConfig{Key: "totp_global_enabled", Value: "false"}).Error; err != nil {
		t.Fatalf("seed switch: %v", err)
	}
	if err := fx.DB.Create(&entity.UserTOTP{
		AppUserID: fx.UserID, Secret: "JBSWY3DPEHPK3PXP", IsVerified: true, IsEnabled: true,
	}).Error; err != nil {
		t.Fatalf("seed TOTP: %v", err)
	}

	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "requires_totp") {
		t.Error("TOTP was demanded although the global switch is off")
	}
	if ck := authCookie(rec); ck == nil || ck.Value == "" {
		t.Error("the sign-in completed but set no session cookie")
	}
}

// An enrolment the user has PAUSED (is_enabled = false, secret kept) must not demand a code —
// that is the whole point of the pause — and the sign-in must still complete.
func TestLoginSkipsAPausedTOTPEnrolment(t *testing.T) {
	fx := authTestDB(t)
	if err := fx.DB.Create(&entity.SystemConfig{Key: "totp_global_enabled", Value: "true"}).Error; err != nil {
		t.Fatalf("seed switch: %v", err)
	}
	// IsEnabled is `gorm:"default:true"`, and GORM leaves a zero-value field out of the INSERT, so
	// Create with IsEnabled:false stores TRUE — this test would otherwise have been proving the
	// exact opposite of what it says. Select("*") does not beat the column default either; only an
	// UPDATE naming the column does. Same trap as the Notify rule that came back enabled after
	// being saved disabled.
	if err := fx.DB.Create(&entity.UserTOTP{
		AppUserID: fx.UserID, Secret: "JBSWY3DPEHPK3PXP", IsVerified: true,
	}).Error; err != nil {
		t.Fatalf("seed TOTP: %v", err)
	}
	if err := fx.DB.Model(&entity.UserTOTP{}).
		Where("app_user_id = ?", fx.UserID).
		Update("is_enabled", false).Error; err != nil {
		t.Fatalf("pause the enrolment: %v", err)
	}
	var stored entity.UserTOTP
	if err := fx.DB.Where("app_user_id = ?", fx.UserID).First(&stored).Error; err != nil {
		t.Fatalf("read back the enrolment: %v", err)
	}
	if stored.IsEnabled {
		t.Fatal("the paused enrolment was stored as enabled, so this test cannot prove anything")
	}

	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "requires_totp") {
		t.Fatalf("a paused enrolment changed the sign-in: %d %s", rec.Code, rec.Body.String())
	}
}

// ── Logout ───────────────────────────────────────────────────────────────────

// "Logged out" has to mean logged out: the cookie is cleared AND the session row is revoked, which
// is the only thing that stops a copy of the token held anywhere else from working for the rest of
// its 24 hours.
func TestLogoutRevokesTheSessionRowNotJustTheCookie(t *testing.T) {
	fx := authTestDB(t)

	c, rec := postJSON(t, "/auth/login", `{"email":"`+authTestUserEmail+`","password":"`+authTestPassword+`"}`)
	Login(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	ck := authCookie(rec)
	if ck == nil || ck.Value == "" {
		t.Fatal("login set no cookie")
	}

	outRec := httptest.NewRecorder()
	out, _ := gin.CreateTestContext(outRec)
	out.Request = httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	out.Request.AddCookie(&http.Cookie{Name: "auth_token", Value: ck.Value})
	Logout(out)

	if outRec.Code != http.StatusOK {
		t.Fatalf("logout: status = %d, want 200: %s", outRec.Code, outRec.Body.String())
	}
	var session entity.UserSession
	if err := fx.DB.Where("token_hash = ?", hashToken(ck.Value)).First(&session).Error; err != nil {
		t.Fatalf("the session row is gone rather than revoked: %v", err)
	}
	if !session.IsRevoked {
		t.Fatal("logout cleared the cookie but left the session row live — anything else holding " +
			"a copy of that token keeps working for 24 hours")
	}
	// And the browser's cookie is cleared, not merely rewritten.
	cleared := authCookie(outRec)
	if cleared == nil {
		t.Fatal("logout did not send a Set-Cookie clearing auth_token")
	}
	if cleared.Value != "" || cleared.MaxAge >= 0 {
		t.Errorf("logout's cookie is not a clear: value=%q MaxAge=%d", cleared.Value, cleared.MaxAge)
	}
}

// ── CheckUserEmail discloses nothing ─────────────────────────────────────────

// Step 1 of "I forgot my password" used to answer exists:true / 404 exists:false, and — far worse —
// used to hand a password-reset token to whoever asked. Both are gone and the endpoint now decides
// nothing: the same answer for a registered address, an unregistered one and a soft-deleted one.
func TestCheckUserEmailAnswersTheSameForEveryAddress(t *testing.T) {
	authTestDB(t)

	var first string
	for _, email := range []string{authTestAdminEmail, authTestUserEmail, authTestDeletedEmail, "nobody@test.invalid"} {
		c, rec := postJSON(t, "/check-email", `{"email":"`+email+`"}`)
		CheckUserEmail(c)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200: %s", email, rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		if first == "" {
			first = body
		} else if body != first {
			t.Errorf("%s answered %q but another address answered %q — the difference is an "+
				"unauthenticated account-existence oracle", email, body, first)
		}
		for _, leak := range []string{"exists", "token", "reset"} {
			if strings.Contains(strings.ToLower(body), leak) {
				t.Errorf("%s: the answer carries %q: %s", email, leak, body)
			}
		}
	}
}

// ── Me ───────────────────────────────────────────────────────────────────────

// Me answers from the context the middleware stamped, never from anything the caller sent. A
// request that reaches it without a user_id must be 401, not an answer about user 0.
func TestMeRefusesARequestWithNoIdentity(t *testing.T) {
	authTestDB(t)

	for _, tc := range []struct {
		name string
		set  func(*gin.Context)
	}{
		{"nothing set", func(*gin.Context) {}},
		{"user_id of the wrong type", func(c *gin.Context) { c.Set("user_id", "1") }},
		{"user_id naming nobody", func(c *gin.Context) { c.Set("user_id", uint(99999)) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodGet, "/me", nil)
			tc.set(c)
			Me(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestMeAnswersForTheIdentityOnTheContext(t *testing.T) {
	fx := authTestDB(t)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/me", nil)
	c.Set("user_id", fx.UserID)
	Me(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, authTestUserEmail) {
		t.Errorf("the answer is not about the caller: %s", body)
	}
	// The password hash must never leave the server, in any shape.
	if strings.Contains(body, "$2a$") || strings.Contains(body, "$2b$") {
		t.Errorf("/me returned a password hash: %s", body)
	}
}

// ── Verify2FA (the email-OTP second factor) ──────────────────────────────────

// The pending token is the only thing standing between "the password was right" and a session, so
// it has to be a token this server issued, of the right TYPE, and unexpired.
func TestVerify2FARefusesAForgedOrWrongTypePendingToken(t *testing.T) {
	fx := authTestDB(t)

	// A full login JWT is signed with the same secret and names the same user. It must still be
	// refused here, because its `type` claim is not "2fa_pending" — otherwise a session cookie
	// could be traded for a second-factor bypass.
	loginJWT, err := platform.GenerateJWT(fx.UserID, authTestUserEmail, "user")
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	for _, tc := range []struct {
		name  string
		token string
	}{
		{"garbage", "not.a.token"},
		{"empty-ish", "a.b.c"},
		{"a login JWT used as a pending token", loginJWT},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := postJSON(t, "/auth/verify-2fa",
				`{"pending_token":"`+tc.token+`","otp":"123456"}`)
			Verify2FA(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
			assertNoUsableAuthCookie(t, rec)
		})
	}
}

// A pending token signed with a DIFFERENT secret is the forgery that matters: without the
// signature check, naming a user id would be enough to finish anyone's sign-in.
func TestVerify2FARefusesAPendingTokenSignedWithAnotherSecret(t *testing.T) {
	fx := authTestDB(t)

	// Mint a pending token under a foreign secret, then put the real secret back.
	t.Setenv("JWT_SECRET", "a-different-secret-an-attacker-chose")
	forged, err := platform.GenerateTwoFAPendingToken(fx.AdminID, authTestAdminEmail)
	if err != nil {
		t.Fatalf("mint forged token: %v", err)
	}
	t.Setenv("JWT_SECRET", authTestJWTSecret)

	// Seed an OTP that WOULD be accepted, so the only thing refusing this request is the signature.
	if err := fx.DB.Create(&entity.OTP{
		Email: authTestAdminEmail, Code: "246810",
		ExpiresAt: time.Now().Add(10 * time.Minute).Unix(),
	}).Error; err != nil {
		t.Fatalf("seed OTP: %v", err)
	}

	c, rec := postJSON(t, "/auth/verify-2fa", `{"pending_token":"`+forged+`","otp":"246810"}`)
	Verify2FA(c)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — a pending token signed with any secret would let "+
			"anyone finish the admin's sign-in: %s", rec.Code, rec.Body.String())
	}
	assertNoUsableAuthCookie(t, rec)
}

// The OTP row's own rules: wrong code, already used, expired. None of them may produce a session.
func TestVerify2FARefusesABadOTP(t *testing.T) {
	fx := authTestDB(t)

	pending, err := platform.GenerateTwoFAPendingToken(fx.UserID, authTestUserEmail)
	if err != nil {
		t.Fatalf("GenerateTwoFAPendingToken: %v", err)
	}

	cases := []struct {
		name string
		seed entity.OTP
		otp  string
		want int
	}{
		{
			name: "code does not match",
			seed: entity.OTP{Email: authTestUserEmail, Code: "111111", ExpiresAt: time.Now().Add(10 * time.Minute).Unix()},
			otp:  "222222", want: http.StatusBadRequest,
		},
		{
			name: "code already used",
			seed: entity.OTP{Email: authTestUserEmail, Code: "111111", Verified: true, ExpiresAt: time.Now().Add(10 * time.Minute).Unix()},
			otp:  "111111", want: http.StatusBadRequest,
		},
		{
			name: "code expired",
			seed: entity.OTP{Email: authTestUserEmail, Code: "111111", ExpiresAt: time.Now().Add(-1 * time.Minute).Unix()},
			otp:  "111111", want: http.StatusBadRequest,
		},
		{
			// The code belongs to someone else's mailbox. Verify2FA matches on the EMAIL from the
			// pending token, so a code issued to another address must not work here.
			name: "code issued to a different address",
			seed: entity.OTP{Email: authTestAdminEmail, Code: "111111", ExpiresAt: time.Now().Add(10 * time.Minute).Unix()},
			otp:  "111111", want: http.StatusBadRequest,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := fx.DB.Exec("TRUNCATE TABLE otps RESTART IDENTITY CASCADE").Error; err != nil {
				t.Fatalf("clear otps: %v", err)
			}
			seed := tc.seed
			if err := fx.DB.Create(&seed).Error; err != nil {
				t.Fatalf("seed OTP: %v", err)
			}

			c, rec := postJSON(t, "/auth/verify-2fa", `{"pending_token":"`+pending+`","otp":"`+tc.otp+`"}`)
			Verify2FA(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			assertNoUsableAuthCookie(t, rec)
		})
	}
}

// The happy path, so the refusals above are not passing because the handler refuses everything.
func TestVerify2FAAcceptsAFreshCodeExactlyOnce(t *testing.T) {
	fx := authTestDB(t)

	pending, err := platform.GenerateTwoFAPendingToken(fx.UserID, authTestUserEmail)
	if err != nil {
		t.Fatalf("GenerateTwoFAPendingToken: %v", err)
	}
	if err := fx.DB.Create(&entity.OTP{
		Email: authTestUserEmail, Code: "135791",
		ExpiresAt: time.Now().Add(10 * time.Minute).Unix(),
	}).Error; err != nil {
		t.Fatalf("seed OTP: %v", err)
	}

	c, rec := postJSON(t, "/auth/verify-2fa", `{"pending_token":"`+pending+`","otp":"135791"}`)
	Verify2FA(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	ck := authCookie(rec)
	if ck == nil || ck.Value == "" {
		t.Fatal("the second factor succeeded but no session cookie was issued")
	}

	// The same code presented again is refused: the row is marked verified, which is what makes an
	// emailed code single-use.
	c, rec = postJSON(t, "/auth/verify-2fa", `{"pending_token":"`+pending+`","otp":"135791"}`)
	Verify2FA(c)
	if rec.Code == http.StatusOK {
		t.Fatal("an email OTP worked twice — a code read over a shoulder stays usable")
	}
	assertNoUsableAuthCookie(t, rec)
}

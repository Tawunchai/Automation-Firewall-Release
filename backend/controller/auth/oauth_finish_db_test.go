package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// oauthFinish, against a real database.
//
// This is the function that decides WHO a completed provider flow is, and it is the whole of the
// OAuth security model: everything before it is a token exchange, everything after it is a signed
// session.
//
// These tests were first written to PIN the holes, each one marked `PHASE 2 HOLE` and naming what
// an attacker got. Phase 2 closed them, so every one of those tests failed — which was the agreed
// signal, not a regression. They now assert the closed behaviour, and the three gates Phase 2
// added (the verified address, the password account that may not be claimed, signup being off by
// default) have tests of their own, because a gate nothing asserts is a gate the next change can
// delete in silence.
//
// Same fixture, env gate and Postgres as login_db_test.go: AUTH_DB_TEST_DSN, or skipped.

const (
	// Where oauthFinish sends the browser. Pinned to a value no default could produce by accident,
	// so an assertion on the Location header is really asserting what the handler built.
	oauthTestFrontend = "https://console.test.invalid"

	// A provider subject that belongs to nobody in this database.
	oauthTestAttackerSub = "attacker-provider-subject-0001"
)

// oauthFinishCtx aims oauthFinish at a request shaped like a provider callback, with FRONTEND_URL
// fixed so the redirect target is known.
func oauthFinishCtx(t *testing.T) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	t.Setenv("FRONTEND_URL", oauthTestFrontend)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/auth/google/callback?code=x&state=y", nil)
	c.Request.Header.Set("User-Agent", "oauth-finish-test")
	return c, rec
}

// verified is the profile a provider hands oauthFinish once it has CHECKED the address: the only
// shape that may name an account at all. Written as a helper so that every call site below says
// out loud which half of the gate it is exercising, and so that an unverified profile has to be
// built deliberately rather than by forgetting a field.
func verified(providerID, email string) oauthUserInfo {
	return oauthUserInfo{ProviderID: providerID, Email: email, EmailVerified: true}
}

// allowSignup turns branch 3 — account creation — on for one test. It is off in production unless
// OAUTH_ALLOW_SIGNUP is set, so a test about creation has to ask for it, and a test about the
// default posture must not.
func allowSignup(t *testing.T) {
	t.Helper()
	t.Setenv("OAUTH_ALLOW_SIGNUP", "1")
}

// provisioned makes a seeded account what an administrator creates when they mean "this person
// signs in with Google": the provider is named, but provider_id is still empty because nobody has
// completed a flow yet. This is the only kind of account branch 2 may bind an arriving identity to.
func provisioned(t *testing.T, fx *authFixture, id uint, provider string) {
	t.Helper()
	if err := fx.DB.Model(&entity.AppUser{}).Where("id = ?", id).
		Updates(map[string]interface{}{"auth_provider": provider, "provider_id": ""}).Error; err != nil {
		t.Fatalf("provision user %d for %s: %v", id, provider, err)
	}
}

// bound ties an account to a provider identity the way a previous successful sign-in would have,
// so that branch 1 — the (provider_id, auth_provider) key — is the branch under test.
func bound(t *testing.T, fx *authFixture, id uint, provider, providerID string) {
	t.Helper()
	if err := fx.DB.Model(&entity.AppUser{}).Where("id = ?", id).
		Updates(map[string]interface{}{"auth_provider": provider, "provider_id": providerID}).Error; err != nil {
		t.Fatalf("bind user %d to %s/%s: %v", id, provider, providerID, err)
	}
}

// redirectTarget returns the Location a 307 was sent to, failing if the response was not a
// redirect at all.
func redirectTarget(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want 307: %s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if loc == "" {
		t.Fatal("a 307 with no Location header")
	}
	return loc
}

// assertRefused is the assertion every closed door shares: the named error, no usable cookie, and
// nothing written. A refusal that still hands out a token, or still leaves an account behind, is
// not a refusal.
func assertRefused(t *testing.T, fx *authFixture, rec *httptest.ResponseRecorder,
	wantErr string, usersBefore int64) {
	t.Helper()

	if got := redirectTarget(t, rec); got != oauthTestFrontend+"?oauth_error="+wantErr {
		t.Fatalf("Location = %q, want ?oauth_error=%s", got, wantErr)
	}
	assertNoUsableAuthCookie(t, rec)

	if after := liveUserCount(t, fx); after != usersBefore {
		t.Errorf("user count %d → %d on a refused flow", usersBefore, after)
	}
	var sessions int64
	fx.DB.Model(&entity.UserSession{}).Count(&sessions)
	if sessions != 0 {
		t.Errorf("%d session rows written for a refused flow", sessions)
	}
}

// assertSignedIn is the assertion that defines "this flow logged somebody in": a cookie carrying a
// token, a live session row naming the expected account, and a JWT whose claims say who it is.
// Everything under /admin trusts exactly this much.
func assertSignedIn(t *testing.T, fx *authFixture, rec *httptest.ResponseRecorder,
	wantUserID uint, wantRole string) {
	t.Helper()

	ck := authCookie(rec)
	if ck == nil || ck.Value == "" {
		t.Fatal("the flow set no usable auth_token cookie")
	}
	if !ck.HttpOnly {
		t.Error("the auth cookie is readable from JavaScript")
	}

	var session entity.UserSession
	if err := fx.DB.Where("token_hash = ?", hashToken(ck.Value)).First(&session).Error; err != nil {
		t.Fatalf("no session row for the issued token: %v — middleware.Authorizes would reject it "+
			"on the very next request", err)
	}
	if session.IsRevoked {
		t.Error("the session row was written already revoked")
	}
	if session.AppUserID != wantUserID {
		t.Fatalf("the session names user %d, want %d", session.AppUserID, wantUserID)
	}

	claims, err := platform.ParseJWT(ck.Value)
	if err != nil {
		t.Fatalf("the issued token does not parse: %v", err)
	}
	if claims.UserID != wantUserID {
		t.Errorf("token UserID = %d, want %d", claims.UserID, wantUserID)
	}
	if claims.Role != wantRole {
		t.Fatalf("token Role = %q, want %q — this is the claim every admin-only route reads",
			claims.Role, wantRole)
	}
}

// liveUserCount counts accounts GORM's default scope can see (soft-deleted rows excluded), which
// is the number that changes when branch 3 mints an account.
func liveUserCount(t *testing.T, fx *authFixture) int64 {
	t.Helper()
	var n int64
	if err := fx.DB.Model(&entity.AppUser{}).Count(&n).Error; err != nil {
		t.Fatalf("count users: %v", err)
	}
	return n
}

// ── 1. The account-takeover path, now closed ─────────────────────────────────

// THE headline Phase 2 finding, inverted into its fix.
//
// A provider profile used to be matched to an account by email alone and then WRITE its
// auth_provider and provider_id onto whatever it found. The local admin of this console was
// matched like anybody else, so an identity that merely CLAIMED the admin's address signed in AS
// the admin and permanently rebound the admin's row to itself — invisibly, because the password
// hash was left intact.
//
// Two separate things now stop it, and this test proves the SECOND one on its own by presenting a
// fully verified address: a password account may not be claimed by an identity arriving from a
// provider. Its owner proves who they are with the password; quoting the address is not proof.
func TestOAuthFinishRefusesToClaimAPasswordAccountByEmail(t *testing.T) {
	fx := authTestDB(t)
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	info := verified(oauthTestAttackerSub, strings.ToUpper(authTestAdminEmail))
	info.FirstName, info.LastName = "Not", "TheAdmin"
	oauthFinish(c, info, "google")

	// Refused, and told apart from "no such account" on purpose: the address does exist, it simply
	// cannot be claimed this way, and an administrator linking it is a deliberate act.
	assertRefused(t, fx, rec, "account_not_linked", before)

	// And the admin's row is untouched — the part that used to be permanent and silent.
	var admin entity.AppUser
	if err := fx.DB.First(&admin, fx.AdminID).Error; err != nil {
		t.Fatalf("read the admin back: %v", err)
	}
	if admin.ProviderID != "" {
		t.Errorf("provider_id = %q, want empty — the arriving identity was written onto the "+
			"admin's account", admin.ProviderID)
	}
	if admin.AuthProvider != "local" {
		t.Errorf("auth_provider = %q, want \"local\" — relabelling it also exempts the account "+
			"from the password-expiry rule in auth.go", admin.AuthProvider)
	}
	if admin.FirstName != "Test" {
		t.Errorf("first name = %q, want the stored \"Test\"", admin.FirstName)
	}
}

// An account bound to one provider identity may not be re-pointed at another by email. Without
// this, the takeover above comes back with one extra step: sign in once as a stranger, then
// present the target's address.
func TestOAuthFinishRefusesToRepointAnAccountBoundToAnotherIdentity(t *testing.T) {
	fx := authTestDB(t)
	bound(t, fx, fx.UserID, "google", "google-sub-original")
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, verified("github-someone-else", authTestUserEmail), "github")

	assertRefused(t, fx, rec, "account_not_linked", before)

	var user entity.AppUser
	if err := fx.DB.First(&user, fx.UserID).Error; err != nil {
		t.Fatalf("read the user back: %v", err)
	}
	if user.ProviderID != "google-sub-original" || user.AuthProvider != "google" {
		t.Errorf("identity moved to %s/%s", user.AuthProvider, user.ProviderID)
	}
}

// The branch that is MEANT to link: an account an administrator created as a provider account,
// which no one has signed into yet. The arriving identity is bound to it, and the session inherits
// whatever role that row already has — an OAuth sign-in never gets a role of its own.
func TestOAuthFinishLinksAProvisionedAccountAndInheritsItsRole(t *testing.T) {
	fx := authTestDB(t)
	provisioned(t, fx, fx.UserID, "github")
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, verified("github-12345", authTestUserEmail), "github")

	if got := redirectTarget(t, rec); got != oauthTestFrontend+"/admin" {
		t.Fatalf("Location = %q, want the signed-in landing page %q", got, oauthTestFrontend+"/admin")
	}
	assertSignedIn(t, fx, rec, fx.UserID, "user")

	if after := liveUserCount(t, fx); after != before {
		t.Errorf("user count %d → %d; the provisioned account was not reused", before, after)
	}
	var user entity.AppUser
	if err := fx.DB.First(&user, fx.UserID).Error; err != nil {
		t.Fatalf("read the user back: %v", err)
	}
	if user.ProviderID != "github-12345" {
		t.Errorf("provider_id = %q, want the identity that just signed in", user.ProviderID)
	}
}

// ── 2. The verified-address gate ─────────────────────────────────────────────

// The gate with the widest reach and, until now, no test at all.
//
// The address decides which account is opened, so an address nobody checked is just a string the
// caller chose. Google states it as `email_verified`; GitHub only returns addresses it has marked
// primary AND verified; for LINE it comes from the token endpoint that validates the ID token's
// signature. No provider may leave it false and still name an account — including for an address
// that exists, and including when signup is on.
func TestOAuthFinishRefusesAnUnverifiedAddress(t *testing.T) {
	for _, tc := range []struct {
		name  string
		email string
	}{
		{"an existing admin account", authTestAdminEmail},
		{"an address nobody has", "nobody@somewhere-else.invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fx := authTestDB(t)
			allowSignup(t) // even with creation ON, an unchecked address names nothing
			before := liveUserCount(t, fx)

			c, rec := oauthFinishCtx(t)
			oauthFinish(c, oauthUserInfo{
				ProviderID:    oauthTestAttackerSub,
				Email:         tc.email,
				EmailVerified: false,
				FirstName:     "Un", LastName: "Verified",
			}, "google")

			assertRefused(t, fx, rec, "email_unverified", before)
		})
	}
}

// ── 3. Branch 3: creation, and the switch in front of it ─────────────────────

// The default posture, and the one routes.go describes: there is no self-registration in this
// console. An address it has never seen is refused outright, so the three public provider GETs are
// a way to sign IN, not a way to get an account.
func TestOAuthFinishRefusesAnUnknownAddressWhenSignupIsOff(t *testing.T) {
	fx := authTestDB(t)
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, verified(oauthTestAttackerSub, "stranger@somewhere-else.invalid"), "google")

	assertRefused(t, fx, rec, "no_account", before)
}

// With OAUTH_ALLOW_SIGNUP set, branch 3 does create the account — the deployment that wants open
// provider sign-up asks for it explicitly. What it creates is pinned here, because this is the one
// path that mints an account without an administrator.
func TestOAuthFinishCreatesAnAccountForAnUnknownEmailWhenSignupIsOn(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)
	before := liveUserCount(t, fx)

	const stranger = "stranger@somewhere-else.invalid"

	c, rec := oauthFinishCtx(t)
	info := verified(oauthTestAttackerSub, stranger)
	info.FirstName, info.LastName = "Som", "Chai"
	info.Profile = "https://example.invalid/avatar.png"
	oauthFinish(c, info, "google")

	if got := redirectTarget(t, rec); got != oauthTestFrontend+"/admin" {
		t.Fatalf("Location = %q, want %q", got, oauthTestFrontend+"/admin")
	}
	if after := liveUserCount(t, fx); after != before+1 {
		t.Fatalf("user count went %d → %d, want one new account", before, after)
	}

	var created entity.AppUser
	if err := fx.DB.Preload("AppRole").Where("email = ?", stranger).First(&created).Error; err != nil {
		t.Fatalf("the new account cannot be read back: %v", err)
	}

	// The role it is given. "user", not "admin" — and worth pinning precisely because branch 3
	// picks the row by name: if the "user" role were ever renamed, oauthFinish would take the
	// ?oauth_error=server branch instead, which is a failure, not an escalation.
	if created.AppRoleID != fx.UserRole {
		t.Errorf("new account role id = %d, want the \"user\" role (%d)", created.AppRoleID, fx.UserRole)
	}
	if created.AppRole == nil || created.AppRole.Role != "user" {
		t.Errorf("new account role = %v, want \"user\" — an auto-created account must never be an "+
			"admin", created.AppRole)
	}
	if created.AuthProvider != "google" || created.ProviderID != oauthTestAttackerSub {
		t.Errorf("auth_provider/provider_id = %q/%q, want google/%q",
			created.AuthProvider, created.ProviderID, oauthTestAttackerSub)
	}
	if created.FirstName != "Som" || created.LastName != "Chai" {
		t.Errorf("name stored as %q %q", created.FirstName, created.LastName)
	}
	if created.Profile != "https://example.invalid/avatar.png" {
		t.Errorf("profile = %q", created.Profile)
	}
	// The password column is a real bcrypt hash of a discarded random string, not an empty value
	// that some future comparison could treat as "no password required".
	if !strings.HasPrefix(created.Password, "$2") || len(created.Password) != 60 {
		t.Errorf("password hash = %q, want a 60-character bcrypt hash", created.Password)
	}
	if created.DeletedAt.Valid {
		t.Error("the new account was created already soft-deleted")
	}

	// There is nothing to activate: the account is signed in on the spot.
	assertSignedIn(t, fx, rec, created.ID, "user")
}

// The second visit of an account created that way must find it by provider id, not create another.
// It also proves the first visit stored a usable provider id.
func TestOAuthFinishFindsAnAutoCreatedAccountAgainByProviderID(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)

	info := verified(oauthTestAttackerSub, "returning@somewhere-else.invalid")
	info.FirstName, info.LastName = "A", "B"

	c1, rec1 := oauthFinishCtx(t)
	oauthFinish(c1, info, "google")
	if got := redirectTarget(t, rec1); got != oauthTestFrontend+"/admin" {
		t.Fatalf("first sign-in was refused: %s", got)
	}
	afterFirst := liveUserCount(t, fx)

	c2, rec2 := oauthFinishCtx(t)
	oauthFinish(c2, info, "google")
	if got := redirectTarget(t, rec2); got != oauthTestFrontend+"/admin" {
		t.Fatalf("second sign-in was refused: %s", got)
	}

	if after := liveUserCount(t, fx); after != afterFirst {
		t.Errorf("a second sign-in created another account (%d → %d)", afterFirst, after)
	}
}

// Branch 1 is keyed on (provider_id, auth_provider) TOGETHER, so the same subject string arriving
// from a different provider is a different identity — and, having an unknown email, is given its
// own account. Pinned so that a change to that key is visible.
func TestOAuthFinishTreatsTheSameSubjectFromAnotherProviderAsSomeoneElse(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)

	c1, rec1 := oauthFinishCtx(t)
	oauthFinish(c1, verified("shared-subject", "one@somewhere-else.invalid"), "google")
	if got := redirectTarget(t, rec1); got != oauthTestFrontend+"/admin" {
		t.Fatalf("the google sign-in was refused: %s", got)
	}
	afterFirst := liveUserCount(t, fx)

	c2, rec2 := oauthFinishCtx(t)
	oauthFinish(c2, verified("shared-subject", "two@somewhere-else.invalid"), "github")
	if got := redirectTarget(t, rec2); got != oauthTestFrontend+"/admin" {
		t.Fatalf("the github sign-in was refused: %s", got)
	}

	if after := liveUserCount(t, fx); after != afterFirst+1 {
		t.Errorf("user count %d → %d; the same subject from a different provider was treated as "+
			"the same person", afterFirst, after)
	}
}

// A provider that has changed the user's email must not strand them with a second account: branch 1
// matches on the provider id first, so the existing row wins and its stored email is left alone.
func TestOAuthFinishPrefersTheProviderIDOverADifferentEmail(t *testing.T) {
	fx := authTestDB(t)
	bound(t, fx, fx.UserID, "google", "google-sub-777")
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	info := verified("google-sub-777", "renamed-at-the-provider@test.invalid")
	info.FirstName, info.LastName = "Changed", "Name"
	oauthFinish(c, info, "google")

	redirectTarget(t, rec)
	assertSignedIn(t, fx, rec, fx.UserID, "user")

	if after := liveUserCount(t, fx); after != before {
		t.Errorf("user count %d → %d; a changed provider email created a duplicate account",
			before, after)
	}
	var user entity.AppUser
	if err := fx.DB.First(&user, fx.UserID).Error; err != nil {
		t.Fatalf("read the user back: %v", err)
	}
	// The local record is NOT updated from the provider. Worth knowing both ways: the console
	// keeps showing the old address, and a provider cannot overwrite it either.
	if user.Email != authTestUserEmail {
		t.Errorf("email = %q, want the stored %q — branch 1 does not refresh the profile",
			user.Email, authTestUserEmail)
	}
	if user.FirstName != "Test" {
		t.Errorf("first name = %q, want the stored \"Test\"", user.FirstName)
	}
}

// ── 4. A soft-deleted account ────────────────────────────────────────────────

// Removing somebody's access has to remove it.
//
// Both lookups used to run under GORM's default scope, which excludes `deleted_at IS NOT NULL`, so
// a deleted row was simply invisible: branch 3 ran and handed the person a BRAND NEW live account
// on the same address, leaving two accounts holding one address. Both lookups are Unscoped now and
// a deleted account is refused by name.
func TestOAuthFinishRefusesASoftDeletedAccountByAddress(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t) // creation is ON, so a miss here really would mint the duplicate
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	info := verified(oauthTestAttackerSub, authTestDeletedEmail)
	info.FirstName, info.LastName = "Back", "Again"
	oauthFinish(c, info, "google")

	assertRefused(t, fx, rec, "account_removed", before)

	// No live account now holds the deleted address, so Recycle Bin's Restore cannot collide.
	var live int64
	fx.DB.Model(&entity.AppUser{}).Where("email = ?", authTestDeletedEmail).Count(&live)
	if live != 0 {
		t.Errorf("%d live account(s) with the deleted address", live)
	}
	var deleted entity.AppUser
	if err := fx.DB.Unscoped().First(&deleted, fx.DeletedID).Error; err != nil {
		t.Fatalf("the original soft-deleted row is gone: %v", err)
	}
	if !deleted.DeletedAt.Valid {
		t.Error("the original row is no longer soft-deleted")
	}
}

// The same refusal by the other key: a deleted account whose provider identity is still bound is
// recognised by branch 1 and refused there, rather than falling through to the address branches.
func TestOAuthFinishRefusesASoftDeletedAccountByProviderID(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)
	bound(t, fx, fx.DeletedID, "google", "google-sub-gone")
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, verified("google-sub-gone", authTestDeletedEmail), "google")

	assertRefused(t, fx, rec, "account_removed", before)
}

// ── 5. Refusals ──────────────────────────────────────────────────────────────

// A profile with no email at all. It must refuse without writing anything and without a cookie —
// this is the guard that keeps a provider that withheld the address from creating an account keyed
// on "".
func TestOAuthFinishRefusesAProfileWithNoEmail(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, oauthUserInfo{
		ProviderID: oauthTestAttackerSub, EmailVerified: true,
		FirstName: "No", LastName: "Email",
	}, "google")

	assertRefused(t, fx, rec, "no_email", before)
}

// Branch 3 needs the "user" role row to exist. With it gone the flow must refuse rather than fall
// through to a zero AppRoleID, which would create an account pointing at no role — a row every
// `role` check in the console would then read as "".
func TestOAuthFinishRefusesWhenTheUserRoleIsMissing(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)
	// Soft-deleted, not removed: the seeded accounts point at this row, so a hard DELETE is
	// refused by the foreign key (fk_app_roles_app_user) and the test would fail for a reason that
	// has nothing to do with oauthFinish. A soft delete is what the console's own role deletion
	// does anyway, and it is enough — the lookup runs under GORM's default scope, so a
	// soft-deleted role is already invisible to it.
	if err := fx.DB.Where("role = ?", "user").Delete(&entity.AppRole{}).Error; err != nil {
		t.Fatalf("remove the user role: %v", err)
	}
	var stillVisible int64
	fx.DB.Model(&entity.AppRole{}).Where("role = ?", "user").Count(&stillVisible)
	if stillVisible != 0 {
		t.Fatalf("the user role is still visible to a normal query (%d rows), so this test cannot "+
			"prove anything", stillVisible)
	}
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	info := verified(oauthTestAttackerSub, "no-role-for-me@somewhere-else.invalid")
	info.FirstName, info.LastName = "A", "B"
	oauthFinish(c, info, "google")

	assertRefused(t, fx, rec, "server", before)
}

// ── 6. Maintenance mode ──────────────────────────────────────────────────────

// Maintenance mode must hold on the OAuth door too, or it is not a lock: a non-admin is refused
// with no cookie, and the admin — the only person who can switch it off — still gets in.
//
// Both accounts are bound to a provider identity first, so this test is about the maintenance gate
// and not about the password-account refusal that would otherwise answer it.
func TestOAuthFinishUnderMaintenanceLetsOnlyAdminsIn(t *testing.T) {
	fx := authTestDB(t)
	bound(t, fx, fx.UserID, "google", "pid-user")
	bound(t, fx, fx.AdminID, "google", "pid-admin")
	if err := fx.DB.Create(&entity.SystemConfig{Key: "maintenance_mode", Value: "true"}).Error; err != nil {
		t.Fatalf("enable maintenance: %v", err)
	}
	t.Cleanup(services.InvalidateMaintenanceCache)
	before := liveUserCount(t, fx)

	c, rec := oauthFinishCtx(t)
	oauthFinish(c, verified("pid-user", authTestUserEmail), "google")
	assertRefused(t, fx, rec, "maintenance", before)

	ac, arec := oauthFinishCtx(t)
	oauthFinish(ac, verified("pid-admin", authTestAdminEmail), "google")
	if got := redirectTarget(t, arec); got != oauthTestFrontend+"/admin" {
		t.Fatalf("admin Location = %q, want the landing page", got)
	}
	assertSignedIn(t, fx, arec, fx.AdminID, "admin")
}

// Maintenance mode now stops registration, rather than delaying the session.
//
// The gate used to run AFTER branch 3 had written the row, so a refused flow still left behind an
// account that worked the moment maintenance was switched off. It runs before the create now, and
// this test asserts the absence of that account — the part a redirect assertion cannot see.
func TestOAuthFinishUnderMaintenanceDoesNotMintTheAccount(t *testing.T) {
	fx := authTestDB(t)
	allowSignup(t)
	if err := fx.DB.Create(&entity.SystemConfig{Key: "maintenance_mode", Value: "true"}).Error; err != nil {
		t.Fatalf("enable maintenance: %v", err)
	}
	t.Cleanup(services.InvalidateMaintenanceCache)
	before := liveUserCount(t, fx)

	const during = "during-maintenance@somewhere-else.invalid"

	c, rec := oauthFinishCtx(t)
	info := verified(oauthTestAttackerSub, during)
	info.FirstName, info.LastName = "A", "B"
	oauthFinish(c, info, "google")

	assertRefused(t, fx, rec, "maintenance", before)

	var rows int64
	fx.DB.Unscoped().Model(&entity.AppUser{}).Where("email = ?", during).Count(&rows)
	if rows != 0 {
		t.Errorf("%d row(s) for %s; the account outlived the refusal and can sign in the moment "+
			"maintenance is switched off", rows, during)
	}
}

// ── 7. The session is the real output ────────────────────────────────────────

// Each successful flow must leave exactly one live session row for the token it handed out. Two
// rows, or none, both mean middleware.Authorizes will not behave the way the cookie implies.
func TestOAuthFinishIssuesExactlyOneSessionPerSignIn(t *testing.T) {
	fx := authTestDB(t)
	bound(t, fx, fx.UserID, "google", "pid-"+authTestUserEmail)
	bound(t, fx, fx.AdminID, "google", "pid-"+authTestAdminEmail)

	for i, email := range []string{authTestUserEmail, authTestAdminEmail} {
		c, rec := oauthFinishCtx(t)
		oauthFinish(c, verified("pid-"+email, email), "google")
		if got := redirectTarget(t, rec); got != oauthTestFrontend+"/admin" {
			t.Fatalf("%s was refused: %s", email, got)
		}

		ck := authCookie(rec)
		if ck == nil || ck.Value == "" {
			t.Fatalf("%s: no auth cookie", email)
		}
		var n int64
		fx.DB.Model(&entity.UserSession{}).
			Where("token_hash = ? AND is_revoked = false", hashToken(ck.Value)).Count(&n)
		if n != 1 {
			t.Errorf("%s: %d live session rows for the issued token, want 1", email, n)
		}
		var total int64
		fx.DB.Model(&entity.UserSession{}).Count(&total)
		if total != int64(i+1) {
			t.Errorf("after %d sign-ins there are %d session rows", i+1, total)
		}
	}
}

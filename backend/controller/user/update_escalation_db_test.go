package user

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// PATCH /update-users/:id — the endpoint the incident ran through.
//
// It is dual-use on purpose: an admin editing anyone from the Users page, and a user editing
// themselves from the Account page. That is also why it was the one that broke — "logged in" was
// enough, so a non-admin could PATCH the administrator's password (a complete takeover) or put
// app_role_id on their OWN record and become an admin.
//
// Every case below reads the row back out of Postgres afterwards. A refusal that answers 403 while
// the UPDATE already landed is exactly the bug, and only the row can tell the difference.

// ── the cross-account write: the takeover ───────────────────────────────────

func TestUpdateUserByIDRefusesACrossAccountWriteAndLeavesTheVictimAlone(t *testing.T) {
	fx := userTestDB(t)
	victimBefore := fx.reload(t, fx.AdminID)

	// The original exploit, verbatim: a plain user rewriting the administrator's password and
	// address so they own the account.
	body := `{"password":"` + userTestNewPass + `","email":"attacker@test.invalid","first_name":"Owned"}`
	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AdminID, body)
	UpdateUserByID(c)

	assertForbidden(t, rec, "a non-admin PATCHing the administrator")

	after := fx.reload(t, fx.AdminID)
	if after.Password != victimBefore.Password {
		t.Fatal("the administrator's password hash changed on a request that answered 403 — " +
			"this is the account takeover this endpoint is known for")
	}
	if after.Email != userTestAdminEmail || after.FirstName != victimBefore.FirstName {
		t.Fatalf("the administrator's record was edited by a non-admin: email=%q first_name=%q",
			after.Email, after.FirstName)
	}
	// And the new password must not work, which is the thing the attacker was actually after.
	if platform.CheckPasswordHash(userTestNewPass, after.Password) {
		t.Fatal("the attacker's password now opens the administrator's account")
	}
}

// Aiming at an id that does not exist must be refused the same way, not answered with 404: a
// different status for "no such user" turns this endpoint into a way to enumerate which ids exist.
func TestUpdateUserByIDDoesNotLeakWhichIDsExist(t *testing.T) {
	fx := userTestDB(t)

	for _, target := range []uint{fx.BobID, 99999} {
		body := `{"first_name":"Probe"}`
		c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", target, body)
		UpdateUserByID(c)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("target %d got %d, want 403 for both a real and an unused id — "+
				"differing answers tell a caller which accounts exist", target, rec.Code)
		}
	}
}

// ── the self-promotion: app_role_id on your own record ──────────────────────

func TestUpdateUserByIDRefusesSelfPromotionAndTheRoleStaysPut(t *testing.T) {
	fx := userTestDB(t)

	body := `{"first_name":"Alice","app_role_id":` + strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID, body)
	UpdateUserByID(c)

	assertForbidden(t, rec, "a non-admin setting app_role_id on their own record")
	if got := fx.roleOf(t, fx.AliceID); got != "user" {
		t.Fatalf("the caller's stored role is now %q — a non-admin promoted themselves", got)
	}
	// The refusal is whole: the legitimate half of the same body must not have been applied
	// either, or a caller could smuggle edits through a request that was supposed to be rejected.
	if got := fx.reload(t, fx.AliceID); got.FirstName != "Alice" {
		t.Errorf("first_name = %q — part of a refused request was still written", got.FirstName)
	}
}

// The gate is on the FIELD being present, not on the value differing from what is stored. That
// distinction matters: a check written as "is the new role different from the current one" is one
// off-by-one away from allowing the escalation, and it reads as passing while the role happens to
// match. Sending the caller's own current role id must still be refused.
func TestUpdateUserByIDRefusesTheRoleFieldEvenWhenTheValueIsUnchanged(t *testing.T) {
	fx := userTestDB(t)

	body := `{"app_role_id":` + strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID, body)
	UpdateUserByID(c)

	assertForbidden(t, rec, "a non-admin sending their own current app_role_id")
}

// An admin, by contrast, is what this field is for — and the proof is the stored role, not the
// response body, which is assembled from an in-memory struct the handler already holds.
//
// ⚠️ THIS TEST FAILS AGAINST THE CURRENT CODE, AND THE TEST IS NOT WRONG. Do not relax it.
//
// UpdateUserByID loads the row with Preload("AppRole"), assigns the new id to user.AppRoleID
// (user.go:367) and then calls db.Save(&user) (user.go:391). Save upserts the belongs-to
// association FIRST and then writes the association's primary key back into the owner's foreign
// key — so the stale user.AppRole pointer, still holding the OLD role, overwrites the new
// app_role_id on its way to Postgres. Measured directly: with AppRole preloaded the stored
// app_role_id stays 2 ("user"); with `user.AppRole = nil` before Save the same code stores 1
// ("admin").
//
// The handler then answers 200 and, because it sets user.AppRole = newRole for the response
// (user.go:403), hands back a body that says the role is now admin. The API reports a success it
// did not perform.
//
// Not currently reachable from the UI — ModalCreateandUpdateUser changes roles through
// PATCH /admin/users/:id (UpdateUserIDByAdmin), which builds a map and calls Updates, and which
// TestUpdateUserByIDWritesEveryFieldItAccepts proves does persist. But this endpoint accepts the
// field, authz.go's editUserDecision deliberately allows "admin changes another user's role"
// here, and authz_test.go asserts that very case — so an admin or any script using it is told the
// role moved when it did not. The fix belongs in production code (clear the association, or write
// the role through Updates like the admin twin does), not here.
func TestUpdateUserByIDLetsAnAdminChangeARoleForReal(t *testing.T) {
	fx := userTestDB(t)

	body := `{"app_role_id":` + strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AdminID, adminRoleName, fx.BobID, body)
	UpdateUserByID(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := fx.roleOf(t, fx.BobID); got != adminRoleName {
		t.Fatalf("stored role = %q, want admin — the admin's role change did not persist, "+
			"while the endpoint answered %d with %s", got, rec.Code, rec.Body.String())
	}
}

func TestUpdateUserByIDRejectsARoleThatDoesNotExist(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AdminID, adminRoleName, fx.BobID,
		`{"app_role_id":4242}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if got := fx.reload(t, fx.BobID); got.AppRoleID != fx.UserRoleID {
		t.Fatalf("app_role_id = %d — a role id that does not exist was written anyway", got.AppRoleID)
	}
}

// ── a user editing their own profile: the half that must keep working ───────

func TestUpdateUserByIDLetsTheOwnerEditTheirOwnProfile(t *testing.T) {
	fx := userTestDB(t)

	body := `{"first_name":"Alicia","last_name":"Keys","phone_number":"0899999999",` +
		`"location":"Phuket","position":"Engineer","profile":"https://cdn.test.invalid/a.png"}`
	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID, body)
	UpdateUserByID(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — the Account page edits a profile through here: %s",
			rec.Code, rec.Body.String())
	}
	got := fx.reload(t, fx.AliceID)
	if got.FirstName != "Alicia" || got.LastName != "Keys" || got.Position != "Engineer" ||
		got.Location != "Phuket" || got.PhoneNumber != "0899999999" {
		t.Fatalf("the owner's own edit did not persist: %+v", got)
	}
	if got.AppRoleID != fx.UserRoleID {
		t.Errorf("a profile edit moved the role to %d", got.AppRoleID)
	}
}

func TestUpdateUserByIDRotatesTheOwnersOwnPassword(t *testing.T) {
	fx := userTestDB(t)
	before := fx.reload(t, fx.AliceID)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
		`{"password":"`+userTestNewPass+`"}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	after := fx.reload(t, fx.AliceID)
	if after.Password == before.Password {
		t.Fatal("the password hash did not change")
	}
	if after.Password == userTestNewPass || !strings.HasPrefix(after.Password, "$2") {
		t.Fatalf("the new password was not stored as a bcrypt hash: %q", after.Password)
	}
	if !platform.CheckPasswordHash(userTestNewPass, after.Password) {
		t.Fatal("the stored hash does not verify against the password that was set")
	}
	if platform.CheckPasswordHash(userTestPassword, after.Password) {
		t.Fatal("the old password still verifies after a rotation")
	}
	if after.PasswordChangedAt == nil || time.Since(*after.PasswordChangedAt) > time.Minute {
		t.Errorf("password_changed_at = %v — the expiry clock was not restarted", after.PasswordChangedAt)
	}
}

// The password rules are owned by /admin/password-policy, not by this package. The fixture stores
// a real policy (12 chars, upper, digit, special) in system_configs; this proves the handler
// consults it and that a refusal leaves the old hash in place.
func TestUpdateUserByIDRefusesAPasswordThePolicyRejects(t *testing.T) {
	fx := userTestDB(t)
	before := fx.reload(t, fx.AliceID)

	for _, bad := range []string{"short", "alllowercase123!", "NoDigitsHere!!", "N0SpecialChars"} {
		c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
			`{"password":"`+bad+`"}`)
		UpdateUserByID(c)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("password %q got %d, want 400 from the stored policy: %s",
				bad, rec.Code, rec.Body.String())
		}
		if after := fx.reload(t, fx.AliceID); after.Password != before.Password {
			t.Fatalf("password %q was refused with 400 but the hash changed anyway", bad)
		}
	}
}

// Re-setting a password the account has used recently is refused — the history depth comes from
// the same policy row. Seeded through services.SavePasswordHistory, which is what the handlers
// themselves call.
func TestUpdateUserByIDRefusesAPasswordAlreadyInTheHistory(t *testing.T) {
	fx := userTestDB(t)
	services.SavePasswordHistory(fx.DB, fx.AliceID, seededHash)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
		`{"password":"`+userTestPassword+`"}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a password already on record: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "different") {
		t.Errorf("the refusal does not explain itself: %s", rec.Body.String())
	}
}

// ── the rest of the request's validation surface ────────────────────────────

func TestUpdateUserByIDRefusesADuplicateEmail(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
		`{"email":"`+userTestBobEmail+`"}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if got := fx.reload(t, fx.AliceID); got.Email != userTestAliceEmail {
		t.Fatalf("email = %q — a duplicate address was written", got.Email)
	}
}

// The caller's OWN address is not a duplicate of itself: the check excludes the row being edited,
// which is what lets somebody re-save their profile without changing their email.
func TestUpdateUserByIDAcceptsTheCallersOwnEmailUnchanged(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
		`{"email":"`+strings.ToUpper(userTestAliceEmail)+`","first_name":"Alice"}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	// Addresses are stored lower-cased, so the login lookup cannot be bypassed by case.
	if got := fx.reload(t, fx.AliceID); got.Email != userTestAliceEmail {
		t.Fatalf("email = %q, want the lower-cased %q", got.Email, userTestAliceEmail)
	}
}

func TestUpdateUserByIDRefusesAnEmptyRequest(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID, `{}`)
	UpdateUserByID(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no fields to update") {
		t.Errorf("unexpected refusal: %s", rec.Body.String())
	}
}

func TestUpdateUserByIDRefusesAnAvatarItWillNotServe(t *testing.T) {
	fx := userTestDB(t)
	before := fx.reload(t, fx.AliceID)

	cases := map[string]string{
		"an HTML data URI in an <img src>": "data:text/html;base64," + strings.Repeat("A", 32),
		"a payload past the size cap":      "data:image/png;base64," + strings.Repeat("A", maxAvatarBytes),
	}
	for name, profile := range cases {
		t.Run(name, func(t *testing.T) {
			c, rec := asUser(t, http.MethodPatch, "/update-users", fx.AliceID, "user", fx.AliceID,
				`{"profile":"`+profile+`"}`)
			UpdateUserByID(c)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
			if after := fx.reload(t, fx.AliceID); after.Profile != before.Profile {
				t.Fatalf("the refused avatar was stored anyway (%d bytes)", len(after.Profile))
			}
		})
	}
}

func TestUpdateUserByIDRejectsANonNumericID(t *testing.T) {
	fx := userTestDB(t)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPatch, "/update-users/abc",
		strings.NewReader(`{"first_name":"x"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: "abc"}}
	c.Set("user_role", adminRoleName)
	c.Set("user_id", fx.AdminID)
	UpdateUserByID(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
}

// ── PATCH /admin/users/:id — the admin-only twin ────────────────────────────
//
// Same job, different write strategy: this one builds a map and calls Updates, which means a bug
// here looks like "the field silently did not move" rather than a 500. The refusal for a non-admin
// is in the table in handler_authz_db_test.go; what follows is what it must do when allowed, and
// where it must refuse an admin.

func TestUpdateUserIDByAdminWritesEveryFieldItAccepts(t *testing.T) {
	fx := userTestDB(t)

	body := `{"email":"bob2@test.invalid","first_name":"Bobby","last_name":"Tables",` +
		`"phone_number":"0811111111","location":"Nonthaburi","position":"Lead",` +
		`"profile":"https://cdn.test.invalid/b.png","password":"` + userTestNewPass + `",` +
		`"app_role_id":` + strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/admin/users", fx.AdminID, adminRoleName, fx.BobID, body)
	UpdateUserIDByAdmin(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	got := fx.reload(t, fx.BobID)
	if got.Email != "bob2@test.invalid" || got.FirstName != "Bobby" || got.LastName != "Tables" ||
		got.PhoneNumber != "0811111111" || got.Location != "Nonthaburi" || got.Position != "Lead" ||
		got.Profile != "https://cdn.test.invalid/b.png" || got.AppRoleID != fx.AdminRoleID {
		t.Fatalf("an admin's edit did not land in full: %+v", got)
	}
	if !platform.CheckPasswordHash(userTestNewPass, got.Password) {
		t.Fatal("the password set by the admin does not verify")
	}
	if got.Password == userTestNewPass {
		t.Fatal("the admin update stored the password in plain text")
	}
	if got.PasswordChangedAt == nil {
		t.Error("password_changed_at was not stamped by the admin update")
	}
}

// Demoting the final administrator would leave user management unreachable with no bootstrap path
// back, so it is refused — and the row must still say admin afterwards.
func TestUpdateUserIDByAdminWillNotDemoteTheLastAdministrator(t *testing.T) {
	fx := userTestDB(t)

	body := `{"app_role_id":` + strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/admin/users", fx.AdminID, adminRoleName, fx.AdminID, body)
	UpdateUserIDByAdmin(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if got := fx.roleOf(t, fx.AdminID); got != adminRoleName {
		t.Fatalf("the last administrator is now %q — the console has no administrator left", got)
	}

	// With a second admin in place the same request is allowed, which is what makes the guard a
	// guard rather than a permanent lock.
	fx.addAdmin(t, "second-admin@test.invalid")
	c2, rec2 := asUser(t, http.MethodPatch, "/admin/users", fx.AdminID, adminRoleName, fx.AdminID, body)
	UpdateUserIDByAdmin(c2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 once another admin exists: %s", rec2.Code, rec2.Body.String())
	}
	if got := fx.roleOf(t, fx.AdminID); got != "user" {
		t.Fatalf("stored role = %q, want user — the demotion did not persist", got)
	}
}

func TestUpdateUserIDByAdminRefusesWhatItCannotStore(t *testing.T) {
	cases := map[string]struct {
		body func(fx *userFixture) string
		want int
	}{
		"an address another account holds": {
			func(fx *userFixture) string { return `{"email":"` + userTestAliceEmail + `"}` },
			http.StatusBadRequest,
		},
		"a role id that does not exist": {
			func(fx *userFixture) string { return `{"app_role_id":4242}` },
			http.StatusBadRequest,
		},
		"a password the policy rejects": {
			func(fx *userFixture) string { return `{"password":"short"}` },
			http.StatusBadRequest,
		},
		"an avatar that is not an image": {
			func(fx *userFixture) string { return `{"profile":"data:text/html;base64,AAAA"}` },
			http.StatusBadRequest,
		},
		"nothing at all": {
			func(fx *userFixture) string { return `{}` },
			http.StatusBadRequest,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fx := userTestDB(t)
			before := fx.reload(t, fx.BobID)

			c, rec := asUser(t, http.MethodPatch, "/admin/users", fx.AdminID, adminRoleName,
				fx.BobID, tc.body(fx))
			UpdateUserIDByAdmin(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			after := fx.reload(t, fx.BobID)
			if after.Email != before.Email || after.Password != before.Password ||
				after.AppRoleID != before.AppRoleID || after.Profile != before.Profile {
				t.Fatalf("a refused admin update still wrote: %+v", after)
			}
		})
	}
}

func TestUpdateUserIDByAdminIs404ForAnAccountThatIsNotThere(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPatch, "/admin/users", fx.AdminID, adminRoleName, 99999,
		`{"first_name":"Ghost"}`)
	UpdateUserIDByAdmin(c)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// ── PATCH /users/bulk-role ──────────────────────────────────────────────────

func TestBulkChangeRoleMovesEveryNamedAccountAndNoOthers(t *testing.T) {
	fx := userTestDB(t)

	body := `{"ids":[` + strconv.FormatUint(uint64(fx.AliceID), 10) + `,` +
		strconv.FormatUint(uint64(fx.BobID), 10) + `],"app_role_id":` +
		strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/users/bulk-role", fx.AdminID, adminRoleName, 0, body)
	BulkChangeRole(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	for _, id := range []uint{fx.AliceID, fx.BobID} {
		if got := fx.roleOf(t, id); got != adminRoleName {
			t.Errorf("user %d is %q, want admin", id, got)
		}
	}
}

func TestBulkChangeRoleWillNotEmptyTheAdminPool(t *testing.T) {
	fx := userTestDB(t)

	body := `{"ids":[` + strconv.FormatUint(uint64(fx.AdminID), 10) + `],"app_role_id":` +
		strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/users/bulk-role", fx.AdminID, adminRoleName, 0, body)
	BulkChangeRole(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if got := fx.roleOf(t, fx.AdminID); got != adminRoleName {
		t.Fatalf("the only administrator was demoted to %q by a bulk role change", got)
	}
}

func TestBulkChangeRoleRefusesAnIncompleteRequest(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"no ids":                   {`{"ids":[],"app_role_id":1}`, http.StatusBadRequest},
		"no role":                  {`{"ids":[2]}`, http.StatusBadRequest},
		"a role that is not there": {`{"ids":[2],"app_role_id":4242}`, http.StatusBadRequest},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fx := userTestDB(t)
			before := snapshotUsers(t, fx)

			c, rec := asUser(t, http.MethodPatch, "/users/bulk-role", fx.AdminID, adminRoleName, 0, tc.body)
			BulkChangeRole(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			if after := snapshotUsers(t, fx); after != before {
				t.Fatalf("a refused bulk role change still wrote:\nbefore: %s\nafter:  %s", before, after)
			}
		})
	}
}

// hasOtherAdmin is the query both guards above lean on. Exercised directly as well, because the
// joined query — app_users JOIN app_roles filtered by role name, excluding a set of ids — is the
// kind of thing that quietly returns the wrong count when the join column changes.
func TestHasOtherAdminCountsOnlyLiveAdminsOutsideTheSet(t *testing.T) {
	fx := userTestDB(t)
	secondAdmin := fx.addAdmin(t, "second-admin@test.invalid")

	for _, tc := range []struct {
		name      string
		excluding []uint
		want      bool
	}{
		{"nobody excluded", nil, true},
		{"one of two admins excluded", []uint{fx.AdminID}, true},
		{"both admins excluded", []uint{fx.AdminID, secondAdmin}, false},
		{"only non-admins excluded", []uint{fx.AliceID, fx.BobID}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := hasOtherAdmin(fx.DB, tc.excluding)
			if err != nil {
				t.Fatalf("hasOtherAdmin: %v", err)
			}
			if got != tc.want {
				t.Errorf("hasOtherAdmin(excluding %v) = %v, want %v", tc.excluding, got, tc.want)
			}
		})
	}

	// A soft-deleted admin is not an administrator anyone can sign in as, so it must not keep the
	// guard quiet — otherwise deleting the second-to-last admin and then the last one would be
	// allowed, one at a time, and leave nobody.
	if err := fx.DB.Delete(&entity.AppUser{}, secondAdmin).Error; err != nil {
		t.Fatalf("soft-delete second admin: %v", err)
	}
	got, err := hasOtherAdmin(fx.DB, []uint{fx.AdminID})
	if err != nil {
		t.Fatalf("hasOtherAdmin: %v", err)
	}
	if got {
		t.Error("a soft-deleted account still counts as the remaining administrator — " +
			"the last live admin could be removed on top of it")
	}
}

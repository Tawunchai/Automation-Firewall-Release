package user

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"network_automation/entity"
	"network_automation/services/platform"
)

// POST /create-users, through the handler.
//
// createuser_test.go already covers the two validation LAYERS in isolation — gin's binding tags
// and govalidator on entity.AppUser — because the bug it was written for was that those two layers
// each demanded fields the form does not collect, so the Create User button returned 400 every
// single time. Those cases are not repeated here.
//
// What is here is the handler: that it is admin-only, that an accepted request actually produces
// an account that can sign in, that the password is hashed and checked against the policy stored
// at /admin/password-policy, and that each refusal leaves no half-made row behind.

const newUserEmail = "newhire@test.invalid"

func createUserBody(fx *userFixture, password string) string {
	return `{"email":"` + newUserEmail + `","password":"` + password +
		`","first_name":"New","last_name":"Hire","app_role_id":` +
		strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
}

// The happy path, and the only definition of "created" that matters: the account exists, holds a
// bcrypt hash of the password that was asked for, carries the role it was given, and the sign-in
// lookup can find it.
func TestCreateUserMakesAnAccountThatCanSignIn(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0,
		createUserBody(fx, userTestNewPass))
	CreateUser(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}

	var created entity.AppUser
	if err := fx.DB.Preload("AppRole").Where("email = ?", newUserEmail).First(&created).Error; err != nil {
		t.Fatalf("the account was not written: %v", err)
	}
	if created.FirstName != "New" || created.LastName != "Hire" {
		t.Errorf("stored name = %q %q", created.FirstName, created.LastName)
	}
	if created.AppRole == nil || created.AppRole.Role != "user" {
		t.Errorf("stored role = %+v, want user", created.AppRole)
	}
	if created.Password == userTestNewPass || !strings.HasPrefix(created.Password, "$2") {
		t.Fatalf("the password was not hashed: %q", created.Password)
	}
	if !platform.CheckPasswordHash(userTestNewPass, created.Password) {
		t.Fatal("the stored hash does not verify against the password the admin set")
	}
	// The response is what the Users page renders; a hash must not be in it.
	// `password_expired` is a legitimate field on the response; a `"password":` key is not.
	if strings.Contains(rec.Body.String(), "$2") || strings.Contains(rec.Body.String(), `"password":`) {
		t.Fatalf("the 201 response carried password material: %s", rec.Body.String())
	}
}

// An address is matched case-insensitively and stored lower-cased, so two accounts cannot be
// created whose addresses differ only in case — the login lookup is case-insensitive and would
// have two candidates.
func TestCreateUserNormalisesTheAddress(t *testing.T) {
	fx := userTestDB(t)

	body := `{"email":"MixedCase@TEST.invalid","password":"` + userTestNewPass +
		`","first_name":" New ","last_name":" Hire ","app_role_id":` +
		strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0, body)
	CreateUser(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	var created entity.AppUser
	if err := fx.DB.Where("email = ?", "mixedcase@test.invalid").First(&created).Error; err != nil {
		t.Fatalf("the address was not lower-cased on the way in: %v", err)
	}
	if created.FirstName != "New" || created.LastName != "Hire" {
		t.Errorf("surrounding whitespace was stored: %q %q", created.FirstName, created.LastName)
	}
}

// An address with surrounding whitespace is refused at the binding layer, before the handler's own
// strings.TrimSpace ever runs — gin's `email` tag does not tolerate the padding. Pinned because it
// is the API's contract and it is easy to read the TrimSpace in CreateUser as meaning otherwise:
// the browser never hits it (ModalCreateandUpdateUser sends formData.email.trim()), but anything
// calling the endpoint directly has to trim for itself.
func TestCreateUserRequiresAnAlreadyTrimmedAddress(t *testing.T) {
	fx := userTestDB(t)

	body := `{"email":"  spaced@test.invalid ","password":"` + userTestNewPass +
		`","first_name":"New","last_name":"Hire","app_role_id":` +
		strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c, rec := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0, body)
	CreateUser(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	var n int64
	fx.DB.Unscoped().Model(&entity.AppUser{}).Where("email LIKE ?", "%spaced%").Count(&n)
	if n != 0 {
		t.Fatalf("%d row(s) were written for a refused address", n)
	}
}

// Every refusal, with the same assertion attached to each: the user table is untouched. A 400 that
// left a row behind would be worse than the original "400 on everything" bug, because the Users
// page would show an account nobody meant to create.
func TestCreateUserRefusalsLeaveNoRowBehind(t *testing.T) {
	cases := map[string]struct {
		body func(fx *userFixture) string
		want int
	}{
		// The field-by-field binding matrix lives in createuser_test.go; these two are here to
		// prove the HANDLER returns the refusal rather than a 500 or a partial write.
		"no email at all": {
			func(fx *userFixture) string {
				return `{"password":"` + userTestNewPass + `","first_name":"a","last_name":"b","app_role_id":1}`
			},
			http.StatusBadRequest,
		},
		"an address that is not an address": {
			func(fx *userFixture) string {
				return `{"email":"not-an-email","password":"` + userTestNewPass +
					`","first_name":"a","last_name":"b","app_role_id":1}`
			},
			http.StatusBadRequest,
		},
		"an address an existing account already holds": {
			func(fx *userFixture) string {
				return `{"email":"` + userTestAliceEmail + `","password":"` + userTestNewPass +
					`","first_name":"a","last_name":"b","app_role_id":` +
					strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
			},
			http.StatusBadRequest,
		},
		"a password the stored policy rejects": {
			func(fx *userFixture) string { return createUserBody(fx, "weak") },
			http.StatusBadRequest,
		},
		"a password with no digit, which the policy requires": {
			func(fx *userFixture) string { return createUserBody(fx, "NoDigitsAtAll!") },
			http.StatusBadRequest,
		},
		"a role that does not exist": {
			func(fx *userFixture) string {
				return `{"email":"` + newUserEmail + `","password":"` + userTestNewPass +
					`","first_name":"a","last_name":"b","app_role_id":4242}`
			},
			http.StatusBadRequest,
		},
		"an avatar that is not an image": {
			func(fx *userFixture) string {
				return `{"email":"` + newUserEmail + `","password":"` + userTestNewPass +
					`","first_name":"a","last_name":"b","profile":"data:text/html;base64,AAAA",` +
					`"app_role_id":` + strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
			},
			http.StatusBadRequest,
		},
		"an avatar past the size cap": {
			func(fx *userFixture) string {
				return `{"email":"` + newUserEmail + `","password":"` + userTestNewPass +
					`","first_name":"a","last_name":"b","profile":"data:image/png;base64,` +
					strings.Repeat("A", maxAvatarBytes) + `","app_role_id":` +
					strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
			},
			http.StatusBadRequest,
		},
		"a body that is not JSON": {
			func(fx *userFixture) string { return `{"email":` },
			http.StatusBadRequest,
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fx := userTestDB(t)
			before := snapshotUsers(t, fx)

			c, rec := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0, tc.body(fx))
			CreateUser(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			if after := snapshotUsers(t, fx); after != before {
				t.Fatalf("a refused create still changed the user table:\nbefore: %s\nafter:  %s",
					before, after)
			}
		})
	}
}

// The policy really is the gate, not a hardcoded rule: loosen the stored policy and the same
// password that was refused above is accepted. This is the half that proves these handlers read
// /admin/password-policy instead of enforcing their own idea of a strong password.
func TestCreateUserFollowsTheStoredPolicyWhenItIsLoosened(t *testing.T) {
	fx := userTestDB(t)

	for key, value := range map[string]string{
		"password_min_length":        "4",
		"password_require_uppercase": "false",
		"password_require_number":    "false",
		"password_require_special":   "false",
	} {
		if err := fx.DB.Model(&entity.SystemConfig{}).
			Where("key = ?", key).Update("value", value).Error; err != nil {
			t.Fatalf("loosen policy %s: %v", key, err)
		}
	}

	c, rec := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0,
		createUserBody(fx, "weak"))
	CreateUser(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 — the policy at /admin/password-policy now allows this "+
			"password, so something else is enforcing a rule of its own: %s", rec.Code, rec.Body.String())
	}
}

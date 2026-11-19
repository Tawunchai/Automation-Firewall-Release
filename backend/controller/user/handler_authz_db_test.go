package user

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/entity"
)

// The authorisation boundary of every user-management handler, exercised through the handler.
//
// This is the test that would have caught the incident. The decision helpers in authz.go are all
// at 100% in authz_test.go — and they were at 100% while the handlers that needed them did not
// call them. What follows aims each registered handler at a request the way routes.go does, as a
// non-admin, as a non-admin with nothing stamped on the context, and as an admin, and checks the
// row afterwards.

// ── the admin-only handlers ─────────────────────────────────────────────────

// adminOnlyCall names one registered handler and a request that reaches it.
type adminOnlyCall struct {
	name    string
	method  string
	path    string
	target  func(fx *userFixture) uint // the :id param, 0 for the collection endpoints
	body    func(fx *userFixture) string
	handler func(*gin.Context)
}

// adminOnlyHandlers is every handler in this package whose gate is "admin, full stop" — i.e. every
// one that starts with requireAdmin. Keeping it as one list is deliberate: a new user-management
// handler added without a gate shows up here as a missing entry, which is the shape the original
// bug had.
func adminOnlyHandlers() []adminOnlyCall {
	return []adminOnlyCall{
		{
			name: "GET /users/stats", method: http.MethodGet, path: "/users/stats",
			handler: GetStats,
		},
		{
			name: "GET /users", method: http.MethodGet, path: "/users",
			handler: ListUser,
		},
		{
			name: "GET /email-phone-numbers", method: http.MethodGet, path: "/email-phone-numbers",
			handler: ListEmailAndPhoneNumber,
		},
		{
			name: "POST /create-users", method: http.MethodPost, path: "/create-users",
			body: func(fx *userFixture) string {
				return `{"email":"intruder@test.invalid","password":"` + userTestNewPass +
					`","first_name":"In","last_name":"Truder","app_role_id":` +
					strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
			},
			handler: CreateUser,
		},
		{
			name: "DELETE /delete-users/:id", method: http.MethodDelete, path: "/delete-users",
			target:  func(fx *userFixture) uint { return fx.BobID },
			handler: DeleteUserByID,
		},
		{
			name: "PATCH /admin/users/:id", method: http.MethodPatch, path: "/admin/users",
			target: func(fx *userFixture) uint { return fx.BobID },
			body: func(fx *userFixture) string {
				return `{"app_role_id":` + strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
			},
			handler: UpdateUserIDByAdmin,
		},
		{
			name: "POST /users/bulk-delete", method: http.MethodPost, path: "/users/bulk-delete",
			body: func(fx *userFixture) string {
				return `{"ids":[` + strconv.FormatUint(uint64(fx.BobID), 10) + `]}`
			},
			handler: BulkDeleteUsers,
		},
		{
			name: "PATCH /users/bulk-role", method: http.MethodPatch, path: "/users/bulk-role",
			body: func(fx *userFixture) string {
				return `{"ids":[` + strconv.FormatUint(uint64(fx.AliceID), 10) +
					`],"app_role_id":` + strconv.FormatUint(uint64(fx.AdminRoleID), 10) + `}`
			},
			handler: BulkChangeRole,
		},
	}
}

// A non-admin is refused by every admin-only handler, and — the part a status code alone does not
// prove — the firewall-console's user table is exactly as it was afterwards. Each body above is a
// request that WOULD have done something: promote the caller, delete an account, create a new
// admin. A 403 that still performed it is the original bug wearing a better error message.
func TestAdminOnlyHandlersRefuseANonAdminAndChangeNothing(t *testing.T) {
	for _, call := range adminOnlyHandlers() {
		for _, caller := range []struct {
			label string
			role  string
		}{
			{"role=user", "user"},
			{"role=readonly", "readonly"},  // the console's third role
			{"nothing on the context", ""}, // a misconfiguration must fail closed
		} {
			t.Run(call.name+" / "+caller.label, func(t *testing.T) {
				fx := userTestDB(t)

				// A caller with no role is a caller with no identity either: the handler must
				// refuse it without ever reading the context's id.
				id := uint(0)
				if caller.role != "" {
					id = fx.AliceID
				}
				body := ""
				if call.body != nil {
					body = call.body(fx)
				}
				target := uint(0)
				if call.target != nil {
					target = call.target(fx)
				}
				path := call.path
				if target != 0 {
					path += "/" + strconv.FormatUint(uint64(target), 10)
				}

				before := snapshotUsers(t, fx)

				c, rec := asUser(t, call.method, path, id, caller.role, target, body)
				call.handler(c)

				assertForbidden(t, rec, call.name)
				if body := rec.Body.String(); strings.Contains(body, "@test.invalid") {
					t.Errorf("%s refused the caller but the response still carried account data: %s",
						call.name, body)
				}
				if after := snapshotUsers(t, fx); after != before {
					t.Errorf("%s answered 403 but the user table changed.\nbefore: %s\nafter:  %s",
						call.name, before, after)
				}
			})
		}
	}
}

// snapshotUsers renders every live account as one comparable string: id, email and role name.
//
// It is the cheapest honest answer to "did that refusal change anything" — it moves if a row is
// created, deleted, renamed, or has its role reassigned, which covers every write these handlers
// can perform.
func snapshotUsers(t *testing.T, fx *userFixture) string {
	t.Helper()
	var users []entity.AppUser
	if err := fx.DB.Preload("AppRole").Order("id asc").Find(&users).Error; err != nil {
		t.Fatalf("snapshot users: %v", err)
	}
	var b strings.Builder
	for _, u := range users {
		role := ""
		if u.AppRole != nil {
			role = u.AppRole.Role
		}
		b.WriteString(strconv.FormatUint(uint64(u.ID), 10) + ":" + u.Email + ":" + role + ":" +
			u.FirstName + ":" + u.Password + "; ")
	}
	return b.String()
}

// The other half of the same gate: an admin is not blocked by it. A test suite that only proves
// refusals is satisfied by a handler that refuses everyone, which would take the Users page with
// it.
func TestAdminOnlyHandlersAllowAnAdmin(t *testing.T) {
	for _, call := range adminOnlyHandlers() {
		t.Run(call.name, func(t *testing.T) {
			fx := userTestDB(t)
			// A second administrator, so the "last administrator" guards on the delete and
			// role-change endpoints do not answer instead of the thing under test.
			fx.addAdmin(t, "second-admin@test.invalid")

			body := ""
			if call.body != nil {
				body = call.body(fx)
			}
			target := uint(0)
			if call.target != nil {
				target = call.target(fx)
			}
			path := call.path
			if target != 0 {
				path += "/" + strconv.FormatUint(uint64(target), 10)
			}

			c, rec := asUser(t, call.method, path, fx.AdminID, adminRoleName, target, body)
			call.handler(c)

			if rec.Code == http.StatusForbidden {
				t.Fatalf("%s refused an admin: %s", call.name, rec.Body.String())
			}
			if rec.Code >= 500 {
				t.Fatalf("%s failed for an admin with %d: %s", call.name, rec.Code, rec.Body.String())
			}
		})
	}
}

// ── GET /users/:id — the IDOR that let any session walk the directory ───────
//
// list_by_id_authz_test.go already pins the refusal, without a database, because the check runs
// before any query. What it cannot show is the other two thirds of the rule: that the owner and
// the admin really get the record, and that the refusal is not just an early return in front of a
// handler that would have answered anyway.

func TestListUserByIDServesTheOwnerAndTheAdminOnly(t *testing.T) {
	fx := userTestDB(t)

	t.Run("owner reads their own record", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users", fx.AliceID, "user", fx.AliceID, "")
		ListUserByID(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 — the Account page reads the caller's own record here: %s",
				rec.Code, rec.Body.String())
		}
		var got map[string]any
		decodeJSON(t, rec, &got)
		if got["email"] != userTestAliceEmail {
			t.Errorf("email = %v, want %s", got["email"], userTestAliceEmail)
		}
	})

	t.Run("admin reads someone else's record", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users", fx.AdminID, adminRoleName, fx.BobID, "")
		ListUserByID(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
		}
		var got map[string]any
		decodeJSON(t, rec, &got)
		if got["email"] != userTestBobEmail {
			t.Errorf("email = %v, want %s", got["email"], userTestBobEmail)
		}
	})

	t.Run("non-admin reading another real account leaks nothing", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users", fx.AliceID, "user", fx.BobID, "")
		ListUserByID(c)
		assertForbidden(t, rec, "GET /users/:id across accounts")
		if strings.Contains(rec.Body.String(), userTestBobEmail) {
			t.Fatalf("the refusal carried the victim's email: %s", rec.Body.String())
		}
	})

	t.Run("a missing id is a 404, not someone else's row", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users", fx.AdminID, adminRoleName, 99999, "")
		ListUserByID(c)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("a non-numeric id is rejected", func(t *testing.T) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/users/not-a-number", nil)
		c.Params = gin.Params{{Key: "id", Value: "not-a-number"}}
		c.Set("user_role", adminRoleName)
		c.Set("user_id", fx.AdminID)
		ListUserByID(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
		}
	})
}

// ── the handlers that are NOT admin-only, and must not be ───────────────────

// GET /roles has no admin gate, and that is a decision rather than an omission: the Create/Edit
// User dialog and the profile page both need the role names, and the response carries nothing but
// an id and a label — no account data at all. This pins the shape so a future change cannot
// quietly start returning more than that through an ungated endpoint.
func TestListRolesIsOpenToAnySessionAndReturnsOnlyLabels(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodGet, "/roles", fx.AliceID, "user", 0, "")
	ListRoles(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a signed-in non-admin: %s", rec.Code, rec.Body.String())
	}
	var roles []map[string]any
	decodeJSON(t, rec, &roles)
	if len(roles) != 2 {
		t.Fatalf("got %d roles, want the 2 the fixture seeded: %s", len(roles), rec.Body.String())
	}
	for _, r := range roles {
		if len(r) != 2 || r["id"] == nil || r["role"] == nil {
			t.Fatalf("a role row carries more than {id, role}: %v", r)
		}
	}
	// Ordered by id, which is what the dialog's dropdown relies on.
	if roles[0]["role"] != adminRoleName {
		t.Errorf("first role = %v, want %s (ordered by id)", roles[0]["role"], adminRoleName)
	}
}

// PATCH /theme-preference takes no id: it writes to whoever the token says the caller is. That is
// what makes it safe for a non-admin, and it is worth pinning, because the obvious "improvement"
// of accepting a user id in the body or path would turn a harmless preference endpoint into a
// write primitive against any account.
func TestUpdateThemePreferenceOnlyEverWritesTheCallersOwnRow(t *testing.T) {
	fx := userTestDB(t)

	// Alice asks for a theme while ALSO naming Bob's id in the body, every way the handler could
	// plausibly have read one.
	body := `{"theme_mode":"Dark","theme_color":"#10B981","id":` +
		strconv.FormatUint(uint64(fx.BobID), 10) + `,"user_id":` +
		strconv.FormatUint(uint64(fx.BobID), 10) + `}`
	c, rec := asUser(t, http.MethodPatch, "/theme-preference", fx.AliceID, "user", 0, body)
	UpdateThemePreference(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := fx.reload(t, fx.AliceID); got.ThemeMode != "Dark" || got.ThemeColor != "#10B981" {
		t.Errorf("the caller's own theme was not saved: mode=%q color=%q", got.ThemeMode, got.ThemeColor)
	}
	bob := fx.reload(t, fx.BobID)
	if bob.ThemeMode == "Dark" || bob.ThemeColor == "#10B981" {
		t.Fatalf("a user id in the body steered the write onto another account: bob mode=%q color=%q",
			bob.ThemeMode, bob.ThemeColor)
	}
}

func TestUpdateThemePreferenceRefusesWhatItCannotStore(t *testing.T) {
	fx := userTestDB(t)
	before := fx.reload(t, fx.AliceID)

	cases := map[string]struct {
		body string
		want int
	}{
		"no caller on the context": {`{"theme_mode":"Dark"}`, http.StatusUnauthorized},
		"an unknown theme mode":    {`{"theme_mode":"Midnight"}`, http.StatusBadRequest},
		"a colour that is not hex": {`{"theme_color":"forest green"}`, http.StatusBadRequest},
		"a short hex colour":       {`{"theme_color":"#10B98"}`, http.StatusBadRequest},
		"nothing at all":           {`{}`, http.StatusBadRequest},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			caller := fx.AliceID
			role := "user"
			if tc.want == http.StatusUnauthorized {
				caller, role = 0, ""
			}
			c, rec := asUser(t, http.MethodPatch, "/theme-preference", caller, role, 0, tc.body)
			UpdateThemePreference(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			after := fx.reload(t, fx.AliceID)
			if after.ThemeMode != before.ThemeMode || after.ThemeColor != before.ThemeColor {
				t.Fatalf("a refused theme request still wrote: mode=%q color=%q",
					after.ThemeMode, after.ThemeColor)
			}
		})
	}
}

// ── what an admin actually gets back ────────────────────────────────────────

// The directory endpoints are admin-only (directory_authz_test.go holds that line). This holds
// what they are FOR: the admin reading them gets every account, and no password hash goes with it.
// Hashes in a list response is the sort of thing a redesign of MapUserResponse could reintroduce
// without any test noticing.
func TestAdminDirectoryReadsCarryEveryAccountAndNoHashes(t *testing.T) {
	fx := userTestDB(t)

	t.Run("GET /users", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users", fx.AdminID, adminRoleName, 0, "")
		ListUser(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		var users []map[string]any
		decodeJSON(t, rec, &users)
		if len(users) != 3 {
			t.Fatalf("got %d users, want the fixture's 3: %s", len(users), rec.Body.String())
		}
		// `password_expired` is a legitimate field on the response; a `"password":` key is not.
		if strings.Contains(rec.Body.String(), "$2") || strings.Contains(rec.Body.String(), `"password":`) {
			t.Fatalf("the user list carried password material: %s", rec.Body.String())
		}
	})

	t.Run("GET /users?page=2&limit=2 pages", func(t *testing.T) {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/users?page=2&limit=2", nil)
		c.Set("user_role", adminRoleName)
		c.Set("user_id", fx.AdminID)
		ListUser(c)
		var users []map[string]any
		decodeJSON(t, rec, &users)
		if len(users) != 1 {
			t.Fatalf("page 2 of 3 users at limit 2 returned %d rows: %s", len(users), rec.Body.String())
		}
	})

	t.Run("GET /users/stats counts per role", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/users/stats", fx.AdminID, adminRoleName, 0, "")
		GetStats(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		var stats struct {
			Total  float64            `json:"total"`
			ByRole map[string]float64 `json:"by_role"`
		}
		decodeJSON(t, rec, &stats)
		if stats.Total != 3 {
			t.Errorf("total = %v, want 3", stats.Total)
		}
		if stats.ByRole[adminRoleName] != 1 || stats.ByRole["user"] != 2 {
			t.Errorf("by_role = %v, want {admin:1, user:2}", stats.ByRole)
		}
	})

	t.Run("GET /email-phone-numbers", func(t *testing.T) {
		c, rec := asUser(t, http.MethodGet, "/email-phone-numbers", fx.AdminID, adminRoleName, 0, "")
		ListEmailAndPhoneNumber(c)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		var rows []map[string]any
		decodeJSON(t, rec, &rows)
		if len(rows) != 3 {
			t.Fatalf("got %d rows, want 3: %s", len(rows), rec.Body.String())
		}
		for _, r := range rows {
			if len(r) != 3 {
				t.Fatalf("the duplicate-check endpoint returns more than {id,email,phone_number}: %v", r)
			}
		}
	})
}

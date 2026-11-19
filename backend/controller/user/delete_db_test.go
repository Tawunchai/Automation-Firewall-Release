package user

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"network_automation/entity"
	"network_automation/services/platform"
)

// DELETE /delete-users/:id and POST /users/bulk-delete.
//
// Deleting an account is the one operation here that has to be right in three places at once: the
// row has to stop being usable (the account must not be able to sign in), the row has to stay in
// the table (ActivityLog, ChangeRecord and the Recycle Bin all point at it), and everything
// derived from the account — its firewall grants above all — has to go for real. Those three pull
// in opposite directions, which is how this part of the schema earned its history: a plain unique
// index on email plus GORM's soft delete made Recycle Bin's Restore fail 100% of the time, and a
// soft-deleted device grant kept answering "yes" to UserCanAccessDevice.

// grantAccess gives a user a firewall, so a delete can be checked for taking it away.
func grantAccess(t *testing.T, fx *userFixture, userID uint) uint {
	t.Helper()
	device := entity.NetworkDevice{
		Name: "FortiGate-80E-fixture", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "198.51.100.7", APIPort: 443, Status: "active",
	}
	if err := fx.DB.Create(&device).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	if err := fx.DB.Create(&entity.UserDeviceAccess{
		AppUserID: userID, NetworkDeviceID: device.ID, GrantedByID: fx.AdminID,
	}).Error; err != nil {
		t.Fatalf("grant device: %v", err)
	}
	return device.ID
}

// countGrants counts grants for a user INCLUDING soft-deleted ones — the distinction is the whole
// point: entity.UserDeviceAccess's unique index does not include deleted_at, and a soft-deleted
// grant still satisfies UserCanAccessDevice.
func countGrants(t *testing.T, fx *userFixture, userID uint) int64 {
	t.Helper()
	var n int64
	if err := fx.DB.Unscoped().Model(&entity.UserDeviceAccess{}).
		Where("app_user_id = ?", userID).Count(&n).Error; err != nil {
		t.Fatalf("count grants: %v", err)
	}
	return n
}

func TestDeleteUserByIDSoftDeletesTheRowAndEndsTheAccount(t *testing.T) {
	fx := userTestDB(t)
	grantAccess(t, fx, fx.BobID)
	if countGrants(t, fx, fx.BobID) != 1 {
		t.Fatal("the fixture's device grant was not created")
	}

	c, rec := asUser(t, http.MethodDelete, "/delete-users", fx.AdminID, adminRoleName, fx.BobID, "")
	DeleteUserByID(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// Gone from every normal query…
	var live entity.AppUser
	if err := fx.DB.First(&live, fx.BobID).Error; err == nil {
		t.Fatal("the account is still returned by an ordinary query after being deleted")
	}
	// …but still physically present, with deleted_at set, so the audit trail that references it
	// does not dangle and the Recycle Bin can restore it.
	var row entity.AppUser
	if err := fx.DB.Unscoped().First(&row, fx.BobID).Error; err != nil {
		t.Fatalf("the row was hard-deleted — every table with a foreign key to app_users(id) "+
			"would have gone with it: %v", err)
	}
	if !row.DeletedAt.Valid {
		t.Error("the row survived but deleted_at was never set")
	}

	// The account must not be able to sign in. This repeats auth.Login's own lookup — a
	// case-insensitive match over LIVE rows — rather than trusting the soft delete by inspection.
	if canStillSignIn(t, fx.DB, userTestBobEmail) {
		t.Fatal("a deleted account can still be found and authenticated by the sign-in lookup")
	}

	// The firewall access goes with the account, and it goes hard: a soft-deleted grant would
	// still answer "yes" to UserCanAccessDevice and would block re-granting under the unique index.
	if n := countGrants(t, fx, fx.BobID); n != 0 {
		t.Fatalf("%d device grant(s) survived the delete, soft-deleted rows included — "+
			"the account keeps its firewall access", n)
	}

	// And the Recycle Bin has what it needs to put the account back.
	var bk entity.Backup
	if err := fx.DB.Where("original_id = ?", fx.BobID).First(&bk).Error; err != nil {
		t.Fatalf("no backup row was written, so this delete cannot be undone: %v", err)
	}
	if bk.Email != userTestBobEmail || bk.RoleName != "user" || bk.DeletedByID != fx.AdminID {
		t.Errorf("the backup does not describe the deleted account: %+v", bk)
	}
	if bk.Password != row.Password {
		t.Error("the backup did not keep the password hash — a restore would lock the user out")
	}
}

// The address of a deleted account IS reusable, and this pins that as the product's answer rather
// than an accident: the duplicate check in CreateUser is soft-delete scoped, and the real unique
// index is partial (`WHERE deleted_at IS NULL`, created by config.fixAppUserEmailUniqueIndex and
// reproduced in this fixture). Together they are what stopped Recycle Bin's Restore returning 500
// on every attempt. If this test ever fails, the index has gone back to being unconditional.
func TestADeletedAddressCanBeUsedAgain(t *testing.T) {
	fx := userTestDB(t)

	c, rec := asUser(t, http.MethodDelete, "/delete-users", fx.AdminID, adminRoleName, fx.BobID, "")
	DeleteUserByID(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: status = %d: %s", rec.Code, rec.Body.String())
	}

	body := `{"email":"` + userTestBobEmail + `","password":"` + userTestNewPass +
		`","first_name":"Bob","last_name":"Again","app_role_id":` +
		strconv.FormatUint(uint64(fx.UserRoleID), 10) + `}`
	c2, rec2 := asUser(t, http.MethodPost, "/create-users", fx.AdminID, adminRoleName, 0, body)
	CreateUser(c2)

	if rec2.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 — a previously-deleted address could not be reused: %s",
			rec2.Code, rec2.Body.String())
	}

	// Two rows now hold that address: the soft-deleted original and the new account. Exactly one
	// of them is live, which is what the partial index permits and the sign-in lookup requires.
	var liveCount, allCount int64
	fx.DB.Model(&entity.AppUser{}).Where("email = ?", userTestBobEmail).Count(&liveCount)
	fx.DB.Unscoped().Model(&entity.AppUser{}).Where("email = ?", userTestBobEmail).Count(&allCount)
	if liveCount != 1 || allCount != 2 {
		t.Fatalf("live rows with that address = %d (want 1), rows in total = %d (want 2)",
			liveCount, allCount)
	}
	// The address now resolves to the NEW account: the sign-in lookup finds one row, and it is the
	// one holding the new password — the deleted account's credentials did not come back with its
	// address.
	var found entity.AppUser
	if err := fx.DB.Where("LOWER(email) = LOWER(?)", userTestBobEmail).First(&found).Error; err != nil {
		t.Fatalf("the sign-in lookup cannot find the reused address: %v", err)
	}
	if found.LastName != "Again" {
		t.Fatalf("the address resolves to %q, not the newly-created account", found.LastName)
	}
	if platform.CheckPasswordHash(userTestPassword, found.Password) {
		t.Fatal("the deleted account's password still opens the address it used to hold")
	}
	if !platform.CheckPasswordHash(userTestNewPass, found.Password) {
		t.Fatal("the new account's own password does not work")
	}
}

func TestDeleteUserByIDRefusesWhatWouldLockTheConsole(t *testing.T) {
	t.Run("an admin deleting their own account", func(t *testing.T) {
		fx := userTestDB(t)
		fx.addAdmin(t, "second-admin@test.invalid") // so the refusal is about self-delete, not the last admin

		c, rec := asUser(t, http.MethodDelete, "/delete-users", fx.AdminID, adminRoleName, fx.AdminID, "")
		DeleteUserByID(c)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
		}
		fx.reload(t, fx.AdminID) // fails the test if the row is gone
	})

	t.Run("the last administrator", func(t *testing.T) {
		fx := userTestDB(t)

		// The fixture has exactly one admin. The caller below is an ordinary account whose TOKEN
		// still claims admin — a session that outlived a demotion — which is the one way a request
		// can pass the role gate AND aim at the final administrator without aiming at itself (the
		// self-delete guard answers that case first).
		c, rec := asUser(t, http.MethodDelete, "/delete-users", fx.BobID, adminRoleName, fx.AdminID, "")
		DeleteUserByID(c)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 — the final administrator was removable, leaving a "+
				"console nobody can administer: %s", rec.Code, rec.Body.String())
		}
		fx.reload(t, fx.AdminID)
		if !canStillSignIn(t, fx.DB, userTestAdminEmail) {
			t.Fatal("the administrator can no longer sign in after a delete that was refused")
		}

		// Once a second administrator exists the same request is allowed — which is what makes
		// this a guard rather than a rule that no admin can ever be removed.
		fx.addAdmin(t, "second-admin@test.invalid")
		c2, rec2 := asUser(t, http.MethodDelete, "/delete-users", fx.BobID, adminRoleName, fx.AdminID, "")
		DeleteUserByID(c2)
		if rec2.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 once another admin exists: %s", rec2.Code, rec2.Body.String())
		}
	})

	t.Run("an account that is not there", func(t *testing.T) {
		fx := userTestDB(t)
		c, rec := asUser(t, http.MethodDelete, "/delete-users", fx.AdminID, adminRoleName, 99999, "")
		DeleteUserByID(c)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404: %s", rec.Code, rec.Body.String())
		}
	})
}

// ── POST /users/bulk-delete ─────────────────────────────────────────────────

func TestBulkDeleteUsersRemovesEveryNamedAccountAndBacksEachOneUp(t *testing.T) {
	fx := userTestDB(t)
	grantAccess(t, fx, fx.AliceID)
	grantAccess(t, fx, fx.BobID)

	body := `{"ids":[` + strconv.FormatUint(uint64(fx.AliceID), 10) + `,` +
		strconv.FormatUint(uint64(fx.BobID), 10) + `]}`
	c, rec := asUser(t, http.MethodPost, "/users/bulk-delete", fx.AdminID, adminRoleName, 0, body)
	BulkDeleteUsers(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Count float64 `json:"count"`
	}
	decodeJSON(t, rec, &resp)
	if resp.Count != 2 {
		t.Errorf("count = %v, want 2", resp.Count)
	}

	for _, email := range []string{userTestAliceEmail, userTestBobEmail} {
		if canStillSignIn(t, fx.DB, email) {
			t.Errorf("%s can still sign in after a bulk delete", email)
		}
	}
	for _, id := range []uint{fx.AliceID, fx.BobID} {
		if n := countGrants(t, fx, id); n != 0 {
			t.Errorf("user %d kept %d device grant(s)", id, n)
		}
		var bk entity.Backup
		if err := fx.DB.Where("original_id = ?", id).First(&bk).Error; err != nil {
			t.Errorf("user %d has no backup row: %v", id, err)
		}
	}
	// The administrator who issued it is untouched.
	fx.reload(t, fx.AdminID)
}

func TestBulkDeleteUsersRefusalsDeleteNothingAtAll(t *testing.T) {
	cases := map[string]struct {
		body func(fx *userFixture) string
		want int
	}{
		"the caller's own id is in the list": {
			// The whole batch must be refused, not just the caller's entry — otherwise an admin
			// loses Bob and gets an error, which is the worst of both.
			func(fx *userFixture) string {
				return `{"ids":[` + strconv.FormatUint(uint64(fx.BobID), 10) + `,` +
					strconv.FormatUint(uint64(fx.AdminID), 10) + `]}`
			},
			http.StatusBadRequest,
		},
		"every administrator is in the list": {
			func(fx *userFixture) string {
				return `{"ids":[` + strconv.FormatUint(uint64(fx.AdminID), 10) + `,` +
					strconv.FormatUint(uint64(fx.BobID), 10) + `]}`
			},
			http.StatusBadRequest,
		},
		"an empty list": {
			func(fx *userFixture) string { return `{"ids":[]}` },
			http.StatusBadRequest,
		},
		"no list at all": {
			func(fx *userFixture) string { return `{}` },
			http.StatusBadRequest,
		},
		"ids that match no account": {
			func(fx *userFixture) string { return `{"ids":[90001,90002]}` },
			http.StatusNotFound,
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fx := userTestDB(t)
			before := snapshotUsers(t, fx)

			c, rec := asUser(t, http.MethodPost, "/users/bulk-delete", fx.AdminID, adminRoleName, 0, tc.body(fx))
			BulkDeleteUsers(c)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			if after := snapshotUsers(t, fx); after != before {
				t.Fatalf("a refused bulk delete still removed accounts:\nbefore: %s\nafter:  %s",
					before, after)
			}
			var backups int64
			fx.DB.Model(&entity.Backup{}).Count(&backups)
			if backups != 0 {
				t.Fatalf("%d backup row(s) were written for a delete that never happened", backups)
			}
		})
	}
}

// The caller-id guard must not be fooled by the same account appearing as a different-looking id.
// (Here: the admin's own id alone, which is the single-element version of the case above.)
func TestBulkDeleteUsersWillNotDeleteTheCaller(t *testing.T) {
	fx := userTestDB(t)
	fx.addAdmin(t, "second-admin@test.invalid")

	body := `{"ids":[` + strconv.FormatUint(uint64(fx.AdminID), 10) + `]}`
	c, rec := asUser(t, http.MethodPost, "/users/bulk-delete", fx.AdminID, adminRoleName, 0, body)
	BulkDeleteUsers(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "your own account") {
		t.Errorf("unexpected refusal: %s", rec.Body.String())
	}
	fx.reload(t, fx.AdminID)
}

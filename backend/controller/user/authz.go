package user

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/entity"
)

// Authorisation helpers for the user-management endpoints.
//
// Why this file exists: every handler under /users, /create-users, /update-users, /delete-users,
// /users/bulk-* and /admin/users used to run behind Authorizes() ALONE — i.e. "is the caller
// logged in", with no "is the caller allowed". The admin-only shape of these routes lived only in
// the frontend, which hides the buttons. A non-admin with curl could therefore change any user
// (including resetting the admin's password — a full account takeover) and promote themselves to
// admin via /users/bulk-role. These helpers put the check where it belongs: on the server.

// adminRoleName is the role that may manage other users. Kept as one constant so the "last admin"
// guard and the role check can never drift apart.
const adminRoleName = "admin"

// callerID returns the authenticated user's id, as stamped on the context by
// middleware.Authorizes from the JWT. Zero means "no authenticated caller", which for these
// already-protected routes only happens in a misconfiguration — treat it as not-the-owner.
func callerID(c *gin.Context) uint {
	if v, ok := c.Get("user_id"); ok {
		if id, ok := v.(uint); ok {
			return id
		}
	}
	return 0
}

// isAdmin reports whether the caller holds the admin role (also set from the JWT by the
// middleware, so it costs no query).
func isAdmin(c *gin.Context) bool {
	return c.GetString("user_role") == adminRoleName
}

// requireAdmin writes a 403 and returns false unless the caller is an admin.
func requireAdmin(c *gin.Context) bool {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

// editVerdict is the outcome of the PATCH /update-users/:id access check. That endpoint is
// dual-use — an admin editing anyone, or a user editing themselves — so the rule is more than a
// role gate; it is kept as a pure function so the decision table can be tested directly.
type editVerdict int

const (
	editAllowed       editVerdict = iota // admin, or the owner editing their own non-role fields
	editNotOwner                         // a non-admin aiming at someone else's record
	editRoleForbidden                    // a non-admin trying to set app_role_id (self-promotion)
)

// editUserDecision resolves who may run an update against target user `target`.
//
//   - an admin may edit anyone, including roles;
//   - a non-admin may edit ONLY their own record, and never the role field.
//
// The role check is what stops a user from PATCHing app_role_id on their own account to become an
// admin — the exact escalation this endpoint used to allow.
func editUserDecision(callerIsAdmin bool, caller, target uint, wantsRoleChange bool) editVerdict {
	if callerIsAdmin {
		return editAllowed
	}
	if caller == 0 || caller != target {
		return editNotOwner
	}
	if wantsRoleChange {
		return editRoleForbidden
	}
	return editAllowed
}

// canViewUser resolves who may run GET /users/:id against target user `target`.
//
// An admin may view anyone; a non-admin may view ONLY their own record. The endpoint backs the
// navbar/account profile widget, which always requests the caller's own id, so this never needs
// to allow a cross-account read. caller == 0 (no identified caller) is never treated as owning
// any record, including user 0.
func canViewUser(callerIsAdmin bool, caller, target uint) bool {
	if callerIsAdmin {
		return true
	}
	return caller != 0 && caller == target
}

// hasOtherAdmin reports whether at least one admin account exists OUTSIDE the given id set.
//
// It guards against locking everyone out of user management: deleting (or demoting) the final
// admin would leave a system nobody can administer, and there is no bootstrap path back. Callers
// pass the ids about to be removed/demoted; a false result means those ids hold every remaining
// admin, so the operation must be refused.
func hasOtherAdmin(db *gorm.DB, excluding []uint) (bool, error) {
	var count int64
	q := db.Model(&entity.AppUser{}).
		Joins("JOIN app_roles ON app_roles.id = app_users.app_role_id").
		Where("app_roles.role = ?", adminRoleName)
	if len(excluding) > 0 {
		q = q.Where("app_users.id NOT IN ?", excluding)
	}
	if err := q.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

package services

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Per-user device access.
//
// This is the single place the whole application answers "may this person work on this firewall?".
// Every caller that reaches a device goes through it — the inventory list, the device proxy, the
// report builder, the credential mapper — so the rule cannot be enforced on one route and forgotten
// on the next.
//
// ── The rule, in full ────────────────────────────────────────────────────────
//
//	admin           → every device, always. Not a shortcut: an admin can add, edit and delete
//	                  devices, so a grant table that could hide one from them would be theatre.
//	everyone else   → only the devices they hold a UserDeviceAccess row for.
//
// There is deliberately NO "no grants means everything" fallback. That shape is how access control
// quietly stops existing: the first user created after the feature shipped would silently have the
// run of the fleet. Upgrades are handled once, at migration time, by granting the existing devices
// to the existing users (config.SeedDeviceAccess) — a decision taken with a record of it, rather
// than a rule that keeps making it forever.
//
// ── How a refusal is reported ─────────────────────────────────────────────
//
// Handlers answer a missing grant with **404, not 403**: a 403 confirms the device exists, and
// which firewalls are in the inventory is not something an unauthorised user should be able to
// enumerate. This package used to carry an ErrDeviceForbidden sentinel saying so, which no caller
// ever compared against — every handler implements the rule directly. The rule is the part worth
// keeping, so it lives here rather than beside an error value nobody returned.

// UserCanAccessDevice reports whether userID may work on deviceID.
//
// isAdmin comes from the JWT-stamped role on the request context, so the common case costs no
// query at all.
func UserCanAccessDevice(db *gorm.DB, userID uint, isAdmin bool, deviceID uint) bool {
	if isAdmin {
		return true
	}
	if db == nil || userID == 0 || deviceID == 0 {
		return false
	}
	var count int64
	err := db.Model(&entity.UserDeviceAccess{}).
		Where("app_user_id = ? AND network_device_id = ?", userID, deviceID).
		Count(&count).Error
	if err != nil {
		// A database error is not permission. Denying is the only safe reading of "we do not know".
		return false
	}
	return count > 0
}

// AccessibleDeviceIDs lists the device ids granted to userID.
//
// Only meaningful for a non-admin — an admin has no id list because they are not filtered by one.
// Callers must check isAdmin first and skip the filter entirely rather than asking this for an
// admin and getting an empty slice.
func AccessibleDeviceIDs(db *gorm.DB, userID uint) ([]uint, error) {
	out := []uint{}
	if db == nil || userID == 0 {
		return out, nil
	}
	if err := db.Model(&entity.UserDeviceAccess{}).
		Where("app_user_id = ?", userID).
		Order("network_device_id ASC").
		Pluck("network_device_id", &out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

// ScopeDevicesToUser adds the access filter to a query over network_devices, or leaves it untouched
// for an admin.
//
// Returning the query rather than the rows keeps it composable with whatever ordering and extra
// predicates the caller already has, and means a page cannot accidentally apply the filter after
// its own LIMIT.
func ScopeDevicesToUser(q *gorm.DB, db *gorm.DB, userID uint, isAdmin bool) *gorm.DB {
	return ApplyDeviceScope(q, "id", DeviceScopeFor(db, userID, isAdmin))
}

// DeviceScope is what a scoping decision comes to, before any SQL is written.
//
// Three outcomes and they are easy to collapse into two by accident, which is why they are named:
// the difference between "no filter" and "match nothing" is the difference between an admin seeing
// the fleet and a database hiccup handing it to everyone.
type DeviceScope struct {
	unfiltered bool   // admin: every device, no predicate at all
	ids        []uint // the granted ids; only meaningful when !unfiltered
}

// scopeFromGrants is the rule itself, over the three inputs it actually depends on.
//
// Taking the lookup's (ids, err) rather than a *gorm.DB is what makes the failure branch reachable
// from a test — the same reason sessionVerdict takes an error instead of doing the query. A first
// attempt at testing this passed a nil handle, which AccessibleDeviceIDs answers with "no grants,
// no error", so the branch that matters was never executed and a deliberately broken version of
// this function still passed.
//
//	admin              → no predicate at all
//	grants read        → filter to them (an empty list matches nothing, correctly)
//	lookup failed      → match nothing. A database error is not permission; failing closed costs a
//	                     page, failing open hands every firewall to everyone.
func scopeFromGrants(isAdmin bool, ids []uint, err error) DeviceScope {
	if isAdmin {
		return DeviceScope{unfiltered: true}
	}
	if err != nil {
		return DeviceScope{ids: nil}
	}
	return DeviceScope{ids: ids}
}

// DeviceScopeFor performs the lookup and applies the rule above.
func DeviceScopeFor(db *gorm.DB, userID uint, isAdmin bool) DeviceScope {
	if isAdmin {
		return DeviceScope{unfiltered: true} // no query at all, as on a half-started database
	}
	ids, err := AccessibleDeviceIDs(db, userID)
	return scopeFromGrants(isAdmin, ids, err)
}

// scopeMatchNothing is the predicate for "this caller may see none of them" — correct both for
// "granted nothing" and for "we could not read the grants".
const scopeMatchNothing = "1 = 0"

// scopePredicateFor is the SQL a scope comes to on a given column, "" meaning no predicate.
//
// Split out from ApplyDeviceScope so the column choice can be tested: the inventory filters on
// network_devices.id while everything referencing a device filters on network_device_id, and the
// two are easy to swap with no visible symptom until someone reads rows they should not.
//
// `column` is always a literal from this package's call sites, never anything a request supplied.
func scopePredicateFor(column string, s DeviceScope) string {
	switch {
	case s.unfiltered:
		return ""
	case len(s.ids) == 0:
		return scopeMatchNothing
	default:
		return column + " IN ?"
	}
}

func ApplyDeviceScope(q *gorm.DB, column string, s DeviceScope) *gorm.DB {
	switch predicate := scopePredicateFor(column, s); predicate {
	case "":
		return q
	case scopeMatchNothing:
		return q.Where(predicate)
	default:
		return q.Where(predicate, s.ids)
	}
}

// ScopeDeviceRefToUser is ScopeDevicesToUser for a table that REFERENCES a device rather than being
// the device table — anything carrying a network_device_id.
//
// It exists because the rule kept being applied per-row, or not at all. The Change Audit Ledger read
// every device's before/after configuration snapshots to any signed-in user, including firewalls
// they hold no grant for: one page had simply never been routed through the check that the ~100
// device-proxy routes share. A filter that composes into a list query is the shape that makes
// remembering unnecessary.
//
// Same failure mode as its sibling: an unreadable grant table filters everything out rather than
// letting everything through.
func ScopeDeviceRefToUser(q *gorm.DB, db *gorm.DB, userID uint, isAdmin bool) *gorm.DB {
	return ApplyDeviceScope(q, "network_device_id", DeviceScopeFor(db, userID, isAdmin))
}

// diffDeviceGrants works out what SetUserDeviceAccess has to do to move `current` to `wanted`.
//
// Pure, and exported, so the "revoking is a hard delete" rule and the de-duplication can be pinned
// by a test without a database. Both output slices are deterministic in the order of `wanted` /
// `current` respectively, which keeps the SQL a test asserts on stable.
func diffDeviceGrants(current, wanted []uint) (add, remove []uint) {
	have := make(map[uint]bool, len(current))
	for _, id := range current {
		have[id] = true
	}
	want := make(map[uint]bool, len(wanted))

	add = []uint{}
	for _, id := range wanted {
		if id == 0 || want[id] {
			continue // a zero id is not a device; a repeat is the same grant twice
		}
		want[id] = true
		if !have[id] {
			add = append(add, id)
		}
	}

	remove = []uint{}
	for _, id := range current {
		if !want[id] {
			remove = append(remove, id)
		}
	}
	return add, remove
}

// SetUserDeviceAccess makes the user's grants exactly deviceIDs.
//
// Unknown ids are rejected rather than skipped: silently dropping one would leave the admin looking
// at a picker that says they granted something they did not.
//
// ⚠️ Revoking is a HARD delete, for the same reason DeviceCredential's is — the unique index on
// (app_user_id, network_device_id) does not include deleted_at, so a soft-deleted row keeps the pair
// reserved and re-granting later fails with a 23505 the UI cannot explain.
func SetUserDeviceAccess(db *gorm.DB, userID uint, deviceIDs []uint, grantedBy uint) error {
	if db == nil {
		return errors.New("no database")
	}
	if userID == 0 {
		return errors.New("no user given")
	}

	current, err := AccessibleDeviceIDs(db, userID)
	if err != nil {
		return err
	}
	add, remove := diffDeviceGrants(current, deviceIDs)

	if len(add) > 0 {
		var found int64
		if err := db.Model(&entity.NetworkDevice{}).Where("id IN ?", add).Count(&found).Error; err != nil {
			return err
		}
		if int(found) != len(add) {
			return fmt.Errorf("one of the selected devices no longer exists")
		}
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if len(remove) > 0 {
			if err := tx.Unscoped().
				Where("app_user_id = ? AND network_device_id IN ?", userID, remove).
				Delete(&entity.UserDeviceAccess{}).Error; err != nil {
				return err
			}
		}
		for _, id := range add {
			row := entity.UserDeviceAccess{
				AppUserID:       userID,
				NetworkDeviceID: id,
				GrantedByID:     grantedBy,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// CountGrantsByUser returns app_user_id → number of devices granted, for the Users table.
//
// One query for the whole page rather than one per row: the users list is the place an N+1 would
// first be felt, and it is the only caller.
func CountGrantsByUser(db *gorm.DB) (map[uint]int, error) {
	out := map[uint]int{}
	if db == nil {
		return out, nil
	}
	var rows []struct {
		AppUserID uint
		N         int
	}
	if err := db.Model(&entity.UserDeviceAccess{}).
		Select("app_user_id, COUNT(*) AS n").
		Group("app_user_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.AppUserID] = r.N
	}
	return out, nil
}

// PurgeDeviceGrantsForUser removes every grant a deleted user held.
//
// Hard delete, same index reason as above — and a soft-deleted grant belonging to a soft-deleted
// user would keep answering "yes" to UserCanAccessDevice if the account id were ever reused.
func PurgeDeviceGrantsForUser(db *gorm.DB, userID uint) {
	if db == nil || userID == 0 {
		return
	}
	db.Unscoped().Where("app_user_id = ?", userID).Delete(&entity.UserDeviceAccess{})
}

// PurgeDeviceGrantsForDevice removes every grant pointing at a deleted device.
func PurgeDeviceGrantsForDevice(db *gorm.DB, deviceID uint) {
	if db == nil || deviceID == 0 {
		return
	}
	db.Unscoped().Where("network_device_id = ?", deviceID).Delete(&entity.UserDeviceAccess{})
}

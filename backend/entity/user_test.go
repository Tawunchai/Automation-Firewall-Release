package entity

import (
	"reflect"
	"strings"
	"testing"
)

// A live full-system check found that Recycle Bin's Restore button returned a 500 on EVERY
// soft-deleted user, 100% of the time: AppUser.Email used to carry a plain `gorm:"uniqueIndex"`
// tag, and GORM's default Delete() only sets deleted_at — the row, and the email it holds, stays in
// the table. Restore's INSERT of a new row with that same email then collided with the "deleted"
// row's still-live index entry. The real constraint now lives as a PARTIAL unique index
// (`idx_app_users_email ... WHERE deleted_at IS NULL`, created in config/db.go's
// fixAppUserEmailUniqueIndex), which a plain `uniqueIndex` struct tag cannot express — AutoMigrate
// would recreate the broken plain index from the tag and silently undo the fix on a future
// migration. This guards against that happening by accident.
func TestAppUser_EmailHasNoPlainUniqueIndexTag(t *testing.T) {
	f, ok := reflect.TypeOf(AppUser{}).FieldByName("Email")
	if !ok {
		t.Fatal("AppUser.Email is gone")
	}
	if strings.Contains(f.Tag.Get("gorm"), "uniqueIndex") {
		t.Error("AppUser.Email must not carry a uniqueIndex gorm tag — the real constraint is the " +
			"partial index in config/db.go's fixAppUserEmailUniqueIndex (WHERE deleted_at IS NULL); " +
			"a plain uniqueIndex tag makes AutoMigrate recreate the broken index this fixes, and " +
			"Recycle Bin's Restore would start failing 100% of the time again")
	}
}

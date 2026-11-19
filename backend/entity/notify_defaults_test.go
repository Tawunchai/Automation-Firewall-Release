package entity

import (
	"reflect"
	"strings"
	"testing"
)

// GORM's `default:` tag and the zero value.
//
// ── The bug this pins ────────────────────────────────────────────────────────
// GORM omits a zero-valued struct field from an INSERT and lets the column default fill it in. On a
// bool or an int whose zero value is MEANINGFUL, that makes the setting unsettable: the request
// asks for false, GORM sends nothing, and Postgres writes the default.
//
// It shipped here and was caught against the live backend, not by a unit test — creating a rule
// with:
//
//	{"enabled": false, "cooldown_minutes": 0, "notify_on_resolve": false}
//
// returned enabled=true, cooldown=30, notify_on_resolve=true. An admin adding a rule as "off for
// now, I will turn it on after I have picked recipients" would have got a live rule paging people,
// and "repeat on every check" could not be configured at all.
//
// The fix is to keep the defaults in the controller, where they are applied when the field is
// ABSENT from the request rather than when it happens to be zero. This test stops the tag coming
// back — it is one word, it looks harmless, and its failure is silent.

// zeroMeaningfulFields are the fields whose zero value is a real choice a person can make.
var zeroMeaningfulFields = map[string][]string{
	"NotifyChannel":   {"Enabled"},
	"NotifyRecipient": {"Enabled", "IsGroup"},
	"NotifyRule": {
		"Enabled", "SustainedPolls", "CooldownMinutes", "NotifyOnResolve",
		"Threshold", "NetworkDeviceID", "Severity", "Subjects",
	},
	"NotifyRuleState": {"Firing", "Streak", "ClearStreak", "LastValue"},
}

func TestNotifyEntities_HaveNoZeroValueDefaults(t *testing.T) {
	types := map[string]reflect.Type{
		"NotifyChannel":   reflect.TypeOf(NotifyChannel{}),
		"NotifyRecipient": reflect.TypeOf(NotifyRecipient{}),
		"NotifyRule":      reflect.TypeOf(NotifyRule{}),
		"NotifyRuleState": reflect.TypeOf(NotifyRuleState{}),
	}

	for typeName, fields := range zeroMeaningfulFields {
		rt, ok := types[typeName]
		if !ok {
			t.Fatalf("%s is not in the type table", typeName)
		}
		for _, fieldName := range fields {
			field, found := rt.FieldByName(fieldName)
			if !found {
				t.Errorf("%s.%s no longer exists — update this test with the new name", typeName, fieldName)
				continue
			}
			if tag := field.Tag.Get("gorm"); strings.Contains(tag, "default:") {
				t.Errorf(
					"%s.%s carries a gorm default (%q). GORM skips the zero value on Create, so this "+
						"field can never be saved as its zero value. Put the default in the controller instead.",
					typeName, fieldName, tag)
			}
		}
	}
}

// UserDeviceAccess is a pure join row: every column is part of the key or an audit note, and none
// of them may acquire a default that would let a grant be created without one.
func TestUserDeviceAccess_HasNoDefaults(t *testing.T) {
	rt := reflect.TypeOf(UserDeviceAccess{})
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		if strings.Contains(f.Tag.Get("gorm"), "default:") {
			t.Errorf("UserDeviceAccess.%s carries a gorm default (%q)", f.Name, f.Tag.Get("gorm"))
		}
	}
}

// The unique index on a grant deliberately excludes deleted_at, which is why revoking has to be a
// hard delete (services.SetUserDeviceAccess). If the index were ever widened or dropped, that
// reasoning — and the comment explaining it — would quietly stop matching the schema.
func TestUserDeviceAccess_KeepsItsCompositeUniqueIndex(t *testing.T) {
	rt := reflect.TypeOf(UserDeviceAccess{})
	for _, name := range []string{"AppUserID", "NetworkDeviceID"} {
		f, ok := rt.FieldByName(name)
		if !ok {
			t.Fatalf("UserDeviceAccess.%s is gone", name)
		}
		if !strings.Contains(f.Tag.Get("gorm"), "uniqueIndex:idx_user_device_access") {
			t.Errorf("UserDeviceAccess.%s left the (user, device) unique index — a user could hold "+
				"the same device twice", name)
		}
	}
}

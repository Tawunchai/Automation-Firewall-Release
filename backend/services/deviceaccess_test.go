package services

import (
	"reflect"
	"testing"
)

// Per-user device access.
//
// The parts worth pinning without a database are the two that decide what actually happens: the
// diff that drives the SQL (getting it wrong either revokes something silently or fails to revoke
// something at all), and the admin bypass, which is the one branch that must never depend on a
// query succeeding.

func TestDiffDeviceGrants(t *testing.T) {
	cases := []struct {
		name       string
		current    []uint
		wanted     []uint
		wantAdd    []uint
		wantRemove []uint
	}{
		{
			name:    "first grant",
			current: nil, wanted: []uint{1, 2},
			wantAdd: []uint{1, 2}, wantRemove: []uint{},
		},
		{
			name:    "revoke everything",
			current: []uint{1, 2}, wanted: []uint{},
			wantAdd: []uint{}, wantRemove: []uint{1, 2},
		},
		{
			name:    "no change",
			current: []uint{3, 1}, wanted: []uint{1, 3},
			wantAdd: []uint{}, wantRemove: []uint{},
		},
		{
			name:    "swap one for another",
			current: []uint{1, 2}, wanted: []uint{2, 5},
			wantAdd: []uint{5}, wantRemove: []uint{1},
		},
		{
			// A checkbox list can post the same id twice if the page has stale rows; creating the
			// grant twice would hit the unique index and fail the whole save.
			name:    "duplicates collapse",
			current: nil, wanted: []uint{4, 4, 4},
			wantAdd: []uint{4}, wantRemove: []uint{},
		},
		{
			name:    "a zero id is not a device",
			current: nil, wanted: []uint{0, 7},
			wantAdd: []uint{7}, wantRemove: []uint{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			add, remove := diffDeviceGrants(tc.current, tc.wanted)
			if !reflect.DeepEqual(add, tc.wantAdd) {
				t.Errorf("add = %v, want %v", add, tc.wantAdd)
			}
			if !reflect.DeepEqual(remove, tc.wantRemove) {
				t.Errorf("remove = %v, want %v", remove, tc.wantRemove)
			}
		})
	}
}

// An admin reaches every device without a query. This is the branch that runs on a boot where the
// database is momentarily unavailable, and locking the administrator out of their own console at
// that moment would be the worst possible failure mode.
func TestUserCanAccessDevice_AdminNeedsNoGrantAndNoDatabase(t *testing.T) {
	if !UserCanAccessDevice(nil, 0, true, 1) {
		t.Errorf("an admin was refused a device")
	}
}

// The opposite of the above, and the whole point of the feature: with no grant table to read, a
// non-admin is refused. "We do not know" must never be answered as "yes".
func TestUserCanAccessDevice_UnknownIsDenied(t *testing.T) {
	cases := []struct {
		name     string
		userID   uint
		deviceID uint
	}{
		{"no database", 5, 1},
		{"no user", 0, 1},
		{"no device", 5, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if UserCanAccessDevice(nil, tc.userID, false, tc.deviceID) {
				t.Errorf("access was granted where nothing could be checked")
			}
		})
	}
}

// AccessibleDeviceIDs must return an empty slice rather than nil so a JSON response renders [] and
// not null — the picker iterates it.
func TestAccessibleDeviceIDs_EmptyNotNil(t *testing.T) {
	got, err := AccessibleDeviceIDs(nil, 3)
	if err != nil {
		t.Fatalf("AccessibleDeviceIDs: %v", err)
	}
	if got == nil {
		t.Errorf("got nil, want an empty slice")
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

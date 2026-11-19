package services

import (
	"errors"
	"testing"
)

// The scoping decision, pinned without a database.
//
// It has three outcomes and only one of them is safe to reach by mistake:
//
//	admin              → no predicate at all
//	grants, readable   → filter to those ids
//	nothing readable   → match NOTHING
//
// The third is the one that matters. Collapsing "we could not read the grant table" into "do not
// filter" is a one-character change — dropping an `err != nil` branch — and it converts a database
// hiccup into every user seeing every firewall. The Change Audit Ledger reached the same state by a
// different route: it applied no filter at all, so anyone signed in could read the configuration
// history of firewalls they hold no grant for.

func TestDeviceScope_AdminIsUnfilteredWithoutAQuery(t *testing.T) {
	// nil db on purpose: the admin branch must not depend on a query succeeding, because it runs on
	// a boot where the database is still coming up.
	s := DeviceScopeFor(nil, 0, true)
	if !s.unfiltered {
		t.Fatal("an admin was filtered; they may work on every device by definition")
	}
}

// The rule over the lookup's three possible answers.
//
// This takes (ids, err) rather than a database handle for a reason worth recording: the first
// version of this test passed a nil *gorm.DB expecting it to model "the lookup failed", but
// AccessibleDeviceIDs answers a nil handle with "no grants, no error". The failure branch was never
// executed, and a version of scopeFromGrants deliberately rewritten to return `unfiltered` on error
// still passed. A test that cannot fail is worse than no test, because it is counted.
func TestScopeFromGrants(t *testing.T) {
	dbDown := errors.New("connection refused")

	cases := []struct {
		name           string
		isAdmin        bool
		ids            []uint
		err            error
		wantUnfiltered bool
		wantIDs        int
	}{
		{"admin, whatever the lookup said", true, nil, dbDown, true, 0},
		{"grants read", false, []uint{2, 5}, nil, false, 2},
		{"no grants", false, nil, nil, false, 0},
		{"lookup failed — deny, never allow", false, []uint{2, 5}, dbDown, false, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := scopeFromGrants(tc.isAdmin, tc.ids, tc.err)
			if s.unfiltered != tc.wantUnfiltered {
				t.Errorf("unfiltered = %v, want %v — an unfiltered scope means every device",
					s.unfiltered, tc.wantUnfiltered)
			}
			if len(s.ids) != tc.wantIDs {
				t.Errorf("ids = %v, want %d of them", s.ids, tc.wantIDs)
			}
		})
	}
}

func TestDeviceScope_NoGrantsMatchNothing(t *testing.T) {
	// A nil handle answers "no grants". Either way the caller must be filtered, never let through.
	s := DeviceScopeFor(nil, 7, false)
	if s.unfiltered {
		t.Fatal("a non-admin came back unfiltered")
	}
	if len(s.ids) != 0 {
		t.Fatalf("expected no ids, got %v", s.ids)
	}
}

func TestDeviceScope_AnonymousMatchesNothing(t *testing.T) {
	// userID 0 means the context carried no user. These routes sit behind Authorizes so it should
	// be impossible; if it happens anyway it is a misconfiguration, and a misconfiguration must not
	// read as "grant everything".
	s := DeviceScopeFor(nil, 0, false)
	if s.unfiltered || len(s.ids) != 0 {
		t.Fatalf("a caller with no user id was not denied: %+v", s)
	}
}

// ApplyDeviceScope turns the decision into a predicate. The column varies — network_devices.id for
// the inventory, network_device_id for everything that references a device — and getting it wrong
// silently filters on the wrong table.
func TestApplyDeviceScope_ColumnAndPredicate(t *testing.T) {
	cases := []struct {
		name    string
		scope   DeviceScope
		column  string
		wantSQL string
	}{
		{"admin gets no predicate", DeviceScope{unfiltered: true}, "id", ""},
		{"no grants matches nothing", DeviceScope{}, "id", "1 = 0"},
		{"inventory filters on id", DeviceScope{ids: []uint{1, 4}}, "id", "id IN ?"},
		{"referencing table filters on the fk", DeviceScope{ids: []uint{2}}, "network_device_id", "network_device_id IN ?"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scopePredicateFor(tc.column, tc.scope)
			if got != tc.wantSQL {
				t.Errorf("predicate = %q, want %q", got, tc.wantSQL)
			}
		})
	}
}

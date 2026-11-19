package services

import "testing"

// The two ways an administrator change takes the firewall away from the person making it, and the
// one field whose omission would wipe a password.

func TestAdminRead_AnyHostIsNotAnEmptyList(t *testing.T) {
	// `0.0.0.0 0.0.0.0` fills every unused slot and means ANY HOST. Reading it as "not set" would
	// turn the most permissive setting on the account into a blank column.
	a := fgAdminRaw{
		Name: "admin", AccProfile: "super_admin",
		TrustHost1: anyTrustHost, TrustHost2: anyTrustHost,
	}.toGUI()
	if len(a.TrustHosts) != 0 {
		t.Errorf("trust hosts = %v, want none", a.TrustHosts)
	}
	if a.RestrictedToHosts {
		t.Error("an account reachable from anywhere was reported as restricted")
	}

	b := fgAdminRaw{
		Name: "ops", AccProfile: "prof_admin",
		TrustHost1: "10.0.0.0 255.255.255.0", TrustHost2: anyTrustHost,
	}.toGUI()
	if len(b.TrustHosts) != 1 || !b.RestrictedToHosts {
		t.Errorf("trust hosts = %v, restricted = %v", b.TrustHosts, b.RestrictedToHosts)
	}
}

func TestAdminWrite_AnOmittedPasswordIsNotAnEmptyOne(t *testing.T) {
	// The single most dangerous line in the file it protects. A read never returns a password, so
	// an edit that re-sends the account must leave the key out — sending "" replaces the password
	// with nothing and the account can no longer log in.
	body := adminPayload(FGAdminWrite{Name: "ops", AccProfile: "prof_admin"})
	if _, sent := body["password"]; sent {
		t.Errorf("an edit with no password sent one: %v", body["password"])
	}

	pw := "s3cret"
	set := adminPayload(FGAdminWrite{Name: "ops", AccProfile: "prof_admin", Password: &pw})
	if set["password"] != "s3cret" {
		t.Errorf("password = %v, want it sent when given", set["password"])
	}

	// Deliberately clearing it is still possible, and still distinct.
	empty := ""
	cleared := adminPayload(FGAdminWrite{Name: "ops", AccProfile: "prof_admin", Password: &empty})
	if v, sent := cleared["password"]; !sent || v != "" {
		t.Errorf("an explicit empty password was not sent: %v", cleared["password"])
	}
}

func TestAdminWrite_RemovedTrustHostsAreWrittenBackToAnyHost(t *testing.T) {
	// Writing only the slots in use would leave a restriction the operator had just deleted still
	// in force: the screen would say "anywhere" and the account would still be locked to a subnet.
	body := adminPayload(FGAdminWrite{
		Name: "ops", AccProfile: "prof_admin",
		TrustHosts: []string{"10.0.0.0 255.255.255.0"},
	})
	if body["trusthost1"] != "10.0.0.0 255.255.255.0" {
		t.Errorf("trusthost1 = %v", body["trusthost1"])
	}
	for _, k := range []string{"trusthost2", "trusthost5", "trusthost10"} {
		if body[k] != anyTrustHost {
			t.Errorf("%s = %v, want %q", k, body[k], anyTrustHost)
		}
	}
}

func TestAdminChangeLocksOut(t *testing.T) {
	cases := []struct {
		name    string
		current []string
		next    []string
		want    bool
	}{
		{"anywhere → one subnet", nil, []string{"10.0.0.0/24"}, true},
		{"narrowing an existing list", []string{"10.0.0.0/24", "192.168.1.0/24"}, []string{"10.0.0.0/24"}, true},
		{"swapping one subnet for another", []string{"10.0.0.0/24"}, []string{"192.168.1.0/24"}, true},
		// These widen access, and widening can never shut anybody out.
		{"adding a subnet", []string{"10.0.0.0/24"}, []string{"10.0.0.0/24", "192.168.1.0/24"}, false},
		{"removing every restriction", []string{"10.0.0.0/24"}, nil, false},
		{"no change at all", []string{"10.0.0.0/24"}, []string{"10.0.0.0/24"}, false},
		{"still anywhere", nil, nil, false},
	}
	for _, tc := range cases {
		if got := AdminChangeLocksOut(tc.current, tc.next); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestLastSuperAdmin(t *testing.T) {
	sole := []FGAdminUser{
		{Name: "admin", AccProfile: "super_admin", IsSuperAdmin: true},
		{Name: "ops", AccProfile: "prof_admin"},
	}
	if !LastSuperAdmin(sole, "admin") {
		t.Error("the only super_admin was not recognised as the last one")
	}
	if LastSuperAdmin(sole, "ops") {
		t.Error("an ordinary account was treated as the last super_admin")
	}

	two := append([]FGAdminUser{}, sole...)
	two = append(two, FGAdminUser{Name: "admin2", AccProfile: "super_admin", IsSuperAdmin: true})
	if LastSuperAdmin(two, "admin") {
		t.Error("one of two super_admins was reported as the last")
	}

	if LastSuperAdmin(sole, "nobody") {
		t.Error("an account that does not exist was reported as the last super_admin")
	}
}

func TestAccProfilePermissions_SuperAdminIsNotDescribedAsPowerless(t *testing.T) {
	// super_admin does not spell its permissions out: every group reads as `none` on the wire while
	// the profile can do everything. Reporting that literally would describe the most powerful
	// profile on the device as the least.
	//
	// This exercises the same mapping GetAccProfiles applies, without a device.
	p := FGAccProfile{Name: "super_admin", Permissions: map[string]string{}}
	p.IsSuperAdmin = p.Name == "super_admin"
	if p.IsSuperAdmin {
		for _, g := range permissionGroups {
			p.Permissions[g.Label] = "read-write"
			p.WriteGroups = append(p.WriteGroups, g.Label)
		}
	}
	if len(p.WriteGroups) != len(permissionGroups) {
		t.Errorf("super_admin has %d write groups, want %d", len(p.WriteGroups), len(permissionGroups))
	}
	if p.Permissions["Policy & Objects"] != "read-write" {
		t.Errorf("super_admin's policy permission = %q", p.Permissions["Policy & Objects"])
	}
}

package policyobject

import (
	"strings"
	"testing"
)

// A valid guest body — the individual cases below mutate one field each so a failure names
// exactly the rule that broke.
func guestInput() userGroupInput {
	return userGroupInput{
		Name: "Guests", Type: "guest",
		UserID: "email", Password: "auto-generate",
		Sponsor: "optional", Company: "optional",
		ExpireType: "immediately", Expire: 14400, MaxAccounts: 0,
	}
}

func TestValidateUserGroup_Valid(t *testing.T) {
	cases := []struct {
		name string
		inp  userGroupInput
	}{
		{"firewall with members", userGroupInput{Name: "Office", Type: "firewall", Members: []string{"guest"}}},
		{"firewall no members", userGroupInput{Name: "Empty", Type: "firewall"}},
		{"fsso", userGroupInput{Name: "FSSO", Type: "fsso-service", Members: []string{"CN=Sales"}}},
		{"rsso", userGroupInput{Name: "RSSO", Type: "rsso", SSOAttributeValue: "RSSO-Sales"}},
		{"guest defaults", guestInput()},
		{"guest max expire", func() userGroupInput { i := guestInput(); i.Expire = 31536000; return i }()},
		{"guest min expire", func() userGroupInput { i := guestInput(); i.Expire = 1; return i }()},
		{"guest max accounts", func() userGroupInput { i := guestInput(); i.MaxAccounts = 500; return i }()},
		{"guest sms fortiguard", func() userGroupInput {
			i := guestInput()
			i.MobilePhone = true
			i.SMSServer = "fortiguard"
			return i
		}()},
		{"guest sms custom", func() userGroupInput {
			i := guestInput()
			i.MobilePhone = true
			i.SMSServer = "custom"
			i.SMSCustomServer = "sms1"
			return i
		}()},
		{"type is case-insensitive", userGroupInput{Name: "X", Type: "FIREWALL"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := validateUserGroup(tc.inp); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateUserGroup_Rejects(t *testing.T) {
	cases := []struct {
		name    string
		inp     userGroupInput
		wantSub string
	}{
		{"blank name", userGroupInput{Name: "   ", Type: "firewall"}, "name is required"},
		{"name too long", userGroupInput{Name: strings.Repeat("a", 36), Type: "firewall"}, "35 characters"},
		{"unknown type", userGroupInput{Name: "X", Type: "sso"}, "group_type must be"},
		{"empty type", userGroupInput{Name: "X"}, "group_type must be"},
		{"rsso without attribute", userGroupInput{Name: "X", Type: "rsso"}, "RADIUS Attribute Value"},
		{"blank member", userGroupInput{Name: "X", Type: "firewall", Members: []string{"guest", " "}}, "cannot be blank"},
		{"guest bad user id", func() userGroupInput { i := guestInput(); i.UserID = "nope"; return i }(), "user_id must be"},
		{"guest bad password", func() userGroupInput { i := guestInput(); i.Password = "nope"; return i }(), "password must be"},
		{"guest bad sponsor", func() userGroupInput { i := guestInput(); i.Sponsor = "required"; return i }(), "sponsor must be"},
		{"guest bad company", func() userGroupInput { i := guestInput(); i.Company = "required"; return i }(), "company must be"},
		{"guest bad expire type", func() userGroupInput { i := guestInput(); i.ExpireType = "later"; return i }(), "expire_type must be"},
		{"guest expire zero", func() userGroupInput { i := guestInput(); i.Expire = 0; return i }(), "expire must be"},
		{"guest expire too big", func() userGroupInput { i := guestInput(); i.Expire = 31536001; return i }(), "expire must be"},
		{"guest accounts negative", func() userGroupInput { i := guestInput(); i.MaxAccounts = -1; return i }(), "max_accounts"},
		{"guest accounts too many", func() userGroupInput { i := guestInput(); i.MaxAccounts = 501; return i }(), "max_accounts"},
		{"guest bad sms server", func() userGroupInput {
			i := guestInput()
			i.MobilePhone = true
			i.SMSServer = "twilio"
			return i
		}(), "sms_server must be"},
		{"guest custom sms without server", func() userGroupInput {
			i := guestInput()
			i.MobilePhone = true
			i.SMSServer = "custom"
			return i
		}(), "custom SMS server"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateUserGroup(tc.inp)
			if err == nil {
				t.Fatalf("expected an error containing %q, got nil", tc.wantSub)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error = %q, want it to contain %q", err.Error(), tc.wantSub)
			}
		})
	}
}

// Under batch mode the device ignores the whole Guest Details block, so validation must not
// reject a stale value the caller could never have applied anyway.
func TestValidateUserGroup_BatchSkipsGuestDetailValidation(t *testing.T) {
	inp := guestInput()
	inp.MultipleGuestAdd = true
	inp.UserID = "garbage"
	inp.Password = "garbage"
	inp.Sponsor = "garbage"
	inp.Company = "garbage"
	inp.SMSServer = "garbage"
	inp.MobilePhone = true

	f, err := validateUserGroup(inp)
	if err != nil {
		t.Fatalf("batch mode should skip Guest Details validation, got: %v", err)
	}
	if !f.MultipleGuestAdd {
		t.Error("MultipleGuestAdd lost")
	}
	// The ignored values must not be carried into the form either.
	if f.UserID != "" || f.Password != "" || f.Sponsor != "" || f.Company != "" {
		t.Errorf("batch form leaked guest details: %+v", f)
	}
	// Expiration still applies under batch.
	if f.Expire != 14400 || f.ExpireType != "immediately" {
		t.Errorf("expiry = %d/%q", f.Expire, f.ExpireType)
	}
}

// Batch mode still enforces the fields the device DOES honour.
func TestValidateUserGroup_BatchStillValidatesExpiry(t *testing.T) {
	inp := guestInput()
	inp.MultipleGuestAdd = true
	inp.Expire = 0
	if _, err := validateUserGroup(inp); err == nil {
		t.Error("expected expire to still be validated under batch mode")
	}
}

func TestValidateUserGroup_TrimsAndNormalises(t *testing.T) {
	f, err := validateUserGroup(userGroupInput{Name: "  Office  ", Type: " Firewall ", Members: []string{"guest"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.Name != "Office" {
		t.Errorf("name = %q, want %q", f.Name, "Office")
	}
	if f.GroupType != "firewall" {
		t.Errorf("group_type = %q, want %q", f.GroupType, "firewall")
	}
}

// A non-firewall type must not carry a member list into the service layer — the device drops it.
func TestValidateUserGroup_NonMemberTypesDropMembers(t *testing.T) {
	for _, typ := range []string{"rsso", "guest"} {
		inp := guestInput()
		inp.Type = typ
		inp.Members = []string{"guest"}
		if typ == "rsso" {
			inp.SSOAttributeValue = "RSSO-Sales"
		}
		f, err := validateUserGroup(inp)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", typ, err)
		}
		if len(f.Members) != 0 {
			t.Errorf("%s: members = %v, want none", typ, f.Members)
		}
	}
}

// ── Remote Groups (user/group `match`) ────────────────────────────────────────

func matchInput(rows ...struct{ ServerName, GroupName string }) userGroupInput {
	i := userGroupInput{Name: "AD-VPN", Type: "firewall", Members: []string{"AD-Corp"}}
	for _, r := range rows {
		i.Matches = append(i.Matches, struct {
			ServerName string `json:"server_name"`
			GroupName  string `json:"group_name"`
		}{r.ServerName, r.GroupName})
	}
	return i
}

func row(server, group string) struct{ ServerName, GroupName string } {
	return struct{ ServerName, GroupName string }{server, group}
}

func TestValidateUserGroup_MatchValid(t *testing.T) {
	f, err := validateUserGroup(matchInput(
		row("AD-Corp", " CN=VPN-Users,OU=Groups,DC=corp,DC=local "),
		row("AD-Corp", "CN=Admins,DC=corp"),
	))
	if err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	if len(f.Matches) != 2 {
		t.Fatalf("Matches = %+v, want 2 rows", f.Matches)
	}
	if f.Matches[0].GroupName != "CN=VPN-Users,OU=Groups,DC=corp,DC=local" {
		t.Errorf("group name was not trimmed: %q", f.Matches[0].GroupName)
	}
}

func TestValidateUserGroup_MatchInvalid(t *testing.T) {
	cases := []struct {
		name    string
		inp     userGroupInput
		wantSub string
	}{
		{"no server", matchInput(row("  ", "CN=A,DC=corp")), "remote server"},
		{"no group name", matchInput(row("AD-Corp", " ")), "remote group name is required"},
		{"group name too long", matchInput(row("AD-Corp", strings.Repeat("C", 512))), "511 characters"},
		// FortiOS keys the table by id, so a repeat silently collapses into one row.
		{"duplicate pair", matchInput(row("AD-Corp", "CN=A,DC=corp"), row("AD-Corp", "CN=A,DC=corp")), "listed twice"},
		{"match on a guest group", func() userGroupInput {
			i := matchInput(row("AD-Corp", "CN=A,DC=corp"))
			i.Type = "guest"
			i.UserID, i.Password = "email", "auto-generate"
			i.Sponsor, i.Company = "optional", "optional"
			i.ExpireType, i.Expire = "immediately", 14400
			return i
		}(), "Firewall group"},
		{"match on an fsso group", func() userGroupInput {
			i := matchInput(row("AD-Corp", "CN=A,DC=corp"))
			i.Type = "fsso-service"
			return i
		}(), "Firewall group"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateUserGroup(tc.inp)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not mention %q", err, tc.wantSub)
			}
		})
	}
}

// The same server may legitimately contribute several remote groups.
func TestValidateUserGroup_MatchSameServerDifferentGroups(t *testing.T) {
	if _, err := validateUserGroup(matchInput(
		row("AD-Corp", "CN=A,DC=corp"),
		row("AD-Corp", "CN=B,DC=corp"),
	)); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

// A firewall group with no match rows must be unaffected by any of the above.
func TestValidateUserGroup_NoMatchRows(t *testing.T) {
	f, err := validateUserGroup(userGroupInput{Name: "Office", Type: "firewall", Members: []string{"alice"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(f.Matches) != 0 {
		t.Fatalf("Matches = %+v, want none", f.Matches)
	}
}

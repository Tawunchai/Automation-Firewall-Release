package services

import (
	"encoding/json"
	"reflect"
	"testing"
)

// These cases pin the payload builder to behaviour VERIFIED against the lab FortiGate
// (FortiGate 80E, FortiOS 7.2.10). Each "silently" note below is a real observed response:
// the device answered HTTP 200 "success" and stored something other than what was sent.

func memberNames(t *testing.T, v interface{}) []string {
	t.Helper()
	names, ok := v.([]FGName)
	if !ok {
		t.Fatalf("member is %T, want []FGName", v)
	}
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, n.Name)
	}
	return out
}

func TestBuildUserGroupPayload_Firewall(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "Office-Users", GroupType: "firewall", Members: []string{"guest", "alice"},
	})

	if p["name"] != "Office-Users" {
		t.Errorf("name = %v", p["name"])
	}
	if p["group-type"] != "firewall" {
		t.Errorf("group-type = %v", p["group-type"])
	}
	got := memberNames(t, p["member"])
	if len(got) != 2 || got[0] != "guest" || got[1] != "alice" {
		t.Errorf("member = %v, want [guest alice]", got)
	}
	// A firewall group must not carry the guest block — those keys belong to group-type guest.
	for _, k := range []string{"user-id", "password", "expire", "expire-type", "sso-attribute-value"} {
		if _, ok := p[k]; ok {
			t.Errorf("firewall payload leaked %q", k)
		}
	}
}

func TestBuildUserGroupPayload_FSSOSendsMembers(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "FSSO-Grp", GroupType: "fsso-service", Members: []string{"CN=Sales"},
	})
	if got := memberNames(t, p["member"]); len(got) != 1 || got[0] != "CN=Sales" {
		t.Errorf("member = %v, want [CN=Sales]", got)
	}
}

func TestBuildUserGroupPayload_RSSO(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "RSSO-Grp", GroupType: "rsso", SSOAttributeValue: "RSSO-Sales",
		// Members set but must be ignored: an RSSO group has no member list.
		Members: []string{"guest"},
	})
	if p["sso-attribute-value"] != "RSSO-Sales" {
		t.Errorf("sso-attribute-value = %v", p["sso-attribute-value"])
	}
	if _, ok := p["member"]; ok {
		t.Error("rsso payload must not send member")
	}
}

// The full guest block round-trips when batch mode is OFF — verified live: every field below
// came back from the device exactly as sent.
func TestBuildUserGroupPayload_GuestNoBatch(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "Guests", GroupType: "guest",
		MultipleGuestAdd: false,
		UserID:           "specify",
		Password:         "specify",
		UserName:         true,
		Email:            false,
		MobilePhone:      true,
		SMSServer:        "fortiguard",
		Sponsor:          "mandatory",
		Company:          "disabled",
		ExpireType:       "first-successful-login",
		Expire:           7200,
		MaxAccounts:      25,
	})

	want := map[string]interface{}{
		"group-type":         "guest",
		"multiple-guest-add": "disable",
		"user-id":            "specify",
		"password":           "specify",
		"user-name":          "enable",
		"email":              "disable",
		"mobile-phone":       "enable",
		"sms-server":         "fortiguard",
		"sponsor":            "mandatory",
		"company":            "disabled",
		"expire-type":        "first-successful-login",
		"expire":             7200,
		"max-accounts":       25,
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v (%T), want %v", k, p[k], p[k], v)
		}
	}
	// sms-custom-server is only meaningful for sms-server=custom.
	if _, ok := p["sms-custom-server"]; ok {
		t.Error("sms-custom-server sent with sms-server=fortiguard")
	}
	if _, ok := p["member"]; ok {
		t.Error("guest payload must not send member — the device drops it")
	}
}

// ⚠️ THE BATCH GOTCHA. Verified live: with multiple-guest-add=enable the FortiGate FORCES
// user-id/password to auto-generate and resets user-name/email/mobile-phone/sponsor/company to
// their defaults — while answering HTTP 200 "success". Sending them is a silent no-op, so the
// payload must omit them. What DOES still apply under batch: max-accounts, expire-type, expire.
func TestBuildUserGroupPayload_GuestBatchOmitsIgnoredFields(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "Batch-Guests", GroupType: "guest",
		MultipleGuestAdd: true,
		// All of these are ignored by the device under batch mode:
		UserID: "specify", Password: "specify", UserName: true, Email: false,
		MobilePhone: true, SMSServer: "custom", SMSCustomServer: "sms1",
		Sponsor: "mandatory", Company: "disabled",
		// These still apply:
		ExpireType: "first-successful-login", Expire: 3600, MaxAccounts: 10,
	})

	for _, k := range []string{
		"user-id", "password", "user-name", "email", "mobile-phone",
		"sms-server", "sms-custom-server", "sponsor", "company",
	} {
		if _, ok := p[k]; ok {
			t.Errorf("batch payload must omit %q — the device ignores it", k)
		}
	}
	if p["multiple-guest-add"] != "enable" {
		t.Errorf("multiple-guest-add = %v, want enable", p["multiple-guest-add"])
	}
	if p["expire"] != 3600 || p["expire-type"] != "first-successful-login" || p["max-accounts"] != 10 {
		t.Errorf("batch mode must still send expiration/max-accounts, got %v", p)
	}
}

// sms-custom-server is a datasource (system.sms-server.name): a value the device doesn't have
// comes back as "-3 entry not found in datasource", so it is only ever sent for sms-server=custom.
func TestBuildUserGroupPayload_GuestSMSCustom(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "guest", MobilePhone: true,
		SMSServer: "custom", SMSCustomServer: "my-sms",
		UserID: "email", Password: "auto-generate", Sponsor: "optional", Company: "optional",
		ExpireType: "immediately", Expire: 14400,
	})
	if p["sms-server"] != "custom" || p["sms-custom-server"] != "my-sms" {
		t.Errorf("sms keys = %v / %v", p["sms-server"], p["sms-custom-server"])
	}
}

// Enable SMS off ⇒ the SMS keys are irrelevant and must not be sent at all.
func TestBuildUserGroupPayload_GuestNoSMSWhenMobileOff(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "guest", MobilePhone: false, SMSServer: "custom", SMSCustomServer: "x",
		UserID: "email", Password: "auto-generate", Sponsor: "optional", Company: "optional",
		ExpireType: "immediately", Expire: 14400,
	})
	for _, k := range []string{"sms-server", "sms-custom-server"} {
		if _, ok := p[k]; ok {
			t.Errorf("%q sent while mobile-phone is disabled", k)
		}
	}
}

// max-accounts 0 means "unlimited" and must survive as a real 0, not be dropped as a zero value.
func TestBuildUserGroupPayload_GuestUnlimitedAccounts(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "guest", MaxAccounts: 0, ExpireType: "immediately", Expire: 14400,
		UserID: "email", Password: "auto-generate", Sponsor: "optional", Company: "optional",
	})
	v, ok := p["max-accounts"]
	if !ok || v != 0 {
		t.Errorf("max-accounts = %v (present=%v), want 0", v, ok)
	}
}

// The payload has to survive json.Marshal with the keys FortiOS expects — member is the one
// that isn't a plain scalar.
func TestBuildUserGroupPayload_MarshalsToFortiOSShape(t *testing.T) {
	b, err := json.Marshal(buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "firewall", Members: []string{"guest"},
	}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if string(got["member"]) != `[{"name":"guest"}]` {
		t.Errorf("member JSON = %s, want [{\"name\":\"guest\"}]", got["member"])
	}
}

// The parser turns a device response back into the edit form. "enable"/"disable" → bool is the
// part that silently breaks if a field is mistyped.
func TestFgUserGroupRawToForm(t *testing.T) {
	raw := fgUserGroupRaw{
		Name: "Guests", GroupType: "guest",
		Member:           []FGName{{Name: "guest"}},
		MultipleGuestAdd: "disable",
		UserID:           "specify",
		MaxAccounts:      25,
		UserName:         "enable",
		Email:            "disable",
		MobilePhone:      "enable",
		SMSServer:        "fortiguard",
		Password:         "specify",
		Sponsor:          "mandatory",
		Company:          "disabled",
		ExpireType:       "first-successful-login",
		Expire:           7200,
	}
	f := raw.toForm()

	if f.Name != "Guests" || f.GroupType != "guest" {
		t.Errorf("name/type = %q/%q", f.Name, f.GroupType)
	}
	if len(f.Members) != 1 || f.Members[0] != "guest" {
		t.Errorf("members = %v", f.Members)
	}
	if f.MultipleGuestAdd {
		t.Error("MultipleGuestAdd should be false for \"disable\"")
	}
	if !f.UserName || f.Email || !f.MobilePhone {
		t.Errorf("bools: userName=%v email=%v mobile=%v, want true/false/true", f.UserName, f.Email, f.MobilePhone)
	}
	if f.UserID != "specify" || f.Password != "specify" || f.Sponsor != "mandatory" || f.Company != "disabled" {
		t.Errorf("options = %q/%q/%q/%q", f.UserID, f.Password, f.Sponsor, f.Company)
	}
	if f.Expire != 7200 || f.ExpireType != "first-successful-login" || f.MaxAccounts != 25 {
		t.Errorf("expiry = %d/%q/%d", f.Expire, f.ExpireType, f.MaxAccounts)
	}
}

func TestIsValidUserGroupType(t *testing.T) {
	for _, ok := range []string{"firewall", "fsso-service", "rsso", "guest", "GUEST"} {
		if !IsValidUserGroupType(ok) {
			t.Errorf("IsValidUserGroupType(%q) = false, want true", ok)
		}
	}
	for _, bad := range []string{"", "fsso", "radius", "Firewall-Group", "sso"} {
		if IsValidUserGroupType(bad) {
			t.Errorf("IsValidUserGroupType(%q) = true, want false", bad)
		}
	}
}

func TestUserGroupTakesMembers(t *testing.T) {
	cases := map[string]bool{"firewall": true, "fsso-service": true, "rsso": false, "guest": false}
	for typ, want := range cases {
		if got := UserGroupTakesMembers(typ); got != want {
			t.Errorf("UserGroupTakesMembers(%q) = %v, want %v", typ, got, want)
		}
	}
}

func TestUserGroupTypeLabel(t *testing.T) {
	cases := map[string]string{
		"firewall":     "Firewall",
		"fsso-service": "Fortinet Single Sign-On (FSSO)",
		"rsso":         "RADIUS Single Sign-On (RSSO)",
		"guest":        "Guest",
	}
	for code, want := range cases {
		if got := userGroupTypeLabel(code); got != want {
			t.Errorf("userGroupTypeLabel(%q) = %q, want %q", code, got, want)
		}
	}
}

// ── Remote Groups (user/group `match`) ────────────────────────────────────────
// Verified live on FortiOS 7.2.10:
//   · a match whose server is not also a MEMBER → -518 and the whole group is discarded
//   · match on guest/rsso → 200 with match=[] stored (silent drop)
//   · fsso-service cannot hold the auth server as a member at all → -3

func TestUserGroupTakesMatches(t *testing.T) {
	if !UserGroupTakesMatches("firewall") {
		t.Error("a firewall group carries the match table")
	}
	for _, ty := range []string{"fsso-service", "rsso", "guest"} {
		if UserGroupTakesMatches(ty) {
			t.Errorf("%s must not carry the match table", ty)
		}
	}
}

func TestBuildUserGroupPayload_Match(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "AD-VPN", GroupType: "firewall", Members: []string{"AD-Corp"},
		Matches: []FGUserGroupMatch{{ServerName: "AD-Corp", GroupName: "CN=VPN-Users,DC=corp"}},
	})

	rows, ok := p["match"].([]map[string]interface{})
	if !ok || len(rows) != 1 {
		t.Fatalf("match = %#v, want one row", p["match"])
	}
	// The id is positional and assigned here — the user never picks it.
	if rows[0]["id"] != 1 || rows[0]["server-name"] != "AD-Corp" || rows[0]["group-name"] != "CN=VPN-Users,DC=corp" {
		t.Fatalf("row = %#v", rows[0])
	}
}

func TestBuildUserGroupPayload_MatchNumbersRowsFromOrder(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "firewall", Members: []string{"AD-Corp"},
		Matches: []FGUserGroupMatch{
			{ServerName: "AD-Corp", GroupName: "CN=A,DC=corp"},
			{ServerName: "AD-Corp", GroupName: "CN=B,DC=corp"},
		},
	})
	rows := p["match"].([]map[string]interface{})
	if rows[0]["id"] != 1 || rows[1]["id"] != 2 {
		t.Fatalf("ids = %v/%v, want 1/2", rows[0]["id"], rows[1]["id"])
	}
}

// ⚠️ -518: the device discards the WHOLE group when a match names a non-member.
func TestBuildUserGroupPayload_MatchServerBecomesMember(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "firewall", Members: []string{"alice"},
		Matches: []FGUserGroupMatch{{ServerName: "AD-Corp", GroupName: "CN=A,DC=corp"}},
	})

	got := FGNamesToStrings(p["member"].([]FGName))
	want := []string{"alice", "AD-Corp"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("member = %v, want %v", got, want)
	}
}

func TestBuildUserGroupPayload_MatchServerNotDuplicated(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "firewall", Members: []string{"AD-Corp", "alice"},
		Matches: []FGUserGroupMatch{
			{ServerName: "AD-Corp", GroupName: "CN=A,DC=corp"},
			{ServerName: "AD-Corp", GroupName: "CN=B,DC=corp"},
		},
	})

	got := FGNamesToStrings(p["member"].([]FGName))
	want := []string{"AD-Corp", "alice"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("member = %v, want %v (order preserved, no duplicate)", got, want)
	}
}

func TestBuildUserGroupPayload_NoMatchKeyWhenEmpty(t *testing.T) {
	p := buildUserGroupPayload(FGUserGroupForm{
		Name: "G", GroupType: "firewall", Members: []string{"alice"},
	})
	if _, ok := p["match"]; ok {
		t.Fatal("match must be omitted when there are no rows")
	}
}

// Sending match on a type the device silently drops it on would make the form lie.
func TestBuildUserGroupPayload_NoMatchOnOtherTypes(t *testing.T) {
	for _, ty := range []string{"fsso-service", "rsso", "guest"} {
		p := buildUserGroupPayload(FGUserGroupForm{
			Name: "G", GroupType: ty, Members: []string{"x"},
			Matches: []FGUserGroupMatch{{ServerName: "AD-Corp", GroupName: "CN=A"}},
			UserID:  "email", Password: "auto-generate",
			Sponsor: "optional", Company: "optional",
			ExpireType: "immediately", Expire: 14400,
		})
		if _, ok := p["match"]; ok {
			t.Errorf("%s: match must never be sent", ty)
		}
	}
}

func TestAppendMatchServers(t *testing.T) {
	got := appendMatchServers([]string{"alice"}, []FGUserGroupMatch{
		{ServerName: "AD-Corp", GroupName: "CN=A"},
		{ServerName: "", GroupName: "CN=B"}, // blank server contributes nothing
		{ServerName: "NPS", GroupName: "CN=C"},
		{ServerName: "AD-Corp", GroupName: "CN=D"}, // already added
	})
	want := []string{"alice", "AD-Corp", "NPS"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// The caller's slice must not be mutated — the form keeps using it after the payload is built.
func TestAppendMatchServers_DoesNotMutateInput(t *testing.T) {
	members := []string{"alice"}
	appendMatchServers(members, []FGUserGroupMatch{{ServerName: "AD-Corp", GroupName: "CN=A"}})
	if len(members) != 1 || members[0] != "alice" {
		t.Fatalf("input was mutated: %v", members)
	}
}

package services

import "testing"

// Pinned to behaviour VERIFIED against the lab FortiGate (80E, FortiOS 7.2.10):
//   two-factor=fortitoken with no serial      ⇒ -7522 "Invalid fortitoken id"
//   two-factor=fortitoken-cloud with no email ⇒ -7524 "You must specify an email address."
//   sms-phone round-trips as "+66-812345678"

func TestJoinSMSPhone(t *testing.T) {
	cases := []struct{ cc, phone, want string }{
		{"+66", "812345678", "+66-812345678"},
		{"66", "812345678", "+66-812345678"}, // a code typed without "+" still works
		{" +66 ", " 812345678 ", "+66-812345678"},
		{"", "812345678", ""}, // no dial code ⇒ nothing to store
		{"+66", "", ""},
		{"", "", ""},
	}
	for _, c := range cases {
		if got := joinSMSPhone(c.cc, c.phone); got != c.want {
			t.Errorf("joinSMSPhone(%q,%q) = %q, want %q", c.cc, c.phone, got, c.want)
		}
	}
}

func TestSplitSMSPhone(t *testing.T) {
	cases := []struct{ in, wantCC, wantPhone string }{
		{"+66-812345678", "+66", "812345678"},
		{"+1-5551234", "+1", "5551234"},
		// Hand-edited on the device without a dial code — still show the number.
		{"812345678", "", "812345678"},
		{"", "", ""},
		{"  +66-812345678  ", "+66", "812345678"},
	}
	for _, c := range cases {
		cc, p := splitSMSPhone(c.in)
		if cc != c.wantCC || p != c.wantPhone {
			t.Errorf("splitSMSPhone(%q) = (%q,%q), want (%q,%q)", c.in, cc, p, c.wantCC, c.wantPhone)
		}
	}
}

func TestSMSPhoneRoundTrip(t *testing.T) {
	cc, phone := splitSMSPhone(joinSMSPhone("+66", "812345678"))
	if cc != "+66" || phone != "812345678" {
		t.Errorf("round trip = (%q,%q)", cc, phone)
	}
}

func TestBuildLocalUserPayload_Plain(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{
		Name: "alice", Type: "password", Password: "S3cret!", TwoFactor: "disable", Status: true,
	}, true)

	want := map[string]interface{}{
		"name": "alice", "type": "password", "status": "enable",
		"two-factor": "disable", "passwd": "S3cret!",
		// 2FA off ⇒ the contact fields are cleared, not left stale.
		"fortitoken": "", "email-to": "", "sms-phone": "",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("%s = %v, want %v", k, p[k], v)
		}
	}
}

func TestBuildLocalUserPayload_DisabledStatus(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{Name: "bob", Type: "password", TwoFactor: "disable"}, true)
	if p["status"] != "disable" {
		t.Errorf("status = %v, want disable", p["status"])
	}
}

// A blank password on update means "keep the stored one" — the device never returns the hash,
// so sending "" would wipe it.
func TestBuildLocalUserPayload_OmitsBlankPassword(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{Name: "alice", Type: "password", TwoFactor: "disable"}, true)
	if _, ok := p["passwd"]; ok {
		t.Error("blank password must not be sent")
	}
	// And it is never sent when the caller says not to.
	p2 := buildLocalUserPayload(FGLocalUserForm{Name: "alice", Password: "x", TwoFactor: "disable"}, false)
	if _, ok := p2["passwd"]; ok {
		t.Error("passwd sent despite includePassword=false")
	}
}

func TestBuildLocalUserPayload_FortiToken(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{
		Name: "alice", Type: "password", Password: "x", TwoFactor: "fortitoken",
		FortiToken: "FTKMOB0B0269CB84", EmailTo: " a@b.com ", Status: true,
	}, true)

	if p["two-factor"] != "fortitoken" {
		t.Errorf("two-factor = %v", p["two-factor"])
	}
	if p["fortitoken"] != "FTKMOB0B0269CB84" {
		t.Errorf("fortitoken = %v", p["fortitoken"])
	}
	if p["email-to"] != "a@b.com" {
		t.Errorf("email-to = %v, want it trimmed", p["email-to"])
	}
	if p["sms-phone"] != "" {
		t.Errorf("sms-phone = %v, want empty when SMS is off", p["sms-phone"])
	}
}

// FortiToken Cloud has no token serial of its own — sending a stale one would be wrong.
func TestBuildLocalUserPayload_FortiTokenCloudClearsSerial(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{
		Name: "alice", Type: "password", Password: "x", TwoFactor: "fortitoken-cloud",
		FortiToken: "FTKMOB0B0269CB84", EmailTo: "a@b.com",
	}, true)
	if p["fortitoken"] != "" {
		t.Errorf("fortitoken = %v, want cleared for fortitoken-cloud", p["fortitoken"])
	}
	if p["email-to"] != "a@b.com" {
		t.Errorf("email-to = %v", p["email-to"])
	}
}

func TestBuildLocalUserPayload_SMS(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{
		Name: "alice", Type: "password", Password: "x", TwoFactor: "fortitoken",
		FortiToken: "FTK1", EmailTo: "a@b.com",
		SMSEnabled: true, SMSCountryCode: "+66", SMSPhone: "812345678",
	}, true)

	if p["sms-server"] != "fortiguard" {
		t.Errorf("sms-server = %v, want fortiguard", p["sms-server"])
	}
	if p["sms-phone"] != "+66-812345678" {
		t.Errorf("sms-phone = %v, want +66-812345678", p["sms-phone"])
	}
}

// SMS off ⇒ the phone is cleared and no sms-server is sent.
func TestBuildLocalUserPayload_SMSOffClearsPhone(t *testing.T) {
	p := buildLocalUserPayload(FGLocalUserForm{
		Name: "alice", Type: "password", Password: "x", TwoFactor: "fortitoken", FortiToken: "FTK1",
		SMSEnabled: false, SMSCountryCode: "+66", SMSPhone: "812345678",
	}, true)
	if p["sms-phone"] != "" {
		t.Errorf("sms-phone = %v, want empty", p["sms-phone"])
	}
	if _, ok := p["sms-server"]; ok {
		t.Error("sms-server sent while SMS is off")
	}
}

func TestFgLocalUserRawToForm(t *testing.T) {
	f := fgLocalUserRaw{
		Name: "alice", Type: "password", Status: "enable", TwoFactor: "fortitoken",
		FortiToken: "FTK1", EmailTo: "a@b.com", SMSPhone: "+66-812345678",
	}.toForm()

	if f.Name != "alice" || !f.Status {
		t.Errorf("name/status = %q/%v", f.Name, f.Status)
	}
	if f.TwoFactor != "fortitoken" || f.FortiToken != "FTK1" || f.EmailTo != "a@b.com" {
		t.Errorf("2fa fields = %q/%q/%q", f.TwoFactor, f.FortiToken, f.EmailTo)
	}
	if !f.SMSEnabled || f.SMSCountryCode != "+66" || f.SMSPhone != "812345678" {
		t.Errorf("sms = %v/%q/%q", f.SMSEnabled, f.SMSCountryCode, f.SMSPhone)
	}
}

func TestFgLocalUserRawToForm_NoSMSNoTwoFactor(t *testing.T) {
	f := fgLocalUserRaw{Name: "bob", Type: "password", Status: "disable"}.toForm()
	if f.Status {
		t.Error("status should be false for \"disable\"")
	}
	if f.SMSEnabled {
		t.Error("SMSEnabled should be false when the device has no sms-phone")
	}
	// An empty two-factor from the device is the same as "disable".
	if f.TwoFactor != "disable" {
		t.Errorf("two-factor = %q, want disable", f.TwoFactor)
	}
}

// Regression: the User Definition list reported every 2FA user as OFF because two-factor was
// run through FGStringToBool. It is not an enable/disable flag — it names the 2FA method.
func TestLocalUserTwoFactorOn(t *testing.T) {
	on := []string{"fortitoken", "fortitoken-cloud", "email", "sms", "FortiToken"}
	for _, v := range on {
		if !localUserTwoFactorOn(v) {
			t.Errorf("localUserTwoFactorOn(%q) = false, want true", v)
		}
	}
	off := []string{"disable", "", "  ", "DISABLE"}
	for _, v := range off {
		if localUserTwoFactorOn(v) {
			t.Errorf("localUserTwoFactorOn(%q) = true, want false", v)
		}
	}
	// The specific bug: "enable" is not even a legal value here, and the old code only
	// returned true for it.
	if FGStringToBool("fortitoken") {
		t.Error("guard: FGStringToBool must not be used for two-factor")
	}
}

func TestIsValidLocalUserTwoFactor(t *testing.T) {
	for _, ok := range []string{"disable", "fortitoken", "fortitoken-cloud"} {
		if !IsValidLocalUserTwoFactor(ok) {
			t.Errorf("IsValidLocalUserTwoFactor(%q) = false, want true", ok)
		}
	}
	// email/sms are valid CMDB values but the wizard doesn't offer them as an auth type.
	for _, bad := range []string{"", "email", "sms", "FortiToken", "totp"} {
		if IsValidLocalUserTwoFactor(bad) {
			t.Errorf("IsValidLocalUserTwoFactor(%q) = true, want false", bad)
		}
	}
}

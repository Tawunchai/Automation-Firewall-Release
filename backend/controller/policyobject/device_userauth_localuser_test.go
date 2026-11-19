package policyobject

import (
	"strings"
	"testing"
)

// A valid Local User body; each case below mutates one field so a failure names the rule.
func localUser() localUserInput {
	return localUserInput{
		Name: "alice", Type: "password", Password: "S3cret!",
		TwoFactor: "disable", Status: true,
	}
}

func TestValidateLocalUser_Valid(t *testing.T) {
	cases := []struct {
		name string
		inp  localUserInput
	}{
		{"plain", localUser()},
		{"disabled account", func() localUserInput { i := localUser(); i.Status = false; return i }()},
		{"blank type defaults to password", func() localUserInput { i := localUser(); i.Type = ""; return i }()},
		{"blank two_factor defaults to disable", func() localUserInput { i := localUser(); i.TwoFactor = ""; return i }()},
		{"fortitoken with serial + email", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.EmailTo = "a@b.com"
			return i
		}()},
		// Either delivery channel satisfies the device — SMS alone is enough.
		{"fortitoken with serial + sms only", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.SMSEnabled = true
			i.SMSCountryCode = "+66"
			i.SMSPhone = "812345678"
			return i
		}()},
		{"fortitoken-cloud with email", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken-cloud"
			i.EmailTo = "a@b.com"
			return i
		}()},
		{"fortitoken with sms", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.SMSEnabled = true
			i.SMSCountryCode = "+66"
			i.SMSPhone = "812345678"
			return i
		}()},
		{"with groups", func() localUserInput { i := localUser(); i.Groups = []string{"Guest-group"}; return i }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := validateLocalUser(tc.inp, true); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateLocalUser_Rejects(t *testing.T) {
	cases := []struct {
		name    string
		inp     localUserInput
		wantSub string
	}{
		{"blank name", func() localUserInput { i := localUser(); i.Name = "  "; return i }(), "username is required"},
		{"name too long", func() localUserInput { i := localUser(); i.Name = strings.Repeat("a", 65); return i }(), "64 characters"},
		{"no password", func() localUserInput { i := localUser(); i.Password = ""; return i }(), "password is required"},
		{"remote type", func() localUserInput { i := localUser(); i.Type = "radius"; return i }(), "only Local User"},
		{"bad two_factor", func() localUserInput { i := localUser(); i.TwoFactor = "totp"; return i }(), "two_factor must be"},
		// The device's own rules, caught early so the user sees something actionable.
		{"fortitoken without serial", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			return i
		}(), "-7522"},
		{"fortitoken-cloud without email", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken-cloud"
			return i
		}(), "-7524"},
		// ⚠️ Verified live: a VALID FortiToken serial is still not enough — the device wants a
		// delivery channel too ("-7524 You must specify a phone number or email address").
		{"fortitoken with serial but no email and no sms", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			return i
		}(), "-7524"},
		{"fortitoken with sms enabled but blank number", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.SMSEnabled = true
			i.SMSCountryCode = "+66"
			return i
		}(), "phone number is required"},
		{"bad email", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken-cloud"
			i.EmailTo = "not-an-email"
			return i
		}(), "email address is not valid"},
		{"sms without dial code", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.SMSEnabled = true
			i.SMSPhone = "812345678"
			return i
		}(), "country dial code"},
		{"sms without number", func() localUserInput {
			i := localUser()
			i.TwoFactor = "fortitoken"
			i.FortiToken = "FTK1"
			i.SMSEnabled = true
			i.SMSCountryCode = "+66"
			return i
		}(), "phone number is required"},
		{"blank group name", func() localUserInput { i := localUser(); i.Groups = []string{"ok", " "}; return i }(), "cannot be blank"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateLocalUser(tc.inp, true)
			if err == nil {
				t.Fatalf("expected an error containing %q, got nil", tc.wantSub)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error = %q, want it to contain %q", err.Error(), tc.wantSub)
			}
		})
	}
}

// On edit a blank password means "keep the stored one" — the device never returns it to prefill.
func TestValidateLocalUser_PasswordOptionalOnEdit(t *testing.T) {
	inp := localUser()
	inp.Password = ""
	if _, err := validateLocalUser(inp, false); err != nil {
		t.Errorf("blank password should be allowed on edit, got: %v", err)
	}
	if _, err := validateLocalUser(inp, true); err == nil {
		t.Error("blank password should still be rejected on create")
	}
}

// With 2FA off the contact fields are irrelevant — they must not be validated or carried over.
func TestValidateLocalUser_TwoFactorOffDropsContactFields(t *testing.T) {
	inp := localUser()
	inp.TwoFactor = "disable"
	inp.FortiToken = "FTK1"
	inp.EmailTo = "garbage-not-an-email"
	inp.SMSEnabled = true
	inp.SMSPhone = "812345678"

	f, err := validateLocalUser(inp, true)
	if err != nil {
		t.Fatalf("2FA off should skip contact validation, got: %v", err)
	}
	if f.FortiToken != "" || f.EmailTo != "" || f.SMSEnabled || f.SMSPhone != "" {
		t.Errorf("contact fields leaked with 2FA off: %+v", f)
	}
}

func TestValidateLocalUser_TrimsAndNormalises(t *testing.T) {
	inp := localUser()
	inp.Name = "  alice  "
	inp.TwoFactor = "fortitoken"
	inp.FortiToken = "  FTK1  "
	inp.EmailTo = "  a@b.com  "

	f, err := validateLocalUser(inp, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.Name != "alice" || f.FortiToken != "FTK1" || f.EmailTo != "a@b.com" {
		t.Errorf("not trimmed: %q / %q / %q", f.Name, f.FortiToken, f.EmailTo)
	}
	if f.Type != "password" {
		t.Errorf("type = %q, want password", f.Type)
	}
}

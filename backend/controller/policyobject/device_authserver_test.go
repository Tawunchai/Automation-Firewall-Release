package policyobject

import (
	"fmt"
	"strings"
	"testing"

	"network_automation/services"
)

// These cover the create/edit contract of the LDAP / RADIUS / Exchange forms: every rule the
// FortiGate dialog enforces should fail HERE with a readable message, not on the device with a
// bare FortiOS code.

// ── LDAP ─────────────────────────────────────────────────────────────────────

func ldapInput() ldapServerInput {
	return ldapServerInput{
		Name: "AD-Corp", Server: "10.0.1.10", Port: 389, CNID: "cn", DN: "dc=corp,dc=local",
		BindType: "simple",
	}
}

func TestValidateLDAPServer_Valid(t *testing.T) {
	cases := []struct {
		name string
		inp  ldapServerInput
	}{
		{"simple bind", ldapInput()},
		{"anonymous bind", func() ldapServerInput { i := ldapInput(); i.BindType = "anonymous"; return i }()},
		{"regular bind", func() ldapServerInput {
			i := ldapInput()
			i.BindType, i.Username, i.Password = "regular", "CN=svc,DC=corp,DC=local", "S3cret"
			return i
		}()},
		{"blank DN is allowed", func() ldapServerInput { i := ldapInput(); i.DN = ""; return i }()},
		{"starttls without certificate", func() ldapServerInput {
			i := ldapInput()
			i.SecureEnabled, i.Protocol = true, "starttls"
			return i
		}()},
		{"ldaps with certificate", func() ldapServerInput {
			i := ldapInput()
			i.SecureEnabled, i.Protocol = true, "ldaps"
			i.Port = 636
			i.CertEnabled, i.CACert, i.ServerIdentityCheck = true, "ACCVRAIZ1", true
			return i
		}()},
		{"exchange server selected", func() ldapServerInput {
			i := ldapInput()
			i.ExchangeEnabled, i.ExchangeServer = true, "EXCH-Corp"
			return i
		}()},
		{"port at bounds", func() ldapServerInput { i := ldapInput(); i.Port = 65535; return i }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := validateLDAPServer(tc.inp, true); err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
		})
	}
}

func TestValidateLDAPServer_Invalid(t *testing.T) {
	cases := []struct {
		name    string
		inp     ldapServerInput
		wantSub string
	}{
		{"no name", func() ldapServerInput { i := ldapInput(); i.Name = "  "; return i }(), "name is required"},
		{"name too long", func() ldapServerInput { i := ldapInput(); i.Name = strings.Repeat("a", 36); return i }(), "35 characters"},
		{"no server", func() ldapServerInput { i := ldapInput(); i.Server = ""; return i }(), "server IP/name is required"},
		{"server too long", func() ldapServerInput { i := ldapInput(); i.Server = strings.Repeat("a", 64); return i }(), "63 characters"},
		{"port too high", func() ldapServerInput { i := ldapInput(); i.Port = 65536; return i }(), "1-65535"},
		{"negative port", func() ldapServerInput { i := ldapInput(); i.Port = -1; return i }(), "1-65535"},
		{"no cnid", func() ldapServerInput { i := ldapInput(); i.CNID = ""; return i }(), "common name identifier"},
		{"cnid too long", func() ldapServerInput { i := ldapInput(); i.CNID = strings.Repeat("c", 21); return i }(), "20 characters"},
		{"dn too long", func() ldapServerInput { i := ldapInput(); i.DN = strings.Repeat("d", 512); return i }(), "511 characters"},
		{"bad bind type", func() ldapServerInput { i := ldapInput(); i.BindType = "kerberos"; return i }(), "bind type"},
		{"regular without username", func() ldapServerInput {
			i := ldapInput()
			i.BindType, i.Password = "regular", "S3cret"
			return i
		}(), "username is required"},
		{"regular without password", func() ldapServerInput {
			i := ldapInput()
			i.BindType, i.Username = "regular", "svc"
			return i
		}(), "password is required"},
		{"bad protocol", func() ldapServerInput {
			i := ldapInput()
			i.SecureEnabled, i.Protocol = true, "tls"
			return i
		}(), "starttls or ldaps"},
		{"certificate on with no CA", func() ldapServerInput {
			i := ldapInput()
			i.SecureEnabled, i.Protocol, i.CertEnabled = true, "ldaps", true
			return i
		}(), "CA certificate"},
		{"exchange on with no connector", func() ldapServerInput {
			i := ldapInput()
			i.ExchangeEnabled = true
			return i
		}(), "Exchange server connector"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateLDAPServer(tc.inp, true)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not mention %q", err, tc.wantSub)
			}
		})
	}
}

// Edit accepts a blank password: the device answers "ENC XXXX" so the form can never prefill
// the real one, and blank has to mean "keep what's stored".
func TestValidateLDAPServer_BlankPasswordOKOnEdit(t *testing.T) {
	i := ldapInput()
	i.BindType, i.Username = "regular", "svc"

	if _, err := validateLDAPServer(i, false); err != nil {
		t.Fatalf("edit with blank password should pass, got %v", err)
	}
	if _, err := validateLDAPServer(i, true); err == nil {
		t.Fatal("create with blank password should fail")
	}
}

func TestValidateLDAPServer_Defaults(t *testing.T) {
	i := ldapInput()
	i.Port = 0
	i.BindType = ""

	f, err := validateLDAPServer(i, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.Port != services.LDAPPortDefault {
		t.Errorf("Port = %d, want the %d default", f.Port, services.LDAPPortDefault)
	}
	if f.BindType != services.LDAPBindSimple {
		t.Errorf("BindType = %q, want the simple default", f.BindType)
	}
}

// Secure Connection off must not carry the certificate settings through — otherwise the
// payload builder would still be handed a CA cert to reason about.
func TestValidateLDAPServer_SecureOffDropsCertFields(t *testing.T) {
	i := ldapInput()
	i.SecureEnabled = false
	i.CertEnabled, i.CACert, i.ServerIdentityCheck = true, "ACCVRAIZ1", true

	f, err := validateLDAPServer(i, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.CertEnabled || f.CACert != "" || f.ServerIdentityCheck {
		t.Fatalf("cert settings survived Secure Connection being off: %+v", f)
	}
}

func TestValidateLDAPServer_TrimsWhitespace(t *testing.T) {
	i := ldapInput()
	i.Name, i.Server, i.CNID, i.DN = "  AD-Corp  ", "  10.0.1.10 ", " cn ", " dc=corp "

	f, err := validateLDAPServer(i, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.Name != "AD-Corp" || f.Server != "10.0.1.10" || f.CNID != "cn" || f.DN != "dc=corp" {
		t.Fatalf("values were not trimmed: %+v", f)
	}
}

// ── RADIUS ───────────────────────────────────────────────────────────────────

func radiusInput() radiusServerInput {
	return radiusServerInput{Name: "NPS-Corp", Server: "10.0.2.10", Secret: "radsecret"}
}

func TestValidateRADIUSServer_Valid(t *testing.T) {
	cases := []struct {
		name string
		inp  radiusServerInput
	}{
		{"primary only", radiusInput()},
		{"specify pap", func() radiusServerInput {
			i := radiusInput()
			i.AuthMethodSpecify, i.AuthType = true, "pap"
			return i
		}()},
		{"specify ms_chap_v2", func() radiusServerInput {
			i := radiusInput()
			i.AuthMethodSpecify, i.AuthType = true, "ms_chap_v2"
			return i
		}()},
		{"with NAS IP", func() radiusServerInput { i := radiusInput(); i.NASIP = "10.0.99.201"; return i }()},
		{"include in every user group", func() radiusServerInput { i := radiusInput(); i.AllUserGroup = true; return i }()},
		{"primary + secondary", func() radiusServerInput {
			i := radiusInput()
			i.SecondaryServer, i.SecondarySecret = "10.0.2.11", "s2"
			return i
		}()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := validateRADIUSServer(tc.inp, true); err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
		})
	}
}

func TestValidateRADIUSServer_Invalid(t *testing.T) {
	cases := []struct {
		name    string
		inp     radiusServerInput
		wantSub string
	}{
		{"no name", func() radiusServerInput { i := radiusInput(); i.Name = ""; return i }(), "name is required"},
		{"name too long", func() radiusServerInput { i := radiusInput(); i.Name = strings.Repeat("n", 36); return i }(), "35 characters"},
		{"no primary server", func() radiusServerInput { i := radiusInput(); i.Server = " "; return i }(), "primary server IP/name is required"},
		{"no primary secret", func() radiusServerInput { i := radiusInput(); i.Secret = ""; return i }(), "primary server secret is required"},
		{"specify with auto", func() radiusServerInput {
			i := radiusInput()
			i.AuthMethodSpecify, i.AuthType = true, "auto"
			return i
		}(), "authentication method"},
		{"specify with junk", func() radiusServerInput {
			i := radiusInput()
			i.AuthMethodSpecify, i.AuthType = true, "eap"
			return i
		}(), "authentication method"},
		{"bad NAS IP", func() radiusServerInput { i := radiusInput(); i.NASIP = "not-an-ip"; return i }(), "valid IPv4"},
		{"IPv6 NAS IP", func() radiusServerInput { i := radiusInput(); i.NASIP = "2001:db8::1"; return i }(), "valid IPv4"},
		{"secondary without secret", func() radiusServerInput {
			i := radiusInput()
			i.SecondaryServer = "10.0.2.11"
			return i
		}(), "secondary server secret is required"},
		{"secondary too long", func() radiusServerInput {
			i := radiusInput()
			i.SecondaryServer, i.SecondarySecret = strings.Repeat("s", 64), "s2"
			return i
		}(), "63 characters"},
		// FortiOS -61: the two addresses must be distinct.
		{"secondary repeats primary", func() radiusServerInput {
			i := radiusInput()
			i.SecondaryServer, i.SecondarySecret = "10.0.2.10", "s2"
			return i
		}(), "to be different"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateRADIUSServer(tc.inp, true)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not mention %q", err, tc.wantSub)
			}
		})
	}
}

func TestValidateRADIUSServer_BlankSecretsOKOnEdit(t *testing.T) {
	i := radiusInput()
	i.Secret = ""
	i.SecondaryServer = "10.0.2.11" // kept, secret unchanged

	if _, err := validateRADIUSServer(i, false); err != nil {
		t.Fatalf("edit with blank secrets should pass, got %v", err)
	}
}

func TestValidateRADIUSServer_Defaults(t *testing.T) {
	f, err := validateRADIUSServer(radiusInput(), true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.AuthType != services.RADIUSAuthAuto || f.AuthMethodSpecify {
		t.Errorf("auth = %q/%v, want auto/Default", f.AuthType, f.AuthMethodSpecify)
	}
}

// An empty secondary host must NOT trip the "secret is required" rule. It reaches the payload
// builder as "", which omits the key — the device cannot unset a secondary host over REST
// (services.RADIUSBackupServerClearable), and sending "" would fail the whole save with -257.
func TestValidateRADIUSServer_EmptySecondaryServer(t *testing.T) {
	i := radiusInput()
	i.SecondaryServer, i.SecondarySecret = "   ", ""

	f, err := validateRADIUSServer(i, true)
	if err != nil {
		t.Fatalf("an empty secondary server should be allowed, got %v", err)
	}
	if f.SecondaryServer != "" {
		t.Fatalf("SecondaryServer = %q, want empty", f.SecondaryServer)
	}
}

// Distinctness only applies when a secondary is actually set.
func TestValidateRADIUSServer_EmptySecondaryIsNotADuplicate(t *testing.T) {
	if _, err := validateRADIUSServer(radiusInput(), true); err != nil {
		t.Fatalf("an empty secondary slot should not collide, got %v", err)
	}
}

// ── Exchange connector ───────────────────────────────────────────────────────

func exchangeInput() exchangeConnectorInput {
	return exchangeConnectorInput{
		Name: "EXCH-Corp", Username: "svc-fgt", ServerName: "mail.corp.local",
		DomainName: "corp.local", Password: "P@ss", AutoDiscoverKDC: true,
	}
}

func TestValidateExchangeConnector_Valid(t *testing.T) {
	if _, err := validateExchangeConnector(exchangeInput()); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}

	i := exchangeInput()
	i.OverrideIP, i.IP = true, "192.168.10.5"
	f, err := validateExchangeConnector(i)
	if err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	if f.IP != "192.168.10.5" {
		t.Fatalf("IP = %q", f.IP)
	}
}

func TestValidateExchangeConnector_Invalid(t *testing.T) {
	cases := []struct {
		name    string
		inp     exchangeConnectorInput
		wantSub string
	}{
		{"no name", func() exchangeConnectorInput { i := exchangeInput(); i.Name = ""; return i }(), "name is required"},
		{"name too long", func() exchangeConnectorInput { i := exchangeInput(); i.Name = strings.Repeat("e", 36); return i }(), "35 characters"},
		{"no username", func() exchangeConnectorInput { i := exchangeInput(); i.Username = ""; return i }(), "username@server.domain.com"},
		{"no server", func() exchangeConnectorInput { i := exchangeInput(); i.ServerName = ""; return i }(), "username@server.domain.com"},
		{"no password", func() exchangeConnectorInput { i := exchangeInput(); i.Password = ""; return i }(), "password is required"},
		{"override with bad IP", func() exchangeConnectorInput {
			i := exchangeInput()
			i.OverrideIP, i.IP = true, "300.1.1.1"
			return i
		}(), "valid IPv4"},
		{"override with no IP", func() exchangeConnectorInput {
			i := exchangeInput()
			i.OverrideIP = true
			return i
		}(), "valid IPv4"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateExchangeConnector(tc.inp)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not mention %q", err, tc.wantSub)
			}
		})
	}
}

// ── Delete error mapping ─────────────────────────────────────────────────────

func TestAuthServerDeleteMsg(t *testing.T) {
	// The typed error is what the device layer really hands back — services.DeleteLDAPServer wraps
	// it with %w, so the code survives however many layers add context on the way up.
	deviceSaysReferenced := fmt.Errorf("failed to delete LDAP server %q: %w", "ldap-1",
		&services.DeviceError{Code: -23, HTTPStatus: 500, Text: "error code -23"})

	referenced := authServerDeleteMsg(deviceSaysReferenced, "LDAP server")
	if !strings.Contains(referenced, "still referenced") {
		t.Fatalf("-23 should explain the reference, got %q", referenced)
	}

	// The same message as plain text, for a path that has lost the typed error somewhere. The
	// fixture is the string the code ACTUALLY produces; the previous version of this test used
	// "FortiGate API error -23", which nothing emits — it passed only because the old check was a
	// substring search that would have matched almost anything.
	flattened := authServerDeleteMsg(
		errMsg(`failed to delete LDAP server "ldap-1": FortiGate API error: error code -23 (HTTP 500)`),
		"LDAP server")
	if !strings.Contains(flattened, "still referenced") {
		t.Fatalf("-23 in a flattened message should still explain the reference, got %q", flattened)
	}

	// The point of the change. -230 is not -23, and neither is an object whose NAME ends in -23.
	// Both used to be reported to the user as "still referenced", sending them to remove
	// references that were never the problem.
	for _, notReferenced := range []error{
		&services.DeviceError{Code: -230, HTTPStatus: 500, Text: "error code -230"},
		&services.DeviceError{Code: -8, HTTPStatus: 500, Text: `entry not found: "ldap-23"`},
	} {
		msg := authServerDeleteMsg(notReferenced, "LDAP server")
		if strings.Contains(msg, "still referenced") {
			t.Errorf("%v was reported as a reference problem; only -23 is one", notReferenced)
		}
	}

	other := authServerDeleteMsg(errMsg("connection refused"), "RADIUS server")
	if !strings.Contains(other, "connection refused") {
		t.Fatalf("other errors should pass through, got %q", other)
	}
}

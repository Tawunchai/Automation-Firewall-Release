package services

import (
	"reflect"
	"testing"
)

// The payload builders are the only place where a GUI toggle becomes a CMDB field, so these
// tests pin every gated field in BOTH states. Expected values were taken from the live device:
// each payload below was POSTed to the lab FGT80E (FortiOS 7.2.10) and read back.

// ── LDAP ─────────────────────────────────────────────────────────────────────

func baseLDAPForm() FGLDAPServerForm {
	return FGLDAPServerForm{
		Name: "AD-Corp", Server: "10.0.1.10", Port: 389, CNID: "cn", DN: "dc=corp,dc=local",
		BindType: LDAPBindSimple,
	}
}

func TestBuildLDAPServerPayload_Minimal(t *testing.T) {
	got := buildLDAPServerPayload(baseLDAPForm(), true)

	want := map[string]interface{}{
		"name": "AD-Corp", "server": "10.0.1.10", "port": 389,
		"cnid": "cn", "dn": "dc=corp,dc=local", "type": "simple",
		"obtain-user-info": "disable", "user-info-exchange-server": "",
		"username": "",
		"secure":   "disable", "ca-cert": "", "server-identity-check": "disable",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload mismatch\ngot:  %#v\nwant: %#v", got, want)
	}
}

// The whole point of writing obtain-user-info explicitly: the DEVICE defaults it to "enable",
// so a form with the Exchange toggle off must still say "disable" or the feature stays on.
func TestBuildLDAPServerPayload_ExchangeOffIsExplicit(t *testing.T) {
	p := buildLDAPServerPayload(baseLDAPForm(), true)
	if p["obtain-user-info"] != "disable" {
		t.Fatalf("obtain-user-info = %v, want an explicit \"disable\" (device default is enable)", p["obtain-user-info"])
	}
	if _, ok := p["obtain-user-info"]; !ok {
		t.Fatal("obtain-user-info must always be present in the payload")
	}
}

func TestBuildLDAPServerPayload_ExchangeOn(t *testing.T) {
	f := baseLDAPForm()
	f.ExchangeEnabled = true
	f.ExchangeServer = "EXCH-Corp"

	p := buildLDAPServerPayload(f, true)
	if p["obtain-user-info"] != "enable" {
		t.Errorf("obtain-user-info = %v, want enable", p["obtain-user-info"])
	}
	if p["user-info-exchange-server"] != "EXCH-Corp" {
		t.Errorf("user-info-exchange-server = %v, want EXCH-Corp", p["user-info-exchange-server"])
	}
}

func TestBuildLDAPServerPayload_RegularBindSendsCredentials(t *testing.T) {
	f := baseLDAPForm()
	f.BindType = LDAPBindRegular
	f.Username = "CN=svc,DC=corp,DC=local"
	f.Password = "S3cret!"

	p := buildLDAPServerPayload(f, true)
	if p["type"] != "regular" {
		t.Errorf("type = %v, want regular", p["type"])
	}
	if p["username"] != "CN=svc,DC=corp,DC=local" {
		t.Errorf("username = %v", p["username"])
	}
	if p["password"] != "S3cret!" {
		t.Errorf("password = %v, want the supplied secret", p["password"])
	}
}

// Simple / anonymous binds carry no credentials — the GUI hides both rows, and an edit that
// switches away from Regular has to CLEAR the stored username, not just stop sending it.
func TestBuildLDAPServerPayload_NonRegularBindClearsUsername(t *testing.T) {
	for _, bind := range []string{LDAPBindSimple, LDAPBindAnonymous} {
		f := baseLDAPForm()
		f.BindType = bind
		f.Username = "left over"
		f.Password = "left over"

		p := buildLDAPServerPayload(f, true)
		if p["username"] != "" {
			t.Errorf("%s: username = %v, want cleared", bind, p["username"])
		}
		if _, ok := p["password"]; ok {
			t.Errorf("%s: password must not be sent for a non-regular bind", bind)
		}
	}
}

// A blank password on EDIT means "keep the stored one" — the device never returns the real
// value, so sending "" would wipe a working bind account.
func TestBuildLDAPServerPayload_BlankPasswordOmitted(t *testing.T) {
	f := baseLDAPForm()
	f.BindType = LDAPBindRegular
	f.Username = "svc"
	f.Password = ""

	if _, ok := buildLDAPServerPayload(f, false)["password"]; ok {
		t.Fatal("password key must be omitted when there is no new password")
	}
}

func TestBuildLDAPServerPayload_SecureAndCertificate(t *testing.T) {
	cases := []struct {
		name                                   string
		secure, cert, identity                 bool
		protocol, caCert                       string
		wantSecure, wantCACert, wantIdentityCk string
	}{
		{"off", false, false, false, LDAPSecureSTARTTLS, "Fortinet_CA", "disable", "", "disable"},
		{"starttls no cert", true, false, false, LDAPSecureSTARTTLS, "", "starttls", "", "disable"},
		{"ldaps no cert", true, false, false, LDAPSecureLDAPS, "", "ldaps", "", "disable"},
		{"ldaps with cert", true, true, true, LDAPSecureLDAPS, "ACCVRAIZ1", "ldaps", "ACCVRAIZ1", "enable"},
		{"ldaps cert no identity check", true, true, false, LDAPSecureLDAPS, "ACCVRAIZ1", "ldaps", "ACCVRAIZ1", "disable"},
		// Certificate is only reachable with Secure Connection on; if a stale cert survives a
		// toggle-off it must NOT be sent, or the device keeps verifying against it.
		{"secure off ignores stale cert", false, true, true, LDAPSecureLDAPS, "ACCVRAIZ1", "disable", "", "disable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := baseLDAPForm()
			f.SecureEnabled, f.CertEnabled, f.ServerIdentityCheck = tc.secure, tc.cert, tc.identity
			f.Protocol, f.CACert = tc.protocol, tc.caCert

			p := buildLDAPServerPayload(f, true)
			if p["secure"] != tc.wantSecure {
				t.Errorf("secure = %v, want %v", p["secure"], tc.wantSecure)
			}
			if p["ca-cert"] != tc.wantCACert {
				t.Errorf("ca-cert = %v, want %q", p["ca-cert"], tc.wantCACert)
			}
			if p["server-identity-check"] != tc.wantIdentityCk {
				t.Errorf("server-identity-check = %v, want %v", p["server-identity-check"], tc.wantIdentityCk)
			}
		})
	}
}

func TestLDAPServerRawToForm(t *testing.T) {
	raw := fgLDAPServerRaw{
		Name: "AD-Corp", Server: "10.0.1.11", Port: 636, CNID: "sAMAccountName",
		DN: "dc=corp,dc=local", Type: "regular", Username: "CN=svc,DC=corp,DC=local",
		Secure: "ldaps", CACert: "ACCVRAIZ1", ServerIdentityCheck: "enable",
		ObtainUserInfo: "enable", ExchangeServer: "EXCH-Corp",
	}
	got := raw.toForm()

	if got.Password != "" {
		t.Error("password must never be round-tripped — the device returns \"ENC XXXX\"")
	}
	if !got.SecureEnabled || got.Protocol != LDAPSecureLDAPS {
		t.Errorf("secure = %v/%q, want enabled/ldaps", got.SecureEnabled, got.Protocol)
	}
	if !got.CertEnabled {
		t.Error("CertEnabled must follow \"is a CA cert selected?\"")
	}
	if !got.ExchangeEnabled || got.ExchangeServer != "EXCH-Corp" {
		t.Errorf("exchange = %v/%q, want enabled/EXCH-Corp", got.ExchangeEnabled, got.ExchangeServer)
	}
	if !got.ServerIdentityCheck {
		t.Error("ServerIdentityCheck should be true")
	}
}

func TestLDAPServerRawToForm_PlainServer(t *testing.T) {
	got := fgLDAPServerRaw{Name: "Plain", Server: "10.0.1.10", Port: 389, Type: "simple", Secure: "disable"}.toForm()

	if got.SecureEnabled {
		t.Error("SecureEnabled should be false for secure=disable")
	}
	// The Protocol switch still needs a position; the GUI parks it on STARTTLS.
	if got.Protocol != LDAPSecureSTARTTLS {
		t.Errorf("Protocol = %q, want the STARTTLS default position", got.Protocol)
	}
	if got.CertEnabled {
		t.Error("CertEnabled should be false with no CA cert")
	}
}

// An object created before this feature existed can come back with secure="" — treat it as
// disabled rather than showing an empty Protocol switch.
func TestLDAPServerRawToForm_EmptySecure(t *testing.T) {
	got := fgLDAPServerRaw{Name: "Legacy", Secure: ""}.toForm()
	if got.SecureEnabled || got.Protocol != LDAPSecureSTARTTLS {
		t.Errorf("empty secure → %v/%q, want disabled/starttls", got.SecureEnabled, got.Protocol)
	}
}

// ── RADIUS ───────────────────────────────────────────────────────────────────

func baseRADIUSForm() FGRADIUSServerForm {
	return FGRADIUSServerForm{Name: "NPS-Corp", Server: "10.0.2.10", Secret: "radsecret"}
}

func TestBuildRADIUSServerPayload_Default(t *testing.T) {
	got := buildRADIUSServerPayload(baseRADIUSForm())

	want := map[string]interface{}{
		"name": "NPS-Corp", "server": "10.0.2.10", "secret": "radsecret",
		"auth-type": "auto", "all-usergroup": "disable",
		"nas-ip": unsetIPv4, // blank NAS IP → the device's "unset" value, which really clears it
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload mismatch\ngot:  %#v\nwant: %#v", got, want)
	}
}

// "Default" on the GUI's Authentication method switch is auth-type=auto, whatever stale value
// the Specify dropdown still holds.
func TestBuildRADIUSServerPayload_AuthMethodDefaultWinsOverStaleAuthType(t *testing.T) {
	f := baseRADIUSForm()
	f.AuthMethodSpecify = false
	f.AuthType = RADIUSAuthPAP

	if got := buildRADIUSServerPayload(f)["auth-type"]; got != RADIUSAuthAuto {
		t.Fatalf("auth-type = %v, want auto", got)
	}
}

func TestBuildRADIUSServerPayload_AuthMethodSpecify(t *testing.T) {
	for _, at := range []string{RADIUSAuthPAP, RADIUSAuthCHAP, RADIUSAuthMSCHAP, RADIUSAuthMSCHAPv2} {
		f := baseRADIUSForm()
		f.AuthMethodSpecify = true
		f.AuthType = at

		if got := buildRADIUSServerPayload(f)["auth-type"]; got != at {
			t.Errorf("auth-type = %v, want %v", got, at)
		}
	}
}

// Every optional key is omitted when blank. Secrets because "" would wipe a working one, and
// the ADDRESS fields because FortiOS rejects an empty one with -257, aborting the whole save.
func TestBuildRADIUSServerPayload_BlankOptionalsOmitted(t *testing.T) {
	p := buildRADIUSServerPayload(FGRADIUSServerForm{Name: "NPS", Server: "10.0.2.10"})

	for _, k := range []string{"secret", "secondary-secret", "secondary-server"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must be omitted when blank, got %v", k, p[k])
		}
	}
	// nas-ip is the exception: 0.0.0.0 IS its unset value, so a blank one is sent and clears.
	if p["nas-ip"] != unsetIPv4 {
		t.Errorf("nas-ip = %v, want %q so a cleared field really clears", p["nas-ip"], unsetIPv4)
	}
}

// A whitespace-only host is the same as blank — it must not reach the device as " ".
func TestBuildRADIUSServerPayload_WhitespaceHostsOmitted(t *testing.T) {
	f := baseRADIUSForm()
	f.SecondaryServer, f.NASIP = "  ", " "

	p := buildRADIUSServerPayload(f)
	if _, ok := p["secondary-server"]; ok {
		t.Errorf("secondary-server must be omitted for a whitespace-only value, got %q", p["secondary-server"])
	}
	if p["nas-ip"] != unsetIPv4 {
		t.Errorf("whitespace nas-ip = %v, want %q", p["nas-ip"], unsetIPv4)
	}
}

// Removing the secondary host is CLI-only on this firmware; the flag records that so the UI can
// say so instead of offering an edit that silently does nothing.
func TestRADIUSBackupServerClearable(t *testing.T) {
	if RADIUSBackupServerClearable() {
		t.Fatal("FortiOS 7.2.10 cannot unset the secondary RADIUS host over REST — see the doc comment")
	}
}

func TestBuildRADIUSServerPayload_BothServers(t *testing.T) {
	f := baseRADIUSForm()
	f.SecondaryServer, f.SecondarySecret = "10.0.2.11", "sec2"
	f.AllUserGroup = true
	f.NASIP = "10.0.99.201"

	p := buildRADIUSServerPayload(f)
	for k, want := range map[string]interface{}{
		"secondary-server": "10.0.2.11", "secondary-secret": "sec2",
		"all-usergroup": "enable", "nas-ip": "10.0.99.201",
	} {
		if p[k] != want {
			t.Errorf("%s = %v, want %v", k, p[k], want)
		}
	}
}

// A blank NAS IP is CLEARED via the device's 0.0.0.0 sentinel, not dropped.
// The GUI dialog has no Timeout or Tertiary Server field, so the payload must never carry them
// — an existing CLI-set value on the device is left alone.
func TestBuildRADIUSServerPayload_NoTimeoutOrTertiary(t *testing.T) {
	f := baseRADIUSForm()
	f.SecondaryServer, f.SecondarySecret = "10.0.2.11", "sec2"

	p := buildRADIUSServerPayload(f)
	for _, k := range []string{"timeout", "tertiary-server", "tertiary-secret"} {
		if _, ok := p[k]; ok {
			t.Errorf("%s must never be sent — the FortiGate dialog has no such field", k)
		}
	}
}

func TestBuildRADIUSServerPayload_BlankNASIPClears(t *testing.T) {
	// "" and null are both rejected with -257; 0.0.0.0 is the value the device itself stores
	// for an unset address, and it accepts it (verified live — the line leaves `show`).
	if got := buildRADIUSServerPayload(baseRADIUSForm())["nas-ip"]; got != unsetIPv4 {
		t.Fatalf("nas-ip = %v, want %q for a blank NAS IP", got, unsetIPv4)
	}
}

func TestRADIUSServerRawToForm(t *testing.T) {
	got := fgRADIUSServerRaw{
		Name: "NPS-Corp", Server: "10.0.2.10", SecondaryServer: "10.0.2.11",
		AuthType: "pap", NASIP: "10.0.99.201", AllUserGroup: "enable",
	}.toForm()

	if !got.AuthMethodSpecify || got.AuthType != RADIUSAuthPAP {
		t.Errorf("auth = %v/%q, want Specify/pap", got.AuthMethodSpecify, got.AuthType)
	}
	if got.Secret != "" || got.SecondarySecret != "" {
		t.Error("secrets must never be round-tripped — the device returns \"ENC XXXX\"")
	}
	if !got.AllUserGroup || got.NASIP != "10.0.99.201" || got.SecondaryServer != "10.0.2.11" {
		t.Errorf("unexpected mapping: %+v", got)
	}
}

// The device stores an "unset" address as 0.0.0.0; the GUI shows those fields empty. It shows
// up on the backup hosts too, because 0.0.0.0 is what a CLI-less clear attempt leaves behind.
func TestRADIUSServerRawToForm_Defaults(t *testing.T) {
	got := fgRADIUSServerRaw{
		Name: "NPS", Server: "10.0.2.10", AuthType: "auto",
		NASIP: "0.0.0.0", SecondaryServer: "0.0.0.0",
	}.toForm()

	if got.NASIP != "" || got.SecondaryServer != "" {
		t.Errorf("0.0.0.0 sentinels should read back empty, got %+v", got)
	}
	if got.AuthMethodSpecify {
		t.Error("auth-type auto must map back to the Default position")
	}
}

// ── Exchange connector ───────────────────────────────────────────────────────

func TestBuildExchangeConnectorPayload(t *testing.T) {
	f := FGExchangeConnectorForm{
		Name: "EXCH-Corp", Username: "svc-fgt", ServerName: "mail.corp.local",
		DomainName: "corp.local", Password: "P@ss", AutoDiscoverKDC: true,
	}
	got := buildExchangeConnectorPayload(f, true)

	want := map[string]interface{}{
		"name": "EXCH-Corp", "server-name": "mail.corp.local", "domain-name": "corp.local",
		"username": "svc-fgt", "password": "P@ss", "auto-discover-kdc": "enable",
		"ip": "0.0.0.0", // "not overridden"
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload mismatch\ngot:  %#v\nwant: %#v", got, want)
	}
}

func TestBuildExchangeConnectorPayload_OverrideIP(t *testing.T) {
	f := FGExchangeConnectorForm{
		Name: "EXCH", Username: "u", ServerName: "s", DomainName: "d", Password: "p",
		OverrideIP: true, IP: "192.168.10.5",
	}
	if got := buildExchangeConnectorPayload(f, true)["ip"]; got != "192.168.10.5" {
		t.Fatalf("ip = %v, want the override", got)
	}

	// Toggle off ⇒ back to the device's "no override" sentinel, even with a stale IP in state.
	f.OverrideIP = false
	if got := buildExchangeConnectorPayload(f, true)["ip"]; got != "0.0.0.0" {
		t.Fatalf("ip = %v, want 0.0.0.0 when the override is off", got)
	}
}

func TestBuildExchangeConnectorPayload_AutoDiscoverKDCOff(t *testing.T) {
	f := FGExchangeConnectorForm{Name: "EXCH", Username: "u", ServerName: "s", DomainName: "d"}
	if got := buildExchangeConnectorPayload(f, true)["auto-discover-kdc"]; got != "disable" {
		t.Fatalf("auto-discover-kdc = %v, want disable", got)
	}
	if _, ok := buildExchangeConnectorPayload(f, true)["password"]; ok {
		t.Fatal("password must be omitted when blank")
	}
}

// ── Validators ───────────────────────────────────────────────────────────────

func TestIsValidLDAPBindType(t *testing.T) {
	for _, ok := range []string{"simple", "anonymous", "regular", "REGULAR", " simple "} {
		if !IsValidLDAPBindType(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "sasl", "kerberos"} {
		if IsValidLDAPBindType(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

// "disable" is expressed by the Secure Connection toggle, never by the Protocol switch.
func TestIsValidLDAPProtocol(t *testing.T) {
	for _, ok := range []string{"starttls", "ldaps", "LDAPS"} {
		if !IsValidLDAPProtocol(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "disable", "tls"} {
		if IsValidLDAPProtocol(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestIsValidRADIUSAuthType(t *testing.T) {
	for _, ok := range []string{"auto", "pap", "chap", "ms_chap", "ms_chap_v2", "PAP"} {
		if !IsValidRADIUSAuthType(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "mschapv2", "eap"} {
		if IsValidRADIUSAuthType(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

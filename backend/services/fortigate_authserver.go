package services

// Remote authentication servers — User & Authentication > LDAP Servers / RADIUS Servers,
// plus the Exchange "External Connector" the LDAP form's own picker creates.
//
// CMDB tables, all verified live against the lab FGT80E on FortiOS 7.2.10
// (GET <path>?action=schema&vdom=root, then create → read back → delete by mkey):
//
//	user/ldap      the LDAP server itself
//	user/radius    the RADIUS server (primary + secondary + tertiary in ONE object)
//	user/exchange  the Exchange connector referenced by user/ldap's user-info-exchange-server
//
// GUI → CMDB field map for the "Edit LDAP Server" dialog. The GUI label is on the left; note
// that four of the toggles do NOT have a field of their own — they gate other fields:
//
//	Name                    → name
//	Server IP/Name          → server
//	Server Port             → port                    (389; the GUI flips it to 636 for LDAPS)
//	Common Name Identifier  → cnid                    (default "cn")
//	Distinguished Name      → dn
//	Exchange server (toggle)→ obtain-user-info        + user-info-exchange-server (the picker)
//	Bind Type               → type                    simple | anonymous | regular
//	  Username / Password   → username / password     (regular only — the GUI hides them otherwise)
//	Secure Connection (tgl) → secure                  disable | starttls | ldaps
//	  Protocol              → secure                  (same field: starttls or ldaps)
//	  Certificate (toggle)  → ca-cert                 (datasource vpn.certificate.ca.name)
//	  Server identity check → server-identity-check
//
// ⚠️ obtain-user-info DEFAULTS TO "enable" ON THE DEVICE even though the GUI shows the
// "Exchange server" toggle OFF for a new server (verified: create a user/ldap without the key
// and read it back — obtain-user-info comes back "enable"). So the toggle's OFF state has to be
// sent EXPLICITLY as "disable"; omitting the key silently leaves the feature on.

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var userExchangeTable = cmdbPath{path: "user/exchange", noun: "exchange"}
var userLdapTable = cmdbPath{path: "user/ldap", noun: "ldap"}
var userRadiusTable = cmdbPath{path: "user/radius", noun: "radius"}

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var ldapServerTable = cmdbPath{path: "user/ldap", noun: "LDAP server"}
var radiusServerTable = cmdbPath{path: "user/radius", noun: "RADIUS server"}
var exchangeConnectorTable = cmdbPath{path: "user/exchange", noun: "Exchange connector"}

// ── LDAP ─────────────────────────────────────────────────────────────────────

// LDAP bind types (user/ldap "type"). Anonymous and simple carry no credentials; only
// regular has Username/Password, which is why the GUI shows those two rows for it alone.
const (
	LDAPBindSimple    = "simple"
	LDAPBindAnonymous = "anonymous"
	LDAPBindRegular   = "regular"
)

// LDAP secure-connection protocols (user/ldap "secure"). "disable" is the toggle-off state.
const (
	LDAPSecureDisable  = "disable"
	LDAPSecureSTARTTLS = "starttls"
	LDAPSecureLDAPS    = "ldaps"
)

// LDAPPortDefault is what the form fills in for a plain or STARTTLS server, and what
// controller/policyobject/authserver.go falls back to when the port is left empty.
//
// There is no LDAPS constant beside it on purpose: 636 is only ever chosen in the browser, and
// frontend/src/pages/user-auth/ldap-server-form.logic.ts owns it (LDAP_PORT_LDAPS). A Go twin
// existed here and was referenced by nothing, which is how two copies of one number drift apart.
const LDAPPortDefault = 389

var ldapBindTypes = map[string]bool{
	LDAPBindSimple: true, LDAPBindAnonymous: true, LDAPBindRegular: true,
}

var ldapSecureProtocols = map[string]bool{
	LDAPSecureSTARTTLS: true, LDAPSecureLDAPS: true,
}

func IsValidLDAPBindType(t string) bool { return ldapBindTypes[strings.ToLower(strings.TrimSpace(t))] }

// IsValidLDAPProtocol covers only the two the GUI's Protocol switch offers — "disable" is
// expressed by the Secure Connection toggle being off, never by this field.
func IsValidLDAPProtocol(p string) bool {
	return ldapSecureProtocols[strings.ToLower(strings.TrimSpace(p))]
}

// FGLDAPServer is one row of the LDAP Servers list.
type FGLDAPServer struct {
	Name     string `json:"name"`
	Server   string `json:"server"`
	Port     int    `json:"port"`
	CNID     string `json:"cnid"`
	DN       string `json:"dn"`
	BindType string `json:"bind_type"` // simple | anonymous | regular
	Secure   string `json:"secure"`    // disable | starttls | ldaps
	Ref      int    `json:"ref"`       // q_ref — how many objects reference this server
}

// FGLDAPServerForm is the GUI-shaped create/edit body. The four *Enabled booleans are the
// dialog's toggles; buildLDAPServerPayload turns them back into the flat CMDB fields.
//
// Password is WRITE-ONLY: the device returns the literal "ENC XXXX" for it, so GetLDAPServer
// always blanks it and a blank password on update means "keep the stored one".
type FGLDAPServerForm struct {
	Name   string `json:"name"`
	Server string `json:"server"`
	Port   int    `json:"port"`
	CNID   string `json:"cnid"`
	DN     string `json:"dn"`

	ExchangeEnabled bool   `json:"exchange_enabled"` // "Exchange server" toggle
	ExchangeServer  string `json:"exchange_server"`  // user.exchange.name

	BindType string `json:"bind_type"`
	Username string `json:"username"` // regular bind only
	Password string `json:"password"` // regular bind only, write-only

	SecureEnabled       bool   `json:"secure_enabled"`        // "Secure Connection" toggle
	Protocol            string `json:"protocol"`              // starttls | ldaps
	CertEnabled         bool   `json:"cert_enabled"`          // "Certificate" toggle
	CACert              string `json:"ca_cert"`               // vpn.certificate.ca.name
	ServerIdentityCheck bool   `json:"server_identity_check"` // shown only with Certificate on
}

// buildLDAPServerPayload maps the form onto user/ldap.
//
// Every gated field is written EXPLICITLY in both states rather than merely omitted when the
// toggle is off. Two reasons, both real: obtain-user-info defaults to enable on the device (see
// the file header), and on EDIT an omitted key keeps whatever the object already had — so a
// user who turns Secure Connection off would otherwise still be talking LDAPS.
//
// includePassword is false when the caller has no password to send (blank on update), which
// keeps the stored one instead of overwriting it with "".
func buildLDAPServerPayload(f FGLDAPServerForm, includePassword bool) map[string]interface{} {
	p := map[string]interface{}{
		"name":   f.Name,
		"server": f.Server,
		"port":   f.Port,
		"cnid":   f.CNID,
		"dn":     f.DN,
		"type":   f.BindType,
	}

	// Exchange server picker.
	p["obtain-user-info"] = FGBoolToString(f.ExchangeEnabled)
	if f.ExchangeEnabled {
		p["user-info-exchange-server"] = f.ExchangeServer
	} else {
		// user-info-exchange-server is a datasource; "" is the only safe "none" value.
		p["user-info-exchange-server"] = ""
	}

	// Bind credentials — the GUI only collects them for a regular bind.
	if f.BindType == LDAPBindRegular {
		p["username"] = f.Username
		if includePassword && f.Password != "" {
			p["password"] = f.Password
		}
	} else {
		p["username"] = ""
	}

	// Secure connection.
	if f.SecureEnabled {
		p["secure"] = f.Protocol
		if f.CertEnabled {
			p["ca-cert"] = f.CACert
			p["server-identity-check"] = FGBoolToString(f.ServerIdentityCheck)
		} else {
			p["ca-cert"] = ""
			p["server-identity-check"] = FGBoolToString(false)
		}
	} else {
		p["secure"] = LDAPSecureDisable
		p["ca-cert"] = ""
		p["server-identity-check"] = FGBoolToString(false)
	}
	return p
}

// fgLDAPServerRaw is one user/ldap object as FortiOS returns it.
type fgLDAPServerRaw struct {
	Name                string `json:"name"`
	Server              string `json:"server"`
	Port                int    `json:"port"`
	CNID                string `json:"cnid"`
	DN                  string `json:"dn"`
	Type                string `json:"type"`
	Username            string `json:"username"`
	Secure              string `json:"secure"`
	CACert              string `json:"ca-cert"`
	ServerIdentityCheck string `json:"server-identity-check"`
	ObtainUserInfo      string `json:"obtain-user-info"`
	ExchangeServer      string `json:"user-info-exchange-server"`
	Ref                 int    `json:"q_ref"`
}

func (r fgLDAPServerRaw) toForm() FGLDAPServerForm {
	secure := r.Secure
	if secure == "" {
		secure = LDAPSecureDisable
	}
	secureOn := secure != LDAPSecureDisable

	protocol := secure
	if !secureOn {
		// The Protocol switch still needs a position when the toggle is off; the GUI shows
		// STARTTLS pre-selected.
		protocol = LDAPSecureSTARTTLS
	}

	return FGLDAPServerForm{
		Name:   r.Name,
		Server: r.Server,
		Port:   r.Port,
		CNID:   r.CNID,
		DN:     r.DN,

		// The toggle follows obtain-user-info, which is what actually drives the feature.
		ExchangeEnabled: FGStringToBool(r.ObtainUserInfo),
		ExchangeServer:  r.ExchangeServer,

		BindType: r.Type,
		Username: r.Username,
		Password: "", // never round-tripped — the device answers "ENC XXXX"

		SecureEnabled: secureOn,
		Protocol:      protocol,
		// The Certificate toggle isn't a field: it's "is a CA cert selected?".
		CertEnabled:         secureOn && r.CACert != "",
		CACert:              r.CACert,
		ServerIdentityCheck: FGStringToBool(r.ServerIdentityCheck),
	}
}

// GetLDAPServers lists user/ldap for the LDAP Servers page. with_meta=1 adds q_ref, the
// "Ref." column every other User & Authentication list shows.
func (f *FortiClient) GetLDAPServers() ([]FGLDAPServer, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/ldap?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var rows []fgLDAPServerRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse LDAP servers: %w", err)
	}
	out := make([]FGLDAPServer, 0, len(rows))
	for _, r := range rows {
		secure := r.Secure
		if secure == "" {
			secure = LDAPSecureDisable
		}
		out = append(out, FGLDAPServer{
			Name: r.Name, Server: r.Server, Port: r.Port,
			CNID: r.CNID, DN: r.DN, BindType: r.Type, Secure: secure, Ref: r.Ref,
		})
	}
	return out, nil
}

// GetLDAPServer fetches one server, shaped for the edit form.
func (f *FortiClient) GetLDAPServer(name string) (*FGLDAPServerForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/ldap/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var rows []fgLDAPServerRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse LDAP server: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("LDAP server %q not found", name)
	}
	form := rows[0].toForm()
	return &form, nil
}

func (f *FortiClient) CreateLDAPServer(form FGLDAPServerForm) error {
	err := userLdapTable.Create(f, buildLDAPServerPayload(form, true))
	if err != nil {
		return fmt.Errorf("failed to create LDAP server %q: %w", form.Name, err)
	}
	return nil
}

// UpdateLDAPServer edits by CURRENT name; a form carrying a different Name renames it.
// A blank Password keeps the stored one.
func (f *FortiClient) UpdateLDAPServer(name string, form FGLDAPServerForm) error {
	err := userLdapTable.Update(f, name, buildLDAPServerPayload(form, form.Password != ""))
	if err != nil {
		return fmt.Errorf("failed to update LDAP server %q: %w", name, err)
	}
	return nil
}

// DeleteLDAPServer removes one server BY MKEY — never the collection URL, which wipes the
// whole table on this device.
func (f *FortiClient) DeleteLDAPServer(name string) error {
	if err := ldapServerTable.Delete(f, name); err != nil {
		return fmt.Errorf("failed to delete LDAP server %q: %w", name, err)
	}
	return nil
}

// ── RADIUS ───────────────────────────────────────────────────────────────────

// RADIUS auth-type values (user/radius "auth-type"). "auto" is the GUI's "Default", which
// lets the device negotiate; the rest are what "Specify" offers.
const (
	RADIUSAuthAuto     = "auto"
	RADIUSAuthMSCHAPv2 = "ms_chap_v2"
	RADIUSAuthMSCHAP   = "ms_chap"
	RADIUSAuthCHAP     = "chap"
	RADIUSAuthPAP      = "pap"
)

var radiusAuthTypes = map[string]bool{
	RADIUSAuthAuto: true, RADIUSAuthMSCHAPv2: true, RADIUSAuthMSCHAP: true,
	RADIUSAuthCHAP: true, RADIUSAuthPAP: true,
}

func IsValidRADIUSAuthType(t string) bool {
	return radiusAuthTypes[strings.ToLower(strings.TrimSpace(t))]
}

// FGRADIUSServer is one row of the RADIUS Servers list.
type FGRADIUSServer struct {
	Name            string `json:"name"`
	Server          string `json:"server"`
	SecondaryServer string `json:"secondary_server"`
	AuthType        string `json:"auth_type"`
	NASIP           string `json:"nas_ip"`
	AllUserGroup    bool   `json:"all_usergroup"`
	Ref             int    `json:"ref"`
}

// FGRADIUSServerForm is the GUI-shaped create/edit body for the "New RADIUS Server" dialog:
// Name, Authentication method, NAS IP, Include in every user group, then a Primary and a
// Secondary Server block. That is exactly what the FortiGate dialog collects — the CMDB table
// also carries tertiary-* and timeout, but the GUI never shows them, so neither does this form
// (an existing tertiary/timeout on the device is left untouched: the payload omits both keys).
//
// Both secrets are WRITE-ONLY (the device answers "ENC XXXX"), so GetRADIUSServer blanks them
// and a blank secret on update keeps the stored one.
type FGRADIUSServerForm struct {
	Name string `json:"name"`

	// "Authentication method": false = Default (auth-type auto), true = Specify.
	AuthMethodSpecify bool   `json:"auth_method_specify"`
	AuthType          string `json:"auth_type"`

	NASIP        string `json:"nas_ip"`
	AllUserGroup bool   `json:"all_usergroup"` // "Include in every user group"

	Server string `json:"server"` // Primary Server
	Secret string `json:"secret"`

	SecondaryServer string `json:"secondary_server"`
	SecondarySecret string `json:"secondary_secret"`
}

// buildRADIUSServerPayload maps the form onto user/radius.
//
// EVERY optional field here is OMITTED when blank rather than sent as "", for two separate
// reasons, both confirmed on the lab device:
//
//   - secrets: FortiOS never returns the stored value ("ENC XXXX"), so a blank field on EDIT
//     means "unchanged". Sending "" would wipe a working shared secret.
//   - the secondary host: it is address-typed. A PUT carrying "" (or null) is rejected outright
//     with «value parse error before ”» / -257, which would abort the whole save. See
//     RADIUSBackupServerClearable for what that means for the UI.
//
// nas-ip is the one exception: it rejects "" the same way, but 0.0.0.0 IS its "unset" value and
// the device accepts it (verified — the field disappears from `show` afterwards). Nothing else
// competes for that address, so a blank NAS IP really does clear.
func buildRADIUSServerPayload(f FGRADIUSServerForm) map[string]interface{} {
	authType := RADIUSAuthAuto
	if f.AuthMethodSpecify {
		authType = f.AuthType
	}

	nasIP := strings.TrimSpace(f.NASIP)
	if nasIP == "" {
		nasIP = unsetIPv4
	}

	p := map[string]interface{}{
		"name":          f.Name,
		"server":        f.Server,
		"auth-type":     authType,
		"all-usergroup": FGBoolToString(f.AllUserGroup),
		"nas-ip":        nasIP,
	}
	if strings.TrimSpace(f.SecondaryServer) != "" {
		p["secondary-server"] = strings.TrimSpace(f.SecondaryServer)
	}
	if f.Secret != "" {
		p["secret"] = f.Secret
	}
	if f.SecondarySecret != "" {
		p["secondary-secret"] = f.SecondarySecret
	}
	return p
}

// RADIUSBackupServerClearable reports whether the secondary RADIUS host can be REMOVED
// through the CMDB API. On FortiOS 7.2.10 it cannot, and the form says so rather than offering
// an edit that silently does nothing. Probed on the lab device:
//
//	PUT {"tertiary-server": ""}        → -257 «value parse error before ''»
//	PUT {"tertiary-server": null}      → -257, same
//	PUT {"tertiary-server": "0.0.0.0"} → accepted, but 0.0.0.0 then occupies the slot, and the
//	                                     device rejects a second one with -61 «0.0.0.0 is
//	                                     already the tertiary server» (all three hosts must
//	                                     be DISTINCT), so it is not a usable "none" value
//	CLI  unset tertiary-server         → works — the only way to clear it
//
// Setting or CHANGING a backup host over REST works fine; only removal is CLI-only.
func RADIUSBackupServerClearable() bool { return false }

// fgRADIUSServerRaw is one user/radius object as FortiOS returns it.
type fgRADIUSServerRaw struct {
	Name            string `json:"name"`
	Server          string `json:"server"`
	SecondaryServer string `json:"secondary-server"`
	AuthType        string `json:"auth-type"`
	NASIP           string `json:"nas-ip"`
	AllUserGroup    string `json:"all-usergroup"`
	Ref             int    `json:"q_ref"`
}

// unsetIPv4 is what FortiOS stores in an address field that has no value. It is also the only
// way to CLEAR such a field over REST: "" and null are both rejected with -257.
const unsetIPv4 = "0.0.0.0"

// unsetHost blanks the device's sentinel so the GUI shows an empty field.
func unsetHost(s string) string {
	if s == unsetIPv4 {
		return ""
	}
	return s
}

func (r fgRADIUSServerRaw) toForm() FGRADIUSServerForm {
	authType := r.AuthType
	if authType == "" {
		authType = RADIUSAuthAuto
	}
	nasIP := unsetHost(r.NASIP)
	return FGRADIUSServerForm{
		Name:              r.Name,
		AuthMethodSpecify: authType != RADIUSAuthAuto,
		AuthType:          authType,
		NASIP:             nasIP,
		AllUserGroup:      FGStringToBool(r.AllUserGroup),
		Server:            r.Server,
		SecondaryServer:   unsetHost(r.SecondaryServer),
		// secrets are never returned by the device
	}
}

func (f *FortiClient) GetRADIUSServers() ([]FGRADIUSServer, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/radius?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var rows []fgRADIUSServerRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse RADIUS servers: %w", err)
	}
	out := make([]FGRADIUSServer, 0, len(rows))
	for _, r := range rows {
		authType := r.AuthType
		if authType == "" {
			authType = RADIUSAuthAuto
		}
		out = append(out, FGRADIUSServer{
			Name: r.Name, Server: r.Server,
			SecondaryServer: unsetHost(r.SecondaryServer),
			AuthType:        authType, NASIP: unsetHost(r.NASIP),
			AllUserGroup: FGStringToBool(r.AllUserGroup), Ref: r.Ref,
		})
	}
	return out, nil
}

func (f *FortiClient) GetRADIUSServer(name string) (*FGRADIUSServerForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/radius/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var rows []fgRADIUSServerRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse RADIUS server: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("RADIUS server %q not found", name)
	}
	form := rows[0].toForm()
	return &form, nil
}

func (f *FortiClient) CreateRADIUSServer(form FGRADIUSServerForm) error {
	err := userRadiusTable.Create(f, buildRADIUSServerPayload(form))
	if err != nil {
		return fmt.Errorf("failed to create RADIUS server %q: %w", form.Name, err)
	}
	return nil
}

func (f *FortiClient) UpdateRADIUSServer(name string, form FGRADIUSServerForm) error {
	err := userRadiusTable.Update(f, name, buildRADIUSServerPayload(form))
	if err != nil {
		return fmt.Errorf("failed to update RADIUS server %q: %w", name, err)
	}
	return nil
}

func (f *FortiClient) DeleteRADIUSServer(name string) error {
	if err := radiusServerTable.Delete(f, name); err != nil {
		return fmt.Errorf("failed to delete RADIUS server %q: %w", name, err)
	}
	return nil
}

// FGRADIUSTestResult is what the GUI's "Test Connectivity" / "Test User Credentials" buttons
// show. It comes from the MONITOR api (POST monitor/user/radius/test-connect), not CMDB —
// the only auth-server test endpoint this firmware has (see getLDAPTestSupported).
type FGRADIUSTestResult struct {
	Status        string `json:"status"`         // successful | unreachable | …
	AccessStatus  string `json:"access_status"`  // e.g. "Access-Accept", "Unknown Response"
	AccessMessage string `json:"access_message"` // the server's Reply-Message, when it sends one
}

// TestRADIUSServer runs the device's own connectivity test against a SAVED server.
// `ordinal` picks which host to hit (primary | secondary);
// passing user+password turns it into the "Test User Credentials" check.
func (f *FortiClient) TestRADIUSServer(name, ordinal, user, password string) (*FGRADIUSTestResult, error) {
	body := map[string]interface{}{"mkey": name}
	if ordinal != "" {
		body["ordinal"] = ordinal
	}
	if user != "" {
		body["user"] = user
		body["password"] = password
	}
	resp, err := f.do("POST", "/api/v2/monitor/user/radius/test-connect", body)
	if err != nil {
		return nil, err
	}
	var out FGRADIUSTestResult
	if err := json.Unmarshal(resp.Results, &out); err != nil {
		return nil, fmt.Errorf("failed to parse RADIUS test result: %w", err)
	}
	return &out, nil
}

// getLDAPTestSupported reports whether this firmware exposes an LDAP test/browse endpoint.
//
// FortiOS 7.2.10 does NOT: monitor/user/ldap/query, monitor/user/ldap/test-connect and
// monitor/user/ldap/test-user-credentials were all probed on the lab device and every one
// answers 404 (the RADIUS equivalent answers 424/200). The LDAP form therefore renders its
// Test Connectivity / Test User Credentials / Browse controls disabled rather than pretending.
// Kept as a function so a newer firmware can flip it without touching the UI.
func getLDAPTestSupported() bool { return false }

// ── Exchange external connector (user/exchange) ──────────────────────────────

// FGExchangeConnector is one row of the LDAP form's "Exchange server" dropdown.
type FGExchangeConnector struct {
	Name       string `json:"name"`
	ServerName string `json:"server_name"`
	DomainName string `json:"domain_name"`
	Username   string `json:"username"`
}

// FGExchangeConnectorForm is the "New External Connector" dialog.
//
// The GUI collects the account as ONE field shaped "username@server.domain.com"; the three
// CMDB fields below are what that splits into (the caller does the split so the derived values
// can be shown before saving — see splitExchangeAccount in the frontend form module).
type FGExchangeConnectorForm struct {
	Name       string `json:"name"`
	Username   string `json:"username"`
	ServerName string `json:"server_name"`
	DomainName string `json:"domain_name"`
	Password   string `json:"password"`

	OverrideIP      bool   `json:"override_ip"` // "Override server IP address"
	IP              string `json:"ip"`
	AutoDiscoverKDC bool   `json:"auto_discover_kdc"`
}

func buildExchangeConnectorPayload(f FGExchangeConnectorForm, includePassword bool) map[string]interface{} {
	p := map[string]interface{}{
		"name":              f.Name,
		"server-name":       f.ServerName,
		"domain-name":       f.DomainName,
		"username":          f.Username,
		"auto-discover-kdc": FGBoolToString(f.AutoDiscoverKDC),
	}
	if includePassword && f.Password != "" {
		p["password"] = f.Password
	}
	// ip is an ipv4-address-any; 0.0.0.0 is the device's "not overridden".
	if f.OverrideIP && strings.TrimSpace(f.IP) != "" {
		p["ip"] = strings.TrimSpace(f.IP)
	} else {
		p["ip"] = unsetIPv4
	}
	return p
}

// GetExchangeConnectors lists user/exchange for the LDAP form's picker.
func (f *FortiClient) GetExchangeConnectors() ([]FGExchangeConnector, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/exchange", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name       string `json:"name"`
		ServerName string `json:"server-name"`
		DomainName string `json:"domain-name"`
		Username   string `json:"username"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse Exchange connectors: %w", err)
	}
	out := make([]FGExchangeConnector, 0, len(rows))
	for _, r := range rows {
		out = append(out, FGExchangeConnector{
			Name: r.Name, ServerName: r.ServerName, DomainName: r.DomainName, Username: r.Username,
		})
	}
	return out, nil
}

func (f *FortiClient) CreateExchangeConnector(form FGExchangeConnectorForm) error {
	err := userExchangeTable.Create(f, buildExchangeConnectorPayload(form, true))
	if err != nil {
		return fmt.Errorf("failed to create Exchange connector %q: %w", form.Name, err)
	}
	return nil
}

func (f *FortiClient) DeleteExchangeConnector(name string) error {
	if err := exchangeConnectorTable.Delete(f, name); err != nil {
		return fmt.Errorf("failed to delete Exchange connector %q: %w", name, err)
	}
	return nil
}

// ── Form datasources ─────────────────────────────────────────────────────────

// FGLDAPServerOptions is everything the LDAP form's pickers need.
type FGLDAPServerOptions struct {
	CACerts           []string              `json:"ca_certs"`            // Certificate dropdown
	ExchangeServers   []FGExchangeConnector `json:"exchange_servers"`    // Exchange server dropdown
	SupportsLDAPTest  bool                  `json:"supports_ldap_test"`  // Test Connectivity buttons
	SupportsDNBrowser bool                  `json:"supports_dn_browser"` // "Browse" next to the DN
}

// GetLDAPServerOptions collects the LDAP form's datasources. Both lists are best-effort so the
// form still renders (and can still be saved) when a fetch fails.
func (f *FortiClient) GetLDAPServerOptions() FGLDAPServerOptions {
	opts := FGLDAPServerOptions{
		CACerts:         []string{},
		ExchangeServers: []FGExchangeConnector{},
		// Both come off the same missing monitor API on 7.2.10.
		SupportsLDAPTest:  getLDAPTestSupported(),
		SupportsDNBrowser: getLDAPTestSupported(),
	}
	if certs, err := f.fetchNames("/api/v2/cmdb/vpn.certificate/ca"); err == nil {
		for _, c := range certs {
			opts.CACerts = append(opts.CACerts, c.Name)
		}
	}
	if conns, err := f.GetExchangeConnectors(); err == nil {
		opts.ExchangeServers = conns
	}
	return opts
}

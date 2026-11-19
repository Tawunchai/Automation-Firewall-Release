package policyobject

// Device-proxy handlers for User & Authentication > LDAP Servers / RADIUS Servers, and the
// Exchange external connector the LDAP form creates inline.
//
// Every validation rule here mirrors a rule the FortiGate dialog enforces, so a bad body fails
// with a readable message instead of an opaque FortiOS code (-5 duplicate name, -3 entry not
// found in datasource, …). Field sizes come from user/ldap|radius|exchange?action=schema on
// FortiOS 7.2.10 — see services/fortigate_authserver.go for the full GUI → CMDB map.

import (
	"net"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// FortiOS field sizes (from the CMDB schema).
const (
	ldapNameMaxLen     = 35
	ldapServerMaxLen   = 63
	ldapCNIDMaxLen     = 20
	ldapDNMaxLen       = 511
	ldapUsernameMaxLen = 511
	ldapPortMin        = 1
	ldapPortMax        = 65535

	radiusNameMaxLen   = 35
	radiusServerMaxLen = 63

	exchangeNameMaxLen   = 35
	exchangeServerMaxLen = 63
	exchangeDomainMaxLen = 79
	exchangeUserMaxLen   = 64
)

// ── LDAP Servers ─────────────────────────────────────────────────────────────

// ldapServerInput is the body of the "Edit LDAP Server" dialog.
type ldapServerInput struct {
	Name   string `json:"name"`
	Server string `json:"server"`
	Port   int    `json:"port"`
	CNID   string `json:"cnid"`
	DN     string `json:"dn"`

	ExchangeEnabled bool   `json:"exchange_enabled"`
	ExchangeServer  string `json:"exchange_server"`

	BindType string `json:"bind_type"`
	Username string `json:"username"`
	Password string `json:"password"`

	SecureEnabled       bool   `json:"secure_enabled"`
	Protocol            string `json:"protocol"`
	CertEnabled         bool   `json:"cert_enabled"`
	CACert              string `json:"ca_cert"`
	ServerIdentityCheck bool   `json:"server_identity_check"`
}

// validateLDAPServer normalises the body into the service-layer form.
//
// requirePassword is false on edit, where a blank password means "keep the stored one" (the
// device answers "ENC XXXX" for it, so the form can never prefill the real value).
func validateLDAPServer(inp ldapServerInput, requirePassword bool) (services.FGLDAPServerForm, error) {
	f := services.FGLDAPServerForm{}

	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return f, errMsg("name is required")
	}
	if len(name) > ldapNameMaxLen {
		return f, errMsg("name must be 35 characters or fewer")
	}

	server := strings.TrimSpace(inp.Server)
	if server == "" {
		return f, errMsg("server IP/name is required")
	}
	if len(server) > ldapServerMaxLen {
		return f, errMsg("server IP/name must be 63 characters or fewer")
	}

	port := inp.Port
	if port == 0 {
		port = services.LDAPPortDefault
	}
	if port < ldapPortMin || port > ldapPortMax {
		return f, errMsg("server port must be 1-65535")
	}

	// The GUI pre-fills "cn" and never lets the field be empty — an empty cnid makes every
	// lookup fail, so reject it here rather than storing a broken server.
	cnid := strings.TrimSpace(inp.CNID)
	if cnid == "" {
		return f, errMsg("common name identifier is required (the FortiGate default is \"cn\")")
	}
	if len(cnid) > ldapCNIDMaxLen {
		return f, errMsg("common name identifier must be 20 characters or fewer")
	}

	dn := strings.TrimSpace(inp.DN)
	if len(dn) > ldapDNMaxLen {
		return f, errMsg("distinguished name must be 511 characters or fewer")
	}

	bindType := strings.ToLower(strings.TrimSpace(inp.BindType))
	if bindType == "" {
		bindType = services.LDAPBindSimple
	}
	if !services.IsValidLDAPBindType(bindType) {
		return f, errMsg("bind type must be simple, anonymous, or regular")
	}

	f = services.FGLDAPServerForm{
		Name: name, Server: server, Port: port, CNID: cnid, DN: dn,
		BindType: bindType,
	}

	// Regular bind is the only one that carries credentials — the GUI hides both rows
	// otherwise, and FortiOS ignores them for simple/anonymous.
	if bindType == services.LDAPBindRegular {
		f.Username = strings.TrimSpace(inp.Username)
		if f.Username == "" {
			return f, errMsg("username is required for a Regular bind")
		}
		if len(f.Username) > ldapUsernameMaxLen {
			return f, errMsg("username must be 511 characters or fewer")
		}
		f.Password = inp.Password
		if requirePassword && f.Password == "" {
			return f, errMsg("password is required for a Regular bind")
		}
	}

	// Exchange server picker — user-info-exchange-server is a datasource, so an unknown or
	// empty name comes back from FortiOS as a bare "-3 entry not found in datasource".
	f.ExchangeEnabled = inp.ExchangeEnabled
	if f.ExchangeEnabled {
		f.ExchangeServer = strings.TrimSpace(inp.ExchangeServer)
		if f.ExchangeServer == "" {
			return f, errMsg("select an Exchange server connector, or turn Exchange server off")
		}
	}

	f.SecureEnabled = inp.SecureEnabled
	if f.SecureEnabled {
		protocol := strings.ToLower(strings.TrimSpace(inp.Protocol))
		if protocol == "" {
			protocol = services.LDAPSecureSTARTTLS
		}
		if !services.IsValidLDAPProtocol(protocol) {
			return f, errMsg("protocol must be starttls or ldaps")
		}
		f.Protocol = protocol

		f.CertEnabled = inp.CertEnabled
		if f.CertEnabled {
			f.CACert = strings.TrimSpace(inp.CACert)
			if f.CACert == "" {
				return f, errMsg("select a CA certificate, or turn Certificate off")
			}
			f.ServerIdentityCheck = inp.ServerIdentityCheck
		}
	}
	return f, nil
}

// GET /policy/device/:deviceId/ldap-servers
func DeviceListLDAPServers(c *gin.Context) {
	// Admin only, like the writes below it.
	//
	// Phase 2 gated every CREATE/UPDATE/DELETE here and left the reads open, which left the thing
	// worth protecting on the wrong side of the line: a directory server's entry names the host,
	// the port, the bind DN and the base DN — the shape of the organisation's directory and an
	// account that can read it. The password is not returned, and it is not the secret that
	// matters here.
	//
	// Nothing legitimate loses access. The User & Authentication pages are already inside
	// `isAdmin` in the sidebar, and the AI Assistant only reads these lists to avoid re-creating a
	// server it would then be refused permission to create.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	servers, err := fc.GetLDAPServers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, servers)
}

// GET /policy/device/:deviceId/ldap-server-options — CA certificates + Exchange connectors.
func DeviceGetLDAPServerOptions(c *gin.Context) {
	// Admin only — see DeviceListLDAPServers for why the reads are gated too.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetLDAPServerOptions())
}

// GET /policy/device/:deviceId/ldap-servers/:name — one server, shaped for the edit form.
func DeviceGetLDAPServer(c *gin.Context) {
	// Admin only — see DeviceListLDAPServers for why the reads are gated too.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	form, err := fc.GetLDAPServer(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, form)
}

// POST /policy/device/:deviceId/ldap-servers
func DeviceCreateLDAPServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	var inp ldapServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateLDAPServer(inp, true)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateLDAPServer(form); err != nil {
		respondDeviceError(c, err, "LDAP server")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "LDAP server created on device"})
}

// PUT /policy/device/:deviceId/ldap-servers/:name
func DeviceUpdateLDAPServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := c.Param("name")

	var inp ldapServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateLDAPServer(inp, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateLDAPServer(name, form); err != nil {
		respondDeviceError(c, err, "LDAP server")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "LDAP server updated on device"})
}

// DELETE /policy/device/:deviceId/ldap-servers/:name — always by mkey.
func DeviceDeleteLDAPServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteLDAPServer(name); err != nil {
		respondDeviceErrorMsg(c, err, "LDAP server", authServerDeleteMsg(err, "LDAP server"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "LDAP server deleted from device"})
}

// ── RADIUS Servers ───────────────────────────────────────────────────────────

// radiusServerInput is the body of the "New RADIUS Server" dialog.
type radiusServerInput struct {
	Name string `json:"name"`

	AuthMethodSpecify bool   `json:"auth_method_specify"`
	AuthType          string `json:"auth_type"`

	NASIP        string `json:"nas_ip"`
	AllUserGroup bool   `json:"all_usergroup"`

	Server string `json:"server"`
	Secret string `json:"secret"`

	SecondaryServer string `json:"secondary_server"`
	SecondarySecret string `json:"secondary_secret"`
}

// validateRADIUSServer normalises the body. requireSecret is false on edit, where a blank
// secret means "keep the stored one".
func validateRADIUSServer(inp radiusServerInput, requireSecret bool) (services.FGRADIUSServerForm, error) {
	f := services.FGRADIUSServerForm{}

	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return f, errMsg("name is required")
	}
	if len(name) > radiusNameMaxLen {
		return f, errMsg("name must be 35 characters or fewer")
	}

	server := strings.TrimSpace(inp.Server)
	if server == "" {
		return f, errMsg("primary server IP/name is required")
	}
	if len(server) > radiusServerMaxLen {
		return f, errMsg("primary server IP/name must be 63 characters or fewer")
	}
	if requireSecret && inp.Secret == "" {
		return f, errMsg("primary server secret is required")
	}

	authType := services.RADIUSAuthAuto
	if inp.AuthMethodSpecify {
		authType = strings.ToLower(strings.TrimSpace(inp.AuthType))
		if !services.IsValidRADIUSAuthType(authType) || authType == services.RADIUSAuthAuto {
			return f, errMsg("authentication method must be pap, chap, ms_chap, or ms_chap_v2")
		}
	}

	// nas-ip is an ipv4-address field — anything that isn't a bare IPv4 is rejected by the
	// device with an unhelpful parser error.
	nasIP := strings.TrimSpace(inp.NASIP)
	if nasIP != "" {
		ip := net.ParseIP(nasIP)
		if ip == nil || ip.To4() == nil {
			return f, errMsg("NAS IP must be a valid IPv4 address")
		}
	}

	f = services.FGRADIUSServerForm{
		Name:              name,
		AuthMethodSpecify: inp.AuthMethodSpecify,
		AuthType:          authType,
		NASIP:             nasIP,
		AllUserGroup:      inp.AllUserGroup,
		Server:            server,
		Secret:            inp.Secret,
	}

	// The Secondary Server block is optional, but a host without a secret can never
	// authenticate, so catch that here instead of letting it fail silently at runtime.
	if secondary := strings.TrimSpace(inp.SecondaryServer); secondary != "" {
		if len(secondary) > radiusServerMaxLen {
			return f, errMsg("secondary server IP/name must be 63 characters or fewer")
		}
		if requireSecret && inp.SecondarySecret == "" {
			return f, errMsg("secondary server secret is required when a secondary server is set")
		}
		// FortiOS requires the server addresses to be DISTINCT — a repeat comes back as the
		// cryptic «<host> is already the secondary server», error -61.
		if secondary == server {
			return f, errMsg("the primary and secondary servers cannot both be " + server +
				" — the FortiGate requires each RADIUS server address to be different")
		}
		f.SecondaryServer = secondary
		f.SecondarySecret = inp.SecondarySecret
	}
	// An empty secondary reaches the payload builder as "" and the key is omitted: FortiOS
	// rejects an empty address with -257, and removing a stored one needs the CLI's `unset`
	// (see services.RADIUSBackupServerClearable).
	return f, nil
}

// GET /policy/device/:deviceId/radius-servers
func DeviceListRADIUSServers(c *gin.Context) {
	// Admin only — see DeviceListLDAPServers for why the reads are gated too.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	servers, err := fc.GetRADIUSServers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, servers)
}

// GET /policy/device/:deviceId/radius-servers/:name
func DeviceGetRADIUSServer(c *gin.Context) {
	// Admin only — see DeviceListLDAPServers for why the reads are gated too.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	form, err := fc.GetRADIUSServer(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, form)
}

// POST /policy/device/:deviceId/radius-servers
func DeviceCreateRADIUSServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	var inp radiusServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateRADIUSServer(inp, true)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateRADIUSServer(form); err != nil {
		respondDeviceError(c, err, "RADIUS server")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "RADIUS server created on device"})
}

// PUT /policy/device/:deviceId/radius-servers/:name
func DeviceUpdateRADIUSServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := c.Param("name")

	var inp radiusServerInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateRADIUSServer(inp, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateRADIUSServer(name, form); err != nil {
		respondDeviceError(c, err, "RADIUS server")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "RADIUS server updated on device"})
}

// DELETE /policy/device/:deviceId/radius-servers/:name — always by mkey.
func DeviceDeleteRADIUSServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteRADIUSServer(name); err != nil {
		respondDeviceErrorMsg(c, err, "RADIUS server", authServerDeleteMsg(err, "RADIUS server"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "RADIUS server deleted from device"})
}

// radiusTestInput is the body of the GUI's Test Connectivity / Test User Credentials buttons.
// Sending user+password turns the connectivity test into a credentials test.
type radiusTestInput struct {
	Ordinal  string `json:"ordinal"` // primary | secondary — the two blocks the dialog shows
	User     string `json:"user"`
	Password string `json:"password"`
}

var radiusOrdinals = map[string]bool{"primary": true, "secondary": true}

// POST /policy/device/:deviceId/radius-servers/:name/test
func DeviceTestRADIUSServer(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server name is required"})
		return
	}

	var inp radiusTestInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ordinal := strings.ToLower(strings.TrimSpace(inp.Ordinal))
	if ordinal == "" {
		ordinal = "primary"
	}
	if !radiusOrdinals[ordinal] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ordinal must be primary or secondary"})
		return
	}
	// A credentials test needs both halves; a user with no password would silently downgrade
	// to a plain connectivity check and report a misleading result.
	if strings.TrimSpace(inp.User) != "" && inp.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password is required to test user credentials"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	res, err := fc.TestRADIUSServer(name, ordinal, strings.TrimSpace(inp.User), inp.Password)
	if err != nil {
		respondDeviceError(c, err, "RADIUS server")
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Exchange external connector ──────────────────────────────────────────────

// exchangeConnectorInput is the body of the "New External Connector" dialog. The GUI's single
// "Exchange account" field is split into username / server_name / domain_name by the caller,
// which lets the form show what it derived before saving.
type exchangeConnectorInput struct {
	Name       string `json:"name"`
	Username   string `json:"username"`
	ServerName string `json:"server_name"`
	DomainName string `json:"domain_name"`
	Password   string `json:"password"`

	OverrideIP      bool   `json:"override_ip"`
	IP              string `json:"ip"`
	AutoDiscoverKDC bool   `json:"auto_discover_kdc"`
}

func validateExchangeConnector(inp exchangeConnectorInput) (services.FGExchangeConnectorForm, error) {
	f := services.FGExchangeConnectorForm{}

	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return f, errMsg("name is required")
	}
	if len(name) > exchangeNameMaxLen {
		return f, errMsg("name must be 35 characters or fewer")
	}

	username := strings.TrimSpace(inp.Username)
	serverName := strings.TrimSpace(inp.ServerName)
	domainName := strings.TrimSpace(inp.DomainName)
	if username == "" || serverName == "" {
		return f, errMsg("exchange account must be in the form username@server.domain.com")
	}
	if len(username) > exchangeUserMaxLen {
		return f, errMsg("exchange account username must be 64 characters or fewer")
	}
	if len(serverName) > exchangeServerMaxLen {
		return f, errMsg("exchange server name must be 63 characters or fewer")
	}
	if len(domainName) > exchangeDomainMaxLen {
		return f, errMsg("exchange domain name must be 79 characters or fewer")
	}
	if inp.Password == "" {
		return f, errMsg("password is required")
	}

	f = services.FGExchangeConnectorForm{
		Name: name, Username: username, ServerName: serverName, DomainName: domainName,
		Password: inp.Password, AutoDiscoverKDC: inp.AutoDiscoverKDC,
		OverrideIP: inp.OverrideIP,
	}

	if inp.OverrideIP {
		ipStr := strings.TrimSpace(inp.IP)
		ip := net.ParseIP(ipStr)
		if ip == nil || ip.To4() == nil {
			return f, errMsg("override server IP address must be a valid IPv4 address")
		}
		f.IP = ipStr
	}
	return f, nil
}

// GET /policy/device/:deviceId/exchange-connectors
func DeviceListExchangeConnectors(c *gin.Context) {
	// Admin only — see DeviceListLDAPServers for why the reads are gated too.
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	conns, err := fc.GetExchangeConnectors()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conns)
}

// POST /policy/device/:deviceId/exchange-connectors
func DeviceCreateExchangeConnector(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	var inp exchangeConnectorInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateExchangeConnector(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateExchangeConnector(form); err != nil {
		respondDeviceError(c, err, "Exchange connector")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Exchange connector created on device"})
}

// DELETE /policy/device/:deviceId/exchange-connectors/:name — always by mkey.
func DeviceDeleteExchangeConnector(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "connector name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteExchangeConnector(name); err != nil {
		respondDeviceErrorMsg(c, err, "Exchange connector", authServerDeleteMsg(err, "Exchange connector"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Exchange connector deleted from device"})
}

// authServerDeleteMsg turns FortiOS's "-23" (object still referenced) into something the user
// can act on — an auth server is typically wired into a user group or an admin profile.
func authServerDeleteMsg(err error, noun string) string {
	if code, ok := services.DeviceErrorCode(err); ok && code == services.FGErrStillReferenced {
		return "This " + noun + " is still referenced (a user group, remote user, or admin login uses it) — remove those references first, then delete."
	}
	return "FortiGate error: " + err.Error()
}

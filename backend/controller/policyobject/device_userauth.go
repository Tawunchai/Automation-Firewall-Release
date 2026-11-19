package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// GET /policy/device/:deviceId/users — User & Authentication > User Definition list
// (user/local objects + derived Groups column + reference count). Read-only for now.
func DeviceListUsers(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	users, err := fc.GetLocalUsers()
	if err != nil {
		respondDeviceError(c, err, "local user")
		return
	}
	c.JSON(http.StatusOK, users)
}

// GET /policy/device/:deviceId/user-groups — User & Authentication > User Groups list
// (user/group objects: name, group type, members, reference count).
func DeviceListUserGroups(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	groups, err := fc.GetUserGroups()
	if err != nil {
		respondDeviceError(c, err, "user group")
		return
	}
	c.JSON(http.StatusOK, groups)
}

// ── Local User CRUD (User Definition) ─────────────────────────────────────────

// localUserInput is the body of the FortiGate "Users/Groups Creation Wizard" (Local User).
type localUserInput struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Password string `json:"password"`

	TwoFactor      string `json:"two_factor"` // disable | fortitoken | fortitoken-cloud
	FortiToken     string `json:"fortitoken"`
	EmailTo        string `json:"email_to"`
	SMSEnabled     bool   `json:"sms_enabled"`
	SMSCountryCode string `json:"sms_country_code"`
	SMSPhone       string `json:"sms_phone"`

	Status bool     `json:"status"`
	Groups []string `json:"groups"`
}

// FortiOS user/local name field is 64 chars.
const localUserNameMaxLen = 64

// validateLocalUser enforces what the FortiGate wizard enforces, so a bad body fails here with
// a readable message instead of an opaque FortiOS code.
//
// requirePassword is false on edit, where a blank password means "keep the current one".
func validateLocalUser(inp localUserInput, requirePassword bool) (services.FGLocalUserForm, error) {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return services.FGLocalUserForm{}, errMsg("username is required")
	}
	if len(name) > localUserNameMaxLen {
		return services.FGLocalUserForm{}, errMsg("username must be 64 characters or fewer")
	}
	// Only the "Local User" branch of the wizard is built. The remote types need a server
	// datasource (radius/tacacs+/ldap) that this form doesn't collect.
	userType := strings.TrimSpace(inp.Type)
	if userType == "" {
		userType = services.LocalUserTypePassword
	}
	if userType != services.LocalUserTypePassword {
		return services.FGLocalUserForm{}, errMsg("only Local User (type=password) is supported")
	}
	if requirePassword && inp.Password == "" {
		return services.FGLocalUserForm{}, errMsg("password is required")
	}

	twoFactor := strings.TrimSpace(inp.TwoFactor)
	if twoFactor == "" {
		twoFactor = "disable"
	}
	if !services.IsValidLocalUserTwoFactor(twoFactor) {
		return services.FGLocalUserForm{}, errMsg("two_factor must be disable, fortitoken, or fortitoken-cloud")
	}

	f := services.FGLocalUserForm{
		Name:      name,
		Type:      userType,
		Password:  inp.Password,
		TwoFactor: twoFactor,
		Status:    inp.Status,
		Groups:    inp.Groups,
	}

	if twoFactor != "disable" {
		f.EmailTo = strings.TrimSpace(inp.EmailTo)
		// Both of these are FortiOS rules confirmed live — catching them here turns a bare
		// "-7522"/"-7524" into something the user can act on.
		if twoFactor == "fortitoken" {
			f.FortiToken = strings.TrimSpace(inp.FortiToken)
			if f.FortiToken == "" {
				return f, errMsg("select a FortiToken — the device rejects FortiToken 2FA without one (-7522)")
			}
		}
		if f.EmailTo != "" && !strings.Contains(f.EmailTo, "@") {
			return f, errMsg("email address is not valid")
		}
		f.SMSEnabled = inp.SMSEnabled
		if inp.SMSEnabled {
			f.SMSCountryCode = strings.TrimSpace(inp.SMSCountryCode)
			f.SMSPhone = strings.TrimSpace(inp.SMSPhone)
			if f.SMSCountryCode == "" {
				return f, errMsg("select a country dial code for SMS")
			}
			if f.SMSPhone == "" {
				return f, errMsg("phone number is required when SMS is enabled")
			}
		}
		// ⚠️ EVERY 2FA mode needs a delivery channel — verified live: fortitoken WITH a valid
		// serial but no email and no SMS is still rejected with
		// "-7524 You must specify a phone number or email address". Either one satisfies it.
		if f.EmailTo == "" && !f.SMSEnabled {
			return f, errMsg("two-factor authentication needs an email address or SMS phone number (-7524)")
		}
	}

	for _, g := range f.Groups {
		if strings.TrimSpace(g) == "" {
			return f, errMsg("group names cannot be blank")
		}
	}
	return f, nil
}

// GET /policy/device/:deviceId/user-options — the wizard's datasources (FortiTokens + groups).
func DeviceGetLocalUserOptions(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetLocalUserOptions())
}

// GET /policy/device/:deviceId/users/:name — one user, shaped for the edit form.
func DeviceGetUser(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	form, err := fc.GetLocalUser(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, form)
}

// POST /policy/device/:deviceId/users
func DeviceCreateUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp localUserInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateLocalUser(inp, true)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateLocalUser(form); err != nil {
		respondDeviceError(c, err, "local user")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "user created on device"})
}

// PUT /policy/device/:deviceId/users/:name
func DeviceUpdateUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := c.Param("name")

	var inp localUserInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Blank password on edit = keep the stored one (the device never returns it to prefill).
	form, err := validateLocalUser(inp, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateLocalUser(name, form); err != nil {
		respondDeviceError(c, err, "local user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user updated on device"})
}

// DELETE /policy/device/:deviceId/users/:name — always by mkey, never the collection URL.
func DeviceDeleteUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteLocalUser(name); err != nil {
		// The generic -23 line says "a policy, group or profile"; for a local user it is always a
		// user group, so the specific sentence is kept — but it goes through the helper, which is
		// what puts `fortios_code` on the body and turns -23 into 409 instead of 502.
		msg := ""
		if code, ok := services.DeviceErrorCode(err); ok && code == services.FGErrStillReferenced {
			msg = "This user is still a member of a user group — remove it from the group first, then delete."
		}
		respondDeviceErrorMsg(c, err, "local user", msg)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user deleted from device"})
}

// ── User Group CRUD ───────────────────────────────────────────────────────────

// userGroupInput is the GUI-shaped create/update body — the fields of the FortiGate
// "New User Group" dialog. Which ones matter depends on Type.
type userGroupInput struct {
	Name string `json:"name"`
	Type string `json:"group_type"` // firewall | fsso-service | rsso | guest

	Members []string `json:"members"`
	Matches []struct {
		ServerName string `json:"server_name"`
		GroupName  string `json:"group_name"`
	} `json:"matches"`

	SSOAttributeValue string `json:"sso_attribute_value"`

	MultipleGuestAdd bool   `json:"multiple_guest_add"`
	UserID           string `json:"user_id"`
	MaxAccounts      int    `json:"max_accounts"`
	UserName         bool   `json:"user_name"`
	Email            bool   `json:"email"`
	MobilePhone      bool   `json:"mobile_phone"`
	SMSServer        string `json:"sms_server"`
	SMSCustomServer  string `json:"sms_custom_server"`
	Password         string `json:"password"`
	Sponsor          string `json:"sponsor"`
	Company          string `json:"company"`
	ExpireType       string `json:"expire_type"`
	Expire           int    `json:"expire"`
}

// Option sets accepted by FortiOS for the guest block — taken verbatim from
// user/group?action=schema (FortiOS 7.2.10). Validating here turns a typo into a clear
// 400 instead of an opaque FortiOS CLI parser error.
var (
	validGuestUserID     = map[string]bool{"email": true, "auto-generate": true, "specify": true}
	validGuestPassword   = map[string]bool{"auto-generate": true, "specify": true, "disable": true}
	validGuestSponsor    = map[string]bool{"optional": true, "mandatory": true, "disabled": true}
	validGuestExpireType = map[string]bool{"immediately": true, "first-successful-login": true}
	validGuestSMSServer  = map[string]bool{"fortiguard": true, "custom": true}
)

// FortiOS limits from the schema: expire is 1–31536000 seconds, max-accounts 0–500
// (0 = unlimited), name up to 35 chars.
const (
	userGroupNameMaxLen       = 35
	userGroupMatchGroupMaxLen = 511 // user/group match.group-name
	guestExpireMin            = 1
	guestExpireMax            = 31536000
	guestMaxAccountsMax       = 500
)

// validateUserGroup enforces the same rules the FortiGate dialog does and normalises the body
// into the service-layer form.
func validateUserGroup(inp userGroupInput) (services.FGUserGroupForm, error) {
	name := strings.TrimSpace(inp.Name)
	if name == "" {
		return services.FGUserGroupForm{}, errMsg("name is required")
	}
	if len(name) > userGroupNameMaxLen {
		return services.FGUserGroupForm{}, errMsg("name must be 35 characters or fewer")
	}
	groupType := strings.ToLower(strings.TrimSpace(inp.Type))
	if !services.IsValidUserGroupType(groupType) {
		return services.FGUserGroupForm{}, errMsg("group_type must be firewall, fsso-service, rsso, or guest")
	}

	f := services.FGUserGroupForm{Name: name, GroupType: groupType}

	// "Remote Groups" — checked BEFORE the type switch on purpose. Nesting it under the firewall
	// branch meant a guest group's rows were silently ignored instead of rejected, which is exactly
	// the failure mode the device has (it answers 200 and stores match=[]) and exactly what the app
	// must not repeat.
	if len(inp.Matches) > 0 {
		if !services.UserGroupTakesMatches(groupType) {
			return f, errMsg("remote groups can only be set on a Firewall group")
		}
		seen := map[string]bool{}
		for _, m := range inp.Matches {
			server := strings.TrimSpace(m.ServerName)
			group := strings.TrimSpace(m.GroupName)
			if server == "" {
				return f, errMsg("select a remote server for every remote group")
			}
			if group == "" {
				return f, errMsg("remote group name is required (e.g. CN=VPN-Users,OU=Groups,DC=corp,DC=local)")
			}
			if len(group) > userGroupMatchGroupMaxLen {
				return f, errMsg("remote group name must be 511 characters or fewer")
			}
			// FortiOS keys the table by id, so a repeated server+group pair would silently
			// collapse into one row.
			key := server + "\x00" + group
			if seen[key] {
				return f, errMsg("remote group \"" + group + "\" is listed twice for " + server)
			}
			seen[key] = true
			f.Matches = append(f.Matches, services.FGUserGroupMatch{ServerName: server, GroupName: group})
		}
	}

	switch groupType {
	case "firewall", "fsso-service":
		for _, m := range inp.Members {
			if strings.TrimSpace(m) == "" {
				return f, errMsg("member names cannot be blank")
			}
		}
		f.Members = inp.Members

	case "rsso":
		// The GUI's "RADIUS Attribute Value" — the RADIUS group this local group represents.
		f.SSOAttributeValue = strings.TrimSpace(inp.SSOAttributeValue)
		if f.SSOAttributeValue == "" {
			return f, errMsg("RADIUS Attribute Value is required for an RSSO group")
		}

	case "guest":
		if inp.MaxAccounts < 0 || inp.MaxAccounts > guestMaxAccountsMax {
			return f, errMsg("max_accounts must be 0-500 (0 = unlimited)")
		}
		if !validGuestExpireType[inp.ExpireType] {
			return f, errMsg("expire_type must be immediately or first-successful-login")
		}
		if inp.Expire < guestExpireMin || inp.Expire > guestExpireMax {
			return f, errMsg("expire must be 1-31536000 seconds")
		}
		f.MultipleGuestAdd = inp.MultipleGuestAdd
		f.MaxAccounts = inp.MaxAccounts
		f.ExpireType = inp.ExpireType
		f.Expire = inp.Expire

		// Under batch mode the device forces/ignores the whole Guest Details block (see
		// buildUserGroupPayload), so there is nothing to validate — and rejecting a stale
		// value the caller couldn't have applied anyway would just be noise.
		if inp.MultipleGuestAdd {
			break
		}
		if !validGuestUserID[inp.UserID] {
			return f, errMsg("user_id must be email, auto-generate, or specify")
		}
		if !validGuestPassword[inp.Password] {
			return f, errMsg("password must be auto-generate, specify, or disable")
		}
		if !validGuestSponsor[inp.Sponsor] {
			return f, errMsg("sponsor must be optional, mandatory, or disabled")
		}
		if !validGuestSponsor[inp.Company] {
			return f, errMsg("company must be optional, mandatory, or disabled")
		}
		f.UserID = inp.UserID
		f.Password = inp.Password
		f.UserName = inp.UserName
		f.Email = inp.Email
		f.MobilePhone = inp.MobilePhone
		f.Sponsor = inp.Sponsor
		f.Company = inp.Company
		if inp.MobilePhone {
			if !validGuestSMSServer[inp.SMSServer] {
				return f, errMsg("sms_server must be fortiguard or custom")
			}
			f.SMSServer = inp.SMSServer
			if inp.SMSServer == "custom" {
				f.SMSCustomServer = strings.TrimSpace(inp.SMSCustomServer)
				// sms-custom-server is a datasource (system.sms-server.name); an empty or
				// unknown value comes back from FortiOS as a bare "-3 entry not found in
				// datasource", so catch the empty case with a message that says what to do.
				if f.SMSCustomServer == "" {
					return f, errMsg("select a custom SMS server (System > SMS Server), or use FortiGuard")
				}
			}
		}
	}
	return f, nil
}

// GET /policy/device/:deviceId/user-groups/:name — one group, shaped for the edit form.
func DeviceGetUserGroup(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	form, err := fc.GetUserGroup(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, form)
}

// GET /policy/device/:deviceId/user-group-options — the "Select Entries" datasource:
// members valid for a Firewall group, members valid for an FSSO group, and the SMS servers.
func DeviceGetUserGroupOptions(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetUserGroupOptions())
}

// POST /policy/device/:deviceId/user-groups
func DeviceCreateUserGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	var inp userGroupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateUserGroup(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.CreateUserGroup(form); err != nil {
		respondDeviceError(c, err, "user group")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "user group created on device"})
}

// PUT /policy/device/:deviceId/user-groups/:name
func DeviceUpdateUserGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := c.Param("name")

	var inp userGroupInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	form, err := validateUserGroup(inp)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.UpdateUserGroup(name, form); err != nil {
		respondDeviceError(c, err, "user group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user group updated on device"})
}

// DELETE /policy/device/:deviceId/user-groups/:name — always by mkey, never the collection URL.
func DeviceDeleteUserGroup(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group name is required"})
		return
	}

	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	if err := fc.DeleteUserGroup(name); err != nil {
		respondDeviceError(c, err, "user group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user group deleted from device"})
}

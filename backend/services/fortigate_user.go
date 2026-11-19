package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var userLocalTable = cmdbPath{path: "user/local", noun: "local user"}
var userGroupTable = cmdbPath{path: "user/group", noun: "user group"}

// User & Authentication — local users (user/local), user groups (user/group) and the member
// pickers the group form's "Select Entries" panel is built from.
//
// Split out of fortigate.go verbatim. LDAP and RADIUS servers live in fortigate_authserver.go.

// ── User & Authentication (read-only list views) ──────────────────────────────
//
// FGUserDefinition mirrors one row of the FortiOS "User & Authentication > User
// Definition" list: a user/local object plus the derived Groups column (which groups list
// this user as a member) and the FortiGate reference count (q_ref, via with_meta=1).
type FGUserDefinition struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`       // LOCAL | RADIUS | TACACS+ | LDAP
	TwoFactor bool     `json:"two_factor"` // "Two-factor Authentication" column
	Groups    []string `json:"groups"`
	Enabled   bool     `json:"enabled"` // Status column
	Ref       int      `json:"ref"`
}

// FGUserGroup mirrors one row of the "User Groups" list.
type FGUserGroup struct {
	Name      string   `json:"name"`
	GroupType string   `json:"group_type"` // display label (Firewall, FSSO, RSSO, Guest)
	TypeCode  string   `json:"type_code"`  // raw group-type (firewall|fsso-service|rsso|guest)
	Members   []string `json:"members"`
	Ref       int      `json:"ref"`
}

// ── Local User CRUD (User & Authentication > User Definition) ─────────────────
//
// FGLocalUserForm is the GUI-shaped body for the FortiGate "Users/Groups Creation Wizard",
// Local User branch (user/local with type=password). The wizard's four steps map like this:
//
//	1 User Type        → Type (only "password" / Local User is supported)
//	2 Login Credentials → Name + Password
//	3 Contact Info      → TwoFactor + FortiToken + EmailTo + SMS*
//	4 Extra Info        → Status + Groups
//
// Groups is NOT a user/local field — membership lives in each user/group's member list, so
// it is reconciled separately (see syncUserGroups).
type FGLocalUserForm struct {
	Name     string `json:"name"`
	Type     string `json:"type"`     // password | radius | tacacs+ | ldap (only password is built)
	Password string `json:"password"` // write-only; the device never returns it

	// Contact Info
	TwoFactor      string `json:"two_factor"` // disable | fortitoken | fortitoken-cloud
	FortiToken     string `json:"fortitoken"` // datasource: user.fortitoken.serial-number
	EmailTo        string `json:"email_to"`
	SMSEnabled     bool   `json:"sms_enabled"`
	SMSCountryCode string `json:"sms_country_code"` // e.g. "+66"
	SMSPhone       string `json:"sms_phone"`        // local part, digits only

	// Extra Info
	Status bool     `json:"status"`
	Groups []string `json:"groups"` // user/group names this user belongs to (derived)
}

// LocalUserTypePassword is the only user type the wizard builds — "Local User" in the GUI.
const LocalUserTypePassword = "password"

var localUserTwoFactorModes = map[string]bool{
	"disable": true, "fortitoken": true, "fortitoken-cloud": true,
}

func IsValidLocalUserTwoFactor(m string) bool { return localUserTwoFactorModes[m] }

// joinSMSPhone builds the "+66-812345678" form FortiOS stores in sms-phone.
func joinSMSPhone(countryCode, phone string) string {
	cc := strings.TrimPrefix(strings.TrimSpace(countryCode), "+")
	p := strings.TrimSpace(phone)
	if cc == "" || p == "" {
		return ""
	}
	return "+" + cc + "-" + p
}

// splitSMSPhone reverses joinSMSPhone. A value that doesn't carry a dial code (hand-edited on
// the device) comes back as the phone part alone so the edit form still shows it.
func splitSMSPhone(v string) (countryCode, phone string) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", ""
	}
	if strings.HasPrefix(v, "+") {
		if i := strings.Index(v, "-"); i > 0 {
			return v[:i], v[i+1:]
		}
	}
	return "", v
}

// buildLocalUserPayload maps the form to the user/local CMDB body.
//
// ⚠️ Verified live on FortiOS 7.2.10:
//   - two-factor=fortitoken WITHOUT a serial ⇒ -7522 "Invalid fortitoken id" (Token is required).
//   - two-factor=fortitoken-cloud WITHOUT an email ⇒ -7524 "You must specify an email address".
//   - With 2FA off the contact fields are irrelevant, so they are cleared rather than left stale.
func buildLocalUserPayload(f FGLocalUserForm, includePassword bool) map[string]interface{} {
	p := map[string]interface{}{
		"name":       f.Name,
		"type":       f.Type,
		"status":     FGBoolToString(f.Status),
		"two-factor": f.TwoFactor,
	}
	// On edit the password box may be left blank = "keep the current one"; the device never
	// returns the stored hash, so sending an empty string would wipe it.
	if includePassword && f.Password != "" {
		p["passwd"] = f.Password
	}

	if f.TwoFactor == "disable" {
		// Clear the contact fields so a user switched back to no-2FA doesn't keep a stale
		// token/email/phone that the GUI would no longer show.
		p["fortitoken"] = ""
		p["email-to"] = ""
		p["sms-phone"] = ""
		return p
	}

	if f.TwoFactor == "fortitoken" {
		p["fortitoken"] = f.FortiToken
	} else {
		p["fortitoken"] = ""
	}
	p["email-to"] = strings.TrimSpace(f.EmailTo)
	if f.SMSEnabled {
		p["sms-server"] = "fortiguard"
		p["sms-phone"] = joinSMSPhone(f.SMSCountryCode, f.SMSPhone)
	} else {
		p["sms-phone"] = ""
	}
	return p
}

type fgLocalUserRaw struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	TwoFactor  string `json:"two-factor"`
	FortiToken string `json:"fortitoken"`
	EmailTo    string `json:"email-to"`
	SMSPhone   string `json:"sms-phone"`
}

func (r fgLocalUserRaw) toForm() FGLocalUserForm {
	cc, phone := splitSMSPhone(r.SMSPhone)
	tf := r.TwoFactor
	if tf == "" {
		tf = "disable"
	}
	return FGLocalUserForm{
		Name:           r.Name,
		Type:           r.Type,
		TwoFactor:      tf,
		FortiToken:     r.FortiToken,
		EmailTo:        r.EmailTo,
		SMSEnabled:     phone != "",
		SMSCountryCode: cc,
		SMSPhone:       phone,
		Status:         FGStringToBool(r.Status),
	}
}

// GetLocalUser fetches one user/local plus the groups it belongs to (read from user/group,
// where membership actually lives). Password is never returned by the device.
func (f *FortiClient) GetLocalUser(name string) (*FGLocalUserForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/local/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var rows []fgLocalUserRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse local user: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("user %q not found", name)
	}
	form := rows[0].toForm()
	form.Groups = f.groupsForUser(name)
	return &form, nil
}

// groupsForUser lists the groups that name is a member of. Best-effort: a fetch error just
// yields no groups rather than failing the whole edit form.
func (f *FortiClient) groupsForUser(name string) []string {
	out := []string{}
	groups, err := f.GetUserGroups()
	if err != nil {
		return out
	}
	for _, g := range groups {
		for _, m := range g.Members {
			if m == name {
				out = append(out, g.Name)
				break
			}
		}
	}
	return out
}

// syncUserGroups reconciles which groups list this user as a member — the "User Group" step of
// the wizard. Membership is a property of user/group, not user/local, so this walks the groups
// and PUTs only the ones whose member list actually changes.
//
// Only firewall / fsso-service groups are touched: the device drops a member list on guest and
// rsso groups (see UserGroupTakesMembers).
func (f *FortiClient) syncUserGroups(username string, want []string) error {
	wanted := map[string]bool{}
	for _, g := range want {
		wanted[g] = true
	}
	groups, err := f.GetUserGroups()
	if err != nil {
		return fmt.Errorf("failed to read user groups: %w", err)
	}

	for _, g := range groups {
		if !UserGroupTakesMembers(g.TypeCode) {
			continue
		}
		has := false
		for _, m := range g.Members {
			if m == username {
				has = true
				break
			}
		}
		switch {
		case wanted[g.Name] && !has:
			members := append(append([]string{}, g.Members...), username)
			if err := f.setGroupMembers(g.Name, members); err != nil {
				return err
			}
		case !wanted[g.Name] && has:
			members := make([]string, 0, len(g.Members))
			for _, m := range g.Members {
				if m != username {
					members = append(members, m)
				}
			}
			if err := f.setGroupMembers(g.Name, members); err != nil {
				return err
			}
		}
	}
	return nil
}

// setGroupMembers PUTs just the member list of a group, leaving its other settings alone.
func (f *FortiClient) setGroupMembers(group string, members []string) error {
	body := map[string]interface{}{"member": NamesToFGNames(members)}
	if err := userGroupTable.Update(f, group, body); err != nil {
		return fmt.Errorf("failed to update members of group %q: %w", group, err)
	}
	return nil
}

// CreateLocalUser creates the user, then adds it to the chosen groups. If the group step fails
// the user still exists — the error says so, rather than pretending nothing happened.
func (f *FortiClient) CreateLocalUser(form FGLocalUserForm) error {
	if err := userLocalTable.Create(f, buildLocalUserPayload(form, true)); err != nil {
		return fmt.Errorf("failed to create user %q: %w", form.Name, err)
	}
	if err := f.syncUserGroups(form.Name, form.Groups); err != nil {
		return fmt.Errorf("user %q was created, but its groups could not be set: %w", form.Name, err)
	}
	return nil
}

// UpdateLocalUser edits an existing user, keyed by its CURRENT name (a different Name renames it).
func (f *FortiClient) UpdateLocalUser(name string, form FGLocalUserForm) error {
	if err := userLocalTable.Update(f, name, buildLocalUserPayload(form, true)); err != nil {
		return fmt.Errorf("failed to update user %q: %w", name, err)
	}
	// Reconcile against the (possibly new) name.
	target := form.Name
	if target == "" {
		target = name
	}
	if err := f.syncUserGroups(target, form.Groups); err != nil {
		return fmt.Errorf("user %q was updated, but its groups could not be set: %w", target, err)
	}
	return nil
}

// DeleteLocalUser removes one user BY MKEY. FortiOS refuses while the user is still referenced
// (a group member) with "-23 The entry is used by other N entries" — that message is surfaced
// as-is so the caller knows to remove it from its groups first.
func (f *FortiClient) DeleteLocalUser(name string) error {
	if err := userLocalTable.Delete(f, name); err != nil {
		return fmt.Errorf("failed to delete user %q: %w", name, err)
	}
	return nil
}

// ── Local User form options ───────────────────────────────────────────────────

// FGLocalUserOptions is what the wizard's pickers need: the device's FortiTokens (Token
// dropdown) and the groups a user can be put in (Extra Info → User Group).
type FGLocalUserOptions struct {
	FortiTokens []string `json:"fortitokens"`
	Groups      []string `json:"groups"`
}

// GetLocalUserOptions collects the wizard's datasources. Both are best-effort so the form
// still renders on a device without FortiTokens or groups.
func (f *FortiClient) GetLocalUserOptions() FGLocalUserOptions {
	opts := FGLocalUserOptions{FortiTokens: []string{}, Groups: []string{}}

	// user/fortitoken is keyed by serial-number, not name, so fetchNames can't be reused.
	if resp, err := f.do("GET", "/api/v2/cmdb/user/fortitoken?fields=serial-number", nil); err == nil {
		var toks []struct {
			Serial string `json:"serial-number"`
		}
		if json.Unmarshal(resp.Results, &toks) == nil {
			for _, t := range toks {
				if t.Serial != "" {
					opts.FortiTokens = append(opts.FortiTokens, t.Serial)
				}
			}
		}
	}
	// Only groups that actually accept members are offerable.
	if groups, err := f.GetUserGroups(); err == nil {
		for _, g := range groups {
			if UserGroupTakesMembers(g.TypeCode) {
				opts.Groups = append(opts.Groups, g.Name)
			}
		}
	}
	return opts
}

// ── User Group CRUD ───────────────────────────────────────────────────────────
//
// FGUserGroupForm is the GUI-shaped create/edit body for user/group. Which fields matter
// depends on GroupType, exactly like the FortiGate "New User Group" dialog:
//
//	firewall / fsso-service → Members
//	rsso                    → SSOAttributeValue ("RADIUS Attribute Value")
//	guest                   → the whole guest block (User ID, Guest Details, Expiration)
type FGUserGroupForm struct {
	Name      string   `json:"name"`
	GroupType string   `json:"group_type"`
	Members   []string `json:"members"`
	// Matches is the GUI's "Remote Groups" table — which group ON a remote auth server counts as
	// membership of this local group. Firewall groups only; see UserGroupTakesMatches.
	Matches []FGUserGroupMatch `json:"matches"`
	// rsso
	SSOAttributeValue string `json:"sso_attribute_value"`
	// guest
	MultipleGuestAdd bool   `json:"multiple_guest_add"` // "Batch Guest Account Creation"
	UserID           string `json:"user_id"`            // email | auto-generate | specify
	MaxAccounts      int    `json:"max_accounts"`       // 0 = unlimited (toggle off)
	UserName         bool   `json:"user_name"`          // "Enable Name"
	Email            bool   `json:"email"`              // "Enable Email"
	MobilePhone      bool   `json:"mobile_phone"`       // "Enable SMS"
	SMSServer        string `json:"sms_server"`         // fortiguard | custom
	SMSCustomServer  string `json:"sms_custom_server"`  // datasource: system.sms-server.name
	Password         string `json:"password"`           // auto-generate | specify | disable
	Sponsor          string `json:"sponsor"`            // optional | mandatory | disabled
	Company          string `json:"company"`            // optional | mandatory | disabled
	ExpireType       string `json:"expire_type"`        // immediately | first-successful-login
	Expire           int    `json:"expire"`             // seconds (1 - 31536000)
}

// FGUserGroupMatch is one row of user/group's `match` table: "users in <GroupName> on
// <ServerName> belong to this group". ServerName is a DATASOURCE spanning every remote auth
// table (user.ldap / user.radius / user.tacacs+ / user.saml), so an unknown name is error -3.
//
// The CMDB row also carries an `id`; it is assigned by buildUserGroupPayload rather than carried
// in the form, because it is a positional key with no meaning to the user.
type FGUserGroupMatch struct {
	ServerName string `json:"server_name"`
	GroupName  string `json:"group_name"`
}

// userGroupTypeCodes are the four group-type values FortiOS accepts (verified against
// user/group?action=schema on FortiOS 7.2.10).
var userGroupTypeCodes = map[string]bool{
	"firewall": true, "fsso-service": true, "rsso": true, "guest": true,
}

func IsValidUserGroupType(t string) bool { return userGroupTypeCodes[strings.ToLower(t)] }

// UserGroupTakesMembers reports whether a group type has a Members list. Guest and RSSO
// groups do not: the device silently DROPS a "member" list sent with group-type guest
// (verified live — it returns 200 and stores member=[]), so the form hides the picker.
func UserGroupTakesMembers(t string) bool {
	return t == "firewall" || t == "fsso-service"
}

// UserGroupTakesMatches reports whether a group type can carry the "Remote Groups" match table.
// Only Firewall groups can — verified live on FortiOS 7.2.10:
//   - guest / rsso: the device answers 200 and stores match=[] (the same silent drop it does for
//     member), so offering the table would be a lie
//   - fsso-service: its members come from user/adgrp, so naming an LDAP/RADIUS server as a member
//     is rejected with -3 — and a match without that member cannot exist (see below)
func UserGroupTakesMatches(t string) bool { return t == "firewall" }

// buildUserGroupPayload maps the form to the user/group CMDB body, sending only the keys
// that belong to the chosen group type.
//
// ⚠️ BATCH GUEST GOTCHA (verified live on FortiOS 7.2.10): with multiple-guest-add=enable the
// device FORCES user-id=auto-generate and password=auto-generate and resets user-name / email /
// mobile-phone / sponsor / company to their defaults — while still answering HTTP 200 "success".
// Sending those keys under batch mode is therefore a silent no-op that would make the form lie
// about what landed on the device, so we omit them entirely. max-accounts / expire-type / expire
// DO still apply under batch mode and are always sent.
func buildUserGroupPayload(f FGUserGroupForm) map[string]interface{} {
	p := map[string]interface{}{
		"name":       f.Name,
		"group-type": f.GroupType,
	}
	switch f.GroupType {
	case "firewall", "fsso-service":
		members := f.Members
		if UserGroupTakesMatches(f.GroupType) && len(f.Matches) > 0 {
			// ⚠️ A match's server MUST also be a member, or FortiOS rejects the whole object with
			// "-518 object set operator error, discard the setting" (verified live). There is no
			// valid config where match names a non-member, so the server is added rather than
			// bounced back — the form shows it as a member chip, so nothing is hidden.
			members = appendMatchServers(members, f.Matches)
			rows := make([]map[string]interface{}, 0, len(f.Matches))
			for i, m := range f.Matches {
				rows = append(rows, map[string]interface{}{
					"id":          i + 1, // positional key; the user never sees or chooses it
					"server-name": m.ServerName,
					"group-name":  m.GroupName,
				})
			}
			p["match"] = rows
		}
		p["member"] = NamesToFGNames(members)
	case "rsso":
		p["sso-attribute-value"] = f.SSOAttributeValue
	case "guest":
		p["multiple-guest-add"] = FGBoolToString(f.MultipleGuestAdd)
		p["max-accounts"] = f.MaxAccounts
		p["expire-type"] = f.ExpireType
		p["expire"] = f.Expire
		if !f.MultipleGuestAdd {
			p["user-id"] = f.UserID
			p["password"] = f.Password
			p["user-name"] = FGBoolToString(f.UserName)
			p["email"] = FGBoolToString(f.Email)
			p["mobile-phone"] = FGBoolToString(f.MobilePhone)
			p["sponsor"] = f.Sponsor
			p["company"] = f.Company
			if f.MobilePhone {
				p["sms-server"] = f.SMSServer
				// sms-custom-server is a datasource (system.sms-server.name) — a name the
				// device doesn't have comes back as error -3, so only send it for "custom".
				if f.SMSServer == "custom" {
					p["sms-custom-server"] = f.SMSCustomServer
				}
			}
		}
	}
	return p
}

// appendMatchServers adds every match's server to the member list, keeping the caller's order and
// skipping the ones already there.
func appendMatchServers(members []string, matches []FGUserGroupMatch) []string {
	seen := make(map[string]bool, len(members))
	for _, m := range members {
		seen[m] = true
	}
	out := append([]string{}, members...)
	for _, m := range matches {
		if m.ServerName == "" || seen[m.ServerName] {
			continue
		}
		seen[m.ServerName] = true
		out = append(out, m.ServerName)
	}
	return out
}

// fgUserGroupRaw is one user/group object as FortiOS returns it.
type fgUserGroupRaw struct {
	Name      string   `json:"name"`
	GroupType string   `json:"group-type"`
	Member    []FGName `json:"member"`
	Match     []struct {
		ServerName string `json:"server-name"`
		GroupName  string `json:"group-name"`
	} `json:"match"`
	SSOAttributeValue string `json:"sso-attribute-value"`
	MultipleGuestAdd  string `json:"multiple-guest-add"`
	UserID            string `json:"user-id"`
	MaxAccounts       int    `json:"max-accounts"`
	UserName          string `json:"user-name"`
	Email             string `json:"email"`
	MobilePhone       string `json:"mobile-phone"`
	SMSServer         string `json:"sms-server"`
	SMSCustomServer   string `json:"sms-custom-server"`
	Password          string `json:"password"`
	Sponsor           string `json:"sponsor"`
	Company           string `json:"company"`
	ExpireType        string `json:"expire-type"`
	Expire            int    `json:"expire"`
}

func (r fgUserGroupRaw) toForm() FGUserGroupForm {
	matches := make([]FGUserGroupMatch, 0, len(r.Match))
	for _, m := range r.Match {
		matches = append(matches, FGUserGroupMatch{ServerName: m.ServerName, GroupName: m.GroupName})
	}
	return FGUserGroupForm{
		Name:              r.Name,
		GroupType:         r.GroupType,
		Members:           FGNamesToStrings(r.Member),
		Matches:           matches,
		SSOAttributeValue: r.SSOAttributeValue,
		MultipleGuestAdd:  FGStringToBool(r.MultipleGuestAdd),
		UserID:            r.UserID,
		MaxAccounts:       r.MaxAccounts,
		UserName:          FGStringToBool(r.UserName),
		Email:             FGStringToBool(r.Email),
		MobilePhone:       FGStringToBool(r.MobilePhone),
		SMSServer:         r.SMSServer,
		SMSCustomServer:   r.SMSCustomServer,
		Password:          r.Password,
		Sponsor:           r.Sponsor,
		Company:           r.Company,
		ExpireType:        r.ExpireType,
		Expire:            r.Expire,
	}
}

// GetUserGroup fetches one user/group for the edit form.
func (f *FortiClient) GetUserGroup(name string) (*FGUserGroupForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/group/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var rows []fgUserGroupRaw
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse user group: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("user group %q not found", name)
	}
	form := rows[0].toForm()
	return &form, nil
}

func (f *FortiClient) CreateUserGroup(form FGUserGroupForm) error {
	err := userGroupTable.Create(f, buildUserGroupPayload(form))
	if err != nil {
		return fmt.Errorf("failed to create user group %q: %w", form.Name, err)
	}
	return nil
}

// UpdateUserGroup edits an existing group, keyed by its CURRENT name. A form carrying a
// different Name renames the group (FortiOS accepts the rename on PUT and returns the new mkey).
func (f *FortiClient) UpdateUserGroup(name string, form FGUserGroupForm) error {
	err := userGroupTable.Update(f, name, buildUserGroupPayload(form))
	if err != nil {
		return fmt.Errorf("failed to update user group %q: %w", name, err)
	}
	return nil
}

// DeleteUserGroup removes one group BY MKEY. The collection URL is never used for DELETE —
// that wipes the whole table on this device (see the project's hard-won rule).
func (f *FortiClient) DeleteUserGroup(name string) error {
	if err := userGroupTable.Delete(f, name); err != nil {
		return fmt.Errorf("failed to delete user group %q: %w", name, err)
	}
	return nil
}

// ── User Group member options (the GUI's "Select Entries" panel) ──────────────

// FGMemberOption is one selectable member, tagged with the table it came from so the
// picker can group entries the way the FortiGate dialog does (USER › Local, …).
type FGMemberOption struct {
	Name   string `json:"name"`
	Source string `json:"source"` // Local | RADIUS | TACACS+ | LDAP | PKI | POP3 | SAML | FSSO
}

// FGUserGroupOptions is everything the New/Edit User Group form needs to populate its pickers.
type FGUserGroupOptions struct {
	Firewall   []FGMemberOption `json:"firewall"`    // members valid for a Firewall group
	FSSO       []FGMemberOption `json:"fsso"`        // members valid for an FSSO group (user/adgrp)
	SMSServers []string         `json:"sms_servers"` // system/sms-server names (Enable SMS → custom)
}

// userMemberSources are the user/* tables a Firewall group can draw members from, in the order
// the GUI lists them. Verified against the member.name datasource in user/group?action=schema.
var userMemberSources = []struct{ path, label string }{
	{"local", "Local"},
	{"radius", "RADIUS"},
	{"tacacs+", "TACACS+"},
	{"ldap", "LDAP"},
	{"peer", "PKI"},
	{"pop3", "POP3"},
	{"saml", "SAML"},
	{"certificate", "Certificate"},
}

// GetUserGroupOptions collects every selectable member plus the SMS server list. Each table is
// best-effort: a model that doesn't implement one (or an empty table) contributes nothing rather
// than failing the whole form.
func (f *FortiClient) GetUserGroupOptions() FGUserGroupOptions {
	opts := FGUserGroupOptions{
		Firewall:   []FGMemberOption{},
		FSSO:       []FGMemberOption{},
		SMSServers: []string{},
	}
	for _, src := range userMemberSources {
		names, err := f.fetchNames("/api/v2/cmdb/user/" + url.PathEscape(src.path))
		if err != nil {
			continue
		}
		for _, n := range names {
			opts.Firewall = append(opts.Firewall, FGMemberOption{Name: n.Name, Source: src.label})
		}
	}
	if names, err := f.fetchNames("/api/v2/cmdb/user/adgrp"); err == nil {
		for _, n := range names {
			opts.FSSO = append(opts.FSSO, FGMemberOption{Name: n.Name, Source: "FSSO"})
		}
	}
	if names, err := f.fetchNames("/api/v2/cmdb/system/sms-server"); err == nil {
		for _, n := range names {
			opts.SMSServers = append(opts.SMSServers, n.Name)
		}
	}
	return opts
}

// userLocalTypeLabel maps the user/local "type" to the GUI's Type column label.
func userLocalTypeLabel(t string) string {
	switch strings.ToLower(t) {
	case "password":
		return "LOCAL"
	case "radius":
		return "RADIUS"
	case "tacacs+":
		return "TACACS+"
	case "ldap":
		return "LDAP"
	}
	return strings.ToUpper(t)
}

// localUserTwoFactorOn reports whether a user has two-factor auth on — the GUI's
// "Two-factor Authentication" column.
//
// ⚠️ user/local's two-factor is NOT an enable/disable flag: the schema's values are
// disable | fortitoken | fortitoken-cloud | email | sms. Running it through FGStringToBool
// (which only tests for "enable") reports every 2FA user as OFF.
func localUserTwoFactorOn(v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	return v != "" && v != "disable"
}

// userGroupTypeLabel maps user/group "group-type" to the GUI's Group Type label.
func userGroupTypeLabel(t string) string {
	switch strings.ToLower(t) {
	case "firewall":
		return "Firewall"
	case "fsso-service":
		return "Fortinet Single Sign-On (FSSO)"
	case "rsso":
		return "RADIUS Single Sign-On (RSSO)"
	case "guest":
		return "Guest"
	}
	return t
}

// GetUserGroups fetches user/group objects (name, type label, members, reference count) for
// the "User Groups" list. with_meta=1 surfaces q_ref, the reference count the GUI's Ref column shows.
func (f *FortiClient) GetUserGroups() ([]FGUserGroup, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/group?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name      string `json:"name"`
		GroupType string `json:"group-type"`
		Member    []struct {
			Name string `json:"name"`
		} `json:"member"`
		Ref int `json:"q_ref"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse user groups: %w", err)
	}
	out := make([]FGUserGroup, 0, len(rows))
	for _, g := range rows {
		members := make([]string, 0, len(g.Member))
		for _, m := range g.Member {
			members = append(members, m.Name)
		}
		out = append(out, FGUserGroup{
			Name:      g.Name,
			GroupType: userGroupTypeLabel(g.GroupType),
			TypeCode:  g.GroupType,
			Members:   members,
			Ref:       g.Ref,
		})
	}
	return out, nil
}

// GetLocalUsers fetches user/local objects plus the derived Groups column (built from
// user/group membership) and the reference count — everything the "User Definition" list shows.
func (f *FortiClient) GetLocalUsers() ([]FGUserDefinition, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/user/local?with_meta=1", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name      string `json:"name"`
		Type      string `json:"type"`
		Status    string `json:"status"`
		TwoFactor string `json:"two-factor"`
		Ref       int    `json:"q_ref"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse local users: %w", err)
	}

	// Build user→groups map (best-effort: a group-fetch error just leaves Groups empty).
	userGroups := map[string][]string{}
	if groups, gerr := f.GetUserGroups(); gerr == nil {
		for _, g := range groups {
			for _, m := range g.Members {
				userGroups[m] = append(userGroups[m], g.Name)
			}
		}
	}

	out := make([]FGUserDefinition, 0, len(rows))
	for _, u := range rows {
		groups := userGroups[u.Name]
		if groups == nil {
			groups = []string{}
		}
		out = append(out, FGUserDefinition{
			Name:      u.Name,
			Type:      userLocalTypeLabel(u.Type),
			TwoFactor: localUserTwoFactorOn(u.TwoFactor),
			Groups:    groups,
			Enabled:   FGStringToBool(u.Status),
			Ref:       u.Ref,
		})
	}
	return out, nil
}

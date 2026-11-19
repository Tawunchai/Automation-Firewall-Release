package services

import (
	"encoding/json"
	"fmt"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var adminTable = cmdbPath{path: "system/admin", noun: "administrator"}

// System ▸ Administrators (system/admin + system/accprofile) — who may log in to the firewall.
//
// These are the FIREWALL's accounts, not this console's. The console's own users live in Postgres
// and are managed under Security ▸ Users; an account here can log in to the device directly, over
// HTTPS or SSH, with no involvement from this application at all. The page says so, because the two
// lists look alike and confusing them means granting the wrong access.
//
// Schema read live off FortiGate 7.2.10 (FGT80E): system/admin has 53 fields, mkey `name`;
// system/accprofile has 23, mkey `name`.
//
// ── The traps ────────────────────────────────────────────────────────────────
//
// **`0.0.0.0 0.0.0.0` in a trusted-host slot means ANY HOST, not "empty".** Every unused slot holds
// it, so an account with ten of them is reachable from anywhere. Reading it as "not configured" —
// which is what the field name suggests — turns the most permissive possible setting into a blank.
// audit_system.go already learned this one; the constant lives there and is reused.
//
// **A trusted host on the wrong account locks that account out immediately, with no warning.** Same
// family as the local-in policy, and handled the same way: the caller has to acknowledge it.
//
// **`accprofile` is a REFERENCE, and `super_admin` is the one that cannot be weakened.** An account
// on super_admin can do anything including deleting other administrators, so changing the profile
// of the last super_admin is how an operator ends up with a firewall nobody can fully administer.
//
// **The password field is write-only.** A read never returns it — not even a hash — so an edit that
// re-sends the whole object without one must OMIT the key rather than send an empty string, or the
// account's password is replaced with nothing. That is the single most dangerous line in this file.

// FGAdminUser is one administrator account.
type FGAdminUser struct {
	Name string `json:"name"`
	// AccProfile is the access profile's name — the permission set.
	AccProfile string `json:"accprofile"`
	// Comments is the device's own free text on the account.
	Comments string `json:"comments"`
	// TrustHosts are the slots that are NOT 0.0.0.0 0.0.0.0. An empty list therefore means "from
	// anywhere", which is the opposite of what an empty list usually means — see RestrictedToHosts.
	TrustHosts []string `json:"trust_hosts"`
	// RestrictedToHosts is false when the account can log in from any address. Carried explicitly
	// so the UI never has to infer it from an empty list.
	RestrictedToHosts bool `json:"restricted_to_hosts"`
	// TwoFactor is a METHOD name, not a boolean — `disable`, `fortitoken`, `email`, `sms`.
	// (fortios-localuser-crud learned the same thing about user/local.)
	TwoFactor   string   `json:"two_factor"`
	RemoteAuth  bool     `json:"remote_auth"`
	RemoteGroup string   `json:"remote_group"`
	VDOMs       []string `json:"vdoms"`
	// SSHPublicKeySet reports whether a key is present without returning it.
	SSHPublicKeySet bool `json:"ssh_public_key_set"`
	// IsSuperAdmin is a convenience the UI leans on in several places.
	IsSuperAdmin bool `json:"is_super_admin"`
}

// FGAccProfile is one access profile, summarised.
//
// The individual permission groups are read but not edited here: an access profile is thirteen
// permission axes plus five sub-permission tables, and a half-built editor for it would produce
// profiles whose real permissions differ from what the form showed. The list exists so an
// administrator can be given a profile and so the page can say what that profile allows.
type FGAccProfile struct {
	Name     string `json:"name"`
	Scope    string `json:"scope"`
	Comments string `json:"comments"`
	// Permissions maps the FortiOS group name to none | read | read-write | custom.
	Permissions map[string]string `json:"permissions"`
	// WriteGroups is the subset that has read-write or custom — the short answer to "what can this
	// profile change".
	WriteGroups  []string `json:"write_groups"`
	IsSuperAdmin bool     `json:"is_super_admin"`
}

type fgAdminRaw struct {
	Name          string `json:"name"`
	AccProfile    string `json:"accprofile"`
	Comments      string `json:"comments"`
	TwoFactor     string `json:"two-factor"`
	RemoteAuth    string `json:"remote-auth"`
	RemoteGroup   string `json:"remote-group"`
	SSHPublicKey1 string `json:"ssh-public-key1"`
	VDOM          []struct {
		Name string `json:"name"`
	} `json:"vdom"`
	TrustHost1  string `json:"trusthost1"`
	TrustHost2  string `json:"trusthost2"`
	TrustHost3  string `json:"trusthost3"`
	TrustHost4  string `json:"trusthost4"`
	TrustHost5  string `json:"trusthost5"`
	TrustHost6  string `json:"trusthost6"`
	TrustHost7  string `json:"trusthost7"`
	TrustHost8  string `json:"trusthost8"`
	TrustHost9  string `json:"trusthost9"`
	TrustHost10 string `json:"trusthost10"`
}

func (r fgAdminRaw) toGUI() FGAdminUser {
	a := FGAdminUser{
		Name:            r.Name,
		AccProfile:      r.AccProfile,
		Comments:        r.Comments,
		TwoFactor:       r.TwoFactor,
		RemoteAuth:      isOn(r.RemoteAuth),
		RemoteGroup:     r.RemoteGroup,
		SSHPublicKeySet: strings.TrimSpace(r.SSHPublicKey1) != "",
		IsSuperAdmin:    r.AccProfile == "super_admin",
		TrustHosts:      []string{},
		VDOMs:           []string{},
	}
	for _, v := range r.VDOM {
		if v.Name != "" {
			a.VDOMs = append(a.VDOMs, v.Name)
		}
	}
	// anyTrustHost is FortiOS's "any host", NOT "unset". See the trap above.
	for _, h := range []string{
		r.TrustHost1, r.TrustHost2, r.TrustHost3, r.TrustHost4, r.TrustHost5,
		r.TrustHost6, r.TrustHost7, r.TrustHost8, r.TrustHost9, r.TrustHost10,
	} {
		h = strings.TrimSpace(h)
		if h == "" || h == anyTrustHost {
			continue
		}
		a.TrustHosts = append(a.TrustHosts, h)
	}
	a.RestrictedToHosts = len(a.TrustHosts) > 0
	return a
}

// FGAdminWrite is a create or an edit.
//
// Password is a POINTER because "leave it alone" and "set it to empty" have to be different things.
// A nil password omits the key entirely; the device then keeps the existing one. An empty string
// would REPLACE the password with nothing, which is why this is not a plain string.
type FGAdminWrite struct {
	Name        string
	Password    *string
	AccProfile  string
	Comments    string
	TrustHosts  []string
	TwoFactor   string
	RemoteAuth  bool
	RemoteGroup string
	VDOMs       []string
}

func adminPayload(w FGAdminWrite) map[string]any {
	body := map[string]any{
		"name":       w.Name,
		"accprofile": w.AccProfile,
		"comments":   w.Comments,
	}
	if w.Password != nil {
		body["password"] = *w.Password
	}
	if w.TwoFactor != "" {
		body["two-factor"] = w.TwoFactor
	}
	if w.RemoteAuth {
		body["remote-auth"] = "enable"
		if w.RemoteGroup != "" {
			body["remote-group"] = w.RemoteGroup
		}
	} else {
		body["remote-auth"] = "disable"
	}
	if len(w.VDOMs) > 0 {
		body["vdom"] = toMembers(w.VDOMs)
	}

	// All ten slots are written every time, the unused ones back to "any host". Writing only the
	// slots in use would leave a trusted host the operator had just removed still in force — the
	// account would keep a restriction the screen says is gone.
	for i := 1; i <= 10; i++ {
		v := anyTrustHost
		if i <= len(w.TrustHosts) {
			if h := strings.TrimSpace(w.TrustHosts[i-1]); h != "" {
				v = h
			}
		}
		body[fmt.Sprintf("trusthost%d", i)] = v
	}
	return body
}

// ── The lockout check ────────────────────────────────────────────────────────

// AdminChangeLocksOut reports whether an edit would shut the operator out of this account.
//
// Two shapes do it, and both are accepted by FortiOS without comment:
//
//	· adding trusted hosts to an account — every address except those listed stops being able to
//	  log in, and the person making the change is usually at one of the addresses NOT listed
//	· moving the last super_admin onto a weaker profile — the firewall then has no account that can
//	  administer it fully, and no way to make one
//
// `currentTrustHosts` is what the account has now; empty means it is reachable from anywhere.
// A change that only REMOVES restrictions can never lock anybody out and is not flagged.
func AdminChangeLocksOut(currentTrustHosts, newTrustHosts []string) bool {
	// Going from "anywhere" to a list is the dangerous direction.
	if len(currentTrustHosts) == 0 && len(newTrustHosts) > 0 {
		return true
	}
	// Narrowing an existing list: any host that was allowed and no longer is.
	if len(currentTrustHosts) > 0 && len(newTrustHosts) > 0 {
		next := map[string]bool{}
		for _, h := range newTrustHosts {
			next[strings.TrimSpace(h)] = true
		}
		for _, h := range currentTrustHosts {
			if !next[strings.TrimSpace(h)] {
				return true
			}
		}
	}
	return false
}

// LastSuperAdmin reports whether `name` is the only account left on super_admin.
//
// Used for two refusals — deleting it, and moving it to another profile — because both leave the
// firewall with nobody who can fully administer it.
func LastSuperAdmin(admins []FGAdminUser, name string) bool {
	found := false
	others := 0
	for _, a := range admins {
		if !a.IsSuperAdmin {
			continue
		}
		if a.Name == name {
			found = true
			continue
		}
		others++
	}
	return found && others == 0
}

func (f *FortiClient) GetAdminUsers() ([]FGAdminUser, error) {
	raw, err := cmdbRaws[fgAdminRaw](f, adminTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGAdminUser, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

func (f *FortiClient) CreateAdminUser(w FGAdminWrite) error {
	return adminTable.Create(f, adminPayload(w))
}

func (f *FortiClient) UpdateAdminUser(name string, w FGAdminWrite) error {
	return adminTable.Update(f, name, adminPayload(w))
}

// DeleteAdminUser removes one account BY NAME. Never a collection URL.
func (f *FortiClient) DeleteAdminUser(name string) error {
	return adminTable.Delete(f, name)
}

// ── Access profiles ──────────────────────────────────────────────────────────

// permissionGroups are the accprofile fields that carry a permission level, with the plain-language
// name for each. FortiOS's own abbreviations are unreadable outside its CLI.
var permissionGroups = []struct{ Field, Label string }{
	{"fwgrp", "Policy & Objects"},
	{"netgrp", "Network"},
	{"sysgrp", "System"},
	{"loggrp", "Log & Report"},
	{"utmgrp", "Security Profiles"},
	{"vpngrp", "VPN"},
	{"authgrp", "User & Authentication"},
	{"secfabgrp", "Security Fabric"},
	{"ftviewgrp", "FortiView"},
	{"wifi", "WiFi"},
}

func (f *FortiClient) GetAccProfiles() ([]FGAccProfile, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/accprofile", nil)
	if err != nil {
		return nil, err
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse access profiles: %w", err)
	}
	str := func(m map[string]json.RawMessage, key string) string {
		v, ok := m[key]
		if !ok {
			return ""
		}
		var s string
		_ = json.Unmarshal(v, &s)
		return strings.TrimSpace(s)
	}

	out := make([]FGAccProfile, 0, len(raw))
	for _, m := range raw {
		p := FGAccProfile{
			Name:        str(m, "name"),
			Scope:       str(m, "scope"),
			Comments:    str(m, "comments"),
			Permissions: map[string]string{},
			WriteGroups: []string{},
		}
		p.IsSuperAdmin = p.Name == "super_admin"
		for _, g := range permissionGroups {
			level := str(m, g.Field)
			if level == "" {
				level = "none"
			}
			p.Permissions[g.Label] = level
			if level == "read-write" || level == "custom" {
				p.WriteGroups = append(p.WriteGroups, g.Label)
			}
		}
		// super_admin does not spell its permissions out — it has all of them, and every group
		// reads as `none` on the wire. Reporting that literally would describe the most powerful
		// profile on the device as the least.
		if p.IsSuperAdmin {
			p.WriteGroups = nil
			for _, g := range permissionGroups {
				p.Permissions[g.Label] = "read-write"
				p.WriteGroups = append(p.WriteGroups, g.Label)
			}
		}
		out = append(out, p)
	}
	return out, nil
}

package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// System ▸ Administrators.
//
// Writes to the thing that decides whether anybody can reach the firewall at all, so it refuses
// the dangerous shape until the caller says they mean it — the same arrangement as the local-in
// policy in device_localin.go.

// ── Administrators ───────────────────────────────────────────────────────────

type adminInput struct {
	Name string `json:"name"`
	// Password is a POINTER on the wire too: absent means "leave it alone", which is what an edit
	// that did not touch the password field sends. An empty string would clear it.
	Password    *string  `json:"password"`
	AccProfile  string   `json:"accprofile"`
	Comments    string   `json:"comments"`
	TrustHosts  []string `json:"trust_hosts"`
	TwoFactor   string   `json:"two_factor"`
	RemoteAuth  bool     `json:"remote_auth"`
	RemoteGroup string   `json:"remote_group"`
	VDOMs       []string `json:"vdoms"`
	// ConfirmLockout is the caller acknowledging that this change can shut them out.
	ConfirmLockout bool `json:"confirm_lockout"`
}

func adminInputToWrite(inp adminInput) services.FGAdminWrite {
	return services.FGAdminWrite{
		Name:        strings.TrimSpace(inp.Name),
		Password:    inp.Password,
		AccProfile:  strings.TrimSpace(inp.AccProfile),
		Comments:    strings.TrimSpace(inp.Comments),
		TrustHosts:  nonEmpty(inp.TrustHosts),
		TwoFactor:   inp.TwoFactor,
		RemoteAuth:  inp.RemoteAuth,
		RemoteGroup: strings.TrimSpace(inp.RemoteGroup),
		VDOMs:       nonEmpty(inp.VDOMs),
	}
}

func validateAdmin(inp adminInput, creating bool) string {
	if strings.TrimSpace(inp.Name) == "" {
		return "an account name is required"
	}
	if strings.TrimSpace(inp.AccProfile) == "" {
		return "choose an access profile — it is what the account is allowed to do"
	}
	if creating && !inp.RemoteAuth && (inp.Password == nil || *inp.Password == "") {
		return "a new local account needs a password"
	}
	if inp.RemoteAuth && strings.TrimSpace(inp.RemoteGroup) == "" {
		return "a remotely authenticated account needs the remote group it belongs to"
	}
	for _, h := range nonEmpty(inp.TrustHosts) {
		// FortiOS wants "address mask" or CIDR here. A bare word is accepted into the field and
		// then never matches anything, which locks the account out silently.
		if !strings.Contains(h, "/") && len(strings.Fields(h)) != 2 {
			return "trusted host \"" + h + "\" must be a subnet — 10.0.0.0/24 or 10.0.0.0 255.255.255.0"
		}
	}
	return ""
}

// GET /policy/device/:deviceId/admin-users
//
// Admin-only, unlike every other device READ in this package. The list names the accounts that can
// administer the firewall, which addresses they may connect from and which of them have no second
// factor — a map of where to attack the device, handed to anybody with a console login. Reading a
// policy table tells you what the firewall does; reading this tells you how to take it over.
func DeviceListAdminUsers(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	admins, err := fc.GetAdminUsers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	profiles, pErr := fc.GetAccProfiles()
	if pErr != nil {
		profiles = []services.FGAccProfile{}
	}
	c.JSON(http.StatusOK, gin.H{
		"admins":            admins,
		"profiles":          profiles,
		"profiles_readable": pErr == nil,
	})
}

// POST /policy/device/:deviceId/admin-users
func DeviceCreateAdminUser(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp adminInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateAdmin(inp, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// A NEW account cannot lock anybody out — it grants access rather than removing it — so there
	// is no confirmation here.
	if err := fc.CreateAdminUser(adminInputToWrite(inp)); err != nil {
		respondDeviceError(c, err, "administrator")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "administrator created on device"})
}

// PATCH /policy/device/:deviceId/admin-users/:name
func DeviceUpdateAdminUser(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	var inp adminInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if inp.Name == "" {
		inp.Name = name
	}
	if msg := validateAdmin(inp, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	admins, err := fc.GetAdminUsers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var current *services.FGAdminUser
	for i := range admins {
		if admins[i].Name == name {
			current = &admins[i]
			break
		}
	}
	if current == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no administrator called " + name + " on this device"})
		return
	}

	// Moving the last super_admin onto a weaker profile leaves the firewall with nobody who can
	// fully administer it, and nobody able to put it back. Refused outright — this one has no
	// override, because there is no situation where it is what somebody meant.
	if current.IsSuperAdmin && inp.AccProfile != "super_admin" && services.LastSuperAdmin(admins, name) {
		c.JSON(http.StatusConflict, gin.H{
			"error": name + " is the only account with the super_admin profile. Moving it to " +
				inp.AccProfile + " would leave this firewall with no account that can fully " +
				"administer it, and no way to make one. Create another super_admin first.",
		})
		return
	}

	if services.AdminChangeLocksOut(current.TrustHosts, nonEmpty(inp.TrustHosts)) && !inp.ConfirmLockout {
		c.JSON(http.StatusConflict, gin.H{
			"error": "This restricts " + name + " to " + strings.Join(nonEmpty(inp.TrustHosts), ", ") +
				". Every other address — including the one you are connected from, unless it is in " +
				"that list — stops being able to log in as this account, and the firewall applies it " +
				"immediately. Re-send with confirm_lockout if this is what you intend.",
			"needs_lockout_confirmation": true,
		})
		return
	}

	if err := fc.UpdateAdminUser(name, adminInputToWrite(inp)); err != nil {
		respondDeviceError(c, err, "administrator")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "administrator updated on device"})
}

// DELETE /policy/device/:deviceId/admin-users/:name
func DeviceDeleteAdminUser(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	admins, err := fc.GetAdminUsers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if services.LastSuperAdmin(admins, name) {
		c.JSON(http.StatusConflict, gin.H{
			"error": name + " is the only account with the super_admin profile. Deleting it would " +
				"leave this firewall with no full administrator. Create another one first.",
		})
		return
	}

	if err := fc.DeleteAdminUser(name); err != nil {
		// -14: the account has a live session. FortiOS refuses the delete with a CLI-level message
		// ("Cannot delete admin while 'x' is logged in!") that says what happened but not what to do
		// about it, and the answer — wait for admintimeout, or have them log out — is not obvious
		// from the number. Confirmed live on the FGT80E, whose admintimeout is 5 minutes.
		if code, ok := services.DeviceErrorCode(err); ok && code == -14 {
			c.JSON(http.StatusConflict, gin.H{
				"error": name + " is logged in to the firewall right now, and FortiOS will not " +
					"delete an account with a live session. Wait for it to be signed out — this " +
					"device times an idle session out after its admintimeout — or have them log " +
					"out, then try again.",
			})
			return
		}
		respondDeviceError(c, err, "administrator")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "administrator deleted from device"})
}

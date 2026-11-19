// Package deviceaccess is the admin side of "which firewalls may this person work on".
//
// Every route here is admin-only, and deliberately so: this is the table that decides what everyone
// else can reach, so an endpoint a non-admin could call would be the escalation the feature exists
// to prevent. The read side of the same data — "which devices do *I* have" — needs no endpoint at
// all, because GET /devices is already filtered to the caller.
package deviceaccess

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

func isAdmin(c *gin.Context) bool { return c.GetString("user_role") == "admin" }

func requireAdmin(c *gin.Context) bool {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

func pathUserID(c *gin.Context) (uint, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return 0, false
	}
	return uint(id), true
}

// deviceOption is one row of the picker: every device in the inventory, with whether this user
// holds it.
type deviceOption struct {
	ID      uint   `json:"id"`
	Name    string `json:"name"`
	MgmtIP  string `json:"mgmt_ip"`
	Vendor  string `json:"vendor"`
	Site    string `json:"site"`
	Status  string `json:"status"`
	Granted bool   `json:"granted"`
	// HasCredential says whether the user has mapped their OWN account on this device yet. The two
	// halves are independent — access without a credential still works, falling back to the shared
	// device account — but an admin granting access wants to see which people have finished the
	// job, because that is the difference between the firewall's log naming them and naming
	// `admin`.
	HasCredential bool `json:"has_credential"`
}

// GET /users/:id/devices — the picker for one user.
//
// Returns EVERY device with a granted flag rather than only the granted ones, because the caller is
// a checkbox list and would otherwise have to fetch the inventory separately and join it in the
// browser — where the two lists can disagree.
func ListForUser(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	uid, ok := pathUserID(c)
	if !ok {
		return
	}

	db := config.DB()
	var target entity.AppUser
	if err := db.First(&target, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var devices []entity.NetworkDevice
	if err := db.Order("name ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the device inventory"})
		return
	}

	grantedIDs, err := services.AccessibleDeviceIDs(db, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read this user's device access"})
		return
	}
	granted := make(map[uint]bool, len(grantedIDs))
	for _, id := range grantedIDs {
		granted[id] = true
	}

	credDeviceIDs := []uint{}
	db.Model(&entity.DeviceCredential{}).Where("app_user_id = ?", uid).Pluck("network_device_id", &credDeviceIDs)
	hasCred := make(map[uint]bool, len(credDeviceIDs))
	for _, id := range credDeviceIDs {
		hasCred[id] = true
	}

	out := make([]deviceOption, 0, len(devices))
	for _, d := range devices {
		out = append(out, deviceOption{
			ID: d.ID, Name: d.Name, MgmtIP: d.MgmtIP, Vendor: d.Vendor,
			Site: d.Site, Status: d.Status,
			Granted: granted[d.ID], HasCredential: hasCred[d.ID],
		})
	}

	// The role travels with the list so the dialog can say "this user is an admin and reaches every
	// device regardless" instead of showing checkboxes that change nothing.
	role := ""
	var appRole entity.AppRole
	if db.First(&appRole, target.AppRoleID).Error == nil {
		role = appRole.Role
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":    uid,
		"user_email": target.Email,
		"role":       role,
		"devices":    out,
	})
}

type setInput struct {
	DeviceIDs []uint `json:"device_ids"`
}

// PUT /users/:id/devices — replace this user's grants with exactly the given list.
//
// A full replacement rather than add/remove endpoints: the UI is a set of checkboxes, and sending
// the set it is displaying is the only way the result cannot depend on what happened between the
// GET and the save.
func SetForUser(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	uid, ok := pathUserID(c)
	if !ok {
		return
	}

	var in setInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	db := config.DB()
	var target entity.AppUser
	if err := db.First(&target, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	granter, _ := c.Get("user_id")
	if err := services.SetUserDeviceAccess(db, uid, in.DeviceIDs, services.UserIDOf(granter)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ids, _ := services.AccessibleDeviceIDs(db, uid)
	c.JSON(http.StatusOK, gin.H{
		"user_id":    uid,
		"device_ids": ids,
		"message":    "device access updated",
	})
}

// GET /users/device-access/summary — app_user_id → granted count, for the Users table.
func Summary(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	counts, err := services.CountGrantsByUser(config.DB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read device access"})
		return
	}

	var total int64
	config.DB().Model(&entity.NetworkDevice{}).Count(&total)

	// JSON object keys must be strings; the browser turns them back into numbers.
	out := make(map[string]int, len(counts))
	for uid, n := range counts {
		out[strconv.FormatUint(uint64(uid), 10)] = n
	}
	c.JSON(http.StatusOK, gin.H{"counts": out, "device_total": total})
}

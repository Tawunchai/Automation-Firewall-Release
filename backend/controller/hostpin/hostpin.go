// Package hostpin lets an administrator see and clear the identities this console has pinned for
// its firewalls — SSH host keys and HTTPS certificates.
//
// It has no UI. System ▸ Device Identities was removed on 2026-11-19 at the owner's request as a
// page no user needs to read; these two endpoints were deliberately kept, because the lockout they
// undo is still possible and the alternative is psql. The recipe for using them from a terminal is
// in the comment above their routes in routes/routes_app.go.
//
// It exists because both pinning rules refuse a changed identity every time, with no "accept and
// re-pin" branch, and that is deliberate: whoever can present a key once can present it
// repeatedly, so accepting the new one would make the check decorative. The consequence is that a
// LEGITIMATE change — a firmware upgrade that regenerated the host key, a replaced or expired
// HTTPS certificate — also refuses, permanently, until somebody says otherwise.
//
// Without this, saying otherwise meant a psql session against the console's own database. Shipping
// a lock with no key is how a security control ends up disabled in a hurry at the worst moment, so
// clearing a pin is a first-class, admin-only, recorded action.
//
// What it deliberately does NOT offer: no "update this pin to what the device is showing now".
// That is the same decorative check by a different route. Clearing a pin means the NEXT connection
// re-pins whatever answers, which is a decision an administrator takes after comparing the
// fingerprint on the device's own console — the thing that has always been meant by verifying a
// host key.
package hostpin

import (
	"net/http"
	"strconv"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// requireAdmin gates every handler here.
//
// Admin only, and strictly: a pinned identity is the thing standing between an operator's device
// password and whatever answered on the network. An operator who could clear a pin could clear it,
// stand in the path, and be pinned in the firewall's place — which is the whole attack these
// tables prevent.
func requireAdmin(c *gin.Context) bool {
	if role, _ := c.Get("user_role"); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

// List returns every pinned identity, SSH and TLS together.
//
// GET /host-pins
//
// One call for both, because the question an administrator has is about a DEVICE ("what does this
// console believe 10.10.20.90 is?") and the answer spans two tables. A device may well appear
// several times: once per SSH key algorithm it offers, and once for its HTTPS certificate.
func List(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}
	db := config.DB()

	var ssh []entity.SSHHostKey
	if err := db.Order("host asc, key_type asc").Find(&ssh).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the pinned SSH host keys"})
		return
	}
	var tls []entity.DeviceTLSPin
	if err := db.Order("host asc").Find(&tls).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the pinned certificates"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ssh_host_keys": ssh, "tls_certificates": tls})
}

// Delete clears one pinned identity, so the next connection pins whatever the device presents.
//
// DELETE /host-pins/:kind/:id   — kind is "ssh" or "tls"
//
// Keyed by row id and not by host: a host can hold several SSH pins (one per algorithm), and
// clearing "the pin for 10.10.20.90" would be ambiguous in exactly the case that matters.
func Delete(c *gin.Context) {
	if !requireAdmin(c) {
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a numeric pin id is required"})
		return
	}
	db := config.DB()

	// Hard deletes, not soft. A soft-deleted row would stay invisible to the checks (both look up
	// under GORM's default scope) while keeping the unique index occupied, so the next connection
	// would fail to pin with a unique violation instead of remembering the new identity — the
	// clear would appear to work and the device would then be unreachable for a different reason.
	var (
		res     *gin.H
		deleted int64
	)
	switch c.Param("kind") {
	case "ssh":
		var row entity.SSHHostKey
		if db.First(&row, id).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no such pinned SSH host key"})
			return
		}
		tx := db.Unscoped().Delete(&entity.SSHHostKey{}, id)
		if tx.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear the pinned host key"})
			return
		}
		deleted = tx.RowsAffected
		res = &gin.H{"cleared": "ssh", "host": row.Host, "key_type": row.KeyType,
			"fingerprint": row.Fingerprint}

	case "tls":
		var row entity.DeviceTLSPin
		if db.First(&row, id).Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no such pinned certificate"})
			return
		}
		tx := db.Unscoped().Delete(&entity.DeviceTLSPin{}, id)
		if tx.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear the pinned certificate"})
			return
		}
		deleted = tx.RowsAffected
		res = &gin.H{"cleared": "tls", "host": row.Host, "fingerprint": row.Fingerprint}

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": `kind must be "ssh" or "tls"`})
		return
	}

	if deleted == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "nothing was cleared"})
		return
	}

	// Recorded against the administrator who did it, in the same log as every other action in this
	// console: clearing a pin is the moment the console agrees to trust something new, and an
	// unexplained re-pin six months later should be traceable to a person.
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(uint); ok {
			go services.LogActivity(config.DB(), id, "clear_host_pin")
		}
	}

	c.JSON(http.StatusOK, *res)
}

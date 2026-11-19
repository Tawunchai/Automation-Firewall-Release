package networkdevice

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

// Bulk device onboarding (Phase C4) — the same "loop over several, one result each" shape Fleet
// Apply (controller/policyobject/fleet_apply.go) uses for pushing an object to several devices,
// applied here to CREATING several device rows instead. A row that fails must not abort the rows
// after it — the whole point of a batch import is that one typo in a spreadsheet of fifty branches
// should not mean retyping the other forty-nine.
//
// This endpoint never opens a connection to any firewall — it only writes network_devices rows, the
// same as a single POST /devices repeated. Reaching a device for the first time (credentials,
// backup, compliance) still happens the existing way, one device at a time, after it is onboarded.

// maxBulkDevices bounds one import. Not a technical limit — GORM and Postgres would take a few
// thousand rows without blinking — but a request this size is far more likely to be a pasted file
// in the wrong format than someone meaning to import that many branches in one sitting.
const maxBulkDevices = 200

// bulkDeviceInput is one row. Platform is optional unlike createRequest's: a CSV paste of several
// FortiGates has no reason to repeat "fortinet" in two columns, so an empty Platform defaults to
// Vendor, which is what every Fortinet device in this console already carries as its platform.
type bulkDeviceInput struct {
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Platform string `json:"platform"`
	MgmtIP   string `json:"mgmt_ip"`
	Port     int    `json:"port"`
	APIPort  int    `json:"api_port"`
	Site     string `json:"site"`
	Role     string `json:"role"`
}

type bulkDeviceResult struct {
	// Row is 1-based, matching the line a CSV paste would show — "row 3 failed" is directly
	// readable against the textarea, "index 2" is not.
	Row      int    `json:"row"`
	Name     string `json:"name"`
	Status   string `json:"status"` // created | failed
	Message  string `json:"message,omitempty"`
	DeviceID uint   `json:"device_id,omitempty"`
}

// validateBulkRow checks one row against the rules a single POST /devices already enforces
// (name/vendor/mgmt_ip required), plus duplicate detection a single create has no reason to need:
// a batch can name the same device twice by mistake, which one row at a time never could.
//
// Pure — no database — so the decision is tested directly rather than through the handler. seenNames
// /seenIPs are the batch's own rows seen so far; dbNames/dbIPs are what already exists. Keys are
// lower-cased for names (FortiGate-80E and fortigate-80e are the same device to a human reading a
// spreadsheet) and used as-is for IPs (an IP has no case to normalise).
func validateBulkRow(row bulkDeviceInput, seenNames, seenIPs, dbNames, dbIPs map[string]bool) string {
	name := strings.TrimSpace(row.Name)
	vendor := strings.TrimSpace(row.Vendor)
	mgmtIP := strings.TrimSpace(row.MgmtIP)

	if name == "" {
		return "name is required"
	}
	if vendor == "" {
		return "vendor is required"
	}
	if mgmtIP == "" {
		return "mgmt_ip is required"
	}

	nameKey := strings.ToLower(name)
	if seenNames[nameKey] {
		return fmt.Sprintf("duplicate name %q elsewhere in this import", name)
	}
	if seenIPs[mgmtIP] {
		return fmt.Sprintf("duplicate mgmt_ip %q elsewhere in this import", mgmtIP)
	}
	if dbNames[nameKey] {
		return fmt.Sprintf("a device named %q already exists", name)
	}
	if dbIPs[mgmtIP] {
		return fmt.Sprintf("a device with mgmt_ip %q already exists", mgmtIP)
	}
	return ""
}

// POST /devices/bulk — admin only, same as POST /devices.
func BulkCreate(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}

	var rows []bulkDeviceInput
	if err := c.ShouldBindJSON(&rows); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(rows) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no devices to import"})
		return
	}
	if len(rows) > maxBulkDevices {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("too many devices in one import (max %d)", maxBulkDevices)})
		return
	}

	db := config.DB()

	var existing []entity.NetworkDevice
	if err := db.Select("name", "mgmt_ip").Find(&existing).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the existing device inventory"})
		return
	}
	dbNames := make(map[string]bool, len(existing))
	dbIPs := make(map[string]bool, len(existing))
	for _, d := range existing {
		dbNames[strings.ToLower(d.Name)] = true
		dbIPs[d.MgmtIP] = true
	}

	seenNames := map[string]bool{}
	seenIPs := map[string]bool{}
	out := make([]bulkDeviceResult, 0, len(rows))
	created := 0

	for i, row := range rows {
		res := bulkDeviceResult{Row: i + 1, Name: strings.TrimSpace(row.Name)}

		if msg := validateBulkRow(row, seenNames, seenIPs, dbNames, dbIPs); msg != "" {
			res.Status = "failed"
			res.Message = msg
			out = append(out, res)
			continue
		}

		name := strings.TrimSpace(row.Name)
		vendor := strings.TrimSpace(row.Vendor)
		mgmtIP := strings.TrimSpace(row.MgmtIP)
		platform := strings.TrimSpace(row.Platform)
		if platform == "" {
			platform = vendor
		}
		port := row.Port
		if port == 0 {
			port = 22
		}
		apiPort := row.APIPort
		if apiPort == 0 {
			apiPort = services.DefaultAPIPort
		}

		d := entity.NetworkDevice{
			Name: name, Vendor: vendor, Platform: platform,
			MgmtIP: mgmtIP, Port: port, APIPort: apiPort,
			Site: strings.TrimSpace(row.Site), Role: strings.TrimSpace(row.Role),
			Status: "active",
		}
		if err := db.Create(&d).Error; err != nil {
			res.Status = "failed"
			res.Message = "could not create this device"
			out = append(out, res)
			continue
		}

		// Seen-so-far, so a later row repeating this name/IP is caught too — validateBulkRow only
		// sees what has been added to these maps before it runs.
		seenNames[strings.ToLower(name)] = true
		seenIPs[mgmtIP] = true

		res.Status = "created"
		res.DeviceID = d.ID
		out = append(out, res)
		created++
	}

	if created > 0 {
		services.LogActivity(db, c.GetUint("user_id"), fmt.Sprintf(
			"device_bulk_create: %d of %d rows created", created, len(rows)))
	}

	c.JSON(http.StatusOK, gin.H{"data": out})
}

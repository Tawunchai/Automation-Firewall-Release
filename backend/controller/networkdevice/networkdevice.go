package networkdevice

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/jobs"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PingDevice ทดสอบว่าอุปกรณ์รับ TCP SSH ได้หรือไม่ (ไม่ต้อง login)
// GET /devices/:id/ping
func PingDevice(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var d entity.NetworkDevice
	if err := config.DB().First(&d, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	if !canReach(c, d.ID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	start := time.Now()
	err := services.CheckReachability(d.MgmtIP, d.Port, services.DefaultReachabilityTimeout)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"reachable":  false,
			"latency_ms": latency,
			"error":      err.Error(),
			"host":       d.MgmtIP,
			"port":       d.Port,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reachable":  true,
		"latency_ms": latency,
		"host":       d.MgmtIP,
		"port":       d.Port,
	})
}

// ── helpers ──────────────────────────────────────────────────────────────────

func isAdmin(c *gin.Context) bool {
	return c.GetString("user_role") == "admin"
}

type deviceResponse struct {
	ID       uint   `json:"id"`
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Platform string `json:"platform"`
	MgmtIP   string `json:"mgmt_ip"`
	Port     int    `json:"port"`
	APIPort  int    `json:"api_port"`
	Site     string `json:"site"`
	Role     string `json:"role"`
	Status   string `json:"status"`

	// AutomationAccount names the account unattended work (auto-backup, compliance, the alert
	// sweep) logs in with, so the Devices list can say whether a device HAS one — a schedule with
	// nothing to run as is the failure this replaced, and it used to be invisible.
	// Empty means nobody has nominated one. The password is never returned in any form.
	AutomationAccount string `json:"automation_account"`
	AutomationOwner   string `json:"automation_owner"`

	// AutomationState / AutomationWarning say whether unattended work can run at all.
	//
	// AutomationAccount above names WHICH account is used and reads the same whether it is a
	// nominated credential or the unmaintained login left on the device row — which is how a
	// deployment where no scheduled backup had ever succeeded still looked fine on this page.
	// These two say which of those it is, and what to do about it.
	AutomationState   string `json:"automation_state"`
	AutomationWarning string `json:"automation_warning,omitempty"`

	BackupEnabled bool       `json:"backup_enabled"`
	BackupCron    string     `json:"backup_cron"`
	NextBackupAt  *time.Time `json:"next_backup_at"`
	LastBackupAt  *time.Time `json:"last_backup_at"`
}

func toResponse(d entity.NetworkDevice) deviceResponse {
	return deviceResponse{
		ID: d.ID, Name: d.Name, Vendor: d.Vendor, Platform: d.Platform,
		MgmtIP: d.MgmtIP, Port: d.Port, APIPort: d.APIPort, Site: d.Site, Role: d.Role,
		Status:        d.Status,
		BackupEnabled: d.BackupEnabled, BackupCron: d.BackupCron,
		NextBackupAt: d.NextBackupAt, LastBackupAt: d.LastBackupAt,
	}
}

// toResponseFor is toResponse with the caller's role applied.
//
// Who runs the unattended work on a firewall is an administrative fact, so only an admin is told.
// mgmt_ip deliberately stays for everyone: the device picker, Config Deploy and the AI Assistant all
// display it, and hiding it would break those views for the operator role.
func toResponseFor(c *gin.Context, d entity.NetworkDevice) deviceResponse {
	r := toResponse(d)
	if !isAdmin(c) {
		return r
	}
	r.AutomationAccount, r.AutomationOwner = automationAccountOf(d)

	readiness := services.DeviceAutomationReadiness(&d)
	r.AutomationState = string(readiness.State)
	r.AutomationWarning = readiness.Warning
	return r
}

// automationAccountOf describes the account scheduled work uses, for display only.
//
// Two shapes, because there are two sources: a nominated credential (its owner is named) and the
// legacy login stored on the device before this form stopped asking for one.
func automationAccountOf(d entity.NetworkDevice) (account, owner string) {
	if d.AutomationCredentialID != 0 {
		var cred entity.DeviceCredential
		if err := config.DB().First(&cred, d.AutomationCredentialID).Error; err == nil {
			var u entity.AppUser
			if config.DB().First(&u, cred.AppUserID).Error == nil {
				return cred.Username, strings.TrimSpace(u.FirstName + " " + u.LastName)
			}
			return cred.Username, ""
		}
	}
	if strings.TrimSpace(d.Username) != "" {
		return d.Username, "stored on the device"
	}
	return "", ""
}

// applySchedule ตั้ง/ปิด auto backup + คำนวณ next_backup_at จาก cron
// คืน error ถ้า cron spec ไม่ถูกต้อง (ให้ caller ตอบ 400)
func applySchedule(d *entity.NetworkDevice, enabled bool, cronSpec string) error {
	d.BackupEnabled = enabled
	d.BackupCron = cronSpec
	if enabled && cronSpec != "" {
		next, err := jobs.NextRun(cronSpec, time.Now())
		if err != nil {
			return err
		}
		d.NextBackupAt = next
	} else {
		d.NextBackupAt = nil
	}
	return nil
}

// callerID returns the signed-in user's id from the JWT-stamped context.
func callerID(c *gin.Context) uint {
	v, _ := c.Get("user_id")
	return services.UserIDOf(v)
}

// canReach reports whether the caller is allowed to work on this device.
//
// The rule itself lives in services.UserCanAccessDevice — see that file for why an admin bypasses
// it and why "no grants" means "no devices" rather than "all of them".
func canReach(c *gin.Context, deviceID uint) bool {
	return services.UserCanAccessDevice(config.DB(), callerID(c), isAdmin(c), deviceID)
}

// ── List ─────────────────────────────────────────────────────────────────────

// List returns the inventory the CALLER may work on.
//
// This is the visible half of per-user device access: an admin sees every device, everyone else
// sees the ones they have been granted. It is not the enforcing half — hiding a row would be
// pointless on its own, since the device-proxy routes take an id in the URL — so every one of those
// checks the same rule server-side (controller/policyobject.getDeviceInfo).
func List(c *gin.Context) {
	db := config.DB()
	q := services.ScopeDevicesToUser(db.Model(&entity.NetworkDevice{}), db, callerID(c), isAdmin(c))

	var devices []entity.NetworkDevice
	if err := q.Order("id DESC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch devices"})
		return
	}
	out := make([]deviceResponse, 0, len(devices))
	for _, d := range devices {
		out = append(out, toResponseFor(c, d))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func GetByID(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var d entity.NetworkDevice
	if err := config.DB().First(&d, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	// 404, not 403: a "forbidden" here would confirm the device exists, and which firewalls are in
	// the inventory is not something an ungranted user should be able to enumerate by id.
	if !canReach(c, d.ID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": toResponseFor(c, d)})
}

// ── Create ───────────────────────────────────────────────────────────────────

// createRequest deliberately has NO username or password.
//
// A device no longer carries a login of its own. People reach it with the account they map to it
// under Profile ▸ Device Credentials, and unattended work uses whichever of those accounts somebody
// nominates for it (entity.NetworkDevice.AutomationCredentialID). Asking for a shared password here
// would put a second, competing answer to "who are we?" back into the system — and it was the one
// people forgot to rotate.
type createRequest struct {
	Name     string `json:"name" binding:"required"`
	Vendor   string `json:"vendor" binding:"required"`
	Platform string `json:"platform" binding:"required"`
	MgmtIP   string `json:"mgmt_ip" binding:"required"`
	Port     int    `json:"port"`
	// APIPort = FortiGate admin HTTPS/REST port. 0 defaults to 443 below — most units leave it
	// there, but a unit whose admin GUI was moved off 443 cannot be reached at all without this.
	APIPort       int    `json:"api_port"`
	Site          string `json:"site"`
	Role          string `json:"role"`
	Status        string `json:"status"`
	BackupEnabled bool   `json:"backup_enabled"`
	BackupCron    string `json:"backup_cron"`
}

func Create(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	port := req.Port
	if port == 0 {
		port = 22
	}
	apiPort := req.APIPort
	if apiPort == 0 {
		apiPort = services.DefaultAPIPort
	}
	status := req.Status
	if status == "" {
		status = "active"
	}

	d := entity.NetworkDevice{
		Name: req.Name, Vendor: req.Vendor, Platform: req.Platform,
		MgmtIP: req.MgmtIP, Port: port, APIPort: apiPort, Site: req.Site, Role: req.Role,
		Status: status,
	}
	if err := applySchedule(&d, req.BackupEnabled, req.BackupCron); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cron expression: " + err.Error()})
		return
	}
	if err := config.DB().Create(&d).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create device"})
		return
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"), fmt.Sprintf(
		"device_create: id=%d name=%q vendor=%s mgmt_ip=%s", d.ID, d.Name, d.Vendor, d.MgmtIP))

	c.JSON(http.StatusCreated, gin.H{"data": toResponseFor(c, d)})
}

// ── Update ───────────────────────────────────────────────────────────────────

type updateRequest struct {
	Name          *string `json:"name"`
	Vendor        *string `json:"vendor"`
	Platform      *string `json:"platform"`
	MgmtIP        *string `json:"mgmt_ip"`
	Port          *int    `json:"port"`
	APIPort       *int    `json:"api_port"`
	Site          *string `json:"site"`
	Role          *string `json:"role"`
	Status        *string `json:"status"`
	BackupEnabled *bool   `json:"backup_enabled"`
	BackupCron    *string `json:"backup_cron"`
	// No username/password here either — see createRequest. An older client that still sends them is
	// silently ignored rather than rejected, so a stale tab cannot rewrite a device's login.
}

func Update(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	var d entity.NetworkDevice
	if err := config.DB().First(&d, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != nil {
		d.Name = *req.Name
	}
	if req.Vendor != nil {
		d.Vendor = *req.Vendor
	}
	if req.Platform != nil {
		d.Platform = *req.Platform
	}
	if req.MgmtIP != nil {
		d.MgmtIP = *req.MgmtIP
	}
	if req.Port != nil {
		d.Port = *req.Port
	}
	if req.APIPort != nil {
		d.APIPort = *req.APIPort
	}
	if req.Site != nil {
		d.Site = *req.Site
	}
	if req.Role != nil {
		d.Role = *req.Role
	}
	if req.Status != nil {
		d.Status = *req.Status
	}
	// อัปเดต schedule ถ้าส่ง backup_enabled หรือ backup_cron มา → คำนวณ next_backup_at ใหม่
	if req.BackupEnabled != nil || req.BackupCron != nil {
		enabled := d.BackupEnabled
		if req.BackupEnabled != nil {
			enabled = *req.BackupEnabled
		}
		cronSpec := d.BackupCron
		if req.BackupCron != nil {
			cronSpec = *req.BackupCron
		}
		if err := applySchedule(&d, enabled, cronSpec); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cron expression: " + err.Error()})
			return
		}
	}

	if err := config.DB().Save(&d).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update device"})
		return
	}

	// Sessions are pooled per device (services.AcquireFortiClient). An edit can change the address,
	// so every cached session must go — otherwise the next few minutes of requests would keep
	// talking to the OLD host.
	services.InvalidateAllDeviceSessions(d.ID)
	// Same reasoning for the SSH-measured boot time behind the dashboard's uptime.
	services.InvalidateDeviceUptime(d.ID)

	services.LogActivity(config.DB(), c.GetUint("user_id"),
		fmt.Sprintf("device_update: id=%d name=%q", d.ID, d.Name))

	c.JSON(http.StatusOK, gin.H{"data": toResponseFor(c, d)})
}

// ── Delete ───────────────────────────────────────────────────────────────────

func Delete(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))

	var d entity.NetworkDevice
	name := ""
	if err := config.DB().First(&d, id).Error; err == nil {
		name = d.Name
	}

	if err := config.DB().Delete(&entity.NetworkDevice{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete device"})
		return
	}

	// The per-user credentials mapped to it go too, and they go for real.
	//
	// A device row is soft-deleted, but device_credentials must not be: its unique index is on
	// (app_user_id, network_device_id) without deleted_at, so leftovers would collide the day a
	// device is re-added with the same id. They are also worthless on their own — a username and a
	// ciphertext for a firewall the console no longer knows about.
	config.DB().Unscoped().Where("network_device_id = ?", id).Delete(&entity.DeviceCredential{})

	// The access grants pointing at it go the same way, for the same index reason — see
	// entity.UserDeviceAccess. A stale grant would silently re-authorise everyone who held it if
	// the id were reused.
	services.PurgeDeviceGrantsForDevice(config.DB(), uint(id))

	// Close and drop the pooled session so the removed device's admin slot is released now rather
	// than lingering until it times out.
	services.InvalidateAllDeviceSessions(uint(id))
	services.InvalidateDeviceUptime(uint(id))

	services.LogActivity(config.DB(), c.GetUint("user_id"), fmt.Sprintf("device_delete: id=%d name=%q", id, name))

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// ── Credential key rotation (admin) ───────────────────────────────────────────
//
// POST /admin/rotate-cred-key
//
// Re-encrypts every secret still held under an older key version with the CURRENT one
// (CRED_ENC_KEY_VERSION). This is step 2 of the rotation documented in services/crypto.go, and the
// operator's signal that step 3 — deleting the superseded key from the environment — is safe.
//
// ⚠️ It must cover EVERY table services.EncryptSecret writes to, not just devices. It used to walk
// network_devices alone while two other tables held ciphertext under the same key:
//
//	network_devices.password_enc      the shared firewall account
//	device_credentials.password_enc   each person's OWN firewall account (Profile ▸ Device Credentials)
//	notify_channels.secret_enc        the LINE bot token
//
// The report said rotated=N failed=0 either way, so following the documented procedure and dropping
// the old key afterwards left the last two permanently unreadable: every personal device credential
// and every alert channel, unrecoverable, with nothing having looked like it failed. A rotation
// report is only trustworthy if its denominator is every secret there is.
//
// New encrypted column somewhere? Add it to credRotationTargets or this breaks again, silently.
func RotateCredKey(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}

	currentVersion := platform.CurrentCredKeyVersion()

	perTable := make(map[string]gin.H, len(credRotationTargets))
	var rotated, failed, skipped, total int

	for _, t := range credRotationTargets {
		res, err := rotateTable(config.DB(), t, currentVersion)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": fmt.Sprintf("failed to load %s: %v", t.table, err),
			})
			return
		}
		perTable[t.table] = gin.H{
			"rotated": res.rotated, "skipped": res.skipped,
			"failed": res.failed, "total": res.total,
		}
		rotated += res.rotated
		skipped += res.skipped
		failed += res.failed
		total += res.total
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"), fmt.Sprintf(
		"cred_key_rotate: key_version=%d rotated=%d skipped=%d failed=%d total=%d",
		currentVersion, rotated, skipped, failed, total))

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"key_version": currentVersion,
		"rotated":     rotated,
		"skipped":     skipped,
		"failed":      failed,
		"total":       total,
		// Per-table too: "rotated=3" is not enough to decide the old key can go, because the number
		// that matters is whether ANY table still holds an old-version row.
		"tables": perTable,
	}})
}

// credRotationTarget names one encrypted column to sweep.
type credRotationTarget struct {
	table  string
	column string
}

// credRotationTargets is every column holding services.EncryptSecret output.
//
// Addressed by raw table/column rather than through the GORM models on purpose: the sweep needs
// only an id and a ciphertext, and going through the entities would drag in soft-delete scopes —
// a soft-deleted device_credentials row still occupies its unique index (see entity.DeviceCredential)
// and would be skipped by the default scope while still being ciphertext nobody can read.
var credRotationTargets = []credRotationTarget{
	{"network_devices", "password_enc"},
	{"device_credentials", "password_enc"},
	{"notify_channels", "secret_enc"},
	{"send_emails", "pass_app"},
}

type rotationResult struct{ rotated, skipped, failed, total int }

// rotateTable re-encrypts one column, row by row.
//
// A row that fails is counted and stepped over rather than aborting the sweep: stopping halfway
// would leave the operator with a partially rotated database and no report of what got through.
func rotateTable(db *gorm.DB, t credRotationTarget, currentVersion int) (rotationResult, error) {
	var res rotationResult

	type row struct {
		ID  uint
		Enc string
	}
	var rows []row
	q := fmt.Sprintf("SELECT id, %s AS enc FROM %s WHERE %s IS NOT NULL AND %s <> ''",
		t.column, t.table, t.column, t.column)
	if err := db.Raw(q).Scan(&rows).Error; err != nil {
		return res, err
	}
	res.total = len(rows)

	upd := fmt.Sprintf("UPDATE %s SET %s = ? WHERE id = ?", t.table, t.column)
	for _, r := range rows {
		if platform.CredKeyVersion(r.Enc) == currentVersion {
			res.skipped++
			continue
		}
		newEnc, err := platform.ReencryptSecret(r.Enc)
		if err != nil {
			log.Printf("[cred-rotate] %s id=%d could not be re-encrypted: %v", t.table, r.ID, err)
			res.failed++
			continue
		}
		if err := db.Exec(upd, newEnc, r.ID).Error; err != nil {
			log.Printf("[cred-rotate] %s id=%d could not be written back: %v", t.table, r.ID, err)
			res.failed++
			continue
		}
		res.rotated++
	}
	return res, nil
}

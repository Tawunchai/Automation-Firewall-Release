package configdeploy

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// Rollback — put a stored configuration back onto a firewall.
//
// ── What changed and why ─────────────────────────────────────────────────────
//
// This used to call runDeploy(device, backup.Content): the whole configuration file was handed
// to the config-push worker, which typed it into the device line by line over SSH. That is not
// how a FortiGate configuration is restored, and the failure mode was the bad kind — a partial
// write with no transaction and no way back. services/fortigate_configfile.go documents each
// specific way the line-by-line replay breaks (multi-line private keys, `#config-version`
// handshake never happening, encrypted secrets, no atomicity).
//
// It now uses the endpoint FortiOS provides for exactly this and that its own GUI calls:
// POST /api/v2/monitor/system/config/restore. Three consequences the old path did not have, and
// all three are surfaced rather than hidden:
//
//  1. The file is VALIDATED before anything is sent. A stored row that is not a configuration
//     file is refused here, with the reason, and the device is never touched.
//  2. The restore is ATOMIC on the device. It either takes the whole file or none of it.
//  3. The firewall REBOOTS. That is inherent to a FortiOS config restore, so the flow is now
//     two-step: a preview the operator reads, then an explicit confirm.
//
// Verified against the lab FGT80E (FortiOS 7.2.10) — the parameter list comes from that unit's
// own monitor API schema directory.

// rollbackDeployMode marks the ConfigDeploy rows this creates, so the Config Deploy history can
// tell "somebody restored a whole configuration" apart from "somebody pushed CLI lines".
const rollbackDeployMode = "restore"

// loadRollbackTarget resolves :id to a backup, the device it came from and the DECRYPTED
// configuration file, answering the request itself on any failure.
//
// The plaintext is returned alongside the row, and is the only thing the handlers below may send to
// a firewall: ConfigBackup.Content is encrypted at rest (see entity.ConfigBackup) and a FortiOS
// restore replaces the whole configuration and reboots the unit, so handing over a value that did
// not decrypt would brick it. Decrypting once, here, means no handler can forget.
func loadRollbackTarget(c *gin.Context) (*entity.ConfigBackup, *entity.NetworkDevice, string, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid backup id"})
		return nil, nil, "", false
	}

	var backup entity.ConfigBackup
	if err := config.DB().First(&backup, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return nil, nil, "", false
	}

	// ── Per-user device access ───────────────────────────────────────────────
	//
	// This is the single door every rollback handler goes through, and it had no grant check at
	// all: :id names a ConfigBackup, the device came from backup.NetworkDeviceID, and nothing ever
	// asked whether THIS caller holds that firewall. A FortiOS configuration restore replaces the
	// whole configuration and REBOOTS the unit, so any signed-in admin/operator could reboot and
	// overwrite any firewall in the inventory — including a production one they were never granted.
	//
	// 404 and not 403, the same answer as every other way into a device (services/deviceaccess.go,
	// controller/devicecredential): a 403 would confirm that this backup id belongs to a firewall
	// that exists, and which firewalls exist is not public. The refusal is deliberately phrased as
	// "no such backup", so an ungranted caller cannot tell a backup that is not theirs from one
	// that is not there.
	//
	// Placed here — on backup.NetworkDeviceID, before the empty-content check and before the
	// device row is read — rather than after the device load, because the content check answers
	// 400 and would otherwise still tell an ungranted caller which backup ids exist.
	if !services.UserCanAccessDevice(config.DB(), c.GetUint("user_id"),
		c.GetString("user_role") == "admin", backup.NetworkDeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return nil, nil, "", false
	}

	// Decrypted here, and the plaintext — not backup.Content — is what every caller works with.
	//
	// A decrypt failure is a 500 and stops the request dead. It must never degrade to "" and fall
	// into the empty-content branch below, because the two mean opposite things: "this backup has
	// no configuration in it" is a 400 the operator can act on, while "the key that protects this
	// configuration is wrong or missing" is a platform fault, and treating the second as the first
	// would quietly turn a recoverable key problem into a restore of nothing.
	content, err := platform.BackupContent(backup)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "refusing to restore: " + err.Error(),
		})
		return nil, nil, "", false
	}

	if strings.TrimSpace(content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this backup holds no configuration to roll back to"})
		return nil, nil, "", false
	}

	var device entity.NetworkDevice
	if err := config.DB().First(&device, backup.NetworkDeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the device this backup belongs to was not found"})
		return nil, nil, "", false
	}
	return &backup, &device, content, true
}

// RollbackPreviewResponse is what the confirm dialog renders. Everything the operator needs in
// order to decide is computed before a single byte is sent to the firewall.
type RollbackPreviewResponse struct {
	BackupID   uint   `json:"backup_id"`
	DeviceID   uint   `json:"device_id"`
	DeviceName string `json:"device_name"`
	TakenAt    string `json:"taken_at"`
	Lines      int    `json:"lines"`
	SizeBytes  int    `json:"size_bytes"`

	// FileModel is the platform/firmware token from the file's own header.
	FileModel     string `json:"file_model"`
	DeviceModel   string `json:"device_model"`
	DeviceVersion string `json:"device_version"`

	// Valid is false when the stored text is not a configuration file at all. Blocking.
	Valid        bool   `json:"valid"`
	InvalidError string `json:"invalid_error,omitempty"`

	// Compatible is false when the file was taken from a different model or firmware. Advisory:
	// the operator may still proceed, because a lab or a staged upgrade is a real reason to.
	Compatible        bool   `json:"compatible"`
	IncompatibleError string `json:"incompatible_reason,omitempty"`

	// Warnings are always shown. The reboot is not optional and must never be a surprise.
	Warnings []string `json:"warnings"`
}

// RollbackPreview answers GET /backups/:id/rollback-preview.
//
// Read-only, and it does not require the device to be reachable: the file checks are local, and
// the model/firmware comparison degrades to "unknown, therefore not blocking" when the firewall
// cannot be asked.
func RollbackPreview(c *gin.Context) {
	if !canDeploy(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin or operator can roll back"})
		return
	}
	backup, device, content, ok := loadRollbackTarget(c)
	if !ok {
		return
	}

	out := RollbackPreviewResponse{
		BackupID:   backup.ID,
		DeviceID:   device.ID,
		DeviceName: device.Name,
		TakenAt:    backup.CreatedAt.Format(time.RFC3339),
		Lines:      backup.Lines,
		SizeBytes:  backup.SizeBytes,
		Compatible: true,
		Warnings: []string{
			"Restoring a configuration REBOOTS the firewall. It will stop passing traffic for a minute or more.",
			"Everything configured since this backup was taken will be lost — the whole configuration is replaced, not merged.",
		},
	}

	info, err := services.InspectConfigFile(content)
	if err != nil {
		out.Valid = false
		out.InvalidError = err.Error()
		c.JSON(http.StatusOK, out)
		return
	}
	out.Valid = true
	out.FileModel = info.Model
	if out.Lines == 0 {
		out.Lines = info.Lines
	}
	if out.SizeBytes == 0 {
		out.SizeBytes = info.Bytes
	}

	// Ask the device what it is, so a backup from another unit can be caught before it is applied.
	// Best-effort: an unreachable firewall leaves Compatible true rather than blocking a restore
	// on a fact we could not establish.
	if model, version := describeDevice(c, device); model != "" || version != "" {
		out.DeviceModel, out.DeviceVersion = model, version
		if okCompat, reason := services.ConfigFileMatchesDevice(info.Model, model, version); !okCompat {
			out.Compatible = false
			out.IncompatibleError = reason
		}
	}

	c.JSON(http.StatusOK, out)
}

// describeDevice returns the firewall's model and firmware, or empty strings when it cannot be
// reached. Never fails the request — see the call site.
func describeDevice(c *gin.Context, device *entity.NetworkDevice) (model, version string) {
	login, err := services.ResolveDeviceLogin(config.DB(), c.GetUint("user_id"), device)
	if err != nil {
		return "", ""
	}
	// device.APIPort, NOT device.Port: the Port column is the SSH port the worker uses, and the
	// REST API is on its own (usually different) port. Passing the SSH port here does not just
	// fail — AcquireFortiClient keys the session pool on device+port, so it opens a second pool
	// entry that logs in on the wrong port and burns attempts against the firewall's
	// admin-lockout threshold.
	fc, err := services.AcquireFortiClient(device.ID, device.MgmtIP, device.APIPort, login)
	if err != nil {
		return "", ""
	}
	status, err := fc.GetSystemStatus()
	if err != nil {
		return "", ""
	}
	return status.Model, status.Version
}

// Rollback answers POST /backups/:id/rollback.
//
// Requires `{"confirm": true}` in the body. That is not ceremony: the old handler restored on an
// empty POST, and this one reboots a production firewall.
func Rollback(c *gin.Context) {
	if !canDeploy(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin or operator can roll back"})
		return
	}

	var body struct {
		Confirm bool `json:"confirm"`
		// Force proceeds despite a model/firmware mismatch. The mismatch is advisory (see
		// RollbackPreview), so there has to be a way through it — but it must be asked for.
		Force bool `json:"force"`
	}
	_ = c.ShouldBindJSON(&body)
	if !body.Confirm {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "a configuration restore reboots the firewall — call the preview first and " +
				"send {\"confirm\": true} once the operator has accepted it",
		})
		return
	}

	backup, device, content, ok := loadRollbackTarget(c)
	if !ok {
		return
	}

	// ── Guard 1: is this actually a configuration file? ──────────────────────
	// `content` is the DECRYPTED file from loadRollbackTarget — see the note there. Inspecting
	// backup.Content instead would validate ciphertext and then restore it.
	info, err := services.InspectConfigFile(content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetUint("user_id")
	login, err := services.ResolveDeviceLogin(config.DB(), userID, device)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no usable credential for this device: " + err.Error()})
		return
	}
	// device.APIPort, not device.Port — see the note in describeDevice.
	fc, err := services.AcquireFortiClient(device.ID, device.MgmtIP, device.APIPort, login)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "cannot reach the firewall: " + err.Error()})
		return
	}

	// ── Guard 2: is it this firewall's configuration? ────────────────────────
	if !body.Force {
		if status, sErr := fc.GetSystemStatus(); sErr == nil {
			if okCompat, reason := services.ConfigFileMatchesDevice(info.Model, status.Model, status.Version); !okCompat {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": reason + " — restoring it would very likely brick this unit. " +
						"Send {\"force\": true} only if you are certain.",
				})
				return
			}
		}
	}

	// ── Audit row, written BEFORE the restore ────────────────────────────────
	//
	// Deliberately before: the device reboots, this process may see nothing but a dropped
	// connection afterwards, and "who restored what onto which firewall, and when" must survive
	// that. CommandText holds a one-line description rather than the 33,000-line file — the file
	// itself is already stored as the ConfigBackup this row points at.
	deploy := entity.ConfigDeploy{
		CommandText: fmt.Sprintf("restore configuration from backup #%d (%s, %d lines, taken %s)",
			backup.ID, info.Model, info.Lines, backup.CreatedAt.Format(time.RFC3339)),
		Mode:         rollbackDeployMode,
		Status:       "RUNNING",
		TriggeredBy:  c.GetString("user_email"),
		TotalDevices: 1,
	}
	now := time.Now()
	deploy.StartedAt = &now
	if err := config.DB().Create(&deploy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not record the restore"})
		return
	}
	child := entity.ConfigDeployResult{
		ConfigDeployID:  deploy.ID,
		NetworkDeviceID: device.ID,
		DeviceName:      device.Name,
		Status:          "RUNNING",
		BeforeBackupID:  backup.ID,
		StartedAt:       &now,
	}
	config.DB().Create(&child)

	services.LogActivity(config.DB(), userID, fmt.Sprintf(
		"config_restore_start: deploy=%d device=%d backup=%d model=%s",
		deploy.ID, device.ID, backup.ID, info.Model))

	// ── The restore itself ───────────────────────────────────────────────────
	result, restoreErr := fc.RestoreConfigFile(content)
	finished := time.Now()

	if restoreErr != nil {
		markRestoreOutcome(&deploy, &child, "FAILED", "", restoreErr.Error(), finished)
		services.LogActivity(config.DB(), userID, fmt.Sprintf(
			"config_restore_failed: deploy=%d device=%d error=%v", deploy.ID, device.ID, restoreErr))
		c.JSON(http.StatusBadGateway, gin.H{"error": "FortiGate refused the restore: " + restoreErr.Error()})
		return
	}

	// The unit is rebooting into the restored configuration. Every pooled session for it is dead,
	// and the next request must open a new one rather than reuse a socket to a device that is on
	// its way down.
	services.InvalidateAllDeviceSessions(device.ID)

	markRestoreOutcome(&deploy, &child, "SUCCESS",
		fmt.Sprintf("restore accepted by %s (session %s) — device is rebooting",
			device.Name, orDash(result.SessionID)), "", finished)

	services.LogActivity(config.DB(), userID, fmt.Sprintf(
		"config_restore_accepted: deploy=%d device=%d backup=%d session=%s",
		deploy.ID, device.ID, backup.ID, result.SessionID))

	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{
		"id":          deploy.ID,
		"status":      "SUCCESS",
		"device_name": device.Name,
		"session_id":  result.SessionID,
		"rebooting":   true,
		"message": fmt.Sprintf(
			"%s accepted the configuration and is rebooting. It will not answer for a minute or more.",
			device.Name),
	}})
}

// markRestoreOutcome closes out both audit rows in one place, so the parent and the child can
// never disagree about what happened.
func markRestoreOutcome(deploy *entity.ConfigDeploy, child *entity.ConfigDeployResult,
	status, output, errText string, at time.Time) {

	child.Status = status
	child.Output = platform.TruncateUTF8(output, 2000)
	child.Error = platform.TruncateUTF8(errText, 400)
	child.FinishedAt = &at
	config.DB().Save(child)

	deploy.Status = status
	deploy.FinishedAt = &at
	if status == "SUCCESS" {
		deploy.SuccessCount = 1
	} else {
		deploy.FailedCount = 1
	}
	config.DB().Save(deploy)
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

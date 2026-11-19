// Package configdeploy — push config ไปยังอุปกรณ์ "หลายตัวพร้อมกัน" (bulk/parallel)
// งานแม่ = ConfigDeploy, งานลูก = ConfigDeployResult (ต่ออุปกรณ์)
// backend สร้าง แม่+ลูก แล้ว enqueue 1 ข้อความ → worker fan-out ยิงขนาน → รายงานผลรายตัวกลับ
package configdeploy

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ── helpers ──────────────────────────────────────────────────────────────────

// splitCommands แตก CommandText เป็นบรรทัด ตัดช่องว่าง/บรรทัดว่าง/comment (#, //)
func splitCommands(text string) []string {
	out := make([]string, 0, 16)
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		out = append(out, line) // คงการเยื้องเดิมไว้ (FortiOS hierarchy ใช้)
	}
	return out
}

// commandBlocklist = คำสั่งทำลายข้อมูล/รีบูต/รีเซ็ตโรงงานที่ "ห้ามส่งเด็ดขาด"
// บังคับฝั่ง server (ไม่พึ่งพา system prompt ของ AI เพียงอย่างเดียว) — ครอบทั้ง
// คำสั่งที่มาจาก AI suggestion และที่ผู้ใช้กรอกเองผ่าน Create/Rollback
var commandBlocklist = []*regexp.Regexp{
	// FortiOS
	regexp.MustCompile(`(?i)^\s*execute\s+reboot\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+shutdown\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+factoryreset`), // ครอบ factoryreset และ factoryreset2
	regexp.MustCompile(`(?i)^\s*execute\s+formatlogdisk\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+format\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+(usb-disk|disk)\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+restore\b`),

	// Cisco IOS
	regexp.MustCompile(`(?i)^\s*reload\b`),
	regexp.MustCompile(`(?i)^\s*write\s+erase\b`),
	regexp.MustCompile(`(?i)^\s*erase\s+`),
	regexp.MustCompile(`(?i)^\s*format\s+`),
	regexp.MustCompile(`(?i)^\s*delete\s*/`),

	// H3C Comware
	regexp.MustCompile(`(?i)^\s*reboot\b`),
	regexp.MustCompile(`(?i)^\s*reset\s+saved-configuration\b`),
}

// findBlockedCommand คืนบรรทัดแรกที่ตรงกับ commandBlocklist (หรือ "" ถ้าไม่มี)
func findBlockedCommand(commands []string) string {
	for _, line := range commands {
		for _, re := range commandBlocklist {
			if re.MatchString(line) {
				return strings.TrimSpace(line)
			}
		}
	}
	return ""
}

// allowedDiagnosePatterns = the `diagnose` sub-commands that are genuinely read-only.
//
// ⚠️ `diagnose` IS NOT A READ-ONLY VERB ON FORTIOS. It is the catch-all prefix for the whole
// diagnostic subsystem, and a large part of that subsystem changes the device:
//
//	diagnose sys session clear          drops live sessions — every user behind the firewall
//	                                    loses their connections
//	diagnose sys session filter …       sets GLOBAL CLI state that survives the login and silently
//	                                    narrows what the NEXT operator's session list shows (this
//	                                    repo's own code clears it before and after for that reason
//	                                    — see services/fortigate_diagexec.go)
//	diagnose debug application … -1     turns on firehose debug output on a production firewall;
//	                                    costs CPU and keeps running after the session ends
//	diagnose vpn ike restart            tears down and renegotiates IPsec tunnels
//	diagnose vpn tunnel flush / down    drops tunnels
//	diagnose firewall iprope clear      flushes the policy lookup cache
//	diagnose hardware test / sys kill   exactly what they say
//
// `^\s*diagnose\s+` used to be in the allow-list below, which meant a read-only endpoint accepted
// every one of the above. So the prefix does not decide: each permitted sub-command is written out
// here, and the list is exactly what this product issues or teaches the assistant to issue
// (services/fortigate_diagexec.go, services/fortigate_troubleshoot*.go, services/ai_prompt_fortinet.go
// §17). Anything else is refused by findDisallowedQueryCommand like any other non-read command.
//
// Each pattern pins the sub-command AND its terminator, so that `… session list` cannot be widened
// into `… session list-and-clear` and `… tunnel list` cannot slide into `… tunnel flush`.
var allowedDiagnosePatterns = []*regexp.Regexp{
	// FortiGuard contract/engine versions — the "why is AV not updating" question. Prints only.
	regexp.MustCompile(`(?i)^\s*diagnose\s+autoupdate\s+status\s*$`),
	// Policy-engine inspection; `lookup` is what Troubleshooting's policy walk corroborates
	// against. Prints the compiled rule state; `clear`/`flush` are NOT in this list.
	regexp.MustCompile(`(?i)^\s*diagnose\s+firewall\s+iprope\s+(state|list|lookup)(\s|$)`),
	// Disk/NIC inventory for the dashboard's "is this box healthy" questions. Read-only;
	// `diagnose hardware test` is not matched.
	regexp.MustCompile(`(?i)^\s*diagnose\s+hardware\s+deviceinfo\s+(disk|nic)(\s|$)`),
	// The addresses the device believes it has — the first thing asked when an interface looks
	// wrong. Prints only.
	regexp.MustCompile(`(?i)^\s*diagnose\s+ip\s+address\s+list\s*$`),
	// Kernel-level interface list and counters, the companion to the one above. Prints only.
	regexp.MustCompile(`(?i)^\s*diagnose\s+netlink\s+interface\s+list(\s|$)`),
	// "What still references this object?" before a delete. Prints only.
	regexp.MustCompile(`(?i)^\s*diagnose\s+sys\s+checkused(\s|$)`),
	// The session table itself. `list` only: `clear` drops sessions and `filter` sets global state.
	regexp.MustCompile(`(?i)^\s*diagnose\s+sys\s+session\s+list\s*$`),
	// Per-process CPU/memory, optionally `<interval> <lines>`. Prints only.
	regexp.MustCompile(`(?i)^\s*diagnose\s+sys\s+top(\s|$)`),
	// IKE gateway state. `list` only — `restart`, `flush` and `clear` renegotiate or drop tunnels.
	regexp.MustCompile(`(?i)^\s*diagnose\s+vpn\s+ike\s+gateway\s+list(\s|$)`),
	// IPsec SA state. `list` only — `up`, `down` and `flush` change the tunnel.
	regexp.MustCompile(`(?i)^\s*diagnose\s+vpn\s+tunnel\s+list(\s|$)`),
}

// allowedQueryPatterns = คำสั่ง read-only (exec mode) ที่อนุญาตให้รันผ่าน /config-deploys/query
// — ใช้สำหรับ AI assistant "get" ข้อมูลจากอุปกรณ์มาแสดง โดยไม่แก้ config ใด ๆ
var allowedQueryPatterns = append([]*regexp.Regexp{
	// FortiOS
	regexp.MustCompile(`(?i)^\s*get\s+`),
	regexp.MustCompile(`(?i)^\s*show(\s|$)`),
	regexp.MustCompile(`(?i)^\s*execute\s+ping6?\b`),
	regexp.MustCompile(`(?i)^\s*execute\s+traceroute6?\b`),

	// Cisco IOS / H3C Comware
	regexp.MustCompile(`(?i)^\s*display(\s|$)`),
	regexp.MustCompile(`(?i)^\s*ping6?(\s|$)`),
	regexp.MustCompile(`(?i)^\s*tracer(t|oute)6?\b`),
}, allowedDiagnosePatterns...)

// findDisallowedQueryCommand คืนบรรทัดแรกที่ "ไม่ใช่" คำสั่ง read-only ที่อนุญาต (หรือ "" ถ้าทุกบรรทัดผ่าน)
func findDisallowedQueryCommand(commands []string) string {
	for _, line := range commands {
		allowed := false
		for _, re := range allowedQueryPatterns {
			if re.MatchString(line) {
				allowed = true
				break
			}
		}
		if !allowed {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

// ── Create (สั่ง push config หลายอุปกรณ์) ─────────────────────────────────────
// POST /config-deploys  body: { device_ids: [..], command_text: ".." }

type createRequest struct {
	DeviceIDs   []uint `json:"device_ids"`
	CommandText string `json:"command_text"`
}

// canDeploy = RBAC: push/rollback config (เขียนอุปกรณ์) จำกัดเฉพาะ admin/operator
// (ตอนนี้ระบบมี role admin/user → operator เผื่ออนาคต; viewer/user ดูได้แต่สั่งไม่ได้)
func canDeploy(c *gin.Context) bool {
	role := c.GetString("user_role")
	return role == "admin" || role == "operator"
}

func Create(c *gin.Context) {
	if !canDeploy(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin or operator can push config"})
		return
	}
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.DeviceIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select at least one device"})
		return
	}

	var devices []entity.NetworkDevice
	if err := config.DB().Where("id IN ?", req.DeviceIDs).Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the devices could not be loaded"})
		return
	}
	if len(devices) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "none of the selected devices were found"})
		return
	}

	runDeploy(c, devices, req.CommandText)
}

// ── Query (อ่านข้อมูลจากอุปกรณ์ — read-only, ใช้กับ AI assistant "get") ───────
// POST /config-deploys/query  body: { device_id: number, command_text: "..." }
// คำสั่งต้องผ่าน allowedQueryPatterns เท่านั้น — และผู้เรียกต้องเป็น admin/operator ที่ถือสิทธิ์อุปกรณ์นั้น

type queryRequest struct {
	DeviceID    uint   `json:"device_id" binding:"required"`
	CommandText string `json:"command_text" binding:"required"`
}

const maxQueryCommands = 10

func Query(c *gin.Context) {
	// This endpoint had NO authorization of any kind: no role check and no device check. It takes
	// a device_id out of the request body, loads that device by primary key and runs up to ten
	// commands on it over SSH. "Read-only" is not the same as "harmless":
	//
	//   · it is a login against a firewall whose admin account locks after three failures, so it
	//     is also a way to lock an account someone else is using;
	//   · `show full-configuration` IS the configuration — the same contents /backups/:id/content
	//     guards;
	//   · `get system status`, the session table and the routing table map the network.
	//
	// So it carries the same two gates as every other way into a device: the role that may address
	// a firewall at all, and the per-user grant for THIS firewall.
	if !canDeploy(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only an admin or operator can read from a device"})
		return
	}

	var req queryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Per-user device access, BEFORE the row is read: 404 whether the device is absent or merely
	// not this caller's, so the inventory cannot be enumerated by id. Same answer, same reason, as
	// the ~100 handlers behind getDeviceInfo.
	if !services.UserCanAccessDevice(config.DB(), c.GetUint("user_id"),
		c.GetString("user_role") == "admin", req.DeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	commands := splitCommands(req.CommandText)
	if len(commands) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no commands to run"})
		return
	}
	if len(commands) > maxQueryCommands {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d commands per call", maxQueryCommands)})
		return
	}
	if bad := findDisallowedQueryCommand(commands); bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("this is not a read-only command (allowed: get, show, execute ping/traceroute, "+
				"and only the read-only diagnose commands): %q", bad),
		})
		return
	}

	var device entity.NetworkDevice
	if err := config.DB().First(&device, req.DeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	runQuery(c, &device, req.CommandText, commands)
}

// Rollback and RollbackPreview live in rollback.go.
//
// They used to be here, and Rollback used to be `runDeploy(device, backup.Content)` — the whole
// configuration file replayed as CLI lines over SSH. That is not how a FortiGate configuration is
// restored; see the file comment in rollback.go for what went wrong and what replaced it.

// enqueueConfigDeploy หา credential ของแต่ละอุปกรณ์ใน results แล้วสร้าง target ส่งให้ worker
//
// ใช้ credential ของ "คนที่กดปุ่ม" ถ้าเขาผูกบัญชีของตัวเองไว้กับอุปกรณ์นั้น มิฉะนั้นตกไปที่บัญชี
// automation ของอุปกรณ์ (services.ResolveDeviceLogin) — worker รัน push จริงทีหลังแบบ out of
// process การส่งบัญชีที่ตรงกับคนสั่งไปด้วยจึงเป็นทางเดียวที่ log ฝั่งอุปกรณ์จะชี้กลับมาถูกคน
//
// child ที่หา credential ไม่ได้ → mark FAILED ทันที ไม่รวมอยู่ใน targets
func enqueueConfigDeploy(userID uint, deploy *entity.ConfigDeploy, devices []entity.NetworkDevice, results []entity.ConfigDeployResult) error {
	devByID := make(map[uint]*entity.NetworkDevice, len(devices))
	for i := range devices {
		devByID[devices[i].ID] = &devices[i]
	}

	commands := splitCommands(deploy.CommandText)
	targets := make([]platform.ConfigDeviceTarget, 0, len(results))
	for i := range results {
		child := &results[i]
		d, ok := devByID[child.NetworkDeviceID]
		if !ok {
			continue
		}
		_, err := services.ResolveDeviceLogin(config.DB(), userID, d)
		if err != nil {
			now := time.Now()
			child.Status = "FAILED"
			child.Error = platform.TruncateUTF8(err.Error(), 400)
			child.FinishedAt = &now
			config.DB().Save(child)
			continue
		}
		// The login was resolved above only to prove it CAN be — the device is skipped and the
		// child marked FAILED otherwise, here, where a user is watching. The secret itself is
		// thrown away: what travels through Redis is a token the worker exchanges for the
		// credential when it connects (services/jobcredential.go).
		token, terr := services.IssueJobCredential(services.JobCredentialClaim{
			Kind: services.JobCredentialConfig, JobID: deploy.ID, ResultID: child.ID,
			DeviceID: d.ID, UserID: userID,
		})
		if terr != nil {
			now := time.Now()
			child.Status = "FAILED"
			child.Error = platform.TruncateUTF8("could not prepare this device's credential: "+terr.Error(), 400)
			child.FinishedAt = &now
			config.DB().Save(child)
			continue
		}
		config.DB().Model(&entity.ConfigDeployResult{}).Where("id = ?", child.ID).Update("status", "QUEUED")
		targets = append(targets, platform.ConfigDeviceTarget{
			ResultID: child.ID, DeviceID: d.ID, Name: d.Name, Host: d.MgmtIP, Port: d.Port,
			Platform: d.Platform, CredentialToken: token,
		})
	}

	// ทุกตัว decrypt ไม่ผ่าน → ไม่มีอะไรให้ worker ทำ
	if len(targets) == 0 {
		finalizeIfDone(deploy.ID)
		return errors.New("no device could be queued (no credential could be read for any of them)")
	}

	msg := platform.ConfigJobMessage{
		DeployID: deploy.ID,
		Commands: commands,
		Targets:  targets,
	}
	if err := platform.EnqueueConfig(msg); err != nil {
		now := time.Now()
		deploy.Status = "FAILED"
		deploy.FinishedAt = &now
		config.DB().Save(deploy)
		config.DB().Model(&entity.ConfigDeployResult{}).
			Where("config_deploy_id = ? AND status = ?", deploy.ID, "QUEUED").
			Updates(map[string]any{"status": "FAILED", "error": "enqueue failed"})
		return err
	}

	deploy.Status = "QUEUED"
	config.DB().Model(&entity.ConfigDeploy{}).Where("id = ?", deploy.ID).Update("status", "QUEUED")
	return nil
}

// runDeploy = core: สร้าง ConfigDeploy(แม่) + ลูกต่ออุปกรณ์ แล้ว enqueue ให้ worker ทันที
// ใช้ร่วมกันระหว่าง Create (push) และ Rollback (push config เดิมกลับ) — เขียน HTTP response เอง
func runDeploy(c *gin.Context, devices []entity.NetworkDevice, commandText string) {
	commands := splitCommands(commandText)
	if len(commands) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no config commands to send"})
		return
	}
	if bad := findBlockedCommand(commands); bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("this command is blocked for safety — it could reboot, reset or wipe the device: %q", bad),
		})
		return
	}

	userID := c.GetUint("user_id")

	deploy := entity.ConfigDeploy{
		CommandText:  commandText,
		Mode:         "config",
		Status:       "QUEUED",
		TriggeredBy:  c.GetString("user_email"),
		TotalDevices: len(devices),
	}
	if err := config.DB().Create(&deploy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the job could not be created"})
		return
	}

	// ── สร้างงานลูกต่ออุปกรณ์ ─────────────────────────────────────────────────
	results := make([]entity.ConfigDeployResult, 0, len(devices))
	for i := range devices {
		d := &devices[i]
		child := entity.ConfigDeployResult{
			ConfigDeployID:  deploy.ID,
			NetworkDeviceID: d.ID,
			DeviceName:      d.Name,
			Status:          "QUEUED",
		}
		if err := config.DB().Create(&child).Error; err != nil {
			continue
		}
		results = append(results, child)
	}

	if err := enqueueConfigDeploy(userID, &deploy, devices, results); err != nil {
		services.LogActivity(config.DB(), userID, fmt.Sprintf("config_deploy_enqueue_failed: id=%d error=%v", deploy.ID, err))
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "queue unavailable (redis?), or the credential could not be read"})
		return
	}

	services.LogActivity(config.DB(), userID, fmt.Sprintf(
		"config_deploy_create: id=%d devices=%d", deploy.ID, len(devices)))

	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{
		"id":            deploy.ID,
		"status":        deploy.Status,
		"total_devices": deploy.TotalDevices,
	}})
}

// runQuery = core: สร้าง ConfigDeploy(mode=query, แม่) + ลูก 1 ตัว + enqueue ให้ worker รัน read-only
// (ไม่มี diff/rollback — authorization ทั้งหมดอยู่ใน Query() ก่อนเรียกถึงที่นี่)
func runQuery(c *gin.Context, device *entity.NetworkDevice, commandText string, commands []string) {
	deploy := entity.ConfigDeploy{
		CommandText:  commandText,
		Mode:         "query",
		Status:       "QUEUED",
		TriggeredBy:  c.GetString("user_email"),
		TotalDevices: 1,
	}
	if err := config.DB().Create(&deploy).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the job could not be created"})
		return
	}

	child := entity.ConfigDeployResult{
		ConfigDeployID:  deploy.ID,
		NetworkDeviceID: device.ID,
		DeviceName:      device.Name,
		Status:          "QUEUED",
	}
	if err := config.DB().Create(&child).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the job could not be created"})
		return
	}

	_, err := services.ResolveDeviceLogin(config.DB(), c.GetUint("user_id"), device)
	if err != nil {
		now := time.Now()
		child.Status = "FAILED"
		child.Error = platform.TruncateUTF8(err.Error(), 400)
		child.FinishedAt = &now
		config.DB().Save(&child)
		finalizeIfDone(deploy.ID)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	// As in enqueueConfigDeploy: resolving the login here is the check that it exists and can be
	// decrypted, and the answer above is a 503 the caller can act on. The secret does not travel.
	token, terr := services.IssueJobCredential(services.JobCredentialClaim{
		Kind: services.JobCredentialConfig, JobID: deploy.ID, ResultID: child.ID,
		DeviceID: device.ID, UserID: c.GetUint("user_id"),
	})
	if terr != nil {
		now := time.Now()
		child.Status = "FAILED"
		child.Error = platform.TruncateUTF8("could not prepare this device's credential: "+terr.Error(), 400)
		child.FinishedAt = &now
		config.DB().Save(&child)
		finalizeIfDone(deploy.ID)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "could not prepare this device's credential"})
		return
	}

	target := platform.ConfigDeviceTarget{
		ResultID:        child.ID,
		DeviceID:        device.ID,
		Name:            device.Name,
		Host:            device.MgmtIP,
		Port:            device.Port,
		Platform:        device.Platform,
		CredentialToken: token,
	}

	msg := platform.ConfigJobMessage{
		DeployID: deploy.ID,
		Commands: commands,
		Targets:  []platform.ConfigDeviceTarget{target},
	}
	if err := platform.EnqueueQuery(msg); err != nil {
		now := time.Now()
		deploy.Status = "FAILED"
		deploy.FinishedAt = &now
		config.DB().Save(&deploy)
		child.Status = "FAILED"
		child.Error = "enqueue failed"
		child.FinishedAt = &now
		config.DB().Save(&child)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "queue unavailable (redis?)"})
		return
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"), fmt.Sprintf(
		"config_query: id=%d device_id=%d", deploy.ID, device.ID))

	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{
		"id":            deploy.ID,
		"status":        deploy.Status,
		"total_devices": deploy.TotalDevices,
		"mode":          deploy.Mode,
	}})
}

// ── List / Get ───────────────────────────────────────────────────────────────

// scopeDeploysToCaller narrows a query over config_deploys to the deploys the caller may see.
//
// The history was not scoped at all: List handed every user the most recent 100 deploys in the
// database and Get loaded any one of them by id with its children preloaded. A
// ConfigDeployResult.Output is the raw CLI the firewall printed — and a `query` deploy is
// effectively a `show`, so that output IS somebody else's firewall configuration.
//
// Why not services.ScopeDevicesToUser / ScopeDeviceRefToUser: `config_deploys` carries no device
// link at all. A deploy's devices are its ConfigDeployResult children, one row per device
// (entity/config_deploy.go), so there is neither an `id` that is a device id for the first helper
// nor a `network_device_id` column for the second. The scope therefore has to go through the child
// table — but the grant lookup itself is still services.AccessibleDeviceIDs, so "which firewalls
// are this person's" is answered in exactly one place as everywhere else.
//
// A deploy is visible only when the caller holds EVERY device it touched:
//
//	at least one child on a granted device  → this deploy is one of theirs;
//	no child on an ungranted device         → Get preloads the children, and answering with the
//	                                          other devices' children stripped out would be a
//	                                          partial row that misreports what the deploy did. A
//	                                          deploy that straddles the grant boundary is simply
//	                                          not theirs.
//
// So a deploy with no children at all — one that failed before they were written — is not visible
// to a non-admin either. That is the fail-closed direction, and such a row has no device output in
// it to read.
//
// An admin is never filtered: an admin can edit and delete the devices themselves, so hiding a
// deploy from them would be theatre (same reasoning as services/deviceaccess.go).
func scopeDeploysToCaller(q *gorm.DB, c *gin.Context) *gorm.DB {
	if c.GetString("user_role") == "admin" {
		return q
	}
	db := config.DB()
	ids, err := services.AccessibleDeviceIDs(db, c.GetUint("user_id"))
	if err != nil || len(ids) == 0 {
		// A database error is not permission, and no grants means no deploys. Both match nothing —
		// never "everything", which is how this kind of filter stops existing.
		return q.Where("1 = 0")
	}
	mine := db.Model(&entity.ConfigDeployResult{}).
		Select("config_deploy_id").
		Where("network_device_id IN ?", ids)
	notMine := db.Model(&entity.ConfigDeployResult{}).
		Select("config_deploy_id").
		Where("network_device_id NOT IN ?", ids)
	return q.Where("id IN (?)", mine).Where("id NOT IN (?)", notMine)
}

func List(c *gin.Context) {
	limit := 100
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	var deploys []entity.ConfigDeploy
	// Scoped before the ordering and the LIMIT are applied, so the page is the caller's 100 most
	// recent deploys and not "whichever of the fleet's 100 most recent happen to be theirs".
	q := scopeDeploysToCaller(config.DB().Model(&entity.ConfigDeploy{}), c)
	if err := q.Order("id DESC").Limit(limit).Find(&deploys).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the list could not be loaded"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": deploys})
}

func Get(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var deploy entity.ConfigDeploy
	// The same scope as List, so the history cannot list a row that then refuses to open — and a
	// deploy the caller may not see is 404 ("job not found"), never 403 and never a row with some of its
	// results removed.
	if err := scopeDeploysToCaller(config.DB().Model(&entity.ConfigDeploy{}), c).
		Preload("Results", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		First(&deploy, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": deploy})
}

// ── Worker callbacks (internal — auth ด้วย X-Worker-Secret) ───────────────────

func authWorker(c *gin.Context) bool {
	if !platform.WorkerAuthOK(c.GetHeader("X-Worker-Secret")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker secret"})
		return false
	}
	return true
}

// POST /internal/config-deploys/:id/start — worker แจ้งว่าเริ่มทำงานแม่
func WorkerStart(c *gin.Context) {
	if !authWorker(c) {
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	now := time.Now()
	config.DB().Model(&entity.ConfigDeploy{}).
		Where("id = ? AND status = ?", id, "QUEUED").
		Updates(map[string]any{"status": "RUNNING", "started_at": &now})
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// POST /internal/config-deploys/:id/device-result — worker รายงานผล "รายอุปกรณ์"
type deviceResultRequest struct {
	ResultID uint   `json:"result_id"`
	Status   string `json:"status"` // SUCCESS | FAILED
	Output   string `json:"output"`
	Error    string `json:"error"`

	// ── เฟส 3: diff/preview + rollback point ──────────────────────────────────
	Diff    string `json:"diff"`
	Changed bool   `json:"changed"`
	// snapshot "ก่อน push" → backend เก็บเป็น ConfigBackup = จุด rollback
	BeforeContent string `json:"before_content"`
	BeforeSha     string `json:"before_sha"`
	BeforeLines   int    `json:"before_lines"`
	BeforeBytes   int    `json:"before_bytes"`
}

func WorkerDeviceResult(c *gin.Context) {
	if !authWorker(c) {
		return
	}
	deployID, _ := strconv.Atoi(c.Param("id"))

	var req deviceResultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var child entity.ConfigDeployResult
	if err := config.DB().
		Where("id = ? AND config_deploy_id = ?", req.ResultID, deployID).
		First(&child).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "result not found"})
		return
	}

	now := time.Now()
	child.Status = req.Status
	child.Output = req.Output
	child.Error = req.Error
	child.Diff = req.Diff
	child.Changed = req.Changed
	child.FinishedAt = &now

	// snapshot "ก่อน push" → เก็บเป็น ConfigBackup = จุด rollback (โผล่ในประวัติ backup ของอุปกรณ์)
	if req.BeforeContent != "" {
		rollback := entity.ConfigBackup{
			NetworkDeviceID: child.NetworkDeviceID,
			GitCommit:       "pre-deploy",
			Sha256:          req.BeforeSha,
			SizeBytes:       req.BeforeBytes,
			Lines:           req.BeforeLines,
		}
		// Encrypted at rest like every other stored configuration — see entity.ConfigBackup. This
		// snapshot is the rollback point for a push that is about to happen, and it is a whole
		// `show full-configuration` with the device's secrets in it.
		//
		// If it cannot be encrypted the row is not written and BeforeBackupID stays 0, which is
		// what already happened when the insert failed: the deploy has no rollback point and says
		// so, rather than acquiring one that is unreadable or one stored in the clear.
		if err := platform.SetBackupContent(&rollback, req.BeforeContent); err == nil {
			if err := config.DB().Create(&rollback).Error; err == nil {
				child.BeforeBackupID = rollback.ID
			}
		}
	}
	config.DB().Save(&child)

	finalizeIfDone(uint(deployID))
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// finalizeIfDone รวมสถานะงานแม่จากลูกทั้งหมด: ถ้าลูกเสร็จครบ → set แม่ finished
func finalizeIfDone(deployID uint) {
	var deploy entity.ConfigDeploy
	if err := config.DB().First(&deploy, deployID).Error; err != nil {
		return
	}

	var success, failed int64
	config.DB().Model(&entity.ConfigDeployResult{}).
		Where("config_deploy_id = ? AND status = ?", deployID, "SUCCESS").Count(&success)
	config.DB().Model(&entity.ConfigDeployResult{}).
		Where("config_deploy_id = ? AND status = ?", deployID, "FAILED").Count(&failed)
	done := success + failed

	updates := map[string]any{
		"success_count": success,
		"failed_count":  failed,
	}
	if int(done) >= deploy.TotalDevices {
		now := time.Now()
		updates["finished_at"] = &now
		switch {
		case failed == 0:
			updates["status"] = "SUCCESS"
		case success == 0:
			updates["status"] = "FAILED"
		default:
			updates["status"] = "PARTIAL"
		}
	}
	config.DB().Model(&entity.ConfigDeploy{}).Where("id = ?", deployID).Updates(updates)
}

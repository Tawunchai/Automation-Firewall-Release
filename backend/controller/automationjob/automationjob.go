package automationjob

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"network_automation/services/drift"
	"strconv"
	"strings"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/jobs"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

// ── Trigger Backup ───────────────────────────────────────────────────────────
// POST /devices/:id/backup  (admin | operator(=ทุก login user ตอนนี้))
// สร้าง AutomationJob (QUEUED) แล้ว enqueue เข้า Redis ให้ worker ทำ

// mayReachDevice applies per-user device access. Admins bypass it; see services.UserCanAccessDevice.
func mayReachDevice(c *gin.Context, deviceID uint) bool {
	uid, _ := c.Get("user_id")
	return services.UserCanAccessDevice(config.DB(), services.UserIDOf(uid), c.GetString("user_role") == "admin", deviceID)
}

func TriggerBackup(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var d entity.NetworkDevice
	if err := config.DB().First(&d, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	// A backup logs into the firewall and writes its whole running config into this platform's git
	// store, so it is squarely inside what a device grant governs. 404 for the usual reason.
	if !mayReachDevice(c, d.ID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	// ตรวจสอบ reachability ก่อน queue (ตอบผู้ใช้ทันทีถ้า device ไม่ตอบสนอง)
	if err := services.CheckReachability(d.MgmtIP, d.Port, services.DefaultReachabilityTimeout); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":     fmt.Sprintf("the device did not answer (%s:%d) — check the network, or whether the device is up", d.MgmtIP, d.Port),
			"reachable": false,
		})
		return
	}

	job, alreadyActive, err := jobs.EnqueueDeviceBackup(&d, c.GetString("user_email"))
	if err != nil {
		// "Nobody has nominated an account for this device" is a 30-second fix in the console, and
		// it used to be reported as "queue unavailable (redis?)" — which sends the reader to look at
		// infrastructure that is working fine. Pass the real message through for that one case.
		if errors.Is(err, services.ErrNoDeviceLogin) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "queue unavailable (redis?), or the credential could not be read"})
		return
	}
	if alreadyActive {
		c.JSON(http.StatusOK, gin.H{
			"data":    gin.H{"job_id": job.ID, "status": job.Status},
			"message": "a backup of this device is already running",
		})
		return
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"), fmt.Sprintf(
		"job_trigger_backup: job_id=%d device_id=%d device=%q", job.ID, d.ID, d.Name))

	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"job_id": job.ID, "status": job.Status}})
}

// ── List jobs ────────────────────────────────────────────────────────────────

// The job history is device-shaped data, so it is scoped like every other device-shaped list.
//
// It used to be the most recent N rows in the table, for everybody. An AutomationJob carries the
// Result the firewall or the worker produced, and the Preload hands the whole NetworkDevice row
// over with it — name, management IP, vendor, backup schedule. So /jobs told any signed-in account
// which firewalls exist, including the ones an admin never granted them, and what happened on
// them. Its single-device siblings TriggerBackup and ListDeviceBackups have always checked, which
// is exactly how a rule like this goes missing: on the path that lists many at once.
//
// automation_jobs REFERENCES a device (entity.AutomationJob.NetworkDeviceID), it is not the device
// table, so the filter is services.ScopeDeviceRefToUser — the sibling that predicates on
// network_device_id rather than on id. ScopeDevicesToUser would have filtered automation_jobs.id by
// device ids: no error, no empty page, just the wrong rows, which is the symptom
// services/deviceaccess.go warns about. Composing the filter into the query (rather than reading
// the rows and dropping some afterwards) also keeps LIMIT meaning "100 of mine" instead of "the
// subset of the newest 100 in the fleet that happen to be mine".
//
// A job with NO device — network_device_id 0 — is not reachable by any grant, so a non-admin never
// sees one and an admin, who is not filtered at all, still does. jobs.EnqueueDeviceBackup always
// stamps a device id, so this is a rule for rows that should not exist rather than for a case the
// dashboard depends on; the point is that the fail-closed direction does not hide anything from
// the one role that could act on it.
func ListJobs(c *gin.Context) {
	limit := 100
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	var jobs []entity.AutomationJob
	q := config.DB().Order("id DESC").Limit(limit).Preload("NetworkDevice")
	if devID := c.Query("device_id"); devID != "" {
		q = q.Where("network_device_id = ?", devID)
	}
	uid, _ := c.Get("user_id")
	q = services.ScopeDeviceRefToUser(q, config.DB(), services.UserIDOf(uid), c.GetString("user_role") == "admin")
	if err := q.Find(&jobs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch jobs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": jobs})
}

func GetJob(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var job entity.AutomationJob
	if err := config.DB().Preload("NetworkDevice").First(&job, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	// The id is sequential and comes straight off the URL, so without this a caller could walk
	// 1..N and read every job on every firewall — result text and the preloaded device row.
	//
	// 404 with the SAME message as the row-missing branch above, not 403: a 403 here would confirm
	// that job #N exists and belongs to a device, which is the enumeration this closes, and which
	// firewalls exist is not public. Same wording and same reasoning as
	// controller/devicecredential/devicecredential.go and loadBackupForCaller below.
	if !mayReachDevice(c, job.NetworkDeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": job})
}

// ── List backups ของอุปกรณ์ ──────────────────────────────────────────────────

func ListDeviceBackups(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if !mayReachDevice(c, uint(id)) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	var backups []entity.ConfigBackup
	// ไม่ดึง column "content" (ใหญ่ ~1MB/แถว) ในหน้า list — ดึงเฉพาะตอนกดดู/โหลด
	if err := config.DB().
		Select("id", "created_at", "network_device_id", "automation_job_id",
			"git_commit", "sha256", "path", "size_bytes", "lines", "diff_summary").
		Where("network_device_id = ?", id).
		Order("id DESC").Limit(100).Find(&backups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch backups"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": backups})
}

// ── Worker callback (internal) ───────────────────────────────────────────────
// POST /internal/jobs/:id/result   header: X-Worker-Secret
// worker รายงานผลกลับ → อัปเดต Job + บันทึก ConfigBackup

type resultRequest struct {
	Status      string `json:"status"` // SUCCESS | FAILED
	Result      string `json:"result"`
	GitCommit   string `json:"git_commit"`
	Sha256      string `json:"sha256"`
	Path        string `json:"path"`
	SizeBytes   int    `json:"size_bytes"`
	Lines       int    `json:"lines"`
	Content     string `json:"content"`      // เนื้อ config เต็ม
	DiffSummary string `json:"diff_summary"` // worker ส่งมา (อาจว่าง — backend คำนวณเองเป็น fallback)
}

// diffSummary คำนวณ "+added/-removed lines" แบบ set-difference (ไม่ต้องใช้ library ภายนอก)
func diffSummary(oldContent, newContent string) string {
	if oldContent == "" {
		return ""
	}
	count := func(s string) map[string]int {
		m := make(map[string]int)
		for _, l := range strings.Split(s, "\n") {
			m[l]++
		}
		return m
	}
	oldM, newM := count(oldContent), count(newContent)
	added, removed := 0, 0
	for l, n := range newM {
		if d := n - oldM[l]; d > 0 {
			added += d
		}
	}
	for l, n := range oldM {
		if d := n - newM[l]; d > 0 {
			removed += d
		}
	}
	return fmt.Sprintf("+%d/-%d lines", added, removed)
}

func WorkerResult(c *gin.Context) {
	if !platform.WorkerAuthOK(c.GetHeader("X-Worker-Secret")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker secret"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	var job entity.AutomationJob
	if err := config.DB().First(&job, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	var req resultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now()
	job.Status = req.Status
	// A bare "authentication failed" points the operator at the firewall. When the job ran on the
	// unmaintained credential from the device row, the fix is somewhere else entirely — say which.
	// See diagnose.go.
	job.Result = req.Result
	if req.Status == "FAILED" {
		var device entity.NetworkDevice
		if config.DB().First(&device, job.NetworkDeviceID).Error == nil {
			job.Result = annotateJobResult(
				req.Status, req.Result,
				services.AutomationLoginIsLegacy(config.DB(), &device),
			)
		}
	}
	job.FinishedAt = &now

	// บันทึก ConfigBackup เฉพาะเมื่อ backup สำเร็จ + config เปลี่ยนจริง
	if req.Status == "SUCCESS" && job.Type == "backup" {
		var last entity.ConfigBackup
		dupErr := config.DB().
			Select("id", "sha256", "content").
			Where("network_device_id = ?", job.NetworkDeviceID).
			Order("id DESC").First(&last).Error

		if dupErr == nil && req.Sha256 != "" && last.Sha256 == req.Sha256 {
			job.Result = fmt.Sprintf("no config change (identical to backup #%d)", last.ID)
		} else {
			// คำนวณ diff — ใช้ค่าจาก worker ถ้ามี ไม่งั้น fallback คำนวณเอง
			//
			// The previous backup is stored encrypted, so the fallback has to decrypt it first. A
			// failure there costs a line count and nothing else, so it is logged and the diff is
			// left empty — the same as the "no previous backup" case — rather than failing a backup
			// that otherwise succeeded.
			diff := req.DiffSummary
			if diff == "" && dupErr == nil {
				if prev, dErr := platform.BackupContent(last); dErr == nil {
					diff = diffSummary(prev, req.Content)
				} else {
					log.Printf("backup #%d: no diff summary — %v", last.ID, dErr)
				}
			}
			backup := entity.ConfigBackup{
				NetworkDeviceID: job.NetworkDeviceID,
				AutomationJobID: job.ID,
				GitCommit:       req.GitCommit,
				Sha256:          req.Sha256,
				Path:            req.Path,
				SizeBytes:       req.SizeBytes,
				Lines:           req.Lines,
				DiffSummary:     diff,
			}
			// The configuration file is encrypted before it is stored — see entity.ConfigBackup.
			// If that cannot be done the row is NOT written: a backup nobody can decrypt is not a
			// restore point, and storing the file in the clear instead is the thing this prevents.
			encErr := platform.SetBackupContent(&backup, req.Content)
			if encErr != nil {
				job.Status = "FAILED"
				job.Result = "backup on disk but could not be stored: " + encErr.Error()
			} else if err := config.DB().Create(&backup).Error; err != nil {
				job.Status = "FAILED"
				job.Result = "backup on disk but DB insert failed: " + err.Error()
			} else {
				// A fresh backup is the only moment the platform can tell whether anybody edited
				// this firewall outside the console: it now has "before" and "after" plus the
				// ledger of what we ourselves did in between. Runs in the background — the worker
				// is waiting on this response and has no business paying for the comparison.
				drift.AnalyseDriftAfterBackup(config.DB(), job.NetworkDeviceID, backup.ID)
			}
		}
		config.DB().Model(&entity.NetworkDevice{}).Where("id = ?", job.NetworkDeviceID).
			Update("last_backup_at", &now)
	}

	if err := config.DB().Save(&job).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update job"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// ── Force-reset stuck job (admin) ────────────────────────────────────────────
// POST /jobs/:id/reset
// บังคับ job ที่ค้างอยู่ใน QUEUED/RUNNING ให้เป็น FAILED ทันที
// ใช้เมื่อ worker crash แล้ว job ไม่ยอม complete เองตามธรรมชาติ

func ResetJob(c *gin.Context) {
	if c.GetString("user_role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	var job entity.AutomationJob
	if err := config.DB().First(&job, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	if job.Status != "QUEUED" && job.Status != "RUNNING" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only a job in QUEUED or RUNNING can be reset"})
		return
	}
	now := time.Now()
	job.Status = "FAILED"
	job.Result = fmt.Sprintf("reset by admin (%s) — press Backup again to retry", c.GetString("user_email"))
	job.FinishedAt = &now
	if err := config.DB().Save(&job).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset job"})
		return
	}
	services.LogActivity(config.DB(), c.GetUint("user_id"),
		fmt.Sprintf("job_reset: job_id=%d device_id=%d", job.ID, job.NetworkDeviceID))
	c.JSON(http.StatusOK, gin.H{"message": "reset — press Backup to retry", "data": gin.H{"job_id": job.ID, "status": job.Status}})
}

// ── Worker health check ───────────────────────────────────────────────────────
// GET /worker/health — ตรวจสอบว่า Python worker ยังทำงานอยู่หรือไม่
// Worker ส่ง heartbeat ทุก ~30 วินาทีไปที่ Redis key "worker:heartbeat" (TTL 60s)
// ถ้า key หาย = worker ไม่ได้ทำงาน

func WorkerHealth(c *gin.Context) {
	ctx := c.Request.Context()
	rdb := platform.Redis()
	val, err := rdb.Get(ctx, "worker:heartbeat").Result()
	if err != nil {
		// Key ไม่มี → worker ไม่ได้ทำงาน หรือ Redis ใช้งานไม่ได้
		c.JSON(http.StatusOK, gin.H{
			"online":    false,
			"last_seen": nil,
			"message":   "Worker is not running or Redis is unreachable",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"online":    true,
		"last_seen": val,
		"message":   "Worker is online",
	})
}

// ── Worker mark RUNNING (internal, optional) ─────────────────────────────────

func WorkerStart(c *gin.Context) {
	if !platform.WorkerAuthOK(c.GetHeader("X-Worker-Secret")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker secret"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	now := time.Now()
	config.DB().Model(&entity.AutomationJob{}).Where("id = ?", id).
		Updates(map[string]any{"status": "RUNNING", "started_at": &now})
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// ── ดู / ดาวน์โหลด เนื้อ config backup ────────────────────────────────────────

// loadBackupWithDevice ดึง ConfigBackup + ชื่ออุปกรณ์ (ไว้ตั้งชื่อไฟล์)
//
// A variable rather than a plain function for one reason: config.DB() is a package-level handle
// with no test seam, so the authorization guard in loadBackupForCaller could not otherwise be
// exercised without a live Postgres. The guard — the part that was missing, and the part worth
// pinning — is the real one in those tests; only the row it reads is supplied.
var loadBackupWithDevice = func(id int) (*entity.ConfigBackup, *entity.NetworkDevice, bool) {
	var b entity.ConfigBackup
	if err := config.DB().First(&b, id).Error; err != nil {
		return nil, nil, false
	}
	var d entity.NetworkDevice
	config.DB().First(&d, b.NetworkDeviceID)
	return &b, &d, true
}

// loadBackupForCaller is loadBackupWithDevice plus per-user device access, and is the only way the
// three /backups/:id handlers may reach a row.
//
// ConfigBackup.Content is the device's entire `show full-configuration`: IPsec pre-shared keys,
// SNMP communities, administrator password hashes, every VPN peer. The id is sequential and comes
// straight off the URL, so without this check any signed-in account could walk 1..N and read the
// running configuration of every firewall in the inventory — including the ones they were never
// granted. ListDeviceBackups has always applied mayReachDevice; these three never did, and they
// are the ones that hand over the contents.
//
// 404 and not 403, exactly like mayReachDevice's other callers: a 403 would confirm that the
// backup id exists and that it belongs to a device, which is the enumeration this closes. "Not
// found" is also the honest answer — a backup of a firewall you hold no grant for is, as far as
// this account is concerned, not there.
func loadBackupForCaller(c *gin.Context, id int) (*entity.ConfigBackup, *entity.NetworkDevice, bool) {
	b, d, ok := loadBackupWithDevice(id)
	if !ok || !mayReachDevice(c, b.NetworkDeviceID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return nil, nil, false
	}
	return b, d, true
}

// GET /backups/:id/content → คืนเนื้อ config (ไว้ดูในหน้าเว็บ)
func GetBackupContent(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	b, d, ok := loadBackupForCaller(c, id)
	if !ok {
		return
	}
	content, err := platform.BackupContent(*b)
	if err != nil {
		// Reported, never papered over with an empty string: a viewer who is shown a blank
		// configuration concludes the firewall has none.
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":         b.ID,
		"device":     d.Name,
		"git_commit": b.GitCommit,
		"lines":      b.Lines,
		"size_bytes": b.SizeBytes,
		"created_at": b.CreatedAt,
		"content":    content,
	}})
}

// GET /backups/:id/download → ดาวน์โหลดเป็นไฟล์ .conf
func DownloadBackup(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	b, d, ok := loadBackupForCaller(c, id)
	if !ok {
		return
	}
	content, err := platform.BackupContent(*b)
	if err != nil {
		// Before the Content-Disposition header: a downloaded .conf file that is actually an error
		// message, or empty, is worse than a failed download.
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filename := d.Name + "_" + b.CreatedAt.Format("20060102-150405") + ".conf"
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(content))
}

// DELETE /backups/:id → ลบ ConfigBackup 1 รายการ (admin only)
// Content ของ backup เก็บอยู่ใน DB ทั้งก้อน การลบคือลบ row ทิ้ง — git history ไม่ถูกแตะ
// (rollback/compliance ที่เคยอ้าง backup นี้จะไม่พบ row นี้อีก ซึ่งเป็นผลที่ตั้งใจของการลบ)
func DeleteBackup(c *gin.Context) {
	if c.GetString("user_role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	// Admin-gated above, and an admin reaches every device by the rule in services/deviceaccess.go,
	// so the device check below changes nothing today. It is here so that the three handlers that
	// address a backup by id share ONE way in: the day a tier between "user" and "admin" can delete
	// a backup, this one does not have to be remembered.
	b, _, ok := loadBackupForCaller(c, id)
	if !ok {
		return
	}
	if err := config.DB().Delete(&entity.ConfigBackup{}, b.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete backup"})
		return
	}
	services.LogActivity(config.DB(), c.GetUint("user_id"),
		fmt.Sprintf("backup_delete: backup_id=%d device_id=%d", b.ID, b.NetworkDeviceID))
	c.JSON(http.StatusOK, gin.H{"message": "backup deleted"})
}

// ── Batch Backup ─────────────────────────────────────────────────────────────
// POST /devices/batch-backup
// body: {"device_ids":[1,2,3]}  หรือ {} = ทุกเครื่องที่ status=active
// reachability check 2s ต่อเครื่อง — ขนานผ่าน services.CheckReachabilityAll

// batchProbeTimeout is deliberately shorter than DefaultReachabilityTimeout: this is a
// pre-flight filter over the whole inventory, not the single-device "Ping" button, and a device
// that needs more than two seconds to accept a TCP connection is not one to start an SSH backup
// against anyway.
const batchProbeTimeout = 2 * time.Second

type batchBackupRequest struct {
	DeviceIDs []uint `json:"device_ids"`
}

func BackupBatch(c *gin.Context) {
	var req batchBackupRequest
	_ = c.ShouldBindJSON(&req)

	var devices []entity.NetworkDevice
	q := config.DB().Where("status = ?", "active")
	if len(req.DeviceIDs) > 0 {
		q = q.Where("id IN ?", req.DeviceIDs)
	}
	// Per-user device access — the same rule TriggerBackup applies one device at a time.
	//
	// Without it, "back up everything" meant everything in the INVENTORY rather than everything
	// this person was granted: one click logged into firewalls they cannot even list and wrote
	// each one's running configuration into this platform's store, where /backups/:id/content
	// then hands it back. An empty device_ids list means "all of mine", never "all of them", and
	// an explicit list is filtered too — the ids come from the request body.
	uid, _ := c.Get("user_id")
	q = services.ScopeDevicesToUser(q, config.DB(), services.UserIDOf(uid), c.GetString("user_role") == "admin")
	if err := q.Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "the device list could not be loaded"})
		return
	}

	// Probe every device at once. Serially, an unreachable device cost the full timeout each —
	// so a rack of twenty dead devices turned this into a 40-second request. The probes are pure
	// waiting, so the batch now costs about one timeout no matter how many devices there are.
	targets := make([]services.ReachTarget, len(devices))
	for i, d := range devices {
		targets[i] = services.ReachTarget{Host: d.MgmtIP, Port: d.Port}
	}
	reachErrs := services.CheckReachabilityAll(targets, batchProbeTimeout)

	email := c.GetString("user_email")
	queued, skipped, unreachable := 0, 0, 0
	for i, d := range devices {
		if reachErrs[i] != nil {
			unreachable++
			continue
		}
		_, already, err := jobs.EnqueueDeviceBackup(&d, email)
		if err != nil {
			continue
		}
		if already {
			skipped++
		} else {
			queued++
		}
	}

	services.LogActivity(config.DB(), c.GetUint("user_id"),
		fmt.Sprintf("batch_backup: queued=%d skipped=%d unreachable=%d", queued, skipped, unreachable))

	c.JSON(http.StatusAccepted, gin.H{
		"queued":      queued,
		"skipped":     skipped,
		"unreachable": unreachable,
		"total":       len(devices),
	})
}

// ── Network overview (dashboard) ─────────────────────────────────────────────
// GET /network/overview  (ทุก login user — แต่เห็นเฉพาะอุปกรณ์ที่ตัวเองได้รับสิทธิ์ ดู overviewScope)
// คืนสรุปภาพรวม network: อุปกรณ์ / งาน / backup / สิ่งที่ต้องดูแล + งานล่าสุด
// aggregate ใน SQL ทั้งหมด (แม่นกว่าการนับจาก list ที่ถูก limit ฝั่ง frontend)
//
// This used to issue TWELVE round trips: eleven separate COUNT/SUM/GROUP BY statements over three
// tables, plus a Preload for the recent-jobs list. Every one of them re-read a table this handler
// had already read, for a page that is polled. They collapse into FOUR — one per table, plus the
// recent-jobs join — because Postgres can compute all of a table's aggregates in a single pass
// with COUNT(*) FILTER, and a GROUP BY on (vendor, status) carries both breakdowns at once.
//
// staleBackupAge is how long a device may go without a successful backup before the dashboard
// asks someone to look at it.
const staleBackupAge = 7 * 24 * time.Hour

type recentJob struct {
	ID         uint       `json:"id"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	DeviceName string     `json:"device_name"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

// deviceStatRow is one (vendor, status) bucket, carrying the whole-table conditional counts
// alongside it. The conditional columns repeat the same value on every row — Postgres computes
// them per group — so the Go side SUMS them back up rather than reading one row.
type deviceStatRow struct {
	Vendor        string     `gorm:"column:vendor"`
	Status        string     `gorm:"column:status"`
	Count         int64      `gorm:"column:count"`
	BackupEnabled int64      `gorm:"column:backup_enabled"`
	NeverBackedUp int64      `gorm:"column:never_backed_up"`
	Stale         int64      `gorm:"column:stale"`
	LastBackupAt  *time.Time `gorm:"column:last_backup_at"`
}

// deviceStats is the shape the response's "devices" and "attention" sections are built from.
type deviceStats struct {
	Total         int64
	BackupEnabled int64
	NeverBackedUp int64
	Stale         int64
	LastBackupAt  *time.Time
	ByVendor      map[string]int64
	ByStatus      map[string]int64
}

// foldDeviceStats reduces the grouped rows back to whole-table figures.
//
// Kept separate from the query so the folding rules — especially "sum the per-group conditional
// counts" and "the latest last_backup_at is the max across groups" — can be tested without a
// database. Getting either wrong would silently under-report on the dashboard.
func foldDeviceStats(rows []deviceStatRow) deviceStats {
	out := deviceStats{
		ByVendor: make(map[string]int64, len(rows)),
		ByStatus: make(map[string]int64, len(rows)),
	}
	for _, r := range rows {
		out.Total += r.Count
		out.BackupEnabled += r.BackupEnabled
		out.NeverBackedUp += r.NeverBackedUp
		out.Stale += r.Stale
		out.ByVendor[r.Vendor] += r.Count
		out.ByStatus[r.Status] += r.Count
		if r.LastBackupAt != nil && (out.LastBackupAt == nil || r.LastBackupAt.After(*out.LastBackupAt)) {
			out.LastBackupAt = r.LastBackupAt
		}
	}
	return out
}

// jobStatRow is one status bucket for automation_jobs.
type jobStatRow struct {
	Status  string `gorm:"column:status"`
	Count   int64  `gorm:"column:count"`
	Last24h int64  `gorm:"column:last_24h"`
}

type jobStats struct {
	Total       int64
	Last24h     int64
	ByStatus    map[string]int64
	SuccessRate float64
}

// foldJobStats reduces the grouped rows and derives the success rate.
//
// The rate is SUCCESS / (SUCCESS + FAILED) — deliberately not SUCCESS / Total, because jobs still
// QUEUED or RUNNING have not succeeded or failed yet and counting them as failures would make a
// healthy system look broken the moment a batch was queued.
func foldJobStats(rows []jobStatRow) jobStats {
	out := jobStats{ByStatus: make(map[string]int64, len(rows))}
	for _, r := range rows {
		out.Total += r.Count
		out.Last24h += r.Last24h
		out.ByStatus[r.Status] += r.Count
	}
	if done := out.ByStatus["SUCCESS"] + out.ByStatus["FAILED"]; done > 0 {
		out.SuccessRate = float64(out.ByStatus["SUCCESS"]) / float64(done) * 100
	}
	return out
}

// overviewScope limits every aggregate below to the devices the caller may reach.
//
// GET /network/overview had no scoping at all: it answered every signed-in account with fleet-wide
// figures — how many firewalls this platform manages, their vendors and statuses, how many have
// never been backed up, the total size of every stored configuration. A user granted one device
// learned the shape of the whole estate from a dashboard that was supposed to be theirs.
//
// Scoped rather than made admin-only, which was the other honest option. The page stays useful to
// a non-admin — it becomes "my estate" instead of "the estate" — and nothing depends on the
// fleet-wide reading: nothing in frontend/src calls /network/overview at all today (the dashboard
// at /admin/dashboard reads live per-device monitor endpoints, GetDeviceDashboard / GetDeviceUsage),
// so there is no caller to re-point and no number to re-label. An admin-only route would also have
// left the whole endpoint dark for exactly the accounts per-user device access exists to serve.
//
// Deliberately mirrors services.DeviceScope, and takes its ids from the same grant lookup every
// other list uses, services.AccessibleDeviceIDs: the rule lives in one place. It cannot use the
// composable services.Scope*ToUser filters because these four statements are raw SQL — one
// aggregate pass per table — which is the same reason controller/configdeploy's
// scopeDeploysToCaller goes through AccessibleDeviceIDs.
type overviewScope struct {
	unfiltered bool   // admin: every device, no predicate at all
	ids        []uint // the granted ids; only meaningful when !unfiltered
}

// on is the AND-fragment restricting `column` to the caller's devices — "" for an admin.
//
// `column` is always a literal from this file, never anything a request supplied, and the ids go
// in as query ARGUMENTS (see vars). Nothing from the request is ever formatted into the SQL.
func (s overviewScope) on(column string) string {
	switch {
	case s.unfiltered:
		return ""
	case len(s.ids) == 0:
		// Granted nothing matches nothing — never "everything", which is how a filter like this
		// stops existing.
		return " AND 1 = 0"
	default:
		return " AND " + column + " IN ?"
	}
}

// vars appends the arguments `on` needs to the ones a statement already carries, keeping the
// placeholder order of each statement: its own SELECT-clause arguments first, then the scope.
func (s overviewScope) vars(own ...any) []any {
	if s.unfiltered || len(s.ids) == 0 {
		return own
	}
	return append(own, s.ids)
}

// scopeOverviewToCaller resolves the caller's scope, reporting false if the grants are unreadable.
//
// A database error is not permission: the handler answers 500 rather than falling back to the
// fleet-wide figures this is here to stop (services/deviceaccess.go, same rule).
func scopeOverviewToCaller(c *gin.Context) (overviewScope, bool) {
	if c.GetString("user_role") == "admin" {
		return overviewScope{unfiltered: true}, true // no query at all, as everywhere else
	}
	ids, err := services.AccessibleDeviceIDs(config.DB(), c.GetUint("user_id"))
	if err != nil {
		return overviewScope{}, false
	}
	return overviewScope{ids: ids}, true
}

func NetworkOverview(c *gin.Context) {
	db := config.DB()
	now := time.Now()

	scope, ok := scopeOverviewToCaller(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read your device access"})
		return
	}

	// ── Devices: one pass over network_devices ────────────────────────────────
	// GROUP BY (vendor, status) carries both breakdowns; the FILTER columns carry the rest.
	var deviceRows []deviceStatRow
	db.Raw(`
		SELECT vendor,
		       status,
		       COUNT(*)                                                          AS count,
		       COUNT(*) FILTER (WHERE backup_enabled)                            AS backup_enabled,
		       COUNT(*) FILTER (WHERE status = 'active'
		                          AND last_backup_at IS NULL)                    AS never_backed_up,
		       COUNT(*) FILTER (WHERE status = 'active'
		                          AND last_backup_at IS NOT NULL
		                          AND last_backup_at < ?)                        AS stale,
		       MAX(last_backup_at)                                               AS last_backup_at
		  FROM network_devices
		 WHERE deleted_at IS NULL`+scope.on("id")+`
		 GROUP BY vendor, status
	`, scope.vars(now.Add(-staleBackupAge))...).Scan(&deviceRows)
	devices := foldDeviceStats(deviceRows)

	// ── Jobs: one pass over automation_jobs ───────────────────────────────────
	var jobRows []jobStatRow
	db.Raw(`
		SELECT status,
		       COUNT(*)                                  AS count,
		       COUNT(*) FILTER (WHERE created_at >= ?)   AS last_24h
		  FROM automation_jobs
		 WHERE deleted_at IS NULL`+scope.on("network_device_id")+`
		 GROUP BY status
	`, scope.vars(now.Add(-24*time.Hour))...).Scan(&jobRows)
	jobs := foldJobStats(jobRows)

	// ── Backups: one pass over config_backups ─────────────────────────────────
	var backups struct {
		Total     int64 `gorm:"column:total"`
		TotalSize int64 `gorm:"column:total_size"`
	}
	db.Raw(`
		SELECT COUNT(*)                          AS total,
		       COALESCE(SUM(size_bytes), 0)      AS total_size
		  FROM config_backups
		 WHERE deleted_at IS NULL`+scope.on("network_device_id"), scope.vars()...).Scan(&backups)

	// ── Recent jobs (8 ล่าสุด) ────────────────────────────────────────────────
	// A LEFT JOIN, not a Preload: Preload is a second query, and the device row is wanted for
	// nothing but its name. LEFT so a job whose device was deleted still appears — for an admin,
	// who is unfiltered. For everybody else a job the grants cannot reach is not theirs to read,
	// and a hard-deleted device takes its grants with it (services.PurgeDeviceGrantsForDevice).
	var recent []recentJob
	db.Raw(`
		SELECT j.id,
		       j.type,
		       j.status,
		       COALESCE(d.name, '') AS device_name,
		       j.finished_at,
		       j.created_at
		  FROM automation_jobs j
		  LEFT JOIN network_devices d ON d.id = j.network_device_id
		 WHERE j.deleted_at IS NULL`+scope.on("j.network_device_id")+`
		 ORDER BY j.id DESC
		 LIMIT 8
	`, scope.vars()...).Scan(&recent)
	if recent == nil {
		recent = []recentJob{}
	}

	c.JSON(http.StatusOK, gin.H{
		"devices": gin.H{
			"total":          devices.Total,
			"backup_enabled": devices.BackupEnabled,
			"by_vendor":      devices.ByVendor,
			"by_status":      devices.ByStatus,
		},
		"jobs": gin.H{
			"total":        jobs.Total,
			"by_status":    jobs.ByStatus,
			"success_rate": jobs.SuccessRate,
			"last_24h":     jobs.Last24h,
		},
		"backups": gin.H{
			"total":            backups.Total,
			"total_size_bytes": backups.TotalSize,
			"last_backup_at":   devices.LastBackupAt,
		},
		"attention": gin.H{
			"never_backed_up": devices.NeverBackedUp,
			"stale":           devices.Stale,
		},
		"recent_jobs": recent,
	})
}

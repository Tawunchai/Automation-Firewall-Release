// Package jobs รวม logic การสร้าง+enqueue งาน automation
// ใช้ร่วมกันระหว่าง HTTP handler (ผู้ใช้กดเอง) และ scheduler (auto)
// แยกออกมาเพื่อเลี่ยง import cycle (services importไม่ได้ config)
package jobs

import (
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/robfig/cron/v3"
)

// cron parser แบบ 5-field มาตรฐาน (นาที ชม. วัน เดือน วันในสัปดาห์)
var cronParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow,
)

// NextRun คำนวณเวลารันรอบถัดไปจาก cron spec (จาก time ที่กำหนด)
func NextRun(spec string, from time.Time) (*time.Time, error) {
	sched, err := cronParser.Parse(spec)
	if err != nil {
		return nil, err
	}
	next := sched.Next(from)
	return &next, nil
}

// EnqueueDeviceBackup สร้าง AutomationJob (QUEUED) + ดันเข้า Redis ให้ worker
// คืน (job, alreadyActive, err):
//   - alreadyActive=true ถ้ามีงาน backup ของอุปกรณ์นี้ค้างอยู่ (ไม่สร้างซ้ำ)
func EnqueueDeviceBackup(d *entity.NetworkDevice, triggeredBy string) (*entity.AutomationJob, bool, error) {
	// กันซ้ำ: มีงาน backup ค้าง (QUEUED/RUNNING) → คืนตัวเดิม
	var active entity.AutomationJob
	if err := config.DB().
		Where("network_device_id = ? AND type = ? AND status IN ?",
			d.ID, "backup", []string{"QUEUED", "RUNNING"}).
		First(&active).Error; err == nil {
		return &active, true, nil
	}

	// Scheduled and manual backups both run as the device's nominated automation account, not as
	// whoever pressed the button: the worker runs the job minutes later, out of process, so there is
	// no session to borrow by then. See services.ResolveAutomationLogin.
	_, err := services.ResolveAutomationLogin(config.DB(), d)
	if err != nil {
		return nil, false, err
	}

	job := &entity.AutomationJob{
		Type:            "backup",
		Status:          "QUEUED",
		NetworkDeviceID: d.ID,
		TriggeredBy:     triggeredBy,
	}
	if err := config.DB().Create(job).Error; err != nil {
		return nil, false, err
	}

	// ResolveAutomationLogin above has already proved the credential exists and decrypts; this is
	// the only place a user (or the scheduler's log) can be told if it does not. The secret itself
	// stays here: the queue carries a single-use token the worker exchanges for it at connect time
	// — see services/jobcredential.go for what the old payload left in Redis's AOF.
	token, err := services.IssueJobCredential(services.JobCredentialClaim{
		Kind: services.JobCredentialBackup, JobID: job.ID, DeviceID: d.ID,
	})
	if err != nil {
		now := time.Now()
		job.Status = "FAILED"
		job.Result = "could not prepare this device's credential: " + err.Error()
		job.FinishedAt = &now
		config.DB().Save(job)
		return job, false, err
	}

	msg := platform.BackupJobMessage{
		JobID:           job.ID,
		DeviceID:        d.ID,
		Name:            d.Name,
		Host:            d.MgmtIP,
		Port:            d.Port,
		Platform:        d.Platform,
		CredentialToken: token,
	}
	if err := platform.EnqueueBackup(msg); err != nil {
		now := time.Now()
		job.Status = "FAILED"
		job.Result = "enqueue failed: " + err.Error()
		job.FinishedAt = &now
		config.DB().Save(job)
		return job, false, err
	}
	return job, false, nil
}

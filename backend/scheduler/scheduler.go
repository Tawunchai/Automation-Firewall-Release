// Package scheduler รัน goroutine เบื้องหลัง คอยสั่ง backup อัตโนมัติตามเวลาที่ตั้งไว้
// หลักการ: ทุก ๆ 1 นาที หาอุปกรณ์ที่ backup_enabled และ next_backup_at <= now
// → enqueue backup → คำนวณ next_backup_at รอบถัดไปจาก cron spec
//
// ออกแบบให้ทนทาน: next_backup_at เก็บใน DB → restart แล้วไม่ยิงซ้ำ/ไม่หลุด
package scheduler

import (
	"context"
	"log"
	"network_automation/services/drift"
	"network_automation/services/notify"
	"runtime/debug"
	"sync"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/jobs"
	"network_automation/services"
)

const (
	tickInterval    = 60 * time.Second
	staleJobTimeout = 5 * time.Minute // job ค้าง > 5 นาที → FAILED (ลดจาก 10 เพื่อ fail faster)
	staleCheckEvery = 3               // ตรวจทุก 3 ticks (3 นาที)

	// startupDelay lets the database and Redis settle before the first sweep.
	startupDelay = 10 * time.Second

	// hourlySweepEvery — how many ticks between the hourly retention sweeps (metric samples,
	// audit runs, drift runs, and the rest of runRetentionSweep).
	hourlySweepEvery = 60

	// metricSampleEvery — ticks between metric samples. Must stay equal to
	// services.MetricSampleInterval / tickInterval; TestMetricSampleEveryMatchesTheInterval pins
	// the pair, because the interval is what the API's own documentation promises a reader about
	// how far apart two points are.
	metricSampleEvery = 5
)

// stopper carries the shutdown signal and the handle main waits on.
//
// Why this exists: the loop used to be `go loop()` with `time.Sleep` and no way to stop it. main
// has a graceful shutdown that drains in-flight HTTP requests, but the scheduler ran straight
// through it — so a `docker compose down` could land in the middle of runDue, between "enqueue
// this backup into Redis" and "write the device's next_backup_at". The job is then queued but the
// device still looks due, and the next boot enqueues it a second time.
//
// Sleeping on a context instead of time.Sleep also means shutdown is immediate rather than
// however much of the 60-second tick happened to be left.
var (
	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
)

// Start เริ่ม scheduler (เรียกครั้งเดียวตอน boot)
func Start() {
	mu.Lock()
	defer mu.Unlock()
	if cancel != nil {
		return // already running
	}

	ctx, c := context.WithCancel(context.Background())
	d := make(chan struct{})
	cancel, done = c, d

	// `d`, not the package-level `done`: Stop clears that variable, so a deferred close(done)
	// would either close a nil channel (panic) or close the channel a LATER Start had just
	// created — signalling a loop that is still running as finished.
	go func() {
		defer close(d)
		loop(ctx)
	}()

	log.Println("✅ Backup scheduler started (tick every 60s, stale-job cleanup every 5 minutes)")
}

// Stop signals the loop and waits for it to finish the tick it is on, or until ctx expires.
// Safe to call when the scheduler was never started, and safe to call twice.
func Stop(ctx context.Context) {
	mu.Lock()
	c, d := cancel, done
	cancel, done = nil, nil
	mu.Unlock()

	if c == nil {
		return
	}
	c()

	select {
	case <-d:
		log.Println("✅ Backup scheduler stopped")
	case <-ctx.Done():
		// The sweep is mid-flight. Every step it takes is individually safe to abandon — the
		// duplicate guard in EnqueueDeviceBackup and next_backup_at in the database are what make
		// a restart correct, not this wait — so say so and move on rather than hanging shutdown.
		log.Println("⚠️  Backup scheduler did not stop in time — continuing shutdown")
	}
}

// sleep waits for d, or returns false as soon as the context is cancelled.
func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// guard runs one piece of scheduled work and turns a panic inside it into a logged, abandoned
// tick instead of a dead process.
//
// Recovery is PER TICK, not per goroutine. A `defer recover()` on the goroutine in Start would
// catch the panic and then leave the scheduler stopped for the rest of the process's life — the
// same outage as a crash, just quieter: backups, alerting, change requests, topology pings and
// metric sampling would all simply never run again, and nothing on screen would say so.
//
// Without either, a nil dereference anywhere in a sweep takes the whole backend down, including
// every HTTP request in flight at that moment: the panic unwinds this goroutine, not the handler's,
// so Gin's own recovery middleware never sees it.
//
// The panic is logged with its stack, never swallowed — an abandoned tick that left no trace is a
// scheduler that looks healthy while doing nothing.
func guard(what string, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[scheduler] %s panicked — this tick is abandoned, the next one will run: %v\n%s",
				what, r, debug.Stack())
		}
	}()
	fn()
}

func loop(ctx context.Context) {
	// รันรอบแรกหลัง boot สั้น ๆ แล้วค่อยทุก 60s
	if !sleep(ctx, startupDelay) {
		return
	}
	// cleanup stale jobs ทันทีตอน boot ป้องกัน job ค้างข้ามรอบ restart
	guard("startup stale-job cleanup", markStaleJobs)

	tick := 0
	for {
		// Counted here rather than inside runTick, so a tick that panics still advances the
		// schedule: the five-minute metric sample and the hourly retention sweep must not be
		// deferred for ever by one repeatedly failing sweep.
		tick++
		guard("tick", func() { runTick(ctx, time.Now(), tick) })
		if !sleep(ctx, tickInterval) {
			return
		}
	}
}

// runTick is one 60-second sweep, in its own function so guard can wrap the work without wrapping
// the timer: a panic in here costs one tick, never the loop.
func runTick(ctx context.Context, now time.Time, tick int) {
	runDue(ctx, now)
	// Alerting rides the same 60-second tick as the backup sweep rather than running its own
	// loop. That is not just tidiness: both reach the same firewalls, and two independent
	// timers would eventually collide on a device that locks an admin account after three
	// failed logins. services.NotifyPollInterval must stay equal to tickInterval — a rule's
	// "sustained for N polls" is expressed to the user in seconds derived from it, and
	// TestNotifyPollIntervalMatchesTick pins the pair together.
	runNotifySweep(now)
	runChangeRequestSweep(now)
	// The Topology map's pinned devices are pinged from this same tick, for the reason everything
	// else here is: the ping is an SSH session on a firewall that locks an admin account after
	// three failures, so it must share the one timer rather than run its own. Each device's own
	// interval decides whether it is due this tick (services.topologyDue).
	runTopologyPingSweep(now)
	// Metric sampling rides this tick too, for the reason stated just above: another timer is
	// another thing that can reach the same firewall at an unplanned moment, on units that lock
	// an admin account after three failures. Every fifth tick — see services.MetricSampleInterval
	// for why five minutes, and TestMetricSweepRidesTheTick for the pair being kept equal.
	if tick%metricSampleEvery == 0 {
		runMetricSweep(ctx, now)
	}
	if tick%staleCheckEvery == 0 {
		markStaleJobs()
	}
	if tick%hourlySweepEvery == 0 {
		// The fastest-growing table in the schema, bounded on the same hourly sweep as the rest.
		if n := services.PurgeOldMetricSamples(config.DB(), time.Now()); n > 0 {
			log.Printf("[scheduler] purged %d metric sample(s) past retention", n)
		}

		// Audit history is bounded on the same sweep. Each device keeps its oldest run whatever
		// its age — that row is the baseline every trend is measured from.
		if n := services.PurgeOldAuditRuns(config.DB(), time.Now()); n > 0 {
			log.Printf("[scheduler] purged %d audit runs past retention", n)
		}

		// Drift history is bounded on the same sweep and to the same horizon: it is the same
		// kind of evidence, kept for the same two annual review cycles.
		if n := drift.PurgeOldDriftRuns(config.DB(), time.Now()); n > 0 {
			log.Printf("[scheduler] purged %d drift runs past retention", n)
		}

		// The four tables that used to have no bound at all — see services/retention.go for
		// what each rule protects. They ride this sweep rather than one of their own for the
		// reason everything else here does: another timer is another thing that can reach a
		// database or a firewall at an unplanned moment.
		runRetentionSweep(time.Now())
	}
}

// runMetricSweep stores one reading per measurement per device, so the console can draw anything
// over time at all.
//
// Failures are the sweep's own problem, exactly as in runNotifySweep: a firewall that will not
// answer is one of the things this records, and nothing here may fail the tick that drives backups.
func runMetricSweep(ctx context.Context, now time.Time) {
	if config.DB() == nil {
		return
	}
	res := services.RunMetricSweep(ctx, config.DB(), now)
	// Logged only when something was written or something failed: a console with no devices should
	// not print a line every five minutes forever.
	if res.Samples > 0 || res.Errors > 0 {
		log.Printf("[scheduler] metrics: %d sample(s) from %d device(s), %d read(s) failed",
			res.Samples, res.Devices, res.Errors)
	}
}

// runRetentionSweep bounds the tables that only ever grew: the stored FortiOS configs, the change
// ledger, the app's activity trail and the sign-in records.
//
// Every count is logged only when it is non-zero, so a quiet hour says nothing rather than printing
// four zeroes an hour forever. The rules — and, more to the point, what each one deliberately
// refuses to delete — are in services/retention.go.
func runRetentionSweep(now time.Time) {
	db := config.DB()

	if n := services.PurgeOldConfigBackups(db, now); n > 0 {
		log.Printf("[scheduler] purged %d stored config backup(s) past retention", n)
	}
	if blanked, deleted := services.PurgeOldChangeRecords(db, now); blanked > 0 || deleted > 0 {
		log.Printf("[scheduler] change ledger: cleared %d snapshot body/bodies, deleted %d row(s) past retention",
			blanked, deleted)
	}
	if n := services.PurgeOldActivityLogs(db, now); n > 0 {
		log.Printf("[scheduler] purged %d activity log row(s) past retention", n)
	}
	if n := services.PurgeOldUserSessions(db, now); n > 0 {
		log.Printf("[scheduler] purged %d expired session record(s) past retention", n)
	}
}

// runNotifySweep polls every device that has an alert rule against it and delivers what changed.
//
// Failures inside the sweep are the sweep's own problem — a firewall that will not answer is one of
// the things it reports on — so nothing here can fail the tick that also drives backups.
func runNotifySweep(now time.Time) {
	if config.DB() == nil {
		return
	}
	res := notify.RunNotifySweep(config.DB(), now)
	if res.Fired > 0 || res.Resolved > 0 {
		log.Printf("[notify] %d device(s), %d rule check(s) → %d fired, %d resolved, %d suppressed by cooldown",
			res.Devices, res.Rules, res.Fired, res.Resolved, res.Suppressed)
	}
}

// runTopologyPingSweep pings every pinned Topology device whose interval has come round, through the
// firewall that owns line of sight to it, and records up/down/unknown for the 3D map.
//
// Failures are the sweep's own problem, exactly as in runNotifySweep: an unreachable target IS the
// reading, so nothing here can fail the tick that also drives backups and alerts.
func runTopologyPingSweep(now time.Time) {
	if config.DB() == nil {
		return
	}
	res := services.RunTopologyPingSweep(config.DB(), now)
	if res.Checked > 0 {
		log.Printf("[topology-ping] %d due → %d checked (%d up, %d down, %d unknown)",
			res.Due, res.Checked, res.Up, res.Down, res.Unknown)
	}
}

// runChangeRequestSweep applies approved requests whose maintenance window has arrived, and expires
// the pending ones nobody reviewed in time.
//
// On the same one-minute tick as the rest: a window is a window, not a deadline, and a request
// landing up to a minute into it is what an operator means by "apply it at 02:00". Failures are
// recorded on the request itself — a firewall that refuses a write is the thing this feature is
// for, not an error the sweep should hide.
func runChangeRequestSweep(now time.Time) {
	if config.DB() == nil {
		return
	}
	applied, failed, expired := services.RunChangeRequestSweep(config.DB(), now)
	if applied > 0 || failed > 0 || expired > 0 {
		log.Printf("[change-request] %d applied, %d failed, %d expired", applied, failed, expired)
	}
}

// markStaleJobs ค้นหา job ที่ค้างอยู่ใน QUEUED/RUNNING นานเกินกำหนด
// แล้วบังคับเป็น FAILED เพื่อให้ผู้ใช้ trigger backup ใหม่ได้
func markStaleJobs() {
	if config.DB() == nil {
		return
	}
	threshold := time.Now().Add(-staleJobTimeout)
	now := time.Now()
	result := config.DB().Model(&entity.AutomationJob{}).
		Where("status IN ? AND created_at < ?", []string{"QUEUED", "RUNNING"}, threshold).
		Updates(map[string]any{
			"status": "FAILED",
			// The message quotes staleJobTimeout so it can never drift from the constant again —
			// it used to say "10 minutes" while the threshold was five.
			"result":      "timeout: the worker did not answer within " + staleJobTimeout.String() + " — press Backup again to retry",
			"finished_at": &now,
		})
	if result.Error != nil {
		log.Printf("[scheduler] markStaleJobs error: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("[scheduler] ❗ marked %d stale job(s) as FAILED (threshold=%v)", result.RowsAffected, staleJobTimeout)
	}
}

// runDue หาอุปกรณ์ที่ถึงเวลา backup แล้วสั่งงาน
func runDue(ctx context.Context, now time.Time) {
	if config.DB() == nil {
		return
	}
	var devices []entity.NetworkDevice
	err := config.DB().
		Where("backup_enabled = ? AND status = ? AND next_backup_at IS NOT NULL AND next_backup_at <= ?",
			true, "active", now).
		Find(&devices).Error
	if err != nil {
		log.Printf("[scheduler] query devices error: %v", err)
		return
	}

	for i := range devices {
		// Shutting down mid-sweep: stop before starting ANOTHER device rather than in the middle
		// of one. A device not reached this round is still due next boot — next_backup_at has not
		// been advanced for it.
		if ctx.Err() != nil {
			log.Printf("[scheduler] shutting down — %d device(s) left for the next boot", len(devices)-i)
			return
		}

		d := &devices[i]

		// Say WHY before spending a job on a device that cannot authenticate.
		//
		// A device with no nominated account still had a backup queued every night; it ran, failed
		// on the unmaintained login left on the device row, and reported "check username/password"
		// — three retries against a firewall that locks an admin account after three failures, for
		// a problem no amount of checking the firewall would have found. See
		// services.DeviceAutomationReadiness.
		if readiness := services.DeviceAutomationReadiness(d); !readiness.OK() {
			log.Printf("[scheduler] %s: %s", d.Name, readiness.Warning)
		}

		_, active, err := jobs.EnqueueDeviceBackup(d, "scheduler")
		if err != nil {
			log.Printf("[scheduler] enqueue %s failed: %v", d.Name, err)
		} else if active {
			log.Printf("[scheduler] %s skipped — a backup is still outstanding", d.Name)
		} else {
			log.Printf("[scheduler] scheduled backup queued for %s (cron=%s)", d.Name, d.BackupCron)
		}

		// คำนวณเวลารอบถัดไปเสมอ (แม้ skip) กันยิงซ้ำในนาทีเดิม
		next, perr := jobs.NextRun(d.BackupCron, now)
		if perr != nil {
			// cron พัง → ปิด schedule อุปกรณ์นี้ กันลูปวิ่งฟรี
			log.Printf("[scheduler] %s has an invalid cron (%q) — auto backup disabled", d.Name, d.BackupCron)
			config.DB().Model(&entity.NetworkDevice{}).Where("id = ?", d.ID).
				Update("backup_enabled", false)
			continue
		}
		config.DB().Model(&entity.NetworkDevice{}).Where("id = ?", d.ID).
			Update("next_backup_at", next)
	}
}

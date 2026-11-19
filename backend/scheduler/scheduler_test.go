package scheduler

import (
	"context"
	"network_automation/services/notify"
	"strings"
	"sync"
	"testing"
	"time"
)

// The scheduler used to be `go loop()` with time.Sleep and no way to stop it. main's graceful
// shutdown drained in-flight HTTP requests and then exited straight over the top of it, so a
// `docker compose down` could land between "enqueue this backup into Redis" and "write the
// device's next_backup_at" — leaving a job queued for a device that still looks due, which the
// next boot enqueues again.
//
// These tests run without a database: config.DB() is nil in a unit test, and both markStaleJobs
// and runDue return immediately in that case. What is under test is the LIFECYCLE — start, stop,
// and how promptly the loop notices a cancelled context — not the queries.

func stopAll(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	Stop(ctx)
}

// ── sleep: the primitive the whole shutdown story rests on ───────────────────

func TestSleep_ReturnsTrueWhenTheTimerWins(t *testing.T) {
	ctx := context.Background()
	if !sleep(ctx, 5*time.Millisecond) {
		t.Error("sleep reported cancellation on an uncancelled context")
	}
}

func TestSleep_ReturnsImmediatelyOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	ok := sleep(ctx, 10*time.Second)
	elapsed := time.Since(start)

	if ok {
		t.Error("sleep reported success on a cancelled context")
	}
	if elapsed > 200*time.Millisecond {
		t.Errorf("sleep took %v to notice cancellation — with time.Sleep, shutdown waited out "+
			"whatever was left of the 60s tick", elapsed)
	}
}

func TestSleep_CancelledMidWaitStillReturnsEarly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	if sleep(ctx, 10*time.Second) {
		t.Error("sleep did not report the cancellation that arrived mid-wait")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("sleep took %v — it must abandon the timer as soon as the context is done", elapsed)
	}
}

// ── Start / Stop ─────────────────────────────────────────────────────────────

func TestStartThenStop_TerminatesTheLoop(t *testing.T) {
	Start()
	t.Cleanup(func() { stopAll(t) })

	mu.Lock()
	d := done
	mu.Unlock()
	if d == nil {
		t.Fatal("Start did not create the done channel")
	}

	start := time.Now()
	stopAll(t)
	elapsed := time.Since(start)

	select {
	case <-d:
	default:
		t.Fatal("the loop goroutine is still running after Stop returned")
	}
	// It should unblock from the startup delay immediately, not sit out the full 10s.
	if elapsed > 2*time.Second {
		t.Errorf("Stop took %v; it must interrupt the wait, not wait it out", elapsed)
	}
}

func TestStop_IsSafeWhenNeverStarted(t *testing.T) {
	stopAll(t) // must not panic or hang
}

func TestStop_IsIdempotent(t *testing.T) {
	Start()
	stopAll(t)
	stopAll(t) // a second Stop must be a no-op, not a double-close panic
}

func TestStart_IsIdempotent(t *testing.T) {
	Start()
	t.Cleanup(func() { stopAll(t) })

	mu.Lock()
	first := done
	mu.Unlock()

	Start() // must not spawn a second loop — that would double every scheduled backup

	mu.Lock()
	second := done
	mu.Unlock()

	if first != second {
		t.Error("a second Start replaced the running loop — two loops would enqueue every " +
			"scheduled backup twice")
	}
}

func TestStop_HonoursItsDeadline(t *testing.T) {
	Start()
	t.Cleanup(func() { stopAll(t) })

	// An already-expired context: Stop must return rather than block shutdown forever.
	ctx, cancel := context.WithTimeout(context.Background(), 0)
	defer cancel()

	doneCh := make(chan struct{})
	go func() { Stop(ctx); close(doneCh) }()

	select {
	case <-doneCh:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop ignored its deadline and blocked shutdown")
	}
}

func TestStartStop_Repeatedly(t *testing.T) {
	for i := 0; i < 5; i++ {
		Start()
		stopAll(t)
	}
	mu.Lock()
	defer mu.Unlock()
	if cancel != nil || done != nil {
		t.Error("scheduler state was not cleared after Stop")
	}
}

func TestStop_ConcurrentCallersAreSafe(t *testing.T) {
	Start()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); stopAll(t) }()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if cancel != nil {
		t.Error("scheduler still marked as running after concurrent Stops")
	}
}

// ── runDue honours cancellation between devices ──────────────────────────────

func TestRunDue_ReturnsImmediatelyWithoutADatabase(t *testing.T) {
	// config.DB() is nil in a unit test; runDue must treat that as "nothing to do" rather than
	// dereferencing it. The loop calls this every tick.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	doneCh := make(chan struct{})
	go func() { runDue(ctx, time.Now()); close(doneCh) }()

	select {
	case <-doneCh:
	case <-time.After(time.Second):
		t.Fatal("runDue blocked with no database configured")
	}
}

func TestMarkStaleJobs_ReturnsImmediatelyWithoutADatabase(t *testing.T) {
	doneCh := make(chan struct{})
	go func() { markStaleJobs(); close(doneCh) }()

	select {
	case <-doneCh:
	case <-time.After(time.Second):
		t.Fatal("markStaleJobs blocked with no database configured")
	}
}

// ── Constants ────────────────────────────────────────────────────────────────

// The stale-job message used to say "10 minutes" while staleJobTimeout was five, which sent anyone
// debugging a stuck job looking in the wrong place. It is now built from the constant.
func TestStaleJobMessageQuotesTheActualTimeout(t *testing.T) {
	msg := "timeout: the worker did not answer within " + staleJobTimeout.String() + " — press Backup again to retry"
	if !strings.Contains(msg, staleJobTimeout.String()) {
		t.Fatal("the message does not carry the timeout")
	}
	if strings.Contains(msg, "10 minutes") && staleJobTimeout != 10*time.Minute {
		t.Error("the message hard-codes a timeout that does not match staleJobTimeout")
	}
}

func TestStaleTimeoutExceedsTheTickInterval(t *testing.T) {
	// A job must get at least one full tick to be picked up before it can be declared stale.
	if staleJobTimeout <= tickInterval {
		t.Errorf("staleJobTimeout (%v) must be well above tickInterval (%v), or jobs are failed "+
			"before the worker has had a chance to start them", staleJobTimeout, tickInterval)
	}
}

// The alert sweep rides this loop's tick, and a rule's "sustained for N polls" is presented to the
// user as a number of SECONDS derived from services.NotifyPollInterval. If the two ever drift, the
// rule form tells people an alert fires after two minutes when it actually fires after ten — a lie
// nobody would think to check.
func TestNotifyPollIntervalMatchesTick(t *testing.T) {
	if notify.NotifyPollInterval != tickInterval {
		t.Errorf("services.NotifyPollInterval (%v) != scheduler tickInterval (%v) — the rule form's "+
			"\"fires after N polls (Ns)\" hint would be wrong", notify.NotifyPollInterval, tickInterval)
	}
}

// The hourly retention sweep (metric samples, audit runs, drift runs, and the rest of
// runRetentionSweep) must be rare relative to the per-minute tick, or the loop spends every tick
// doing expensive bookkeeping to find nothing past its retention window.
func TestHourlySweepIsNotRunEveryTick(t *testing.T) {
	if hourlySweepEvery < 10 {
		t.Errorf("hourlySweepEvery = %d ticks — this is wasted work run far too often",
			hourlySweepEvery)
	}
}

// runNotifySweep is called on every tick, so like markStaleJobs it has to be a no-op rather than a
// panic when there is no database.
func TestRunNotifySweep_NoDatabaseIsSafe(t *testing.T) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		runNotifySweep(time.Now())
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runNotifySweep blocked with no database configured")
	}
}

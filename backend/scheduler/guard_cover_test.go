package scheduler

import (
	"bytes"
	"context"
	"log"
	"strings"
	"testing"
	"time"
)

// guard is the reason a nil dereference inside one sweep does not take the backend down with it,
// and it had no test at all.
//
// It is worth more than its five lines suggest. The sweeps run on a goroutine of their own, so
// Gin's recovery middleware never sees a panic in here: without guard, a panic unwinds that
// goroutine and the Go runtime kills the PROCESS, dropping every HTTP request in flight. With the
// recover in the wrong place — on the goroutine in Start, which is the obvious place to put it —
// the process survives but the loop is gone for the rest of its life, so backups, alerting, change
// requests, topology pings and metric sampling all silently stop and nothing on screen says so.
//
// So three things are asserted: the panic does not escape, the loop is still usable afterwards,
// and the panic is LOGGED. The last one is not decoration — an abandoned tick that left no trace
// is a scheduler that looks healthy while doing nothing.
//
// No database and no Redis.

// captureLog redirects the standard logger for the duration of one test and returns what was
// written to it. The scheduler logs through the package-level logger, as the rest of this backend
// does, so this is the only way to see what it said.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})
	return &buf
}

func TestGuardRunsTheWorkAndReturns(t *testing.T) {
	ran := false
	guard("the happy path", func() { ran = true })
	if !ran {
		t.Fatal("guard did not call the function it was given")
	}
}

func TestGuardContainsAPanicAndSaysSo(t *testing.T) {
	buf := captureLog(t)

	// If guard did not recover, this would unwind the test goroutine and the whole test BINARY
	// would die — which is precisely the production failure being prevented.
	guard("a sweep that blew up", func() {
		var devices []string
		_ = devices[7] // index out of range, the shape a real sweep's bug takes
	})

	out := buf.String()
	for _, want := range []string{"a sweep that blew up", "panicked", "abandoned"} {
		if !strings.Contains(out, want) {
			t.Errorf("the log does not mention %q — a tick that is abandoned silently is a "+
				"scheduler that looks healthy while doing nothing.\nLogged:\n%s", want, out)
		}
	}
	// The stack, not just the message: "something panicked" with no location is a line nobody can
	// act on, and this is the only record that the tick happened at all.
	if !strings.Contains(out, "scheduler") || !strings.Contains(out, "goroutine") {
		t.Errorf("the log carries no stack trace:\n%s", out)
	}
}

// A nil panic value, which `panic(nil)` produces and which a sloppy `if r := recover(); r != nil`
// can miss. Go 1.21+ turns it into a *runtime.PanicNilError, so recover() is non-nil — this test
// pins that the containment does not depend on the panic value being interesting.
func TestGuardContainsAPanicWithNoUsefulValue(t *testing.T) {
	buf := captureLog(t)

	guard("panic(nil)", func() { panic(nil) })

	if out := buf.String(); !strings.Contains(out, "panicked") {
		t.Errorf("panic(nil) was swallowed without a word:\n%s", out)
	}
}

// The property that matters most: the NEXT tick still runs. A recover that is placed on the
// goroutine instead of per-tick passes the "does not crash" test above and fails this one.
func TestGuardIsPerTickSoTheNextOneStillRuns(t *testing.T) {
	captureLog(t)

	calls := 0
	for i := range 3 {
		guard("tick", func() {
			calls++
			if i == 0 {
				panic("the first tick fails")
			}
		})
	}

	if calls != 3 {
		t.Errorf("the work ran %d time(s) out of 3 — a panic in one tick must not stop the ones "+
			"after it", calls)
	}
}

// ── runTick: the fan-out itself ──────────────────────────────────────────────

// runTick is what the loop actually calls, and it was at 0%. These run it with no database
// configured, which is the state every unit test in this package is in: each sweep it calls has to
// treat that as "nothing to do" rather than dereferencing the handle.
//
// That is not a contrived case. It is the shape of the first ten seconds after a boot where
// Postgres is slow to accept connections — startupDelay exists for exactly that — and of any
// moment the connection has been lost. A panic here costs a tick; a panic that is NOT contained
// used to cost the process.
func TestRunTickIsSafeWithNoDatabase(t *testing.T) {
	captureLog(t)

	// Tick numbers chosen to reach every branch of the fan-out:
	//   1  — the four per-tick sweeps only
	//   3  — + markStaleJobs (tick%staleCheckEvery)
	//   5  — + the metric sweep (tick%metricSampleEvery)
	//   15 — both of the above on the same tick
	for _, tick := range []int{1, 3, 5, 15} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

		finished := make(chan struct{})
		go func() {
			defer close(finished)
			// Deliberately NOT wrapped in guard: a panic has to fail this test, not be logged.
			runTick(ctx, time.Now(), tick)
		}()

		select {
		case <-finished:
		case <-time.After(10 * time.Second):
			cancel()
			t.Fatalf("runTick(tick=%d) blocked with no database configured", tick)
		}
		cancel()
	}
}

// The hourly branch is excluded from the sweep above on purpose: it calls the retention purges,
// which take the database handle as an argument rather than checking it first. Pinning that it is
// NOT reached on an ordinary tick is the part that protects it — a `tick%1` would run six purge
// statements every minute.
func TestTheHourlyBranchIsNotReachedOnTheTicksAbove(t *testing.T) {
	for _, tick := range []int{1, 3, 5, 15} {
		if tick%hourlySweepEvery == 0 {
			t.Fatalf("tick %d reaches the hourly retention sweep, so "+
				"TestRunTickIsSafeWithNoDatabase is exercising more than it claims "+
				"(hourlySweepEvery = %d)", tick, hourlySweepEvery)
		}
	}
}

// runMetricSweep, runTopologyPingSweep and runChangeRequestSweep each guard the nil handle
// themselves, exactly as runNotifySweep does, and each is reached from runTick on a different
// schedule. Called directly as well so a regression names the sweep that lost its guard instead of
// failing as "runTick blocked".
func TestEverySweepGuardsTheNilDatabaseItself(t *testing.T) {
	captureLog(t)

	sweeps := map[string]func(){
		"runMetricSweep":        func() { runMetricSweep(context.Background(), time.Now()) },
		"runTopologyPingSweep":  func() { runTopologyPingSweep(time.Now()) },
		"runChangeRequestSweep": func() { runChangeRequestSweep(time.Now()) },
	}

	for name, sweep := range sweeps {
		t.Run(name, func(t *testing.T) {
			finished := make(chan struct{})
			go func() {
				defer close(finished)
				sweep()
			}()
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatalf("%s blocked with no database configured", name)
			}
		})
	}
}

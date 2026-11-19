package services

import (
	"sync/atomic"
	"testing"
	"time"
)

// Parallel replaced sequential fan-out in five places (the Firewall Policy form's fourteen name
// lists, the audit, the trace, and the Web/DNS filter metadata). It has to hold three properties or
// those five became bugs rather than speed-ups, and each is asserted below:
//
//	every function runs · none is left behind when it returns · they really do overlap

func TestParallel_RunsEveryFunction(t *testing.T) {
	const n = 14 // what DeviceGetPolicyProfiles fans out to
	var count int32
	fns := make([]func(), n)
	for i := 0; i < n; i++ {
		fns[i] = func() { atomic.AddInt32(&count, 1) }
	}

	Parallel(fns...)

	if got := atomic.LoadInt32(&count); got != n {
		t.Errorf("ran %d of %d functions", got, n)
	}
}

// The whole contract: nothing may still be running when Parallel returns, or a caller would
// assemble its response from variables that are still being written.
func TestParallel_WaitsForAllOfThem(t *testing.T) {
	var done [8]bool
	fns := make([]func(), len(done))
	for i := range done {
		fns[i] = func() {
			// Stagger them so a missing Wait shows up rather than being hidden by luck.
			time.Sleep(time.Duration(i) * 2 * time.Millisecond)
			done[i] = true
		}
	}

	Parallel(fns...)

	for i, d := range done {
		if !d {
			t.Errorf("function %d had not finished when Parallel returned", i)
		}
	}
}

// If they ran one after another this would take 10 × 20ms. The assertion is deliberately loose —
// it is checking for overlap, not measuring a budget, so it will not flake on a busy CI box.
func TestParallel_ActuallyOverlaps(t *testing.T) {
	const (
		n     = 10
		delay = 20 * time.Millisecond
	)
	fns := make([]func(), n)
	for i := range fns {
		fns[i] = func() { time.Sleep(delay) }
	}

	start := time.Now()
	Parallel(fns...)
	elapsed := time.Since(start)

	if sequential := n * delay; elapsed >= sequential {
		t.Errorf("took %s; sequential would be %s — they are not overlapping", elapsed, sequential)
	}
}

// Each function writing to its OWN variable is the pattern every caller uses; assembling the
// result afterwards must give the same answer regardless of finishing order.
func TestParallel_ResultIsOrderIndependent(t *testing.T) {
	for attempt := 0; attempt < 50; attempt++ {
		var a, b, c string
		Parallel(
			func() { a = "policies" },
			func() { b = "addresses" },
			func() { c = "services" },
		)
		if got := a + "|" + b + "|" + c; got != "policies|addresses|services" {
			t.Fatalf("assembled %q on attempt %d — order leaked into the result", got, attempt)
		}
	}
}

// The degenerate inputs. Zero is a real case: a caller can build its function list conditionally.
func TestParallel_EdgeCases(t *testing.T) {
	t.Run("no functions", func(t *testing.T) {
		Parallel() // must not deadlock or panic
	})
	t.Run("one function runs inline", func(t *testing.T) {
		ran := false
		Parallel(func() { ran = true })
		if !ran {
			t.Error("the single function did not run")
		}
	})
}

// The property the whole change rests on: a FortiClient can serve concurrent reads on ONE pooled
// session. If it could not, parallelising the callers would have traded latency for a second login
// per page — or for corruption.
//
// This drives the real client against the fake FortiGate, the same way the sequential code did.
func TestParallel_SharesOneSessionAcrossConcurrentReads(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	fc, err := AcquireFortiClient(1, host, port, DeviceLogin{Username: "admin", Password: "pw"})
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	// Fourteen reads, as DeviceGetPolicyProfiles issues.
	const n = 14
	results := make([]error, n)
	fns := make([]func(), n)
	for i := 0; i < n; i++ {
		fns[i] = func() {
			_, results[i] = fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
		}
	}

	Parallel(fns...)

	for i, err := range results {
		if err != nil {
			t.Fatalf("concurrent read %d failed: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&fg.calls); got != n {
		t.Errorf("device saw %d calls, want %d — one per read", got, n)
	}
	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 — concurrency must not cost extra sessions", got)
	}
	if got := atomic.LoadInt32(&fg.logouts); got != 0 {
		t.Errorf("logouts = %d, want 0", got)
	}
}

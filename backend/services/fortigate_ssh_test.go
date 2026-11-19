package services

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// ── Parsing ──────────────────────────────────────────────────────────────────

// The real tail of `get system performance status` on the lab FGT80E (FortiOS 7.2.10) — note
// the double spaces the device pads its numbers with.
const perfStatusOutput = `NGFW-Testing # CPU states: 3% user 0% system 0% nice 97% idle
Memory: 1911148k total, 798132k used (41.8%), 994296k free (52.0%)
Average sessions: 5 sessions in 1 minute, 6 sessions in 10 minutes
Virus caught: 0 total in 1 minute
IPS attacks blocked: 0 total in 1 minute
Uptime: 44 days,  22 hours,  41 minutes
`

func TestParseUptimeSeconds(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int64
		ok   bool
	}{
		{"live device output", perfStatusOutput, 44*86400 + 22*3600 + 41*60, true},
		{"single units", "Uptime: 1 day, 1 hour, 1 minute", 86400 + 3600 + 60, true},
		{"with seconds", "Uptime: 0 days, 0 hours, 2 minutes, 30 seconds", 150, true},
		{"just booted", "Uptime: 0 days, 0 hours, 0 minutes", 0, true},
		{"lowercase label", "uptime: 3 days, 0 hours, 0 minutes", 3 * 86400, true},
		{"no uptime line", "CPU states: 3% user\nMemory: 41%", 0, false},
		{"empty", "", 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseUptimeSeconds(c.in)
			if ok != c.ok || got != c.want {
				t.Errorf("parseUptimeSeconds = %d,%v — want %d,%v", got, ok, c.want, c.ok)
			}
		})
	}
}

// A number the device prints in a unit this parser does not know must be skipped, not silently
// added to the total as if it were seconds.
func TestParseUptimeSeconds_IgnoresUnknownUnits(t *testing.T) {
	got, ok := parseUptimeSeconds("Uptime: 2 days, 5 fortnights, 30 minutes")
	if !ok || got != 2*86400+30*60 {
		t.Errorf("parseUptimeSeconds = %d,%v — want %d,true", got, ok, 2*86400+30*60)
	}
}

// ── Probe caching ────────────────────────────────────────────────────────────

// withStubbedSSH swaps the SSH runner for the duration of a test and clears the cache on both
// sides, so tests never touch a real device and never leak state into each other.
//
// Cleanup drains in-flight probes BEFORE restoring the runner. Probes are asynchronous now, so a
// test can finish while one it started is still running — and because sshRunCommand is a package
// variable read at call time, that straggler would otherwise invoke the NEXT test's stub and
// inflate its call count (or, worse, the restored real SSH runner).
func withStubbedSSH(t *testing.T, deviceID uint, run func(host string, port int, user, pass, cmd string) (string, error)) {
	t.Helper()
	original := sshRunCommand
	sshRunCommand = run
	InvalidateDeviceUptime(deviceID)
	t.Cleanup(func() {
		waitForDeviceProbes(t, deviceID)
		sshRunCommand = original
		InvalidateDeviceUptime(deviceID)
	})
}

// waitForDeviceProbes blocks until no probe is in flight for any cache entry belonging to the
// device. startProbeLocked publishes `probing` synchronously under the entry's lock, so any probe
// a test started is already visible here by the time the test body returns.
func waitForDeviceProbes(t *testing.T, deviceID uint) {
	t.Helper()
	prefix := fmt.Sprintf("%d|", deviceID)
	deadline := time.Now().Add(3 * time.Second)

	for time.Now().Before(deadline) {
		uptimeMu.Lock()
		var pending []*uptimeEntry
		for k, e := range uptimeCache {
			if strings.HasPrefix(k, prefix) {
				pending = append(pending, e)
			}
		}
		uptimeMu.Unlock()

		busy := false
		for _, e := range pending {
			e.mu.Lock()
			busy = busy || e.probing != nil
			e.mu.Unlock()
		}
		if !busy {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("a probe for device %d was still in flight after 3s", deviceID)
}

// The dashboard polls; the device must not be SSH'd into on every poll. What is cached is the
// boot time, so repeat calls stay accurate instead of freezing at the first reading.
func TestDeviceUptimeSeconds_CachesBootTimeNotUptime(t *testing.T) {
	const id = 9001
	calls := 0
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		calls++
		return "Uptime: 0 days, 1 hours, 0 minutes", nil
	})

	first, ok := DeviceUptimeSeconds(id, "10.0.0.1", 22, "admin", "pw")
	if !ok || first != 3600 {
		t.Fatalf("first probe = %d,%v — want 3600,true", first, ok)
	}

	// Pretend a minute of wall clock has passed by ageing the cached boot time.
	e := uptimeEntryFor(fmt.Sprintf("%d|%s|%d", uint(id), "10.0.0.1", 22))
	e.mu.Lock()
	e.bootTime = e.bootTime.Add(-time.Minute)
	e.mu.Unlock()

	second, ok := DeviceUptimeSeconds(id, "10.0.0.1", 22, "admin", "pw")
	if !ok {
		t.Fatal("second call failed")
	}
	if calls != 1 {
		t.Errorf("SSH ran %d times for two calls — the boot time should be cached", calls)
	}
	if second < first+59 || second > first+61 {
		t.Errorf("uptime = %d, want ≈%d — it must advance with the clock, not stay frozen", second, first+60)
	}
}

// SSH logins count towards the device's admin-lockout-threshold (3 on the lab box), so a
// firewall that refuses the login must not be retried once per dashboard refresh.
func TestDeviceUptimeSeconds_BacksOffAfterFailures(t *testing.T) {
	const id = 9002
	calls := 0
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		calls++
		return "", fmt.Errorf("SSH connect failed: connection refused")
	})

	for i := 0; i < 5; i++ {
		if _, ok := DeviceUptimeSeconds(id, "10.0.0.2", 22, "admin", "pw"); ok {
			t.Fatalf("probe %d unexpectedly succeeded", i)
		}
	}
	if calls > uptimeFailThreshold {
		t.Errorf("SSH attempted %d times; must stop at %d to leave the device's lockout headroom",
			calls, uptimeFailThreshold)
	}
}

// Output that connects but carries no uptime line is a failure, not an uptime of zero.
func TestDeviceUptimeSeconds_UnparsableOutputIsNotZeroUptime(t *testing.T) {
	const id = 9003
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		return "Command fail. Return code -61", nil
	})

	if secs, ok := DeviceUptimeSeconds(id, "10.0.0.3", 22, "admin", "pw"); ok {
		t.Errorf("reported uptime %d from output with no uptime line", secs)
	}
}

// Once a boot time is known, a later SSH failure must not blank the widget — the device is up,
// the probe merely could not repeat.
func TestDeviceUptimeSeconds_KeepsLastKnownBootTimeOnFailure(t *testing.T) {
	const id = 9004
	fail := false
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		if fail {
			return "", fmt.Errorf("SSH connect failed")
		}
		return "Uptime: 2 days, 0 hours, 0 minutes", nil
	})

	if _, ok := DeviceUptimeSeconds(id, "10.0.0.4", 22, "admin", "pw"); !ok {
		t.Fatal("initial probe failed")
	}

	// Force the next call past the refresh window, then make the probe fail.
	e := uptimeEntryFor(fmt.Sprintf("%d|%s|%d", uint(id), "10.0.0.4", 22))
	e.mu.Lock()
	e.measured = e.measured.Add(-2 * uptimeRefresh)
	e.mu.Unlock()
	fail = true

	secs, ok := DeviceUptimeSeconds(id, "10.0.0.4", 22, "admin", "pw")
	if !ok || secs < 2*86400 {
		t.Errorf("uptime = %d,%v — want the cached boot time to survive a failed refresh", secs, ok)
	}
}

func TestInvalidateDeviceUptime(t *testing.T) {
	const id = 9005
	calls := 0
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		calls++
		return "Uptime: 1 days, 0 hours, 0 minutes", nil
	})

	DeviceUptimeSeconds(id, "10.0.0.5", 22, "admin", "pw")
	InvalidateDeviceUptime(id)
	DeviceUptimeSeconds(id, "10.0.0.5", 22, "admin", "pw")

	if calls != 2 {
		t.Errorf("SSH ran %d times; invalidating must force a fresh measurement", calls)
	}
}

// ── The probe must not decide how fast the dashboard renders ─────────────────
//
// DeviceUptimeSeconds used to run the SSH probe inline. A firewall that DROPS port 22 (rather
// than refusing it) therefore cost the caller the full uptimeSSHTimeout of 8s, and since the
// dashboard waits on a WaitGroup, that was the whole page. These tests pin the contract that
// replaced it: cached answers are instant, cold ones are bounded, and the cache still fills.

// withSlowStubbedSSH is withStubbedSSH plus a probe that blocks until the test releases it, so a
// "the device is not answering" scenario can be tested without waiting on a real timeout.
// The returned func unblocks every in-flight and future probe.
func withSlowStubbedSSH(t *testing.T, deviceID uint, out string, err error) (release func(), calls func() int) {
	t.Helper()
	gate := make(chan struct{})
	var mu sync.Mutex
	n := 0

	withStubbedSSH(t, deviceID, func(_ string, _ int, _, _, _ string) (string, error) {
		mu.Lock()
		n++
		mu.Unlock()
		<-gate
		return out, err
	})

	var once sync.Once
	closeGate := func() { once.Do(func() { close(gate) }) }
	// Never leave a probe goroutine parked on the gate after the test ends.
	t.Cleanup(closeGate)

	return closeGate, func() int {
		mu.Lock()
		defer mu.Unlock()
		return n
	}
}

// shortProbeWait shrinks the caller's patience for the duration of a test, so the bounded-wait
// path can be exercised in milliseconds instead of the production 1.2s.
func shortProbeWait(t *testing.T, d time.Duration) {
	t.Helper()
	original := uptimeProbeWait
	uptimeProbeWait = d
	t.Cleanup(func() { uptimeProbeWait = original })
}

// A cold probe against a device that never answers must give up at uptimeProbeWait, NOT at
// uptimeSSHTimeout. This is the 8s dashboard stall, expressed as a test.
func TestDeviceUptimeSeconds_ColdProbeIsBounded(t *testing.T) {
	const id = 9006
	shortProbeWait(t, 60*time.Millisecond)
	release, _ := withSlowStubbedSSH(t, id, "", fmt.Errorf("SSH connect failed: i/o timeout"))
	defer release()

	start := time.Now()
	secs, ok := DeviceUptimeSeconds(id, "10.0.0.6", 22, "admin", "pw")
	elapsed := time.Since(start)

	if ok {
		t.Errorf("reported uptime %d from a device that never answered", secs)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("cold probe blocked the caller for %v — it must give up at uptimeProbeWait (%v), "+
			"not wait out the SSH timeout (%v)", elapsed, uptimeProbeWait, uptimeSSHTimeout)
	}
}

// Once a boot time is known, a refresh must cost the caller nothing at all: boot time is a
// constant, so a stale reading is old, never wrong.
func TestDeviceUptimeSeconds_StaleCacheNeverBlocks(t *testing.T) {
	const id = 9007
	shortProbeWait(t, 5*time.Second) // deliberately long: the test asserts we never reach it

	// One stub for the whole test — swapping stubs mid-test would clear the very cache this is
	// about. The first probe seeds a boot time; every later one hangs, standing in for a device
	// that has since stopped answering SSH.
	gate := make(chan struct{})
	defer close(gate)
	seeded := false
	withStubbedSSH(t, id, func(_ string, _ int, _, _, _ string) (string, error) {
		if !seeded {
			seeded = true
			return "Uptime: 3 days, 0 hours, 0 minutes", nil
		}
		<-gate
		return "", fmt.Errorf("SSH connect failed: i/o timeout")
	})

	if _, ok := DeviceUptimeSeconds(id, "10.0.0.7", 22, "admin", "pw"); !ok {
		t.Fatal("seeding probe failed")
	}

	// Age the reading past the refresh window so the next call wants a fresh probe.
	e := uptimeEntryFor(fmt.Sprintf("%d|%s|%d", uint(id), "10.0.0.7", 22))
	e.mu.Lock()
	e.measured = e.measured.Add(-2 * uptimeRefresh)
	e.mu.Unlock()

	start := time.Now()
	secs, ok := DeviceUptimeSeconds(id, "10.0.0.7", 22, "admin", "pw")
	elapsed := time.Since(start)

	if !ok || secs < 3*86400 {
		t.Errorf("uptime = %d,%v — a stale cache must still answer, not fall back to unknown", secs, ok)
	}
	if elapsed > 200*time.Millisecond {
		t.Errorf("stale-cache read blocked for %v — a background refresh must not be waited on", elapsed)
	}
}

// Giving up on the wait must not throw the probe away: the answer it eventually brings back has
// to land in the cache so the NEXT poll (5s later on the dashboard) shows the uptime.
func TestDeviceUptimeSeconds_BackgroundProbeStillFillsCache(t *testing.T) {
	const id = 9008
	shortProbeWait(t, 30*time.Millisecond)
	release, calls := withSlowStubbedSSH(t, id, "Uptime: 5 days, 0 hours, 0 minutes", nil)

	if _, ok := DeviceUptimeSeconds(id, "10.0.0.8", 22, "admin", "pw"); ok {
		t.Fatal("first call answered before the probe did")
	}

	release() // the device replies at last
	waitForDeviceProbes(t, id)

	secs, ok := DeviceUptimeSeconds(id, "10.0.0.8", 22, "admin", "pw")
	if !ok || secs < 5*86400 {
		t.Errorf("uptime = %d,%v — the background probe's result must survive into the cache", secs, ok)
	}
	if got := calls(); got != 1 {
		t.Errorf("SSH ran %d times; the abandoned probe must be reused, not restarted", got)
	}
}

// Only the caller that STARTS a probe may wait for it.
//
// Found on the live lab device: with SSH dropped on the probed port, the probe takes the full
// uptimeSSHTimeout (8s) to fail, and while it runs every arriving request queued behind it for
// uptimeProbeWait and learned nothing. The dashboard measured 1.25s on EVERY refresh instead of
// only the first. A caller that did not start the probe has nothing to gain by waiting — the
// probe is already old and heading for the same timeout — so it must return immediately.
func TestDeviceUptimeSeconds_OnlyTheProbeStarterWaits(t *testing.T) {
	const id = 9010
	shortProbeWait(t, 150*time.Millisecond)
	release, calls := withSlowStubbedSSH(t, id, "", fmt.Errorf("SSH connect failed: i/o timeout"))
	defer release()

	// First caller starts the probe and pays the bounded wait.
	start := time.Now()
	DeviceUptimeSeconds(id, "10.0.0.10", 22, "admin", "pw")
	firstElapsed := time.Since(start)
	if firstElapsed < 100*time.Millisecond {
		t.Fatalf("the starting caller returned in %v — it should have waited out uptimeProbeWait", firstElapsed)
	}

	// Everyone arriving while that probe is still in flight must return at once.
	for i := 0; i < 5; i++ {
		start = time.Now()
		secs, ok := DeviceUptimeSeconds(id, "10.0.0.10", 22, "admin", "pw")
		elapsed := time.Since(start)

		if ok {
			t.Errorf("follow-up call %d reported uptime %d from a device that never answered", i, secs)
		}
		if elapsed > 30*time.Millisecond {
			t.Errorf("follow-up call %d blocked for %v — only the caller that started the probe "+
				"may wait, or a dead device taxes every request", i, elapsed)
		}
	}

	if got := calls(); got != 1 {
		t.Errorf("SSH ran %d times; the in-flight probe must be shared, not restarted", got)
	}
}

// The dashboard fans out and users open several tabs. Every one of those callers hitting a cold
// cache must produce ONE login, not one each — failed SSH logins count towards the device's
// admin-lockout-threshold of 3.
func TestDeviceUptimeSeconds_ConcurrentCallersShareOneProbe(t *testing.T) {
	const id = 9009
	shortProbeWait(t, 40*time.Millisecond)
	release, calls := withSlowStubbedSSH(t, id, "Uptime: 1 days, 0 hours, 0 minutes", nil)

	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			DeviceUptimeSeconds(id, "10.0.0.9", 22, "admin", "pw")
		}()
	}
	wg.Wait()

	release()
	waitForDeviceProbes(t, id)

	if got := calls(); got != 1 {
		t.Errorf("12 concurrent callers produced %d SSH logins — the probe must be single-flight "+
			"(the device locks the admin account after 3 failures)", got)
	}
}

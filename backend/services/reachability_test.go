package services

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubDial swaps the dialer for the duration of a test. Nothing here opens a real socket: the
// point is the address FORMATTING and the fan-out, both of which are decided before the dial.
func stubDial(t *testing.T, fn func(network, addr string, timeout time.Duration) (net.Conn, error)) {
	t.Helper()
	original := dialTimeout
	dialTimeout = fn
	t.Cleanup(func() { dialTimeout = original })
}

// recordAddrs captures every address the prober tried to dial, and always fails the dial.
func recordAddrs(t *testing.T) *[]string {
	t.Helper()
	var mu sync.Mutex
	seen := []string{}
	stubDial(t, func(_, addr string, _ time.Duration) (net.Conn, error) {
		mu.Lock()
		seen = append(seen, addr)
		mu.Unlock()
		return nil, errors.New("stub: refused")
	})
	return &seen
}

// ── Address formatting ───────────────────────────────────────────────────────
//
// CheckReachability used to build its address with fmt.Sprintf("%s:%d", host, port), which
// `go vet` flags: an IPv6 literal must be bracketed or net.Dial cannot parse it. The effect was
// that any device with an IPv6 management address was reported unreachable forever — the Ping
// button and batch backup both refused to touch it — and the error message blamed the network.

func TestCheckReachability_AddressFormatting(t *testing.T) {
	cases := []struct {
		name string
		host string
		port int
		want string
	}{
		{"IPv4", "10.0.99.201", 443, "10.0.99.201:443"},
		{"hostname", "fgt-lab.local", 22, "fgt-lab.local:22"},
		{"IPv6 literal", "2001:db8::1", 22, "[2001:db8::1]:22"},
		{"IPv6 loopback", "::1", 9000, "[::1]:9000"},
		{"IPv6 link-local with zone", "fe80::1%eth0", 22, "[fe80::1%eth0]:22"},
		{"IPv6 already bracketed", "[2001:db8::1]", 22, "[[2001:db8::1]]:22"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			seen := recordAddrs(t)
			_ = CheckReachability(c.host, c.port, time.Second)
			if len(*seen) != 1 {
				t.Fatalf("dialed %d times, want 1", len(*seen))
			}
			if (*seen)[0] != c.want {
				t.Errorf("dialed %q — want %q", (*seen)[0], c.want)
			}
		})
	}
}

// The regression that started this: an IPv6 address must reach the dialer in a form the dialer
// accepts. Asserting against the REAL net.Dial parser, not just our own string, is what makes
// this test meaningful.
func TestCheckReachability_IPv6AddressIsParseable(t *testing.T) {
	seen := recordAddrs(t)
	_ = CheckReachability("2001:db8::1", 22, time.Second)

	host, port, err := net.SplitHostPort((*seen)[0])
	if err != nil {
		t.Fatalf("net.SplitHostPort(%q) failed: %v — this is exactly why IPv6 devices never "+
			"came back reachable", (*seen)[0], err)
	}
	if host != "2001:db8::1" || port != "22" {
		t.Errorf("round-tripped to host=%q port=%q — want 2001:db8::1 / 22", host, port)
	}
}

func TestCheckReachability_SuccessAndFailure(t *testing.T) {
	t.Run("reachable returns nil", func(t *testing.T) {
		stubDial(t, func(_, _ string, _ time.Duration) (net.Conn, error) {
			client, server := net.Pipe()
			t.Cleanup(func() { server.Close() })
			return client, nil
		})
		if err := CheckReachability("10.0.99.201", 443, time.Second); err != nil {
			t.Errorf("reachable device reported an error: %v", err)
		}
	})

	t.Run("unreachable wraps the dial error and names the address", func(t *testing.T) {
		sentinel := errors.New("i/o timeout")
		stubDial(t, func(_, _ string, _ time.Duration) (net.Conn, error) { return nil, sentinel })

		err := CheckReachability("10.0.99.201", 443, time.Second)
		if err == nil {
			t.Fatal("unreachable device reported success")
		}
		if !errors.Is(err, sentinel) {
			t.Errorf("dial error was not wrapped: %v", err)
		}
		if !strings.Contains(err.Error(), "10.0.99.201:443") {
			t.Errorf("error does not name the address dialled: %v", err)
		}
	})
}

func TestCheckReachability_PassesTheTimeoutThrough(t *testing.T) {
	var got time.Duration
	stubDial(t, func(_, _ string, timeout time.Duration) (net.Conn, error) {
		got = timeout
		return nil, errors.New("refused")
	})
	_ = CheckReachability("10.0.0.1", 22, 1234*time.Millisecond)
	if got != 1234*time.Millisecond {
		t.Errorf("dial timeout = %v, want 1.234s", got)
	}
}

// ── Batch probing ────────────────────────────────────────────────────────────
//
// BackupBatch probed its devices one at a time. An unreachable device costs the FULL timeout —
// a dropped SYN gives nothing to fail fast on — so the handler's latency was timeout × (number
// of dead devices): twenty dead devices at 2s each was a 40-second HTTP request holding a
// database connection, for work that is pure waiting.

func TestCheckReachabilityAll_ResultsAreIndexAligned(t *testing.T) {
	// Only the odd-numbered devices answer.
	stubDial(t, func(_, addr string, _ time.Duration) (net.Conn, error) {
		if strings.HasPrefix(addr, "10.0.0.1:") || strings.HasPrefix(addr, "10.0.0.3:") {
			client, server := net.Pipe()
			t.Cleanup(func() { server.Close() })
			return client, nil
		}
		return nil, errors.New("refused")
	})

	targets := []ReachTarget{
		{"10.0.0.0", 22}, {"10.0.0.1", 22}, {"10.0.0.2", 22}, {"10.0.0.3", 22}, {"10.0.0.4", 22},
	}
	got := CheckReachabilityAll(targets, time.Second)

	if len(got) != len(targets) {
		t.Fatalf("got %d results for %d targets", len(got), len(targets))
	}
	for i, err := range got {
		wantReachable := i == 1 || i == 3
		if wantReachable && err != nil {
			t.Errorf("target %d (%s) should be reachable, got %v", i, targets[i].Host, err)
		}
		if !wantReachable && err == nil {
			t.Errorf("target %d (%s) should be unreachable, got nil", i, targets[i].Host)
		}
	}
}

// The whole point: N dead devices must cost about ONE timeout, not N.
func TestCheckReachabilityAll_ProbesConcurrently(t *testing.T) {
	const (
		targetCount = 12
		dialDelay   = 120 * time.Millisecond
	)
	stubDial(t, func(_, _ string, _ time.Duration) (net.Conn, error) {
		time.Sleep(dialDelay) // stands in for a dropped SYN waiting out its timeout
		return nil, errors.New("timeout")
	})

	targets := make([]ReachTarget, targetCount)
	for i := range targets {
		targets[i] = ReachTarget{Host: fmt.Sprintf("10.0.0.%d", i), Port: 22}
	}

	start := time.Now()
	got := CheckReachabilityAll(targets, time.Second)
	elapsed := time.Since(start)

	for i, err := range got {
		if err == nil {
			t.Errorf("target %d reported reachable", i)
		}
	}
	// Serial would be 12 × 120ms = 1.44s. Concurrent (all under the cap of 16) is ~120ms.
	// Half the serial time is a wide margin that still fails loudly on a regression.
	if serial := targetCount * dialDelay; elapsed > serial/2 {
		t.Errorf("probing %d targets took %v — serial would be %v; the probes must run "+
			"concurrently, not one after another", targetCount, elapsed, serial)
	}
}

// A large inventory must not open one socket per device at the same instant — that trips
// per-process fd limits and looks like a port scan on the way out.
func TestCheckReachabilityAll_RespectsConcurrencyCap(t *testing.T) {
	var inFlight, peak int64
	stubDial(t, func(_, _ string, _ time.Duration) (net.Conn, error) {
		n := atomic.AddInt64(&inFlight, 1)
		for {
			old := atomic.LoadInt64(&peak)
			if n <= old || atomic.CompareAndSwapInt64(&peak, old, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt64(&inFlight, -1)
		return nil, errors.New("refused")
	})

	targets := make([]ReachTarget, 64)
	for i := range targets {
		targets[i] = ReachTarget{Host: fmt.Sprintf("10.1.0.%d", i), Port: 22}
	}
	CheckReachabilityAll(targets, time.Second)

	if got := atomic.LoadInt64(&peak); got > maxReachabilityProbes {
		t.Errorf("peak concurrent dials = %d, cap is %d", got, maxReachabilityProbes)
	}
}

func TestCheckReachabilityAll_EmptyInput(t *testing.T) {
	stubDial(t, func(_, _ string, _ time.Duration) (net.Conn, error) {
		t.Fatal("dialled with no targets")
		return nil, nil
	})
	if got := CheckReachabilityAll(nil, time.Second); got != nil {
		t.Errorf("CheckReachabilityAll(nil) = %v, want nil", got)
	}
	if got := CheckReachabilityAll([]ReachTarget{}, time.Second); got != nil {
		t.Errorf("CheckReachabilityAll([]) = %v, want nil", got)
	}
}

// Every target must be probed exactly once — a batch that silently skipped a device would
// report it unreachable and quietly leave it without a backup.
func TestCheckReachabilityAll_ProbesEveryTargetOnce(t *testing.T) {
	seen := recordAddrs(t)

	targets := []ReachTarget{
		{"10.0.0.1", 22}, {"10.0.0.2", 22}, {"2001:db8::5", 22}, {"fgt-lab.local", 8022},
	}
	CheckReachabilityAll(targets, time.Second)

	if len(*seen) != len(targets) {
		t.Fatalf("dialled %d times for %d targets: %v", len(*seen), len(targets), *seen)
	}
	want := map[string]bool{
		"10.0.0.1:22": true, "10.0.0.2:22": true,
		"[2001:db8::5]:22": true, "fgt-lab.local:8022": true,
	}
	for _, addr := range *seen {
		if !want[addr] {
			t.Errorf("unexpected address dialled: %q", addr)
		}
		delete(want, addr)
	}
	for addr := range want {
		t.Errorf("target never probed: %q", addr)
	}
}

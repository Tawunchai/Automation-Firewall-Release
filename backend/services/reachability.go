package services

import (
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"
)

// DefaultReachabilityTimeout = timeout เริ่มต้นสำหรับ ping check ผ่าน UI (ตอบเร็ว)
const DefaultReachabilityTimeout = 3 * time.Second

// maxReachabilityProbes bounds how many sockets a batch opens at once.
//
// The probes are almost pure wait — a dial that will time out costs one fd and nothing else — so
// the limit is not about CPU. It is about not opening one socket per device in a large inventory
// at the same instant, which trips per-process fd limits and looks like a port scan to whatever
// sits between this host and the devices.
const maxReachabilityProbes = 16

// dialTimeout is the dialer, swappable so tests can exercise the batch logic without opening a
// single socket. Production code never replaces it.
var dialTimeout = net.DialTimeout

// CheckReachability ทดสอบว่า host:port รับ TCP connection ได้ภายใน timeout ที่กำหนด
// คืน nil = เข้าถึงได้, error = ไม่ได้ (network/firewall/device ปิด SSH)
func CheckReachability(host string, port int, timeout time.Duration) error {
	// net.JoinHostPort, not fmt.Sprintf("%s:%d", …): an IPv6 literal has to be bracketed
	// ([2001:db8::1]:22) or net.Dial cannot parse it, so the plain format string made every
	// IPv6-managed device permanently "unreachable". `go vet` flags the Sprintf form.
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := dialTimeout("tcp", addr, timeout)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %w", addr, err)
	}
	conn.Close()
	return nil
}

// ReachTarget is one host:port to probe.
type ReachTarget struct {
	Host string
	Port int
}

// CheckReachabilityAll probes every target CONCURRENTLY and returns one result per target,
// index-aligned with the input (nil = reachable).
//
// Why this exists: the batch-backup handler probed its devices in a plain loop. Each unreachable
// device costs the FULL timeout — a dropped SYN gives nothing back to fail fast on — so the
// handler's latency was timeout × (number of dead devices). Twenty dead devices at 2s each meant a
// 40-second HTTP request, holding a database connection the whole time, for work that is pure
// waiting and parallelises perfectly. Now the batch costs about one timeout in total.
//
// Concurrency is capped at maxReachabilityProbes. A nil or empty input returns nil.
func CheckReachabilityAll(targets []ReachTarget, timeout time.Duration) []error {
	if len(targets) == 0 {
		return nil
	}

	results := make([]error, len(targets))

	limit := maxReachabilityProbes
	if len(targets) < limit {
		limit = len(targets)
	}
	sem := make(chan struct{}, limit)

	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			// Each goroutine owns its own slot in results, so no lock is needed — the WaitGroup
			// supplies the happens-before for the caller's read.
			results[i] = CheckReachability(t.Host, t.Port, timeout)
		}()
	}
	wg.Wait()

	return results
}

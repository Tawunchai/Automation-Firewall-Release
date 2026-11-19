package services

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"network_automation/services/platform"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Device uptime over SSH.
//
// FortiOS 7.2.10 has no monitor endpoint that reports uptime — system/status,
// system/performance/status, system/resource/usage and system/time were all probed on the lab
// FGT80E and none of them carries it, while the device's own dashboard shows it. The CLI does:
//
//	get system performance status
//	…
//	Uptime: 44 days,  22 hours,  41 minutes
//
// So the dashboard reads it over SSH, and does so sparingly:
//
//   - What is cached is the BOOT TIME, not the uptime. Boot time is a constant, so a single
//     probe stays exact — every later request derives uptime as now − bootTime instead of
//     re-connecting.
//   - Failures back off. The device sets admin-lockout-threshold 3 / admin-lockout-duration 60,
//     and SSH logins count towards it, so two consecutive failures pause probing for a minute
//     rather than locking the admin account out of the firewall.
//   - Every caller treats the result as optional: no SSH, no uptime, the rest of the dashboard
//     is unaffected.
//   - The probe runs in the BACKGROUND and a caller waits for it only when it has nothing to
//     show, and then only briefly. See uptimeProbeWait — this is the difference between a
//     dashboard that renders in 0.2s and one that stalls for 8s every refresh.

const (
	// uptimeRefresh is how often the boot time is re-measured. Long, because boot time only
	// changes when the device reboots — and a reboot resets the clock so far that the next
	// refresh corrects it obviously.
	uptimeRefresh = 30 * time.Minute

	// uptimeFailCooldown pauses probing after repeated SSH failures (see admin lockout above).
	uptimeFailCooldown = 60 * time.Second

	// uptimeFailThreshold stops one attempt short of the device's lockout threshold of 3.
	uptimeFailThreshold = 2

	// uptimeSSHTimeout bounds the whole probe: dial, handshake, command, read.
	uptimeSSHTimeout = 8 * time.Second

	// uptimeCommand is the only CLI FortiOS 7.2 will give an uptime through.
	uptimeCommand = "get system performance status"
)

// uptimeProbeWait bounds how long a REQUEST waits on a cold probe before giving up on this round
// and letting the background goroutine finish on its own.
//
// Why it exists: DeviceUptimeSeconds used to run the SSH probe inline, so an unreachable SSH port
// (dropped rather than refused — the common case behind a firewall) cost the caller the full
// uptimeSSHTimeout of 8s. The dashboard fans out with a WaitGroup, so that 8s became the whole
// page's load time, and because the failure cooldown is 60s while the snapshot poll is also 60s,
// it recurred on essentially every refresh forever.
//
// The value is chosen against the lab FGT80E, which answers this command in ~0.3-0.5s over the
// LAN: long enough that a healthy device still fills the widget on the FIRST load, short enough
// that a dead one is barely noticed. A var, not a const, so tests can shrink it.
var uptimeProbeWait = 1200 * time.Millisecond

type uptimeEntry struct {
	mu sync.Mutex

	bootTime  time.Time // when the device came up (zero = unknown)
	measured  time.Time // when bootTime was last measured
	fails     int
	blockedTo time.Time

	// probing is non-nil while a background probe is in flight and is closed when it finishes.
	// It is the single-flight latch: the dashboard's own fan-out plus several open browser tabs
	// would otherwise all SSH into the same firewall at once — and every failed login counts
	// towards admin-lockout-threshold.
	probing chan struct{}
}

var (
	uptimeMu    sync.Mutex
	uptimeCache = map[string]*uptimeEntry{}
)

func uptimeEntryFor(key string) *uptimeEntry {
	uptimeMu.Lock()
	defer uptimeMu.Unlock()
	e, ok := uptimeCache[key]
	if !ok {
		e = &uptimeEntry{}
		uptimeCache[key] = e
	}
	return e
}

// parseUptimeSeconds pulls the uptime out of `get system performance status` output.
// FortiOS prints e.g. "Uptime: 44 days,  22 hours,  41 minutes" (variable spacing, and older
// builds add seconds).
func parseUptimeSeconds(output string) (int64, bool) {
	for _, line := range strings.Split(output, "\n") {
		idx := strings.Index(strings.ToLower(line), "uptime:")
		if idx < 0 {
			continue
		}
		rest := line[idx+len("uptime:"):]
		fields := strings.FieldsFunc(rest, func(r rune) bool { return r == ',' })

		var total int64
		found := false
		for _, part := range fields {
			parts := strings.Fields(part)
			if len(parts) < 2 {
				continue
			}
			n, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil {
				continue
			}
			unit := strings.ToLower(strings.TrimSuffix(parts[1], "s"))
			switch unit {
			case "day":
				total += n * 86400
			case "hour", "hr":
				total += n * 3600
			case "minute", "min":
				total += n * 60
			case "second", "sec":
				total += n
			default:
				continue
			}
			found = true
		}
		if found {
			return total, true
		}
	}
	return 0, false
}

// sshRunCommand opens a one-shot SSH session and returns the command output.
// FortiOS answers an exec request (confirmed live), so no interactive shell is needed.
//
// This is the uptime probe's shape of the call: an 8-second budget and no output cap, which suits
// a command that prints twenty lines. The Diagnostics tools need neither of those defaults — a
// traceroute runs for half a minute and `diagnose sys session list` on a busy firewall prints
// without end — so they call sshRunCommandLimited directly.
var sshRunCommand = func(host string, port int, username, password, command string) (string, error) {
	out, _, err := sshRunCommandLimited(host, port, username, password, command, uptimeSSHTimeout, 0)
	return out, err
}

// sshDialTimeout bounds the TCP connect and SSH handshake, separately from how long the COMMAND is
// then allowed to run. They are different questions: an unreachable device should be given up on
// quickly whatever it was going to be asked, while a traceroute that is answering fine still needs
// a minute.
const sshDialTimeout = 8 * time.Second

// sshRunCommandLimited runs one command over a one-shot SSH session.
//
// cmdTimeout bounds the command itself. maxBytes caps how much output is kept; 0 means unlimited.
// The cap is not decoration — `diagnose sys session list` on a firewall holding a hundred thousand
// sessions would otherwise stream all of them into this process's memory, and the caller only ever
// renders the first page. Output is read through an io.LimitReader so the ceiling applies to what
// is ALLOCATED, not merely to what is returned.
//
// A truncated read is reported as truncated rather than passed off as the whole answer, so a
// caller can say so on screen instead of quietly showing a partial session table as complete.
var sshRunCommandLimited = func(
	host string, port int, username, password, command string,
	cmdTimeout time.Duration, maxBytes int64,
) (out string, truncated bool, err error) {
	if port <= 0 {
		port = 22
	}
	if cmdTimeout <= 0 {
		cmdTimeout = uptimeSSHTimeout
	}
	cfg := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: platform.VerifyOrPinHostKey(host), // trust on first use — see sshhostkey.go
		// Asked for explicitly so this half and the Python worker pin the SAME key of a
		// device that has several — see PreferredHostKeyAlgorithms.
		HostKeyAlgorithms: platform.PreferredHostKeyAlgorithms,
		Timeout:           sshDialTimeout,
	}
	// net.JoinHostPort brackets an IPv6 literal; fmt.Sprintf("%s:%d", …) does not, and ssh.Dial
	// then cannot parse the address (same defect as CheckReachability had).
	client, err := ssh.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)), cfg)
	if err != nil {
		return "", false, fmt.Errorf("SSH connect failed: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", false, fmt.Errorf("SSH session failed: %w", err)
	}
	defer session.Close()

	type result struct {
		out       []byte
		truncated bool
		err       error
	}
	done := make(chan result, 1)
	go func() {
		if maxBytes <= 0 {
			out, err := session.CombinedOutput(command)
			done <- result{out, false, err}
			return
		}

		pipe, err := session.StdoutPipe()
		if err != nil {
			done <- result{nil, false, err}
			return
		}
		session.Stderr = io.Discard
		if err := session.Start(command); err != nil {
			done <- result{nil, false, err}
			return
		}
		// +1 to tell "exactly at the cap" from "more was coming".
		body, readErr := io.ReadAll(io.LimitReader(pipe, maxBytes+1))
		cut := int64(len(body)) > maxBytes
		if cut {
			body = body[:maxBytes]
			// Stop the far side rather than draining the rest of a firehose we are discarding.
			_ = session.Signal(ssh.SIGKILL)
		}
		_ = session.Close()
		done <- result{body, cut, readErr}
	}()

	select {
	case r := <-done:
		// FortiOS writes the banner/prompt alongside the answer and can close the channel
		// without an exit status, so output is used whenever there is any.
		if len(r.out) == 0 && r.err != nil {
			return "", false, r.err
		}
		return string(r.out), r.truncated, nil
	case <-time.After(cmdTimeout):
		return "", false, fmt.Errorf("SSH command timed out after %s", cmdTimeout)
	}
}

// sshStreamCommand runs one command and hands each line to onLine AS THE DEVICE PRINTS IT.
//
// This is the difference between the Ping page showing a spinner for five seconds and showing five
// replies tick in one per second. FortiOS genuinely streams — measured on the lab FGT80E, the
// replies to `execute ping` arrive 1.000s apart and the traceroute hops as each one resolves — so
// there is nothing to gain by buffering and everything to lose.
//
// Reading is line-oriented rather than chunked because every consumer here parses lines, and
// bufio.Scanner already handles a chunk boundary falling mid-line. maxLines and the scanner's own
// token cap bound what a runaway command can allocate.
//
// onLine is called from the reading goroutine, so it must not block for long: the device keeps
// writing regardless, and a slow consumer becomes back-pressure on the SSH channel.
// cancel aborts the command early — the browser closed the page, or the user pressed stop. It
// matters because a traceroute runs for up to 100 seconds and holds this device's diagnostic lock
// for all of them: without it, someone who mistypes a target waits out the full run before they
// can try again.
var sshStreamCommand = func(
	host string, port int, username, password, command string,
	cmdTimeout time.Duration, maxLines int, cancel <-chan struct{}, onLine func(string),
) error {
	if port <= 0 {
		port = 22
	}
	if cmdTimeout <= 0 {
		cmdTimeout = uptimeSSHTimeout
	}
	if maxLines <= 0 {
		maxLines = 5000
	}

	cfg := &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: platform.VerifyOrPinHostKey(host), // trust on first use — see sshhostkey.go
		// Asked for explicitly so this half and the Python worker pin the SAME key of a
		// device that has several — see PreferredHostKeyAlgorithms.
		HostKeyAlgorithms: platform.PreferredHostKeyAlgorithms,
		Timeout:           sshDialTimeout,
	}
	client, err := ssh.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)), cfg)
	if err != nil {
		return fmt.Errorf("SSH connect failed: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("SSH session failed: %w", err)
	}
	defer session.Close()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("SSH pipe failed: %w", err)
	}
	// FortiOS writes everything — banner, prompt echo and answer — to stdout (verified live), so
	// stderr carries nothing worth interleaving and is discarded rather than racing the reader.
	session.Stderr = io.Discard

	if err := session.Start(command); err != nil {
		return fmt.Errorf("SSH command failed: %w", err)
	}

	done := make(chan struct{})
	// Written by the goroutine, read only after `done` closes — the close is what orders the two.
	var scanErr error
	go func() {
		defer close(done)
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 16*1024), 256*1024)
		n := 0
		for sc.Scan() {
			if onLine != nil {
				onLine(sc.Text())
			}
			if n++; n >= maxLines {
				return // the cap, not a failure: the caller asked for this many lines
			}
		}
		// A scanner stops on a read error or on a line longer than its buffer, and until now this
		// loop simply ended when that happened — the caller got the lines that had arrived and a
		// nil error, which reads as "the command finished and this is all it said". On a diagnostic
		// this console runs against a firewall, a truncated answer presented as a complete one is
		// the wrong way round to be wrong.
		scanErr = sc.Err()
	}()

	// The timeout has to be able to interrupt a read that will never return — a device that stops
	// writing mid-command leaves the scanner blocked forever. Closing the CLIENT is what unblocks
	// it; closing only the session does not.
	select {
	case <-done:
		return scanErr
	case <-cancel:
		_ = client.Close()
		<-done
		return errDiagCancelled
	case <-time.After(cmdTimeout):
		_ = client.Close()
		<-done // let the reader observe the closed pipe and exit before the deferred Close runs
		return fmt.Errorf("SSH command timed out after %s", cmdTimeout)
	}
}

// errDiagCancelled marks a run the CALLER stopped. It is not a device failure and must not count
// towards the SSH circuit breaker — otherwise two cancelled traceroutes would lock diagnostics on a
// perfectly healthy firewall for a minute.
var errDiagCancelled = errors.New("diagnostic cancelled")

// IsDiagCancelled reports whether an error is the caller's own cancellation.
func IsDiagCancelled(err error) bool { return errors.Is(err, errDiagCancelled) }

// startProbeLocked kicks off a background SSH probe unless one is already running. It returns the
// latch that closes when the probe finishes, and whether THIS call started it. The caller must
// hold e.mu.
//
// `started` is what stops a dead device from taxing every request. Only the caller that starts a
// probe waits for it: a caller arriving while one is already in flight learns nothing by waiting
// (the probe has been running for a while and is heading for the same timeout), so it returns
// "unknown" immediately and picks the answer up on the next poll.
func (e *uptimeEntry) startProbeLocked(deviceID uint, host string, port int, username, password string) (latch chan struct{}, started bool) {
	if e.probing != nil {
		return e.probing, false
	}
	done := make(chan struct{})
	e.probing = done

	go func() {
		out, err := sshRunCommand(host, port, username, password, uptimeCommand)
		secs, parsed := int64(0), false
		if err == nil {
			if secs, parsed = parseUptimeSeconds(out); !parsed {
				err = fmt.Errorf("no uptime line in device output")
			}
		}

		e.mu.Lock()
		if parsed {
			e.bootTime = time.Now().Add(-time.Duration(secs) * time.Second)
			e.measured = time.Now()
			e.fails = 0
			e.blockedTo = time.Time{}
		} else {
			e.fails++
			if e.fails >= uptimeFailThreshold {
				e.blockedTo = time.Now().Add(uptimeFailCooldown)
				log.Printf("[fortigate] device %d: uptime probe failed %d times (%v) — pausing SSH for %s",
					deviceID, e.fails, err, uptimeFailCooldown)
			}
		}
		e.probing = nil
		e.mu.Unlock()

		close(done)
	}()

	return done, true
}

// DeviceUptimeSeconds returns the device's uptime in seconds, or ok=false when it cannot be
// measured (SSH unreachable, wrong credentials, cooling off after failures).
//
// It never blocks for longer than uptimeProbeWait, and does not block AT ALL once a boot time is
// known — a stale reading is refreshed in the background while the caller gets the cached answer
// straight away. Uptime is one field on a dashboard; it must not decide how fast the page renders.
func DeviceUptimeSeconds(deviceID uint, host string, port int, username, password string) (int64, bool) {
	key := fmt.Sprintf("%d|%s|%d", deviceID, host, port)
	e := uptimeEntryFor(key)

	e.mu.Lock()
	now := time.Now()

	// Fresh reading — nothing to do.
	if !e.bootTime.IsZero() && now.Sub(e.measured) < uptimeRefresh {
		boot := e.bootTime
		e.mu.Unlock()
		return int64(time.Since(boot).Seconds()), true
	}

	// Needs a probe, unless we are cooling off after failures (see admin lockout above).
	var wait chan struct{}
	var started bool
	if !now.Before(e.blockedTo) {
		wait, started = e.startProbeLocked(deviceID, host, port, username, password)
	}
	boot := e.bootTime
	e.mu.Unlock()

	// Anything cached — even stale, even mid-cooldown — is good enough to render now. Boot time
	// is a constant, so "stale" only means the reading is old, never that it is wrong.
	if !boot.IsZero() {
		return int64(time.Since(boot).Seconds()), true
	}

	// Nothing to show at all. Give the probe a bounded moment so a healthy device still fills the
	// widget on the very first load, then give up and let it finish in the background.
	//
	// Only the caller that STARTED the probe waits. Without that condition a device whose SSH is
	// dropped charges every single request the full wait: the probe takes uptimeSSHTimeout (8s) to
	// fail, so for those 8s each arriving request would queue behind it for uptimeProbeWait and
	// learn nothing — measured live at 1.25s on EVERY dashboard refresh instead of just the first.
	if wait == nil || !started {
		return 0, false
	}
	select {
	case <-wait:
	case <-time.After(uptimeProbeWait):
		return 0, false
	}

	e.mu.Lock()
	boot = e.bootTime
	e.mu.Unlock()
	if boot.IsZero() {
		return 0, false
	}
	return int64(time.Since(boot).Seconds()), true
}

// InvalidateDeviceUptime drops a device's cached boot time — used when its address or
// credentials change, so the next dashboard load re-measures instead of reporting the old box.
func InvalidateDeviceUptime(deviceID uint) {
	prefix := fmt.Sprintf("%d|", deviceID)
	uptimeMu.Lock()
	defer uptimeMu.Unlock()
	for k := range uptimeCache {
		if strings.HasPrefix(k, prefix) {
			delete(uptimeCache, k)
		}
	}
}

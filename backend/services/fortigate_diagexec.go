package services

import (
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The Diagnostics tools FortiOS will only answer over SSH.
//
// Ping, traceroute and the session table have no REST equivalent on FortiOS 7.2 (probed live: the
// monitor API has no ping/traceroute at all, and firewall/session returns its `details` array
// empty on every parameter combination). The device does answer them on the CLI, so these run one
// `execute`/`diagnose` command over a one-shot SSH session and parse the output.
//
// SSH is not free the way a REST GET is, and this file exists separately to keep that visible:
//
//   - An SSH login counts towards the device's admin-lockout-threshold of 3. Two consecutive
//     failures pause every diagnostic on that device for a minute (diagSSHGate below) rather than
//     spending the third attempt and locking the firewall's admin account.
//   - Commands are serialised per device, so a user with the Ping and Traceroute pages open in two
//     tabs opens one session at a time instead of racing.
//   - Every command is built from a validated target (see validateTarget). Nothing the user types
//     reaches a shell uninspected — this is a CLI on a firewall, and a newline in a hostname would
//     be a second command.

const (
	// pingTimeout covers `execute ping`, which sends its repeat-count and then returns. Five
	// packets against an unresponsive host is ~10s of waiting on the device itself.
	pingTimeout = 30 * time.Second

	// tracerouteTimeout is long because traceroute IS long: 32 hops × 3 probes, and the lab run to
	// 8.8.8.8 through a handful of non-answering hops took over half a minute.
	tracerouteTimeout = 100 * time.Second

	// sessionListTimeout bounds `diagnose sys session list`.
	sessionListTimeout = 25 * time.Second

	// maxSessionListBytes caps the session dump. Each session block is ~1 KB, so this is a few
	// thousand sessions — well past what the page shows and far short of what a loaded firewall
	// would happily keep printing.
	maxSessionListBytes = 4 * 1024 * 1024

	// maxSessionRows caps how many parsed sessions are returned to the browser.
	maxSessionRows = 300

	// policyIDUnset is what FortiOS prints as policy_id for a session no policy matched
	// (0xFFFFFFFF). See parseSessionList.
	policyIDUnset = 4294967295
)

// ── Per-device SSH gate ───────────────────────────────────────────────────────

// diagGate serialises diagnostic SSH commands for one device and holds the login circuit breaker.
//
// The breaker mirrors the one in fortigate_sessionpool.go and the uptime probe, for the same reason and
// with the same numbers: the device locks an admin account after 3 failed logins, so this stops at
// 2 and waits out admin-lockout-duration.
type diagGate struct {
	run sync.Mutex // held for the whole command — one diagnostic per device at a time

	mu           sync.Mutex
	fails        int
	blockedUntil time.Time
}

var (
	diagGatesMu sync.Mutex
	diagGates   = map[uint]*diagGate{}
)

func gateFor(deviceID uint) *diagGate {
	diagGatesMu.Lock()
	defer diagGatesMu.Unlock()
	g, ok := diagGates[deviceID]
	if !ok {
		g = &diagGate{}
		diagGates[deviceID] = g
	}
	return g
}

// DiagTarget carries what every SSH diagnostic needs to reach the device.
type DiagTarget struct {
	DeviceID uint
	Host     string
	Port     int
	Username string
	Password string
}

// enter checks the breaker and takes the per-device run lock.
//
// The breaker is checked BEFORE the lock so a queue of callers behind a dead device is released by
// the breaker rather than each waiting out its own dial.
func (g *diagGate) enter() error {
	g.mu.Lock()
	if !g.blockedUntil.IsZero() && time.Now().Before(g.blockedUntil) {
		wait := int(time.Until(g.blockedUntil).Seconds())
		fails := g.fails
		g.mu.Unlock()
		return fmt.Errorf(
			"SSH to this device is paused for %ds after %d failed attempts "+
				"(the firewall locks an admin account after 3)", wait, fails)
	}
	g.mu.Unlock()

	g.run.Lock()
	return nil
}

// leave releases the run lock and records the outcome against the breaker.
//
// A cancellation is NOT a failure: the caller stopped it. Counting it would let two cancelled
// traceroutes pause diagnostics on a healthy firewall for a minute.
func (g *diagGate) leave(deviceID uint, err error) {
	g.run.Unlock()

	if IsDiagCancelled(err) {
		return
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	if err != nil {
		g.fails++
		if g.fails >= uptimeFailThreshold {
			g.blockedUntil = time.Now().Add(uptimeFailCooldown)
			log.Printf("[fortigate] device %d: %d consecutive diagnostic SSH failures (%v) — pausing for %s",
				deviceID, g.fails, err, uptimeFailCooldown)
		}
		return
	}
	g.fails = 0
	g.blockedUntil = time.Time{}
}

// runDiagCommand executes one CLI command under the gate and returns its whole output.
func runDiagCommand(t DiagTarget, command string, timeout time.Duration, maxBytes int64) (string, bool, error) {
	g := gateFor(t.DeviceID)
	if err := g.enter(); err != nil {
		return "", false, err
	}

	out, truncated, err := sshRunCommandLimited(
		t.Host, t.Port, t.Username, t.Password, command, timeout, maxBytes)

	g.leave(t.DeviceID, err)
	if err != nil {
		return "", false, err
	}
	return out, truncated, nil
}

// runDiagStream executes one CLI command under the gate, delivering output line by line.
//
// Same gate, same breaker, same one-at-a-time-per-device rule as runDiagCommand — a streamed
// diagnostic is still an SSH login and still counts towards the device's lockout threshold.
func runDiagStream(
	t DiagTarget, command string, timeout time.Duration, maxLines int,
	cancel <-chan struct{}, onLine func(string),
) error {
	g := gateFor(t.DeviceID)
	if err := g.enter(); err != nil {
		return err
	}

	err := sshStreamCommand(t.Host, t.Port, t.Username, t.Password, command, timeout, maxLines, cancel, onLine)

	g.leave(t.DeviceID, err)
	return err
}

// ── Target validation ─────────────────────────────────────────────────────────

// targetPattern is what may appear as a ping/traceroute destination: an IPv4 or IPv6 literal, or a
// hostname. Deliberately a strict allow-list of characters rather than an escape routine — the
// string is about to be pasted into a command line on a firewall, and the only safe answer to
// "what if it contains a space, a semicolon or a newline?" is that it cannot.
var targetPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,253}$`)

// ValidateDiagTarget checks a user-supplied ping/traceroute destination.
func ValidateDiagTarget(target string) (string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", fmt.Errorf("enter a hostname or IP address")
	}
	if !targetPattern.MatchString(target) {
		return "", fmt.Errorf("invalid target: use a hostname or IP address (letters, digits, dot, colon, hyphen)")
	}
	return target, nil
}

// ── Ping ──────────────────────────────────────────────────────────────────────

// FGPingReply is one ICMP echo reply.
type FGPingReply struct {
	Seq    int     `json:"seq"`
	TTL    int     `json:"ttl"`
	TimeMs float64 `json:"time_ms"`
	Bytes  int     `json:"bytes"`
}

// FGPingResult is the parsed answer of `execute ping`.
//
// ResolvedIP is worth its own field: FortiOS prints "PING www.google.com (142.251.150.119)", so a
// ping BY NAME is also the only forward DNS lookup this firmware offers — `execute nslookup` does
// not exist on 7.2.10 (it answers "command parse error", return code -61). That is why this
// console has no separate DNS Name Lookup page: the answer lives here.
type FGPingResult struct {
	Target     string        `json:"target"`
	ResolvedIP string        `json:"resolved_ip,omitempty"`
	Replies    []FGPingReply `json:"replies"`

	Transmitted int     `json:"transmitted"`
	Received    int     `json:"received"`
	LossPercent int     `json:"loss_percent"`
	MinMs       float64 `json:"min_ms"`
	AvgMs       float64 `json:"avg_ms"`
	MaxMs       float64 `json:"max_ms"`

	/** True when the device answered but every packet was lost. */
	AllLost bool `json:"all_lost"`

	// Raw is the device's own output, shown under the parsed summary. A firewall says things the
	// parser does not model ("Unable to resolve hostname", an ICMP admin-prohibited reply), and
	// dropping them would leave the page reporting "0 received" with no reason.
	Raw string `json:"raw"`
}

var (
	pingHeaderRe = regexp.MustCompile(`PING\s+(\S+)\s+\(([0-9a-fA-F.:]+)\)`)
	pingReplyRe  = regexp.MustCompile(`(\d+)\s+bytes from\s+([0-9a-fA-F.:]+):\s+icmp_seq=(\d+)\s+ttl=(\d+)\s+time=([\d.]+)\s*ms`)
	pingStatsRe  = regexp.MustCompile(`(\d+)\s+packets transmitted,\s*(\d+)\s+packets received,\s*(\d+)%\s+packet loss`)
	pingRTTRe    = regexp.MustCompile(`round-trip min/avg/max\s*=\s*([\d.]+)/([\d.]+)/([\d.]+)\s*ms`)
)

// parsePingReplyLine reads one ICMP echo reply out of a single line, or reports that the line was
// not one.
//
// Split out so the batch parser and the live stream read a reply the SAME way. They used to be
// destined to diverge: the streaming path sees one line at a time and cannot re-scan the whole
// output, so a second regex would have grown next to this one and the two would have drifted.
func parsePingReplyLine(line string) (FGPingReply, bool) {
	m := pingReplyRe.FindStringSubmatch(line)
	if m == nil {
		return FGPingReply{}, false
	}
	b, _ := strconv.Atoi(m[1])
	seq, _ := strconv.Atoi(m[3])
	ttl, _ := strconv.Atoi(m[4])
	ms, _ := strconv.ParseFloat(m[5], 64)
	return FGPingReply{Seq: seq, TTL: ttl, TimeMs: ms, Bytes: b}, true
}

// parsePingHeaderLine reads the address the target resolved to, from the "PING host (ip)" line.
func parsePingHeaderLine(line string) (string, bool) {
	m := pingHeaderRe.FindStringSubmatch(line)
	if m == nil {
		return "", false
	}
	return m[2], true
}

// ParsePingOutput turns `execute ping` output into a result.
//
// Exported for tests, which run it against output captured from the real device rather than
// against a fixture someone wrote from memory.
func ParsePingOutput(target, out string) FGPingResult {
	r := FGPingResult{Target: target, Raw: strings.TrimSpace(out), Replies: []FGPingReply{}}

	for _, line := range strings.Split(out, "\n") {
		if r.ResolvedIP == "" {
			if ip, ok := parsePingHeaderLine(line); ok {
				r.ResolvedIP = ip
			}
		}
		if reply, ok := parsePingReplyLine(line); ok {
			r.Replies = append(r.Replies, reply)
		}
	}
	if m := pingStatsRe.FindStringSubmatch(out); m != nil {
		r.Transmitted, _ = strconv.Atoi(m[1])
		r.Received, _ = strconv.Atoi(m[2])
		r.LossPercent, _ = strconv.Atoi(m[3])
	}
	if m := pingRTTRe.FindStringSubmatch(out); m != nil {
		r.MinMs, _ = strconv.ParseFloat(m[1], 64)
		r.AvgMs, _ = strconv.ParseFloat(m[2], 64)
		r.MaxMs, _ = strconv.ParseFloat(m[3], 64)
	}
	// A total loss prints no round-trip line at all, so "no rtt" must not be reported as 0 ms.
	r.AllLost = r.Transmitted > 0 && r.Received == 0
	return r
}

// PingOptions are the knobs the page exposes, mapped to `execute ping-options`.
type PingOptions struct {
	Count    int    // repeat-count, 1..10
	Size     int    // data-size in bytes, 32..1400
	SourceIP string // source address; empty = the device's own choice
}

// clampPingOptions keeps the request inside what the CLI accepts and what a web request should
// wait for. The count ceiling is about the HTTP call, not the device: each packet is up to a
// second of waiting, and 10 already sits close to pingTimeout on a dead target.
func clampPingOptions(o PingOptions) PingOptions {
	if o.Count < 1 || o.Count > 10 {
		o.Count = 5
	}
	if o.Size < 32 || o.Size > 1400 {
		o.Size = 56
	}
	return o
}

// ── Traceroute ────────────────────────────────────────────────────────────────

// FGTracerouteHop is one row of the traceroute.
//
// A hop can answer some probes and not others — the lab run had hops replying to one probe out of
// three — so RTTs and Timeouts are separate counts rather than a single "reachable" flag.
type FGTracerouteHop struct {
	Hop      int       `json:"hop"`
	IP       string    `json:"ip,omitempty"`
	Hostname string    `json:"hostname,omitempty"`
	RTTs     []float64 `json:"rtts"`
	Timeouts int       `json:"timeouts"`
}

// FGTracerouteResult is the parsed answer of `execute traceroute`.
type FGTracerouteResult struct {
	Target     string            `json:"target"`
	ResolvedIP string            `json:"resolved_ip,omitempty"`
	Hops       []FGTracerouteHop `json:"hops"`
	Raw        string            `json:"raw"`
}

var (
	traceHeaderRe = regexp.MustCompile(`traceroute to\s+(\S+)\s+\(([0-9a-fA-F.:]+)\)`)
	traceHopRe    = regexp.MustCompile(`^\s*(\d{1,2})\s+(.*)$`)
	traceIPRe     = regexp.MustCompile(`^[0-9a-fA-F.:]+$`)
	traceRTTRe    = regexp.MustCompile(`([\d.]+)\s*ms`)
	traceNameRe   = regexp.MustCompile(`<([^>]+)>`)
)

// parseTracerouteOutput turns `execute traceroute` output into hops.
//
// The shape it has to survive, from a real run:
//
//	 1  10.0.99.1  0.310 ms  0.212 ms  0.111 ms
//	 7  103.3.176.109 <103-3-176-109.static.asianet.co.th>  3.600 ms  4.387 ms  13.123 ms
//	 8  * 171.102.248.126 <171-102-248-126.…>  3.829 ms *
//	10  * * *
//
// Note hop 8: the stars are INTERLEAVED with the answer, not grouped, so a positional parse
// ("field 2 is the address") gets it wrong. Each hop line is therefore scanned for whatever it
// contains — an address if one appeared, every "N ms" timing, and a count of the stars.
func parseTracerouteOutput(target, out string) FGTracerouteResult {
	r := FGTracerouteResult{Target: target, Raw: strings.TrimSpace(out), Hops: []FGTracerouteHop{}}

	if m := traceHeaderRe.FindStringSubmatch(out); m != nil {
		r.ResolvedIP = m[2]
	}

	for _, line := range strings.Split(out, "\n") {
		if hop, ok := parseTracerouteHopLine(line); ok {
			r.Hops = append(r.Hops, hop)
		}
	}
	return r
}

// parseTracerouteHopLine reads one hop out of a single line, or reports that the line was not one.
//
// Shared by the batch parser and the live stream for the same reason as parsePingReplyLine: the
// awkward part of this format is per-line, and having two copies of it is how one of them ends up
// getting hop 8 wrong.
func parseTracerouteHopLine(line string) (FGTracerouteHop, bool) {
	line = strings.TrimRight(line, "\r")
	// The device echoes its prompt ("NGFW-Testing # ") on the first lines; a hop line never
	// contains one, so anything with a prompt marker is skipped before the hop match.
	if strings.Contains(line, "#") {
		return FGTracerouteHop{}, false
	}
	m := traceHopRe.FindStringSubmatch(line)
	if m == nil {
		return FGTracerouteHop{}, false
	}
	hopNum, err := strconv.Atoi(m[1])
	if err != nil {
		return FGTracerouteHop{}, false
	}
	rest := m[2]
	// A "traceroute to …, 32 hops max" header can start with a digit run; it has no timings and no
	// address, so it falls out at the end rather than needing its own guard.

	hop := FGTracerouteHop{Hop: hopNum, RTTs: []float64{}}

	if nm := traceNameRe.FindStringSubmatch(rest); nm != nil {
		hop.Hostname = nm[1]
		rest = traceNameRe.ReplaceAllString(rest, " ")
	}
	// Strip the timings before looking for an address so "3.600" cannot be mistaken for one.
	for _, tm := range traceRTTRe.FindAllStringSubmatch(rest, -1) {
		if ms, err := strconv.ParseFloat(tm[1], 64); err == nil {
			hop.RTTs = append(hop.RTTs, ms)
		}
	}
	rest = traceRTTRe.ReplaceAllString(rest, " ")

	for _, tok := range strings.Fields(rest) {
		switch {
		case tok == "*":
			hop.Timeouts++
		case hop.IP == "" && traceIPRe.MatchString(tok) && strings.ContainsAny(tok, ".:"):
			hop.IP = tok
		}
	}
	if hop.IP == "" && hop.Timeouts == 0 && len(hop.RTTs) == 0 {
		return FGTracerouteHop{}, false // not a hop line after all
	}
	return hop, true
}

// parseTracerouteHeaderLine reads the address the target resolved to.
func parseTracerouteHeaderLine(line string) (string, bool) {
	m := traceHeaderRe.FindStringSubmatch(line)
	if m == nil {
		return "", false
	}
	return m[2], true
}

// ── Live streaming (ping / traceroute) ────────────────────────────────────────
//
// The device prints these commands as they happen — measured on the lab FGT80E, ping replies land
// exactly 1.000s apart and each traceroute hop appears as it resolves. Buffering the whole answer
// and returning it at the end throws that away and makes a 31-second traceroute look like a frozen
// page. So the same commands are also offered as a stream.
//
// One parser, two delivery shapes: every event below is produced by the SAME per-line functions the
// batch parsers use, and the run finishes by handing over the ordinary FGPingResult /
// FGTracerouteResult built from the accumulated output. A caller therefore ends up with exactly
// what the non-streaming path would have returned; the events are progress, not a second answer.

// Diagnostic stream event types.
const (
	DiagEventLine      = "line"       // one raw line, exactly as the device printed it
	DiagEventReply     = "reply"      // a parsed ICMP echo reply
	DiagEventHop       = "hop"        // a parsed traceroute hop
	DiagEventPingDone  = "ping_done"  // the complete, parsed ping result
	DiagEventTraceDone = "trace_done" // the complete, parsed traceroute result
)

// DiagEvent is one thing that happened while a diagnostic ran.
type DiagEvent struct {
	Type string `json:"type"`

	Line  string              `json:"line,omitempty"`
	Reply *FGPingReply        `json:"reply,omitempty"`
	Hop   *FGTracerouteHop    `json:"hop,omitempty"`
	Ping  *FGPingResult       `json:"ping,omitempty"`
	Trace *FGTracerouteResult `json:"trace,omitempty"`

	// ResolvedIP is sent as soon as the device prints it, which for a ping by name is the earliest
	// useful thing on screen — FortiOS 7.2 has no nslookup, so this IS the DNS answer.
	ResolvedIP string `json:"resolved_ip,omitempty"`
}

// maxPingLines / maxTraceLines bound a stream. Both are far above any real run (a 10-packet ping
// prints ~16 lines, a 32-hop traceroute ~35) and exist only so a device that never stops writing
// cannot hold the socket open indefinitely.
const (
	maxPingLines  = 200
	maxTraceLines = 400
)

// PingStream runs `execute ping` and reports each line and reply as it arrives.
//
// onEvent is called from the reading goroutine — it must not block, or it becomes back-pressure on
// the SSH channel while the device keeps printing.
func PingStream(t DiagTarget, target string, opts PingOptions, cancel <-chan struct{}, onEvent func(DiagEvent)) error {
	target, err := ValidateDiagTarget(target)
	if err != nil {
		return err
	}
	opts = clampPingOptions(opts)

	lines := []string{
		"execute ping-options repeat-count " + strconv.Itoa(opts.Count),
		"execute ping-options data-size " + strconv.Itoa(opts.Size),
	}
	if opts.SourceIP != "" {
		src, err := ValidateDiagTarget(opts.SourceIP)
		if err != nil {
			return fmt.Errorf("invalid source address: %w", err)
		}
		lines = append(lines, "execute ping-options source "+src)
	}
	// The trailing reset matters as much here as in the batch path: ping-options are global CLI
	// state, so a 1400-byte data-size left behind silently changes what the next administrator's
	// manual ping measures.
	lines = append(lines, "execute ping "+target, "execute ping-options reset")

	var raw strings.Builder
	resolved := ""

	err = runDiagStream(t, strings.Join(lines, "\n"), pingTimeout, maxPingLines, cancel, func(line string) {
		raw.WriteString(line)
		raw.WriteString("\n")

		if resolved == "" {
			if ip, ok := parsePingHeaderLine(line); ok {
				resolved = ip
				onEvent(DiagEvent{Type: DiagEventLine, Line: line, ResolvedIP: ip})
				return
			}
		}
		if reply, ok := parsePingReplyLine(line); ok {
			onEvent(DiagEvent{Type: DiagEventReply, Line: line, Reply: &reply})
			return
		}
		onEvent(DiagEvent{Type: DiagEventLine, Line: line})
	})
	if err != nil {
		return err
	}

	// The authoritative summary comes from the ordinary parser over everything that was printed —
	// the same value the non-streaming endpoint would return.
	result := ParsePingOutput(target, raw.String())
	onEvent(DiagEvent{Type: DiagEventPingDone, Ping: &result})
	return nil
}

// TracerouteOptions are the knobs the Trace Route page exposes, mapped to
// `execute traceroute-options`.
//
// Only the source address, because it is the only one that changes the ANSWER rather than the
// presentation: a firewall with several interfaces picks its egress by the route to the target, and
// "trace the path a DMZ host would take" is a different question from "trace the path the firewall
// takes". Probe count and SD-WAN mode exist on the device too and are deliberately not exposed —
// they would be knobs for their own sake.
type TracerouteOptions struct {
	SourceIP string // empty = auto (the device picks, which is the FortiOS default)
}

// tracerouteSourceAuto is what FortiOS calls "let me choose" — it is the value `execute
// traceroute-options view-settings` prints as the default, and the only way back to it.
const tracerouteSourceAuto = "auto"

// buildTracerouteCommands assembles the CLI for one traceroute run.
//
// ⚠️ `execute traceroute-options` is GLOBAL, PERSISTENT state on the firewall and — unlike
// `execute ping-options` — it has NO `reset` subcommand. Verified live on FortiOS 7.2.10:
//
//	execute traceroute-options reset       → command parse error before 'reset', return code -61
//	execute traceroute-options source auto → accepted; view-settings reports "Source Address: auto"
//
// Two consequences, and both are handled here rather than left to the caller:
//
//   - The source is set on EVERY run, `auto` included. Without that, a source somebody typed into
//     this page an hour ago (or an administrator set by hand on the CLI) silently keeps applying,
//     and a traceroute that quietly went out of the wrong interface is worse than one that failed.
//   - The trailing line restores `auto`, because leaving a source behind changes what the NEXT
//     person's manual traceroute measures. Same duty of care as PingStream's `ping-options reset`.
func buildTracerouteCommands(target string, opts TracerouteOptions) ([]string, error) {
	source := strings.TrimSpace(opts.SourceIP)
	if source == "" {
		source = tracerouteSourceAuto
	} else if source != tracerouteSourceAuto {
		validated, err := ValidateDiagTarget(source)
		if err != nil {
			return nil, fmt.Errorf("invalid source address: %w", err)
		}
		source = validated
	}

	return []string{
		"execute traceroute-options source " + source,
		"execute traceroute " + target,
		"execute traceroute-options source " + tracerouteSourceAuto,
	}, nil
}

// TracerouteStream runs `execute traceroute` and reports each hop as the device resolves it.
//
// opts.SourceIP is optional; empty means the device chooses its own source, which is what it did
// before this option existed.
func TracerouteStream(
	t DiagTarget, target string, opts TracerouteOptions,
	cancel <-chan struct{}, onEvent func(DiagEvent),
) error {
	target, err := ValidateDiagTarget(target)
	if err != nil {
		return err
	}
	commands, err := buildTracerouteCommands(target, opts)
	if err != nil {
		return err
	}

	var raw strings.Builder
	resolved := ""

	err = runDiagStream(t, strings.Join(commands, "\n"), tracerouteTimeout, maxTraceLines, cancel, func(line string) {
		raw.WriteString(line)
		raw.WriteString("\n")

		if resolved == "" {
			if ip, ok := parseTracerouteHeaderLine(line); ok {
				resolved = ip
				onEvent(DiagEvent{Type: DiagEventLine, Line: line, ResolvedIP: ip})
				return
			}
		}
		if hop, ok := parseTracerouteHopLine(line); ok {
			onEvent(DiagEvent{Type: DiagEventHop, Line: line, Hop: &hop})
			return
		}
		onEvent(DiagEvent{Type: DiagEventLine, Line: line})
	})
	if err != nil {
		return err
	}

	result := parseTracerouteOutput(target, raw.String())
	onEvent(DiagEvent{Type: DiagEventTraceDone, Trace: &result})
	return nil
}

// ── Session list ──────────────────────────────────────────────────────────────

// FGSession is one row of the session table.
type FGSession struct {
	Protocol    string `json:"protocol"` // tcp | udp | icmp | ip/<n>
	Source      string `json:"source"`
	SourcePort  int    `json:"source_port"`
	Dest        string `json:"dest"`
	DestPort    int    `json:"dest_port"`
	NATSource   string `json:"nat_source,omitempty"`
	NATPort     int    `json:"nat_port,omitempty"`
	DurationSec int    `json:"duration_sec"`
	ExpireSec   int    `json:"expire_sec"`
	PolicyID    int    `json:"policy_id"`
	State       string `json:"state,omitempty"`
	TxBytes     int64  `json:"tx_bytes"`
	RxBytes     int64  `json:"rx_bytes"`
}

// FGSessionList is the Session Monitor answer: live counters plus as much of the table as was
// asked for.
type FGSessionList struct {
	Counters FGSessionCounters `json:"counters"`
	Sessions []FGSession       `json:"sessions"`

	// Truncated says the device had more to say than was read or shown. The page reports it —
	// a session table silently cut off at 300 rows reads as "that is all there is".
	Truncated bool   `json:"truncated"`
	Filter    string `json:"filter,omitempty"`
}

// SessionFilter narrows `diagnose sys session list` on the device rather than in Go. Filtering at
// the source is the difference between reading a handful of blocks and streaming the whole table
// across the wire to throw most of it away.
type SessionFilter struct {
	SrcIP    string
	DstIP    string
	DstPort  int
	Protocol int // IP protocol number: 6 tcp, 17 udp, 1 icmp
}

var (
	sessInfoRe   = regexp.MustCompile(`proto=(\d+).*?duration=(\d+)\s+expire=(\d+)`)
	sessHookRe   = regexp.MustCompile(`hook=(\S+)\s+dir=org\s+act=(\S+)\s+([0-9a-fA-F.:]+):(\d+)->([0-9a-fA-F.:]+):(\d+)\(([0-9a-fA-F.:]+):(\d+)\)`)
	sessStatRe   = regexp.MustCompile(`org=(\d+)/\d+/\d+\s+reply=(\d+)/\d+/\d+`)
	sessPolicyRe = regexp.MustCompile(`policy_id=(\d+)`)
	sessStateRe  = regexp.MustCompile(`(?m)^state=(.*)$`)
)

// protoName maps the IP protocol number the session table prints to a name.
func protoName(n int) string {
	switch n {
	case 1:
		return "icmp"
	case 6:
		return "tcp"
	case 17:
		return "udp"
	case 47:
		return "gre"
	case 50:
		return "esp"
	case 58:
		return "icmpv6"
	default:
		return "ip/" + strconv.Itoa(n)
	}
}

// parseSessionList turns `diagnose sys session list` output into rows, stopping at `limit`.
//
// The output is a sequence of blocks that each begin with "session info:", so the blocks are split
// on that marker rather than on blank lines — a block contains blank lines of its own.
func parseSessionList(out string, limit int) ([]FGSession, bool) {
	if limit <= 0 {
		limit = maxSessionRows
	}
	blocks := strings.Split(out, "session info:")
	sessions := make([]FGSession, 0, limit)

	for _, b := range blocks[1:] { // [0] is whatever preceded the first marker (the prompt echo)
		if len(sessions) >= limit {
			return sessions, true
		}
		s := FGSession{}

		if m := sessInfoRe.FindStringSubmatch(b); m != nil {
			p, _ := strconv.Atoi(m[1])
			s.Protocol = protoName(p)
			s.DurationSec, _ = strconv.Atoi(m[2])
			s.ExpireSec, _ = strconv.Atoi(m[3])
		}
		if m := sessHookRe.FindStringSubmatch(b); m != nil {
			s.Source, s.Dest = m[3], m[5]
			s.SourcePort, _ = strconv.Atoi(m[4])
			s.DestPort, _ = strconv.Atoi(m[6])
			// The parenthesised pair is what the address was translated TO. On a session with no
			// NAT the device prints 0.0.0.0:0, which is not an address — recording it would put a
			// fictional translation on every internal session.
			if nat := m[7]; nat != "0.0.0.0" && nat != "::" {
				s.NATSource = nat
				s.NATPort, _ = strconv.Atoi(m[8])
			}
		}
		if m := sessStatRe.FindStringSubmatch(b); m != nil {
			s.TxBytes, _ = strconv.ParseInt(m[1], 10, 64)
			s.RxBytes, _ = strconv.ParseInt(m[2], 10, 64)
		}
		if m := sessPolicyRe.FindStringSubmatch(b); m != nil {
			id, _ := strconv.Atoi(m[1])
			// FortiOS prints 4294967295 (0xFFFFFFFF, "unset") for sessions that no policy
			// matched — its own management traffic, and anything handled locally. Passing that
			// through would put "policy #4294967295" in the table, which reads as a real rule id
			// and sends whoever is debugging to look for a policy that does not exist. Verified
			// live: the admin HTTPS sessions to the box carry exactly this value.
			if id != policyIDUnset {
				s.PolicyID = id
			}
		}
		if m := sessStateRe.FindStringSubmatch(b); m != nil {
			s.State = strings.TrimSpace(m[1])
		}

		// A block with no endpoints parsed is not a session — most likely a truncated tail.
		if s.Source == "" && s.Dest == "" {
			continue
		}
		sessions = append(sessions, s)
	}
	return sessions, false
}

// buildSessionFilterCommands turns a filter into the CLI that narrows the dump.
//
// `diagnose sys session filter clear` runs FIRST, always. The filter is global state on the
// firewall that persists between sessions, so without the clear a previous run's filter silently
// narrows this one — and a page that shows three sessions because someone else filtered on port
// 443 an hour ago is worse than one that shows none.
func buildSessionFilterCommands(f SessionFilter) ([]string, string, error) {
	cmds := []string{"diagnose sys session filter clear"}
	var desc []string

	if f.SrcIP != "" {
		ip, err := ValidateDiagTarget(f.SrcIP)
		if err != nil {
			return nil, "", fmt.Errorf("invalid source: %w", err)
		}
		cmds = append(cmds, "diagnose sys session filter src "+ip)
		desc = append(desc, "src "+ip)
	}
	if f.DstIP != "" {
		ip, err := ValidateDiagTarget(f.DstIP)
		if err != nil {
			return nil, "", fmt.Errorf("invalid destination: %w", err)
		}
		cmds = append(cmds, "diagnose sys session filter dst "+ip)
		desc = append(desc, "dst "+ip)
	}
	if f.DstPort > 0 {
		if f.DstPort > 65535 {
			return nil, "", fmt.Errorf("invalid port: %d", f.DstPort)
		}
		cmds = append(cmds, "diagnose sys session filter dport "+strconv.Itoa(f.DstPort))
		desc = append(desc, "dport "+strconv.Itoa(f.DstPort))
	}
	if f.Protocol > 0 {
		if f.Protocol > 255 {
			return nil, "", fmt.Errorf("invalid protocol: %d", f.Protocol)
		}
		cmds = append(cmds, "diagnose sys session filter proto "+strconv.Itoa(f.Protocol))
		desc = append(desc, protoName(f.Protocol))
	}
	return cmds, strings.Join(desc, " · "), nil
}

// ListSessions reads the live session table over SSH.
//
// The counters come from REST (cheap, and the device's own totals) and only the ROWS need SSH —
// firewall/session returns an empty `details` array on 7.2.10 no matter how it is called.
func ListSessions(fc *FortiClient, t DiagTarget, f SessionFilter, limit int) (FGSessionList, error) {
	cmds, desc, err := buildSessionFilterCommands(f)
	if err != nil {
		return FGSessionList{}, err
	}

	out := FGSessionList{Sessions: []FGSession{}, Filter: desc}
	if counters, err := fc.GetSessionCounters(); err == nil {
		out.Counters = counters
	}

	// The trailing clear leaves the device's global filter as it was found. Same reasoning as
	// ping-options reset: this is shared CLI state on someone else's firewall.
	script := strings.Join(append(cmds, "diagnose sys session list", "diagnose sys session filter clear"), "\n")

	raw, cut, err := runDiagCommand(t, script, sessionListTimeout, maxSessionListBytes)
	if err != nil {
		return FGSessionList{}, err
	}
	sessions, hitLimit := parseSessionList(raw, limit)
	out.Sessions = sessions
	out.Truncated = cut || hitLimit
	return out, nil
}

package services

import (
	"strconv"
	"strings"

	"network_automation/entity"
)

// Topology ping — the firewall reachability check behind the Topology map's pinned devices.
//
// It reuses the diag-exec plumbing the Troubleshooting ▸ Ping page already runs on (the per-device
// run lock, the circuit breaker that waits out admin-lockout, the exact `execute ping` output
// parser), but in a BATCH shape rather than a WebSocket stream: a background sweep has no socket to
// stream to and wants one settled answer, not a line at a time.
//
// Kept out of fortigate_diagexec.go on purpose — that file owns the interactive diagnostics the
// pages drive, this is the unattended health check the scheduler drives — and well clear of
// fortigate.go, which the layout test holds to its ceiling.

// topologyPingBytes bounds a single batch ping's output. A 10-packet ping is a few hundred bytes;
// this is far above that and far below anything that could pin memory if the device misbehaved.
const topologyPingBytes = 64 * 1024

// PingOnce runs `execute ping` once and returns the parsed result.
//
// Same command shape as PingStream (repeat-count, data-size, optional source, then the trailing
// `ping-options reset` so a data-size left behind never changes the next operator's manual ping),
// but collected in one go through runDiagCommand. Exported so the topology runner — and anything
// else that wants a yes/no reachability answer rather than a live stream — can call it.
func PingOnce(t DiagTarget, target string, opts PingOptions) (FGPingResult, error) {
	target, err := ValidateDiagTarget(target)
	if err != nil {
		return FGPingResult{}, err
	}
	opts = clampPingOptions(opts)

	lines := []string{
		"execute ping-options repeat-count " + strconv.Itoa(opts.Count),
		"execute ping-options data-size " + strconv.Itoa(opts.Size),
	}
	if opts.SourceIP != "" {
		src, err := ValidateDiagTarget(opts.SourceIP)
		if err != nil {
			return FGPingResult{}, err
		}
		lines = append(lines, "execute ping-options source "+src)
	}
	lines = append(lines, "execute ping "+target, "execute ping-options reset")

	out, _, err := runDiagCommand(t, strings.Join(lines, "\n"), pingTimeout, topologyPingBytes)
	if err != nil {
		return FGPingResult{}, err
	}
	return ParsePingOutput(target, out), nil
}

// PingReachable reduces a parsed ping to the three states the Topology map draws.
//
//   - up      — at least one echo reply came back.
//   - down    — the device answered the command and every packet was lost (AllLost), i.e. the
//     firewall could run the ping but the target did not reply.
//   - unknown — nothing conclusive (a malformed run, zero packets transmitted). The caller decides
//     whether an outright command error is "unknown" too; this only reads the output.
func PingReachable(r FGPingResult) string {
	if r.Received > 0 {
		return entity.TopologyStatusUp
	}
	if r.AllLost {
		return entity.TopologyStatusDown
	}
	return entity.TopologyStatusUnknown
}

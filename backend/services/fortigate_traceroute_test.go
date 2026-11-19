package services

import (
	"strings"
	"testing"
)

// `execute traceroute-options` is global, persistent state on the firewall, and — unlike
// `execute ping-options` — it has NO reset subcommand. Verified live on FortiOS 7.2.10:
//
//	execute traceroute-options reset       → command parse error before 'reset' (return code -61)
//	execute traceroute-options source auto → accepted; view-settings shows "Source Address: auto"
//
// So the command builder carries the whole burden of leaving the device as it found it, and these
// tests are what stop that from being quietly dropped later.

func TestBuildTracerouteCommands_SetsAndRestoresTheSource(t *testing.T) {
	cmds, err := buildTracerouteCommands("8.8.8.8", TracerouteOptions{SourceIP: "10.0.99.201"})
	if err != nil {
		t.Fatalf("buildTracerouteCommands: %v", err)
	}
	want := []string{
		"execute traceroute-options source 10.0.99.201",
		"execute traceroute 8.8.8.8",
		"execute traceroute-options source auto",
	}
	if len(cmds) != len(want) {
		t.Fatalf("got %d commands %q, want %d", len(cmds), cmds, len(want))
	}
	for i := range want {
		if cmds[i] != want[i] {
			t.Errorf("command %d = %q, want %q", i, cmds[i], want[i])
		}
	}
}

// No source given still emits `source auto` FIRST. Without it, a source someone typed into the page
// an hour ago (or set by hand on the CLI) silently keeps applying, and a traceroute that went out
// of the wrong interface without saying so is worse than one that failed.
func TestBuildTracerouteCommands_NoSourceStillPinsItToAuto(t *testing.T) {
	for _, in := range []string{"", "   "} {
		cmds, err := buildTracerouteCommands("8.8.8.8", TracerouteOptions{SourceIP: in})
		if err != nil {
			t.Fatalf("buildTracerouteCommands(%q): %v", in, err)
		}
		if cmds[0] != "execute traceroute-options source auto" {
			t.Errorf("first command for source %q = %q, want the source pinned to auto", in, cmds[0])
		}
	}
}

// The last line must always put the device back to auto — it is shared state, and leaving a source
// behind changes what the next administrator's manual traceroute measures.
func TestBuildTracerouteCommands_AlwaysRestoresAuto(t *testing.T) {
	for _, src := range []string{"", "10.0.99.201", "auto"} {
		cmds, err := buildTracerouteCommands("8.8.8.8", TracerouteOptions{SourceIP: src})
		if err != nil {
			t.Fatalf("buildTracerouteCommands(%q): %v", src, err)
		}
		last := cmds[len(cmds)-1]
		if last != "execute traceroute-options source auto" {
			t.Errorf("last command for source %q = %q, want a restore to auto", src, last)
		}
		// `reset` does not exist on this command — using it would fail with -61 and leave the
		// source set.
		for _, c := range cmds {
			if strings.Contains(c, "traceroute-options reset") {
				t.Errorf("command %q uses a subcommand FortiOS does not have", c)
			}
		}
	}
}

// The source lands on a firewall command line, so it goes through the same strict allow-list as the
// target. A value with a space or a newline in it would be a second command.
func TestBuildTracerouteCommands_RejectsAnUnsafeSource(t *testing.T) {
	for _, bad := range []string{
		"10.0.0.1; execute reboot",
		"10.0.0.1\nexecute shutdown",
		"10.0.0.1 10.0.0.2",
		"'; get system status",
	} {
		if _, err := buildTracerouteCommands("8.8.8.8", TracerouteOptions{SourceIP: bad}); err == nil {
			t.Errorf("buildTracerouteCommands accepted %q — it must never reach the CLI", bad)
		}
	}
}

// The hop parser must be unaffected by the extra option lines: they echo the device prompt, which
// parseTracerouteHopLine already skips, and the traceroute output itself is unchanged. This is the
// exact output captured from the lab FGT80E with a source set.
func TestParseTracerouteOutput_WithSourceSet(t *testing.T) {
	out := `NGFW-Testing #
NGFW-Testing # traceroute to 10.0.99.1 (10.0.99.1), 32 hops max, 3 probe packets per hop, 72 byte packets
 1  10.0.99.1  0.264 ms  0.158 ms  0.108 ms

NGFW-Testing # `

	r := parseTracerouteOutput("10.0.99.1", out)
	if r.ResolvedIP != "10.0.99.1" {
		t.Errorf("ResolvedIP = %q, want 10.0.99.1", r.ResolvedIP)
	}
	if len(r.Hops) != 1 {
		t.Fatalf("got %d hops, want 1: %+v", len(r.Hops), r.Hops)
	}
	h := r.Hops[0]
	if h.Hop != 1 || h.IP != "10.0.99.1" || len(h.RTTs) != 3 || h.Timeouts != 0 {
		t.Errorf("hop = %+v, want hop 1 via 10.0.99.1 with 3 timings", h)
	}
}

// A source address the device does not own answers nothing at all — every hop is "* * *" and there
// is no error line. Captured live: setting source 203.0.113.77 produced 23+ silent hops. The page
// has to be able to show that as "no reply", not as a hop list it can misread.
func TestParseTracerouteOutput_SilentHopsFromAnUnusableSource(t *testing.T) {
	out := `traceroute to 10.0.99.1 (10.0.99.1), 32 hops max, 3 probe packets per hop, 72 byte packets
 1  * * *
 2  * * *
 3  * * *`

	r := parseTracerouteOutput("10.0.99.1", out)
	if len(r.Hops) != 3 {
		t.Fatalf("got %d hops, want 3", len(r.Hops))
	}
	for _, h := range r.Hops {
		if h.IP != "" || len(h.RTTs) != 0 || h.Timeouts != 3 {
			t.Errorf("hop %d = %+v, want three timeouts and no address", h.Hop, h)
		}
	}
}

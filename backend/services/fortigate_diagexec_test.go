package services

import (
	"strings"
	"testing"
)

// The fixtures below are VERBATIM output from the lab FGT80E (FortiOS 7.2.10), captured over SSH
// while these parsers were being written — prompt echoes, double spaces, interleaved stars and
// all. That is the point: a fixture written from memory would agree with whatever the parser
// happens to do, and every one of the awkward cases here (a hop that answers one probe out of
// three, a total loss printing no round-trip line) came from the device rather than from
// imagination.

const realPingOutput = `NGFW-Testing #
NGFW-Testing #
NGFW-Testing # PING 1.1.1.1 (1.1.1.1): 64 data bytes
72 bytes from 1.1.1.1: icmp_seq=0 ttl=52 time=3.6 ms
72 bytes from 1.1.1.1: icmp_seq=1 ttl=52 time=3.6 ms
72 bytes from 1.1.1.1: icmp_seq=2 ttl=52 time=4.0 ms

--- 1.1.1.1 ping statistics ---
3 packets transmitted, 3 packets received, 0% packet loss
round-trip min/avg/max = 3.6/3.7/4.0 ms

NGFW-Testing # `

// A ping by NAME. FortiOS prints the address it resolved to, which is the only forward DNS lookup
// this firmware offers at all (`execute nslookup` does not exist — it answers parse error -61).
const realPingByNameOutput = `NGFW-Testing #
NGFW-Testing # PING www.google.com (142.251.150.119): 56 data bytes
64 bytes from 142.251.150.119: icmp_seq=0 ttl=118 time=3.9 ms
64 bytes from 142.251.150.119: icmp_seq=1 ttl=118 time=3.1 ms

--- www.google.com ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 3.1/3.5/3.9 ms
`

func TestParsePingOutput_RealDevice(t *testing.T) {
	r := ParsePingOutput("1.1.1.1", realPingOutput)

	if r.ResolvedIP != "1.1.1.1" {
		t.Errorf("ResolvedIP = %q, want 1.1.1.1", r.ResolvedIP)
	}
	if len(r.Replies) != 3 {
		t.Fatalf("got %d replies, want 3", len(r.Replies))
	}
	if got := r.Replies[2]; got.Seq != 2 || got.TTL != 52 || got.TimeMs != 4.0 || got.Bytes != 72 {
		t.Errorf("third reply = %+v, want seq=2 ttl=52 time=4.0 bytes=72", got)
	}
	if r.Transmitted != 3 || r.Received != 3 || r.LossPercent != 0 {
		t.Errorf("stats = %d/%d/%d%%, want 3/3/0%%", r.Transmitted, r.Received, r.LossPercent)
	}
	if r.MinMs != 3.6 || r.AvgMs != 3.7 || r.MaxMs != 4.0 {
		t.Errorf("rtt = %v/%v/%v, want 3.6/3.7/4.0", r.MinMs, r.AvgMs, r.MaxMs)
	}
	if r.AllLost {
		t.Error("AllLost = true on a ping where every packet came back")
	}
}

// Pinging a name is how this console answers "what does this hostname resolve to, from the
// firewall's point of view" — so the resolved address has to survive parsing.
func TestParsePingOutput_ResolvesHostname(t *testing.T) {
	r := ParsePingOutput("www.google.com", realPingByNameOutput)
	if r.ResolvedIP != "142.251.150.119" {
		t.Errorf("ResolvedIP = %q, want 142.251.150.119", r.ResolvedIP)
	}
	if r.Received != 2 {
		t.Errorf("Received = %d, want 2", r.Received)
	}
}

// A host that never answers prints statistics but NO round-trip line. The danger is reporting the
// resulting zero as a 0 ms round trip — "instant" and "never came back" must not look alike.
func TestParsePingOutput_TotalLossHasNoRoundTrip(t *testing.T) {
	out := `PING 10.99.99.99 (10.99.99.99): 56 data bytes

--- 10.99.99.99 ping statistics ---
5 packets transmitted, 0 packets received, 100% packet loss
`
	r := ParsePingOutput("10.99.99.99", out)

	if !r.AllLost {
		t.Error("AllLost = false, want true when 0 of 5 packets returned")
	}
	if r.LossPercent != 100 {
		t.Errorf("LossPercent = %d, want 100", r.LossPercent)
	}
	if len(r.Replies) != 0 {
		t.Errorf("got %d replies, want none", len(r.Replies))
	}
	if r.AvgMs != 0 {
		t.Errorf("AvgMs = %v — there was no round-trip line to read it from", r.AvgMs)
	}
}

const realTracerouteOutput = `NGFW-Testing # traceroute to 8.8.8.8 (8.8.8.8), 32 hops max, 3 probe packets per hop, 72 byte packets
 1  10.0.99.1  0.310 ms  0.212 ms  0.111 ms
 2  10.0.2.1  0.740 ms  0.632 ms  0.520 ms
 7  103.3.176.109 <103-3-176-109.static.asianet.co.th>  3.600 ms  4.387 ms  13.123 ms
 8  * 171.102.248.126 <171-102-248-126.static.asianet.co.th>  3.829 ms *
10  * * *
14  209.85.243.161  5.497 ms  5.656 ms  4.778 ms
`

func TestParseTracerouteOutput_RealDevice(t *testing.T) {
	r := parseTracerouteOutput("8.8.8.8", realTracerouteOutput)

	if r.ResolvedIP != "8.8.8.8" {
		t.Errorf("ResolvedIP = %q, want 8.8.8.8", r.ResolvedIP)
	}
	if len(r.Hops) != 6 {
		t.Fatalf("got %d hops, want 6: %+v", len(r.Hops), r.Hops)
	}

	first := r.Hops[0]
	if first.Hop != 1 || first.IP != "10.0.99.1" || len(first.RTTs) != 3 {
		t.Errorf("hop 1 = %+v, want hop=1 ip=10.0.99.1 with 3 timings", first)
	}

	// A hop that reverse-resolves: the name must not end up mistaken for the address.
	named := r.Hops[2]
	if named.IP != "103.3.176.109" {
		t.Errorf("hop 7 ip = %q, want 103.3.176.109", named.IP)
	}
	if named.Hostname != "103-3-176-109.static.asianet.co.th" {
		t.Errorf("hop 7 hostname = %q", named.Hostname)
	}
}

// Hop 8 is the shape a positional parser gets wrong: "* <address> <time> *". The stars sit on
// either side of the answer, so the address is not in a fixed column.
func TestParseTracerouteOutput_InterleavedTimeouts(t *testing.T) {
	r := parseTracerouteOutput("8.8.8.8", realTracerouteOutput)

	var hop8 *FGTracerouteHop
	for i := range r.Hops {
		if r.Hops[i].Hop == 8 {
			hop8 = &r.Hops[i]
		}
	}
	if hop8 == nil {
		t.Fatal("hop 8 missing")
	}
	if hop8.IP != "171.102.248.126" {
		t.Errorf("hop 8 ip = %q, want 171.102.248.126", hop8.IP)
	}
	if len(hop8.RTTs) != 1 || hop8.RTTs[0] != 3.829 {
		t.Errorf("hop 8 rtts = %v, want [3.829]", hop8.RTTs)
	}
	if hop8.Timeouts != 2 {
		t.Errorf("hop 8 timeouts = %d, want 2", hop8.Timeouts)
	}
}

// A hop that answered nothing is still a hop — dropping it would renumber the path.
func TestParseTracerouteOutput_KeepsSilentHops(t *testing.T) {
	r := parseTracerouteOutput("8.8.8.8", realTracerouteOutput)
	for _, h := range r.Hops {
		if h.Hop == 10 {
			if h.IP != "" || h.Timeouts != 3 || len(h.RTTs) != 0 {
				t.Errorf("hop 10 = %+v, want no address and 3 timeouts", h)
			}
			return
		}
	}
	t.Error("hop 10 (all timeouts) was dropped")
}

// The prompt FortiOS echoes before the output is not a hop.
func TestParseTracerouteOutput_IgnoresThePrompt(t *testing.T) {
	r := parseTracerouteOutput("8.8.8.8", realTracerouteOutput)
	for _, h := range r.Hops {
		if h.Hop > 32 {
			t.Errorf("parsed a hop number out of range: %+v", h)
		}
	}
}

const realSessionListOutput = `NGFW-Testing #
NGFW-Testing #
session info: proto=6 proto_state=06 duration=121 expire=3 timeout=3600 flags=00000000 socktype=0 sockport=0 av_idx=0 use=3
origin-shaper=
reply-shaper=
per_ip_shaper=
class_id=0 ha_id=0 policy_dir=0 tunnel=/ vlan_cos=255/255
state=log local
statistic(bytes/packets/allow_err): org=4051/17/1 reply=9525/15/1 tuples=2
tx speed(Bps/kbps): 33/0 rx speed(Bps/kbps): 78/0
orgin->sink: org out->post, reply pre->in dev=24->9/9->24 gwy=0.0.0.0/10.0.99.201
hook=out dir=org act=noop 10.0.99.201:1420->173.243.140.16:443(0.0.0.0:0)
hook=in dir=reply act=noop 173.243.140.16:443->10.0.99.201:1420(0.0.0.0:0)
pos/(before,after) 0/(0,0), 0/(0,0)
dst_mac=00:09:0f:09:00:00
misc=0 policy_id=0 pol_uuid_idx=0 auth_info=0 chk_client_info=0 vd=0
serial=0003d8c0 tos=ff/ff app_list=0 app=0 url_cat=0

session info: proto=17 proto_state=01 duration=40 expire=170 timeout=0 flags=00000000 socktype=0 sockport=0 av_idx=0 use=3
state=may_dirty
statistic(bytes/packets/allow_err): org=200/2/1 reply=340/2/1 tuples=2
hook=post dir=org act=snat 192.168.1.50:51000->8.8.8.8:53(10.0.99.201:62000)
hook=pre dir=reply act=dnat 8.8.8.8:53->10.0.99.201:62000(192.168.1.50:51000)
misc=0 policy_id=7 pol_uuid_idx=12 auth_info=0 chk_client_info=0 vd=0
`

func TestParseSessionList_RealDevice(t *testing.T) {
	got, hitLimit := parseSessionList(realSessionListOutput, 100)

	if hitLimit {
		t.Error("hitLimit = true on a 2-session dump with a limit of 100")
	}
	if len(got) != 2 {
		t.Fatalf("got %d sessions, want 2: %+v", len(got), got)
	}

	s := got[0]
	if s.Protocol != "tcp" {
		t.Errorf("protocol = %q, want tcp (proto=6)", s.Protocol)
	}
	if s.Source != "10.0.99.201" || s.SourcePort != 1420 {
		t.Errorf("source = %s:%d, want 10.0.99.201:1420", s.Source, s.SourcePort)
	}
	if s.Dest != "173.243.140.16" || s.DestPort != 443 {
		t.Errorf("dest = %s:%d, want 173.243.140.16:443", s.Dest, s.DestPort)
	}
	if s.DurationSec != 121 || s.ExpireSec != 3 {
		t.Errorf("duration/expire = %d/%d, want 121/3", s.DurationSec, s.ExpireSec)
	}
	if s.TxBytes != 4051 || s.RxBytes != 9525 {
		t.Errorf("bytes = %d/%d, want 4051/9525", s.TxBytes, s.RxBytes)
	}
	if s.State != "log local" {
		t.Errorf("state = %q, want %q", s.State, "log local")
	}
}

// An un-NATted session prints 0.0.0.0:0 as its translated address. Recording that would put a
// fictional NAT on every internal session in the table.
func TestParseSessionList_NoNATIsNotAnAddress(t *testing.T) {
	got, _ := parseSessionList(realSessionListOutput, 100)
	if got[0].NATSource != "" {
		t.Errorf("NATSource = %q on a session the device printed as 0.0.0.0:0", got[0].NATSource)
	}
	if got[1].NATSource != "10.0.99.201" || got[1].NATPort != 62000 {
		t.Errorf("NAT = %s:%d, want 10.0.99.201:62000", got[1].NATSource, got[1].NATPort)
	}
}

// FortiOS marks "no policy matched this" with 0xFFFFFFFF, not with 0. Captured live: the admin's
// own HTTPS sessions to the box carry it. Shown raw it reads as policy #4294967295 and sends
// whoever is debugging hunting for a rule that does not exist.
func TestParseSessionList_UnsetPolicyIsNotARuleNumber(t *testing.T) {
	out := `session info: proto=6 proto_state=06 duration=18 expire=3600 timeout=3600
state=local may_dirty
statistic(bytes/packets/allow_err): org=4192/17/1 reply=2646/15/1 tuples=2
hook=pre dir=org act=noop 10.10.20.182:59310->10.0.99.201:443(0.0.0.0:0)
misc=0 policy_id=4294967295 pol_uuid_idx=0 auth_info=0 chk_client_info=0 vd=0
`
	got, _ := parseSessionList(out, 10)
	if len(got) != 1 {
		t.Fatalf("got %d sessions, want 1", len(got))
	}
	if got[0].PolicyID != 0 {
		t.Errorf("PolicyID = %d, want 0 — 4294967295 is FortiOS's \"unset\", not a rule id", got[0].PolicyID)
	}
}

func TestParseSessionList_ReadsProtocolAndPolicy(t *testing.T) {
	got, _ := parseSessionList(realSessionListOutput, 100)
	if got[1].Protocol != "udp" {
		t.Errorf("protocol = %q, want udp (proto=17)", got[1].Protocol)
	}
	if got[1].PolicyID != 7 {
		t.Errorf("policy_id = %d, want 7", got[1].PolicyID)
	}
}

// The row cap has to REPORT itself. A session table silently cut off reads as the whole table,
// which on a diagnostics page is the difference between "nothing is talking to that host" and
// "we stopped looking".
func TestParseSessionList_ReportsHittingTheLimit(t *testing.T) {
	got, hitLimit := parseSessionList(realSessionListOutput, 1)
	if len(got) != 1 {
		t.Fatalf("got %d sessions, want 1", len(got))
	}
	if !hitLimit {
		t.Error("hitLimit = false after stopping at the limit")
	}
}

func TestParseSessionList_EmptyOutput(t *testing.T) {
	got, hitLimit := parseSessionList("NGFW-Testing # \nNGFW-Testing # \n", 100)
	if len(got) != 0 || hitLimit {
		t.Errorf("got %d sessions (limit hit: %v), want none", len(got), hitLimit)
	}
}

// ── Target validation ─────────────────────────────────────────────────────────

// The target is pasted into a command line on a live firewall. This is the test that stops that
// from being an injection point.
func TestValidateDiagTarget_RejectsCommandInjection(t *testing.T) {
	bad := []string{
		"8.8.8.8\nexecute reboot",
		"8.8.8.8; execute factoryreset",
		"8.8.8.8 && execute reboot",
		"8.8.8.8 | grep x",
		"$(execute reboot)",
		"host name",
		"",
		"   ",
		strings.Repeat("a", 300),
	}
	for _, in := range bad {
		if _, err := ValidateDiagTarget(in); err == nil {
			t.Errorf("ValidateDiagTarget(%q) accepted it — that string reaches a firewall CLI", in)
		}
	}
}

func TestValidateDiagTarget_AcceptsRealTargets(t *testing.T) {
	good := []string{"8.8.8.8", "www.google.com", "2001:4860:4860::8888", "my-host.local", "10.0.99.201"}
	for _, in := range good {
		if _, err := ValidateDiagTarget(in); err != nil {
			t.Errorf("ValidateDiagTarget(%q) = %v, want accepted", in, err)
		}
	}
}

func TestValidateDiagTarget_TrimsSurroundingSpace(t *testing.T) {
	got, err := ValidateDiagTarget("  8.8.8.8  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "8.8.8.8" {
		t.Errorf("got %q, want %q", got, "8.8.8.8")
	}
}

// ── Session filter ────────────────────────────────────────────────────────────

// The filter is global state on the firewall that outlives the session that set it. Without the
// leading clear, one user's port-443 filter silently narrows the next user's session table.
func TestBuildSessionFilterCommands_AlwaysClearsFirst(t *testing.T) {
	for _, f := range []SessionFilter{{}, {DstPort: 443}, {SrcIP: "10.0.0.1", Protocol: 6}} {
		cmds, _, err := buildSessionFilterCommands(f)
		if err != nil {
			t.Fatalf("unexpected error for %+v: %v", f, err)
		}
		if len(cmds) == 0 || cmds[0] != "diagnose sys session filter clear" {
			t.Errorf("filter %+v produced %v — the first command must be the clear", f, cmds)
		}
	}
}

func TestBuildSessionFilterCommands_RejectsBadInput(t *testing.T) {
	bad := []SessionFilter{
		{SrcIP: "10.0.0.1; execute reboot"},
		{DstIP: "evil host"},
		{DstPort: 70000},
		{Protocol: 999},
	}
	for _, f := range bad {
		if _, _, err := buildSessionFilterCommands(f); err == nil {
			t.Errorf("buildSessionFilterCommands(%+v) accepted invalid input", f)
		}
	}
}

func TestClampPingOptions(t *testing.T) {
	cases := []struct {
		in         PingOptions
		wantCount  int
		wantSize   int
		wantReason string
	}{
		{PingOptions{Count: 0, Size: 0}, 5, 56, "defaults"},
		{PingOptions{Count: 99, Size: 9999}, 5, 56, "out of range falls back to the default"},
		{PingOptions{Count: 3, Size: 64}, 3, 64, "valid values pass through"},
		{PingOptions{Count: -1, Size: 31}, 5, 56, "below the floor"},
	}
	for _, c := range cases {
		got := clampPingOptions(c.in)
		if got.Count != c.wantCount || got.Size != c.wantSize {
			t.Errorf("%s: clampPingOptions(%+v) = count %d size %d, want count %d size %d",
				c.wantReason, c.in, got.Count, got.Size, c.wantCount, c.wantSize)
		}
	}
}

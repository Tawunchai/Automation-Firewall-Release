package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// VPN tunnel health tests.
//
// The "down" payload below is byte-for-byte what the lab FGT80E (FortiOS 7.2.10) returned for a
// real phase1+phase2 pair created for this purpose and deleted afterwards. The "up" fields
// (creation_time, per-phase2 bytes/expire) are the ones the device adds once an SA establishes and
// omits entirely while it is down — the decode must survive both shapes.
const vpnMonitorDownPayload = `[
  {
    "proxyid":[
      {"proxy_src":[{"subnet":"0.0.0.0/0.0.0.0","port":0,"protocol":0,"protocol_name":""}],
       "proxy_dst":[{"subnet":"0.0.0.0/0.0.0.0","port":0,"protocol":0,"protocol_name":""}],
       "status":"down","p2name":"ZZPROBE-p2","p2serial":1}
    ],
    "name":"ZZPROBE","comments":"","wizard-type":"custom","type":"automatic",
    "incoming_bytes":0,"outgoing_bytes":0,"rgwy":"203.0.113.99","tun_id":"203.0.113.99"
  }
]`

func decodeVPNPayload(t *testing.T, raw string) []interface{} {
	t.Helper()
	var out []interface{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fixture is not valid JSON: %v", err)
	}
	return out
}

// vpnHealthFixture wires a CMDB phase1/phase2 table and a monitor payload into the fake device.
//
// GetIPsecTunnels reads the phase1-interface and phase2-interface tables plus the policy table for
// its reference count, so all three are stubbed here.
func vpnHealthFixture(t *testing.T, phase1 []map[string]interface{}, monitorPayload string) FGVPNHealthReport {
	t.Helper()

	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/vpn.ipsec/phase1-interface": phase1,
		"GET /api/v2/cmdb/vpn.ipsec/phase2-interface": []map[string]interface{}{},
		"GET /api/v2/cmdb/firewall/policy":            []map[string]interface{}{},
		"GET /api/v2/monitor/vpn/ipsec":               decodeVPNPayload(t, monitorPayload),
		"GET /api/v2/monitor/system/time":             map[string]interface{}{"time": deviceNow},
	})
	defer done()

	r, err := fc.GetVPNTunnelHealth()
	if err != nil {
		t.Fatalf("GetVPNTunnelHealth: %v", err)
	}
	return r
}

func findTunnel(t *testing.T, r FGVPNHealthReport, name string) FGTunnelHealth {
	t.Helper()
	for _, tn := range r.Tunnels {
		if tn.Name == name {
			return tn
		}
	}
	t.Fatalf("tunnel %q missing from the report (have %d)", name, len(r.Tunnels))
	return FGTunnelHealth{}
}

// The captured down-tunnel payload must decode without the up-only fields present.
func TestGetVPNTunnelHealth_DecodesRealDownTunnel(t *testing.T) {
	r := vpnHealthFixture(t, []map[string]interface{}{
		{"name": "ZZPROBE", "interface": "port1", "remote-gw": "203.0.113.99", "type": "static"},
	}, vpnMonitorDownPayload)

	tn := findTunnel(t, r, "ZZPROBE")
	if tn.Health != TunnelHealthDown {
		t.Errorf("health = %q, want %q", tn.Health, TunnelHealthDown)
	}
	if tn.Phase1Up {
		t.Errorf("phase1_up = true with every SA down")
	}
	if tn.UptimeSeconds != 0 {
		t.Errorf("uptime = %d, want 0 — the device sends no creation_time while down", tn.UptimeSeconds)
	}
	if tn.RemoteGW != "203.0.113.99" {
		t.Errorf("remote gateway = %q, want 203.0.113.99", tn.RemoteGW)
	}
	if tn.Interface != "port1" {
		t.Errorf("interface = %q, want port1 (from the CMDB side of the join)", tn.Interface)
	}
	if len(tn.Phase2) != 1 || tn.Phase2[0].Name != "ZZPROBE-p2" || tn.Phase2[0].Status != "down" {
		t.Errorf("phase2 = %+v, want one down selector named ZZPROBE-p2", tn.Phase2)
	}
	if tn.Phase2[0].SrcNet != "0.0.0.0/0.0.0.0" {
		t.Errorf("selector = %q, want the device's address/mask form verbatim", tn.Phase2[0].SrcNet)
	}
}

// All selectors up = up, and uptime is derived from creation_time against the device clock.
func TestGetVPNTunnelHealth_AllSelectorsUp(t *testing.T) {
	payload := `[
      {"name":"HQ","type":"automatic","rgwy":"198.51.100.7",
       "incoming_bytes":4096,"outgoing_bytes":2048,"creation_time":` + itoa(deviceNow-7200) + `,
       "proxyid":[
         {"p2name":"HQ-p2","p2serial":1,"status":"up","incoming_bytes":4096,"outgoing_bytes":2048,"expire":1700,
          "proxy_src":[{"subnet":"10.1.0.0/255.255.0.0"}],"proxy_dst":[{"subnet":"10.2.0.0/255.255.0.0"}]}
       ]}
    ]`

	r := vpnHealthFixture(t, []map[string]interface{}{
		{"name": "HQ", "interface": "port1", "remote-gw": "198.51.100.7", "type": "static"},
	}, payload)

	tn := findTunnel(t, r, "HQ")
	if tn.Health != TunnelHealthUp {
		t.Errorf("health = %q, want %q", tn.Health, TunnelHealthUp)
	}
	if !tn.Phase1Up {
		t.Errorf("phase1_up = false with a live SA")
	}
	if tn.UptimeSeconds != 7200 {
		t.Errorf("uptime = %d, want 7200 (device clock minus creation_time)", tn.UptimeSeconds)
	}
	if tn.InBytes != 4096 || tn.OutBytes != 2048 {
		t.Errorf("byte counters = %d/%d, want 4096/2048", tn.InBytes, tn.OutBytes)
	}
	if tn.Phase2[0].ExpireSeconds != 1700 {
		t.Errorf("SA expiry = %d, want 1700", tn.Phase2[0].ExpireSeconds)
	}
}

// The state that matters most: one selector negotiated, one did not. Calling this "up" hides the
// broken selector; calling it "down" is a false alarm.
func TestGetVPNTunnelHealth_MixedSelectorsArePartial(t *testing.T) {
	payload := `[
      {"name":"Branch","type":"automatic","rgwy":"198.51.100.9","creation_time":` + itoa(deviceNow-60) + `,
       "proxyid":[
         {"p2name":"Branch-lan","p2serial":1,"status":"up","proxy_src":[{"subnet":"10.1.0.0/255.255.0.0"}]},
         {"p2name":"Branch-dmz","p2serial":2,"status":"down","proxy_src":[{"subnet":"10.9.0.0/255.255.0.0"}]}
       ]}
    ]`

	r := vpnHealthFixture(t, []map[string]interface{}{
		{"name": "Branch", "interface": "port1", "remote-gw": "198.51.100.9", "type": "static"},
	}, payload)

	tn := findTunnel(t, r, "Branch")
	if tn.Health != TunnelHealthPartial {
		t.Errorf("health = %q, want %q — 1 of 2 selectors is down", tn.Health, TunnelHealthPartial)
	}
	if !tn.Phase1Up {
		t.Errorf("phase1_up = false, want true — one SA is established")
	}
}

// A tunnel that has never negotiated is absent from the monitor table on some builds. It must
// still be listed, or a broken tunnel silently disappears from the health page.
func TestGetVPNTunnelHealth_ConfiguredButNeverNegotiatedIsStillListed(t *testing.T) {
	r := vpnHealthFixture(t, []map[string]interface{}{
		{"name": "Ghost", "interface": "port2", "remote-gw": "203.0.113.5", "type": "static"},
	}, `[]`)

	tn := findTunnel(t, r, "Ghost")
	if tn.Health != TunnelHealthNoP2 {
		t.Errorf("health = %q, want %q", tn.Health, TunnelHealthNoP2)
	}
	if tn.Phase1Up {
		t.Errorf("phase1_up = true for a tunnel with no runtime row")
	}
	if tn.Interface != "port2" {
		t.Errorf("interface = %q, want port2 from the configuration", tn.Interface)
	}
}

// FortiOS names dialup children "<parent>_0"; they exist only at runtime. Hiding them would hide
// every connected remote-access client.
func TestGetVPNTunnelHealth_RuntimeOnlyTunnelIsReported(t *testing.T) {
	payload := `[
      {"name":"RA_0","type":"dialup","rgwy":"203.0.113.44","username":"alice","connection_count":1,
       "creation_time":` + itoa(deviceNow-300) + `,
       "proxyid":[{"p2name":"RA-p2","p2serial":3,"status":"up","proxy_src":[{"subnet":"10.5.0.0/255.255.255.0"}]}]}
    ]`

	r := vpnHealthFixture(t, []map[string]interface{}{}, payload)

	tn := findTunnel(t, r, "RA_0")
	if tn.Health != TunnelHealthUp {
		t.Errorf("health = %q, want %q", tn.Health, TunnelHealthUp)
	}
	if tn.Username != "alice" || tn.ConnectionCount != 1 {
		t.Errorf("dialup context = %q/%d, want alice/1", tn.Username, tn.ConnectionCount)
	}
}

// Broken tunnels belong at the top of the page.
func TestGetVPNTunnelHealth_ProblemsSortFirst(t *testing.T) {
	payload := `[
      {"name":"AAA-healthy","proxyid":[{"p2name":"a","status":"up"}]},
      {"name":"ZZZ-broken","proxyid":[{"p2name":"z","status":"down"}]}
    ]`

	r := vpnHealthFixture(t, []map[string]interface{}{
		{"name": "AAA-healthy", "interface": "port1"},
		{"name": "ZZZ-broken", "interface": "port1"},
	}, payload)

	if r.Tunnels[0].Name != "ZZZ-broken" {
		t.Errorf("first row = %q, want the down tunnel on top despite the later name", r.Tunnels[0].Name)
	}
	want := FGVPNHealthSummary{Total: 2, Up: 1, Down: 1}
	if r.Summary != want {
		t.Errorf("summary = %+v, want %+v", r.Summary, want)
	}
}

// ── Tunnel actions ───────────────────────────────────────────────────────────

// The device requires p1name AND p2name for up/down (both `required: true` in its own monitor
// schema); sending only the tunnel name silently does nothing.
func TestControlTunnel_UpSendsBothNamesInTheQueryString(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.ControlTunnel(TunnelActionUp, "HQ", "HQ-p2"); err != nil {
		t.Fatalf("ControlTunnel: %v", err)
	}

	call := findCall(*calls, "POST", "/api/v2/monitor/vpn/ipsec/tunnel_up")
	if call == nil {
		t.Fatalf("no POST to tunnel_up; calls were %+v", *calls)
	}
	if !strings.Contains(call.Path, "p1name=HQ") || !strings.Contains(call.Path, "p2name=HQ-p2") {
		t.Errorf("query = %q, want both p1name and p2name", call.Path)
	}
	// do() must still append the vdom, or a VDOM-enabled device rejects the action.
	if !strings.Contains(call.Path, "vdom=root") {
		t.Errorf("query = %q, missing vdom=root", call.Path)
	}
}

func TestControlTunnel_DownUsesTheDownAction(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.ControlTunnel(TunnelActionDown, "HQ", "HQ-p2"); err != nil {
		t.Fatalf("ControlTunnel: %v", err)
	}
	if findCall(*calls, "POST", "/api/v2/monitor/vpn/ipsec/tunnel_down") == nil {
		t.Errorf("no POST to tunnel_down; calls were %+v", *calls)
	}
}

// reset_stats takes p1name only — sending p2name would be rejected as an unknown parameter.
func TestControlTunnel_ResetStatsSendsOnlyTheTunnelName(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.ControlTunnel(TunnelActionResetStats, "HQ", "ignored"); err != nil {
		t.Fatalf("ControlTunnel: %v", err)
	}
	call := findCall(*calls, "POST", "/api/v2/monitor/vpn/ipsec/tunnel_reset_stats")
	if call == nil {
		t.Fatalf("no POST to tunnel_reset_stats; calls were %+v", *calls)
	}
	if strings.Contains(call.Path, "p2name") {
		t.Errorf("query = %q, want no p2name on reset_stats", call.Path)
	}
}

// Refuse locally rather than firing a request the device will reject.
func TestControlTunnel_RejectsIncompleteInput(t *testing.T) {
	fc, calls, done := fakeFortiGate(t, nil)
	defer done()

	if err := fc.ControlTunnel(TunnelActionUp, "HQ", ""); err == nil {
		t.Errorf("bringing a tunnel up without a phase 2 name should fail")
	}
	if err := fc.ControlTunnel(TunnelActionUp, "", "p2"); err == nil {
		t.Errorf("empty tunnel name should fail")
	}
	if err := fc.ControlTunnel(TunnelAction("tunnel_explode"), "HQ", "p2"); err == nil {
		t.Errorf("unknown action should fail")
	}
	if len(*calls) != 0 {
		t.Errorf("invalid input still reached the device: %+v", *calls)
	}
}

func TestFirstNonEmpty(t *testing.T) {
	if got := firstNonEmpty("", "  ", "x", "y"); got != "x" {
		t.Errorf("firstNonEmpty = %q, want x", got)
	}
	if got := firstNonEmpty("", "   "); got != "" {
		t.Errorf("firstNonEmpty of blanks = %q, want empty", got)
	}
}

// itoa keeps the JSON fixtures above readable without dragging strconv into every literal.
func itoa(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

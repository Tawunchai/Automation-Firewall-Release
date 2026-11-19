package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// VPN Tunnel Health.
//
// The VPN section can build tunnels four different ways but, until now, could not answer the only
// question that matters after a build: **is it up?** The CMDB says what was configured; runtime
// state lives on the monitor API:
//
//	GET  /api/v2/monitor/vpn/ipsec                      live tunnel + phase2 (SA) state
//	POST /api/v2/monitor/vpn/ipsec/tunnel_up            bring one phase2 up   (p1name, p2name)
//	POST /api/v2/monitor/vpn/ipsec/tunnel_down          bring one phase2 down (p1name, p2name)
//	POST /api/v2/monitor/vpn/ipsec/tunnel_reset_stats   zero the byte counters (p1name)
//
// All four verified against the lab FGT80E (FortiOS 7.2.10) — the three POST actions and their
// required parameters were read from the device's own monitor schema directory, and the GET shape
// was captured from a real (down) tunnel:
//
//	{"name":"ZZPROBE","comments":"","wizard-type":"custom","type":"automatic",
//	 "incoming_bytes":0,"outgoing_bytes":0,"rgwy":"203.0.113.99","tun_id":"203.0.113.99",
//	 "proxyid":[{"p2name":"ZZPROBE-p2","p2serial":1,"status":"down",
//	             "proxy_src":[{"subnet":"0.0.0.0/0.0.0.0","port":0,"protocol":0,"protocol_name":""}],
//	             "proxy_dst":[{…}]}]}
//
// ⚠️ Fields that only exist while a tunnel is **up** (`creation_time`, `parent`, and per-phase2
// `incoming_bytes` / `outgoing_bytes` / `expire`) are absent on a down tunnel — every one of them is
// optional here, and a missing value reads as zero rather than failing the decode.
//
// ⚠️ Phase 1 is up when **any** phase 2 selector has an established SA. FortiOS reports status per
// proxyid, not per tunnel, so a tunnel with three selectors and one live SA is "partial" — calling
// that "up" hides a broken selector, and calling it "down" pages someone at 3am for nothing.

// fgVPNMonitorTunnel is one raw row of monitor/vpn/ipsec.
type fgVPNMonitorTunnel struct {
	Name       string `json:"name"`
	Comments   string `json:"comments"`
	WizardType string `json:"wizard-type"`
	Type       string `json:"type"` // automatic | dialup | ddns | manual…
	RemoteGW   string `json:"rgwy"`
	TunID      string `json:"tun_id"`

	IncomingBytes int64 `json:"incoming_bytes"`
	OutgoingBytes int64 `json:"outgoing_bytes"`

	// CreationTime is the epoch the tunnel came up; absent (0) while it is down.
	CreationTime int64  `json:"creation_time"`
	Parent       string `json:"parent"`
	// Username / ConnectionCount only appear on dialup tunnels with a live client.
	Username        string `json:"username"`
	ConnectionCount int64  `json:"connection_count"`

	ProxyID []fgVPNMonitorProxy `json:"proxyid"`
}

type fgVPNMonitorProxy struct {
	P2Name   string `json:"p2name"`
	P2Serial int    `json:"p2serial"`
	Status   string `json:"status"` // up | down

	IncomingBytes int64 `json:"incoming_bytes"`
	OutgoingBytes int64 `json:"outgoing_bytes"`
	// Expire is seconds left on the SA; 0 while down.
	Expire int64 `json:"expire"`

	ProxySrc []fgVPNMonitorSelector `json:"proxy_src"`
	ProxyDst []fgVPNMonitorSelector `json:"proxy_dst"`
}

type fgVPNMonitorSelector struct {
	Subnet   string `json:"subnet"` // "10.0.0.0/255.255.255.0" — mask, not prefix length
	Port     int    `json:"port"`
	Protocol int    `json:"protocol"`
}

// Tunnel health states.
const (
	TunnelHealthUp      = "up"      // every phase2 selector has a live SA
	TunnelHealthPartial = "partial" // at least one up, at least one down
	TunnelHealthDown    = "down"    // no selector has an SA
	TunnelHealthNoP2    = "no-phase2"
)

// FGTunnelPhase2 is one phase2 selector's live state.
type FGTunnelPhase2 struct {
	Name     string `json:"name"`
	Serial   int    `json:"serial"`
	Status   string `json:"status"` // up | down
	SrcNet   string `json:"src_subnet,omitempty"`
	DstNet   string `json:"dst_subnet,omitempty"`
	InBytes  int64  `json:"incoming_bytes"`
	OutBytes int64  `json:"outgoing_bytes"`
	// ExpireSeconds is the remaining SA lifetime; 0 when the SA is not established.
	ExpireSeconds int64 `json:"expire_seconds"`
}

// FGTunnelHealth is one tunnel's runtime state, joined to the little configuration context needed
// to make it readable (the CMDB interface and remote gateway).
type FGTunnelHealth struct {
	Name       string `json:"name"`
	Comments   string `json:"comments,omitempty"`
	WizardType string `json:"wizard_type,omitempty"`
	Type       string `json:"type,omitempty"`

	RemoteGW  string `json:"remote_gateway,omitempty"`
	Interface string `json:"interface,omitempty"`

	Health string `json:"health"`
	// Phase1Up is true when the tunnel object itself exists in the runtime table with at least one
	// established SA — the single boolean a dashboard tile needs.
	Phase1Up bool `json:"phase1_up"`

	InBytes  int64 `json:"incoming_bytes"`
	OutBytes int64 `json:"outgoing_bytes"`

	// UptimeSeconds is how long the tunnel has been up, derived from creation_time against the
	// device clock. 0 when down or when the device reports no creation time.
	UptimeSeconds int64 `json:"uptime_seconds"`

	// Dialup context — empty on a site-to-site tunnel.
	Username        string `json:"username,omitempty"`
	ConnectionCount int64  `json:"connection_count,omitempty"`

	Phase2 []FGTunnelPhase2 `json:"phase2"`
}

// FGVPNHealthSummary is the count of tunnels in each state.
type FGVPNHealthSummary struct {
	Total   int `json:"total"`
	Up      int `json:"up"`
	Partial int `json:"partial"`
	Down    int `json:"down"`
}

// FGVPNHealthReport is the whole answer for one device.
type FGVPNHealthReport struct {
	DeviceTime int64              `json:"device_time"`
	Summary    FGVPNHealthSummary `json:"summary"`
	Tunnels    []FGTunnelHealth   `json:"tunnels"`
}

// vpnMonitorTunnels reads monitor/vpn/ipsec.
func (f *FortiClient) vpnMonitorTunnels() ([]fgVPNMonitorTunnel, error) {
	resp, err := f.do("GET", "/api/v2/monitor/vpn/ipsec", nil)
	if err != nil {
		return nil, err
	}
	var rows []fgVPNMonitorTunnel
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("decode vpn/ipsec monitor: %w", err)
	}
	return rows, nil
}

// GetVPNTunnelHealth returns the live state of every IPsec tunnel on the device.
//
// A tunnel that is configured but has never negotiated does not appear in the monitor table at all
// on some FortiOS builds, so the CMDB list is used as the spine: every configured tunnel is
// reported, and one with no runtime row reads as down rather than vanishing from the page.
func (f *FortiClient) GetVPNTunnelHealth() (FGVPNHealthReport, error) {
	report := FGVPNHealthReport{Tunnels: []FGTunnelHealth{}}

	configured, cfgErr := f.GetIPsecTunnels()
	runtime, runErr := f.vpnMonitorTunnels()
	if cfgErr != nil && runErr != nil {
		// Both halves failed — the device is unreachable, not merely tunnel-less.
		return report, fmt.Errorf("read IPsec tunnels: %w", cfgErr)
	}

	report.DeviceTime = f.deviceEpochUTC()

	live := make(map[string]fgVPNMonitorTunnel, len(runtime))
	for _, r := range runtime {
		live[r.Name] = r
	}

	// Configuration supplies the identity and the outgoing interface; the monitor row supplies the
	// state. Walk the configured list first so a never-negotiated tunnel is still listed.
	seen := map[string]bool{}
	for _, cfg := range configured {
		seen[cfg.Name] = true
		report.Tunnels = append(report.Tunnels, buildTunnelHealth(cfg.Name, cfg.Interface, cfg.RemoteGW, live[cfg.Name], report.DeviceTime))
	}
	// A runtime tunnel with no CMDB entry is a dialup child (FortiOS names them "<parent>_0") or a
	// tunnel created outside this app. Report it rather than hiding it.
	for _, r := range runtime {
		if !seen[r.Name] {
			report.Tunnels = append(report.Tunnels, buildTunnelHealth(r.Name, "", r.RemoteGW, r, report.DeviceTime))
		}
	}

	sort.SliceStable(report.Tunnels, func(i, j int) bool {
		ri, rj := tunnelHealthRank(report.Tunnels[i].Health), tunnelHealthRank(report.Tunnels[j].Health)
		if ri != rj {
			return ri < rj
		}
		return report.Tunnels[i].Name < report.Tunnels[j].Name
	})
	report.Summary = summarizeTunnelHealth(report.Tunnels)
	return report, nil
}

// tunnelHealthRank puts problems on top: down, then partial, then healthy.
func tunnelHealthRank(h string) int {
	switch h {
	case TunnelHealthDown:
		return 0
	case TunnelHealthNoP2:
		return 1
	case TunnelHealthPartial:
		return 2
	default:
		return 3
	}
}

// buildTunnelHealth folds one runtime row (possibly the zero value, for a tunnel that has never
// negotiated) into the reported shape.
func buildTunnelHealth(name, iface, cfgRemoteGW string, r fgVPNMonitorTunnel, deviceTime int64) FGTunnelHealth {
	t := FGTunnelHealth{
		Name:            name,
		Comments:        r.Comments,
		WizardType:      r.WizardType,
		Type:            r.Type,
		RemoteGW:        firstNonEmpty(r.RemoteGW, cfgRemoteGW),
		Interface:       iface,
		InBytes:         r.IncomingBytes,
		OutBytes:        r.OutgoingBytes,
		Username:        r.Username,
		ConnectionCount: r.ConnectionCount,
		Phase2:          []FGTunnelPhase2{},
	}

	upCount := 0
	for _, p := range r.ProxyID {
		p2 := FGTunnelPhase2{
			Name:          p.P2Name,
			Serial:        p.P2Serial,
			Status:        strings.ToLower(strings.TrimSpace(p.Status)),
			SrcNet:        firstSelector(p.ProxySrc),
			DstNet:        firstSelector(p.ProxyDst),
			InBytes:       p.IncomingBytes,
			OutBytes:      p.OutgoingBytes,
			ExpireSeconds: p.Expire,
		}
		if p2.Status == "" {
			p2.Status = "down"
		}
		if p2.Status == "up" {
			upCount++
		}
		t.Phase2 = append(t.Phase2, p2)
	}

	switch {
	case len(t.Phase2) == 0:
		// No selector at all: either the tunnel has never negotiated, or phase 2 was never
		// configured. Either way there is nothing that could be carrying traffic.
		t.Health = TunnelHealthNoP2
	case upCount == len(t.Phase2):
		t.Health = TunnelHealthUp
	case upCount > 0:
		t.Health = TunnelHealthPartial
	default:
		t.Health = TunnelHealthDown
	}
	t.Phase1Up = upCount > 0

	// creation_time only exists while the tunnel is up; deriving uptime from a stale value on a
	// tunnel that has since dropped would report a tunnel as "up for 6 days" while it is down.
	if t.Phase1Up && r.CreationTime > 0 && deviceTime > r.CreationTime {
		t.UptimeSeconds = deviceTime - r.CreationTime
	}
	return t
}

// firstSelector renders the first proxy selector as a readable subnet. FortiOS sends
// "10.0.0.0/255.255.255.0" (address/mask); it is passed through verbatim rather than converted,
// because that is the form the device's own CLI and GUI use.
func firstSelector(sels []fgVPNMonitorSelector) string {
	if len(sels) == 0 {
		return ""
	}
	return sels[0].Subnet
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func summarizeTunnelHealth(rows []FGTunnelHealth) FGVPNHealthSummary {
	s := FGVPNHealthSummary{Total: len(rows)}
	for _, r := range rows {
		switch r.Health {
		case TunnelHealthUp:
			s.Up++
		case TunnelHealthPartial:
			s.Partial++
		default:
			s.Down++
		}
	}
	return s
}

// ── Tunnel actions ───────────────────────────────────────────────────────────

// TunnelAction is one of the three monitor POSTs the device exposes.
type TunnelAction string

const (
	TunnelActionUp         TunnelAction = "tunnel_up"
	TunnelActionDown       TunnelAction = "tunnel_down"
	TunnelActionResetStats TunnelAction = "tunnel_reset_stats"
)

// ControlTunnel brings one phase2 SA up or down, or resets a tunnel's byte counters.
//
// p2name is required by the device for up/down (confirmed from its monitor schema: both p1name and
// p2name are `required: true`) and ignored for reset_stats, which operates on the whole phase1.
// The parameters go in the QUERY STRING, not a JSON body — this is a monitor action, not a CMDB
// write, and FortiOS reads them from the URL.
func (f *FortiClient) ControlTunnel(action TunnelAction, p1name, p2name string) error {
	p1name = strings.TrimSpace(p1name)
	p2name = strings.TrimSpace(p2name)
	if p1name == "" {
		return fmt.Errorf("tunnel name is required")
	}

	q := url.Values{}
	q.Set("p1name", p1name)

	switch action {
	case TunnelActionUp, TunnelActionDown:
		if p2name == "" {
			return fmt.Errorf("phase 2 name is required to bring a tunnel %s", strings.TrimPrefix(string(action), "tunnel_"))
		}
		q.Set("p2name", p2name)
	case TunnelActionResetStats:
		// p1name only.
	default:
		return fmt.Errorf("unsupported tunnel action %q", action)
	}

	path := "/api/v2/monitor/vpn/ipsec/" + string(action) + "?" + q.Encode()
	resp, err := f.do("POST", path, nil)
	if err != nil {
		return err
	}
	if resp != nil && resp.Status != "" && !strings.EqualFold(resp.Status, "success") {
		return fmt.Errorf("device rejected %s: %s", action, fgErrorText(resp))
	}
	return nil
}

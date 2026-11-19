package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// Diagnostics the device answers over REST.
//
// Three of the five Diagnostics tools live here because the FortiGate monitor API can answer them
// outright: the network-settings health check, the session summary, and the support bundle. The
// other two (ping, traceroute) have no REST equivalent on FortiOS 7.2 at all and are run over SSH
// — see fortigate_diagexec.go, which is deliberately a separate file because an SSH login counts
// towards the device's admin-lockout threshold and a REST GET does not.
//
// Everything here was probed against the lab FGT80E on FortiOS 7.2.10 before it was written. What
// that probe ruled OUT matters as much as what it found:
//
//   - monitor/system/sniffer          → 404. There is no packet-capture API on this firmware.
//   - monitor/firewall/session        → `summary` is populated, `details` comes back EMPTY no
//     matter which combination of count/start/ip_version is
//     passed, and ?action=schema answers 424. So the session
//     LIST is an SSH command and only the counters are REST.
//   - POST monitor/utm/rating-lookup  → 200, but each result carries only the url and no category,
//     because the device has no FortiGuard Web Filter licence.
//     A "URL rating" page would render blank rows here.

// ── Check Network Settings ────────────────────────────────────────────────────

// FGConfiguredDNS is one resolver from the device's own configuration (cmdb system/dns), as
// opposed to one it has measured. Both halves are shown together because the interesting failure
// is a server that is configured and NOT answering.
type FGConfiguredDNS struct {
	Role     string `json:"role"` // primary | secondary | ipv6-primary | ipv6-secondary
	IP       string `json:"ip"`
	Protocol string `json:"protocol"` // cleartext | dot | doh
}

// FGDNSLatency is one row of monitor/network/dns/latency.
//
// `service` splits the list in two: "dns_server" rows are the resolvers the firewall itself uses,
// "dns_filter" rows are the FortiGuard DNS-filtering servers. They are different jobs and a
// failure in one says nothing about the other, so the page keeps them apart.
//
// LatencyMs is reported raw. Zero does NOT mean "instant" — on the lab device the dns_filter rows
// sit at 0 with a very old last_update, which is what "never successfully measured" looks like —
// so Measured distinguishes the two rather than letting a 0 ms badge claim a healthy server.
type FGDNSLatency struct {
	Service    string `json:"service"`
	IP         string `json:"ip"`
	IP6        string `json:"ip6,omitempty"`
	LatencyMs  int    `json:"latency_ms"`
	LastUpdate int64  `json:"last_update"`
	Measured   bool   `json:"measured"`
}

// FGFortiGuardServer is one row of monitor/system/fortiguard/server-info — the FortiGate
// equivalent of SonicWall's GRID check: which FortiGuard distribution servers this firewall is
// talking to, and how well.
type FGFortiGuardServer struct {
	IP          string `json:"ip"`
	RTTms       int    `json:"rtt_ms"`
	Weight      int    `json:"weight"`
	Packets     int64  `json:"packets"`
	CurrentLost int64  `json:"current_lost"`
	TotalLost   int64  `json:"total_lost"`

	// Flags straight off the device's own `status` object.
	Default bool `json:"default"`
	Init    bool `json:"init"`
	Fail    bool `json:"fail"`
	Timing  bool `json:"timing"`
}

// FGInterfaceLink is the physical state of one interface (monitor/system/interface).
type FGInterfaceLink struct {
	Name     string  `json:"name"`
	Alias    string  `json:"alias,omitempty"`
	MAC      string  `json:"mac,omitempty"`
	IP       string  `json:"ip,omitempty"`
	Mask     int     `json:"mask"`
	Link     bool    `json:"link"`
	SpeedMbp float64 `json:"speed_mbps"`
	Duplex   int     `json:"duplex"` // -1 unknown, 0 half, 1 full
	TxBytes  int64   `json:"tx_bytes"`
	RxBytes  int64   `json:"rx_bytes"`
	TxErrors int64   `json:"tx_errors"`
	RxErrors int64   `json:"rx_errors"`
}

// FGNetworkSettings is the whole "Check Network Settings" answer.
//
// Errors is keyed by section. Every section is independent, so one unlicensed or unsupported read
// degrades to a null section plus an entry here rather than failing the page — the same rule the
// dashboard follows.
type FGNetworkSettings struct {
	ConfiguredDNS []FGConfiguredDNS    `json:"configured_dns"`
	DNSLatency    []FGDNSLatency       `json:"dns_latency"`
	FortiGuard    []FGFortiGuardServer `json:"fortiguard"`
	DefaultRoute  *FGRouteLookup       `json:"default_route"`
	Interfaces    []FGInterfaceLink    `json:"interfaces"`

	Errors map[string]string `json:"errors,omitempty"`
}

// defaultRouteProbe is the address the default-route check is resolved against.
//
// A public address the device has no specific route to, so the answer is whatever its DEFAULT
// route is — which is the question the panel is asking ("does this firewall know how to get
// out?"). It is only a lookup: the device computes the answer from its own routing table and
// nothing is sent to the address.
const defaultRouteProbe = "8.8.8.8"

// GetNetworkSettings gathers the network-health picture in one round of parallel reads.
//
// The calls are independent and share the pooled session (safe for concurrent use — see
// fortigate_sessionpool.go), so the whole check costs about as long as its slowest leg instead of their
// sum.
func (f *FortiClient) GetNetworkSettings() FGNetworkSettings {
	var (
		out FGNetworkSettings
		mu  sync.Mutex
		wg  sync.WaitGroup
	)
	out.Errors = map[string]string{}
	fail := func(section string, err error) {
		mu.Lock()
		out.Errors[section] = err.Error()
		mu.Unlock()
	}

	wg.Add(5)

	go func() {
		defer wg.Done()
		dns, err := f.configuredDNS()
		if err != nil {
			fail("configured_dns", err)
			return
		}
		out.ConfiguredDNS = dns
	}()

	go func() {
		defer wg.Done()
		lat, err := f.dnsLatency()
		if err != nil {
			fail("dns_latency", err)
			return
		}
		out.DNSLatency = lat
	}()

	go func() {
		defer wg.Done()
		fg, err := f.fortiGuardServers()
		if err != nil {
			fail("fortiguard", err)
			return
		}
		out.FortiGuard = fg
	}()

	go func() {
		defer wg.Done()
		lk, err := f.RouterLookup(defaultRouteProbe)
		if err != nil {
			fail("default_route", err)
			return
		}
		out.DefaultRoute = &lk
	}()

	go func() {
		defer wg.Done()
		ifs, err := f.InterfaceLinks()
		if err != nil {
			fail("interfaces", err)
			return
		}
		out.Interfaces = ifs
	}()

	wg.Wait()

	if len(out.Errors) == 0 {
		out.Errors = nil
	}
	return out
}

// configuredDNS reads the resolvers out of cmdb system/dns.
//
// The unset IPv6 fields come back as "::" rather than absent, so they are dropped here — a panel
// listing "::" as a configured resolver would be reporting a setting that does not exist.
func (f *FortiClient) configuredDNS() ([]FGConfiguredDNS, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/dns", nil)
	if err != nil {
		return nil, err
	}
	var r struct {
		Primary       string `json:"primary"`
		Secondary     string `json:"secondary"`
		IP6Primary    string `json:"ip6-primary"`
		IP6Secondary  string `json:"ip6-secondary"`
		Protocol      string `json:"protocol"`
		ServerHostnme []struct {
			Hostname string `json:"hostname"`
		} `json:"server-hostname"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return nil, fmt.Errorf("failed to parse system/dns: %w", err)
	}

	out := make([]FGConfiguredDNS, 0, 4)
	add := func(role, ip string) {
		ip = strings.TrimSpace(ip)
		if ip == "" || ip == "::" || ip == "0.0.0.0" {
			return
		}
		out = append(out, FGConfiguredDNS{Role: role, IP: ip, Protocol: r.Protocol})
	}
	add("primary", r.Primary)
	add("secondary", r.Secondary)
	add("ipv6-primary", r.IP6Primary)
	add("ipv6-secondary", r.IP6Secondary)
	return out, nil
}

// dnsLatency reads monitor/network/dns/latency.
func (f *FortiClient) dnsLatency() ([]FGDNSLatency, error) {
	resp, err := f.do("GET", "/api/v2/monitor/network/dns/latency", nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Service    string `json:"service"`
		Latency    int    `json:"latency"`
		LastUpdate int64  `json:"last_update"`
		IP         string `json:"ip"`
		IP6        string `json:"ip6"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse dns/latency: %w", err)
	}

	out := make([]FGDNSLatency, 0, len(rows))
	for _, r := range rows {
		out = append(out, FGDNSLatency{
			Service:    r.Service,
			IP:         r.IP,
			IP6:        r.IP6,
			LatencyMs:  r.Latency,
			LastUpdate: r.LastUpdate,
			// See the type's doc comment: 0 ms is "never measured", not "instant".
			Measured: r.Latency > 0,
		})
	}
	return out, nil
}

// fortiGuardServers reads monitor/system/fortiguard/server-info.
//
// The device keys this response BY SERVER IP rather than returning a list, so the order is
// whatever Go's map iteration gives — the rows are sorted before returning, or the table reshuffles
// itself on every refresh.
func (f *FortiClient) fortiGuardServers() ([]FGFortiGuardServer, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/fortiguard/server-info", nil)
	if err != nil {
		return nil, err
	}
	var raw map[string]struct {
		Weight      int   `json:"weight"`
		RTT         int   `json:"rtt"`
		Packets     int64 `json:"packets"`
		CurrentLost int64 `json:"current_lost"`
		TotalLost   int64 `json:"total_lost"`
		Status      struct {
			Default bool `json:"default"`
			Init    bool `json:"init"`
			Fail    bool `json:"fail"`
			Timing  bool `json:"timing"`
		} `json:"status"`
	}
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse fortiguard/server-info: %w", err)
	}

	out := make([]FGFortiGuardServer, 0, len(raw))
	for ip, s := range raw {
		out = append(out, FGFortiGuardServer{
			IP: ip, RTTms: s.RTT, Weight: s.Weight,
			Packets: s.Packets, CurrentLost: s.CurrentLost, TotalLost: s.TotalLost,
			Default: s.Status.Default, Init: s.Status.Init,
			Fail: s.Status.Fail, Timing: s.Status.Timing,
		})
	}
	// Working servers first, then by round-trip time — the order someone reading the panel wants.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Fail != out[j].Fail {
			return !out[i].Fail
		}
		if out[i].RTTms != out[j].RTTms {
			return out[i].RTTms < out[j].RTTms
		}
		return out[i].IP < out[j].IP
	})
	return out, nil
}

// InterfaceLinks reads the physical state of every interface from monitor/system/interface.
//
// Exported because it is the live half of the Network > Interfaces picture: the CMDB says how an
// interface is CONFIGURED, this says whether the cable is up.
func (f *FortiClient) InterfaceLinks() ([]FGInterfaceLink, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/interface", nil)
	if err != nil {
		return nil, err
	}
	var raw map[string]struct {
		Name     string  `json:"name"`
		Alias    string  `json:"alias"`
		MAC      string  `json:"mac"`
		IP       string  `json:"ip"`
		Mask     int     `json:"mask"`
		Link     bool    `json:"link"`
		Speed    float64 `json:"speed"`
		Duplex   int     `json:"duplex"`
		TxBytes  int64   `json:"tx_bytes"`
		RxBytes  int64   `json:"rx_bytes"`
		TxErrors int64   `json:"tx_errors"`
		RxErrors int64   `json:"rx_errors"`
	}
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse system/interface: %w", err)
	}

	out := make([]FGInterfaceLink, 0, len(raw))
	for key, i := range raw {
		name := i.Name
		if name == "" {
			name = key
		}
		out = append(out, FGInterfaceLink{
			Name: name, Alias: strings.Trim(i.Alias, "()"), MAC: i.MAC,
			IP: i.IP, Mask: i.Mask, Link: i.Link, SpeedMbp: i.Speed, Duplex: i.Duplex,
			TxBytes: i.TxBytes, RxBytes: i.RxBytes, TxErrors: i.TxErrors, RxErrors: i.RxErrors,
		})
	}
	// Up first, then by name: the interfaces carrying traffic are the ones being looked for.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Link != out[j].Link {
			return out[i].Link
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// ── Session counters ──────────────────────────────────────────────────────────

// FGSessionCounters is the REST half of the Session Monitor page.
//
// GetSessionSummary in fortigate_monitor.go already reads this endpoint for the dashboard gauge;
// this one keeps the full set of counters rather than just the total, because on a diagnostics
// page the split (how many sessions are offloaded to the NPU, what the setup rate is) is the
// information, not decoration.
type FGSessionCounters struct {
	SessionCount   int `json:"session_count"`
	SetupRate      int `json:"setup_rate"`
	NPUSessions    int `json:"npu_session_count"`
	NTurboSessions int `json:"nturbo_session_count"`
}

// GetSessionCounters reads monitor/firewall/session?summary=true.
//
// Only the summary — the same response's `details` array is empty on FortiOS 7.2.10 regardless of
// paging parameters (verified live), so the per-session rows come from SSH instead. See
// ListSessions in fortigate_diagexec.go.
func (f *FortiClient) GetSessionCounters() (FGSessionCounters, error) {
	resp, err := f.do("GET", "/api/v2/monitor/firewall/session?summary=true&count=1", nil)
	if err != nil {
		return FGSessionCounters{}, err
	}
	var r struct {
		Summary struct {
			SessionCount   int `json:"session_count"`
			SetupRate      int `json:"setup_rate"`
			NPUSessions    int `json:"npu_session_count"`
			NTurboSessions int `json:"nturbo_session_count"`
		} `json:"summary"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return FGSessionCounters{}, fmt.Errorf("failed to parse firewall/session: %w", err)
	}
	return FGSessionCounters{
		SessionCount:   r.Summary.SessionCount,
		SetupRate:      r.Summary.SetupRate,
		NPUSessions:    r.Summary.NPUSessions,
		NTurboSessions: r.Summary.NTurboSessions,
	}, nil
}

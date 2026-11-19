package services

// Live overlay for Network ▸ Topology — link state and measured throughput, polled fast and kept
// separate from the five CMDB reads the diagram itself is built from (interfaces, zones, routes,
// tunnels, policies).
//
// WHY THIS IS A SEPARATE CALL. The diagram's shape — which nodes exist, which paths a policy
// permits — only changes when someone edits the firewall, and topology/model.ts already says why it
// stays a deterministic ring rather than a force layout: two renders of the same config must put
// everything in the same place. Link state and bandwidth change every second, and redrawing the
// WHOLE diagram at that cadence (eight parallel CMDB reads, per the existing loader) just to animate
// a few edges would turn "refresh on demand" into a page that hammers the device by itself. This
// endpoint is the one thing allowed to be polled quickly: it reads two live monitor-API probes, not
// the config, and the frontend uses it only to animate edges, color a node's status dot and flicker
// a dead link — never to decide what a node or an edge IS.
//
// Reuses the interface-counter rate cache this device's SD-WAN page already built
// (fortigate_sdwan.go's interfaceStats/sdwanRates) rather than keeping a second one: both pages are
// asking the same question — "how busy is this interface right now" — for the same device, so one
// shared cache keyed on the client's BaseURL serves both correctly. Whichever page polled most
// recently is simply the fresher baseline for the other.

// TopologyLiveInterface is one interface's live link state and measured throughput.
type TopologyLiveInterface struct {
	Name string `json:"name"`
	Link bool   `json:"link"`
	// Zero on the very first poll of a session — a rate needs two readings, and printing a guess
	// for the first one would be the same mistake SD-WAN's bandwidth column avoids.
	RxBps float64 `json:"rx_bps"`
	TxBps float64 `json:"tx_bps"`
}

// TopologyLiveTunnel is one IPsec tunnel's live health, trimmed to what an edge animation needs.
type TopologyLiveTunnel struct {
	Name     string `json:"name"`
	Health   string `json:"health"` // up | partial | down | no-phase2 — see FGTunnelHealth
	Phase1Up bool   `json:"phase1_up"`
}

// TopologyLivePolicy is one policy's cumulative byte counter — see the doc comment below on
// GetTopologyLive for why the diagram can use this to MEASURE a path's traffic instead of only
// ever inferring it.
type TopologyLivePolicy struct {
	PolicyID int   `json:"policy_id"`
	Bytes    int64 `json:"bytes"`
}

// TopologyLive is the whole overlay for one poll.
type TopologyLive struct {
	Interfaces []TopologyLiveInterface `json:"interfaces"`
	Tunnels    []TopologyLiveTunnel    `json:"tunnels"`
	// Policies is the RAW cumulative counter per policy, exactly as FortiOS reports it — same
	// reason the interface counters used to derive RxBps/TxBps are not sent raw either way (see
	// frontend/src/pages/interfaces/throughput.ts's own doc comment): a rate needs two readings
	// and the gap between their timestamps, and only the reader holding both can tell a genuine
	// drop in traffic from a counter reset (a reboot, `diagnose firewall ... reset`). Sending a
	// delta the backend computed would hide that distinction from the one place that can act on it.
	Policies []TopologyLivePolicy `json:"policies"`
}

// GetTopologyLive reads three probes in parallel and never fails the whole call for one of them —
// an overlay that goes blank because VPN health (or policy stats) could not be read would lose the
// interface animation too, for an unrelated reason.
//
// ── Where the Policies field answers P5's own question ────────────────────────
//
// Until now, Network ▸ Topology's edges could only INFER activity — the lesser of the two
// endpoints' interface throughput, documented at length in frontend/src/pages/topology/model.ts as
// a deliberate, honest approximation, because FortiOS has no "this policy's own bits/second" API.
// That premise turns out to be half true: FortiOS 7.2.10's monitor/firewall/policy (already read
// elsewhere in this codebase by GetPolicyStats, for Rule Lifecycle and Troubleshooting) DOES carry
// each policy's own cumulative byte counter. It is not a rate any more than the interface counters
// are, but a reader holding two readings and their gap can turn it into one — and unlike the
// interface-based inference, it is the TRAFFIC OF THAT SPECIFIC POLICY, not a proxy for it. The
// frontend (topology/liveOverlay.ts) now measures an edge's activity this way when it can, and
// only falls back to the old inference when it cannot (the very first poll of a session, or a
// counter that just reset) — never silently claiming a precision this field cannot back up.
func (f *FortiClient) GetTopologyLive() TopologyLive {
	var (
		ifStats  map[string]fgInterfaceStats
		health   FGVPNHealthReport
		policies map[int]FGPolicyStats
	)
	Parallel(
		func() { ifStats = f.interfaceStats() },
		func() { health, _ = f.GetVPNTunnelHealth() },
		func() { policies = f.GetPolicyStats() },
	)

	rates := sdwanRates.sample(f.BaseURL, ifStats)

	out := TopologyLive{
		Interfaces: make([]TopologyLiveInterface, 0, len(ifStats)),
		Tunnels:    make([]TopologyLiveTunnel, 0, len(health.Tunnels)),
		Policies:   make([]TopologyLivePolicy, 0, len(policies)),
	}
	for name, st := range ifStats {
		live := TopologyLiveInterface{Name: name, Link: st.Link}
		if r, ok := rates[name]; ok {
			live.RxBps = r.DownBps
			live.TxBps = r.UpBps
		}
		out.Interfaces = append(out.Interfaces, live)
	}
	for _, t := range health.Tunnels {
		out.Tunnels = append(out.Tunnels, TopologyLiveTunnel{
			Name: t.Name, Health: t.Health, Phase1Up: t.Phase1Up,
		})
	}
	for id, p := range policies {
		out.Policies = append(out.Policies, TopologyLivePolicy{PolicyID: id, Bytes: p.Bytes})
	}
	return out
}

package services

import (
	"encoding/json"
	"strings"
)

// System ▸ HA Status — whether this firewall is one box or half of a pair, and how the pair is
// holding up.
//
// READ-ONLY, deliberately, and this is the same decision Network ▸ Interfaces made.
//
// Forming or breaking a cluster is not an edit; it is a change to what the unit IS. FortiOS
// renegotiates cluster membership the moment `mode` changes, and on a live pair that means a
// failover, a config sync in one direction, and — if the heartbeat interfaces are wrong — two
// devices that both believe they are primary on the same network. There is no undo and no
// confirmation step. A console that can do it from a web form is a console that can do it by
// accident, and unlike every other write in this codebase it cannot be verified here: the lab has
// one unit, so a write path would ship having never formed a cluster.
//
// What this page IS for is the question an operator actually asks: is HA working right now, and
// which member am I looking at.
//
// Three sources, because none of them answers alone:
//
//	cmdb system/ha                    the CONFIGURED intent: mode, group, heartbeat devices, what
//	                                  is synchronised, which interfaces are monitored
//	monitor/system/ha-peer            the members the cluster can currently see
//	monitor/system/ha-statistics      what each member is carrying
//
// ── The traps ────────────────────────────────────────────────────────────────
//
// **A standalone unit answers all three successfully.** ha-peer and ha-statistics return an empty
// `results` array rather than an error, so "no peers" and "could not ask" look identical unless the
// mode is read first. Mode is therefore what decides which sentence the page shows.
//
// **`mode: standalone` with a group name and heartbeat devices set is normal.** The settings
// survive being taken out of a cluster, so a unit can look configured for HA and be alone. The page
// says which one is in force rather than letting the leftovers imply a cluster.
//
// **`monitor` is a space-separated interface list, not a table** — like the IPS multi-value fields.

// FGHAMember is one unit the cluster can see.
type FGHAMember struct {
	SerialNumber string `json:"serial_number"`
	Hostname     string `json:"hostname"`
	Priority     int    `json:"priority"`
	// Role as the device words it: `primary` / `secondary`, or whatever a newer firmware says.
	Role string `json:"role"`
	// IsThisUnit marks the member we are actually talking to.
	IsThisUnit bool `json:"is_this_unit"`
	// Statistics, when the unit reports them. Absent on a standalone box.
	CPUUsage  int `json:"cpu_usage"`
	MemUsage  int `json:"mem_usage"`
	Sessions  int `json:"sessions"`
	UptimeSec int `json:"uptime_sec"`
}

// FGHAStatus is the whole page.
type FGHAStatus struct {
	// Mode is `standalone`, `a-p` (active-passive) or `a-a` (active-active).
	Mode      string `json:"mode"`
	Clustered bool   `json:"clustered"`

	GroupName string `json:"group_name"`
	GroupID   int    `json:"group_id"`
	Priority  int    `json:"priority"`
	Override  bool   `json:"override"`

	// HeartbeatDevs are the interfaces the members use to find each other. A cluster with none is
	// not a cluster.
	HeartbeatDevs []string `json:"heartbeat_devs"`
	// MonitoredIntfs are the interfaces whose failure triggers a failover.
	MonitoredIntfs []string `json:"monitored_intfs"`

	SyncConfig     bool `json:"sync_config"`
	SessionPickup  bool `json:"session_pickup"`
	Encryption     bool `json:"encryption"`
	Authentication bool `json:"authentication"`

	HBInterval             int  `json:"hb_interval"`
	HBLostThreshold        int  `json:"hb_lost_threshold"`
	HAMgmtStatus           bool `json:"ha_mgmt_status"`
	UninterruptibleUpgrade bool `json:"uninterruptible_upgrade"`

	Members []FGHAMember `json:"members"`
	// PeersReadable says whether the peer list could be asked for at all. An empty list on a
	// standalone unit is the right answer; an empty list because the call failed is not, and the
	// two must not render the same way.
	PeersReadable bool `json:"peers_readable"`
}

type fgHARaw struct {
	Mode                   string `json:"mode"`
	GroupName              string `json:"group-name"`
	GroupID                int    `json:"group-id"`
	Priority               int    `json:"priority"`
	Override               string `json:"override"`
	HBDev                  string `json:"hbdev"`
	Monitor                string `json:"monitor"`
	SyncConfig             string `json:"sync-config"`
	SessionPickup          string `json:"session-pickup"`
	Encryption             string `json:"encryption"`
	Authentication         string `json:"authentication"`
	HBInterval             int    `json:"hb-interval"`
	HBLostThreshold        int    `json:"hb-lost-threshold"`
	HAMgmtStatus           string `json:"ha-mgmt-status"`
	UninterruptibleUpgrade string `json:"uninterruptible-upgrade"`
}

// splitDevList reads a space-separated interface list.
//
// `hbdev` carries a priority beside each name — "port1 50 port2 50" — so the numbers are dropped
// and only the interface names kept. Printing "port1 50" in an interface column would read as a
// name nobody would find on the device.
func splitDevList(s string) []string {
	out := []string{}
	for _, f := range strings.Fields(strings.ReplaceAll(s, "\"", "")) {
		if f == "" {
			continue
		}
		if isAllDigits(f) {
			continue
		}
		out = append(out, f)
	}
	return out
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// GetHAStatus reads the configured intent and, when there is a cluster, who is in it.
func (f *FortiClient) GetHAStatus() (*FGHAStatus, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/ha", nil)
	if err != nil {
		return nil, err
	}
	var raw fgHARaw
	if err := readSingleObject(resp, &raw); err != nil {
		return nil, err
	}

	mode := raw.Mode
	if mode == "" {
		mode = "standalone"
	}
	out := &FGHAStatus{
		Mode:                   mode,
		Clustered:              mode != "standalone",
		GroupName:              raw.GroupName,
		GroupID:                raw.GroupID,
		Priority:               raw.Priority,
		Override:               isOn(raw.Override),
		HeartbeatDevs:          splitDevList(raw.HBDev),
		MonitoredIntfs:         splitDevList(raw.Monitor),
		SyncConfig:             isOn(raw.SyncConfig),
		SessionPickup:          isOn(raw.SessionPickup),
		Encryption:             isOn(raw.Encryption),
		Authentication:         isOn(raw.Authentication),
		HBInterval:             raw.HBInterval,
		HBLostThreshold:        raw.HBLostThreshold,
		HAMgmtStatus:           isOn(raw.HAMgmtStatus),
		UninterruptibleUpgrade: isOn(raw.UninterruptibleUpgrade),
		Members:                []FGHAMember{},
	}

	// A standalone unit is not asked about its peers. The call succeeds and returns nothing, which
	// would be indistinguishable from a cluster whose members have all gone.
	if !out.Clustered {
		out.PeersReadable = true
		return out, nil
	}
	out.Members, out.PeersReadable = f.haPeers()
	return out, nil
}

type fgHAPeerRaw struct {
	SerialNo string `json:"serial_no"`
	Hostname string `json:"hostname"`
	Priority int    `json:"priority"`
	Role     string `json:"role"`
	// The monitor API spells this differently between firmwares; both are read.
	VCluster int `json:"vcluster_id"`
}

type fgHAStatRaw struct {
	SerialNo  string `json:"serial_no"`
	Hostname  string `json:"hostname"`
	CPUUsage  int    `json:"cpu_usage"`
	MemUsage  int    `json:"mem_usage"`
	Sessions  int    `json:"sessions"`
	Uptime    int    `json:"uptime"`
	IsManaged bool   `json:"is_manage_master"`
}

// haPeers joins the member list with the per-member statistics.
//
// Two calls rather than one because the monitor API splits them, and the statistics are the half
// more likely to be missing: a member that has just joined reports itself in ha-peer before it
// reports any load. A missing statistic leaves a zero, which the UI renders as "—" rather than as
// an idle member.
func (f *FortiClient) haPeers() ([]FGHAMember, bool) {
	resp, err := f.do("GET", "/api/v2/monitor/system/ha-peer", nil)
	if err != nil {
		return nil, false
	}
	var peers []fgHAPeerRaw
	if json.Unmarshal(resp.Results, &peers) != nil {
		return nil, false
	}

	stats := map[string]fgHAStatRaw{}
	thisUnit := ""
	if r, e := f.do("GET", "/api/v2/monitor/system/ha-statistics", nil); e == nil {
		var rows []fgHAStatRaw
		if json.Unmarshal(r.Results, &rows) == nil {
			for _, s := range rows {
				stats[s.SerialNo] = s
				if s.IsManaged {
					thisUnit = s.SerialNo
				}
			}
		}
	}

	out := make([]FGHAMember, 0, len(peers))
	for _, p := range peers {
		m := FGHAMember{
			SerialNumber: p.SerialNo,
			Hostname:     p.Hostname,
			Priority:     p.Priority,
			Role:         p.Role,
			IsThisUnit:   p.SerialNo != "" && p.SerialNo == thisUnit,
		}
		if s, ok := stats[p.SerialNo]; ok {
			m.CPUUsage, m.MemUsage, m.Sessions, m.UptimeSec = s.CPUUsage, s.MemUsage, s.Sessions, s.Uptime
			if m.Hostname == "" {
				m.Hostname = s.Hostname
			}
		}
		out = append(out, m)
	}
	return out, true
}

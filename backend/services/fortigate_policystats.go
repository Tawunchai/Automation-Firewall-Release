package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Policy Hit-Count & Rule Lifecycle.
//
// The firewall policy table answers "what rules exist"; it does not answer the question every
// operator actually has — "which of these are dead and safe to remove". That answer lives in the
// **monitor** API, on a different endpoint from the CMDB list the Firewall Policy page renders:
//
//	GET /api/v2/monitor/firewall/policy   per-policy live counters
//
// Verified live against the lab FGT80E (FortiOS 7.2.10). One row per policy:
//
//	{"policyid":1,"uuid":"…","active_sessions":0,"bytes":40,"packets":1,
//	 "software_bytes":40,"software_packets":1,"asic_bytes":0,"asic_packets":0,
//	 "nturbo_bytes":0,"nturbo_packets":0,
//	 "last_used":1785747212,"first_used":1785747212,"hit_count":1,
//	 "1_week_ipv4":{"hit_count":[0,0,0,0,0,0,0,1], …}}
//
// ⚠️ Two gotchas that shape the code below, both observed on the device:
//
//   - `last_used` / `first_used` / `hit_count` are **absent** on a policy that has never matched a
//     packet — not zero, absent. So "never used" and "used once long ago" are different states and
//     have to be distinguished by presence, not by value. That is why the raw row uses pointers.
//   - The row set includes **policyid 0**, the implicit deny. It carries no uuid and no timestamps
//     and does not exist in the CMDB list, so it is dropped rather than reported as a dead rule.
//
// `last_used` is a **UTC epoch on the same clock as monitor/system/time** (checked: the device
// reported time=1785816500 while a policy hit 19 hours earlier read last_used=1785747212). Idle
// age is therefore `deviceEpoch - last_used` with no timezone correction — do NOT reuse
// DeviceLocalTime() here, which deliberately shifts by the device's UTC offset for schedule math.

// fgPolicyStatsRow is one raw row of monitor/firewall/policy.
//
// The three lifecycle fields are pointers on purpose: FortiOS omits them entirely for a policy that
// has never matched, and a plain int64 would render that as "used at epoch 0" (1970) instead of
// "never used".
type fgPolicyStatsRow struct {
	PolicyID       int    `json:"policyid"`
	UUID           string `json:"uuid"`
	ActiveSessions int64  `json:"active_sessions"`
	Bytes          int64  `json:"bytes"`
	Packets        int64  `json:"packets"`

	HitCount  *int64 `json:"hit_count"`
	LastUsed  *int64 `json:"last_used"`
	FirstUsed *int64 `json:"first_used"`

	WeekIPv4 *fgPolicyWeekBuckets `json:"1_week_ipv4"`
	WeekIPv6 *fgPolicyWeekBuckets `json:"1_week_ipv6"`
}

type fgPolicyWeekBuckets struct {
	HitCount []int64 `json:"hit_count"`
	Bytes    []int64 `json:"bytes"`
	Packets  []int64 `json:"packets"`
}

// Lifecycle states. A policy is in exactly one of these.
const (
	PolicyStateActive    = "active"     // matched traffic within activeWindowDays
	PolicyStateIdle      = "idle"       // matched at some point, but not recently
	PolicyStateStale     = "stale"      // last match older than the stale threshold
	PolicyStateNeverUsed = "never-used" // never matched a single packet since counters were reset
	PolicyStateDisabled  = "disabled"   // administratively disabled — counters are meaningless
)

// Recommendations attached to a state. Deliberately only two: this feature proposes, an operator
// disposes. Nothing here deletes anything.
const (
	PolicyAdviceNone   = ""
	PolicyAdviceReview = "review"
	PolicyAdviceRemove = "remove"
)

// DefaultStalePolicyDays is the "🔴 0 hits in N days" threshold. 90 days is the common audit bar
// (a full quarter covers quarter-end batch jobs and seasonal traffic).
const DefaultStalePolicyDays = 90

// activeWindowDays is how recently a policy must have matched to count as live rather than merely
// "not stale yet". A week covers weekly batch traffic without calling a Monday-only rule dead.
const activeWindowDays = 7

// FGPolicyUsage is one policy's lifecycle row — the CMDB identity joined to the live counters.
type FGPolicyUsage struct {
	PolicyID int    `json:"policyid"`
	Name     string `json:"name"`
	Action   string `json:"action"`
	Status   string `json:"status"` // enable | disable
	Comments string `json:"comments,omitempty"`

	Bytes          int64 `json:"bytes"`
	Packets        int64 `json:"packets"`
	HitCount       int64 `json:"hit_count"`
	ActiveSessions int64 `json:"active_sessions"`

	// FirstUsed / LastUsed are UTC epoch seconds; 0 means the device reports no match ever.
	FirstUsed int64 `json:"first_used"`
	LastUsed  int64 `json:"last_used"`

	// IdleDays is whole days since the last match. -1 means "never used" (there is no last match
	// to measure from) — callers must not render -1 as a duration.
	IdleDays int `json:"idle_days"`

	State  string `json:"state"`
	Advice string `json:"advice"`

	// WeekHits is the device's own 8-bucket weekly hit histogram, oldest → newest, for a sparkline.
	// Empty when the device reports no history for this policy.
	WeekHits []int64 `json:"week_hits,omitempty"`
}

// FGPolicyUsageSummary is the count of policies in each state — the numbers behind the page header.
type FGPolicyUsageSummary struct {
	Total     int `json:"total"`
	Active    int `json:"active"`
	Idle      int `json:"idle"`
	Stale     int `json:"stale"`
	NeverUsed int `json:"never_used"`
	Disabled  int `json:"disabled"`

	// Removable is the number of policies carrying the "remove" advice — the cleanup backlog.
	Removable int `json:"removable"`
}

// FGPolicyUsageReport is the whole answer for one device.
type FGPolicyUsageReport struct {
	// DeviceTime is the UTC epoch the idle ages were measured against, so a caller can tell a
	// stale report from a stale policy.
	DeviceTime int64 `json:"device_time"`
	// CountersAvailable is false when the device would not answer monitor/firewall/policy at all.
	// Every policy then reports as never-used, which would be a lie — the UI uses this to say
	// "counters unavailable" instead of "everything is dead".
	CountersAvailable bool `json:"counters_available"`

	StaleDays  int `json:"stale_days"`
	ActiveDays int `json:"active_days"`

	Summary  FGPolicyUsageSummary `json:"summary"`
	Policies []FGPolicyUsage      `json:"policies"`
}

// deviceEpochUTC reads the device's clock as a raw UTC epoch.
//
// Distinct from DeviceLocalTime(), which adds the device's UTC offset because a firewall schedule
// is evaluated against wall-clock time. Policy counters are not: last_used is a true UTC epoch, so
// adding the offset here would skew every idle age by the timezone (7 hours on this lab device).
func (f *FortiClient) deviceEpochUTC() int64 {
	resp, err := f.do("GET", "/api/v2/monitor/system/time", nil)
	if err != nil {
		return time.Now().UTC().Unix()
	}
	var r struct {
		Time int64 `json:"time"`
	}
	if json.Unmarshal(resp.Results, &r) != nil || r.Time <= 0 {
		return time.Now().UTC().Unix()
	}
	return r.Time
}

// policyStatsRows reads monitor/firewall/policy, keyed by policy id.
//
// Best-effort by design: a device that will not answer leaves the map empty and the caller reports
// counters as unavailable rather than failing the whole page.
func (f *FortiClient) policyStatsRows() (map[int]fgPolicyStatsRow, bool) {
	out := map[int]fgPolicyStatsRow{}
	resp, err := f.do("GET", "/api/v2/monitor/firewall/policy", nil)
	if err != nil {
		return out, false
	}
	var rows []fgPolicyStatsRow
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out, false
	}
	for _, r := range rows {
		// policyid 0 is the implicit deny: it is not in the CMDB table and cannot be removed,
		// so reporting it as an unused rule would be noise.
		if r.PolicyID == 0 {
			continue
		}
		out[r.PolicyID] = r
	}
	return out, true
}

// classifyPolicyUsage decides the lifecycle state and the advice for one policy.
//
// Split out from GetPolicyUsage so the rules are testable without a device: this is the part an
// operator will argue with, and it must be deterministic.
func classifyPolicyUsage(u *FGPolicyUsage, countersAvailable bool, staleDays int) {
	// Disabled wins over everything. A disabled policy has no hits *because* it is disabled, so
	// calling it "stale" would invite deleting a rule that was parked deliberately.
	if strings.EqualFold(u.Status, "disable") {
		u.State = PolicyStateDisabled
		u.Advice = PolicyAdviceReview
		return
	}

	// With no counters at all, every policy would look never-used. Say nothing rather than lie.
	if !countersAvailable {
		u.State = PolicyStateActive
		u.Advice = PolicyAdviceNone
		return
	}

	if u.LastUsed <= 0 {
		u.State = PolicyStateNeverUsed
		u.Advice = PolicyAdviceRemove
		return
	}

	switch {
	case u.IdleDays >= staleDays:
		u.State = PolicyStateStale
		u.Advice = PolicyAdviceRemove
	case u.IdleDays >= activeWindowDays:
		u.State = PolicyStateIdle
		u.Advice = PolicyAdviceReview
	default:
		u.State = PolicyStateActive
		u.Advice = PolicyAdviceNone
	}
}

// idleDaysSince returns whole days between two UTC epochs, or -1 when there is no last match.
//
// Clamped at 0: a device clock that runs slightly behind its own counters must not produce a
// negative age, which would sort above genuinely active policies.
func idleDaysSince(now, lastUsed int64) int {
	if lastUsed <= 0 {
		return -1
	}
	delta := now - lastUsed
	if delta < 0 {
		return 0
	}
	return int(delta / 86400)
}

// GetPolicyUsage joins the CMDB policy table to the live monitor counters and classifies each rule.
//
// staleDays <= 0 falls back to DefaultStalePolicyDays.
func (f *FortiClient) GetPolicyUsage(staleDays int) (FGPolicyUsageReport, error) {
	if staleDays <= 0 {
		staleDays = DefaultStalePolicyDays
	}

	report := FGPolicyUsageReport{
		StaleDays:  staleDays,
		ActiveDays: activeWindowDays,
		Policies:   []FGPolicyUsage{},
	}

	policies, err := f.GetPolicies()
	if err != nil {
		return report, fmt.Errorf("read firewall policies: %w", err)
	}

	stats, ok := f.policyStatsRows()
	report.CountersAvailable = ok
	report.DeviceTime = f.deviceEpochUTC()

	for _, p := range policies {
		u := FGPolicyUsage{
			PolicyID: p.PolicyID,
			Name:     p.Name,
			Action:   p.Action,
			Status:   p.Status,
			Comments: p.Comments,
			IdleDays: -1,
		}

		if row, found := stats[p.PolicyID]; found {
			u.Bytes = row.Bytes
			u.Packets = row.Packets
			u.ActiveSessions = row.ActiveSessions
			if row.HitCount != nil {
				u.HitCount = *row.HitCount
			}
			if row.FirstUsed != nil {
				u.FirstUsed = *row.FirstUsed
			}
			if row.LastUsed != nil {
				u.LastUsed = *row.LastUsed
			}
			u.WeekHits = mergeWeekHits(row.WeekIPv4, row.WeekIPv6)
		}

		u.IdleDays = idleDaysSince(report.DeviceTime, u.LastUsed)
		classifyPolicyUsage(&u, report.CountersAvailable, staleDays)
		report.Policies = append(report.Policies, u)
	}

	sortPolicyUsage(report.Policies)
	report.Summary = summarizePolicyUsage(report.Policies)
	return report, nil
}

// mergeWeekHits sums the IPv4 and IPv6 weekly histograms into one sparkline series.
//
// The device reports them separately and a dual-stack policy carries both; showing only IPv4 would
// under-report a v6-heavy rule as quiet. Buckets are oldest → newest, as the device sends them.
func mergeWeekHits(v4, v6 *fgPolicyWeekBuckets) []int64 {
	if v4 == nil && v6 == nil {
		return nil
	}
	size := 0
	if v4 != nil && len(v4.HitCount) > size {
		size = len(v4.HitCount)
	}
	if v6 != nil && len(v6.HitCount) > size {
		size = len(v6.HitCount)
	}
	if size == 0 {
		return nil
	}
	out := make([]int64, size)
	for i := range out {
		if v4 != nil && i < len(v4.HitCount) {
			out[i] += v4.HitCount[i]
		}
		if v6 != nil && i < len(v6.HitCount) {
			out[i] += v6.HitCount[i]
		}
	}
	return out
}

// sortPolicyUsage puts the cleanup backlog on top: worst state first, then longest-idle, then by
// policy id so the order is stable between refreshes.
func sortPolicyUsage(rows []FGPolicyUsage) {
	rank := map[string]int{
		PolicyStateNeverUsed: 0,
		PolicyStateStale:     1,
		PolicyStateDisabled:  2,
		PolicyStateIdle:      3,
		PolicyStateActive:    4,
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ri, rj := rank[rows[i].State], rank[rows[j].State]
		if ri != rj {
			return ri < rj
		}
		if rows[i].IdleDays != rows[j].IdleDays {
			return rows[i].IdleDays > rows[j].IdleDays
		}
		return rows[i].PolicyID < rows[j].PolicyID
	})
}

func summarizePolicyUsage(rows []FGPolicyUsage) FGPolicyUsageSummary {
	s := FGPolicyUsageSummary{Total: len(rows)}
	for _, r := range rows {
		switch r.State {
		case PolicyStateActive:
			s.Active++
		case PolicyStateIdle:
			s.Idle++
		case PolicyStateStale:
			s.Stale++
		case PolicyStateNeverUsed:
			s.NeverUsed++
		case PolicyStateDisabled:
			s.Disabled++
		}
		if r.Advice == PolicyAdviceRemove {
			s.Removable++
		}
	}
	return s
}

// ── The live counters themselves ──────────────────────────────────────────────
//
// These sat in fortigate_troubleshoot.go, which is why fortigate_topology.go had to reach into a
// troubleshooting file to draw a measured edge. They are a monitor read about policies, the same
// thing the rest of this file is about, so they live here.

// FGPolicyStats is one row of monitor/firewall/policy — the live hit counters behind each policy.
type FGPolicyStats struct {
	PolicyID       int   `json:"policyid"`
	Bytes          int64 `json:"bytes"`
	Packets        int64 `json:"packets"`
	ActiveSessions int64 `json:"active_sessions"`
}

// GetPolicyStats reads the per-policy traffic counters. Best-effort: a firewall that will not
// answer leaves the counters at zero rather than failing the whole trace.
func (f *FortiClient) GetPolicyStats() map[int]FGPolicyStats {
	out := map[int]FGPolicyStats{}
	resp, err := f.do("GET", "/api/v2/monitor/firewall/policy", nil)
	if err != nil {
		return out
	}
	var rows []FGPolicyStats
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		out[r.PolicyID] = r
	}
	return out
}

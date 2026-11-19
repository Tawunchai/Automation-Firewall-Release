package services

import (
	"fmt"
	"net"
	"time"
)

// Whole-Change-Set Impact Preview — "what would this proposed firewall policy change actually have
// done to the traffic that already happened here."
//
// WHY REAL SESSIONS, NOT A SYNTHETIC SWEEP. A firewall's own traffic log is the one list of 5-tuples
// GUARANTEED to matter: every row already happened. Replaying those through the policy table as it
// is now and as the proposed change would leave it answers "what would this actually have broken",
// which is a different and stronger question than "what COULD this affect in theory" — the AI
// Assistant's packetSim.ts already answers the theoretical version (IP-range/port overlap math, no
// real traffic; see its own doc comment), and this is deliberately the other thing, server-side,
// against the real matcher Troubleshooting and Fix-it already trust.
//
// WHY ONLY FIREWALL POLICIES. The replay reuses walkPolicyTable (fortigate_troubleshoot.go) exactly
// as it is — extending this to other CMDB tables (an edited address, a renamed service) would mean
// teaching this function every other table's semantics instead of the one table a session's verdict
// actually turns on: the firewall policy list.
//
// WHY NO LIVE ROUTE LOOKUP PER SESSION. TracePolicyPath resolves ingress/egress by asking the device
// to route the packet — necessary for a HYPOTHETICAL 5-tuple a human typed in, but wasteful and
// slower for hundreds of sessions that ALREADY have a recorded srcintf/dstintf from the moment they
// really crossed the firewall. Using the log's own interfaces is not an approximation; it is more
// accurate than re-routing, since a route can have changed since the session was logged.

// ImpactPreviewOp is the kind of change being proposed — the same four ways
// controller/policyobject/device_proxy.go and device_policy_update.go can touch a policy.
type ImpactPreviewOp string

const (
	ImpactCreate ImpactPreviewOp = "create"
	ImpactUpdate ImpactPreviewOp = "update"
	ImpactDelete ImpactPreviewOp = "delete"
	ImpactMove   ImpactPreviewOp = "move"
)

// ImpactPreviewChange is one proposed change to the firewall policy table.
type ImpactPreviewChange struct {
	Op ImpactPreviewOp
	// PolicyID is the policy being changed — required for update, delete and move.
	PolicyID int
	// Policy is the full proposed content — required for create and update. For update, PolicyID
	// above is what is matched against the live table; Policy.PolicyID is ignored.
	Policy FGPolicy
	// Position/RefID are move's target, same contract as DeviceMovePolicy.
	Position string // "before" | "after"
	RefID    int
}

// ImpactedSession is one real, recently-logged session whose verdict would change.
type ImpactedSession struct {
	SrcIP    string `json:"src_ip"`
	DstIP    string `json:"dst_ip"`
	SrcPort  int    `json:"src_port,omitempty"`
	DstPort  int    `json:"dst_port,omitempty"`
	Protocol string `json:"protocol"`
	SrcIntf  string `json:"src_intf"`
	DstIntf  string `json:"dst_intf"`
	// LoggedAt is epoch milliseconds, the log row's own timestamp.
	LoggedAt int64 `json:"logged_at"`

	Before         string `json:"before"` // allowed | denied | implicit-deny | no-route
	After          string `json:"after"`
	BeforePolicyID int    `json:"before_policy_id,omitempty"`
	AfterPolicyID  int    `json:"after_policy_id,omitempty"`
}

// ImpactPreviewResult summarises replaying real, recent traffic through the current policy table
// and the proposed one.
type ImpactPreviewResult struct {
	TotalSampled int `json:"total_sampled"`
	Changed      int `json:"changed"`
	NewlyAllowed int `json:"newly_allowed"`
	NewlyBlocked int `json:"newly_blocked"`
	// Samples is capped at impactPreviewMaxSamples — a reader needs a handful of concrete examples,
	// not a second copy of the traffic log.
	Samples []ImpactedSession `json:"samples"`
	// Warnings carries soft problems (an empty or small log) that do not stop the preview from
	// running, so a reader can judge how much to trust it.
	Warnings []string `json:"warnings,omitempty"`
}

const (
	// impactPreviewSampleSize is how many of the most recent log rows are replayed. The device's
	// memory log is a bounded ring buffer (see fortigate_log.go), so this is also, in practice,
	// "as much real traffic as the firewall currently remembers".
	impactPreviewSampleSize = 300
	// impactPreviewMaxSamples caps how many CHANGED sessions are returned in full.
	impactPreviewMaxSamples = 20
)

// PreviewPolicyChangeImpact is the whole feature: read the shared environment once, build the
// proposed policy table in memory, replay every recent real session through both, and report what
// would differ. Nothing is written to the device.
func (f *FortiClient) PreviewPolicyChangeImpact(change ImpactPreviewChange) (ImpactPreviewResult, error) {
	var out ImpactPreviewResult

	var (
		policies                     []FGPolicy
		addresses                    []FGAddress
		svcs                         []FGService
		vipList                      []FGVirtualIP
		logPage                      FGTrafficLogPage
		policiesErr, addrErr, svcErr error
		vipErr, logErr               error
		addrGroups, svcGroups, zones map[string][]string
		schedules                    map[string]fgScheduleDetail
		now                          time.Time
	)
	Parallel(
		func() { policies, policiesErr = f.GetPolicies() },
		func() { addresses, addrErr = f.GetAddresses() },
		func() { svcs, svcErr = f.GetServices() },
		func() { vipList, vipErr = f.GetVirtualIPs() },
		func() { addrGroups = f.addressGroups() },
		func() { svcGroups = f.serviceGroups() },
		func() { zones = f.zoneMembers() },
		func() { schedules = f.scheduleTable() },
		func() { now = f.DeviceLocalTime() },
		func() {
			logPage, logErr = f.GetTrafficLog(TrafficLogQuery{
				Source: "memory", Subcategory: "forward", Window: LogWindowAll, Rows: impactPreviewSampleSize,
			}, nil)
		},
	)
	for _, err := range []error{policiesErr, addrErr, svcErr, vipErr} {
		if err != nil {
			return out, err
		}
	}
	if logErr != nil {
		return out, fmt.Errorf("could not read recent traffic to replay: %w", logErr)
	}

	vips := make(map[string]string, len(vipList))
	vipByName := make(map[string]FGVirtualIP, len(vipList))
	for _, v := range vipList {
		vips[v.Name] = v.ExtIP
		vipByName[v.Name] = v
	}
	am := &addrMatcher{addrs: make(map[string]FGAddress, len(addresses)), groups: addrGroups, vips: vips}
	for _, a := range addresses {
		am.addrs[a.Name] = a
	}
	sm := &svcMatcher{services: make(map[string]FGService, len(svcs)), groups: svcGroups}
	for _, s := range svcs {
		sm.services[s.Name] = s
	}

	proposed, err := applyImpactChange(policies, change)
	if err != nil {
		return out, err
	}

	out.TotalSampled = len(logPage.Rows)
	if out.TotalSampled == 0 {
		out.Warnings = append(out.Warnings, "the device's traffic log is empty — nothing real to replay yet")
		return out, nil
	}
	if out.TotalSampled < impactPreviewSampleSize {
		out.Warnings = append(out.Warnings, fmt.Sprintf(
			"only %d real session(s) are in the log right now — this preview covers less than it will once the firewall has seen more traffic",
			out.TotalSampled))
	}

	for _, row := range logPage.Rows {
		srcIP := net.ParseIP(row.SrcIP)
		dstIP := net.ParseIP(row.DstIP)
		if srcIP == nil || dstIP == nil || row.SrcIntf == "" || row.DstIntf == "" {
			continue // a row the log did not fully name — nothing to replay it against
		}
		dstPort := 0
		if row.DstPort != nil {
			dstPort = *row.DstPort
		}

		q := FGTraceQuery{SrcIP: row.SrcIP, DstIP: row.DstIP, Protocol: row.Proto, DstPort: dstPort}
		in := traceInputs{
			q: q, srcIP: srcIP, dstIP: dstIP, am: am, sm: sm, zones: zones, schedules: schedules,
			now: now, vips: vipByName,
		}

		before := FGTraceResult{Query: q, Ingress: row.SrcIntf, Egress: row.DstIntf}
		walkPolicyTable(&before, policies, in)
		after := FGTraceResult{Query: q, Ingress: row.SrcIntf, Egress: row.DstIntf}
		walkPolicyTable(&after, proposed, in)

		beforeID, afterID := 0, 0
		if before.Matched != nil {
			beforeID = before.Matched.PolicyID
		}
		if after.Matched != nil {
			afterID = after.Matched.PolicyID
		}
		if before.Verdict == after.Verdict && beforeID == afterID {
			continue
		}

		out.Changed++
		switch {
		case before.Verdict != "allowed" && after.Verdict == "allowed":
			out.NewlyAllowed++
		case before.Verdict == "allowed" && after.Verdict != "allowed":
			out.NewlyBlocked++
		}

		if len(out.Samples) < impactPreviewMaxSamples {
			s := ImpactedSession{
				SrcIP: row.SrcIP, DstIP: row.DstIP, Protocol: row.ProtoName,
				SrcIntf: row.SrcIntf, DstIntf: row.DstIntf, LoggedAt: row.Timestamp,
				Before: before.Verdict, After: after.Verdict,
				BeforePolicyID: beforeID, AfterPolicyID: afterID,
			}
			if row.SrcPort != nil {
				s.SrcPort = *row.SrcPort
			}
			s.DstPort = dstPort
			out.Samples = append(out.Samples, s)
		}
	}
	return out, nil
}

// applyImpactChange builds the PROPOSED policy table in memory — a clone of the live one with
// exactly the one change applied — without writing anything. The move case mirrors
// fortigate_troubleshoot_fix.go's simulateFix (FixOpMovePolicy): find both indices before mutating
// either, then adjust the target index for the shift a removal causes, because a splice -> insert
// is order-sensitive in exactly this way.
func applyImpactChange(policies []FGPolicy, change ImpactPreviewChange) ([]FGPolicy, error) {
	out := make([]FGPolicy, len(policies))
	for i, p := range policies {
		out[i] = clonePolicy(p)
	}
	indexOf := func(id int) int {
		for i := range out {
			if out[i].PolicyID == id {
				return i
			}
		}
		return -1
	}

	switch change.Op {
	case ImpactCreate:
		np := clonePolicy(change.Policy)
		if np.PolicyID == 0 {
			// A real create lets the device assign the id; a synthetic one just needs to be
			// distinct from every real policy so it cannot be confused with one in the samples.
			np.PolicyID = -1
		}
		out = append(out, np)

	case ImpactUpdate:
		i := indexOf(change.PolicyID)
		if i < 0 {
			return nil, fmt.Errorf("policy %d not found", change.PolicyID)
		}
		merged := clonePolicy(change.Policy)
		merged.PolicyID = change.PolicyID
		out[i] = merged

	case ImpactDelete:
		i := indexOf(change.PolicyID)
		if i < 0 {
			return nil, fmt.Errorf("policy %d not found", change.PolicyID)
		}
		out = append(out[:i], out[i+1:]...)

	case ImpactMove:
		from := indexOf(change.PolicyID)
		to := indexOf(change.RefID)
		if from < 0 {
			return nil, fmt.Errorf("policy %d not found", change.PolicyID)
		}
		if to < 0 {
			return nil, fmt.Errorf("reference policy %d not found", change.RefID)
		}
		if from == to {
			return out, nil
		}
		moved := out[from]
		out = append(out[:from], out[from+1:]...)
		if from < to {
			to--
		}
		insertAt := to
		if change.Position == "after" {
			insertAt++
		}
		out = append(out[:insertAt], append([]FGPolicy{moved}, out[insertAt:]...)...)

	default:
		return nil, fmt.Errorf("unknown change operation %q", change.Op)
	}
	return out, nil
}

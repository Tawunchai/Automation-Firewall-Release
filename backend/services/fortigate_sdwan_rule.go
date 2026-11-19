package services

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sdwanServiceTable = cmdbPath{path: "system/sdwan/service", noun: "SD-WAN rule"}

// SD-WAN Rules — system/sdwan/service, the "Priority Rule" dialog.
//
// One rule says: traffic matching THIS (source, destination, service) leaves by THOSE members,
// chosen THIS way. The dialog's "Interface selection strategy" is the CMDB `mode`, and it is the
// field everything else hangs off — verified live on 10.0.99.201 (FGT80E v7.2.10):
//
//	GUI strategy            mode            the fields that actually apply
//	Manual                  manual          priority-members / priority-zone
//	Best quality            priority        + health-check ("Measured SLA") + link-cost-factor
//	Lowest cost (SLA)       sla             + sla[] ("Required SLA target")
//	Maximize bandwidth(SLA) load-balance    + sla[] + hash-mode
//
// ⚠️ FIELDS OUTSIDE THE CHOSEN MODE ARE DISCARDED SILENTLY. Sending `health-check` with
// `mode: sla` returns 200 and reads back empty; sending `link-cost-factor: jitter` with `mode: sla`
// returns 200 and reads back `latency`. Nothing warns you. So buildSDWANRulePayload sends only the
// fields the mode owns — otherwise the form would appear to save settings the device threw away.
//
// ⚠️ THE `sla` SUB-TABLE DOES NOT REPLACE IN ONE PUT. Measured on the device:
//
//	sla=[Gmail]  →  PUT sla=[AWS]  →  reads back [Gmail, AWS]
//	                PUT sla=[AWS]  →  reads back [AWS]        (the SAME request, again)
//
// One PUT merges; a second identical PUT converges. UpdateSDWANRule therefore writes, reads back,
// and writes once more only when the table still disagrees — see reconcileRuleSLA.
//
// ⚠️ THE LAST `sla` ROW CANNOT BE REMOVED. `sla: []` leaves one row behind however many times it is
// sent. That is consistent with the device requiring an SLA target in the two SLA modes, which is
// why the validator demands at least one there rather than pretending the field is optional.

const sdwanServicePath = sdwanPath + "/service"

// SDWANRuleSLATarget is one row of the rule's `sla` sub-table: which health check, and which of its
// numbered SLA definitions must be met.
type SDWANRuleSLATarget struct {
	HealthCheck string `json:"health_check"`
	ID          int    `json:"id"`
}

// SDWANRuleFull is the Priority Rule dialog, GUI-shaped.
type SDWANRuleFull struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Status bool   `json:"status"`

	// Source
	Source     []string `json:"source"`      // src
	UserGroups []string `json:"user_groups"` // groups
	Users      []string `json:"users"`

	// Destination
	Destination          []string `json:"destination"` // dst
	RouteTag             int      `json:"route_tag"`
	InternetService      bool     `json:"internet_service"`
	InternetServiceNames []string `json:"internet_service_names"`

	// Outgoing interfaces
	Mode                string               `json:"mode"`
	InterfacePreference []int                `json:"interface_preference"` // priority-members (seq-num)
	ZonePreference      []string             `json:"zone_preference"`      // priority-zone
	MeasuredSLA         []string             `json:"measured_sla"`         // health-check (mode=priority)
	RequiredSLATargets  []SDWANRuleSLATarget `json:"required_sla_targets"` // sla (mode=sla|load-balance)
	QualityCriteria     string               `json:"quality_criteria"`     // link-cost-factor (mode=priority)
	HashMode            string               `json:"hash_mode"`            // mode=load-balance
	ForwardDSCP         bool                 `json:"forward_dscp"`
	ForwardDSCPTag      string               `json:"forward_dscp_tag"`
	ReverseDSCP         bool                 `json:"reverse_dscp"`
	ReverseDSCPTag      string               `json:"reverse_dscp_tag"`

	// Service matching, shown in the list's Port / Protocol columns.
	Protocol  int `json:"protocol"`
	StartPort int `json:"start_port"`
	EndPort   int `json:"end_port"`
}

// SDWANImplicitRule is the row the GUI shows under "Implicit": not a stored rule at all, but the
// device's own fallback — everything that matches no rule is balanced by load-balance-mode.
//
// Synthesised here rather than in the UI so that "what the firewall does with unmatched traffic" is
// answered by the same read that lists the rules, and cannot drift from it.
type SDWANImplicitRule struct {
	Name     string `json:"name"`     // always "sd-wan" — the device's own label
	Criteria string `json:"criteria"` // load-balance-mode, in the GUI's wording
	Mode     string `json:"mode"`     // the raw CMDB value, so nothing is lost in translation
}

// SDWANRuleList is one read serving the whole SD-WAN Rules tab.
type SDWANRuleList struct {
	Rules    []SDWANRuleFull   `json:"rules"`
	Implicit SDWANImplicitRule `json:"implicit"`
}

// loadBalanceCriteria renders load-balance-mode the way the FortiGate list column does. An
// unmapped value falls through to the raw string rather than being labelled with a guess.
func loadBalanceCriteria(mode string) string {
	switch mode {
	case "source-ip-based":
		return "Source IP"
	case "source-dest-ip-based":
		return "Source-Destination IP"
	case "weight-based":
		return "Weight"
	case "usage-based":
		return "Spillover"
	case "measured-volume-based":
		return "Measured Volume"
	}
	return mode
}

// ── Read ─────────────────────────────────────────────────────────────────────

type fgSDWANService struct {
	ID              int      `json:"id"`
	Name            string   `json:"name"`
	Mode            string   `json:"mode"`
	Status          string   `json:"status"`
	Src             []FGName `json:"src"`
	Dst             []FGName `json:"dst"`
	Groups          []FGName `json:"groups"`
	Users           []FGName `json:"users"`
	RouteTag        int      `json:"route-tag"`
	InternetService string   `json:"internet-service"`
	InternetSvcName []FGName `json:"internet-service-name"`
	HealthCheck     []FGName `json:"health-check"`
	PriorityZone    []FGName `json:"priority-zone"`
	PriorityMembers []struct {
		SeqNum int `json:"seq-num"`
	} `json:"priority-members"`
	SLA []struct {
		HealthCheck string      `json:"health-check"`
		ID          json.Number `json:"id"`
	} `json:"sla"`
	LinkCostFactor string `json:"link-cost-factor"`
	HashMode       string `json:"hash-mode"`
	DSCPForward    string `json:"dscp-forward"`
	DSCPForwardTag string `json:"dscp-forward-tag"`
	DSCPReverse    string `json:"dscp-reverse"`
	DSCPReverseTag string `json:"dscp-reverse-tag"`
	Protocol       int    `json:"protocol"`
	StartPort      int    `json:"start-port"`
	EndPort        int    `json:"end-port"`
}

func (r fgSDWANService) toRule() SDWANRuleFull {
	members := make([]int, 0, len(r.PriorityMembers))
	for _, m := range r.PriorityMembers {
		members = append(members, m.SeqNum)
	}
	targets := make([]SDWANRuleSLATarget, 0, len(r.SLA))
	for _, s := range r.SLA {
		id, _ := strconv.Atoi(s.ID.String())
		targets = append(targets, SDWANRuleSLATarget{HealthCheck: s.HealthCheck, ID: id})
	}
	return SDWANRuleFull{
		ID: r.ID, Name: r.Name, Mode: r.Mode, Status: FGStringToBool(r.Status),
		Source:               FGNamesToStrings(r.Src),
		UserGroups:           FGNamesToStrings(r.Groups),
		Users:                FGNamesToStrings(r.Users),
		Destination:          FGNamesToStrings(r.Dst),
		RouteTag:             r.RouteTag,
		InternetService:      FGStringToBool(r.InternetService),
		InternetServiceNames: FGNamesToStrings(r.InternetSvcName),
		InterfacePreference:  members,
		ZonePreference:       FGNamesToStrings(r.PriorityZone),
		MeasuredSLA:          FGNamesToStrings(r.HealthCheck),
		RequiredSLATargets:   targets,
		QualityCriteria:      r.LinkCostFactor,
		HashMode:             r.HashMode,
		ForwardDSCP:          FGStringToBool(r.DSCPForward),
		ForwardDSCPTag:       r.DSCPForwardTag,
		ReverseDSCP:          FGStringToBool(r.DSCPReverse),
		ReverseDSCPTag:       r.DSCPReverseTag,
		Protocol:             r.Protocol, StartPort: r.StartPort, EndPort: r.EndPort,
	}
}

// GetSDWANRuleList reads every rule plus the implicit fallback row.
func (f *FortiClient) GetSDWANRuleList() (SDWANRuleList, error) {
	var (
		resp   *fgAPIResponse
		err    error
		lbMode string
	)
	Parallel(
		func() { resp, err = f.do("GET", sdwanServicePath, nil) },
		func() {
			// Best-effort: the rules are the page, and losing the implicit row's criteria must not
			// take the list down with it.
			r, e := f.do("GET", sdwanPath, nil)
			if e != nil {
				return
			}
			var root struct {
				LoadBalanceMode string `json:"load-balance-mode"`
			}
			if json.Unmarshal(r.Results, &root) == nil {
				lbMode = root.LoadBalanceMode
			}
		},
	)
	if err != nil {
		return SDWANRuleList{}, err
	}

	var rows []fgSDWANService
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return SDWANRuleList{}, fmt.Errorf("decode sdwan rules: %w", err)
	}
	out := SDWANRuleList{
		Rules: make([]SDWANRuleFull, 0, len(rows)),
		Implicit: SDWANImplicitRule{
			Name: "sd-wan", Mode: lbMode, Criteria: loadBalanceCriteria(lbMode),
		},
	}
	for _, r := range rows {
		out.Rules = append(out.Rules, r.toRule())
	}
	return out, nil
}

// GetSDWANRule reads one rule for the edit form.
func (f *FortiClient) GetSDWANRule(id int) (SDWANRuleFull, error) {
	resp, err := f.do("GET", sdwanServicePath+"/"+strconv.Itoa(id), nil)
	if err != nil {
		return SDWANRuleFull{}, err
	}
	var rows []fgSDWANService
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return SDWANRuleFull{}, fmt.Errorf("decode sdwan rule: %w", err)
	}
	if len(rows) == 0 {
		return SDWANRuleFull{}, fmt.Errorf("SD-WAN rule %d not found", id)
	}
	return rows[0].toRule(), nil
}

// ── Payload ──────────────────────────────────────────────────────────────────

// buildSDWANRulePayload maps the dialog onto the CMDB body.
//
// The mode switch at the bottom is the important part: only the fields the chosen strategy owns are
// sent. The device accepts the others with a 200 and then discards them, so including them would
// produce a form that reports success for settings that never landed.
func buildSDWANRulePayload(r SDWANRuleFull) map[string]interface{} {
	p := map[string]interface{}{
		"name":      strings.TrimSpace(r.Name),
		"mode":      r.Mode,
		"status":    FGBoolToString(r.Status),
		"src":       NamesToFGNames(r.Source),
		"dst":       NamesToFGNames(r.Destination),
		"groups":    NamesToFGNames(r.UserGroups),
		"users":     NamesToFGNames(r.Users),
		"route-tag": r.RouteTag,
		"protocol":  r.Protocol,
		// priority-members / priority-zone are the outgoing interfaces in EVERY mode — the dialog
		// shows them under all four strategies.
		"priority-members": seqNumsToFG(r.InterfacePreference),
		"priority-zone":    NamesToFGNames(r.ZonePreference),
		"dscp-forward":     FGBoolToString(r.ForwardDSCP),
		"dscp-reverse":     FGBoolToString(r.ReverseDSCP),
	}
	if r.ID > 0 {
		p["id"] = r.ID
	}
	// Ports only mean anything for the protocols that have them; the device stores 1-65535 by
	// default and rejects a port range on, say, ICMP.
	if r.Protocol == 6 || r.Protocol == 17 {
		p["start-port"] = r.StartPort
		p["end-port"] = r.EndPort
	}

	// Internet Service replaces the destination address list on the device — the two are
	// alternatives, and sending both leaves the rule matching something nobody asked for.
	if r.InternetService {
		p["internet-service"] = "enable"
		p["internet-service-name"] = NamesToFGNames(r.InternetServiceNames)
		delete(p, "dst")
	} else {
		p["internet-service"] = "disable"
	}

	if r.ForwardDSCP {
		p["dscp-forward-tag"] = r.ForwardDSCPTag
	}
	if r.ReverseDSCP {
		p["dscp-reverse-tag"] = r.ReverseDSCPTag
	}

	switch r.Mode {
	case "priority": // GUI "Best quality"
		p["health-check"] = NamesToFGNames(r.MeasuredSLA)
		p["link-cost-factor"] = r.QualityCriteria
	case "sla": // GUI "Lowest cost (SLA)"
		p["sla"] = slaTargetsToFG(r.RequiredSLATargets)
	case "load-balance": // GUI "Maximize bandwidth (SLA)"
		p["sla"] = slaTargetsToFG(r.RequiredSLATargets)
		if r.HashMode != "" {
			p["hash-mode"] = r.HashMode
		}
	}
	return p
}

func seqNumsToFG(seqs []int) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(seqs))
	for _, s := range seqs {
		out = append(out, map[string]interface{}{"seq-num": s})
	}
	return out
}

func slaTargetsToFG(targets []SDWANRuleSLATarget) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(targets))
	for _, t := range targets {
		out = append(out, map[string]interface{}{"health-check": t.HealthCheck, "id": t.ID})
	}
	return out
}

// ── Writes ───────────────────────────────────────────────────────────────────

func (f *FortiClient) CreateSDWANRule(r SDWANRuleFull) error {
	if err := sdwanServiceTable.Create(f, buildSDWANRulePayload(r)); err != nil {
		return err
	}
	return nil
}

// UpdateSDWANRule rewrites a rule, then makes sure the `sla` sub-table really matches.
//
// See the file header: one PUT merges the incoming SLA rows with what was already there, and only a
// second identical PUT converges. Rather than always paying for two writes, this reads back and
// repeats only when the table still disagrees.
func (f *FortiClient) UpdateSDWANRule(id int, r SDWANRuleFull) error {
	payload := buildSDWANRulePayload(r)
	if err := sdwanServiceTable.Update(f, strconv.Itoa(id), payload); err != nil {
		return err
	}
	if r.Mode != "sla" && r.Mode != "load-balance" {
		return nil // no sla table in play
	}
	return f.reconcileRuleSLA(id, r, payload)
}

// reconcileRuleSLA re-sends the same body once if the device's sla table does not yet match.
// A mismatch that survives the second write is reported rather than swallowed: it means the user is
// looking at a rule whose SLA targets are not what they asked for.
func (f *FortiClient) reconcileRuleSLA(id int, r SDWANRuleFull, payload map[string]interface{}) error {
	want := slaKeySet(r.RequiredSLATargets)

	got, err := f.GetSDWANRule(id)
	if err != nil || sameSLASet(slaKeySet(got.RequiredSLATargets), want) {
		return nil //nolint:nilerr // a read-back failure must not fail a write that succeeded
	}

	if err := sdwanServiceTable.Update(f, strconv.Itoa(id), payload); err != nil {
		return err
	}
	if got, err = f.GetSDWANRule(id); err == nil && !sameSLASet(slaKeySet(got.RequiredSLATargets), want) {
		return fmt.Errorf(
			"the device kept SLA targets that were not requested (%s) — a rule's last SLA target cannot be removed",
			strings.Join(slaKeyList(got.RequiredSLATargets), ", "))
	}
	return nil
}

func slaKeySet(targets []SDWANRuleSLATarget) map[string]bool {
	out := make(map[string]bool, len(targets))
	for _, t := range targets {
		out[t.HealthCheck+"#"+strconv.Itoa(t.ID)] = true
	}
	return out
}

func slaKeyList(targets []SDWANRuleSLATarget) []string {
	out := make([]string, 0, len(targets))
	for _, t := range targets {
		out = append(out, t.HealthCheck+"#"+strconv.Itoa(t.ID))
	}
	return out
}

func sameSLASet(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

// DeleteSDWANRule removes one rule BY MKEY. Never the collection.
func (f *FortiClient) DeleteSDWANRule(id int) error {
	if id <= 0 {
		return fmt.Errorf("refusing to delete: no rule id given")
	}
	return sdwanServiceTable.Delete(f, strconv.Itoa(id))
}

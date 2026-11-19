package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sdwanHealthCheckTable = cmdbPath{path: "system/sdwan/health-check", noun: "performance SLA"}

// Performance SLAs — system/sdwan/health-check, the FortiGate "New Performance SLA" dialog.
//
// A health check is a probe: the firewall repeatedly reaches a server over each SD-WAN member and
// measures what came back. Two separate things hang off that, and the dialog keeps them apart:
//
//	Link Status  — is this member usable AT ALL (failtime / recoverytime), and what to do when it
//	               is not (update-static-route).
//	SLA Target   — is this member GOOD ENOUGH (latency / jitter / packet loss thresholds), which is
//	               what an SD-WAN rule in "Lowest cost (SLA)" or "Maximize bandwidth" selects on.
//
// Everything below was verified live on 10.0.99.201 (FGT80E v7.2.10) — create, read, update,
// delete, then the device confirmed back to its original six default checks.
//
// ── The five things the device does that a naive mapping gets wrong ──────────
//
//  1. `server` IS MANDATORY ON CREATE, except in passive mode.
//     POST without it → `Attribute 'server' MUST be set.` / -56, even for protocol ping whose
//     schema default is "". Probe mode Passive is the one exception: it never sends a packet, so
//     the device neither requires a server nor keeps one you send (it reads back "").
//
//  2. `server` IS A LIST OF AT MOST TWO, stored as ONE space-separated, quoted string.
//     Sent as `1.1.1.1 8.8.8.8`, it reads back as `"1.1.1.1" "8.8.8.8"`. A third entry is
//     refused: `too many argument to set 3, 2`. That is the `+` button in the dialog's Server row.
//
//  3. AN EMPTY `server` IS A NO-OP, NOT A CLEAR. `{"server": ""}` returns 200 and leaves the
//     previous value in place. A server list can be replaced but never emptied over REST, so this
//     file sends the field only when there is something to send — writing "" would look like a
//     clear in the diff and change nothing on the box.
//
//  4. PASSIVE MODE SILENTLY DISCARDS THE LINK STATUS FIELDS. With detect-mode passive, a PUT
//     carrying failtime/recoverytime/update-static-route returns 200 and reads back unchanged, and
//     update-static-route/update-cascade-interface flip themselves to disable. That is why the
//     dialog hides the Link Status and Actions when Inactive sections in Passive — and why the
//     payload below omits them rather than pretending they were saved.
//
//  5. UNLIKE THE RULE'S `sla` TABLE, THIS ONE REPLACES CLEANLY. system/sdwan/service needs a
//     read-back and a second PUT to converge (see fortigate_sdwan_rule.go); health-check does not.
//     Measured: sla=[1,2] → PUT sla=[3] → reads back exactly [3], and `sla: []` really empties it.
//     So there is no reconcile here, deliberately.
//
// ── One more, on the SLA row itself ──────────────────────────────────────────
// `link-cost-factor` is a multi-value option ("latency jitter packet-loss") and it decides which
// thresholds MEAN anything: setting it to "packet-loss" alone resets latency-threshold to its
// default 5. That is exactly the dialog's per-threshold toggles, so this file carries the factor
// as a SET rather than a string — the two ends then agree on what a toggle is.
//
// This cuts both ways. A live full-system check found the inverse of the latency example above:
// PUTting a new `packetloss_threshold` while "packet-loss" is NOT in that row's active
// `link-cost-factor` set is accepted with 200 and silently discarded — the field reads back
// unchanged, same as every other inactive factor's threshold would. Not a bug in this file; it is
// the device enforcing "you may only tune what the toggle has turned on", consistent with point 4
// above for passive mode. A caller editing a threshold must include its factor in the same write.

const sdwanHealthPath = sdwanPath + "/health-check"

// ── Types ────────────────────────────────────────────────────────────────────

// SDWANSLARow is one numbered SLA target inside a health check (the `sla` sub-table).
type SDWANSLARow struct {
	ID int `json:"id"`
	// LinkCostFactor is the criteria set, exploded: "latency", "jitter", "packet-loss", "mos".
	LinkCostFactor      []string `json:"link_cost_factor"`
	LatencyThreshold    int      `json:"latency_threshold"`
	JitterThreshold     int      `json:"jitter_threshold"`
	PacketLossThreshold int      `json:"packetloss_threshold"`
	// MOSThreshold is a decimal string on the device ("3.6"), not a number — kept as one so a
	// check that selects on MOS survives an edit made through the three-threshold dialog.
	MOSThreshold string `json:"mos_threshold"`
}

// SDWANHealthLive is what the device currently measures for one member of one check.
//
// Only `status` was observable here: SD-WAN is off on the lab device, so monitor/virtual-wan/
// health-check answers `{"Default_AWS": {}}` for every check. The three measurements are read
// leniently — present when the device sends them, absent (not zero) when it does not — because a
// zero latency printed next to a member that was never probed is a lie the UI cannot detect.
type SDWANHealthLive struct {
	Interface  string   `json:"interface"`
	Status     string   `json:"status,omitempty"`
	Latency    *float64 `json:"latency,omitempty"`
	Jitter     *float64 `json:"jitter,omitempty"`
	PacketLoss *float64 `json:"packet_loss,omitempty"`
}

// SDWANHealthCheck is the "New Performance SLA" dialog, GUI-shaped.
type SDWANHealthCheck struct {
	Name string `json:"name"`
	// DetectMode is the dialog's "Probe mode": active | passive | prefer-passive.
	DetectMode string `json:"detect_mode"`
	// Protocol is the dialog's "Protocol": ping | http | dns. The CMDB also accepts tcp-echo,
	// udp-echo, twamp, tcp-connect and ftp; the dialog offers three, and so does this console.
	Protocol string `json:"protocol"`
	// Servers is the dialog's Server rows — at most two (see note 2 above).
	Servers []string `json:"servers"`
	// SystemDNS is the DNS Server choice: true = "Same as System DNS", false = "Specify".
	SystemDNS bool `json:"system_dns"`
	Port      int  `json:"port"`

	// Members is the dialog's Participants: SD-WAN member SEQUENCE NUMBERS, not interface names —
	// the CMDB child table's mkey is seq-num. Empty means "All SD-WAN Members".
	Members []int `json:"members"`
	// MemberNames is those sequence numbers resolved to interfaces, for display only.
	MemberNames []string `json:"member_names"`

	// SLA is the "SLA Target" section: empty means the toggle is off.
	SLA []SDWANSLARow `json:"sla"`

	// Link Status
	Interval     int `json:"interval"`      // ms — "Check interval"
	ProbeTimeout int `json:"probe_timeout"` // ms — not in the dialog, reported for completeness
	Failtime     int `json:"failtime"`      // "Failures before inactive"
	Recoverytime int `json:"recoverytime"`  // "Restore link after"

	// Actions when Inactive
	UpdateStaticRoute      bool `json:"update_static_route"`
	UpdateCascadeInterface bool `json:"update_cascade_interface"`

	// SystemDNSServers is system/dns, filled in only when SystemDNS is on — the dialog shows the
	// resolvers it will actually use rather than the words "system DNS".
	SystemDNSServers []string `json:"system_dns_servers,omitempty"`
	// Live is the runtime state per member, joined from monitor/virtual-wan/health-check.
	Live []SDWANHealthLive `json:"live,omitempty"`
}

// ── Reads ────────────────────────────────────────────────────────────────────

type fgSDWANHealthCheck struct {
	Name         string `json:"name"`
	Protocol     string `json:"protocol"`
	Server       string `json:"server"`
	Port         int    `json:"port"`
	Interval     int    `json:"interval"`
	ProbeTimeout int    `json:"probe-timeout"`
	Failtime     int    `json:"failtime"`
	Recoverytime int    `json:"recoverytime"`
	SystemDNS    string `json:"system-dns"`
	DetectMode   string `json:"detect-mode"`

	UpdateStaticRoute      string `json:"update-static-route"`
	UpdateCascadeInterface string `json:"update-cascade-interface"`

	Members []struct {
		SeqNum int `json:"seq-num"`
	} `json:"members"`

	SLA []struct {
		ID                  int    `json:"id"`
		LinkCostFactor      string `json:"link-cost-factor"`
		LatencyThreshold    int    `json:"latency-threshold"`
		JitterThreshold     int    `json:"jitter-threshold"`
		PacketLossThreshold int    `json:"packetloss-threshold"`
		MOSThreshold        string `json:"mos-threshold"`
	} `json:"sla"`
}

// GetSDWANHealthChecks reads the Performance SLAs tab.
//
// The CMDB read is the one that must succeed: a firewall we could not read must never render as
// "there are no performance SLAs". The three enrichments — runtime, member names, system DNS — are
// each best-effort, because a missing measurement is a blank cell while a missing check is a lie.
func (f *FortiClient) GetSDWANHealthChecks() ([]SDWANHealthCheck, error) {
	return f.readSDWANHealthChecks(sdwanHealthPath)
}

// GetSDWANHealthCheck reads one check by mkey, for the edit form.
func (f *FortiClient) GetSDWANHealthCheck(name string) (SDWANHealthCheck, error) {
	if strings.TrimSpace(name) == "" {
		return SDWANHealthCheck{}, fmt.Errorf("no performance SLA name given")
	}
	list, err := f.readSDWANHealthChecks(sdwanHealthPath + "/" + url.PathEscape(name))
	if err != nil {
		return SDWANHealthCheck{}, err
	}
	if len(list) == 0 {
		return SDWANHealthCheck{}, fmt.Errorf("no performance SLA named %q on this device", name)
	}
	return list[0], nil
}

func (f *FortiClient) readSDWANHealthChecks(path string) ([]SDWANHealthCheck, error) {
	var (
		resp    *fgAPIResponse
		err     error
		live    map[string][]SDWANHealthLive
		names   map[int]string
		dnsSrvs []string
	)
	Parallel(
		func() { resp, err = f.do("GET", path, nil) },
		func() { live = f.sdwanHealthRuntime() },
		func() { names = f.sdwanMemberNames() },
		func() { dnsSrvs = f.systemDNSServers() },
	)
	if err != nil {
		return nil, err
	}

	var rows []fgSDWANHealthCheck
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("decode sdwan health checks: %w", err)
	}

	out := make([]SDWANHealthCheck, 0, len(rows))
	seqs := make([]int, 0, 8)
	for _, r := range rows {
		seqs = seqs[:0]
		h := SDWANHealthCheck{
			Name:       r.Name,
			DetectMode: r.DetectMode,
			Protocol:   r.Protocol,
			Servers:    parseFGQuotedList(r.Server),
			SystemDNS:  FGStringToBool(r.SystemDNS),
			Port:       r.Port,

			SLA: make([]SDWANSLARow, 0, len(r.SLA)),

			Interval:     r.Interval,
			ProbeTimeout: r.ProbeTimeout,
			Failtime:     r.Failtime,
			Recoverytime: r.Recoverytime,

			UpdateStaticRoute:      FGStringToBool(r.UpdateStaticRoute),
			UpdateCascadeInterface: FGStringToBool(r.UpdateCascadeInterface),

			Live: live[r.Name],
		}
		for _, m := range r.Members {
			seqs = append(seqs, m.SeqNum)
		}
		h.Members, h.MemberNames = sdwanHealthParticipants(seqs, names)
		seqs = seqs[:0]
		for _, s := range r.SLA {
			h.SLA = append(h.SLA, SDWANSLARow{
				ID:                  s.ID,
				LinkCostFactor:      strings.Fields(s.LinkCostFactor),
				LatencyThreshold:    s.LatencyThreshold,
				JitterThreshold:     s.JitterThreshold,
				PacketLossThreshold: s.PacketLossThreshold,
				MOSThreshold:        s.MOSThreshold,
			})
		}
		if h.SystemDNS {
			h.SystemDNSServers = dnsSrvs
		}
		out = append(out, h)
	}
	return out, nil
}

// ── Writes ───────────────────────────────────────────────────────────────────

func (f *FortiClient) CreateSDWANHealthCheck(h SDWANHealthCheck) error {
	err := sdwanHealthCheckTable.Create(f, sdwanHealthCheckPayload(h, true))
	return err
}

func (f *FortiClient) UpdateSDWANHealthCheck(name string, h SDWANHealthCheck) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("refusing to update: no performance SLA name given")
	}
	err := sdwanHealthCheckTable.Update(f, name, sdwanHealthCheckPayload(h, false))
	return err
}

// DeleteSDWANHealthCheck removes one check BY MKEY. A DELETE at the collection URL would empty the
// whole table — the same mistake that once wiped every policy on this lab device.
func (f *FortiClient) DeleteSDWANHealthCheck(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("refusing to delete: no performance SLA name given")
	}
	return sdwanHealthCheckTable.Delete(f, name)
}

// sdwanHealthCheckPayload builds the CMDB body.
//
// It sends only what the chosen probe mode owns. Passive measures traffic that is already flowing,
// so it has no server, no protocol timing and no link-status thresholds — and the device proves the
// point by accepting those fields with a 200 and discarding them. Sending them anyway would make
// the form claim to have saved settings that never landed.
func sdwanHealthCheckPayload(h SDWANHealthCheck, create bool) map[string]interface{} {
	mode := strings.TrimSpace(h.DetectMode)
	if mode == "" {
		mode = "active"
	}
	passive := mode == "passive"

	p := map[string]interface{}{
		"detect-mode": mode,
		"members":     sdwanHealthMemberRefs(h.Members),
		"sla":         sdwanHealthSLARows(h.SLA),
	}
	// The mkey travels in the URL on an update. Sending it there too would turn a save into a
	// rename the moment the form's name field drifted from the row it was loaded from.
	if create {
		p["name"] = strings.TrimSpace(h.Name)
	}

	if passive {
		return p
	}

	protocol := strings.TrimSpace(h.Protocol)
	if protocol == "" {
		protocol = "ping"
	}
	p["protocol"] = protocol
	// system-dns is a DNS-probe setting; leaving it enabled after a switch to ping would make the
	// device probe something the form no longer shows.
	useSystemDNS := h.SystemDNS && protocol == "dns"
	p["system-dns"] = FGBoolToString(useSystemDNS)

	// Only when there is something to send: `""` is a no-op on this field, so writing it would
	// record an intent the device never carried out (see note 3 at the top).
	if servers := trimmedNonEmpty(h.Servers); len(servers) > 0 {
		p["server"] = strings.Join(servers, " ")
	}

	p["interval"] = h.Interval
	p["failtime"] = h.Failtime
	p["recoverytime"] = h.Recoverytime
	p["update-static-route"] = FGBoolToString(h.UpdateStaticRoute)
	return p
}

// sdwanHealthMemberRefs builds the Participants list. An EMPTY SLICE is sent, not omitted: that is
// how "All SD-WAN Members" is expressed, and omitting it would leave a previous selection standing.
func sdwanHealthMemberRefs(seqNums []int) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(seqNums))
	seen := map[int]bool{}
	for _, n := range seqNums {
		if n <= 0 || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, map[string]interface{}{"seq-num": n})
	}
	return out
}

// sdwanHealthSLARows builds the `sla` sub-table. An empty slice really does clear it here.
func sdwanHealthSLARows(rows []SDWANSLARow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		factors := trimmedNonEmpty(r.LinkCostFactor)
		row := map[string]interface{}{
			"id":                   r.ID,
			"link-cost-factor":     strings.Join(factors, " "),
			"latency-threshold":    r.LatencyThreshold,
			"jitter-threshold":     r.JitterThreshold,
			"packetloss-threshold": r.PacketLossThreshold,
		}
		// mos-threshold is a string field; sending "" would be rejected, and it only matters to a
		// row that actually selects on MOS.
		if mos := strings.TrimSpace(r.MOSThreshold); mos != "" && containsString(factors, "mos") {
			row["mos-threshold"] = mos
		}
		out = append(out, row)
	}
	return out
}

// ── Runtime and lookups ──────────────────────────────────────────────────────

// sdwanHealthRuntime reads monitor/virtual-wan/health-check: check name → interface → measurements.
//
// The inner object's keys are read leniently. On this device SD-WAN is off and every check comes
// back as `{}`, so `status` is the only key that was ever observed — the rest are read under the
// spellings FortiOS uses when a check is actually running, and simply stay absent otherwise.
func (f *FortiClient) sdwanHealthRuntime() map[string][]SDWANHealthLive {
	resp, err := f.do("GET", "/api/v2/monitor/virtual-wan/health-check", nil)
	if err != nil {
		return nil
	}
	var raw map[string]map[string]map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &raw) != nil {
		return nil
	}
	out := make(map[string][]SDWANHealthLive, len(raw))
	for check, ifaces := range raw {
		rows := make([]SDWANHealthLive, 0, len(ifaces))
		for iface, fields := range ifaces {
			rows = append(rows, SDWANHealthLive{
				Interface:  iface,
				Status:     rawString(fields["status"]),
				Latency:    rawFloat(fields["latency"]),
				Jitter:     rawFloat(fields["jitter"]),
				PacketLoss: firstFloat(fields, "packet_loss", "packetloss"),
			})
		}
		if len(rows) > 0 {
			sortHealthLive(rows)
			out[check] = rows
		}
	}
	return out
}

// sdwanMemberNames maps SD-WAN member sequence numbers to their interface, so Participants can be
// shown the way the dialog shows them while the CMDB keeps storing sequence numbers.
func (f *FortiClient) sdwanMemberNames() map[int]string {
	resp, err := f.do("GET", sdwanPath+"/members", nil)
	if err != nil {
		return nil
	}
	var rows []struct {
		SeqNum    int    `json:"seq-num"`
		Interface string `json:"interface"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	out := make(map[int]string, len(rows))
	for _, r := range rows {
		out[r.SeqNum] = r.Interface
	}
	return out
}

// systemDNSServers reads the resolvers the "Same as System DNS" option points at.
func (f *FortiClient) systemDNSServers() []string {
	resp, err := f.do("GET", "/api/v2/cmdb/system/dns", nil)
	if err != nil {
		return nil
	}
	var d struct {
		Primary   string `json:"primary"`
		Secondary string `json:"secondary"`
	}
	if json.Unmarshal(resp.Results, &d) != nil {
		return nil
	}
	// 0.0.0.0 is how the device says "not configured"; printing it as a resolver would be wrong.
	out := []string{}
	for _, s := range []string{d.Primary, d.Secondary} {
		if s = strings.TrimSpace(s); s != "" && s != "0.0.0.0" {
			out = append(out, s)
		}
	}
	return out
}

// ── Small helpers ────────────────────────────────────────────────────────────

// parseFGQuotedList splits the CMDB's multi-value string form.
//
// The device stores `set server 1.1.1.1 8.8.8.8` and reads it back as `"1.1.1.1" "8.8.8.8"` — one
// string carrying a list, with quotes that are part of the encoding and not part of the value.
// A single unquoted value ("" from a check that has none) must come back as an empty list, not as
// a list holding one empty string.
func parseFGQuotedList(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return []string{}
	}
	out := []string{}
	var cur strings.Builder
	inQuote := false
	flush := func() {
		if v := strings.TrimSpace(cur.String()); v != "" {
			out = append(out, v)
		}
		cur.Reset()
	}
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
			if !inQuote {
				flush()
			}
		case r == ' ' && !inQuote:
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}

func trimmedNonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if v := strings.TrimSpace(s); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func containsString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// rawFloat unwraps a JSON number the device may have sent as a number or as a quoted string.
// Returns nil when the key was absent or unparseable — absent is NOT zero here.
func rawFloat(raw json.RawMessage) *float64 {
	s := rawString(raw)
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &v
}

func firstFloat(fields map[string]json.RawMessage, keys ...string) *float64 {
	for _, k := range keys {
		if v := rawFloat(fields[k]); v != nil {
			return v
		}
	}
	return nil
}

// sortHealthLive keeps the per-member rows in a stable order — a Go map iterates randomly, and a
// list that reshuffles itself on every poll is unreadable.
func sortHealthLive(rows []SDWANHealthLive) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].Interface < rows[j-1].Interface; j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// SDWANHealthCheckServers maps each existing check to the servers it probes.
//
// It exists for one device rule that no schema mentions: TWO HEALTH CHECKS MAY NOT PROBE THE SAME
// SERVER. The firewall answers a second one with
//
//	Server 1.1.1.1 is duplicated in the New_SLA and Existing_SLA
//	object set operator error, -7 discard the setting
//
// and that is also why the six checks it ships with all point at different hosts. Knowing the map
// before writing lets the console name the offending check instead of forwarding a -7.
//
// A deliberately thin read — just the table, no runtime and no enrichment — because it runs on the
// path of every create and update.
func (f *FortiClient) SDWANHealthCheckServers() (map[string][]string, error) {
	resp, err := f.do("GET", sdwanHealthPath, nil)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Name   string `json:"name"`
		Server string `json:"server"`
	}
	if err := json.Unmarshal(resp.Results, &rows); err != nil {
		return nil, fmt.Errorf("decode sdwan health checks: %w", err)
	}
	out := make(map[string][]string, len(rows))
	for _, r := range rows {
		out[r.Name] = parseFGQuotedList(r.Server)
	}
	return out, nil
}

// sdwanHealthParticipants turns the check's member sequence numbers into the pair the UI needs.
//
// SEQ-NUM 0 IS NOT A MEMBER. It is how the device writes "All SD-WAN Members", and it appears on
// its own: a CREATE that sends `members: []` reads back as `[{"seq-num": 0}]`, while an UPDATE
// sending the same reads back as `[]`. Carried through, it turns "every member" into a participant
// called "#0" the moment a check is first saved — which is exactly what happened the first time
// this ran against the real firewall.
func sdwanHealthParticipants(seqNums []int, names map[int]string) ([]int, []string) {
	members := make([]int, 0, len(seqNums))
	labels := make([]string, 0, len(seqNums))
	for _, seq := range seqNums {
		if seq <= 0 {
			continue
		}
		members = append(members, seq)
		if n, ok := names[seq]; ok {
			labels = append(labels, n)
		} else {
			// A member the check names but system/sdwan no longer has. Showing the bare sequence
			// number beats dropping the row and making the participant list look shorter than it is.
			labels = append(labels, "#"+strconv.Itoa(seq))
		}
	}
	return members, labels
}

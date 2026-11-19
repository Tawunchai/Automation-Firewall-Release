package services

import (
	"encoding/json"
	"fmt"
	"network_automation/services/platform"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sdwanMembersTable = cmdbPath{path: "system/sdwan/members", noun: "members"}

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var sdwanZoneTable = cmdbPath{path: "system/sdwan/zone", noun: "SD-WAN zone"}
var sdwanMemberTable = cmdbPath{path: "system/sdwan/members", noun: "SD-WAN member"}

// SD-WAN — Network ▸ SD-WAN, mirroring the FortiGate GUI's three tabs.
//
// LAYOUT OF THE CMDB OBJECT, verified live on 10.0.99.201 (FGT80E v7.2.10):
// `system/sdwan` is a **complex** object, not a table — one settings blob with five child TABLES
// hanging off it, each addressable on its own URL:
//
//	/api/v2/cmdb/system/sdwan/zone          mkey name      → the "SD-WAN Zones" rows
//	/api/v2/cmdb/system/sdwan/members       mkey seq-num   → the interfaces inside those zones
//	/api/v2/cmdb/system/sdwan/service       mkey id        → the "SD-WAN Rules" tab
//	/api/v2/cmdb/system/sdwan/health-check  mkey name      → the "Performance SLAs" tab
//	/api/v2/cmdb/system/sdwan/neighbor, /duplication       (not surfaced yet)
//
// Full CRUD on zone and members was exercised against the real device (create → read → update →
// delete by mkey, then the box confirmed back to its original state over SSH). The parent object
// carries `status` (the global SD-WAN on/off) and `load-balance-mode`, which this file reads but
// deliberately does not write: flipping SD-WAN on is a routing change, not a form field.
//
// ── The runtime half ─────────────────────────────────────────────────────────
// `monitor/virtual-wan/members` is keyed by INTERFACE NAME (not seq-num) and, on a device whose
// SD-WAN is off, answers `{"wan2": {"status": "error"}}` — observed by adding a real member and
// reading it back. `status` is therefore the one runtime key this file names; everything else the
// endpoint may carry on a device with SD-WAN actually running was NOT observable here, so it is
// passed through verbatim in Runtime rather than mapped to invented field names.
//
// The numbers the GUI's Bandwidth and Volume charts show come from a source that IS fully
// verifiable today: `monitor/system/interface`, which reports rx_bytes / tx_bytes / speed / link
// per interface. Volume is those counters; bandwidth is their rate, measured between two polls
// (see sdwanRateCache) rather than guessed from a link speed.

const sdwanPath = "/api/v2/cmdb/system/sdwan"

// ── Types ────────────────────────────────────────────────────────────────────

// SDWANZone is one row of the SD-WAN Zones table.
type SDWANZone struct {
	Name string `json:"name"`
	// service-sla-tie-break: which member wins when several meet the SLA equally.
	ServiceSLATieBreak string `json:"service_sla_tie_break"`
	// MemberCount is derived, not stored — the GUI shows members nested under their zone.
	MemberCount int `json:"member_count"`
}

// SDWANMember is one interface inside a zone, config plus whatever the device reports about it.
type SDWANMember struct {
	SeqNum      int    `json:"seq_num"`
	Interface   string `json:"interface"`
	Zone        string `json:"zone"`
	Gateway     string `json:"gateway"`
	Source      string `json:"source"`
	Cost        int    `json:"cost"`
	Weight      int    `json:"weight"`
	Priority    int    `json:"priority"`
	VolumeRatio int    `json:"volume_ratio"`
	Status      bool   `json:"status"`
	Comment     string `json:"comment"`

	// ── runtime, joined on Interface ──
	//
	// Every one is a POINTER, and that is the whole point: `omitempty` on a plain number drops a
	// genuine zero, so an interface that really has passed 0 bytes would arrive looking exactly
	// like one the device never mentioned — and the UI, which is built on "absent is not zero",
	// would print "—" for a measurement that was actually taken.
	Link    *bool    `json:"link,omitempty"`
	Speed   *float64 `json:"speed,omitempty"`    // Mbps, as monitor/system/interface reports it
	RxBytes *uint64  `json:"rx_bytes,omitempty"` // cumulative — the Volume chart
	TxBytes *uint64  `json:"tx_bytes,omitempty"`
	// Download/Upload are bits per second, MEASURED between two polls. nil until a second poll
	// exists, because one counter reading cannot produce a rate.
	DownloadBps *float64 `json:"download_bps,omitempty"`
	UploadBps   *float64 `json:"upload_bps,omitempty"`
	// HealthStatus is monitor/virtual-wan/members[interface].status — the only key on that object
	// this device would show. "" when SD-WAN reports nothing for the interface.
	HealthStatus string `json:"health_status,omitempty"`
	// Runtime is that same object, untouched. Anything a running SD-WAN adds shows up here without
	// this file pretending to know its name.
	Runtime map[string]json.RawMessage `json:"runtime,omitempty"`
}

// SDWANOverview is the whole SD-WAN Zones tab in one read.
type SDWANOverview struct {
	Enabled         bool          `json:"enabled"` // system/sdwan status
	LoadBalanceMode string        `json:"load_balance_mode"`
	Zones           []SDWANZone   `json:"zones"`
	Members         []SDWANMember `json:"members"`
}

// ── Reads ────────────────────────────────────────────────────────────────────

type fgSDWANRoot struct {
	Status          string `json:"status"`
	LoadBalanceMode string `json:"load-balance-mode"`
	Zone            []struct {
		Name               string `json:"name"`
		ServiceSLATieBreak string `json:"service-sla-tie-break"`
	} `json:"zone"`
	Members []fgSDWANMember `json:"members"`
}

type fgSDWANMember struct {
	SeqNum      int    `json:"seq-num"`
	Interface   string `json:"interface"`
	Zone        string `json:"zone"`
	Gateway     string `json:"gateway"`
	Source      string `json:"source"`
	Cost        int    `json:"cost"`
	Weight      int    `json:"weight"`
	Priority    int    `json:"priority"`
	VolumeRatio int    `json:"volume-ratio"`
	Status      string `json:"status"`
	Comment     string `json:"comment"`
}

// GetSDWAN reads the SD-WAN Zones tab: config from the CMDB, runtime joined on top.
//
// The three probes run together and each is best-effort EXCEPT the CMDB one — a firewall we could
// not read must not render as "SD-WAN has no zones", which would read as "nothing is configured".
func (f *FortiClient) GetSDWAN() (SDWANOverview, error) {
	resp, err := f.do("GET", sdwanPath, nil)
	if err != nil {
		return SDWANOverview{}, err
	}
	var root fgSDWANRoot
	if err := json.Unmarshal(resp.Results, &root); err != nil {
		return SDWANOverview{}, fmt.Errorf("decode system/sdwan: %w", err)
	}

	var (
		ifStats   map[string]fgInterfaceStats
		memberRun map[string]map[string]json.RawMessage
	)
	Parallel(
		func() { ifStats = f.interfaceStats() },
		func() { memberRun = f.sdwanMemberRuntime() },
	)

	out := SDWANOverview{
		Enabled:         strings.EqualFold(root.Status, "enable"),
		LoadBalanceMode: root.LoadBalanceMode,
		Zones:           make([]SDWANZone, 0, len(root.Zone)),
		Members:         make([]SDWANMember, 0, len(root.Members)),
	}

	perZone := map[string]int{}
	for _, m := range root.Members {
		perZone[m.Zone]++
	}
	for _, z := range root.Zone {
		out.Zones = append(out.Zones, SDWANZone{
			Name:               z.Name,
			ServiceSLATieBreak: z.ServiceSLATieBreak,
			MemberCount:        perZone[z.Name],
		})
	}

	rates := sdwanRates.sample(f.BaseURL, ifStats)
	for _, m := range root.Members {
		mem := SDWANMember{
			SeqNum: m.SeqNum, Interface: m.Interface, Zone: m.Zone,
			Gateway: m.Gateway, Source: m.Source,
			Cost: m.Cost, Weight: m.Weight, Priority: m.Priority,
			VolumeRatio: m.VolumeRatio,
			Status:      FGStringToBool(m.Status),
			Comment:     m.Comment,
		}
		if st, ok := ifStats[m.Interface]; ok {
			link, speed, rx, tx := st.Link, st.Speed, st.RxBytes, st.TxBytes
			mem.Link = &link
			mem.Speed = &speed
			mem.RxBytes = &rx
			mem.TxBytes = &tx
		}
		if r, ok := rates[m.Interface]; ok {
			down, up := r.DownBps, r.UpBps
			mem.DownloadBps = &down
			mem.UploadBps = &up
		}
		if run, ok := memberRun[m.Interface]; ok {
			mem.Runtime = run
			mem.HealthStatus = rawString(run["status"])
		}
		out.Members = append(out.Members, mem)
	}
	return out, nil
}

// ── Writes: zones ────────────────────────────────────────────────────────────

func (f *FortiClient) CreateSDWANZone(z SDWANZone) error {
	_, err := f.do("POST", sdwanPath+"/zone", sdwanZonePayload(z))
	return err
}

func (f *FortiClient) UpdateSDWANZone(name string, z SDWANZone) error {
	err := sdwanZoneTable.Update(f, name, sdwanZonePayload(z))
	return err
}

// DeleteSDWANZone removes one zone BY MKEY — never the collection, which would empty the table.
func (f *FortiClient) DeleteSDWANZone(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("refusing to delete: no zone name given")
	}
	return sdwanZoneTable.Delete(f, name)
}

func sdwanZonePayload(z SDWANZone) map[string]interface{} {
	p := map[string]interface{}{"name": strings.TrimSpace(z.Name)}
	if tb := strings.TrimSpace(z.ServiceSLATieBreak); tb != "" {
		p["service-sla-tie-break"] = tb
	}
	return p
}

// ── Writes: members ──────────────────────────────────────────────────────────

func (f *FortiClient) CreateSDWANMember(m SDWANMember) error {
	_, err := f.do("POST", sdwanPath+"/members", sdwanMemberPayload(m))
	return err
}

func (f *FortiClient) UpdateSDWANMember(seqNum int, m SDWANMember) error {
	err := sdwanMembersTable.Update(f, strconv.Itoa(seqNum), sdwanMemberPayload(m))
	return err
}

func (f *FortiClient) DeleteSDWANMember(seqNum int) error {
	if seqNum <= 0 {
		return fmt.Errorf("refusing to delete: no member sequence number given")
	}
	return sdwanMemberTable.Delete(f, strconv.Itoa(seqNum))
}

// sdwanMemberPayload builds the CMDB body for a member.
//
// seq-num is included only when the caller set one: on a create, letting the device allocate the
// next free number is what the GUI does, and a hard-coded one collides the moment two members are
// added. Gateway/source are sent even when 0.0.0.0 — that is the field's documented "unset" value,
// and omitting them on an update would leave a previous gateway in place.
func sdwanMemberPayload(m SDWANMember) map[string]interface{} {
	p := map[string]interface{}{
		"interface": strings.TrimSpace(m.Interface),
		"zone":      strings.TrimSpace(m.Zone),
		"gateway":   defaultIPv4(m.Gateway),
		"source":    defaultIPv4(m.Source),
		"cost":      m.Cost,
		"weight":    m.Weight,
		"priority":  m.Priority,
		"status":    FGBoolToString(m.Status),
		"comment":   platform.TruncateUTF8(m.Comment, 255),
	}
	if m.SeqNum > 0 {
		p["seq-num"] = m.SeqNum
	}
	if m.VolumeRatio > 0 {
		p["volume-ratio"] = m.VolumeRatio
	}
	return p
}

func defaultIPv4(s string) string {
	if strings.TrimSpace(s) == "" {
		return "0.0.0.0"
	}
	return strings.TrimSpace(s)
}

// ── Runtime probes ───────────────────────────────────────────────────────────

// fgInterfaceStats is the slice of monitor/system/interface this page uses. Field names verified
// live: {"link":true,"speed":1000.0,"rx_bytes":…,"tx_bytes":…}.
type fgInterfaceStats struct {
	Link    bool    `json:"link"`
	Speed   float64 `json:"speed"`
	RxBytes uint64  `json:"rx_bytes"`
	TxBytes uint64  `json:"tx_bytes"`
}

// interfaceStats reads per-interface counters. Best-effort: a failure leaves the members' runtime
// columns empty rather than failing the page, because the CONFIG is what the page is chiefly about.
func (f *FortiClient) interfaceStats() map[string]fgInterfaceStats {
	resp, err := f.do("GET", "/api/v2/monitor/system/interface", nil)
	if err != nil {
		return nil
	}
	var m map[string]fgInterfaceStats
	if json.Unmarshal(resp.Results, &m) != nil {
		return nil
	}
	return m
}

// sdwanMemberRuntime reads monitor/virtual-wan/members — an object keyed by INTERFACE NAME.
func (f *FortiClient) sdwanMemberRuntime() map[string]map[string]json.RawMessage {
	resp, err := f.do("GET", "/api/v2/monitor/virtual-wan/members", nil)
	if err != nil {
		return nil
	}
	var m map[string]map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &m) != nil {
		return nil
	}
	return m
}

// rawString unwraps a JSON scalar into a string without caring whether it was quoted.
func rawString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

// ── Bandwidth: a measured rate, not a guessed one ────────────────────────────
//
// monitor/system/interface reports CUMULATIVE byte counters. A rate needs two readings, so the
// previous one is kept per device and the delta divided by the elapsed time. The consequence is
// deliberate and visible in the UI: the first load of the page shows no bandwidth, and the second
// shows a real measurement. That is the honest version — the alternative, printing the link speed
// or a zero, states a throughput nobody measured.
//
// Counters reset when an interface bounces or the device reboots, so a NEGATIVE delta is dropped
// rather than reported as a huge spike.

type sdwanRate struct {
	DownBps float64
	UpBps   float64
}

type sdwanSample struct {
	at    time.Time
	stats map[string]fgInterfaceStats
}

type sdwanRateStore struct {
	mu      sync.Mutex
	samples map[string]sdwanSample
}

var sdwanRates = &sdwanRateStore{samples: map[string]sdwanSample{}}

// sdwanStaleSample is how old a previous reading may be and still produce a meaningful rate.
// Beyond this the average is over so long a window that a burst and a quiet hour look alike.
const sdwanStaleSample = 5 * time.Minute

// sample stores the current counters for key and returns the rates implied since the last call.
func (s *sdwanRateStore) sample(key string, stats map[string]fgInterfaceStats) map[string]sdwanRate {
	if len(stats) == 0 {
		return nil
	}
	now := time.Now()

	s.mu.Lock()
	prev, had := s.samples[key]
	s.samples[key] = sdwanSample{at: now, stats: stats}
	s.mu.Unlock()

	if !had {
		return nil
	}
	elapsed := now.Sub(prev.at).Seconds()
	if elapsed <= 0 || now.Sub(prev.at) > sdwanStaleSample {
		return nil
	}

	out := make(map[string]sdwanRate, len(stats))
	for name, cur := range stats {
		old, ok := prev.stats[name]
		if !ok || cur.RxBytes < old.RxBytes || cur.TxBytes < old.TxBytes {
			continue // new interface, or the counters wrapped/reset
		}
		out[name] = sdwanRate{
			DownBps: float64(cur.RxBytes-old.RxBytes) * 8 / elapsed,
			UpBps:   float64(cur.TxBytes-old.TxBytes) * 8 / elapsed,
		}
	}
	return out
}

// resetSDWANRates drops every stored sample. Test seam only.
func resetSDWANRates() {
	sdwanRates.mu.Lock()
	sdwanRates.samples = map[string]sdwanSample{}
	sdwanRates.mu.Unlock()
}

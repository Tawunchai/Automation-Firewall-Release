package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// FortiGate "System > Dashboard > Status" data — everything the device's own dashboard
// widgets show, read from the FortiOS **monitor** API (not CMDB).
//
// Endpoint map, all verified live against the lab FGT80E on FortiOS 7.2.10:
//
//	monitor/system/status              model_name / model_number / hostname / serial / version / build
//	monitor/system/firmware            current firmware: build, maturity ("M"), release-type, and
//	                                   the available upgrade list
//	monitor/system/time                device clock as a UTC epoch (confirmed: equals real UTC,
//	                                   NOT device-local — the offset has to be applied separately)
//	monitor/system/timezone            id → name + current UTC offset (DST-aware); the id matches
//	                                   cmdb system/global "timezone"
//	monitor/system/resource/usage      cpu/mem/session/setuprate/npu/nturbo, current + history at
//	                                   1-min…24-hour resolution — the CPU/Memory/Sessions charts
//	monitor/system/performance/status  memory in BYTES (resource/usage only gives a percentage)
//	monitor/system/current-admins      the Administrators widget
//	monitor/license/status             the Licenses + FortiGate Cloud widgets, and the WAN IP
//	monitor/user/fortitoken            FortiToken "used / total"
//	monitor/system/csf                 Security Fabric members
//	monitor/firewall/session?summary   live session / NPU / nTurbo counters
//
// NOT available on 7.2.10: there is no monitor endpoint that returns uptime — every candidate
// (system/status, system/performance/status, system/resource/usage, …) was probed on the real
// device and none carries it. Uptime therefore comes over SSH; see fortigate_ssh.go.

// ── System information ───────────────────────────────────────────────────────

// FGSystemInformation is the "System Information" widget.
type FGSystemInformation struct {
	Hostname  string `json:"hostname"`
	Serial    string `json:"serial"`
	Model     string `json:"model"`      // "FortiGate 80E"
	ModelCode string `json:"model_code"` // "FGT80E"

	Version     string `json:"version"`      // "v7.2.10"
	Build       int    `json:"build"`        // 1706
	Maturity    string `json:"maturity"`     // "Mature" | "Feature"
	ReleaseType string `json:"release_type"` // "GA"
	// FirmwareLatest is the newest release the device itself offers as an upgrade
	// ("" when the device reports nothing newer).
	FirmwareLatest string `json:"firmware_latest"`

	OperationMode string `json:"operation_mode"` // "NAT" | "Transparent"

	// SystemTime is the device clock as a UTC epoch; TimezoneOffset is the device's
	// current offset in seconds east of UTC (already DST-adjusted). Device-local time is
	// SystemTime + TimezoneOffset.
	SystemTime     int64  `json:"system_time"`
	TimezoneOffset int    `json:"timezone_offset"`
	TimezoneName   string `json:"timezone_name"`

	// UptimeSeconds is filled in by the caller from the SSH probe (0 = unknown).
	UptimeSeconds int64 `json:"uptime_seconds"`

	// WANIP is filled in by the caller from the license overview (FortiGuard reports the
	// public address it sees the device from).
	WANIP string `json:"wan_ip"`

	LogDiskStatus string `json:"log_disk_status"` // "available" | "not_available"
	VDOMUsed      int    `json:"vdom_used"`
	VDOMMax       int    `json:"vdom_max"`
}

// firmwareMaturity expands the single-letter code the device reports.
func firmwareMaturity(code string) string {
	switch strings.ToUpper(strings.TrimSpace(code)) {
	case "M":
		return "Mature"
	case "F":
		return "Feature"
	case "":
		return ""
	default:
		return strings.ToUpper(code)
	}
}

// GetSystemInformation collects the System Information widget in one call.
//
// The five reads run concurrently — the pooled session is shared and safe for parallel use, and
// serially they cost ~5 round trips to the device. Each goroutine writes only its own variables
// and the result is assembled after they finish, because two of the sources (system/status and
// system/firmware) both report build and platform id. Only system/status is required; every
// other source degrades to a blank field rather than failing the whole widget.
func (f *FortiClient) GetSystemInformation() (FGSystemInformation, error) {
	var (
		wg sync.WaitGroup

		status    FGSystemStatus
		statusErr error

		fwBuild                                  int
		fwMaturity, fwRelease, fwPlatform, fwVer string
		fwLatest                                 string

		deviceTime int64
		opMode     string

		globalHostname string
		tzName         string
		tzOffset       int
		tzOK           bool
	)

	wg.Add(5)

	// 1. Identity — the only required call.
	go func() {
		defer wg.Done()
		status, statusErr = f.GetSystemStatus()
	}()

	// 2. Firmware detail: build number, maturity, and any newer release on offer.
	go func() {
		defer wg.Done()
		resp, err := f.do("GET", "/api/v2/monitor/system/firmware", nil)
		if err != nil {
			return
		}
		var r struct {
			Current struct {
				Version     string `json:"version"`
				Build       int    `json:"build"`
				Maturity    string `json:"maturity"`
				ReleaseType string `json:"release-type"`
				PlatformID  string `json:"platform-id"`
			} `json:"current"`
			Available []struct {
				Version string `json:"version"`
				Build   int    `json:"build"`
				Source  string `json:"source"`
			} `json:"available"`
		}
		if json.Unmarshal(resp.Results, &r) != nil {
			return
		}
		fwBuild = r.Current.Build
		fwMaturity = firmwareMaturity(r.Current.Maturity)
		fwRelease = r.Current.ReleaseType
		fwPlatform = r.Current.PlatformID
		fwVer = r.Current.Version
		for _, a := range r.Available {
			// "available" is ordered newest-first; the first entry that is not the running
			// build is the upgrade the device is offering.
			if a.Build != r.Current.Build && a.Version != "" {
				fwLatest = a.Version
				break
			}
		}
	}()

	// 3. Device clock (UTC epoch).
	go func() {
		defer wg.Done()
		resp, err := f.do("GET", "/api/v2/monitor/system/time", nil)
		if err != nil {
			return
		}
		var r struct {
			Time int64 `json:"time"`
		}
		if json.Unmarshal(resp.Results, &r) == nil {
			deviceTime = r.Time
		}
	}()

	// 4. Operation mode (NAT / Transparent) lives in CMDB, not the monitor API.
	go func() {
		defer wg.Done()
		resp, err := f.do("GET", "/api/v2/cmdb/system/settings?fields=opmode", nil)
		if err != nil {
			return
		}
		var r struct {
			OpMode string `json:"opmode"`
		}
		if json.Unmarshal(resp.Results, &r) == nil {
			switch strings.ToLower(r.OpMode) {
			case "nat":
				opMode = "NAT"
			case "transparent":
				opMode = "Transparent"
			default:
				opMode = r.OpMode
			}
		}
	}()

	// 5. Timezone: system/global gives the numeric id, the monitor table turns it into a name
	// and a DST-adjusted offset.
	go func() {
		defer wg.Done()
		resp, err := f.do("GET", "/api/v2/cmdb/system/global?fields=timezone,hostname", nil)
		if err != nil {
			return
		}
		var r struct {
			Timezone string `json:"timezone"`
			Hostname string `json:"hostname"`
		}
		if json.Unmarshal(resp.Results, &r) != nil {
			return
		}
		globalHostname = r.Hostname
		tzName, tzOffset, tzOK = f.resolveTimezone(r.Timezone)
	}()

	wg.Wait()
	if statusErr != nil {
		return FGSystemInformation{}, statusErr
	}

	info := FGSystemInformation{
		Hostname:       status.Hostname,
		Serial:         status.Serial,
		Model:          status.Model,
		ModelCode:      status.ModelCode,
		Version:        status.Version,
		Build:          status.Build,
		Maturity:       fwMaturity,
		ReleaseType:    fwRelease,
		FirmwareLatest: fwLatest,
		OperationMode:  opMode,
		SystemTime:     deviceTime,
		LogDiskStatus:  status.LogDiskStatus,
	}
	if info.Hostname == "" {
		info.Hostname = globalHostname
	}
	if info.Version == "" {
		info.Version = fwVer
	}
	if info.Build == 0 {
		info.Build = fwBuild
	}
	if info.ModelCode == "" {
		info.ModelCode = fwPlatform
	}
	if tzOK {
		info.TimezoneName, info.TimezoneOffset = tzName, tzOffset
	}
	return info, nil
}

// ── Timezone table ───────────────────────────────────────────────────────────

type fgTimezone struct {
	ID               int     `json:"id"`
	Name             string  `json:"name"`
	UTCOffset        string  `json:"utc_offset"`
	CurrentUTCOffset string  `json:"current_utc_offset"`
	UTCOffsetHours   float64 `json:"utc_offset_hours"`
	IsDST            bool    `json:"is_dst_timezone"`
}

type tzCacheEntry struct {
	table     map[int]fgTimezone
	fetchedAt time.Time
}

var (
	tzCacheMu sync.Mutex
	tzCache   = map[string]tzCacheEntry{}
)

// tzCacheTTL — the table is a firmware constant, but the *current* offset flips with DST, so it
// is refreshed hourly rather than cached forever.
const tzCacheTTL = time.Hour

// parseGMTOffset converts FortiOS's "GMT-7:00" / "GMT+7:00" / "GMT" into seconds east of UTC.
func parseGMTOffset(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(strings.ToUpper(s), "GMT") {
		return 0, false
	}
	rest := strings.TrimSpace(s[3:])
	if rest == "" {
		return 0, true
	}
	sign := 1
	switch rest[0] {
	case '-':
		sign = -1
		rest = rest[1:]
	case '+':
		rest = rest[1:]
	default:
		return 0, false
	}
	hh, mm := rest, "0"
	if i := strings.IndexByte(rest, ':'); i >= 0 {
		hh, mm = rest[:i], rest[i+1:]
	}
	h, err := strconv.Atoi(strings.TrimSpace(hh))
	if err != nil {
		return 0, false
	}
	m, err := strconv.Atoi(strings.TrimSpace(mm))
	if err != nil {
		return 0, false
	}
	return sign * (h*3600 + m*60), true
}

// resolveTimezone maps the CMDB timezone id ("04") to its display name and current offset.
// Confirmed live: the CMDB id and the monitor/system/timezone id share one numbering, and the
// lab device's "04" resolves to "(GMT-8:00) Pacific Time (US & Canada)" running at GMT-7 (DST).
func (f *FortiClient) resolveTimezone(id string) (name string, offsetSeconds int, ok bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", 0, false
	}
	n, err := strconv.Atoi(id)
	if err != nil {
		return "", 0, false
	}
	table := f.timezoneTable()
	tz, found := table[n]
	if !found {
		return "", 0, false
	}
	offset, parsed := parseGMTOffset(tz.CurrentUTCOffset)
	if !parsed {
		offset = int(tz.UTCOffsetHours * 3600)
	}
	return tz.Name, offset, true
}

func (f *FortiClient) timezoneTable() map[int]fgTimezone {
	tzCacheMu.Lock()
	entry, ok := tzCache[f.BaseURL]
	tzCacheMu.Unlock()
	if ok && time.Since(entry.fetchedAt) < tzCacheTTL {
		return entry.table
	}

	resp, err := f.do("GET", "/api/v2/monitor/system/timezone", nil)
	if err != nil {
		return entry.table // possibly nil — caller treats a miss as "unknown timezone"
	}
	var list []fgTimezone
	if json.Unmarshal(resp.Results, &list) != nil {
		return entry.table
	}
	table := make(map[int]fgTimezone, len(list))
	for _, tz := range list {
		table[tz.ID] = tz
	}

	tzCacheMu.Lock()
	tzCache[f.BaseURL] = tzCacheEntry{table: table, fetchedAt: time.Now()}
	tzCacheMu.Unlock()
	return table
}

// ── Resource usage (CPU / Memory / Sessions charts) ──────────────────────────

// FGUsagePoint is one sample: T = epoch milliseconds, V = value.
type FGUsagePoint struct {
	T int64   `json:"t"`
	V float64 `json:"v"`
}

// FGUsageSeries is one metric: its current value plus the history for the requested interval,
// oldest sample first (FortiOS returns them newest-first).
type FGUsageSeries struct {
	Current float64        `json:"current"`
	Min     float64        `json:"min"`
	Max     float64        `json:"max"`
	Average float64        `json:"average"`
	Points  []FGUsagePoint `json:"points"`
}

// FGResourceUsage is the CPU / Memory / Sessions widget data.
type FGResourceUsage struct {
	Interval string `json:"interval"`

	// CPU is the aggregate; CPUCores are the individual cores. FortiOS returns the aggregate
	// as element 0 of the "cpu" array and one element per core after it (verified live: the
	// FGT80E returns 5 entries for 4 cores, and element 0 tracks system/performance/status'
	// overall 100-idle figure).
	CPU      FGUsageSeries   `json:"cpu"`
	CPUCores []FGUsageSeries `json:"cpu_cores"`

	Memory         FGUsageSeries `json:"memory"`
	Disk           FGUsageSeries `json:"disk"`
	Sessions       FGUsageSeries `json:"sessions"`
	SetupRate      FGUsageSeries `json:"setup_rate"`
	NPUSessions    FGUsageSeries `json:"npu_sessions"`
	NTurboSessions FGUsageSeries `json:"nturbo_sessions"`
}

// FGUsageIntervals are the sampling windows FortiOS keeps history for.
var FGUsageIntervals = []string{"1-min", "10-min", "30-min", "1-hour", "12-hour", "24-hour"}

// IsValidUsageInterval guards the interval before it reaches the device.
func IsValidUsageInterval(interval string) bool {
	for _, v := range FGUsageIntervals {
		if v == interval {
			return true
		}
	}
	return false
}

// rawUsageSeries mirrors one entry of monitor/system/resource/usage.
type rawUsageSeries struct {
	Current    float64 `json:"current"`
	Historical map[string]struct {
		Values  [][]float64 `json:"values"`
		Min     float64     `json:"min"`
		Max     float64     `json:"max"`
		Average float64     `json:"average"`
	} `json:"historical"`
}

// toSeries flattens one raw metric into a chart-ready series for the requested interval,
// re-ordering the samples oldest-first.
func (r rawUsageSeries) toSeries(interval string) FGUsageSeries {
	s := FGUsageSeries{Current: r.Current}
	h, ok := r.Historical[interval]
	if !ok {
		return s
	}
	s.Min, s.Max, s.Average = h.Min, h.Max, h.Average
	s.Points = make([]FGUsagePoint, 0, len(h.Values))
	for _, v := range h.Values {
		if len(v) < 2 {
			continue
		}
		s.Points = append(s.Points, FGUsagePoint{T: int64(v[0]), V: v[1]})
	}
	sort.Slice(s.Points, func(i, j int) bool { return s.Points[i].T < s.Points[j].T })
	return s
}

// firstSeries returns the first entry of a metric array (FortiOS wraps even single-valued
// metrics such as memory in a one-element array).
func firstSeries(list []rawUsageSeries, interval string) FGUsageSeries {
	if len(list) == 0 {
		return FGUsageSeries{}
	}
	return list[0].toSeries(interval)
}

// ParseResourceUsage turns a monitor/system/resource/usage payload into chart series.
// Split out from the HTTP call so the mapping is testable against captured device output.
func ParseResourceUsage(results json.RawMessage, interval string) (FGResourceUsage, error) {
	var raw struct {
		CPU           []rawUsageSeries `json:"cpu"`
		Mem           []rawUsageSeries `json:"mem"`
		Disk          []rawUsageSeries `json:"disk"`
		Session       []rawUsageSeries `json:"session"`
		SetupRate     []rawUsageSeries `json:"setuprate"`
		NPUSession    []rawUsageSeries `json:"npu_session"`
		NTurboSession []rawUsageSeries `json:"nturbo_session"`
	}
	if err := json.Unmarshal(results, &raw); err != nil {
		return FGResourceUsage{}, fmt.Errorf("failed to parse system/resource/usage: %w", err)
	}

	u := FGResourceUsage{
		Interval:       interval,
		Memory:         firstSeries(raw.Mem, interval),
		Disk:           firstSeries(raw.Disk, interval),
		Sessions:       firstSeries(raw.Session, interval),
		SetupRate:      firstSeries(raw.SetupRate, interval),
		NPUSessions:    firstSeries(raw.NPUSession, interval),
		NTurboSessions: firstSeries(raw.NTurboSession, interval),
	}
	if len(raw.CPU) > 0 {
		u.CPU = raw.CPU[0].toSeries(interval)
		u.CPUCores = make([]FGUsageSeries, 0, len(raw.CPU)-1)
		for _, c := range raw.CPU[1:] {
			u.CPUCores = append(u.CPUCores, c.toSeries(interval))
		}
	}
	return u, nil
}

// GetResourceUsage fetches the CPU/memory/session history at the given interval.
func (f *FortiClient) GetResourceUsage(interval string) (FGResourceUsage, error) {
	if !IsValidUsageInterval(interval) {
		return FGResourceUsage{}, fmt.Errorf("invalid interval %q (allowed: %s)", interval, strings.Join(FGUsageIntervals, ", "))
	}
	resp, err := f.do("GET", "/api/v2/monitor/system/resource/usage?scope=global&interval="+interval, nil)
	if err != nil {
		return FGResourceUsage{}, err
	}
	return ParseResourceUsage(resp.Results, interval)
}

// ── Performance (memory in bytes, per-core CPU) ──────────────────────────────

// FGPerformance is monitor/system/performance/status — the only source of absolute memory
// figures; resource/usage reports memory as a percentage only.
type FGPerformance struct {
	CPUUser   int `json:"cpu_user"`
	CPUSystem int `json:"cpu_system"`
	CPUNice   int `json:"cpu_nice"`
	CPUIdle   int `json:"cpu_idle"`
	CPUIOWait int `json:"cpu_iowait"`
	CPUCores  int `json:"cpu_cores"`

	MemTotal    int64 `json:"mem_total"`
	MemUsed     int64 `json:"mem_used"`
	MemFree     int64 `json:"mem_free"`
	MemFreeable int64 `json:"mem_freeable"`
}

func (f *FortiClient) GetPerformance() (FGPerformance, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/performance/status", nil)
	if err != nil {
		return FGPerformance{}, err
	}
	var r struct {
		CPU struct {
			Cores  []json.RawMessage `json:"cores"`
			User   int               `json:"user"`
			System int               `json:"system"`
			Nice   int               `json:"nice"`
			Idle   int               `json:"idle"`
			IOWait int               `json:"iowait"`
		} `json:"cpu"`
		Mem struct {
			Total    int64 `json:"total"`
			Used     int64 `json:"used"`
			Free     int64 `json:"free"`
			Freeable int64 `json:"freeable"`
		} `json:"mem"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return FGPerformance{}, fmt.Errorf("failed to parse system/performance/status: %w", err)
	}
	return FGPerformance{
		CPUUser: r.CPU.User, CPUSystem: r.CPU.System, CPUNice: r.CPU.Nice,
		CPUIdle: r.CPU.Idle, CPUIOWait: r.CPU.IOWait, CPUCores: len(r.CPU.Cores),
		MemTotal: r.Mem.Total, MemUsed: r.Mem.Used, MemFree: r.Mem.Free, MemFreeable: r.Mem.Freeable,
	}, nil
}

// ── Sessions ─────────────────────────────────────────────────────────────────

// FGSessionSummary is the live counter behind the Sessions widget's footer
// ("Current sessions 13 · SPU 0.0% · nTurbo 0.0%").
type FGSessionSummary struct {
	SessionCount       int `json:"session_count"`
	NPUSessionCount    int `json:"npu_session_count"`
	NTurboSessionCount int `json:"nturbo_session_count"`
	SetupRate          int `json:"setup_rate"`
}

func (f *FortiClient) GetSessionSummary() (FGSessionSummary, error) {
	// count=0 keeps the device from serialising the session table itself — only the summary
	// block is wanted here.
	resp, err := f.do("GET", "/api/v2/monitor/firewall/session?count=0&summary=true", nil)
	if err != nil {
		return FGSessionSummary{}, err
	}
	var r struct {
		Summary FGSessionSummary `json:"summary"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return FGSessionSummary{}, fmt.Errorf("failed to parse firewall/session: %w", err)
	}
	return r.Summary, nil
}

// ── Administrators ───────────────────────────────────────────────────────────

// FGAdminSession is one logged-in administrator (the Administrators widget).
type FGAdminSession struct {
	ID        int    `json:"id"`
	Admin     string `json:"admin"`
	Profile   string `json:"profile"`
	Interface string `json:"interface"`
	Method    string `json:"method"` // https | ssh | jsconsole | telnet | console | ftm
	SrcAddr   string `json:"srcaddr"`
	LoginTime int64  `json:"login_time"`
	IsCurrent bool   `json:"is_current"`
}

func (f *FortiClient) GetCurrentAdmins() ([]FGAdminSession, error) {
	resp, err := f.do("GET", "/api/v2/monitor/system/current-admins", nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID        int    `json:"id"`
		Admin     string `json:"admin"`
		Profile   string `json:"profile"`
		Intf      string `json:"intf"`
		Method    string `json:"method"`
		SrcAddr   string `json:"srcaddr"`
		Time      int64  `json:"time"`
		IsCurrent bool   `json:"is_current"`
	}
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse system/current-admins: %w", err)
	}
	out := make([]FGAdminSession, 0, len(raw))
	for _, a := range raw {
		out = append(out, FGAdminSession{
			ID: a.ID, Admin: a.Admin, Profile: a.Profile, Interface: a.Intf,
			Method: strings.ToLower(a.Method), SrcAddr: a.SrcAddr,
			LoginTime: a.Time, IsCurrent: a.IsCurrent,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LoginTime > out[j].LoginTime })
	return out, nil
}

// ── Licenses / FortiGuard / FortiGate Cloud ──────────────────────────────────

// License status values, normalised across the three shapes FortiOS uses
// (downloaded_fds_object, live_fortiguard_service, live_cloud_service).
const (
	LicenseRegistered = "registered"
	LicenseLicensed   = "licensed"
	LicenseExpired    = "expired"
	LicenseNone       = "no_license"
	LicenseFree       = "free_license"
	LicenseUnknown    = "unknown"
)

// FGLicenseRow is one row of the Licenses widget.
type FGLicenseRow struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Status      string `json:"status"`
	Expires     int64  `json:"expires,omitempty"`
	Version     string `json:"version,omitempty"`
	Entitlement string `json:"entitlement,omitempty"`
	LastUpdate  int64  `json:"last_update,omitempty"`
}

// FGLicenseOverview is the Licenses + FortiGate Cloud widgets, plus the FortiGuard connection
// state that supplies the System Information widget's WAN IP.
type FGLicenseOverview struct {
	// Primary are the rows the FortiGate dashboard itself lists; Secondary are the remaining
	// entitlements, shown in this app as an expandable detail list.
	Primary   []FGLicenseRow `json:"primary"`
	Secondary []FGLicenseRow `json:"secondary"`

	FortiCare struct {
		Status  string `json:"status"`
		Account string `json:"account"`
		Company string `json:"company"`
	} `json:"forticare"`

	FortiGuard struct {
		Connected       bool   `json:"connected"`
		ConnectionIssue bool   `json:"connection_issue"`
		ServerAddress   string `json:"server_address"`
		LastConnection  int64  `json:"last_connection"`
		NextUpdate      int64  `json:"next_update"`
		WANIP           string `json:"wan_ip"`
	} `json:"fortiguard"`

	FortiCloud struct {
		Status           string `json:"status"` // cloud_logged_in | cloud_not_logged_in | …
		Activated        bool   `json:"activated"`
		Account          string `json:"account"`
		Domain           string `json:"domain"` // GLOBAL | US | EUROPE
		LoggingStatus    string `json:"logging_status"`
		LogRetentionDays int    `json:"log_retention_days"`
		UsedBytes        int64  `json:"used_bytes"`
		MaxBytes         int64  `json:"max_bytes"`
	} `json:"forticloud"`

	FortiToken struct {
		Used  int `json:"used"`
		Total int `json:"total"`
	} `json:"fortitoken"`

	VDOMUsed int `json:"vdom_used"`
	VDOMMax  int `json:"vdom_max"`
}

// rawLicenseEntry covers all three entry shapes license/status returns.
type rawLicenseEntry struct {
	Type        string `json:"type"`
	Status      string `json:"status"`
	Expires     int64  `json:"expires"`
	Version     string `json:"version"`
	Entitlement string `json:"entitlement"`
	LastUpdate  int64  `json:"last_update"`
}

// licenseRows lists the entitlements this app surfaces, in the order the FortiGate GUI uses.
// `primary` marks the rows the device's own Licenses widget shows.
var licenseRows = []struct {
	key     string
	label   string
	primary bool
}{
	{"antivirus", "AntiVirus", true},
	{"web_filtering", "Web Filtering", true},
	{"security_rating", "Security Rating", true},
	{"ips", "Intrusion Prevention", false},
	{"appctrl", "Application Control", false},
	{"outbreak_prevention", "Outbreak Prevention", false},
	{"antispam", "AntiSpam", false},
	{"mobile_malware", "Mobile Malware", false},
	{"industrial_db", "Industrial Database", false},
	{"internet_service_db", "Internet Service Database", false},
	{"botnet_ip", "Botnet IP", false},
	{"botnet_domain", "Botnet Domain", false},
	{"malicious_urls", "Malicious URLs", false},
	{"device_os_id", "Device/OS Identification", false},
	{"forticloud_sandbox", "FortiSandbox Cloud", false},
	{"iot_detection", "IoT Detection", false},
}

// normaliseLicenseStatus folds FortiOS' per-type vocabulary into the five values the UI colours.
func normaliseLicenseStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "licensed", "valid", "registered_licensed":
		return LicenseLicensed
	case "expired":
		return LicenseExpired
	case "no_license", "not_licensed", "unlicensed":
		return LicenseNone
	case "free_license":
		return LicenseFree
	case "registered", "cloud_logged_in":
		return LicenseRegistered
	case "":
		return LicenseUnknown
	default:
		return strings.ToLower(s)
	}
}

// parseLicenseStatus maps a monitor/license/status payload to the dashboard's licence model.
// Split from the HTTP call so it can be tested against a captured device response.
func parseLicenseStatus(results json.RawMessage) (FGLicenseOverview, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(results, &raw); err != nil {
		return FGLicenseOverview{}, fmt.Errorf("failed to parse license/status: %w", err)
	}

	var out FGLicenseOverview

	// FortiCare registration + the support contract behind "Firmware & General Updates".
	var forticare struct {
		Status  string                     `json:"status"`
		Account string                     `json:"account"`
		Company string                     `json:"company"`
		Support map[string]rawLicenseEntry `json:"support"`
	}
	if b, ok := raw["forticare"]; ok {
		json.Unmarshal(b, &forticare) //nolint:errcheck
	}
	out.FortiCare.Status = normaliseLicenseStatus(forticare.Status)
	out.FortiCare.Account = forticare.Account
	out.FortiCare.Company = forticare.Company

	if b, ok := raw["fortiguard"]; ok {
		var fg struct {
			Connected             bool   `json:"connected"`
			ConnectionIssue       bool   `json:"connection_issue"`
			ServerAddress         string `json:"server_address"`
			LastConnectionSuccess int64  `json:"last_connection_success"`
			NextScheduledUpdate   int64  `json:"next_scheduled_update"`
			FortigateWANIP        string `json:"fortigate_wan_ip"`
		}
		if json.Unmarshal(b, &fg) == nil {
			out.FortiGuard.Connected = fg.Connected
			out.FortiGuard.ConnectionIssue = fg.ConnectionIssue
			out.FortiGuard.ServerAddress = fg.ServerAddress
			out.FortiGuard.LastConnection = fg.LastConnectionSuccess
			out.FortiGuard.NextUpdate = fg.NextScheduledUpdate
			out.FortiGuard.WANIP = fg.FortigateWANIP
		}
	}

	if b, ok := raw["forticloud"]; ok {
		var fc struct {
			Status  string `json:"status"`
			Account string `json:"account"`
			Domain  string `json:"domain"`
		}
		if json.Unmarshal(b, &fc) == nil {
			out.FortiCloud.Status = fc.Status
			out.FortiCloud.Activated = strings.EqualFold(fc.Status, "cloud_logged_in")
			out.FortiCloud.Account = fc.Account
			out.FortiCloud.Domain = fc.Domain
		}
	}
	if b, ok := raw["forticloud_logging"]; ok {
		var fl struct {
			Status           string `json:"status"`
			UsedBytes        int64  `json:"used_bytes"`
			MaxBytes         int64  `json:"max_bytes"`
			LogRetentionDays int    `json:"log_retention_days"`
		}
		if json.Unmarshal(b, &fl) == nil {
			out.FortiCloud.LoggingStatus = normaliseLicenseStatus(fl.Status)
			out.FortiCloud.UsedBytes = fl.UsedBytes
			out.FortiCloud.MaxBytes = fl.MaxBytes
			out.FortiCloud.LogRetentionDays = fl.LogRetentionDays
		}
	}

	if b, ok := raw["vdom"]; ok {
		var v struct {
			Used int `json:"used"`
			Max  int `json:"max"`
		}
		if json.Unmarshal(b, &v) == nil {
			out.VDOMUsed, out.VDOMMax = v.Used, v.Max
		}
	}

	// Row 1 — FortiCare Support: the registration itself.
	out.Primary = append(out.Primary, FGLicenseRow{
		Key: "forticare_support", Label: "FortiCare Support", Status: out.FortiCare.Status,
	})

	// Row 2 — Firmware & General Updates: the FortiCare *support contract*, which FortiOS
	// reports as entries under forticare.support (enhanced / hardware / premium …). A
	// registered device whose support block is empty has no contract left to download
	// firmware with, which is exactly what the device's own widget flags in red.
	firmware := FGLicenseRow{Key: "firmware_updates", Label: "Firmware & General Updates", Status: LicenseExpired}
	for _, entry := range forticare.Support {
		st := normaliseLicenseStatus(entry.Status)
		if entry.Expires > firmware.Expires {
			firmware.Expires = entry.Expires
		}
		if st == LicenseLicensed {
			firmware.Status = LicenseLicensed
		}
	}
	if out.FortiCare.Status != LicenseRegistered && len(forticare.Support) == 0 {
		// Never registered at all — nothing has expired, there simply is no licence.
		firmware.Status = LicenseNone
	}
	out.Primary = append(out.Primary, firmware)

	for _, spec := range licenseRows {
		b, ok := raw[spec.key]
		if !ok {
			continue
		}
		var e rawLicenseEntry
		if json.Unmarshal(b, &e) != nil {
			continue
		}
		row := FGLicenseRow{
			Key: spec.key, Label: spec.label, Status: normaliseLicenseStatus(e.Status),
			Expires: e.Expires, Version: e.Version, Entitlement: e.Entitlement, LastUpdate: e.LastUpdate,
		}
		if spec.primary {
			out.Primary = append(out.Primary, row)
		} else {
			out.Secondary = append(out.Secondary, row)
		}
	}
	return out, nil
}

// GetLicenseOverview reads monitor/license/status and folds in the FortiToken count.
func (f *FortiClient) GetLicenseOverview() (FGLicenseOverview, error) {
	resp, err := f.do("GET", "/api/v2/monitor/license/status", nil)
	if err != nil {
		return FGLicenseOverview{}, err
	}
	out, err := parseLicenseStatus(resp.Results)
	if err != nil {
		return FGLicenseOverview{}, err
	}
	used, total := f.fortiTokenUsage()
	out.FortiToken.Used, out.FortiToken.Total = used, total
	return out, nil
}

// fortiTokenUsage counts assigned vs total FortiTokens ("0 / 2" in the GUI). A token whose
// status is "available" is unassigned; anything else (active, pending, lock, …) is in use.
// Best-effort: a device without the FortiToken feature answers with an empty set.
func (f *FortiClient) fortiTokenUsage() (used, total int) {
	resp, err := f.do("GET", "/api/v2/monitor/user/fortitoken", nil)
	if err != nil {
		return 0, 0
	}
	var tokens map[string]struct {
		SerialNumber string `json:"serial_number"`
		Status       struct {
			Name string `json:"name"`
		} `json:"status"`
	}
	if json.Unmarshal(resp.Results, &tokens) != nil {
		return 0, 0
	}
	for _, t := range tokens {
		total++
		if !strings.EqualFold(t.Status.Name, "available") {
			used++
		}
	}
	return used, total
}

// ── Security Fabric ──────────────────────────────────────────────────────────

// FGFabricMember is one FortiGate in the Security Fabric tree.
type FGFabricMember struct {
	Serial    string `json:"serial"`
	Hostname  string `json:"hostname"`
	Model     string `json:"model"`
	Version   string `json:"version"`
	MgmtIP    string `json:"mgmt_ip"`
	IsCurrent bool   `json:"is_current"`
	HAMode    string `json:"ha_mode"`
}

// FGFabricStatus is the Security Fabric widget: whether the fabric is switched on at all, plus
// the members the device knows about.
type FGFabricStatus struct {
	Enabled         bool             `json:"enabled"`
	ProtocolEnabled bool             `json:"protocol_enabled"`
	GroupName       string           `json:"group_name"`
	Upstream        string           `json:"upstream"`
	IsRoot          bool             `json:"is_root"`
	Members         []FGFabricMember `json:"members"`
}

func (f *FortiClient) GetFabricStatus(serial string) (FGFabricStatus, error) {
	var out FGFabricStatus

	// CMDB says whether the fabric is enabled and what role this device plays.
	if resp, err := f.do("GET", "/api/v2/cmdb/system/csf?fields=status,group-name,upstream", nil); err == nil {
		var r struct {
			Status    string `json:"status"`
			GroupName string `json:"group-name"`
			Upstream  string `json:"upstream"`
		}
		if json.Unmarshal(resp.Results, &r) == nil {
			out.Enabled = strings.EqualFold(r.Status, "enable")
			out.GroupName = r.GroupName
			out.Upstream = r.Upstream
			out.IsRoot = out.Enabled && strings.TrimSpace(r.Upstream) == ""
		}
	}

	resp, err := f.do("GET", "/api/v2/monitor/system/csf", nil)
	if err != nil {
		return out, err
	}
	var r struct {
		ProtocolEnabled bool `json:"protocol_enabled"`
		Devices         struct {
			FortiGate []struct {
				Serial               string `json:"serial"`
				HostName             string `json:"host_name"`
				ModelName            string `json:"model_name"`
				ModelNumber          string `json:"model_number"`
				Model                string `json:"model"`
				MgmtIPStr            string `json:"mgmt_ip_str"`
				HAMode               string `json:"ha_mode"`
				FirmwareVersionMajor int    `json:"firmware_version_major"`
				FirmwareVersionMinor int    `json:"firmware_version_minor"`
				FirmwareVersionPatch int    `json:"firmware_version_patch"`
			} `json:"fortigate"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(resp.Results, &r); err != nil {
		return out, fmt.Errorf("failed to parse system/csf: %w", err)
	}
	out.ProtocolEnabled = r.ProtocolEnabled
	for _, d := range r.Devices.FortiGate {
		model := strings.TrimSpace(d.ModelName + " " + d.ModelNumber)
		if model == "" {
			model = d.Model
		}
		out.Members = append(out.Members, FGFabricMember{
			Serial:    d.Serial,
			Hostname:  d.HostName,
			Model:     model,
			Version:   fmt.Sprintf("v%d.%d.%d", d.FirmwareVersionMajor, d.FirmwareVersionMinor, d.FirmwareVersionPatch),
			MgmtIP:    d.MgmtIPStr,
			HAMode:    d.HAMode,
			IsCurrent: serial != "" && d.Serial == serial,
		})
	}
	return out, nil
}

package services

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Log & Report ▸ Log Settings — what the firewall records, and where it puts it.
//
// Five single-object CMDB tables, because FortiOS splits one question across them:
//
//	log/setting                   WHAT produces a log line at all
//	log.memory/setting            the volatile buffer every unit has
//	log.disk/setting              the local disk, on units that have one
//	log.syslogd/setting           a syslog collector
//	log.fortianalyzer/setting     a FortiAnalyzer
//
// Schema read live off FortiGate 7.2.10 (FGT80E).
//
// ── The traps ────────────────────────────────────────────────────────────────
//
// **`fwpolicy-implicit-log` is off by default, and it is why a log looks empty.** The implicit deny
// at the bottom of the policy table drops most of what a firewall refuses, and with this off none
// of it is recorded. Someone looking for a blocked connection finds nothing and concludes the
// traffic never arrived. It is the first thing this page says.
//
// **`status: enable` does not mean a destination is receiving anything.** A syslog setting with
// status enabled and an empty `server` is configured and sending to nowhere. Each destination
// therefore reports `Configured` separately from `Enabled`, and the UI says which of the two is
// missing.
//
// **Not every unit has a log disk.** The lab FGT80E answers `log_disk_status: not_available` on
// monitor/system/status, and `log.disk/setting` still exists and still accepts writes that do
// nothing. DiskAvailable carries that answer so the console can say "this model has no log disk"
// rather than offering a switch that reports success and changes nothing.
//
// **These tables answer with an OBJECT on some paths and a one-element ARRAY on others.** Both
// shapes are handled — the same care vpn.ssl/settings needed, and for the same reason: guessing
// wrong yields a zero-valued struct that renders as "everything is switched off".

// FGLogEvents is log/setting — which events produce a log line.
type FGLogEvents struct {
	// ImplicitDenyLog is `fwpolicy-implicit-log`. See the trap above; this is the one that matters.
	ImplicitDenyLog bool `json:"implicit_deny_log"`
	// LocalInAllow / LocalInDeny* cover traffic addressed to the firewall itself — the same traffic
	// the Firewall Protection page governs.
	LocalInAllow         bool `json:"local_in_allow"`
	LocalInDenyUnicast   bool `json:"local_in_deny_unicast"`
	LocalInDenyBroadcast bool `json:"local_in_deny_broadcast"`
	LocalOut             bool `json:"local_out"`
	LogInvalidPacket     bool `json:"log_invalid_packet"`
	ResolveIP            bool `json:"resolve_ip"`
	ResolvePort          bool `json:"resolve_port"`
	BriefTrafficFormat   bool `json:"brief_traffic_format"`
	UserAnonymize        bool `json:"user_anonymize"`
	LogPolicyComment     bool `json:"log_policy_comment"`
}

// FGLogMemory is log.memory/setting. One field, and every unit has it.
type FGLogMemory struct {
	Enabled bool `json:"enabled"`
}

// FGLogDisk is log.disk/setting.
type FGLogDisk struct {
	Enabled           bool   `json:"enabled"`
	MaxLogFileSizeMB  int    `json:"max_log_file_size_mb"`
	RollSchedule      string `json:"roll_schedule"` // daily | weekly
	RollDay           string `json:"roll_day"`
	RollTime          string `json:"roll_time"`
	DiskFull          string `json:"disk_full"` // overwrite | nolog
	MaximumLogAgeDays int    `json:"maximum_log_age_days"`
	Upload            bool   `json:"upload"`
}

// FGLogSyslog is log.syslogd/setting.
type FGLogSyslog struct {
	Enabled      bool   `json:"enabled"`
	Server       string `json:"server"`
	Port         int    `json:"port"`
	Mode         string `json:"mode"`     // udp | legacy-reliable | reliable
	Facility     string `json:"facility"` // local7 and friends
	Format       string `json:"format"`   // default | csv | cef | rfc5424
	SourceIP     string `json:"source_ip"`
	EncAlgorithm string `json:"enc_algorithm"`
	Certificate  string `json:"certificate"`
	Priority     string `json:"priority"`
	MaxLogRate   int    `json:"max_log_rate"`
	// Configured: a destination with no server address is switched on and sending nowhere.
	Configured bool `json:"configured"`
}

// FGLogFortiAnalyzer is log.fortianalyzer/setting.
type FGLogFortiAnalyzer struct {
	Enabled                 bool   `json:"enabled"`
	Server                  string `json:"server"`
	AltServer               string `json:"alt_server"`
	UploadOption            string `json:"upload_option"` // realtime | 1-minute | 5-minute | store-and-upload
	Reliable                bool   `json:"reliable"`
	CertificateVerification bool   `json:"certificate_verification"`
	SourceIP                string `json:"source_ip"`
	EncAlgorithm            string `json:"enc_algorithm"`
	SSLMinProtoVersion      string `json:"ssl_min_proto_version"`
	MaxLogRate              int    `json:"max_log_rate"`
	Configured              bool   `json:"configured"`
}

// FGLogSettings is the whole page in one read.
type FGLogSettings struct {
	Events        FGLogEvents        `json:"events"`
	Memory        FGLogMemory        `json:"memory"`
	Disk          FGLogDisk          `json:"disk"`
	Syslog        FGLogSyslog        `json:"syslog"`
	FortiAnalyzer FGLogFortiAnalyzer `json:"fortianalyzer"`
	// DiskAvailable is the unit's own answer about whether it HAS a log disk. See the trap above.
	DiskAvailable bool `json:"disk_available"`
	// DiskStatus is what monitor/system/status called it, for the sentence on screen.
	DiskStatus string `json:"disk_status"`
}

// readSingleObject handles a CMDB table with no mkey.
//
// FortiOS answers these with a bare object on some paths and a one-element array on others, and
// which one is not documented anywhere. Guessing wrong unmarshals into a zero value, which on this
// page would render as "nothing is logged and nothing is enabled" — a confident, wrong answer.
func readSingleObject(resp *fgAPIResponse, out any) error {
	if err := json.Unmarshal(resp.Results, out); err == nil {
		return nil
	}
	var many []json.RawMessage
	if err := json.Unmarshal(resp.Results, &many); err != nil {
		return fmt.Errorf("unexpected shape for a single-object table: %w", err)
	}
	if len(many) == 0 {
		return fmt.Errorf("single-object table answered with an empty list")
	}
	return json.Unmarshal(many[0], out)
}

type fgLogEventsRaw struct {
	ImplicitDenyLog      string `json:"fwpolicy-implicit-log"`
	LocalInAllow         string `json:"local-in-allow"`
	LocalInDenyUnicast   string `json:"local-in-deny-unicast"`
	LocalInDenyBroadcast string `json:"local-in-deny-broadcast"`
	LocalOut             string `json:"local-out"`
	LogInvalidPacket     string `json:"log-invalid-packet"`
	ResolveIP            string `json:"resolve-ip"`
	ResolvePort          string `json:"resolve-port"`
	BriefTrafficFormat   string `json:"brief-traffic-format"`
	UserAnonymize        string `json:"user-anonymize"`
	LogPolicyComment     string `json:"log-policy-comment"`
}

type fgLogDiskRaw struct {
	Status         string `json:"status"`
	MaxLogFileSize int    `json:"max-log-file-size"`
	RollSchedule   string `json:"roll-schedule"`
	RollDay        string `json:"roll-day"`
	RollTime       string `json:"roll-time"`
	DiskFull       string `json:"diskfull"`
	MaximumLogAge  int    `json:"maximum-log-age"`
	Upload         string `json:"upload"`
}

type fgLogSyslogRaw struct {
	Status       string `json:"status"`
	Server       string `json:"server"`
	Port         int    `json:"port"`
	Mode         string `json:"mode"`
	Facility     string `json:"facility"`
	Format       string `json:"format"`
	SourceIP     string `json:"source-ip"`
	EncAlgorithm string `json:"enc-algorithm"`
	Certificate  string `json:"certificate"`
	Priority     string `json:"priority"`
	MaxLogRate   int    `json:"max-log-rate"`
}

type fgLogFAZRaw struct {
	Status                  string `json:"status"`
	Server                  string `json:"server"`
	AltServer               string `json:"alt-server"`
	UploadOption            string `json:"upload-option"`
	Reliable                string `json:"reliable"`
	CertificateVerification string `json:"certificate-verification"`
	SourceIP                string `json:"source-ip"`
	EncAlgorithm            string `json:"enc-algorithm"`
	SSLMinProtoVersion      string `json:"ssl-min-proto-version"`
	MaxLogRate              int    `json:"max-log-rate"`
}

// GetLogSettings reads all five tables plus the unit's disk answer.
//
// A failure on any ONE table is not a failure of the page: the tables are independent, and a
// console that refuses to show the syslog settings because the disk table would not answer is less
// useful than one that shows four of five. Only a failure of log/setting itself is fatal, because
// without it the page cannot say what is being logged at all.
func (f *FortiClient) GetLogSettings() (*FGLogSettings, error) {
	out := &FGLogSettings{}

	resp, err := f.do("GET", "/api/v2/cmdb/log/setting", nil)
	if err != nil {
		return nil, err
	}
	var ev fgLogEventsRaw
	if err := readSingleObject(resp, &ev); err != nil {
		return nil, fmt.Errorf("failed to parse log settings: %w", err)
	}
	out.Events = FGLogEvents{
		ImplicitDenyLog:      isOn(ev.ImplicitDenyLog),
		LocalInAllow:         isOn(ev.LocalInAllow),
		LocalInDenyUnicast:   isOn(ev.LocalInDenyUnicast),
		LocalInDenyBroadcast: isOn(ev.LocalInDenyBroadcast),
		LocalOut:             isOn(ev.LocalOut),
		LogInvalidPacket:     isOn(ev.LogInvalidPacket),
		ResolveIP:            isOn(ev.ResolveIP),
		ResolvePort:          isOn(ev.ResolvePort),
		BriefTrafficFormat:   isOn(ev.BriefTrafficFormat),
		UserAnonymize:        isOn(ev.UserAnonymize),
		LogPolicyComment:     isOn(ev.LogPolicyComment),
	}

	if r, e := f.do("GET", "/api/v2/cmdb/log.memory/setting", nil); e == nil {
		var m struct {
			Status string `json:"status"`
		}
		if readSingleObject(r, &m) == nil {
			out.Memory.Enabled = isOn(m.Status)
		}
	}

	if r, e := f.do("GET", "/api/v2/cmdb/log.disk/setting", nil); e == nil {
		var d fgLogDiskRaw
		if readSingleObject(r, &d) == nil {
			out.Disk = FGLogDisk{
				Enabled:           isOn(d.Status),
				MaxLogFileSizeMB:  d.MaxLogFileSize,
				RollSchedule:      d.RollSchedule,
				RollDay:           d.RollDay,
				RollTime:          d.RollTime,
				DiskFull:          d.DiskFull,
				MaximumLogAgeDays: d.MaximumLogAge,
				Upload:            isOn(d.Upload),
			}
		}
	}

	if r, e := f.do("GET", "/api/v2/cmdb/log.syslogd/setting", nil); e == nil {
		var s fgLogSyslogRaw
		if readSingleObject(r, &s) == nil {
			out.Syslog = FGLogSyslog{
				Enabled: isOn(s.Status), Server: s.Server, Port: s.Port, Mode: s.Mode,
				Facility: s.Facility, Format: s.Format, SourceIP: s.SourceIP,
				EncAlgorithm: s.EncAlgorithm, Certificate: s.Certificate, Priority: s.Priority,
				MaxLogRate: s.MaxLogRate,
				Configured: strings.TrimSpace(s.Server) != "",
			}
		}
	}

	if r, e := f.do("GET", "/api/v2/cmdb/log.fortianalyzer/setting", nil); e == nil {
		var a fgLogFAZRaw
		if readSingleObject(r, &a) == nil {
			out.FortiAnalyzer = FGLogFortiAnalyzer{
				Enabled: isOn(a.Status), Server: a.Server, AltServer: a.AltServer,
				UploadOption: a.UploadOption, Reliable: isOn(a.Reliable),
				CertificateVerification: isOn(a.CertificateVerification),
				SourceIP:                a.SourceIP, EncAlgorithm: a.EncAlgorithm,
				SSLMinProtoVersion: a.SSLMinProtoVersion, MaxLogRate: a.MaxLogRate,
				Configured: strings.TrimSpace(a.Server) != "",
			}
		}
	}

	out.DiskStatus, out.DiskAvailable = f.logDiskStatus()
	return out, nil
}

// logDiskStatus asks the unit whether it has a log disk at all.
//
// `available` is the only answer that means yes. The lab FGT80E says `not_available`, and an
// unreadable answer is reported as unknown rather than as absent — refusing to show the disk
// settings because one monitor call failed would hide a real configuration.
func (f *FortiClient) logDiskStatus() (status string, available bool) {
	resp, err := f.do("GET", "/api/v2/monitor/system/status", nil)
	if err != nil {
		return "", true
	}
	var s struct {
		LogDiskStatus string `json:"log_disk_status"`
	}
	if readSingleObject(resp, &s) != nil || s.LogDiskStatus == "" {
		return "", true
	}
	return s.LogDiskStatus, strings.EqualFold(s.LogDiskStatus, "available")
}

// ── Writes ───────────────────────────────────────────────────────────────────
//
// One PUT per table, and each one is separate on purpose: a firewall that refuses the disk settings
// (because it has no disk) must not discard a syslog change made in the same submission.

func (f *FortiClient) UpdateLogEvents(e FGLogEvents) error {
	body := map[string]any{
		"fwpolicy-implicit-log":   onOff(e.ImplicitDenyLog),
		"local-in-allow":          onOff(e.LocalInAllow),
		"local-in-deny-unicast":   onOff(e.LocalInDenyUnicast),
		"local-in-deny-broadcast": onOff(e.LocalInDenyBroadcast),
		"local-out":               onOff(e.LocalOut),
		"log-invalid-packet":      onOff(e.LogInvalidPacket),
		"resolve-ip":              onOff(e.ResolveIP),
		"resolve-port":            onOff(e.ResolvePort),
		"brief-traffic-format":    onOff(e.BriefTrafficFormat),
		"user-anonymize":          onOff(e.UserAnonymize),
		"log-policy-comment":      onOff(e.LogPolicyComment),
	}
	_, err := f.do("PUT", "/api/v2/cmdb/log/setting", body)
	return err
}

func (f *FortiClient) UpdateLogMemory(m FGLogMemory) error {
	_, err := f.do("PUT", "/api/v2/cmdb/log.memory/setting", map[string]any{"status": onOff(m.Enabled)})
	return err
}

func (f *FortiClient) UpdateLogDisk(d FGLogDisk) error {
	body := map[string]any{
		"status":        onOff(d.Enabled),
		"roll-schedule": d.RollSchedule,
		"diskfull":      d.DiskFull,
		"upload":        onOff(d.Upload),
	}
	if d.MaxLogFileSizeMB > 0 {
		body["max-log-file-size"] = d.MaxLogFileSizeMB
	}
	if d.MaximumLogAgeDays >= 0 {
		body["maximum-log-age"] = d.MaximumLogAgeDays
	}
	// roll-day only means anything on a weekly schedule, and roll-time is a "hh:mm" the device
	// rejects when empty.
	if d.RollSchedule == "weekly" && d.RollDay != "" {
		body["roll-day"] = d.RollDay
	}
	if strings.TrimSpace(d.RollTime) != "" {
		body["roll-time"] = d.RollTime
	}
	_, err := f.do("PUT", "/api/v2/cmdb/log.disk/setting", body)
	return err
}

func (f *FortiClient) UpdateLogSyslog(s FGLogSyslog) error {
	body := map[string]any{
		"status":   onOff(s.Enabled),
		"server":   strings.TrimSpace(s.Server),
		"mode":     s.Mode,
		"facility": s.Facility,
		"format":   s.Format,
		"priority": s.Priority,
	}
	if s.Port > 0 {
		body["port"] = s.Port
	}
	if s.MaxLogRate >= 0 {
		body["max-log-rate"] = s.MaxLogRate
	}
	// source-ip and certificate are only sent when set. An empty certificate name is not a valid
	// reference, and the device answers -3 (entry not found in datasource) for one.
	if strings.TrimSpace(s.SourceIP) != "" {
		body["source-ip"] = strings.TrimSpace(s.SourceIP)
	}
	if s.EncAlgorithm != "" {
		body["enc-algorithm"] = s.EncAlgorithm
	}
	if strings.TrimSpace(s.Certificate) != "" {
		body["certificate"] = strings.TrimSpace(s.Certificate)
	}
	_, err := f.do("PUT", "/api/v2/cmdb/log.syslogd/setting", body)
	return err
}

func (f *FortiClient) UpdateLogFortiAnalyzer(a FGLogFortiAnalyzer) error {
	body := map[string]any{
		"status":                   onOff(a.Enabled),
		"server":                   strings.TrimSpace(a.Server),
		"upload-option":            a.UploadOption,
		"reliable":                 onOff(a.Reliable),
		"certificate-verification": onOff(a.CertificateVerification),
	}
	if strings.TrimSpace(a.AltServer) != "" {
		body["alt-server"] = strings.TrimSpace(a.AltServer)
	}
	if strings.TrimSpace(a.SourceIP) != "" {
		body["source-ip"] = strings.TrimSpace(a.SourceIP)
	}
	if a.EncAlgorithm != "" {
		body["enc-algorithm"] = a.EncAlgorithm
	}
	if a.SSLMinProtoVersion != "" {
		body["ssl-min-proto-version"] = a.SSLMinProtoVersion
	}
	if a.MaxLogRate >= 0 {
		body["max-log-rate"] = a.MaxLogRate
	}
	_, err := f.do("PUT", "/api/v2/cmdb/log.fortianalyzer/setting", body)
	return err
}

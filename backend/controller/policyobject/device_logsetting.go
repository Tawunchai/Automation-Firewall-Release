package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Log & Report ▸ Log Settings, and System ▸ HA Status.
//
// Together because they are the two read-mostly system pages, and because HA has no write path at
// all — see services/fortigate_ha.go for why a web console does not form clusters.

type logEventsInput struct {
	ImplicitDenyLog      bool `json:"implicit_deny_log"`
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

type logDiskInput struct {
	Enabled           bool   `json:"enabled"`
	MaxLogFileSizeMB  int    `json:"max_log_file_size_mb"`
	RollSchedule      string `json:"roll_schedule"`
	RollDay           string `json:"roll_day"`
	RollTime          string `json:"roll_time"`
	DiskFull          string `json:"disk_full"`
	MaximumLogAgeDays int    `json:"maximum_log_age_days"`
	Upload            bool   `json:"upload"`
}

type logSyslogInput struct {
	Enabled      bool   `json:"enabled"`
	Server       string `json:"server"`
	Port         int    `json:"port"`
	Mode         string `json:"mode"`
	Facility     string `json:"facility"`
	Format       string `json:"format"`
	SourceIP     string `json:"source_ip"`
	EncAlgorithm string `json:"enc_algorithm"`
	Certificate  string `json:"certificate"`
	Priority     string `json:"priority"`
	MaxLogRate   int    `json:"max_log_rate"`
}

type logFAZInput struct {
	Enabled                 bool   `json:"enabled"`
	Server                  string `json:"server"`
	AltServer               string `json:"alt_server"`
	UploadOption            string `json:"upload_option"`
	Reliable                bool   `json:"reliable"`
	CertificateVerification bool   `json:"certificate_verification"`
	SourceIP                string `json:"source_ip"`
	EncAlgorithm            string `json:"enc_algorithm"`
	SSLMinProtoVersion      string `json:"ssl_min_proto_version"`
	MaxLogRate              int    `json:"max_log_rate"`
}

// logSettingsInput carries only the sections the caller actually edited.
//
// Pointers, so that "not sent" and "sent empty" are different things. A page that submitted every
// section on every save would rewrite the syslog configuration each time somebody ticked a logging
// option — and on a unit with no log disk, one of those writes fails and would take the others
// with it.
type logSettingsInput struct {
	Events        *logEventsInput `json:"events"`
	Memory        *bool           `json:"memory_enabled"`
	Disk          *logDiskInput   `json:"disk"`
	Syslog        *logSyslogInput `json:"syslog"`
	FortiAnalyzer *logFAZInput    `json:"fortianalyzer"`
}

// validateLogSettings catches what the device takes and then does not do.
func validateLogSettings(inp logSettingsInput) string {
	if s := inp.Syslog; s != nil {
		// Enabled with no server is the trap this page exists to surface: FortiOS accepts it and
		// sends the logs nowhere.
		if s.Enabled && strings.TrimSpace(s.Server) == "" {
			return "a syslog destination needs a server address — switched on without one, it sends nothing"
		}
		if s.Port < 0 || s.Port > 65535 {
			return "the syslog port must be between 0 and 65535"
		}
	}
	if a := inp.FortiAnalyzer; a != nil {
		if a.Enabled && strings.TrimSpace(a.Server) == "" {
			return "a FortiAnalyzer destination needs a server address"
		}
	}
	if d := inp.Disk; d != nil {
		if d.MaxLogFileSizeMB < 0 {
			return "the maximum log file size cannot be negative"
		}
		if d.MaximumLogAgeDays < 0 {
			return "the maximum log age cannot be negative"
		}
	}
	return ""
}

// GET /policy/device/:deviceId/log-settings
func DeviceGetLogSettings(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	s, err := fc.GetLogSettings()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

// PATCH /policy/device/:deviceId/log-settings
//
// Each section is its own PUT on the device. They are applied in order and the first failure stops
// the rest, with the sections that DID apply named in the response — reporting a flat failure when
// three of four writes landed would send the operator looking for changes that are already there.
func DeviceUpdateLogSettings(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp logSettingsInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateLogSettings(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	applied := []string{}
	fail := func(section string, err error) {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "FortiGate refused the " + section + " settings: " + err.Error(),
			"applied": applied,
		})
	}

	if e := inp.Events; e != nil {
		if err := fc.UpdateLogEvents(services.FGLogEvents{
			ImplicitDenyLog:      e.ImplicitDenyLog,
			LocalInAllow:         e.LocalInAllow,
			LocalInDenyUnicast:   e.LocalInDenyUnicast,
			LocalInDenyBroadcast: e.LocalInDenyBroadcast,
			LocalOut:             e.LocalOut,
			LogInvalidPacket:     e.LogInvalidPacket,
			ResolveIP:            e.ResolveIP,
			ResolvePort:          e.ResolvePort,
			BriefTrafficFormat:   e.BriefTrafficFormat,
			UserAnonymize:        e.UserAnonymize,
			LogPolicyComment:     e.LogPolicyComment,
		}); err != nil {
			fail("event", err)
			return
		}
		applied = append(applied, "events")
	}

	if inp.Memory != nil {
		if err := fc.UpdateLogMemory(services.FGLogMemory{Enabled: *inp.Memory}); err != nil {
			fail("memory log", err)
			return
		}
		applied = append(applied, "memory")
	}

	if d := inp.Disk; d != nil {
		if err := fc.UpdateLogDisk(services.FGLogDisk{
			Enabled:           d.Enabled,
			MaxLogFileSizeMB:  d.MaxLogFileSizeMB,
			RollSchedule:      d.RollSchedule,
			RollDay:           d.RollDay,
			RollTime:          d.RollTime,
			DiskFull:          d.DiskFull,
			MaximumLogAgeDays: d.MaximumLogAgeDays,
			Upload:            d.Upload,
		}); err != nil {
			fail("disk log", err)
			return
		}
		applied = append(applied, "disk")
	}

	if s := inp.Syslog; s != nil {
		if err := fc.UpdateLogSyslog(services.FGLogSyslog{
			Enabled: s.Enabled, Server: s.Server, Port: s.Port, Mode: s.Mode,
			Facility: s.Facility, Format: s.Format, SourceIP: s.SourceIP,
			EncAlgorithm: s.EncAlgorithm, Certificate: s.Certificate,
			Priority: s.Priority, MaxLogRate: s.MaxLogRate,
		}); err != nil {
			fail("syslog", err)
			return
		}
		applied = append(applied, "syslog")
	}

	if a := inp.FortiAnalyzer; a != nil {
		if err := fc.UpdateLogFortiAnalyzer(services.FGLogFortiAnalyzer{
			Enabled: a.Enabled, Server: a.Server, AltServer: a.AltServer,
			UploadOption: a.UploadOption, Reliable: a.Reliable,
			CertificateVerification: a.CertificateVerification,
			SourceIP:                a.SourceIP, EncAlgorithm: a.EncAlgorithm,
			SSLMinProtoVersion: a.SSLMinProtoVersion, MaxLogRate: a.MaxLogRate,
		}); err != nil {
			fail("FortiAnalyzer", err)
			return
		}
		applied = append(applied, "fortianalyzer")
	}

	c.JSON(http.StatusOK, gin.H{"message": "log settings updated on device", "applied": applied})
}

// GET /policy/device/:deviceId/ha-status
//
// Read-only. There is no companion write handler and that is the design — see
// services/fortigate_ha.go.
func DeviceGetHAStatus(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	s, err := fc.GetHAStatus()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

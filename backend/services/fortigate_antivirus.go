package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var antivirusProfileTable = cmdbPath{path: "antivirus/profile", noun: "AntiVirus profile"}

// Security profiles — the shared list/delete surface for all six categories, plus the AntiVirus
// profile form. The other five profile types have a file each (fortigate_webfilter.go,
// _dnsfilter.go, _appcontrol.go, _filefilter.go); SSL/SSH inspection is list-only.
//
// Split out of fortigate.go verbatim.

// ── Security Profiles (standalone list pages) ────────────────────────────────

// FGSecurityProfile is a minimal read model shared by the six Security Profiles
// sidebar categories below — enough for a list view (name + comment). Full
// per-type schemas (AV scan modes, FortiGuard categories, etc.) are out of
// scope until create/update support is added for these object types.
type FGSecurityProfile struct {
	Name    string `json:"name"`
	Comment string `json:"comment,omitempty"`
}

// securityProfilePaths maps each Security Profiles sidebar category to its
// FortiGate CMDB path.
var securityProfilePaths = map[string]cmdbPath{
	"antivirus":           {path: "antivirus/profile", noun: "AntiVirus profile"},
	"webfilter":           {path: "webfilter/profile", noun: "Web Filter profile"},
	"dnsfilter":           {path: "dnsfilter/profile", noun: "DNS Filter profile"},
	"application-control": {path: "application/list", noun: "application sensor"},
	"file-filter":         {path: "file-filter/profile", noun: "file filter profile"},
	"ssl-ssh-inspection":  {path: "firewall/ssl-ssh-profile", noun: "SSL/SSH profile"},
	"ips":                 {path: "ips/sensor", noun: "IPS sensor"},
}

// IsValidSecurityProfileCategory reports whether category is one of the seven
// supported Security Profiles sidebar sections.
func IsValidSecurityProfileCategory(category string) bool {
	_, ok := securityProfilePaths[category]
	return ok
}

// hiddenSecurityProfileNames lists built-in objects FortiOS auto-creates that its own
// GUI excludes from the Security Profiles list pages. "sniffer-profile" is generated
// for antivirus/webfilter/dnsfilter/application-control/ips-sensor as the default
// profile for one-arm sniffer policies (Network > Packet Capture) — it isn't
// selectable from ordinary firewall policies, so the real GUI hides it there too
// (confirmed against a live FortiGate 7.2.10: CMDB returns it, GUI list does not).
var hiddenSecurityProfileNames = map[string]bool{
	"sniffer-profile": true,
}

// GetSecurityProfiles fetches name+comment for every object of the given category,
// filtering out built-in objects the real GUI itself hides (see hiddenSecurityProfileNames).
func (f *FortiClient) GetSecurityProfiles(category string) ([]FGSecurityProfile, error) {
	table, ok := securityProfilePaths[category]
	if !ok {
		return nil, fmt.Errorf("unknown security profile category: %s", category)
	}
	items, err := cmdbRaws[FGSecurityProfile](f, table, "fields=name,comment")
	if err != nil {
		return nil, err
	}
	out := items[:0]
	for _, it := range items {
		if hiddenSecurityProfileNames[it.Name] {
			continue
		}
		out = append(out, it)
	}
	return out, nil
}

// DeleteSecurityProfile removes a single object of the given category by name.
func (f *FortiClient) DeleteSecurityProfile(category, name string) error {
	table, ok := securityProfilePaths[category]
	if !ok {
		return fmt.Errorf("unknown security profile category: %s", category)
	}
	return table.Delete(f, name)
}

// ── AntiVirus Profile (create/update) ─────────────────────────────────────────
//
// AVProfileForm is our simplified, GUI-shaped view of a FortiGate antivirus/profile
// object — one flat struct mirroring exactly the toggles on FortiOS's own "New
// AntiVirus Profile" page (flow-based / feature-set=flow, the FortiOS default).
// avProfilePayload / fgToAVProfileForm convert this to/from the real nested FortiGate
// CMDB JSON so the frontend never has to know FortiGate's nested schema.
//
// Field mapping, from the FortiOS 6.4–7.4 CLI reference (config antivirus profile):
//
//	Inspected Protocols (HTTP/SMTP/POP3/IMAP/FTP/CIFS) → per-protocol "options" containing "scan"
//	"Treat Windows executables in email attachments as viruses" → smtp/pop3/imap "executables" {default|virus}
//	"Include mobile malware protection"      → top-level "mobile-malware-db" {enable|disable}
//	"Quarantine"                              → nac-quar.infected {none|quar-src-ip}
//	"Use FortiGuard outbreak prevention database" → outbreak-prevention.ftgd-service {enable|disable}
//	"Use external malware block list"        → outbreak-prevention.external-blocklist {enable|disable}
//
// "Send files to FortiSandbox for inspection" (fortisandbox-mode) and "Use EMS threat
// feed" (outbreak-prevention.ems-threat-feed) are best-effort field names from Fortinet's
// public docs — NOT yet confirmed against a live device. If FortiGate rejects either
// field, its error message names the exact bad key (surfaced verbatim to the frontend).
type AVProfileForm struct {
	Name    string `json:"name"`
	Comment string `json:"comment"`

	HTTPScan bool `json:"http_scan"`
	SMTPScan bool `json:"smtp_scan"`
	POP3Scan bool `json:"pop3_scan"`
	IMAPScan bool `json:"imap_scan"`
	FTPScan  bool `json:"ftp_scan"`
	CIFSScan bool `json:"cifs_scan"`

	TreatWinExecAsVirus     bool `json:"treat_win_exec_as_virus"`
	SendFilesToSandbox      bool `json:"send_files_to_sandbox"`
	MobileMalwareProtection bool `json:"mobile_malware_protection"`
	Quarantine              bool `json:"quarantine"`

	UseOutbreakDB        bool `json:"use_outbreak_db"`
	UseExternalBlocklist bool `json:"use_external_blocklist"`
	UseEMSThreatFeed     bool `json:"use_ems_threat_feed"`
}

// avProfilePayload builds the nested FortiGate CMDB JSON body for POST/PUT
// antivirus/profile from our simplified form. Every field is sent explicitly
// (no omitempty) so an update can turn a previously-enabled option back off.
//
// FortiOS 7.2 flow-mode stores EVERY antivirus setting PER-PROTOCOL
// (http/ftp/cifs/smtp/pop3/imap). Each protocol sub-object has its own "av-scan",
// "fortisandbox", "outbreak-prevention", "external-blocklist" and "quarantine" fields —
// all of type option {disable|block|monitor} (quarantine is {disable|enable}). "block"
// means "scan and block", the GUI's default AntiVirus-scan mode.
//
// This shape was verified against a live FortiGate 7.2.10 (FGT80E): the older top-level
// "options"/"fortisandbox-mode"/"outbreak-prevention{}" shape returns HTTP 200 but is
// SILENTLY IGNORED (read-back shows av-scan=disable and no outbreak-prevention key), so it
// never actually enabled scanning. The per-protocol shape below reads back correctly.
func avProfilePayload(form AVProfileForm) map[string]interface{} {
	onOff := func(on bool) string {
		if on {
			return "block"
		}
		return "disable"
	}
	// protocol builds one per-protocol sub-object. The APT/outbreak sub-features are only
	// applied when that protocol is actually being scanned — turning a protocol off clears
	// its sub-features too, matching the GUI's "No scan options set" behavior. mail=true
	// adds "executables" ("Treat Windows executables in email attachments as viruses"),
	// which is valid only on smtp/pop3/imap.
	protocol := func(scan, mail bool) map[string]interface{} {
		p := map[string]interface{}{
			"av-scan":             onOff(scan),
			"fortisandbox":        onOff(scan && form.SendFilesToSandbox),
			"outbreak-prevention": onOff(scan && form.UseOutbreakDB),
			"external-blocklist":  onOff(scan && form.UseExternalBlocklist),
			"quarantine":          FGBoolToString(scan && form.Quarantine),
		}
		if mail {
			exec := "default"
			if form.TreatWinExecAsVirus {
				exec = "virus"
			}
			p["executables"] = exec
		}
		return p
	}

	nacInfected := "none"
	if form.Quarantine {
		nacInfected = "quar-src-ip"
	}

	return map[string]interface{}{
		"name":              form.Name,
		"comment":           form.Comment,
		"feature-set":       "flow",
		"http":              protocol(form.HTTPScan, false),
		"ftp":               protocol(form.FTPScan, false),
		"cifs":              protocol(form.CIFSScan, false),
		"smtp":              protocol(form.SMTPScan, true),
		"pop3":              protocol(form.POP3Scan, true),
		"imap":              protocol(form.IMAPScan, true),
		"mobile-malware-db": FGBoolToString(form.MobileMalwareProtection),
		"ems-threat-feed":   FGBoolToString(form.UseEMSThreatFeed), // top-level, not per-protocol
		"nac-quar": map[string]interface{}{
			"infected": nacInfected,
		},
	}
}

// fgToAVProfileForm parses one antivirus/profile CMDB object into our simplified form,
// tolerant of missing sub-tables (older FortiOS builds / proxy-mode profiles).
func fgToAVProfileForm(raw json.RawMessage) AVProfileForm {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return AVProfileForm{}
	}
	getString := func(src map[string]json.RawMessage, key string) string {
		if src == nil {
			return ""
		}
		if v, ok := src[key]; ok {
			var s string
			json.Unmarshal(v, &s) //nolint:errcheck
			return s
		}
		return ""
	}
	getSub := func(key string) map[string]json.RawMessage {
		if v, ok := m[key]; ok {
			var sub map[string]json.RawMessage
			if json.Unmarshal(v, &sub) == nil {
				return sub
			}
		}
		return nil
	}
	// Per-protocol option fields are {disable|block|monitor}; anything other than
	// ""/"disable" counts as "on". (Verified against a live FortiGate 7.2.10.)
	on := func(sub map[string]json.RawMessage, field string) bool {
		v := getString(sub, field)
		return v != "" && v != "disable"
	}

	http, ftp, cifs := getSub("http"), getSub("ftp"), getSub("cifs")
	smtp, pop3, imap := getSub("smtp"), getSub("pop3"), getSub("imap")
	nacQuar := getSub("nac-quar")
	all := []map[string]json.RawMessage{http, ftp, cifs, smtp, pop3, imap}

	// The GUI presents FortiSandbox / outbreak / external-blocklist / quarantine as single
	// profile-wide toggles, but FortiOS stores them per-protocol — treat the toggle as "on"
	// if ANY inspected protocol has it enabled.
	anyOn := func(field string) bool {
		for _, s := range all {
			if on(s, field) {
				return true
			}
		}
		return false
	}

	return AVProfileForm{
		Name:    getString(m, "name"),
		Comment: getString(m, "comment"),

		HTTPScan: on(http, "av-scan"),
		FTPScan:  on(ftp, "av-scan"),
		CIFSScan: on(cifs, "av-scan"),
		SMTPScan: on(smtp, "av-scan"),
		POP3Scan: on(pop3, "av-scan"),
		IMAPScan: on(imap, "av-scan"),

		TreatWinExecAsVirus: getString(smtp, "executables") == "virus" ||
			getString(pop3, "executables") == "virus" ||
			getString(imap, "executables") == "virus",

		SendFilesToSandbox:      anyOn("fortisandbox"),
		MobileMalwareProtection: FGStringToBool(getString(m, "mobile-malware-db")),
		Quarantine:              anyOn("quarantine") || getString(nacQuar, "infected") == "quar-src-ip",

		UseOutbreakDB:        anyOn("outbreak-prevention"),
		UseExternalBlocklist: anyOn("external-blocklist"),
		UseEMSThreatFeed:     FGStringToBool(getString(m, "ems-threat-feed")),
	}
}

// AVCapabilities reports whether the device supports two AntiVirus-profile options that the
// FortiGate GUI itself greys out when unavailable — so our create/edit form can grey them
// out for the same reasons instead of letting the user toggle something the device ignores.
type AVCapabilities struct {
	// FortiSandbox is true when a FortiSandbox connector is configured (system.fortisandbox
	// status=enable). Gates "Send files to FortiSandbox for inspection" — the device forces
	// the per-protocol fortisandbox field back to "disable" when no sandbox is configured.
	FortiSandbox bool `json:"fortisandbox"`
	// FortiGuardAVLicense is true when the FortiGuard AntiVirus subscription is active. Gates
	// "Use FortiGuard outbreak prevention database", which needs that entitlement to function.
	FortiGuardAVLicense bool `json:"fortiguard_av_license"`
}

// GetAVProfileCapabilities probes the device for the two capability signals above. It never
// hard-fails: any probe error leaves that capability at its zero value (false = unavailable),
// so a transient error greys the toggle rather than wrongly enabling it.
func (f *FortiClient) GetAVProfileCapabilities() AVCapabilities {
	caps := AVCapabilities{}

	// FortiSandbox connector config (complex singleton → results is an object).
	if resp, err := f.do("GET", "/api/v2/cmdb/system/fortisandbox", nil); err == nil {
		var m map[string]json.RawMessage
		if json.Unmarshal(resp.Results, &m) == nil {
			var status string
			json.Unmarshal(m["status"], &status) //nolint:errcheck
			caps.FortiSandbox = strings.EqualFold(status, "enable")
		}
	}

	// FortiGuard subscription status (monitor → results keyed by service name).
	if resp, err := f.do("GET", "/api/v2/monitor/license/status", nil); err == nil {
		var m map[string]json.RawMessage
		if json.Unmarshal(resp.Results, &m) == nil {
			var av struct {
				Status string `json:"status"`
			}
			json.Unmarshal(m["antivirus"], &av) //nolint:errcheck
			s := strings.ToLower(av.Status)
			// "expired", "no_license", "not_supported" (and empty) all grey the GUI toggle.
			caps.FortiGuardAVLicense = s != "" && s != "expired" && s != "no_license" && s != "not_supported"
		}
	}

	return caps
}

// GetAVProfile fetches a single antivirus/profile object by name for the edit form.
// Logs the raw CMDB object so a wrong/missing field can be diagnosed against what the
// live device actually returned, without needing a separate packet capture.
func (f *FortiClient) GetAVProfile(name string) (AVProfileForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/antivirus/profile/"+url.PathEscape(name), nil)
	if err != nil {
		return AVProfileForm{}, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return AVProfileForm{}, fmt.Errorf("antivirus profile %q not found", name)
	}
	log.Printf("[fortigate] GET antivirus/profile/%s raw=%s", name, items[0])
	form := fgToAVProfileForm(items[0])
	log.Printf("[fortigate] GET antivirus/profile/%s parsed=%+v", name, form)
	return form, nil
}

// CreateAVProfile creates a new antivirus/profile object on the device.
func (f *FortiClient) CreateAVProfile(form AVProfileForm) error {
	payload := avProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST antivirus/profile payload=%s", b)
	}
	return antivirusProfileTable.Create(f, payload)
}

// UpdateAVProfile overwrites an existing antivirus/profile object by name.
func (f *FortiClient) UpdateAVProfile(name string, form AVProfileForm) error {
	payload := avProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT antivirus/profile/%s payload=%s", name, b)
	}
	return antivirusProfileTable.Update(f, name, payload)
}

package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ── Audit: the management plane ──────────────────────────────────────────────
//
// The rule-base checks next door answer "what can cross this firewall?". Everything here answers
// the other half of the same question, and the half every framework asks about first: "who can
// reach the firewall itself, and is what it does written down anywhere?"
//
// Until this file existed, roughly twenty controls in the universe were reported as not-assessed
// with the same shape of reason — "needs the device's administrative settings", "needs each
// interface's allowaccess list", "needs the device's log settings". Those are all one CMDB read
// each. The rows were honest and they were also a to-do list.
//
// WHAT THE LAB FGT80E ACTUALLY SAID, the first time this ran. Two of these were invisible to the
// console before and neither is theoretical:
//
//	wan1 allowaccess = "ping https ssh http"   → administrator credentials in clear text, on the
//	                                             interface holding the default route
//	log setting fwpolicy-implicit-log = disable → the implicit deny that blocks everything writes
//	                                             no log; invalid access attempts were unrecorded
//
// The rest of the box came back clean — admintimeout 5, lockout 3/60, ntpsync enable, src-check
// enable on every routable interface — which matters just as much: before this file the Standards
// tab could produce gaps and could not produce a single piece of positive evidence.
//
// EVERY FIELD NAME HERE WAS READ OFF THE LIVE DEVICE, not from documentation. The values in the
// comments above are what 10.0.99.201 returned on 2026-08-20.

// ── What the scan reads ─────────────────────────────────────────────────────

// FGAdminAccount is one administrator, as system/admin reports it.
type FGAdminAccount struct {
	Name       string
	AccProfile string
	// TrustHosts are the trusted-host entries, "any" ones removed. FortiOS stores ten slots and
	// fills the unused ones with 0.0.0.0 0.0.0.0 — which MEANS any host, so an account whose slots
	// are all that value is unrestricted, not unconfigured. Reading "trusthost1 is set" as "this
	// account is restricted" is the trap this field exists to avoid.
	TrustHosts []string
	TwoFactor  string
}

// FGInterfacePosture is one interface, from the security angle rather than the addressing one.
type FGInterfacePosture struct {
	Name string
	Type string
	// AllowAccess is the management protocols the interface answers on: ping https ssh http telnet
	// snmp fgfm fabric … CMDB returns them as one space-separated string.
	AllowAccess []string
	// SrcCheck is the reverse-path (anti-spoofing) setting: enable | disable | strict.
	SrcCheck string
	// Addressed is whether the interface currently holds an IP. It changes nothing about whether a
	// setting is a finding — a configuration review reads the configuration — but it is the fact
	// that explains why this scan and the device's own Security Rating can differ on the same
	// interface, so the finding says it rather than leaving the reader to discover it.
	Addressed bool
	// Routable is true when the interface carries a real address and is not a system-generated
	// tunnel. Anti-spoofing is meaningless on the others, and FortiOS creates several of them
	// (naf.root, ssl.root, l2t.root) that nobody configured and nobody can fix.
	Routable bool
}

// systemPosture is everything the management-plane checks need, in one struct.
//
// Each section carries its own OK flag. A device that will not answer for its administrators still
// gets audited on its interfaces, exactly like the rule-base reads — and the control that depended
// on the section that failed is reported as indeterminate rather than as passing.
type systemPosture struct {
	AdminTimeout     int
	LockoutThreshold int
	GlobalOK         bool

	Admins   []FGAdminAccount
	AdminsOK bool

	Interfaces []FGInterfacePosture
	IntfOK     bool

	NTPSync string
	NTPOK   bool

	ImplicitDenyLog string
	LogSettingOK    bool

	// LogTargets names every remote destination that is switched on. Empty with LogTargetsOK true
	// is a real finding; empty with it false means nothing could be read.
	LogTargets   []string
	LogTargetsOK bool

	FirmwareCurrent string
	FirmwareLatest  string
	// FirmwareOK is whether the device could tell us what is available at all. On a box whose
	// FortiGuard entitlement has lapsed the "available" list comes back empty, which is
	// indistinguishable from "you are on the newest build" — so an empty list is reported as
	// undetermined, never as up to date.
	FirmwareOK bool
}

// ── Reading it ──────────────────────────────────────────────────────────────

// readSystemPosture fetches the management plane in one parallel pass.
//
// Thirteen GETs. Issued together they cost about as much as the slowest, which is what lets the
// audit add a whole second dimension without becoming slower to run — see Parallel.
func (f *FortiClient) readSystemPosture() systemPosture {
	var sp systemPosture

	// Remote log destinations. FortiOS keeps each in its own table, and 7.2.10 answers for all
	// seven whether or not they are configured (confirmed live).
	type logTarget struct {
		path  string
		label string
	}
	targets := []logTarget{
		{"log.syslogd/setting", "syslog"},
		{"log.syslogd2/setting", "syslog (2)"},
		{"log.syslogd3/setting", "syslog (3)"},
		{"log.fortianalyzer/setting", "FortiAnalyzer"},
		{"log.fortianalyzer2/setting", "FortiAnalyzer (2)"},
		{"log.fortianalyzer3/setting", "FortiAnalyzer (3)"},
		{"log.fortiguard/setting", "FortiGate Cloud"},
	}
	enabled := make([]bool, len(targets))
	readOK := make([]bool, len(targets))

	fns := []func(){
		func() { sp.readGlobal(f) },
		func() { sp.readAdmins(f) },
		func() { sp.readInterfaces(f) },
		func() { sp.readNTP(f) },
		func() { sp.readLogSetting(f) },
		func() { sp.readFirmware(f) },
	}
	for i, t := range targets {
		i, t := i, t
		fns = append(fns, func() {
			on, ok := f.logTargetEnabled(t.path)
			enabled[i], readOK[i] = on, ok
		})
	}
	Parallel(fns...)

	// A single unreadable table is enough to make "nothing is forwarding logs" unprovable: the one
	// that failed could be the one that is on.
	sp.LogTargetsOK = true
	for i, t := range targets {
		if !readOK[i] {
			sp.LogTargetsOK = false
			continue
		}
		if enabled[i] {
			sp.LogTargets = append(sp.LogTargets, t.label)
		}
	}

	return sp
}

func (sp *systemPosture) readGlobal(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/global", nil)
	if err != nil {
		return
	}
	var g struct {
		AdminTimeout     int `json:"admintimeout"`
		LockoutThreshold int `json:"admin-lockout-threshold"`
	}
	if json.Unmarshal(resp.Results, &g) != nil {
		return
	}
	sp.AdminTimeout, sp.LockoutThreshold, sp.GlobalOK = g.AdminTimeout, g.LockoutThreshold, true
}

// anyTrustHost is the value FortiOS writes into every unused trusted-host slot. It does not mean
// "not set" — it means "any host", which is the opposite of what the field name suggests.
const anyTrustHost = "0.0.0.0 0.0.0.0"

func (sp *systemPosture) readAdmins(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/admin", nil)
	if err != nil {
		return
	}
	var raw []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &raw) != nil {
		return
	}
	str := func(m map[string]json.RawMessage, key string) string {
		v, ok := m[key]
		if !ok {
			return ""
		}
		var s string
		_ = json.Unmarshal(v, &s)
		return strings.TrimSpace(s)
	}
	for _, m := range raw {
		a := FGAdminAccount{Name: str(m, "name"), AccProfile: str(m, "accprofile"), TwoFactor: str(m, "two-factor")}
		for i := 1; i <= 10; i++ {
			h := str(m, fmt.Sprintf("trusthost%d", i))
			if h == "" || h == anyTrustHost {
				continue
			}
			a.TrustHosts = append(a.TrustHosts, h)
		}
		sp.Admins = append(sp.Admins, a)
	}
	sp.AdminsOK = true
}

// routableIntfTypes are the interface kinds anti-spoofing applies to. Tunnels are excluded because
// FortiOS generates naf.root / ssl.root / l2t.root itself and reverse-path checking on them is not
// a decision anybody made.
var routableIntfTypes = map[string]bool{
	"physical": true, "aggregate": true, "vlan": true,
	"hard-switch": true, "switch": true, "redundant": true, "wifi": true,
}

func (sp *systemPosture) readInterfaces(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/interface", nil)
	if err != nil {
		return
	}
	var raw []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &raw) != nil {
		return
	}
	str := func(m map[string]json.RawMessage, key string) string {
		v, ok := m[key]
		if !ok {
			return ""
		}
		var s string
		_ = json.Unmarshal(v, &s)
		return strings.TrimSpace(s)
	}
	for _, m := range raw {
		typ := str(m, "type")
		ip := str(m, "ip")
		hasIP := ip != "" && !strings.HasPrefix(ip, "0.0.0.0")
		sp.Interfaces = append(sp.Interfaces, FGInterfacePosture{
			Name:        str(m, "name"),
			Type:        typ,
			AllowAccess: strings.Fields(str(m, "allowaccess")),
			SrcCheck:    str(m, "src-check"),
			Addressed:   hasIP,
			Routable:    routableIntfTypes[typ] && hasIP,
		})
	}
	sp.IntfOK = true
}

func (sp *systemPosture) readNTP(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/ntp", nil)
	if err != nil {
		return
	}
	var n struct {
		NTPSync string `json:"ntpsync"`
	}
	if json.Unmarshal(resp.Results, &n) != nil {
		return
	}
	sp.NTPSync, sp.NTPOK = n.NTPSync, true
}

func (sp *systemPosture) readLogSetting(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/cmdb/log/setting", nil)
	if err != nil {
		return
	}
	var l struct {
		ImplicitLog string `json:"fwpolicy-implicit-log"`
	}
	if json.Unmarshal(resp.Results, &l) != nil {
		return
	}
	sp.ImplicitDenyLog, sp.LogSettingOK = l.ImplicitLog, true
}

func (f *FortiClient) logTargetEnabled(path string) (on, ok bool) {
	resp, err := f.do("GET", "/api/v2/cmdb/"+path, nil)
	if err != nil {
		return false, false
	}
	var t struct {
		Status string `json:"status"`
	}
	if json.Unmarshal(resp.Results, &t) != nil {
		return false, false
	}
	return strings.EqualFold(t.Status, "enable"), true
}

func (sp *systemPosture) readFirmware(f *FortiClient) {
	resp, err := f.do("GET", "/api/v2/monitor/system/firmware", nil)
	if err != nil {
		return
	}
	var r struct {
		Current struct {
			Version string `json:"version"`
			Build   int    `json:"build"`
		} `json:"current"`
		Available []struct {
			Version string `json:"version"`
			Build   int    `json:"build"`
		} `json:"available"`
	}
	if json.Unmarshal(resp.Results, &r) != nil {
		return
	}
	sp.FirmwareCurrent = r.Current.Version

	// An empty list is NOT "you are on the newest build". On the lab device, whose FortiGuard
	// entitlement has lapsed, the device cannot fetch the catalogue at all and returns nothing —
	// which looks exactly like being current. Only a non-empty list is evidence of anything.
	if len(r.Available) == 0 {
		return
	}
	sp.FirmwareOK = true
	// "available" is ordered newest first; the first entry that is not the running build is the
	// upgrade being offered.
	for _, a := range r.Available {
		if a.Build != r.Current.Build && a.Version != "" {
			sp.FirmwareLatest = a.Version
			break
		}
	}
}

// ── The checks ──────────────────────────────────────────────────────────────

// cleartextMgmtProtocols are the management services that carry an administrator's credentials in
// the clear. `http` is FortiOS's plain-HTTP GUI and `telnet` its plain-TCP CLI.
//
// snmp is deliberately not here: v1/v2c is cleartext, v3 is not, and allowaccess does not say
// which the device is running. A check that cannot tell the difference would report every SNMP
// deployment as a failure, which is how a finding stops being read.
var cleartextMgmtProtocols = map[string]string{
	"http":   "the plain-HTTP administrative GUI",
	"telnet": "the plain-TCP administrative CLI",
}

// maxAdminIdleMinutes is PCI DSS 8.2.8's number. It is quoted here rather than chosen: the
// requirement is that an idle session is re-authenticated after no more than 15 minutes.
const maxAdminIdleMinutes = 15

// findings turns the posture into findings, plus the checks it could not evaluate and the notes
// explaining why.
//
// wanIntf is the interface holding the default route, used only to say how exposed a cleartext
// management service is. An empty wanIntf downgrades the wording, never the finding: cleartext
// management is worth reporting wherever it is.
func (sp systemPosture) findings(wanIntf string) (out []AuditFinding, undecided map[string]bool, notes []string) {
	undecided = map[string]bool{}

	// ── Cleartext management ──
	if !sp.IntfOK {
		notes = append(notes, "the device's interface list could not be read — administrative access and anti-spoofing could not be evaluated")
		undecided["mgmt-cleartext-access"] = true
		undecided["intf-no-antispoof"] = true
	} else {
		for _, i := range sp.Interfaces {
			var bad []string
			for _, svc := range i.AllowAccess {
				if desc, ok := cleartextMgmtProtocols[strings.ToLower(svc)]; ok {
					bad = append(bad, svc+" — "+desc)
				}
			}
			if len(bad) == 0 {
				continue
			}
			// On the interface holding the default route the credentials cross the internet. That
			// is a different finding from the same setting on a lab LAN, and the severity says so.
			severity, where := SeverityMedium, "on this interface"
			if wanIntf != "" && strings.EqualFold(i.Name, wanIntf) {
				severity, where = SeverityHigh, "on the interface holding the default route, so credentials cross the internet in clear text"
			}
			// An unaddressed interface still carries the setting, and the setting is what a
			// configuration review is about — PCI 2.2.7 asks how administrative access is
			// configured, not whether anybody can reach it this minute. Stated because the
			// device's own Security Rating appears to skip such interfaces, and a reader looking
			// at both assessments deserves the fact that explains the difference rather than a
			// contradiction with no account of itself.
			reach := ""
			if !i.Addressed {
				reach = " The interface holds no address at present, so nothing can reach it right now; the permission is in the configuration and takes effect the moment one is assigned."
			}
			out = append(out, AuditFinding{
				Check: "mgmt-cleartext-access", Severity: severity, Category: "Management",
				Title: "The firewall answers administrative requests in clear text",
				Detail: fmt.Sprintf("interface %s permits %s %s. Anyone able to observe the path can read the administrator's password and session, and alter what is sent back.%s",
					i.Name, strings.Join(bad, " and "), where, reach),
				Subject:    fmt.Sprintf("interface %q", i.Name),
				ObjectKind: "interface", ObjectName: i.Name,
				Fix:        fixOf(allowAccessFix(i.Name)),
				FixTargets: targetsOf(allowAccessFix(i.Name)),
			})
		}

		// ── Anti-spoofing ──
		for _, i := range sp.Interfaces {
			if !i.Routable || !strings.EqualFold(i.SrcCheck, "disable") {
				continue
			}
			out = append(out, AuditFinding{
				Check: "intf-no-antispoof", Severity: SeverityMedium, Category: "Management",
				Title: "Reverse-path checking is off, so forged source addresses are accepted",
				Detail: fmt.Sprintf("interface %s has src-check disable. A packet claiming to come from a network that does not live behind this interface is forwarded anyway, which is what anti-spoofing exists to stop.",
					i.Name),
				Subject:    fmt.Sprintf("interface %q", i.Name),
				ObjectKind: "interface", ObjectName: i.Name,
				Fix:        fixOf(srcCheckFix(i.Name)),
				FixTargets: targetsOf(srcCheckFix(i.Name)),
			})
		}
	}

	// ── Administrator accounts ──
	if !sp.AdminsOK {
		notes = append(notes, "the device's administrator accounts could not be read — trusted-host restrictions could not be evaluated")
		undecided["admin-unrestricted"] = true
	} else {
		for _, a := range sp.Admins {
			if len(a.TrustHosts) > 0 {
				continue
			}
			out = append(out, AuditFinding{
				Check: "admin-unrestricted", Severity: SeverityMedium, Category: "Management",
				Title: "An administrator account may be used from anywhere",
				Detail: fmt.Sprintf("account %q (%s) has no trusted host set — every slot is %s, which FortiOS reads as \"any address\". Whoever obtains this password can use it from any network the firewall answers on.",
					a.Name, orUnknown(a.AccProfile), anyTrustHost),
				Subject:    fmt.Sprintf("administrator %q", a.Name),
				ObjectKind: "administrator", ObjectName: a.Name,
				Fix:        fixOf(trustHostFix(a.Name)),
				FixTargets: targetsOf(trustHostFix(a.Name)),
			})
		}
	}

	// ── Idle timeout and lockout ──
	if !sp.GlobalOK {
		notes = append(notes, "the device's global administrative settings could not be read — idle timeout and lockout could not be evaluated")
		undecided["admin-timeout-long"] = true
		undecided["admin-lockout-weak"] = true
	} else {
		if sp.AdminTimeout == 0 || sp.AdminTimeout > maxAdminIdleMinutes {
			detail := fmt.Sprintf("admintimeout is %d minutes.", sp.AdminTimeout)
			if sp.AdminTimeout == 0 {
				detail = "admintimeout is 0, which disables the idle timeout entirely."
			}
			out = append(out, AuditFinding{
				Check: "admin-timeout-long", Severity: SeverityMedium, Category: "Management",
				Title: "An idle administrative session is not closed soon enough",
				Detail: detail + fmt.Sprintf(" A session left open on an unattended screen stays usable. %d minutes is the longest PCI DSS 8.2.8 allows.",
					maxAdminIdleMinutes),
				Subject:    "system global admintimeout",
				Fix:        fixOf(adminTimeoutFix()),
				FixTargets: targetsOf(adminTimeoutFix()),
			})
		}
		if sp.LockoutThreshold <= 0 {
			out = append(out, AuditFinding{
				Check: "admin-lockout-weak", Severity: SeverityLow, Category: "Management",
				Title:      "Failed administrative logins are never locked out",
				Detail:     "admin-lockout-threshold is 0, so a password can be guessed at indefinitely. FortiOS locks an account out after the configured number of failures.",
				Subject:    "system global admin-lockout-threshold",
				Fix:        fixOf(lockoutFix()),
				FixTargets: targetsOf(lockoutFix()),
			})
		}
	}

	// ── Clock ──
	if !sp.NTPOK {
		notes = append(notes, "the device's NTP configuration could not be read — clock synchronisation could not be evaluated")
		undecided["time-not-synced"] = true
	} else if !strings.EqualFold(sp.NTPSync, "enable") {
		out = append(out, AuditFinding{
			Check: "time-not-synced", Severity: SeverityMedium, Category: "Logging",
			Title:      "The device's clock is not synchronised",
			Detail:     "ntpsync is disabled. Every log line this firewall writes carries a timestamp nobody can line up against another system's, which is what makes an incident reconstructable.",
			Subject:    "system ntp",
			Fix:        fixOf(ntpFix()),
			FixTargets: targetsOf(ntpFix()),
		})
	}

	// ── Logging ──
	if !sp.LogSettingOK {
		notes = append(notes, "the device's log settings could not be read — whether blocked traffic is recorded could not be evaluated")
		undecided["log-implicit-deny-off"] = true
	} else if !strings.EqualFold(sp.ImplicitDenyLog, "enable") {
		out = append(out, AuditFinding{
			Check: "log-implicit-deny-off", Severity: SeverityMedium, Category: "Logging",
			Title:      "Traffic the firewall blocks by default is not recorded",
			Detail:     "log setting fwpolicy-implicit-log is disabled. Anything no policy matches is dropped by the implicit deny rule at the end of the table, and that drop is written nowhere — so an attempt to reach something forbidden leaves no trace at all, however many times it is repeated.",
			Subject:    "log setting fwpolicy-implicit-log",
			Fix:        fixOf(implicitLogFix()),
			FixTargets: targetsOf(implicitLogFix()),
		})
	}

	if !sp.LogTargetsOK {
		notes = append(notes, "one or more of the device's log destinations could not be read — whether logs leave the device could not be evaluated")
		undecided["log-no-remote"] = true
	} else if len(sp.LogTargets) == 0 {
		out = append(out, AuditFinding{
			Check: "log-no-remote", Severity: SeverityMedium, Category: "Logging",
			Title:      "No log leaves the device",
			Detail:     "No syslog server, FortiAnalyzer or FortiGate Cloud destination is enabled. Everything this firewall records stays on the firewall — where it is lost on a reset, rotated away under load, and editable by whoever gains administrative access.",
			Subject:    "log destinations",
			Fix:        fixOf(syslogFix()),
			FixTargets: targetsOf(syslogFix()),
		})
	}

	// ── Firmware ──
	if !sp.FirmwareOK {
		notes = append(notes, "the device offered no firmware upgrade list, so whether it is running a current build could not be evaluated — a lapsed FortiGuard entitlement returns an empty list, which is indistinguishable from being up to date")
		undecided["firmware-outdated"] = true
	} else if sp.FirmwareLatest != "" {
		out = append(out, AuditFinding{
			Check: "firmware-outdated", Severity: SeverityMedium, Category: "Management",
			Title: "A newer firmware build is being offered",
			Detail: fmt.Sprintf("the device is running %s and is offered %s. Published fixes for known vulnerabilities are not applied until it is taken.",
				orUnknown(sp.FirmwareCurrent), sp.FirmwareLatest),
			Subject: "system firmware",
			Fix:     []string{fmt.Sprintf("# upgrade to %s from System > Firmware, in a maintenance window", sp.FirmwareLatest)},
		})
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Subject < out[j].Subject })
	return out, undecided, notes
}

func orUnknown(s string) string {
	if strings.TrimSpace(s) == "" {
		return "unknown"
	}
	return s
}

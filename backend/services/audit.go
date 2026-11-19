package services

import (
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

// ── Audit / Review Mode ──────────────────────────────────────────────────────
//
// Answers the question an admin asks most often about a firewall someone else built:
// "what is wrong with this thing?"
//
// EVERY CHECK BELOW IS AN ALGORITHM, NOT A JUDGEMENT CALL. Shadowing is set containment on the
// policy table; an over-broad rule is a literal any/any/any; an uninspected egress is a policy
// whose outgoing interface holds the default route with utm-status off; an unused object is
// q_ref == 0. None of it needs a language model, so a scan costs nothing to run and can be run as
// often as you like. (Explaining a finding in prose is the one place an LLM helps, and that is a
// separate, per-finding request — not part of this.)
//
// The engine reads and never writes. Each finding carries the CLI that would fix it, which is
// shown to the user and deliberately NOT executed: this app has already lost a whole policy table
// to one automated delete.

type AuditSeverity string

const (
	SeverityHigh   AuditSeverity = "high"
	SeverityMedium AuditSeverity = "medium"
	SeverityLow    AuditSeverity = "low"
)

// AuditFinding is one thing worth a human's attention.
type AuditFinding struct {
	// Check is a stable slug (policy-shadowed, object-unused, …) so the UI can group and the user
	// can mute a whole class later without depending on wording.
	Check    string        `json:"check"`
	Severity AuditSeverity `json:"severity"`
	Category string        `json:"category"` // Policy · Inspection · Logging · Management · Objects
	Title    string        `json:"title"`
	Detail   string        `json:"detail"`

	// Subject identifies what the finding is about, for the "jump to it" link.
	Subject    string `json:"subject"`
	PolicyID   int    `json:"policy_id,omitempty"`
	ObjectKind string `json:"object_kind,omitempty"` // address · service · schedule · <profile category>
	ObjectName string `json:"object_name,omitempty"`

	// Fix is CLI the user can read, copy and run themselves. Never executed here.
	Fix []string `json:"fix,omitempty"`

	// FixTargets is the same fix as structure: which CMDB attribute each line writes. It is built
	// alongside the CLI by the helpers in audit_fix.go, never parsed back out of it, so the two can
	// never describe different things.
	//
	// It exists so the fix can be CHECKED. audit_fix_verify.go asks the device's own ?action=schema
	// whether each attribute exists on the running firmware and whether an option value is one it
	// accepts — which is the difference between a command somebody here wrote and a command the
	// firewall confirms.
	FixTargets []FixTarget `json:"fix_targets,omitempty"`

	// Controls are the standards this finding speaks to. Filled from the catalogue in
	// audit_standards.go — an interpretation, deliberately kept separate from the computation
	// above, and never presented as a compliance verdict.
	Controls []ControlRef `json:"controls,omitempty"`

	// Accepted is set when somebody has formally decided to live with this finding. The finding is
	// still reported — see services/audit_exceptions.go for why it is never hidden.
	Accepted *AcceptedRisk `json:"accepted,omitempty"`
}

// AcceptedRisk is the sign-off attached to a finding somebody chose not to fix.
type AcceptedRisk struct {
	Reason     string    `json:"reason"`
	ApprovedBy string    `json:"approved_by"`
	ApprovedAt time.Time `json:"approved_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// AuditStats is what the scan looked at — context for "0 findings", which otherwise reads as
// "the scan did not work".
type AuditStats struct {
	Policies         int `json:"policies"`
	PoliciesDisabled int `json:"policies_disabled"`
	Addresses        int `json:"addresses"`
	Services         int `json:"services"`
	Schedules        int `json:"schedules"`
	Profiles         int `json:"profiles"`
}

type AuditReport struct {
	ScannedAt time.Time      `json:"scanned_at"`
	Stats     AuditStats     `json:"stats"`
	Counts    map[string]int `json:"counts"` // severity → n
	Findings  []AuditFinding `json:"findings"`
	// Notes explains anything the scan could not decide — an FQDN address makes shadow detection
	// undecidable, for instance, and silently skipping it would overstate how clean the box is.
	Notes []string `json:"notes,omitempty"`

	// UndecidedChecks names the checks that could not be fully evaluated on this device. It is the
	// machine-readable half of Notes, and it is what stops the standards view from reporting a
	// control as "evidenced" on the strength of a check that gave up half way.
	UndecidedChecks []string `json:"undecided_checks,omitempty"`

	// AcceptedCount is how many of Findings carry a signed acceptance. Counts above excludes them;
	// Findings does not.
	AcceptedCount int `json:"accepted_count"`

	// Standards is the same findings read from the standard's side: control by control, what this
	// scan can and cannot evidence. See audit_standards.go for why it is kept separate.
	Standards []FrameworkCoverage `json:"standards,omitempty"`

	// Methodology spells out what this console means by high/medium/low, direct/supporting and
	// gap/evidenced/indeterminate. It travels with the report so the definition a reader sees is
	// never a different sentence from the one in the PDF.
	Methodology Methodology `json:"methodology"`

	// CheckRationales says why each class of finding matters, with the publication behind it. The
	// UI renders these instead of carrying its own hard-coded explanations.
	CheckRationales []CheckRationale `json:"check_rationales,omitempty"`

	// DeviceSerial / DeviceFirmware identify the box this report is about. FortiOS stamps both on
	// the envelope of every response, so they cost nothing extra — and a compliance document that
	// does not name the device it describes is not evidence of anything.
	DeviceSerial   string `json:"device_serial,omitempty"`
	DeviceFirmware string `json:"device_firmware,omitempty"`

	// ConfigFingerprint identifies the CONFIGURATION this report describes, so two scans can be
	// compared without storing the configuration itself. Stored with the run; the next scan uses it
	// to tell "nothing changed" from "something changed and this console did not do it".
	ConfigFingerprint string `json:"config_fingerprint,omitempty"`
}

// ── IP ranges (shadow detection works on sets, not single addresses) ─────────

type ipRange struct{ Lo, Hi uint32 }

func ipToU32(ip net.IP) (uint32, bool) {
	v4 := ip.To4()
	if v4 == nil {
		return 0, false
	}
	return uint32(v4[0])<<24 | uint32(v4[1])<<16 | uint32(v4[2])<<8 | uint32(v4[3]), true
}

// fgSubnetRange turns "10.0.1.0 255.255.255.0" (or "10.0.1.0/24") into one range.
func fgSubnetRange(spec string) (ipRange, bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return ipRange{}, false
	}
	var base, mask net.IP
	if strings.Contains(spec, "/") {
		ip, n, err := net.ParseCIDR(spec)
		if err != nil {
			return ipRange{}, false
		}
		base, mask = ip.Mask(n.Mask), net.IP(n.Mask)
	} else {
		parts := strings.Fields(spec)
		if len(parts) != 2 {
			return ipRange{}, false
		}
		base, mask = net.ParseIP(parts[0]), net.ParseIP(parts[1])
	}
	b, ok1 := ipToU32(base)
	m, ok2 := ipToU32(mask)
	if !ok1 || !ok2 {
		return ipRange{}, false
	}
	return ipRange{Lo: b & m, Hi: (b & m) | ^m}, true
}

// addrRanges expands a policy's address list into the IP space it covers.
//
// `decidable` is false when any member cannot be expanded from configuration alone (FQDN,
// geography, dynamic). Shadow detection then refuses to draw a conclusion about that policy —
// a false "this rule is dead" on a live firewall is far worse than saying nothing.
func addrRanges(am *addrMatcher, names []string, depth int) (out []ipRange, decidable bool) {
	if depth > 8 {
		return nil, false
	}
	decidable = true
	for _, name := range names {
		if members, ok := am.groups[name]; ok {
			r, d := addrRanges(am, members, depth+1)
			out = append(out, r...)
			decidable = decidable && d
			continue
		}
		if extIP, ok := am.vips[name]; ok {
			if lo, hi, found := strings.Cut(extIP, "-"); found {
				l, ok1 := ipToU32(net.ParseIP(strings.TrimSpace(lo)))
				h, ok2 := ipToU32(net.ParseIP(strings.TrimSpace(hi)))
				if ok1 && ok2 {
					out = append(out, ipRange{l, h})
					continue
				}
			} else if v, ok := ipToU32(net.ParseIP(strings.TrimSpace(extIP))); ok {
				out = append(out, ipRange{v, v})
				continue
			}
			decidable = false
			continue
		}
		a, ok := am.addrs[name]
		if !ok {
			decidable = false
			continue
		}
		switch strings.ToLower(a.Type) {
		case "ipmask", "interface-subnet":
			if r, ok := fgSubnetRange(a.Subnet); ok {
				out = append(out, r)
			} else {
				decidable = false
			}
		case "iprange":
			l, ok1 := ipToU32(net.ParseIP(strings.TrimSpace(a.StartIP)))
			h, ok2 := ipToU32(net.ParseIP(strings.TrimSpace(a.EndIP)))
			if ok1 && ok2 {
				out = append(out, ipRange{l, h})
			} else {
				decidable = false
			}
		default: // fqdn, geography, dynamic, mac
			decidable = false
		}
	}
	return out, decidable
}

// mergeRanges sorts and coalesces overlapping/adjacent ranges so containment is a linear scan.
func mergeRanges(in []ipRange) []ipRange {
	if len(in) == 0 {
		return nil
	}
	cp := append([]ipRange(nil), in...)
	sort.Slice(cp, func(i, j int) bool { return cp[i].Lo < cp[j].Lo })
	out := []ipRange{cp[0]}
	for _, r := range cp[1:] {
		last := &out[len(out)-1]
		// "Adjacent" counts: 10.0.0.0/24 and 10.0.1.0/24 together cover 10.0.0.0/23, and treating
		// them as separate would miss a real shadow.
		if r.Lo <= last.Hi || (last.Hi != ^uint32(0) && r.Lo == last.Hi+1) {
			if r.Hi > last.Hi {
				last.Hi = r.Hi
			}
			continue
		}
		out = append(out, r)
	}
	return out
}

// rangesCover reports whether every address in `inner` falls inside `outer`.
func rangesCover(outer, inner []ipRange) bool {
	if len(inner) == 0 {
		return false
	}
	merged := mergeRanges(outer)
	for _, r := range inner {
		covered := false
		for _, o := range merged {
			if o.Lo <= r.Lo && r.Hi <= o.Hi {
				covered = true
				break
			}
		}
		if !covered {
			return false
		}
	}
	return true
}

// ── Service ranges ───────────────────────────────────────────────────────────

// svcRange is one protocol/port span. Proto -1 is FortiOS's "ALL" service: every IP protocol.
// A protocol that has no ports (ICMP, GRE) uses Lo = Hi = 0.
type svcRange struct {
	Proto  int
	Lo, Hi int
}

func parsePortSpans(spec string, proto int) []svcRange {
	var out []svcRange
	for _, entry := range strings.Fields(spec) {
		dst, _, _ := strings.Cut(entry, ":")
		lo, hi, found := strings.Cut(dst, "-")
		l, err := parseInt(lo)
		if err != nil {
			continue
		}
		h := l
		if found {
			if v, err := parseInt(hi); err == nil {
				h = v
			}
		}
		out = append(out, svcRange{Proto: proto, Lo: l, Hi: h})
	}
	return out
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &n)
	return n, err
}

// svcRanges expands a policy's service list. `decidable` mirrors addrRanges.
func svcRanges(sm *svcMatcher, names []string, depth int) (out []svcRange, decidable bool) {
	if depth > 8 {
		return nil, false
	}
	decidable = true
	for _, name := range names {
		if members, ok := sm.groups[name]; ok {
			r, d := svcRanges(sm, members, depth+1)
			out = append(out, r...)
			decidable = decidable && d
			continue
		}
		s, ok := sm.services[name]
		if !ok {
			decidable = false
			continue
		}
		switch strings.ToUpper(s.Protocol) {
		case "IP":
			if s.ProtocolNum == 0 {
				out = append(out, svcRange{Proto: -1}) // "ALL"
			} else {
				out = append(out, svcRange{Proto: s.ProtocolNum})
			}
		case "TCP/UDP/SCTP":
			out = append(out, parsePortSpans(s.TCPPortRange, 6)...)
			out = append(out, parsePortSpans(s.UDPPortRange, 17)...)
			out = append(out, parsePortSpans(s.SCTPPortRange, 132)...)
		case "ICMP":
			out = append(out, svcRange{Proto: 1})
		case "ICMP6":
			out = append(out, svcRange{Proto: 58})
		default:
			decidable = false
		}
	}
	return out, decidable
}

// svcCover reports whether `outer` permits everything `inner` does.
func svcCover(outer, inner []svcRange) bool {
	if len(inner) == 0 {
		return false
	}
	for _, o := range outer {
		if o.Proto == -1 {
			return true // "ALL" swallows every protocol and port
		}
	}
	for _, r := range inner {
		if r.Proto == -1 {
			return false // only an "ALL" on the outer side can cover an "ALL"
		}
		covered := false
		for _, o := range outer {
			if o.Proto == r.Proto && o.Lo <= r.Lo && r.Hi <= o.Hi {
				covered = true
				break
			}
		}
		if !covered {
			return false
		}
	}
	return true
}

// ── Interface sets ───────────────────────────────────────────────────────────

// intfSet expands zones and reports whether "any" was present (which covers every interface).
func intfSet(entries []FGName, zones map[string][]string) (map[string]bool, bool) {
	set := map[string]bool{}
	any := false
	for _, e := range entries {
		if strings.EqualFold(e.Name, "any") {
			any = true
			continue
		}
		if members, ok := zones[e.Name]; ok {
			for _, m := range members {
				set[strings.ToLower(m)] = true
			}
			continue
		}
		set[strings.ToLower(e.Name)] = true
	}
	return set, any
}

func intfCover(outer []FGName, outerAny bool, inner []FGName, innerAny bool, zones map[string][]string) bool {
	if outerAny {
		return true
	}
	if innerAny {
		return false // inner accepts every interface; a named outer cannot cover that
	}
	o, _ := intfSet(outer, zones)
	i, _ := intfSet(inner, zones)
	if len(i) == 0 {
		return false
	}
	for name := range i {
		if !o[name] {
			return false
		}
	}
	return true
}

// ── The scan ─────────────────────────────────────────────────────────────────

// factoryAddresses are the objects FortiOS ships. They sit at q_ref 0 on almost every device and
// telling an admin to delete them would be actively wrong — the GUI will not let you either.
var factoryAddresses = map[string]bool{
	"all": true, "none": true, "FABRIC_DEVICE": true, "FIREWALL_AUTH_PORTAL_ADDRESS": true,
	"SSLVPN_TUNNEL_ADDR1": true, "metadata-vip": true,
}

// predefinedServices are the services FortiOS ships. Most sit at q_ref 0 on a normal device —
// nobody uses GOPHER or QUAKE — and advising an admin to delete them would be noise at best and
// wrong at worst, exactly as with factoryAddresses above.
//
// There is no flag on the object that says "predefined": q_static is set on only a handful of
// them, q_no_edit and q_no_rename are false for every single one, and q_class is the same string
// for the whole table. A name list is the only discriminator the device actually offers, so
// unusedServices pairs it with a proportion check that suppresses the whole result if this list
// ever falls behind the firmware.
// ── Cleartext protocols ──────────────────────────────────────────────────────
//
// The protocols standards name individually rather than leaving to judgement: each one carries its
// credentials, its payload or both in the clear, so anyone on the path can read or alter them.
// PCI DSS calls them out at 1.2.6 and 2.2.5, SP 800-53 at CM-7 and SC-8, ISO at A.8.21 and A.8.24.
//
// HTTP (80) and SMB (445) are deliberately absent. Plain HTTP to the internet is what a web filter
// is for and flagging every egress rule would bury the finding that matters; SMB inside a LAN is
// ordinary file sharing. Neither is a judgement this check can make from the policy alone, and a
// check that cries wolf on every rule is a check people switch off.
type insecureService struct {
	Label string
	Proto int // 6 = TCP · 17 = UDP
	Port  int
}

var insecureServices = []insecureService{
	{"Telnet", 6, 23},
	{"FTP", 6, 21},
	{"TFTP", 17, 69},
	{"POP3 without TLS", 6, 110},
	{"IMAP without TLS", 6, 143},
	{"SNMP v1/v2c", 17, 161},
	{"LDAP without TLS", 6, 389},
	{"rlogin", 6, 513},
	{"rsh / rexec", 6, 514},
}

// maxNarrowServiceSpan is how wide a port range may be before permitting a cleartext port inside it
// stops being a deliberate decision.
//
// This number is the whole reliability of the check. A policy whose service is ALL, or TCP/1-65535,
// technically permits Telnet — but reporting that as "this rule deliberately allows Telnet" is
// wrong twice over: it is not what the author decided, and the real problem with that rule is its
// width, which policy-any-any already reports. Only a range narrow enough to have been chosen
// counts, and 1024 is generous enough to cover a hand-written block of service ports while
// excluding anything that reads as "everything".
const maxNarrowServiceSpan = 1024

// insecureServicesIn reports which cleartext protocols a service set narrowly permits.
func insecureServicesIn(ranges []svcRange) []string {
	var out []string
	for _, ins := range insecureServices {
		for _, r := range ranges {
			if r.Proto != ins.Proto || ins.Port < r.Lo || ins.Port > r.Hi {
				continue
			}
			if r.Hi-r.Lo+1 > maxNarrowServiceSpan {
				continue
			}
			out = append(out, ins.Label)
			break
		}
	}
	return out
}

// securityProfileCount counts the security profiles the device holds, across the six categories
// this console manages.
//
// It exists because AuditStats.Profiles was declared, shipped, printed in the evidence PDF — and
// never assigned, so every report claimed a device with six profiles had none. A number in a
// compliance document that is structurally always zero is worse than no number.
func (f *FortiClient) securityProfileCount() int {
	cats := make([]string, 0, len(securityProfilePaths))
	for c := range securityProfilePaths {
		cats = append(cats, c)
	}
	sort.Strings(cats)

	counts := make([]int, len(cats))
	fns := make([]func(), len(cats))
	for i, c := range cats {
		i, c := i, c
		fns[i] = func() {
			// A category that will not answer contributes zero, exactly like every other read in
			// this scan: a device that hides one profile table still gets audited on the rest.
			if list, err := f.GetSecurityProfiles(c); err == nil {
				counts[i] = len(list)
			}
		}
	}
	Parallel(fns...)

	total := 0
	for _, n := range counts {
		total += n
	}
	return total
}

var predefinedServices = map[string]bool{
	"ALL": true, "ALL_TCP": true, "ALL_UDP": true, "ALL_ICMP": true, "ALL_ICMP6": true,
	"AFS3": true, "AH": true, "AOL": true, "BGP": true, "CVSPSERVER": true,
	"DCE-RPC": true, "DHCP": true, "DHCP6": true, "DNS": true, "ESP": true,
	"FINGER": true, "FTP": true, "FTP_GET": true, "FTP_PUT": true, "GOPHER": true,
	"GRE": true, "H323": true, "HTTP": true, "HTTPS": true, "IKE": true,
	"IMAP": true, "IMAPS": true, "INFO_ADDRESS": true, "INFO_REQUEST": true,
	"Internet-Locator-Service": true, "IRC": true, "KERBEROS": true, "L2TP": true,
	"LDAP": true, "LDAP_UDP": true, "MGCP": true, "MMS": true, "MS-SQL": true,
	"MYSQL": true, "NetMeeting": true, "NFS": true, "NNTP": true, "NONE": true,
	"NTP": true, "ONC-RPC": true, "OSPF": true, "PC-Anywhere": true, "PING": true,
	"PING6": true, "POP3": true, "POP3S": true, "PPTP": true, "QUAKE": true,
	"RADIUS": true, "RADIUS-OLD": true, "RAUDIO": true, "RDP": true, "REXEC": true,
	"RIP": true, "RLOGIN": true, "RSH": true, "RTSP": true, "SAMBA": true,
	"SCCP": true, "SIP": true, "SIP-MSNmessenger": true, "SMTP": true, "SMTPS": true,
	"SNMP": true, "SOCKS": true, "SQUID": true, "SSH": true, "SYSLOG": true,
	"TALK": true, "TELNET": true, "TFTP": true, "TIMESTAMP": true, "TRACEROUTE": true,
	"UUCP": true, "VDOLIVE": true, "VNC": true, "WAIS": true, "WINFRAME": true,
	"WINS": true, "X-WINDOWS": true,
}

func isFactoryAddress(a FGAddress, interfaces map[string]bool) bool {
	if factoryAddresses[a.Name] {
		return true
	}
	if strings.HasPrefix(a.Name, "EMS_") || strings.HasPrefix(a.Name, "FCTEMS_") {
		return true
	}
	// FortiOS auto-creates an "interface-subnet" address per interface ("lan", "port1 address").
	// They are config, not clutter.
	if strings.EqualFold(a.Type, "interface-subnet") {
		return true
	}
	if strings.EqualFold(a.Type, "dynamic") {
		return true // owned by a fabric connector, not by the admin
	}
	name := strings.TrimSuffix(a.Name, " address")
	return interfaces[strings.ToLower(name)]
}

// defaultRouteInterface reads the device's routing table for the 0.0.0.0/0 entry. That interface is
// "the internet" as far as this firewall is concerned, and a policy pointing at it with no
// inspection is the finding people care about most.
func (f *FortiClient) defaultRouteInterface() string {
	resp, err := f.do("GET", "/api/v2/monitor/router/ipv4", nil)
	if err != nil {
		return ""
	}
	var rows []struct {
		IPMask    string `json:"ip_mask"`
		Interface string `json:"interface"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return ""
	}
	for _, r := range rows {
		if r.IPMask == "0.0.0.0/0" {
			return r.Interface
		}
	}
	return ""
}

// RunAudit scans the firewall and returns everything worth a look, worst first.
func (f *FortiClient) RunAudit() (AuditReport, error) {
	rep := AuditReport{ScannedAt: time.Now().UTC(), Counts: map[string]int{}}

	// Nine independent reads. Run together they cost about as much as the slowest one; run one
	// after another — as they were — the Audit / Review page spent most of its time waiting, and
	// the policy table (the biggest of them) does not gate any of the others.
	//
	// The three that can fail the whole scan keep their errors; the rest already degrade to an
	// empty map, exactly as before, so a device that will not answer for zones still gets audited
	// on everything else.
	var (
		policies                     []FGPolicy
		addresses                    []FGAddress
		services                     []FGService
		schedules                    []FGSchedule
		profileCount                 int
		policiesErr, addrErr, svcErr error
		addrGroups, svcGroups, zones map[string][]string
		vips                         map[string]string
		stats                        map[int]FGPolicyStats
		wanIntf                      string
		posture                      systemPosture
		fingerprint                  string
		fingerprintFailed            []string
	)
	Parallel(
		func() { policies, policiesErr = f.GetPolicies() },
		func() { addresses, addrErr = f.GetAddresses() },
		func() { services, svcErr = f.GetServices() },
		func() { addrGroups = f.addressGroups() },
		func() { vips = f.vipExternalIPs() },
		func() { svcGroups = f.serviceGroups() },
		func() { zones = f.zoneMembers() },
		func() { stats = f.GetPolicyStats() },
		func() { wanIntf = f.defaultRouteInterface() },
		// The last two feed AuditStats only. They are here rather than skipped because the report
		// states what the scan LOOKED at, and "0 profiles" on a device with six is the kind of
		// detail that makes a reader stop trusting the rest of the document.
		func() { schedules, _ = f.GetSchedules() },
		func() { profileCount = f.securityProfileCount() },
		// The management plane — administrators, interfaces, clock, log destinations, firmware.
		// It runs its own parallel fan-out inside, which nests fine: every one of these is a
		// socket read on one device and the cost is the slowest, not the sum.
		func() { posture = f.readSystemPosture() },
		// Nine more GETs, each asking for one row. They answer a question none of the others can:
		// whether this configuration is the same one the last scan looked at.
		func() { fingerprint, fingerprintFailed = f.ConfigFingerprint() },
	)
	// Reported in the same order the sequential version would have hit them, so the message a user
	// sees for an unreachable device does not change.
	for _, err := range []error{policiesErr, addrErr, svcErr} {
		if err != nil {
			return rep, err
		}
	}

	am := &addrMatcher{addrs: map[string]FGAddress{}, groups: addrGroups, vips: vips}
	for _, a := range addresses {
		am.addrs[a.Name] = a
	}
	sm := &svcMatcher{services: map[string]FGService{}, groups: svcGroups}
	for _, s := range services {
		sm.services[s.Name] = s
	}

	rep.Stats.Policies = len(policies)
	rep.Stats.Addresses = len(addresses)
	rep.Stats.Services = len(services)
	rep.Stats.Schedules = len(schedules)
	rep.Stats.Profiles = profileCount
	rep.ConfigFingerprint = fingerprint

	// undecided records checks that could not be fully evaluated, so the standards view can say
	// "could not tell" instead of quietly reporting the control as satisfied.
	undecided := map[string]bool{}
	seenNote := map[string]bool{}
	note := func(s string) {
		if s == "" || seenNote[s] {
			return
		}
		seenNote[s] = true
		rep.Notes = append(rep.Notes, s)
	}
	add := func(fnd AuditFinding) {
		rep.Findings = append(rep.Findings, fnd)
		rep.Counts[string(fnd.Severity)]++
	}

	// Three of the six checks depend on a read that can come back empty from a device that simply
	// will not answer for it. An empty read makes the check silently never fire, which looks
	// exactly like "nothing wrong" — so each one is recorded as undecided instead. Without this,
	// a device that refuses to report hit counters would be presented as evidence that its rule
	// base has no dead rules.
	if len(fingerprintFailed) > 0 {
		// Named, not swallowed. Without this a wrong table path looks exactly like a device that
		// declines to answer, and the change-attribution check stays undetermined forever with
		// nothing to point at.
		note(fmt.Sprintf("no configuration fingerprint could be taken — the device would not answer for %s, so changes made outside this console cannot be detected",
			strings.Join(fingerprintFailed, ", ")))
	}
	if len(policies) > 0 && len(stats) == 0 {
		note("the device returned no policy hit counters — whether a policy has ever carried traffic could not be evaluated")
		undecided["policy-no-traffic"] = true
	}
	if wanIntf == "" {
		note("no default route was found, so the internet-facing interface is unknown — uninspected egress could not be evaluated")
		undecided["policy-no-inspection"] = true
		// The antivirus check keys off the same interface, so it is undecidable for the same
		// reason. Marking only one of the two would leave SI-3 and ISO A.8.7 reported as evidenced
		// on the strength of a check that never ran.
		undecided["policy-no-antivirus"] = true
	}

	// Expand every policy once; shadow detection is O(n²) over the results.
	type expanded struct {
		p         FGPolicy
		enabled   bool
		src, dst  []ipRange
		svc       []svcRange
		srcAny    bool
		dstAny    bool
		decidable bool
		// svcOK is decidability of the SERVICE list alone. Shadow detection needs all three lists
		// to be resolvable; the cleartext-protocol check needs only this one, and gating it on the
		// stricter flag would silently skip a rule that plainly permits Telnet just because its
		// destination happens to be an FQDN.
		svcOK bool
	}
	exp := make([]expanded, 0, len(policies))
	for _, p := range policies {
		srcR, d1 := addrRanges(am, fgNames(p.SrcAddr), 0)
		dstR, d2 := addrRanges(am, fgNames(p.DstAddr), 0)
		svcR, d3 := svcRanges(sm, fgNames(p.Service), 0)
		_, srcAny := intfSet(p.SrcIntf, zones)
		_, dstAny := intfSet(p.DstIntf, zones)
		e := expanded{
			p: p, enabled: !strings.EqualFold(p.Status, "disable"),
			src: srcR, dst: dstR, svc: svcR,
			srcAny: srcAny, dstAny: dstAny,
			decidable: d1 && d2 && d3,
			svcOK:     d3,
		}
		if !e.decidable {
			note(fmt.Sprintf("policy %d (%s) uses an object that cannot be resolved from configuration alone (FQDN / geography / dynamic) — shadow detection skipped for this policy",
				p.PolicyID, p.Name))
			undecided["policy-shadowed"] = true
		}
		exp = append(exp, e)
		if !e.enabled {
			rep.Stats.PoliciesDisabled++
		}
	}

	for i, b := range exp {
		pol := b.p

		// ── 1. Disabled but still in the table ──
		if !b.enabled {
			add(AuditFinding{
				Check: "policy-disabled", Severity: SeverityLow, Category: "Policy",
				Title:   "Policy is disabled but still sitting in the table",
				Detail:  fmt.Sprintf("policy %d (%s) has status disable — it carries no traffic, but it still takes up a row and makes the table harder to read. Remove it if it is no longer needed.", pol.PolicyID, pol.Name),
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
				Fix:        fixOf(fixDelete("firewall/policy", fmt.Sprintf("%d", pol.PolicyID))),
				FixTargets: targetsOf(fixDelete("firewall/policy", fmt.Sprintf("%d", pol.PolicyID))),
			})
			continue // every check below is about traffic, and this policy carries none
		}

		// ── 2. any/any/any ──
		// The literal "permit everything" rule. Severity is high regardless of position: even
		// below other rules it is a hole nothing narrows.
		if strings.EqualFold(pol.Action, "accept") &&
			coversEverything(b.src) && coversEverything(b.dst) && hasAllService(b.svc) {
			add(AuditFinding{
				Check: "policy-any-any", Severity: SeverityHigh, Category: "Policy",
				Title:   "Policy is wide open — every source, every destination, every service",
				Detail:  fmt.Sprintf("policy %d (%s) sets srcaddr=all, dstaddr=all and service=ALL with action accept — anything matching the interface pair gets through. Narrow at least one of the three.", pol.PolicyID, pol.Name),
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
				Fix:        fixOf(anyAnyFix(pol.PolicyID)),
				FixTargets: targetsOf(anyAnyFix(pol.PolicyID)),
			})
		}

		// ── 3. Out to the internet with nothing inspecting it ──
		if wanIntf != "" && strings.EqualFold(pol.Action, "accept") &&
			!strings.EqualFold(pol.UTMStatus, "enable") && intfListHas(pol.DstIntf, wanIntf, zones) {
			add(AuditFinding{
				Check: "policy-no-inspection", Severity: SeverityMedium, Category: "Inspection",
				Title:   "Traffic leaves for the internet with nothing inspecting it",
				Detail:  fmt.Sprintf("policy %d (%s) sends traffic out through %s (the interface holding the default route) with utm-status off — no AntiVirus, Web Filter or Application Control runs on this path.", pol.PolicyID, pol.Name, wanIntf),
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
				Fix:        fixOf(noInspectionFix(pol.PolicyID)),
				FixTargets: targetsOf(noInspectionFix(pol.PolicyID)),
			})
		}

		// ── 4. Inspection is on, but nothing is looking for malware ──
		// The gap check 3 cannot see. utm-status is enable, a web filter and an application sensor
		// run, the policy looks inspected from the table — and no antivirus profile is attached, so
		// the one thing every framework asks for by name (SI-3, ISO A.8.7, PCI 5.2.1) is the one
		// thing not happening. Seen exactly this way on the lab device.
		if wanIntf != "" && strings.EqualFold(pol.Action, "accept") &&
			strings.EqualFold(pol.UTMStatus, "enable") && strings.TrimSpace(pol.AVProfile) == "" &&
			intfListHas(pol.DstIntf, wanIntf, zones) {
			add(AuditFinding{
				Check: "policy-no-antivirus", Severity: SeverityMedium, Category: "Inspection",
				Title: "Traffic is inspected on the way out, but not for malware",
				Detail: fmt.Sprintf("policy %d (%s) sends traffic out through %s with utm-status enabled, so inspection is switched on — but no av-profile is attached. Whatever else runs on this path, a downloaded file is not scanned.",
					pol.PolicyID, pol.Name, wanIntf),
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
				Fix:        fixOf(avProfileFix(pol.PolicyID)),
				FixTargets: targetsOf(avProfileFix(pol.PolicyID)),
			})
		}

		// ── 5. A rule that deliberately permits a cleartext protocol ──
		if strings.EqualFold(pol.Action, "accept") && b.svcOK {
			if names := insecureServicesIn(b.svc); len(names) > 0 {
				add(AuditFinding{
					Check: "policy-insecure-service", Severity: SeverityMedium, Category: "Policy",
					Title: "Policy permits a protocol that travels in clear text",
					Detail: fmt.Sprintf("policy %d (%s) allows %s. Credentials and payload cross this path unencrypted, so anyone able to observe the traffic can read or alter them. Replace the protocol with its encrypted equivalent, or restrict the rule to the one pair of hosts that still needs it and record why.",
						pol.PolicyID, pol.Name, strings.Join(names, ", ")),
					Subject: policySubject(pol), PolicyID: pol.PolicyID,
					Fix: withNote(
						fmt.Sprintf("# policy %d permits: %s", pol.PolicyID, strings.Join(names, ", ")),
						fixOf(secureServiceFix(pol.PolicyID))),
					FixTargets: targetsOf(secureServiceFix(pol.PolicyID)),
				})
			}
		}

		// ── 6. Nothing is recorded about what this rule did ──
		// FortiOS returns logtraffic on every policy, so an empty value means the field could not be
		// read rather than that logging is off — and guessing in that direction would invent a
		// finding. Only an explicit "disable" counts.
		if strings.EqualFold(pol.LogTraffic, "disable") {
			if strings.EqualFold(pol.Action, "deny") {
				add(AuditFinding{
					Check: "policy-deny-no-logging", Severity: SeverityMedium, Category: "Logging",
					Title: "Blocked attempts on this rule are not recorded",
					Detail: fmt.Sprintf("policy %d (%s) denies traffic with logtraffic disable — nothing is written when it blocks. Repeated attempts to reach whatever this rule protects leave no trace, so neither an alert nor an investigation afterwards has anything to work from.",
						pol.PolicyID, pol.Name),
					Subject: policySubject(pol), PolicyID: pol.PolicyID,
					Fix:        fixOf(logTrafficFix(pol.PolicyID)),
					FixTargets: targetsOf(logTrafficFix(pol.PolicyID)),
				})
			} else {
				add(AuditFinding{
					Check: "policy-no-logging", Severity: SeverityMedium, Category: "Logging",
					Title: "Traffic this rule allows is not recorded",
					Detail: fmt.Sprintf("policy %d (%s) permits traffic with logtraffic disable — no session it allows is written to the log. There is no record of what was permitted through this rule, on this device or anywhere it forwards logs.",
						pol.PolicyID, pol.Name),
					Subject: policySubject(pol), PolicyID: pol.PolicyID,
					Fix:        fixOf(logTrafficFix(pol.PolicyID)),
					FixTargets: targetsOf(logTrafficFix(pol.PolicyID)),
				})
			}
		}

		// ── 7. Never used ──
		if st, ok := stats[pol.PolicyID]; ok && st.Bytes == 0 && st.Packets == 0 {
			add(AuditFinding{
				Check: "policy-no-traffic", Severity: SeverityLow, Category: "Policy",
				Title:   "Policy is enabled but has never carried traffic",
				Detail:  fmt.Sprintf("policy %d (%s) counts 0 packets and 0 bytes — it may be shadowed by a policy above it, or its match conditions may not describe any traffic that exists. Counters also reset on reboot.", pol.PolicyID, pol.Name),
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
			})
		}

		// ── 8. Shadowed by a policy above it ──
		// FortiOS stops at the first match, so if any earlier ENABLED policy covers every packet
		// this one could take, this one can never run.
		if !b.decidable {
			continue
		}
		for j := 0; j < i; j++ {
			a := exp[j]
			if !a.enabled || !a.decidable {
				continue
			}
			if !intfCover(a.p.SrcIntf, a.srcAny, b.p.SrcIntf, b.srcAny, zones) ||
				!intfCover(a.p.DstIntf, a.dstAny, b.p.DstIntf, b.dstAny, zones) {
				continue
			}
			if !rangesCover(a.src, b.src) || !rangesCover(a.dst, b.dst) || !svcCover(a.svc, b.svc) {
				continue
			}
			// A schedule narrows the policy above, so it only shadows when it is always on (or is
			// literally the same schedule).
			if !scheduleAlwaysOn(a.p.Schedule) && !strings.EqualFold(a.p.Schedule, b.p.Schedule) {
				continue
			}

			sameAction := strings.EqualFold(a.p.Action, b.p.Action)
			severity, title := SeverityHigh, "Policy can never run — one above it already covers everything (shadowed)"
			detail := fmt.Sprintf("policy %d (%s) can never match, because policy %d (%s) above it covers every packet this one could take — and the two actions differ (%s vs %s), so what this policy was written to do never takes effect.",
				pol.PolicyID, pol.Name, a.p.PolicyID, a.p.Name, a.p.Action, pol.Action)
			if sameAction {
				severity = SeverityMedium
				title = "Redundant policy — the one above it already covers this"
				detail = fmt.Sprintf("policy %d (%s) is entirely covered by policy %d (%s) and takes the same action (%s) — the outcome is identical, the table is just longer.",
					pol.PolicyID, pol.Name, a.p.PolicyID, a.p.Name, pol.Action)
			}
			add(AuditFinding{
				Check: "policy-shadowed", Severity: severity, Category: "Policy",
				Title: title, Detail: detail,
				Subject: policySubject(pol), PolicyID: pol.PolicyID,
				Fix: withNote(
					fmt.Sprintf("# move policy %d above policy %d if it is meant to take effect:", pol.PolicyID, a.p.PolicyID),
					fixOf(fixMove("firewall/policy", pol.PolicyID, a.p.PolicyID))),
				FixTargets: targetsOf(fixMove("firewall/policy", pol.PolicyID, a.p.PolicyID)),
			})
			break // one shadower is enough to make the point
		}
	}

	// ── 9. Objects nobody references ──
	interfaceNames := map[string]bool{}
	if ifaces, err := f.GetInterfaces(); err == nil {
		for _, i := range ifaces {
			interfaceNames[strings.ToLower(i.Name)] = true
		}
	}
	unusedAddrs, addrsOK, serial, firmware := f.unusedAddresses()
	rep.DeviceSerial, rep.DeviceFirmware = serial, firmware

	unusedSvcs, svcsOK := f.unusedServices()
	if !addrsOK {
		note("reference counts for addresses could not be read — orphaned addresses were not evaluated")
	}
	if !svcsOK {
		note("reference counts for services could not be read, or too many services looked orphaned to be believable — orphaned services were not evaluated")
	}
	if !addrsOK || !svcsOK {
		undecided["object-unused"] = true
	}
	for _, a := range unusedAddrs {
		if isFactoryAddress(a, interfaceNames) {
			continue
		}
		add(AuditFinding{
			Check: "object-unused", Severity: SeverityLow, Category: "Objects",
			Title:      "Address object is not referenced by anything",
			Detail:     fmt.Sprintf("address %q (%s) has a reference count of 0 — no policy, group or route uses it.", a.Name, addrSummary(a)),
			Subject:    fmt.Sprintf("address %q", a.Name),
			ObjectKind: "address", ObjectName: a.Name,
			Fix:        fixOf(fixDelete("firewall/address", fmt.Sprintf("%q", a.Name))),
			FixTargets: targetsOf(fixDelete("firewall/address", fmt.Sprintf("%q", a.Name))),
		})
	}
	for _, s := range unusedSvcs {
		add(AuditFinding{
			Check: "object-unused", Severity: SeverityLow, Category: "Objects",
			Title:      "Service object is not referenced by anything",
			Detail:     fmt.Sprintf("service %q has a reference count of 0 — no policy uses it.", s.Name),
			Subject:    fmt.Sprintf("service %q", s.Name),
			ObjectKind: "service", ObjectName: s.Name,
			Fix:        fixOf(fixDelete("firewall.service/custom", fmt.Sprintf("%q", s.Name))),
			FixTargets: targetsOf(fixDelete("firewall.service/custom", fmt.Sprintf("%q", s.Name))),
		})
	}

	// ── 10. The management plane ──
	// Kept whole and separate: these checks are about who can reach the FIREWALL, not about what
	// crosses it, and folding them into the policy loop above would put a finding about an
	// administrator account inside a loop over policies.
	sysFindings, sysUndecided, sysNotes := posture.findings(wanIntf)
	for _, n := range sysNotes {
		note(n)
	}
	for check := range sysUndecided {
		undecided[check] = true
	}
	for _, fnd := range sysFindings {
		add(fnd)
	}

	sortFindings(rep.Findings)

	// ── Standards ──
	// Attached last, over the finished finding list, so the computation above never has to know
	// that frameworks exist. Removing this block leaves the audit engine exactly as it was.
	for i := range rep.Findings {
		rep.Findings[i].Controls = ControlsForCheck(rep.Findings[i].Check)
	}
	for _, check := range AuditChecks {
		if undecided[check] {
			rep.UndecidedChecks = append(rep.UndecidedChecks, check)
		}
	}
	rep.Standards = BuildStandardsCoverage(rep.Findings, rep.UndecidedChecks)
	rep.Methodology = AuditMethodology()
	rep.CheckRationales = AuditRationales()

	return rep, nil
}

// coversEverything reports whether an address set is the whole IPv4 space — which is what the
// built-in "all" object expands to.
func coversEverything(ranges []ipRange) bool {
	merged := mergeRanges(ranges)
	return len(merged) == 1 && merged[0].Lo == 0 && merged[0].Hi == ^uint32(0)
}

func hasAllService(ranges []svcRange) bool {
	for _, r := range ranges {
		if r.Proto == -1 {
			return true
		}
	}
	return false
}

func scheduleAlwaysOn(name string) bool {
	return name == "" || strings.EqualFold(name, "always")
}

func intfListHas(entries []FGName, want string, zones map[string][]string) bool {
	set, any := intfSet(entries, zones)
	return any || set[strings.ToLower(want)]
}

func policySubject(p FGPolicy) string {
	if p.Name == "" {
		return fmt.Sprintf("policy #%d", p.PolicyID)
	}
	return fmt.Sprintf("policy #%d %s", p.PolicyID, p.Name)
}

func addrSummary(a FGAddress) string {
	switch strings.ToLower(a.Type) {
	case "ipmask", "interface-subnet":
		return a.Subnet
	case "iprange":
		return a.StartIP + "-" + a.EndIP
	case "fqdn":
		return a.FQDN
	case "geography":
		return a.Country
	}
	return a.Type
}

// sortFindings puts high severity first, then groups by check so the report reads as a list of
// problems rather than a shuffled feed.
func sortFindings(f []AuditFinding) {
	rank := map[AuditSeverity]int{SeverityHigh: 0, SeverityMedium: 1, SeverityLow: 2}
	sort.SliceStable(f, func(i, j int) bool {
		if rank[f[i].Severity] != rank[f[j].Severity] {
			return rank[f[i].Severity] < rank[f[j].Severity]
		}
		if f[i].Check != f[j].Check {
			return f[i].Check < f[j].Check
		}
		return f[i].PolicyID < f[j].PolicyID
	})
}

// ── Reference counts ─────────────────────────────────────────────────────────
//
// q_ref is FortiOS's own answer to "is anything using this?" — the number behind the GUI's Ref
// column. It is only returned when with_meta=1 is asked for, which is why these are separate
// reads rather than a filter over GetAddresses().

// The bool is "the read worked", NOT "something was found". Returning a bare nil for both an
// unreadable device and a genuinely tidy one is what lets a compliance view claim a control is
// evidenced when nothing was ever examined.
// The serial and firmware come back with the addresses because FortiOS stamps them on the envelope
// of every response, so the report gets the device's identity without a second round trip. They are
// returned rather than cached on the client: a FortiClient is shared out of the session pool, and
// per-request facts do not belong on a shared object.
func (f *FortiClient) unusedAddresses() (addrs []FGAddress, ok bool, serial, firmware string) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/address?with_meta=1", nil)
	if err != nil {
		return nil, false, "", ""
	}
	serial, firmware = resp.Serial, resp.Version

	var rows []struct {
		FGAddress
		QRef int `json:"q_ref"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil, false, serial, firmware
	}
	var out []FGAddress
	for _, r := range rows {
		if r.QRef == 0 {
			out = append(out, r.FGAddress)
		}
	}
	return out, true, serial, firmware
}

// unusedServices had never returned a single result before the "did the read work?" flag above was
// added, and the flag is what exposed it: decoding this collection into []FGService always failed,
// because a GET returns `category` as a plain STRING while FGService declares it as []FGName (that
// shape is what a WRITE takes — see fgServiceWrite). The whole check failed silently and the report
// simply never mentioned services. GetServices survives the same payload only because it decodes
// item by item and drops the ones that will not parse.
//
// Nothing here needs the rest of the object, so it decodes the two fields it actually uses and is
// immune to every other field's shape changing between firmware versions.
func (f *FortiClient) unusedServices() ([]FGService, bool) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall.service/custom?with_meta=1", nil)
	if err != nil {
		return nil, false
	}
	var rows []struct {
		Name string `json:"name"`
		QRef int    `json:"q_ref"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil, false
	}

	var out []FGService
	for _, r := range rows {
		if r.QRef == 0 && !predefinedServices[r.Name] {
			out = append(out, FGService{Name: r.Name})
		}
	}

	// Backstop for a firmware that ships predefined services this list has not caught up with. On
	// the lab FGT80E 68 of 89 services are predefined and unreferenced, so an out-of-date list does
	// not produce one wrong row — it buries the report in dozens of them, each advising the admin to
	// delete something FortiOS ships. Saying nothing is the safe failure here.
	if len(rows) > 0 && len(out)*2 > len(rows) {
		return nil, false
	}
	return out, true
}

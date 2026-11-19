package services

import (
	"fmt"
	"strings"
)

// ── Fix CLI and what it actually touches, built together ─────────────────────
//
// THE PROBLEM. Every fix on a finding was a hand-written []string of CLI. That is fine for showing
// somebody a command and useless for anything else: nothing downstream could tell which CMDB object
// or attribute the command was about, so nothing could check the command against the device it was
// written for. The audit page's own promise — never assert what you cannot back — did not extend to
// the one part a customer actually runs.
//
// THE OBVIOUS FIX IS THE WRONG ONE. Parsing the CLI back into a path and an attribute would work
// today and break the first time somebody adds a comment line or an unusual quoting. A parser that
// reads output this same package produced is a parser that exists only because two things that
// should have been one were written twice.
//
// SO THE CLI IS BUILT FROM THE TARGETS. The helpers below take the CMDB path, the key and the
// attribute/value pairs, and return BOTH the rendered CLI and the structured record of what it
// touches. They cannot disagree, because there is one input.
//
// WHAT THE STRUCTURED RECORD BUYS. audit_fix_verify.go asks the device's own
// `?action=schema` whether each attribute exists on the running firmware and, for an option-typed
// attribute, whether the value is one it accepts. That turns "somebody here wrote this command"
// into "the firewall itself confirms this attribute and this value" — which is the difference
// between a plausible fix and a checkable one.
//
// THE CLI PATH AND THE CMDB PATH ARE NOT THE SAME STRING, and the difference is real:
//
//	CMDB                        CLI
//	firewall/policy             config firewall policy
//	firewall.service/custom     config firewall service custom
//	log.syslogd/setting         config log syslogd setting
//
// Both separators become a space, which is the whole rule. Verified against the lab FortiGate 80E
// on FortiOS 7.2.10: all eight paths this file uses answer ?action=schema in that form.

// FixOp is what a fix line does to the object.
type FixOp string

const (
	FixSet    FixOp = "set"
	FixDelete FixOp = "delete"
	FixMove   FixOp = "move"
)

// FixTarget is one CMDB attribute a fix writes, or one object it removes or moves.
type FixTarget struct {
	// Path is the CMDB path, in the form ?action=schema takes ("firewall/policy").
	Path string `json:"path"`
	// MKey is the object the write lands on — a policy id, an interface name, an administrator.
	// Empty for a single-object table (system global, log setting), which has no key.
	//
	// It is recorded because a fix that can be APPLIED has to name what it applies to, and because
	// the change ledger snapshots Before by (path, mkey) — which is what makes the write revertible.
	MKey string `json:"mkey,omitempty"`
	Op   FixOp  `json:"op"`
	// Attr and Value are set for FixSet only. A delete or a move names no attribute.
	Attr  string `json:"attr,omitempty"`
	Value string `json:"value,omitempty"`
	// List marks a Value that is several whitespace-separated values ("ping https ssh"). The
	// verifier checks each one against the attribute's option set rather than looking for the whole
	// string in it — `allowaccess` is where one wrong word locks an administrator out.
	List bool `json:"list,omitempty"`
}

// cliPath renders a CMDB path as the CLI writes it.
func cliPath(cmdb string) string {
	return strings.NewReplacer(".", " ", "/", " ").Replace(cmdb)
}

// placeholder reports whether a value is a blank for the operator to fill in ("<collector-ip>").
//
// Such a value must never be schema-checked against an option list, and must never be presented as
// verified: the point of the angle brackets is that this console does not know what belongs there.
func placeholder(v string) bool {
	return strings.HasPrefix(v, "<") && strings.HasSuffix(v, ">")
}

// setPair is one `set attr value` line. Value is rendered as given, so a caller that needs quotes
// writes them — FortiOS treats `set service "HTTPS"` and `set service HTTPS` differently in some
// tables, and normalising here would quietly change what the operator is told to run.
type setPair struct {
	attr  string
	value string
	// raw is the exact text after `set `, when it is not a simple attr/value pair (several quoted
	// values, say). Attr is still recorded; Value is left empty because there is not one.
	raw string
}

func set(attr, value string) setPair { return setPair{attr: attr, value: value} }

// setRaw is for a line whose value is a list ("set service \"SSH\" \"HTTPS\""). The attribute is
// still checked against the schema; the value is not, because a list is not one value.
func setRaw(attr, raw string) setPair { return setPair{attr: attr, raw: raw} }

// fixEdit renders config/edit/set…/next/end for one object, and records every attribute it writes.
func fixEdit(cmdb, key string, sets ...setPair) ([]string, []FixTarget) {
	lines := []string{"config " + cliPath(cmdb), fmt.Sprintf("    edit %s", key)}
	var targets []FixTarget
	for _, s := range sets {
		lines = append(lines, "        set "+s.line())
		t := s.target(cmdb)
		// The CLI quotes the key; the API does not. One unquoting here, rather than at every
		// caller, is what keeps the two representations from drifting.
		t.MKey = strings.Trim(key, `"`)
		targets = append(targets, t)
	}
	return append(lines, "    next", "end"), targets
}

// fixGlobal renders config/set…/end for a single-object table (system global, log setting).
func fixGlobal(cmdb string, sets ...setPair) ([]string, []FixTarget) {
	lines := []string{"config " + cliPath(cmdb)}
	var targets []FixTarget
	for _, s := range sets {
		lines = append(lines, "    set "+s.line())
		targets = append(targets, s.target(cmdb))
	}
	return append(lines, "end"), targets
}

// fixDelete renders config/delete/end.
func fixDelete(cmdb, key string) ([]string, []FixTarget) {
	return []string{"config " + cliPath(cmdb), fmt.Sprintf("    delete %s", key), "end"},
		[]FixTarget{{Path: cmdb, MKey: strings.Trim(key, `"`), Op: FixDelete}}
}

// fixMove renders config/move/end — reordering a policy rather than editing it.
func fixMove(cmdb string, id, before int) ([]string, []FixTarget) {
	return []string{
			"config " + cliPath(cmdb),
			fmt.Sprintf("    move %d before %d", id, before),
			"end",
		},
		[]FixTarget{{Path: cmdb, MKey: fmt.Sprintf("%d", id), Op: FixMove}}
}

// withNote prefixes a fix with comment lines. Comments carry no target: there is nothing to verify
// about a sentence.
func withNote(comment string, lines []string) []string {
	return append([]string{comment}, lines...)
}

func (s setPair) line() string {
	if s.raw != "" {
		return s.attr + " " + s.raw
	}
	return s.attr + " " + s.value
}

func (s setPair) target(cmdb string) FixTarget {
	t := FixTarget{Path: cmdb, Op: FixSet, Attr: s.attr}
	if s.raw != "" {
		// A list. The verifier decides per token what is checkable — object names from a datasource
		// are not, option values are — because the attribute's type is what settles that, and only
		// the device knows it.
		t.Value, t.List = s.raw, true
		return t
	}
	// A placeholder has no checkable value at all: the angle brackets mean this console does not
	// know what belongs there, and recording it is how a verifier ends up reporting that the
	// firewall rejects "<collector-ip>".
	if !placeholder(s.value) {
		t.Value = strings.Trim(s.value, `"`)
	}
	return t
}

// ── The fixes themselves, one named builder each ─────────────────────────────
//
// Named rather than inlined at the call site for one reason: each is now called TWICE — once for
// the CLI and once for the targets — and an inlined literal called twice is two literals waiting to
// drift. fixOf/targetsOf below unpack the pair.
//
// Every path and attribute here was confirmed against the lab FortiGate 80E (FortiOS 7.2.10) with
// ?action=schema before being written down, per the project's standing rule about never guessing
// FortiOS schema. The verifier re-confirms them at runtime against whatever build the device is
// actually on, which is the point.

func fixOf(lines []string, _ []FixTarget) []string          { return lines }
func targetsOf(_ []string, targets []FixTarget) []FixTarget { return targets }

const (
	cmdbPolicy    = "firewall/policy"
	cmdbAddress   = "firewall/address"
	cmdbService   = "firewall.service/custom"
	cmdbInterface = "system/interface"
	cmdbAdmin     = "system/admin"
	cmdbGlobal    = "system/global"
	cmdbNTP       = "system/ntp"
	cmdbLogSet    = "log/setting"
	cmdbSyslog    = "log.syslogd/setting"
)

func policyKey(id int) string { return fmt.Sprintf("%d", id) }

// anyAnyFix narrows a permit-everything rule. Both values are examples, not prescriptions — which
// is why the destination is a placeholder and the service list is raw.
func anyAnyFix(id int) ([]string, []FixTarget) {
	return fixEdit(cmdbPolicy, policyKey(id),
		set("dstaddr", `"<specific-address>"`),
		setRaw("service", `"HTTPS" "DNS"`))
}

func noInspectionFix(id int) ([]string, []FixTarget) {
	return fixEdit(cmdbPolicy, policyKey(id),
		set("utm-status", "enable"),
		set("av-profile", `"default"`),
		set("ssl-ssh-profile", `"certificate-inspection"`))
}

func avProfileFix(id int) ([]string, []FixTarget) {
	return fixEdit(cmdbPolicy, policyKey(id), set("av-profile", `"default"`))
}

func secureServiceFix(id int) ([]string, []FixTarget) {
	return fixEdit(cmdbPolicy, policyKey(id), setRaw("service", `"SSH" "HTTPS"`))
}

func logTrafficFix(id int) ([]string, []FixTarget) {
	return fixEdit(cmdbPolicy, policyKey(id), set("logtraffic", "all"))
}

func allowAccessFix(iface string) ([]string, []FixTarget) {
	// A multi-value option list: every value is checked individually by the verifier, because
	// allowaccess is where a wrong word silently locks an administrator out.
	return fixEdit(cmdbInterface, fmt.Sprintf("%q", iface), setRaw("allowaccess", "ping https ssh"))
}

func srcCheckFix(iface string) ([]string, []FixTarget) {
	return fixEdit(cmdbInterface, fmt.Sprintf("%q", iface), set("src-check", "enable"))
}

func trustHostFix(admin string) ([]string, []FixTarget) {
	return fixEdit(cmdbAdmin, fmt.Sprintf("%q", admin),
		setRaw("trusthost1", "<management-subnet> <mask>"))
}

func adminTimeoutFix() ([]string, []FixTarget) {
	return fixGlobal(cmdbGlobal, set("admintimeout", fmt.Sprintf("%d", maxAdminIdleMinutes)))
}

func lockoutFix() ([]string, []FixTarget) {
	return fixGlobal(cmdbGlobal,
		set("admin-lockout-threshold", "3"),
		set("admin-lockout-duration", "60"))
}

func ntpFix() ([]string, []FixTarget) {
	return fixGlobal(cmdbNTP, set("ntpsync", "enable"), set("type", "fortiguard"))
}

func implicitLogFix() ([]string, []FixTarget) {
	return fixGlobal(cmdbLogSet, set("fwpolicy-implicit-log", "enable"))
}

func syslogFix() ([]string, []FixTarget) {
	return fixGlobal(cmdbSyslog, set("status", "enable"), set("server", "<collector-ip>"))
}

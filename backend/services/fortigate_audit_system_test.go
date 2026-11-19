package services

import (
	"strings"
	"testing"
)

// The management-plane checks are a pure function of the posture struct, so they are tested
// without a device. What the LIVE FGT80E returned on 2026-08-20 is used as the fixture below, so
// these cases are not invented shapes — they are the real ones.

func countChecks(f []AuditFinding) map[string]int {
	out := map[string]int{}
	for _, x := range f {
		out[x.Check]++
	}
	return out
}

// labPosture is the lab device as it actually was: one wide-open admin account, HTTP management on
// the WAN interface, implicit-deny logging off, and everything else correctly set.
func labPosture() systemPosture {
	return systemPosture{
		AdminTimeout: 5, LockoutThreshold: 3, GlobalOK: true,
		Admins:   []FGAdminAccount{{Name: "admin", AccProfile: "super_admin"}},
		AdminsOK: true,
		Interfaces: []FGInterfacePosture{
			// wan1 is role=wan and up, but DHCP has handed it no lease — exactly as the lab device
			// was, and the reason its Security Rating and this scan disagree about it.
			{Name: "wan1", Type: "physical", AllowAccess: []string{"ping", "https", "ssh", "http"}, SrcCheck: "enable"},
			{Name: "port1", Type: "physical", AllowAccess: []string{"ping", "https", "ssh"}, SrcCheck: "enable", Addressed: true, Routable: true},
			{Name: "naf.root", Type: "tunnel", SrcCheck: "disable"},
		},
		IntfOK:          true,
		NTPSync:         "enable",
		NTPOK:           true,
		ImplicitDenyLog: "disable",
		LogSettingOK:    true,
		LogTargets:      []string{"FortiGate Cloud"},
		LogTargetsOK:    true,
		FirmwareCurrent: "v7.2.10",
		FirmwareOK:      false, // lapsed entitlement: the device offered no upgrade list
	}
}

func TestLabPostureProducesExactlyTheKnownFindings(t *testing.T) {
	found, undecided, notes := labPosture().findings("wan1")
	got := countChecks(found)

	want := map[string]int{
		"mgmt-cleartext-access": 1, // http on wan1
		"admin-unrestricted":    1, // admin has no trusted host
		"log-implicit-deny-off": 1, // fwpolicy-implicit-log disable
	}
	for check, n := range want {
		if got[check] != n {
			t.Errorf("%s: got %d findings, want %d", check, got[check], n)
		}
	}
	for check, n := range got {
		if want[check] == 0 {
			t.Errorf("unexpected finding %s x%d - the lab device was correct on this", check, n)
		}
	}

	// The one thing the device could not answer must be undetermined, not a pass.
	if !undecided["firmware-outdated"] {
		t.Error("an empty firmware upgrade list was not reported as undetermined - a lapsed entitlement looks exactly like being up to date")
	}
	if len(notes) == 0 {
		t.Error("nothing was said about why firmware currency could not be evaluated")
	}
}

// The same setting is a different finding depending on where it is. Credentials crossing a lab LAN
// and credentials crossing the internet are not the same problem.
func TestCleartextManagementIsWorseOnTheInternetInterface(t *testing.T) {
	sp := labPosture()

	onWAN, _, _ := sp.findings("wan1")
	var wanSev AuditSeverity
	for _, f := range onWAN {
		if f.Check == "mgmt-cleartext-access" {
			wanSev = f.Severity
		}
	}
	if wanSev != SeverityHigh {
		t.Errorf("http on the default-route interface is %q, expected %q", wanSev, SeverityHigh)
	}

	// Same config, but the default route could not be identified. The finding must survive, at a
	// lower severity — cleartext management is worth reporting wherever it is.
	unknown, _, _ := sp.findings("")
	var anySev AuditSeverity
	for _, f := range unknown {
		if f.Check == "mgmt-cleartext-access" {
			anySev = f.Severity
		}
	}
	if anySev != SeverityMedium {
		t.Errorf("http with no known WAN interface is %q, expected %q", anySev, SeverityMedium)
	}
}

func TestTelnetIsReportedToo(t *testing.T) {
	sp := labPosture()
	sp.Interfaces = []FGInterfacePosture{
		{Name: "lan", Type: "hard-switch", AllowAccess: []string{"ping", "https", "telnet"}, SrcCheck: "enable", Routable: true},
	}
	found, _, _ := sp.findings("wan1")
	if countChecks(found)["mgmt-cleartext-access"] != 1 {
		t.Error("telnet in allowaccess was not reported")
	}
}

// snmp is excluded on purpose: allowaccess does not say whether v3 is in use, and a check that
// cannot tell v2c from v3 would fire on every correct deployment.
func TestSecureManagementProtocolsAreSilent(t *testing.T) {
	sp := labPosture()
	sp.Interfaces = []FGInterfacePosture{
		{Name: "port1", Type: "physical", AllowAccess: []string{"ping", "https", "ssh", "snmp", "fgfm", "fabric"}, SrcCheck: "enable", Routable: true},
	}
	found, _, _ := sp.findings("wan1")
	if n := countChecks(found)["mgmt-cleartext-access"]; n != 0 {
		t.Errorf("https/ssh/snmp/fgfm/fabric produced %d cleartext findings, expected 0", n)
	}
}

// The trap this check exists for: FortiOS fills unused trusted-host slots with 0.0.0.0 0.0.0.0,
// which MEANS any host. readAdmins strips those, so a restricted account is one with something
// left over.
func TestTrustHostRestrictionIsRecognised(t *testing.T) {
	sp := labPosture()
	sp.Admins = []FGAdminAccount{
		{Name: "admin", AccProfile: "super_admin"},                                                   // every slot was "any"
		{Name: "netops", AccProfile: "super_admin", TrustHosts: []string{"10.0.99.0 255.255.255.0"}}, // restricted
	}
	found, _, _ := sp.findings("wan1")
	if n := countChecks(found)["admin-unrestricted"]; n != 1 {
		t.Errorf("got %d unrestricted-admin findings, want 1 - only the account with no real trusted host counts", n)
	}
	for _, f := range found {
		if f.Check == "admin-unrestricted" && f.ObjectName != "admin" {
			t.Errorf("the wrong account was reported: %q", f.ObjectName)
		}
	}
}

func TestIdleTimeoutBoundary(t *testing.T) {
	cases := []struct {
		timeout int
		want    int
	}{
		{5, 0},
		{maxAdminIdleMinutes, 0},     // exactly at PCI DSS 8.2.8's limit is compliant
		{maxAdminIdleMinutes + 1, 1}, // one minute over is not
		{0, 1},                       // 0 disables the timeout entirely, which is the worst case
		{480, 1},
	}
	for _, tc := range cases {
		sp := labPosture()
		sp.AdminTimeout = tc.timeout
		found, _, _ := sp.findings("wan1")
		if n := countChecks(found)["admin-timeout-long"]; n != tc.want {
			t.Errorf("admintimeout %d produced %d findings, want %d", tc.timeout, n, tc.want)
		}
	}
}

func TestLockoutDisabledIsReported(t *testing.T) {
	sp := labPosture()
	sp.LockoutThreshold = 0
	found, _, _ := sp.findings("wan1")
	if countChecks(found)["admin-lockout-weak"] != 1 {
		t.Error("a lockout threshold of 0 was not reported")
	}
}

// Anti-spoofing on a tunnel FortiOS created for itself is not a finding — nobody configured it and
// nobody can fix it. On a routable interface it is.
func TestAntiSpoofIgnoresSystemTunnels(t *testing.T) {
	sp := labPosture()
	found, _, _ := sp.findings("wan1")
	if n := countChecks(found)["intf-no-antispoof"]; n != 0 {
		t.Errorf("src-check disable on naf.root produced %d findings, want 0 - it is a system-generated tunnel", n)
	}

	sp.Interfaces = append(sp.Interfaces, FGInterfacePosture{
		Name: "dmz", Type: "physical", SrcCheck: "disable", Routable: true,
	})
	found, _, _ = sp.findings("wan1")
	if n := countChecks(found)["intf-no-antispoof"]; n != 1 {
		t.Errorf("src-check disable on a routable interface produced %d findings, want 1", n)
	}
}

func TestClockAndLoggingChecks(t *testing.T) {
	sp := labPosture()
	sp.NTPSync = "disable"
	sp.ImplicitDenyLog = "enable"
	sp.LogTargets = nil

	found, _, _ := sp.findings("wan1")
	got := countChecks(found)
	if got["time-not-synced"] != 1 {
		t.Error("ntpsync disable was not reported")
	}
	if got["log-implicit-deny-off"] != 0 {
		t.Error("implicit-deny logging was ON and was still reported")
	}
	if got["log-no-remote"] != 1 {
		t.Error("a device forwarding logs nowhere was not reported")
	}
}

// One enabled destination is enough. FortiGate Cloud counts — it is off-box, which is the point of
// the control — and the lab device's only target is exactly that.
func TestAnyRemoteLogTargetSatisfiesTheCheck(t *testing.T) {
	for _, target := range []string{"syslog", "FortiAnalyzer", "FortiGate Cloud"} {
		sp := labPosture()
		sp.LogTargets = []string{target}
		found, _, _ := sp.findings("wan1")
		if n := countChecks(found)["log-no-remote"]; n != 0 {
			t.Errorf("%s enabled still produced %d log-no-remote findings", target, n)
		}
	}
}

func TestFirmwareUpgradeOfferedIsReported(t *testing.T) {
	sp := labPosture()
	sp.FirmwareOK = true
	sp.FirmwareLatest = "v7.2.11"

	found, undecided, _ := sp.findings("wan1")
	if countChecks(found)["firmware-outdated"] != 1 {
		t.Error("an offered upgrade was not reported")
	}
	if undecided["firmware-outdated"] {
		t.Error("the check ran and still reported itself as undetermined")
	}

	// Readable list, nothing newer in it: that is a genuine pass, not a finding and not undetermined.
	sp.FirmwareLatest = ""
	found, undecided, _ = sp.findings("wan1")
	if countChecks(found)["firmware-outdated"] != 0 || undecided["firmware-outdated"] {
		t.Error("a device on the newest offered build was not treated as clean")
	}
}

// Every section that fails to read must land as undetermined WITH a note. A silent skip is
// indistinguishable from a pass, which is the failure mode this whole feature is built against.
func TestUnreadableSectionsBecomeUndeterminedNotPasses(t *testing.T) {
	var empty systemPosture // nothing read at all

	found, undecided, notes := empty.findings("wan1")
	if len(found) != 0 {
		t.Errorf("a posture that read nothing produced %d findings", len(found))
	}
	for _, check := range []string{
		"mgmt-cleartext-access", "intf-no-antispoof", "admin-unrestricted",
		"admin-timeout-long", "admin-lockout-weak", "time-not-synced",
		"log-implicit-deny-off", "log-no-remote", "firmware-outdated",
	} {
		if !undecided[check] {
			t.Errorf("%s was neither evaluated nor reported as undetermined - it would read as a pass", check)
		}
	}
	if len(notes) < 6 {
		t.Errorf("only %d notes for six unreadable sections - a reader cannot see what was skipped", len(notes))
	}
	for _, n := range notes {
		if !strings.Contains(n, "could not") {
			t.Errorf("note does not say something could not be done: %q", n)
		}
	}
}

// Every management-plane check has to be one the engine declares, or the standards view maps
// evidence that never arrives.
func TestSystemChecksAreDeclared(t *testing.T) {
	known := map[string]bool{}
	for _, c := range AuditChecks {
		known[c] = true
	}
	sp := labPosture()
	sp.NTPSync = "disable"
	sp.LockoutThreshold = 0
	sp.AdminTimeout = 60
	sp.LogTargets = nil
	sp.FirmwareOK, sp.FirmwareLatest = true, "v7.2.11"
	sp.Interfaces = append(sp.Interfaces, FGInterfacePosture{Name: "dmz", Type: "physical", SrcCheck: "disable", Routable: true})

	found, _, _ := sp.findings("wan1")
	seen := map[string]bool{}
	for _, f := range found {
		if !known[f.Check] {
			t.Errorf("the system scan emitted %q, which AuditChecks does not list", f.Check)
		}
		if f.Category == "" || f.Title == "" || f.Detail == "" || f.Subject == "" {
			t.Errorf("%s: a finding reached the report with an empty field", f.Check)
		}
		seen[f.Check] = true
	}
	// This fixture is built to trip every one of them.
	for _, c := range []string{
		"mgmt-cleartext-access", "admin-unrestricted", "admin-timeout-long", "admin-lockout-weak",
		"intf-no-antispoof", "firmware-outdated", "log-implicit-deny-off", "log-no-remote", "time-not-synced",
	} {
		if !seen[c] {
			t.Errorf("%s did not fire on a posture built to trip it", c)
		}
	}
}

// A setting on an interface with no address is still a finding — a configuration review reads the
// configuration. The finding has to say so, because the device's own rating appears to skip such
// interfaces and a reader holding both assessments needs the fact that explains the difference.
func TestUnaddressedInterfaceIsStillReportedAndSaysSo(t *testing.T) {
	found, _, _ := labPosture().findings("wan1")

	var detail string
	for _, f := range found {
		if f.Check == "mgmt-cleartext-access" {
			detail = f.Detail
		}
	}
	if detail == "" {
		t.Fatal("http on an unaddressed WAN interface was not reported at all")
	}
	if !strings.Contains(detail, "no address at present") {
		t.Errorf("the finding does not mention that the interface is unaddressed: %q", detail)
	}
	if !strings.Contains(detail, "takes effect the moment") {
		t.Errorf("the finding does not say the permission is live as soon as an address arrives: %q", detail)
	}

	// An addressed interface must NOT carry that sentence — it would be simply untrue.
	sp := labPosture()
	sp.Interfaces = []FGInterfacePosture{
		{Name: "lan", Type: "hard-switch", AllowAccess: []string{"https", "telnet"}, SrcCheck: "enable", Addressed: true, Routable: true},
	}
	found, _, _ = sp.findings("wan1")
	for _, f := range found {
		if f.Check == "mgmt-cleartext-access" && strings.Contains(f.Detail, "no address at present") {
			t.Errorf("an addressed interface was described as unaddressed: %q", f.Detail)
		}
	}
}

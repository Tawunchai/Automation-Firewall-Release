package configdeploy

import "testing"

// `diagnose` is not a read-only verb on FortiOS.
//
// The query allow-list used to carry `^\s*diagnose\s+`, which reads as "diagnostics are safe". It
// is not a safety class, it is the prefix of the entire diagnostic subsystem, and a large part of
// that subsystem changes the device: `diagnose sys session clear` drops every live session,
// `diagnose sys session filter …` sets GLOBAL CLI state that silently narrows what the next
// operator sees, `diagnose debug application … -1` turns on firehose debugging on a production
// firewall, `diagnose vpn ike restart` renegotiates tunnels. All four were accepted by an endpoint
// whose entire justification is that it only reads.
//
// Each case below is one command that must be refused with the reason it mutates, paired with the
// `list`/`state` form of the same subject that must still work — because an allow-list that is too
// tight breaks the Troubleshooting and assistant queries this product actually runs, and that kind
// of failure gets fixed by widening the pattern back out.

func TestDiagnoseAllowList_RejectsMutatingSubCommands(t *testing.T) {
	cases := []struct {
		name string
		cmd  string
		why  string
	}{
		{"session clear", "diagnose sys session clear",
			"drops every live session — everyone behind the firewall loses their connections"},
		{"session filter", "diagnose sys session filter dport 443",
			"sets global CLI state that outlives the login and narrows the next operator's session list"},
		{"session filter clear", "diagnose sys session filter clear",
			"same global state, written from the other direction"},
		{"debug application", "diagnose debug application ike -1",
			"turns on firehose debug output on a production device and leaves it on"},
		{"debug enable", "diagnose debug enable",
			"same"},
		{"ike restart", "diagnose vpn ike restart",
			"renegotiates IPsec tunnels"},
		{"ike gateway flush", "diagnose vpn ike gateway flush",
			"drops IKE gateways"},
		{"tunnel flush", "diagnose vpn tunnel flush",
			"drops IPsec SAs"},
		{"tunnel down", "diagnose vpn tunnel down tunnel-1",
			"takes a tunnel down"},
		{"iprope clear", "diagnose firewall iprope clear",
			"flushes the compiled policy state"},
		{"hardware test", "diagnose hardware test suite 1",
			"runs hardware self-tests"},
		{"sys kill", "diagnose sys kill 11 123",
			"kills a process on the firewall"},
		{"sys reboot-cause", "diagnose sys flash list",
			"not a sub-command this product issues — the allow-list is a list, not a prefix"},
		{"bare diagnose", "diagnose",
			"the prefix alone means nothing and must not pass"},
		// Each of these starts with an ALLOWED sub-command and continues into something else; the
		// patterns pin the terminator so a prefix match cannot be widened by appending.
		{"list extended into clear", "diagnose sys session list-and-clear",
			"a longer word that merely starts with an allowed one"},
		{"top extended", "diagnose sys topology reset",
			"starts with 'top' but is not 'sys top'"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if bad := findDisallowedQueryCommand([]string{tc.cmd}); bad == "" {
				t.Errorf("findDisallowedQueryCommand([%q]) allowed it, want refused — %s", tc.cmd, tc.why)
			}
		})
	}
}

func TestDiagnoseAllowList_KeepsTheReadOnlyCommandsThisProductRuns(t *testing.T) {
	cases := []struct {
		cmd     string
		usedFor string
	}{
		{"diagnose autoupdate status", "FortiGuard contract/engine versions"},
		{"diagnose firewall iprope state", "policy engine state (AI prompt §17)"},
		{"diagnose firewall iprope list", "compiled policy list"},
		{"diagnose firewall iprope lookup 192.168.1.50 1024 8.8.8.8 443 6 lan",
			"the policy walk Troubleshooting corroborates against (services/fortigate_troubleshoot.go)"},
		{"diagnose hardware deviceinfo disk", "disk inventory (AI prompt §17)"},
		{"diagnose hardware deviceinfo nic port1", "NIC counters"},
		{"diagnose ip address list", "addresses the device believes it has (AI prompt §17)"},
		{"diagnose netlink interface list", "kernel interface list (AI prompt §17)"},
		{"diagnose netlink interface list port1", "the same, narrowed"},
		{"diagnose sys checkused firewall.address", "what still references an object (services/fortigate_usage.go)"},
		{"diagnose sys session list", "the session table (services/fortigate_diagexec.go)"},
		{"diagnose sys top", "per-process CPU"},
		{"diagnose sys top 5 20", "the same with interval and line count (AI prompt §17)"},
		{"diagnose vpn ike gateway list", "IKE gateway state (AI prompt §17)"},
		{"diagnose vpn tunnel list", "IPsec SA state (AI prompt §17)"},
		{"  DIAGNOSE  SYS  TOP  ", "indented, padded and shouted — the device does not care and neither should this"},
	}
	for _, tc := range cases {
		t.Run(tc.cmd, func(t *testing.T) {
			if bad := findDisallowedQueryCommand([]string{tc.cmd}); bad != "" {
				t.Errorf("findDisallowedQueryCommand([%q]) = %q, want allowed — %s", tc.cmd, bad, tc.usedFor)
			}
		})
	}
}

// One mutating line anywhere in the batch refuses the whole batch: the ten commands run in one SSH
// session, so "the read-only ones ran first" is not a consolation.
func TestDiagnoseAllowList_OneBadLineRefusesTheBatch(t *testing.T) {
	commands := []string{
		"get system status",
		"diagnose sys session list",
		"diagnose sys session clear",
		"diagnose sys top",
	}
	if bad := findDisallowedQueryCommand(commands); bad != "diagnose sys session clear" {
		t.Fatalf("findDisallowedQueryCommand(%v) = %q, want %q", commands, bad, "diagnose sys session clear")
	}
}

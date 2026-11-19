package configdeploy

import "testing"

// ── commandBlocklist (multi-vendor: FortiOS / Cisco IOS / H3C Comware) ───────

func TestFindBlockedCommand_Allowed(t *testing.T) {
	cases := [][]string{
		{"config system interface", "edit port1", "set status up", "next", "end"},    // FortiOS
		{"configure terminal", "interface GigabitEthernet0/1", "no shutdown", "end"}, // Cisco IOS
		{"system-view", "interface GigabitEthernet1/0/1", "undo shutdown", "return"}, // H3C
	}
	for _, commands := range cases {
		if bad := findBlockedCommand(commands); bad != "" {
			t.Errorf("findBlockedCommand(%v) = %q, want \"\"", commands, bad)
		}
	}
}

func TestFindBlockedCommand_Blocked(t *testing.T) {
	cases := []struct {
		name     string
		commands []string
	}{
		// FortiOS
		{"fortios reboot", []string{"config system global", "execute reboot"}},
		{"fortios factoryreset", []string{"execute factoryreset"}},
		{"fortios factoryreset2", []string{"execute factoryreset2"}},
		{"fortios formatlogdisk", []string{"execute formatlogdisk"}},
		{"fortios restore", []string{"execute restore config flash myconf"}},

		// Cisco IOS
		{"cisco reload", []string{"reload"}},
		{"cisco reload with args", []string{"reload in 5"}},
		{"cisco write erase", []string{"write erase"}},
		{"cisco erase startup-config", []string{"erase startup-config"}},
		{"cisco format flash", []string{"format flash:"}},
		{"cisco delete force", []string{"delete /force flash:old.bin"}},

		// H3C Comware
		{"h3c reboot", []string{"reboot"}},
		{"h3c reset saved-configuration", []string{"reset saved-configuration"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if bad := findBlockedCommand(tc.commands); bad == "" {
				t.Errorf("findBlockedCommand(%v) = \"\", want a blocked command", tc.commands)
			}
		})
	}
}

func TestFindBlockedCommand_CaseInsensitiveAndIndented(t *testing.T) {
	cases := [][]string{
		{"  RELOAD"},
		{"\tExecute Reboot"},
		{"   ReBoOt"},
	}
	for _, commands := range cases {
		if bad := findBlockedCommand(commands); bad == "" {
			t.Errorf("findBlockedCommand(%v) = \"\", want a blocked command", commands)
		}
	}
}

// ── allowedQueryPatterns (multi-vendor read-only commands) ───────────────────

func TestFindDisallowedQueryCommand_Allowed(t *testing.T) {
	commands := []string{
		// FortiOS
		"get system status",
		"show full-configuration",
		"diagnose sys top",
		"execute ping 8.8.8.8",
		"execute ping6 2001:db8::1",
		"execute traceroute 8.8.8.8",
		"execute traceroute6 2001:db8::1",

		// Cisco IOS / H3C Comware
		"display current-configuration",
		"display interface brief",
		"ping 8.8.8.8",
		"ping6 2001:db8::1",
		"tracert 8.8.8.8",
		"traceroute 8.8.8.8",
	}
	for _, cmd := range commands {
		if bad := findDisallowedQueryCommand([]string{cmd}); bad != "" {
			t.Errorf("findDisallowedQueryCommand([%q]) = %q, want \"\"", cmd, bad)
		}
	}
}

func TestFindDisallowedQueryCommand_Disallowed(t *testing.T) {
	cases := []struct {
		name string
		cmd  string
	}{
		{"fortios config edit", "config system interface"},
		{"cisco configure terminal", "configure terminal"},
		{"cisco write erase (also blocklisted)", "write erase"},
		{"h3c system-view", "system-view"},
		{"h3c reboot (also blocklisted)", "reboot"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if bad := findDisallowedQueryCommand([]string{tc.cmd}); bad == "" {
				t.Errorf("findDisallowedQueryCommand([%q]) = \"\", want %q to be disallowed", tc.cmd, tc.cmd)
			}
		})
	}
}

func TestFindDisallowedQueryCommand_FirstBadLineWins(t *testing.T) {
	commands := []string{"show version", "configure terminal", "display version"}
	bad := findDisallowedQueryCommand(commands)
	if bad != "configure terminal" {
		t.Errorf("findDisallowedQueryCommand(%v) = %q, want %q", commands, bad, "configure terminal")
	}
}

// ── splitCommands ──────────────────────────────────────────────────────────

func TestSplitCommands_SkipsBlankAndComments(t *testing.T) {
	text := "# comment\nshow version\n\n// another comment\n  display version  \r\nend"
	got := splitCommands(text)
	want := []string{"show version", "  display version  ", "end"}
	if len(got) != len(want) {
		t.Fatalf("splitCommands() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("splitCommands()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

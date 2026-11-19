package services

import "testing"

// The bug this file exists to prevent: rollback used to hand ANY stored text to the config-push
// worker, which typed it into a production firewall line by line. Nothing checked that the text
// was a configuration file at all.
//
// InspectConfigFile is the guard. Every test below is a shape that reached the old code path and
// would have been sent to a device.

// A real header, byte for byte from the lab FGT80E's own backup.
const labConfigHeader = `#config-version=FGT80E-7.2.10-FW-build1706-240918:opmode=0:vdom=0:user=admin
#conf_file_ver=329411106777986
#buildno=1706
#global_vdom=1
config system global
    set hostname "NGFW-Testing"
end
`

func TestInspectConfigFile_AcceptsARealBackup(t *testing.T) {
	info, err := InspectConfigFile(labConfigHeader)
	if err != nil {
		t.Fatalf("a genuine FortiGate backup was rejected: %v", err)
	}
	if info.Model != "FGT80E-7.2.10-FW-build1706-240918" {
		t.Errorf("Model = %q, want the header's platform token", info.Model)
	}
	if info.Lines < 5 {
		t.Errorf("Lines = %d, want the real line count", info.Lines)
	}
}

func TestInspectConfigFile_RejectsWhatIsNotAConfigFile(t *testing.T) {
	cases := []struct {
		name string
		text string
	}{
		{"empty", ""},
		{"whitespace only", "   \n\n  "},
		{"a shell prompt got captured with the output", "NGFW-Testing # #config-version=FGT80E-7.2.10\nconfig system global\nend"},
		{"a diff, not a config", "--- before\n+++ after\n@@ -1 +1 @@\n-set hostname a\n+set hostname b"},
		{"a config fragment with no header", "config firewall policy\n    edit 1\n    next\nend"},
		{"an HTML error page", "<html><body>403 Forbidden</body></html>"},
		{"JSON from some other endpoint", `{"results":[],"status":"success"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := InspectConfigFile(tc.text); err == nil {
				t.Fatal("accepted — this text would have been written to a real firewall")
			}
		})
	}
}

// The prompt-prefixed case is worth its own assertion: it is what `show full-configuration`
// produces when the prompt is not stripped, it looks almost right, and it is the single most
// likely thing to end up in the column by accident.
func TestInspectConfigFile_PromptPrefixIsNotAHeader(t *testing.T) {
	_, err := InspectConfigFile("NGFW-Testing # " + labConfigHeader)
	if err == nil {
		t.Fatal("a config file with the CLI prompt still attached was accepted")
	}
}

func TestConfigFileModel(t *testing.T) {
	if got := configFileModel(labConfigHeader); got != "FGT80E-7.2.10-FW-build1706-240918" {
		t.Errorf("configFileModel = %q", got)
	}
	if got := configFileModel("no header here"); got != "" {
		t.Errorf("configFileModel on a non-config = %q, want empty", got)
	}
}

func TestConfigFileMatchesDevice(t *testing.T) {
	const header = "FGT80E-7.2.10-FW-build1706-240918"

	cases := []struct {
		name      string
		header    string
		model     string
		version   string
		wantMatch bool
	}{
		{"same unit", header, "FortiGate-80E", "v7.2.10", true},
		{"different model", header, "FortiGate-60F", "v7.2.10", false},
		{"different firmware", header, "FortiGate-80E", "v7.4.4", false},
		// Unknown must never block: an unreachable firewall is not evidence of a mismatch.
		{"device could not be read", header, "", "", true},
		{"no header to compare", "", "FortiGate-80E", "v7.2.10", true},
		// A build difference within the same firmware is normal and must not be flagged.
		{"same firmware, different build", "FGT80E-7.2.10-FW-build1699-240101", "FortiGate-80E", "v7.2.10", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, reason := ConfigFileMatchesDevice(tc.header, tc.model, tc.version)
			if got != tc.wantMatch {
				t.Errorf("ConfigFileMatchesDevice = %v (%s), want %v", got, reason, tc.wantMatch)
			}
			if !got && reason == "" {
				t.Error("reported a mismatch with no reason to show the operator")
			}
		})
	}
}

// RestoreConfigFile must refuse locally rather than let the device decide. A restore that reaches
// the firewall has already committed it to a reboot.
func TestRestoreConfigFile_RefusesBeforeTouchingTheDevice(t *testing.T) {
	// A client with no transport at all: if the guard lets anything through, this panics or
	// errors with a network message instead of the validation message.
	f := &FortiClient{}
	if _, err := f.RestoreConfigFile("this is not a config"); err == nil {
		t.Fatal("RestoreConfigFile accepted a non-config file")
	}
}

package policyobject

import (
	"strings"
	"testing"
)

// ── Administrators ───────────────────────────────────────────────────────────

func pw(s string) *string { return &s }

func TestValidateAdmin_ANewLocalAccountNeedsAPassword(t *testing.T) {
	if validateAdmin(adminInput{Name: "ops", AccProfile: "prof_admin"}, true) == "" {
		t.Error("a new account with no password was accepted")
	}
	if msg := validateAdmin(adminInput{Name: "ops", AccProfile: "prof_admin", Password: pw("x")}, true); msg != "" {
		t.Errorf("a valid new account was rejected: %s", msg)
	}
	// An EDIT with no password is the normal case — it means "leave the password alone".
	if msg := validateAdmin(adminInput{Name: "ops", AccProfile: "prof_admin"}, false); msg != "" {
		t.Errorf("an edit that did not touch the password was rejected: %s", msg)
	}
}

func TestValidateAdmin_ARemoteAccountNeedsItsGroupInsteadOfAPassword(t *testing.T) {
	remote := adminInput{Name: "ops", AccProfile: "prof_admin", RemoteAuth: true, RemoteGroup: "ldap-admins"}
	if msg := validateAdmin(remote, true); msg != "" {
		t.Errorf("a remote account was rejected: %s", msg)
	}
	remote.RemoteGroup = ""
	if validateAdmin(remote, true) == "" {
		t.Error("a remote account with no group was accepted — it can never authenticate")
	}
}

func TestValidateAdmin_TrustedHostsMustBeSubnets(t *testing.T) {
	// A bare word lands in the field and then matches nothing, which locks the account out while
	// the screen shows a trusted host that looks deliberate.
	bad := adminInput{Name: "ops", AccProfile: "prof_admin", TrustHosts: []string{"office"}}
	msg := validateAdmin(bad, false)
	if msg == "" {
		t.Fatal("a trusted host that is not a subnet was accepted")
	}
	if !strings.Contains(msg, "office") {
		t.Errorf("the message should quote the value, got: %s", msg)
	}

	for _, h := range []string{"10.0.0.0/24", "10.0.0.0 255.255.255.0"} {
		ok := adminInput{Name: "ops", AccProfile: "prof_admin", TrustHosts: []string{h}}
		if msg := validateAdmin(ok, false); msg != "" {
			t.Errorf("%q was rejected: %s", h, msg)
		}
	}
}

func TestValidateAdmin_NeedsANameAndAProfile(t *testing.T) {
	if validateAdmin(adminInput{AccProfile: "prof_admin", Password: pw("x")}, true) == "" {
		t.Error("an account with no name was accepted")
	}
	if validateAdmin(adminInput{Name: "ops", Password: pw("x")}, true) == "" {
		t.Error("an account with no access profile was accepted")
	}
}

// ── Log settings ─────────────────────────────────────────────────────────────

func TestValidateLogSettings_ADestinationSwitchedOnWithNoServerIsRefused(t *testing.T) {
	// FortiOS accepts this and sends the logs nowhere — the destination reads as "on" on every
	// screen that shows it.
	on := true
	syslog := logSettingsInput{Syslog: &logSyslogInput{Enabled: on, Server: "  "}}
	if msg := validateLogSettings(syslog); msg == "" {
		t.Error("syslog enabled with no server was accepted")
	}

	faz := logSettingsInput{FortiAnalyzer: &logFAZInput{Enabled: on}}
	if msg := validateLogSettings(faz); msg == "" {
		t.Error("FortiAnalyzer enabled with no server was accepted")
	}

	// Switched OFF with no server is the device's own default and must stay allowed.
	off := logSettingsInput{Syslog: &logSyslogInput{Enabled: false, Server: ""}}
	if msg := validateLogSettings(off); msg != "" {
		t.Errorf("a disabled destination was rejected: %s", msg)
	}
}

func TestValidateLogSettings_RejectsImpossibleNumbers(t *testing.T) {
	port := logSettingsInput{Syslog: &logSyslogInput{Enabled: true, Server: "10.0.0.5", Port: 70000}}
	if validateLogSettings(port) == "" {
		t.Error("a syslog port above 65535 was accepted")
	}
	size := logSettingsInput{Disk: &logDiskInput{MaxLogFileSizeMB: -1}}
	if validateLogSettings(size) == "" {
		t.Error("a negative log file size was accepted")
	}
	age := logSettingsInput{Disk: &logDiskInput{MaximumLogAgeDays: -5}}
	if validateLogSettings(age) == "" {
		t.Error("a negative log age was accepted")
	}
}

func TestValidateLogSettings_SectionsNotSentAreNotChecked(t *testing.T) {
	// The pointers are what make "leave this section alone" possible. An empty submission must not
	// be treated as "switch everything off with no server".
	if msg := validateLogSettings(logSettingsInput{}); msg != "" {
		t.Errorf("an empty submission was rejected: %s", msg)
	}
}

package services

import (
	"strings"
	"testing"

	"network_automation/entity"
)

// The rule that decides whether unattended work can run.
//
// It is the answer nobody could get before: on this deployment no scheduled backup had EVER
// succeeded — config_backups held zero rows — while the Devices page, the job list and the device's
// own REST calls all looked healthy. The state was knowable from one already-loaded row the whole
// time; nothing asked.
func TestAutomationStateOf(t *testing.T) {
	cases := []struct {
		name        string
		credID      uint
		username    string
		passwordEnc string
		want        AutomationState
		wantWarn    bool
	}{
		{
			name: "somebody nominated an account", credID: 4,
			username: "admin", passwordEnc: "v3:abc",
			want: AutomationReady, wantWarn: false,
		},
		{
			name: "nomination wins even with a legacy login present", credID: 4,
			username: "old-admin", passwordEnc: "v2:stale",
			want: AutomationReady, wantWarn: false,
		},
		{
			name: "no nomination, falling back to the device row", credID: 0,
			username: "admin", passwordEnc: "v3:whatever",
			want: AutomationLegacy, wantWarn: true,
		},
		{
			name: "nothing at all", credID: 0,
			want: AutomationNone, wantWarn: true,
		},
		{
			name: "a username with no password is not a login", credID: 0,
			username: "admin", passwordEnc: "",
			want: AutomationNone, wantWarn: true,
		},
		{
			name: "whitespace is not a username", credID: 0,
			username: "   ", passwordEnc: "v3:abc",
			want: AutomationNone, wantWarn: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := automationStateOf(tc.credID, tc.username, tc.passwordEnc)
			if got.State != tc.want {
				t.Errorf("state = %q, want %q", got.State, tc.want)
			}
			if hasWarn := got.Warning != ""; hasWarn != tc.wantWarn {
				t.Errorf("warning present = %v, want %v", hasWarn, tc.wantWarn)
			}
			if got.OK() != (tc.want == AutomationReady) {
				t.Errorf("OK() = %v for state %q", got.OK(), got.State)
			}
		})
	}
}

// The legacy state is the one that has to be loud. It is not an error — the login may work — but it
// is the state this deployment sat in for months while everything looked fine, so a warning that
// does not say what to do would be no better than the silence it replaces.
func TestLegacyWarningNamesTheScreenAndTheAction(t *testing.T) {
	warn := automationStateOf(0, "admin", "v2:stale").Warning

	for _, needle := range []string{"Device Credentials", "use for scheduled work"} {
		if !strings.Contains(warn, needle) {
			t.Errorf("the legacy warning does not mention %q — an operator reading it has to know "+
				"where to go and what to tick.\n  got: %s", needle, warn)
		}
	}
	if strings.Contains(strings.ToLower(warn), "username/password") {
		t.Error("the warning repeats 'check username/password', which is the message that sent " +
			"people to the firewall for a problem that was never there")
	}
}

func TestDeviceAutomationReadinessHandlesANilDevice(t *testing.T) {
	// Not reachable through the handlers, but this is called from the scheduler and from a boot-time
	// sweep; a nil there must read as "cannot run", never as ready.
	if DeviceAutomationReadiness(nil).OK() {
		t.Fatal("a nil device was reported ready for unattended work")
	}
}

func TestDeviceAutomationReadinessReadsTheDeviceRow(t *testing.T) {
	ready := DeviceAutomationReadiness(&entity.NetworkDevice{AutomationCredentialID: 7})
	if !ready.OK() {
		t.Errorf("a device with a nominated credential was not ready: %+v", ready)
	}

	none := DeviceAutomationReadiness(&entity.NetworkDevice{})
	if none.State != AutomationNone {
		t.Errorf("a device with nothing configured = %q, want %q", none.State, AutomationNone)
	}
}

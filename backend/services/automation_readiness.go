package services

import (
	"strings"

	"gorm.io/gorm"
	"network_automation/entity"
)

// "Can unattended work actually run on this device?"
//
// ── The failure this exists to prevent ───────────────────────────────────────
//
// Scheduled backups had never once succeeded on this deployment: config_backups was empty, and the
// jobs that ran reported "login ไม่ผ่าน (ตรวจ username/password)" — which sent whoever read it to
// check the firewall, where nothing was wrong. The console's own REST calls to the same device
// worked all along.
//
// The cause was that the two paths use different credentials. Anything a person clicks reaches the
// device as THEIR account (ResolveDeviceLogin). Unattended work has no person, so it uses the
// account nominated for the device — and when none is nominated, ResolveAutomationLogin falls back
// to the username and password stored on the network_devices row. No screen has written that row
// since Profile ▸ Device Credentials replaced the login fields on the Devices form, so its contents
// are whatever was typed before that change and have never been tested. Here they were simply
// stale.
//
// Nothing surfaced any of this until a job failed, and the failure named the wrong thing. So the
// state is now something the system can be asked about directly — before a job is queued, and on
// the Devices page, rather than after the fact in a job result.

// AutomationState is how ready a device is for unattended work.
type AutomationState string

const (
	// AutomationReady — an account has been nominated for this device and tested when it was saved.
	AutomationReady AutomationState = "ready"

	// AutomationLegacy — nothing nominated, but the device row still carries a login, so work will
	// run as that. It may succeed; nobody can maintain it, and nothing has verified it.
	AutomationLegacy AutomationState = "legacy"

	// AutomationNone — nothing nominated and no legacy login. Every scheduled job fails at enqueue.
	AutomationNone AutomationState = "none"
)

// AutomationReadiness describes a device's unattended-work credential.
type AutomationReadiness struct {
	State AutomationState `json:"state"`

	// Warning is empty when State is ready, and otherwise says what to do about it — in the words
	// somebody acting on it needs, naming the screen rather than the table.
	Warning string `json:"warning,omitempty"`
}

// OK reports whether unattended work can be expected to run.
func (r AutomationReadiness) OK() bool { return r.State == AutomationReady }

// automationStateOf is the rule, over the two facts it depends on.
//
// Separated from the database so it can be tested directly — the same reason sessionVerdict and
// scopeFromGrants are separate. Both inputs come from one already-loaded device row, so this costs
// no query.
func automationStateOf(nominatedCredentialID uint, legacyUsername, legacyPasswordEnc string) AutomationReadiness {
	if nominatedCredentialID != 0 {
		return AutomationReadiness{State: AutomationReady}
	}
	if strings.TrimSpace(legacyUsername) != "" && strings.TrimSpace(legacyPasswordEnc) != "" {
		return AutomationReadiness{
			State: AutomationLegacy,
			Warning: "Scheduled work on this device uses the old login stored on the device record. " +
				"No screen maintains it any more, and nothing has tested it — on this system that " +
				"login was stale and every scheduled backup failed. Open Profile ▸ Device " +
				"Credentials, add your firewall account for this device and tick " +
				"\"use for scheduled work\".",
		}
	}
	return AutomationReadiness{
		State: AutomationNone,
		Warning: "No account is nominated for scheduled work on this device, so backups, compliance " +
			"checks and the alert sweep cannot run. Open Profile ▸ Device Credentials, add your " +
			"firewall account for this device and tick \"use for scheduled work\".",
	}
}

// DeviceAutomationReadiness answers for one device.
//
// It does NOT check that the credential still works — that would mean a login attempt against a
// firewall which locks an admin account after three failures, on every page load. It answers the
// question that was previously unanswerable: whether anybody has said which account to use.
func DeviceAutomationReadiness(device *entity.NetworkDevice) AutomationReadiness {
	if device == nil {
		return AutomationReadiness{State: AutomationNone}
	}
	return automationStateOf(device.AutomationCredentialID, device.Username, device.PasswordEnc)
}

// DevicesNeedingAutomationAccount lists the devices whose scheduled work has no nominated account.
//
// Used at boot to say so once in the log, rather than leaving it to be discovered by a backup
// failing at three in the morning.
func DevicesNeedingAutomationAccount(db *gorm.DB) []entity.NetworkDevice {
	if db == nil {
		return nil
	}
	var devices []entity.NetworkDevice
	if err := db.Order("name ASC").Find(&devices).Error; err != nil {
		return nil
	}
	var out []entity.NetworkDevice
	for i := range devices {
		if !DeviceAutomationReadiness(&devices[i]).OK() {
			out = append(out, devices[i])
		}
	}
	return out
}

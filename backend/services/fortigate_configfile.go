package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"network_automation/services/platform"
	"regexp"
	"strings"
)

// Whole-device configuration file: pull one, and put one back.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// Rollback used to take the stored backup text and hand it to the config-push worker, which
// typed it into the device line by line over SSH (controller/configdeploy.Rollback →
// runDeploy → worker/config_push.py). A FortiGate configuration file is NOT a transcript of
// commands somebody typed, and replaying it as one goes wrong in ways that leave the unit
// half-written:
//
//   - The first four lines are `#config-version=…`, `#conf_file_ver=…`, `#buildno=…`,
//     `#global_vdom=…`. As CLI input they are comments at best; the version/build handshake
//     they exist for never happens, so a file taken from a different firmware is applied
//     anyway instead of being refused.
//   - `set private-key "-----BEGIN ENCRYPTED PRIVATE KEY-----\n…"` spans dozens of lines. The
//     worker splits on newlines (splitCommands), so each of those lines is sent as its own
//     command and every one of them is a syntax error.
//   - `set password ENC <ciphertext>` re-imports a secret that is only decryptable in the
//     context of the file's own header. Line by line it is just a string.
//   - There is no transaction. Line 8,000 failing leaves lines 1-7,999 applied, and the unit
//     is now in a state that matches neither the backup nor what it had before.
//
// FortiOS has a real endpoint for this, and it is what the device's own GUI uses:
//
//	POST /api/v2/monitor/system/config/restore
//	     source=upload  scope=global  file_content=<base64 of the whole file>
//
// It validates the header, applies the file atomically, and reboots. Probed live against the
// lab FGT80E (FortiOS 7.2.10, build 1706) — the parameter list here is copied from that unit's
// own `GET /api/v2/monitor/?action=schema` directory entry, not from documentation.
//
// ⚠️ A restore REBOOTS the firewall. Every caller must have said so to the user first.

// configVersionHeader is the first line every genuine FortiGate configuration file starts with.
//
// This is the check that would have caught the original bug the moment someone pointed rollback
// at the wrong text: a `show`-output fragment, a diff, an empty column, or a file from a
// different vendor all fail it, and failing it here means the device is never touched at all.
var configVersionHeader = regexp.MustCompile(`(?m)\A#config-version=([A-Za-z0-9_.\-]+)`)

// ConfigFileInfo is what could be read out of a configuration file's header.
type ConfigFileInfo struct {
	// Model is the platform string the file was taken from, e.g. "FGT80E-7.2.10-FW-build1706-240918".
	Model string `json:"model"`
	Lines int    `json:"lines"`
	Bytes int    `json:"bytes"`
}

// InspectConfigFile validates that text really is a FortiGate configuration file and reports what
// its header says. A file that does not begin with #config-version= is rejected — see the comment
// on configVersionHeader.
func InspectConfigFile(text string) (ConfigFileInfo, error) {
	info := ConfigFileInfo{Bytes: len(text), Lines: strings.Count(text, "\n") + 1}
	if strings.TrimSpace(text) == "" {
		return info, fmt.Errorf("configuration file is empty")
	}
	m := configVersionHeader.FindStringSubmatch(text)
	if m == nil {
		first := strings.TrimSpace(strings.SplitN(text, "\n", 2)[0])
		return info, fmt.Errorf(
			"this is not a FortiGate configuration file: it must start with #config-version=, "+
				"but starts with %q — restoring it would leave the device half-written",
			platform.TruncateUTF8(first, 60))
	}
	info.Model = m[1]
	return info, nil
}

// configFileModel returns the platform token from a config file header, or "" if absent.
// Used to compare a backup against the device it is about to be restored onto.
func configFileModel(text string) string {
	if m := configVersionHeader.FindStringSubmatch(text); m != nil {
		return m[1]
	}
	return ""
}

// configModelPrefix reduces a header token to the part that must match for a restore to be
// sensible: platform and firmware, without the build date.
//
//	"FGT80E-7.2.10-FW-build1706-240918" → "FGT80E-7.2.10"
//
// The build suffix is deliberately dropped. Restoring a 7.2.10 file onto 7.2.10 is normal even
// when the two were taken from different builds of it; restoring an FGT60F file onto an FGT80E,
// or a 7.4 file onto 7.2, is not.
func configModelPrefix(header string) string {
	parts := strings.Split(header, "-")
	if len(parts) < 2 {
		return header
	}
	return parts[0] + "-" + parts[1]
}

// ConfigFileMatchesDevice reports whether a config file's header is compatible with a device
// whose monitor `system/status` reported the given model and firmware version, plus a human
// reason when it is not.
//
// Both arguments come from the device as free text and either may be empty (an unreachable unit,
// a firmware that words it differently). Unknown is not the same as wrong: with nothing to
// compare against this answers "compatible" rather than blocking a restore on missing metadata.
func ConfigFileMatchesDevice(fileHeader, deviceModel, deviceVersion string) (bool, string) {
	want := configModelPrefix(fileHeader)
	if want == "" || deviceModel == "" {
		return true, ""
	}
	// The header's platform token ("FGT80E") appears inside the monitor API's model string
	// ("FortiGate-80E") only after both are squashed: strip separators and compare digits+letters.
	norm := func(s string) string {
		s = strings.ToUpper(s)
		return strings.NewReplacer("-", "", "_", "", " ", "", "FORTIGATE", "FGT").Replace(s)
	}
	filePlat := norm(strings.Split(want, "-")[0])
	devPlat := norm(deviceModel)
	if filePlat != "" && devPlat != "" && !strings.Contains(devPlat, filePlat) && !strings.Contains(filePlat, devPlat) {
		return false, fmt.Sprintf("backup was taken from %s but this device is %s", want, deviceModel)
	}
	fileVer := ""
	if p := strings.SplitN(want, "-", 2); len(p) == 2 {
		fileVer = p[1]
	}
	if fileVer != "" && deviceVersion != "" && !strings.Contains(deviceVersion, fileVer) {
		return false, fmt.Sprintf("backup is from firmware %s but this device runs %s", fileVer, deviceVersion)
	}
	return true, ""
}

// ── Restore ───────────────────────────────────────────────────────────────────

// ConfigRestoreResult is what the device says when a restore is accepted.
type ConfigRestoreResult struct {
	Started   bool   `json:"restore_started"`
	SessionID string `json:"session_id"`
	Error     string `json:"error"`
}

// RestoreConfigFile uploads a whole configuration file and asks the device to apply it.
//
// ⚠️ On success the FortiGate REBOOTS. It stops answering the API for a minute or more, and
// every session in the pool for it is dead afterwards — callers must invalidate it (see
// InvalidateFortiSession) and must have warned the user before getting here.
//
// The file is validated before a single byte goes out: a text that is not a configuration file
// is refused locally, so the failure is a message on the screen instead of a partially rewritten
// firewall. That check is the whole point of this function existing.
func (f *FortiClient) RestoreConfigFile(text string) (ConfigRestoreResult, error) {
	var out ConfigRestoreResult

	if _, err := InspectConfigFile(text); err != nil {
		return out, err
	}

	// `file_content` must be base64 with no whitespace at all — the device's own schema says so,
	// and StdEncoding.EncodeToString never inserts any (unlike the MIME encoders).
	payload := map[string]interface{}{
		"source":       "upload",
		"scope":        "global",
		"file_content": base64.StdEncoding.EncodeToString([]byte(text)),
	}

	resp, err := f.do("POST", "/api/v2/monitor/system/config/restore", payload)
	if err != nil {
		return out, err
	}
	if len(resp.Results) > 0 {
		// A failure to decode is not fatal: the device accepted the request, and the caller's
		// next move (warn, then poll or wait out the reboot) does not depend on the session id.
		_ = json.Unmarshal(resp.Results, &out)
	}
	if out.Error != "" {
		return out, fmt.Errorf("FortiGate refused the configuration: %s", out.Error)
	}
	return out, nil
}

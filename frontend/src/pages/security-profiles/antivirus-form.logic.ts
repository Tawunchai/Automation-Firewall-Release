// The pure half of antivirus-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type AVProfileForm, type AVCapabilities } from "../../api/policyObject";

export const EMPTY_AV_FORM: AVProfileForm = {
  name: "", comment: "",
  http_scan: false, smtp_scan: false, pop3_scan: false, imap_scan: false, ftp_scan: false, cifs_scan: false,
  treat_win_exec_as_virus: false,
  send_files_to_sandbox: false,
  mobile_malware_protection: true,
  quarantine: false,
  use_outbreak_db: false,
  use_external_blocklist: false,
  use_ems_threat_feed: false,
};

export const DEFAULT_AV_CAPS: AVCapabilities = { fortisandbox: true, fortiguard_av_license: true };

export function computeAVGating(form: AVProfileForm, antivirusScanOn: boolean, caps: AVCapabilities) {
  const anyProtocolScanned =
    form.http_scan || form.smtp_scan || form.pop3_scan || form.imap_scan || form.ftp_scan || form.cifs_scan;

  const scanFeatureGateOn = antivirusScanOn && anyProtocolScanned;
  const scanFeatureGateReason = "Must be inspecting at least one protocol and enable AntiVirus scan to use this feature.";
  const showScanOffWarning = !antivirusScanOn && anyProtocolScanned;

  const sandboxDisabled = !scanFeatureGateOn || !caps.fortisandbox;
  const sandboxReason = !caps.fortisandbox
    ? "FortiSandbox is not configured on this device. Configure a FortiSandbox connector (Security Fabric → Fabric Connectors) to enable this option."
    : scanFeatureGateReason;

  const outbreakDisabled = !scanFeatureGateOn || !caps.fortiguard_av_license;
  const outbreakReason = !caps.fortiguard_av_license
    ? "Requires an active FortiGuard AntiVirus subscription. This device's AntiVirus license is not active (expired or unlicensed)."
    : scanFeatureGateReason;

  return {
    anyProtocolScanned, scanFeatureGateOn, scanFeatureGateReason, showScanOffWarning,
    sandboxDisabled, sandboxReason, outbreakDisabled, outbreakReason,
  };
}

export const seedAntivirusScanOn = (f: AVProfileForm): boolean =>
  f.http_scan || f.smtp_scan || f.pop3_scan || f.imap_scan || f.ftp_scan || f.cifs_scan;

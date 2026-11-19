// The pure half of device-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import type { NetworkDevice, DeviceCreatePayload } from "../../api/device";

export type DeviceFormState = {
  name: string;
  mgmt_ip: string;
  port: number | "";
  api_port: number | "";
  site: string;
  role: string;
  status: string;
  schedule_cron: string;
};

export const BLANK_DEVICE_FORM: DeviceFormState = {
  name: "", mgmt_ip: "", port: 22, api_port: 443,
  site: "", role: "", status: "active", schedule_cron: "",
};

export const deviceToForm = (d: NetworkDevice): DeviceFormState => ({
  name: d.name, mgmt_ip: d.mgmt_ip, port: d.port, api_port: d.api_port || 443,
  site: d.site ?? "", role: d.role ?? "", status: d.status,
  schedule_cron: d.backup_enabled ? d.backup_cron : "",
});

export const SCHEDULE_OPTIONS = [
  { label: "Off (manual only)", value: "" },
  { label: "Daily 02:00", value: "0 2 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every Monday 03:00", value: "0 3 * * 1" },
  { label: "Every 5 minutes (testing)", value: "*/5 * * * *" },
];

export function validateDeviceForm(f: DeviceFormState): Record<string, boolean> {
  const bad: Record<string, boolean> = {};
  if (!f.name.trim()) bad.name = true;
  if (!f.mgmt_ip.trim()) bad.mgmt_ip = true;
  return bad;
}

export function buildDevicePayload(f: DeviceFormState): DeviceCreatePayload {
  return {
    name: f.name, mgmt_ip: f.mgmt_ip,
    port: Number(f.port) || 22, api_port: Number(f.api_port) || 443,
    site: f.site, role: f.role, status: f.status,
    vendor: "fortinet", platform: "fortinet",
    backup_enabled: !!f.schedule_cron, backup_cron: f.schedule_cron || "",
  };
}

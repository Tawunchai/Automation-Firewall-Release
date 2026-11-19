import { baseApi } from "./http";

// Who the selected firewall says it is.
//
// Lifted out of policyObject.ts, which is the console's 2,700-line API monolith and is on the
// backlog to be broken up (backend/test/layout-budget.json tracks it). This is a natural first
// piece: a device's identity is not a policy object, twenty pages read it, and none of them care
// about the rest of that file. policyObject.ts re-exports both names, so no call site moved.

/** Device system info (hostname + model from FortiGate). */
export type DeviceInfo = {
  hostname: string;
  device_ip: string;
  platform: string;
  model?: string;   // e.g. "FortiGate 80E"
  serial?: string;
  version?: string;
};

/**
 * Reads the device's own idea of its hostname, model, serial and firmware.
 *
 * Lenient on purpose — every caller writes `info.hostname || found.name`, so a page still renders
 * with the inventory name when the device will not answer. What it must NOT do is invent one.
 *
 * It used to return `hostname: "FortiGate"` on failure. Because of that `||`, the invention always
 * won: an unreadable device was labelled "FortiGate" in page headings, in success toasts, and —
 * once the security-profile forms started reporting failed reads — inside the error message whose
 * whole job is to name which firewall would not answer. On a console with more than one device
 * that is the difference between a useful message and a misleading one.
 */
export const DeviceGetInfo = async (deviceId: number): Promise<DeviceInfo> => {
  try {
    const res = await baseApi.get(`/policy/device/${deviceId}/info`);
    return res.data as DeviceInfo;
  } catch {
    return { hostname: "", device_ip: "", platform: "fortinet" };
  }
};

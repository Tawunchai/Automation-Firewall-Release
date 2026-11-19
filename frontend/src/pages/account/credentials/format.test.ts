import { describe, expect, it } from "vitest";
import { availableDevices, credentialHealth, timeAgo } from "./format";
import type { DeviceCredential } from "../../../api/deviceCredential";

const cred = (over: Partial<DeviceCredential> = {}): DeviceCredential => ({
  id: 1,
  network_device_id: 1,
  device_name: "NGFW-Testing",
  device_ip: "10.0.99.201",
  device_vendor: "fortinet",
  username: "tawunchai",
  last_used_at: null,
  last_tested_at: null,
  last_test_status: "",
  last_test_error: "",
  used_for_automation: false,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
  ...over,
});

describe("credentialHealth", () => {
  it("reads the three states the server can report", () => {
    expect(credentialHealth(cred({ last_test_status: "ok" }))).toBe("working");
    expect(credentialHealth(cred({ last_test_status: "fail" }))).toBe("failing");
    expect(credentialHealth(cred({ last_test_status: "" }))).toBe("untested");
  });

  // A credential that has never been tested must NOT be drawn as working. The card's badge is a
  // claim about a live firewall, and "we have not asked" is a different answer from "it works".
  it("never calls an untested credential working", () => {
    expect(credentialHealth(cred())).not.toBe("working");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("renders a dash when there is no timestamp", () => {
    // null is the normal value for a credential nobody has used yet — rendering it as an epoch
    // date would claim it was last used in 1970.
    expect(timeAgo(null, now)).toBe("—");
    expect(timeAgo(undefined, now)).toBe("—");
    expect(timeAgo("", now)).toBe("—");
    expect(timeAgo("not-a-date", now)).toBe("—");
  });

  it("picks the largest unit that fits", () => {
    expect(timeAgo("2026-08-17T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-08-17T11:57:00Z", now)).toBe("3 minutes ago");
    expect(timeAgo("2026-08-17T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-08-14T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo("2026-05-19T12:00:00Z", now)).toBe("3 months ago");
  });

  // Browser and server clocks disagree by seconds routinely, which makes a just-written timestamp
  // look like the future. "in -4 seconds" on a card meant to reassure is worse than rounding.
  it("does not render a future timestamp as negative", () => {
    expect(timeAgo("2026-08-17T12:00:30Z", now)).toBe("just now");
  });
});

describe("availableDevices", () => {
  const devices = [
    { id: 1, name: "NGFW-Testing" },
    { id: 2, name: "Branch-FW" },
    { id: 3, name: "DC-FW" },
  ];

  // One credential per person per device is enforced by a unique index on the server. Offering a
  // device that is already mapped would produce a 409 the user can only understand after reading
  // it, so the picker must not offer it at all.
  it("hides devices this person has already mapped", () => {
    const taken = [cred({ network_device_id: 2 })];
    expect(availableDevices(devices, taken).map((d) => d.id)).toEqual([1, 3]);
  });

  // While editing, the row's own device has to stay in the list — otherwise the select renders with
  // no matching option and appears to have lost the device.
  it("keeps the edited row's own device selectable", () => {
    const taken = [cred({ network_device_id: 2 })];
    expect(availableDevices(devices, taken, 2).map((d) => d.id)).toEqual([1, 2, 3]);
  });

  it("offers everything when nothing is mapped yet", () => {
    expect(availableDevices(devices, [])).toHaveLength(3);
  });

  it("offers nothing once every device is mapped", () => {
    const taken = devices.map((d) => cred({ network_device_id: d.id }));
    expect(availableDevices(devices, taken)).toHaveLength(0);
  });
});

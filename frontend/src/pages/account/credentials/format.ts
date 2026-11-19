import type { DeviceCredential } from "../../../api/deviceCredential";

// The judgements the Device Credentials card makes, kept out of the JSX so they can be tested.
//
// They are worth testing because each one is a claim about a live firewall: "this account works",
// "this one will be rejected", "this one has never been proven". Getting the middle case wrong is
// the expensive one — an account the device rejects is retried on every page load, and FortiOS
// locks an admin account after three consecutive failures.

/** How a credential is doing, as one word the card can colour. */
export type CredentialHealth = "working" | "failing" | "untested";

export const credentialHealth = (c: Pick<DeviceCredential, "last_test_status">): CredentialHealth => {
  if (c.last_test_status === "ok") return "working";
  if (c.last_test_status === "fail") return "failing";
  return "untested";
};

export type HealthLook = { label: string; tone: string; dot: string };

/**
 * Colour is carried by role, not by name — the same three meanings the rest of the console uses
 * (ok / danger / neutral), so a failing credential reads the same as any other failure on screen.
 */
export const HEALTH_LOOK: Record<CredentialHealth, HealthLook> = {
  working: {
    label: "Verified",
    tone: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    dot: "#10b981",
  },
  failing: {
    label: "Rejected",
    tone: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/25",
    dot: "#ef4444",
  },
  untested: {
    label: "Not verified",
    tone: "ink-3 surface-sunken border-transparent",
    dot: "#94a3b8",
  },
};

/**
 * "3 minutes ago" for a timestamp, or a dash when there is none.
 *
 * `null` is a real answer here and must not render as "1 January 1970": a credential that has never
 * been used is the normal state of one that was just added, and the card says so in words.
 */
export const timeAgo = (iso: string | null | undefined, now: Date = new Date()): string => {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  // A clock skew between browser and server can make a fresh timestamp look like the future.
  // "in -4 seconds" is nonsense on a card whose job is to be reassuring, so it clamps to "just now".
  if (seconds < 60) return "just now";

  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [2592000, "month"],
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
};

/**
 * The devices this person may still map an account to.
 *
 * One credential per device per person is the rule the unique index enforces on the server, so the
 * picker must not offer a device that is already taken — the alternative is a 409 the user can only
 * understand after reading it.
 */
export const availableDevices = <T extends { id: number }>(
  devices: T[],
  credentials: Pick<DeviceCredential, "network_device_id">[],
  /** Set when editing, so the row's own device stays selectable (and shown) in the form. */
  keepDeviceID?: number,
): T[] => {
  const taken = new Set(credentials.map((c) => c.network_device_id));
  return devices.filter((d) => d.id === keepDeviceID || !taken.has(d.id));
};

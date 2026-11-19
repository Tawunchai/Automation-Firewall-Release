import { baseApi } from "./http";

// Per-user device access — "which firewalls may this person work on".
//
// Admin-only on the server. There is deliberately no "what can I reach" call here: GET /devices is
// already scoped to the caller, so the inventory itself is the answer, and a second list could
// disagree with it.

/** One row of the picker: every device in the inventory, flagged with whether this user holds it. */
export type DeviceAccessOption = {
  id: number;
  name: string;
  mgmt_ip: string;
  vendor: string;
  site: string;
  status: string;
  granted: boolean;
  /**
   * Whether the user has mapped their OWN account on this device yet (Profile ▸ Device
   * Credentials). Independent of the grant — access without a credential still works, falling back
   * to the shared device account — but it is the difference between the firewall's log naming this
   * person and naming `admin`.
   */
  has_credential: boolean;
};

export type UserDeviceAccess = {
  user_id: number;
  user_email: string;
  /** "admin" reaches every device regardless of what is ticked. The dialog says so. */
  role: string;
  devices: DeviceAccessOption[];
};

export const GetUserDeviceAccess = async (userId: number): Promise<UserDeviceAccess> => {
  const res = await baseApi.get(`/users/${userId}/devices`);
  return res.data;
};

/** Replaces the user's grants with exactly this list. A full set, not a delta — see the server. */
export const SetUserDeviceAccess = async (
  userId: number,
  deviceIds: number[],
): Promise<{ user_id: number; device_ids: number[] }> => {
  const res = await baseApi.put(`/users/${userId}/devices`, { device_ids: deviceIds });
  return res.data;
};

export type DeviceAccessSummary = {
  /** app_user_id (as a string, because JSON object keys are) → number of devices granted. */
  counts: Record<string, number>;
  device_total: number;
};

export const GetDeviceAccessSummary = async (): Promise<DeviceAccessSummary> => {
  const res = await baseApi.get("/users/device-access/summary");
  return res.data;
};

/**
 * How to describe one user's access in a table cell.
 *
 * Pure, and exported, because the three cases it distinguishes are the whole point of the column
 * and each of them is easy to render wrongly:
 *
 *   · an admin is not "0 of 3 devices" — they reach everything, and showing a count implies a
 *     restriction that does not exist;
 *   · zero grants is not "no devices exist", it is "this person cannot open any device page";
 *   · everything granted is worth saying as such rather than as "3 of 3".
 */
export const describeDeviceAccess = (
  role: string,
  granted: number,
  total: number,
): { label: string; tone: "admin" | "none" | "all" | "some" } => {
  if (role.toLowerCase() === "admin") return { label: "All devices (admin)", tone: "admin" };
  if (total === 0) return { label: "No devices in inventory", tone: "none" };
  if (granted === 0) return { label: "No access", tone: "none" };
  if (granted >= total) return { label: `All ${total} devices`, tone: "all" };
  return { label: `${granted} of ${total} devices`, tone: "some" };
};

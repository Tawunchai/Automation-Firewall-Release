import { baseApi } from "./http";
import { apiErrorText } from "./errorText";

// My device credentials — the account I use on each firewall.
//
// Every call here is implicitly scoped to the signed-in user: the server takes the owner from the
// session cookie and there is no user id in any path or body. That is why there is no "list all"
// and no admin variant — a credential belongs to one person, and being able to read or rewrite
// somebody else's would defeat the attribution this feature exists to create.
//
// The password is write-only. It goes up on create and on a deliberate rotation; nothing ever sends
// it back, so a form editing an existing credential starts with an empty password box.

export type CredentialTestStatus = "" | "ok" | "fail";

export type DeviceCredential = {
  id: number;
  network_device_id: number;
  /** Denormalised on the server so the list does not need a second call to label its rows. */
  device_name: string;
  device_ip: string;
  device_vendor: string;
  /** The account name ON THE FIREWALL — not the console login. */
  username: string;

  last_used_at: string | null;
  last_tested_at: string | null;
  last_test_status: CredentialTestStatus;
  last_test_error: string;

  /**
   * Whether this is the account the device runs its unattended work with — scheduled backups,
   * compliance checks and the Notify alert sweep. One per device.
   *
   * The device stores a POINTER to this credential rather than a copy of the password, so changing
   * the password here changes it for the scheduler at the same moment.
   */
  used_for_automation: boolean;
  /** Who holds that job instead, when it is not this credential. Empty when nobody does. */
  automation_taken_by?: string;

  created_at: string;
  updated_at: string;
};

export type DeviceCredentialPayload = {
  network_device_id: number;
  username: string;
  /** Omitted on an update = keep the stored password. */
  password?: string;
  /** Nominate (or release) this account for the device's scheduled work. Omitted = leave as is. */
  use_for_automation?: boolean;
};

export type CredentialTestResult = {
  ok: boolean;
  status: CredentialTestStatus;
  error: string;
};

/**
 * Pulls the human-readable reason out of an axios failure.
 *
 * Worth doing carefully here: the server's messages on this route are the whole user interface for
 * "the firewall rejected this account" vs "the firewall is unreachable", and the two need different
 * reactions from the person reading them. A generic "request failed" would collapse them.
 */
export const credentialError = (err: unknown, fallback: string): string =>
  apiErrorText(err, fallback);

export const ListMyDeviceCredentials = async (): Promise<DeviceCredential[]> => {
  const res = await baseApi.get<DeviceCredential[]>("/me/device-credentials");
  return Array.isArray(res.data) ? res.data : [];
};

/**
 * A save that succeeded, plus anything the server could not do as part of it.
 *
 * The nomination for scheduled work can fail on its own (a credential that failed its last test is
 * refused the job) while the credential itself saves fine. Collapsing that into one error would
 * report a successful save as a failure; ignoring it would silently not do what was asked.
 */
export type SavedCredential = { credential: DeviceCredential; warning: string };

const unwrapSave = (data: unknown): SavedCredential =>
  data !== null && typeof data === "object" && "data" in data
    ? {
        credential: (data as { data: DeviceCredential }).data,
        warning: String((data as { warning?: unknown }).warning ?? ""),
      }
    : { credential: data as DeviceCredential, warning: "" };

export const CreateMyDeviceCredential = async (
  payload: DeviceCredentialPayload,
): Promise<SavedCredential> => {
  const res = await baseApi.post("/me/device-credentials", payload);
  return unwrapSave(res.data);
};

export const UpdateMyDeviceCredential = async (
  id: number,
  payload: Omit<DeviceCredentialPayload, "network_device_id">,
): Promise<SavedCredential> => {
  const res = await baseApi.put(`/me/device-credentials/${id}`, payload);
  return unwrapSave(res.data);
};

export const TestMyDeviceCredential = async (id: number): Promise<CredentialTestResult> => {
  const res = await baseApi.post<CredentialTestResult>(`/me/device-credentials/${id}/test`, {});
  return res.data;
};

export const DeleteMyDeviceCredential = async (id: number): Promise<void> => {
  await baseApi.delete(`/me/device-credentials/${id}`);
};

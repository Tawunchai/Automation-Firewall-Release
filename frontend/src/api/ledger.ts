import { baseApi } from "./http";

// Change Audit Ledger.
//
// Reads the app's own database rather than a firewall, which is what makes it a view that keeps
// working when the device is unreachable — exactly when someone needs to know what changed.

// ── Change ledger ────────────────────────────────────────────────────────────

export type ChangeAction = "create" | "update" | "delete";
export type ChangeStatus = "applied" | "failed" | "reverted";

export type ChangeRow = {
  id: number;
  created_at: string;
  device_id: number;
  device_name?: string;
  user_email: string;
  action: ChangeAction;
  resource_type: string;
  resource_key: string;
  method: string;
  path: string;
  status: ChangeStatus;
  error_text?: string;

  /**
   * The FortiOS object before and after the change. Absent for a create's before / a delete's after
   * — and ALWAYS absent from the list: the list ships only the has_* flags, and GetChange fetches
   * the bodies for the one row being opened.
   */
  before?: unknown;
  after?: unknown;
  has_before: boolean;
  has_after: boolean;

  reverted_at?: string;
  reverted_by?: string;
  /** Set when this row is itself the undo of another change. */
  revert_of_id?: number;

  /** Whether the Revert button should be offered, and why not when it should not. */
  revertible: boolean;
  revert_note?: string;
};

/** One entry with its before/after snapshots — what a timeline row loads when it is opened. */
export const GetChange = async (id: number): Promise<ChangeRow> => {
  const res = await baseApi.get(`/change-ledger/${id}`);
  return res.data.data;
};

/** Applies the inverse of one recorded change to the device. Admin-only on the server. */
export const RevertChange = async (id: number): Promise<{ change_id: number; revert_id: number }> => {
  const res = await baseApi.post(`/change-ledger/${id}/revert`);
  return res.data;
};

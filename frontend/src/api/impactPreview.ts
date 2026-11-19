import { baseApi } from "./http";
import type { PolicyPayload } from "./policyObject";

// Whole-Change-Set Impact Preview — "what would this proposed firewall policy change actually have
// done", answered by replaying the firewall's own recent, real traffic through the policy table as
// it is now and as the change would leave it. Writes nothing. See
// backend/services/fortigate_impact_preview.go for the engine.

export type ImpactPreviewOp = "create" | "update" | "delete" | "move";

export type ImpactPreviewRequest = {
  op: ImpactPreviewOp;
  /** Required for update, delete and move. */
  policy_id?: number;
  /** Required for create and update — the proposed policy content. */
  policy?: PolicyPayload;
  /** Required for move. */
  position?: "before" | "after";
  ref_id?: number;
};

export type ImpactedSession = {
  src_ip: string;
  dst_ip: string;
  src_port?: number;
  dst_port?: number;
  protocol: string;
  src_intf: string;
  dst_intf: string;
  /** Epoch milliseconds — the log row's own timestamp. */
  logged_at: number;
  before: string; // allowed | denied | implicit-deny | no-route
  after: string;
  before_policy_id?: number;
  after_policy_id?: number;
};

export type ImpactPreviewResult = {
  total_sampled: number;
  changed: number;
  newly_allowed: number;
  newly_blocked: number;
  samples: ImpactedSession[];
  warnings?: string[];
};

export const DevicePreviewPolicyImpact = async (
  deviceId: number, body: ImpactPreviewRequest,
): Promise<ImpactPreviewResult> => {
  const res = await baseApi.post(`/policy/device/${deviceId}/firewall-policies/impact-preview`, body);
  return res.data;
};

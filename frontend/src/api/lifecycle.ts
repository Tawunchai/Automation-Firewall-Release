import { baseApi } from "./http";

// Policy Hit-Count & Rule Lifecycle.
//
// Reads the FortiOS **monitor** API through the device proxy — runtime state, not configuration.
// Lives in its own module rather than in policyObject.ts because that file is already ~1,000 lines
// of CMDB CRUD and this is the only endpoint in the app that answers "is this rule actually being
// used".

const deviceBase = (deviceId: number) => `/policy/device/${deviceId}`;

// ── Policy lifecycle ─────────────────────────────────────────────────────────

/** A policy is in exactly one of these states. */
export type PolicyState = "active" | "idle" | "stale" | "never-used" | "disabled";

/** What the report suggests doing about a policy. "" means nothing to do. */
export type PolicyAdvice = "" | "review" | "remove";

export type PolicyUsage = {
  policyid: number;
  name: string;
  action: string;
  status: string;
  comments?: string;

  bytes: number;
  packets: number;
  hit_count: number;
  active_sessions: number;

  /** UTC epoch seconds; 0 means the device reports no match ever. */
  first_used: number;
  last_used: number;

  /** Whole days since the last match. **-1 means never used** — never render it as a duration. */
  idle_days: number;

  state: PolicyState;
  advice: PolicyAdvice;

  /** The device's own 8-bucket weekly hit histogram, oldest → newest. */
  week_hits?: number[];
};

export type PolicyUsageSummary = {
  total: number;
  active: number;
  idle: number;
  stale: number;
  never_used: number;
  disabled: number;
  removable: number;
};

export type PolicyUsageReport = {
  /** UTC epoch the idle ages were measured against — lets the UI tell a stale report from a stale rule. */
  device_time: number;
  /**
   * False when the firewall would not answer the hit counters. Every policy then looks never-used,
   * so the page must say "counters unavailable" instead of "everything is dead".
   */
  counters_available: boolean;
  stale_days: number;
  active_days: number;
  summary: PolicyUsageSummary;
  policies: PolicyUsage[];
};

export const DeviceGetPolicyUsage = async (
  deviceId: number,
  staleDays?: number,
): Promise<PolicyUsageReport> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/policy-stats`, {
    params: staleDays ? { stale_days: staleDays } : undefined,
  });
  return res.data;
};

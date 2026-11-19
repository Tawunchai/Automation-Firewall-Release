import { baseApi } from "./http";

// Troubleshooting — "why can't 10.0.1.5 reach 8.8.8.8?"
//
// The backend walks the policy table for one 5-tuple the way FortiOS does (top-down, first match
// wins) and returns far more than the matching id: every criterion of every rule it looked at, the
// rules below the match that would also have matched but never run, the rules that came closest
// when nothing matched, both routing lookups, the link state of both interfaces, and what NAT does
// to the addresses on the way through. Read-only: CMDB and monitor GETs, no SSH, no AI.
//
// Moved out of policyObject.ts, which is over its size budget and has nothing else in common with
// this page.

/** One criterion of one policy, against the traced packet. */
export type TraceCheck = {
  field: "status" | "srcintf" | "dstintf" | "srcaddr" | "dstaddr" | "service" | "schedule";
  ok: boolean;
  /** What the policy lists for this field. */
  want: string[];
  /** What the packet has — the interface, the address, "TCP/443", the device's clock. */
  got: string;
  detail: string;
  /** The answer could not be decided from configuration alone (FQDN, dynamic address). */
  unsure?: string;
};

export type PolicyVerdict = {
  policy_id: number;
  name: string;
  enabled: boolean;
  action: "accept" | "deny";
  matched: boolean;
  /** Why this policy did NOT claim the packet: its first failed check. Empty on the match. */
  reason?: string;
  src_intf: string[];
  dst_intf: string[];
  src_addr: string[];
  dst_addr: string[];
  service: string[];
  schedule: string;
  nat: boolean;
  utm: boolean;
  profiles?: string[];
  bytes: number;
  packets: number;
  active_sessions: number;
  checks: TraceCheck[];
  /** How many checks failed — 0 on a policy that matches. */
  failed: number;
};

export type PolicyTraceVerdict = "allowed" | "denied" | "no-route" | "implicit-deny";

export type RouteAnswer = { success: boolean; network: string; gateway: string; interface: string };

export type InterfaceLink = { name: string; alias?: string; ip?: string; link: boolean; speed_mbps: number };

export type TraceSNAT = { mode: "interface" | "pool"; ip?: string; pools?: string[] };

export type TraceDNAT = {
  vip: string; ext_ip: string; mapped_ip: string;
  port_forward: boolean; ext_port?: string; mapped_port?: string;
};

export type PolicyTrace = {
  query: { src_ip: string; dst_ip: string; protocol: number; dst_port: number; src_intf: string };
  ingress: string;
  ingress_via: "route" | "user";
  /** The route back to the source — where its packets arrive. */
  ingress_route: RouteAnswer;
  egress: string;
  egress_route: RouteAnswer;
  /** The address the egress route was looked up for — the VIP's mapped server when DNAT applies. */
  route_to?: string;
  routable: boolean;
  ingress_link?: InterfaceLink;
  egress_link?: InterfaceLink;
  verdict: PolicyTraceVerdict;
  /** English, for the API; the page builds its own translated sentences from the fields. */
  summary: string;
  matched: PolicyVerdict | null;
  /** Every policy checked, top-down, up to and including the match. */
  evaluated: PolicyVerdict[];
  /** Policies never reached, because an earlier one matched first. */
  below: number;
  total: number;
  /** Rules below the match that would ALSO have matched — never reached (the rule-order bug). */
  shadowed?: PolicyVerdict[];
  /** When nothing matched: the accepting rules that miss by the fewest criteria, likeliest fix first. */
  closest?: PolicyVerdict[];
  snat?: TraceSNAT;
  dnat?: TraceDNAT;
  /** Anything the walk could not decide for certain, or a down link. */
  notes?: string[];
  /** The changes that would let a blocked packet through — each already simulated. Narrowest first. */
  fixes?: FixPlan[];
  /**
   * The host name the destination was typed as; the trace ran on `query.dst_ip`, the first of
   * `resolved_ips`. Resolved by the console's DNS, not the firewall's — a CDN can answer each
   * differently, and the page says so.
   */
  resolved_from?: string;
  resolved_ips?: string[];
};

// ── Fix it: what-if, apply, undo ─────────────────────────────────────────────
//
// The backend plans each fix from its own reads and SIMULATES it before offering it; applying sends
// back only the plan's id and the fingerprint of what was previewed, and the server re-plans from a
// fresh read and refuses when that fingerprint no longer matches (the firewall changed). Nothing the
// page holds is ever written. See controller/policyobject/device_troubleshoot_fix.go.

export type FixStepOp =
  | "create-address" | "create-service" | "enable-policy" | "add-member" | "move-policy" | "create-policy";

export type FixStep = {
  op: FixStepOp;
  /** The CMDB table written. */
  table: string;
  /** An address or service name, a policy id — or "new" for the policy the plan creates. */
  name: string;
  /** add-member: which of the policy's lists grows. */
  field?: TraceCheck["field"];
  /** The member added, an address's "1.2.3.4/32", a service's "TCP/3389", the policy a move goes above. */
  value?: string;
  /** The same change as FortiOS CLI. */
  cli: string;
};

/** What the policy carrying this connection accepts once the plan is applied. */
export type FixScope = {
  /** 0 for a policy the plan creates. */
  policy_id: number;
  policy_name: string;
  src_intf: string[];
  dst_intf: string[];
  src_addr: string[];
  dst_addr: string[];
  service: string[];
  /** It accepts far more than this one connection — an address or service list is a catch-all. */
  broad: boolean;
};

export type FixPlan = {
  /** "create", "move-5", "adjust-1" — resolved by the server against a fresh trace. */
  id: string;
  kind: "create" | "move" | "adjust";
  policy_id?: number;
  policy_name?: string;
  /** The policy a move — or a created policy — is placed above. */
  ref_id?: number;
  steps: FixStep[];
  scope: FixScope;
  fingerprint: string;
};

export type FixPreview = { before: PolicyTrace; plan: FixPlan; after: PolicyTrace };

export type FixStepResult = {
  step: FixStep;
  ok: boolean;
  /** Already on the device exactly as planned: nothing written, nothing to undo. */
  reused?: boolean;
  error?: string;
  change_id?: number;
};

export type FixApplyResult = {
  results: FixStepResult[];
  /** The ledger rows of what landed — what Undo puts back. */
  change_ids: number[];
  plan: FixPlan;
  /** The LIVE trace after the writes, not the simulation. Absent if the device did not answer. */
  after?: PolicyTrace;
  /** Set when a step failed; the steps before it still landed and are in change_ids. */
  error?: string;
};

export type FixUndoResult = { results: { change_id: number; ok: boolean; error?: string }[] };

const fixBody = (q: PolicyTraceQuery, fixId: string) => ({
  src: q.src, dst: q.dst, protocol: q.protocol, port: q.port ?? 0, src_intf: q.src_intf ?? "", fix_id: fixId,
});

/** What-if: the trace now, the plan, and the trace with the plan applied. Writes nothing. */
export const DeviceTraceWhatIf = async (deviceId: number, q: PolicyTraceQuery, fixId: string): Promise<FixPreview> => {
  const res = await baseApi.post(`/policy/device/${deviceId}/policy-trace/what-if`, fixBody(q, fixId));
  return res.data;
};

/**
 * Applies a previewed plan. Admin only.
 *
 * Resolves even when a step failed part-way (the server answers 502 WITH the results): the steps
 * before the failure are on the firewall, and the page must be able to offer to undo them. It only
 * rejects when nothing was attempted — a 409 for a stale preview, a 403, an unreachable device.
 */
export const DeviceApplyTraceFix = async (
  deviceId: number, q: PolicyTraceQuery, fixId: string, fingerprint: string,
): Promise<FixApplyResult> => {
  try {
    const res = await baseApi.post(`/policy/device/${deviceId}/policy-trace/fix`, { ...fixBody(q, fixId), fingerprint });
    return res.data;
  } catch (err: unknown) {
    const data = (err as { response?: { data?: Partial<FixApplyResult> } })?.response?.data;
    if (data && Array.isArray(data.results) && data.results.length > 0) return data as FixApplyResult;
    throw err;
  }
};

/** Puts back what an apply wrote, newest first. Admin only. */
export const DeviceUndoTraceFix = async (deviceId: number, changeIds: number[]): Promise<FixUndoResult> => {
  const res = await baseApi.post(`/policy/device/${deviceId}/policy-trace/fix/undo`, { change_ids: changeIds });
  return res.data;
};

export type PolicyTraceQuery = {
  src: string;
  dst: string;
  protocol: string; // "tcp" | "udp" | "icmp" | "sctp" | an IP protocol number
  port?: number;
  src_intf?: string;
};

export const DeviceTracePolicy = async (deviceId: number, q: PolicyTraceQuery): Promise<PolicyTrace> => {
  const params = new URLSearchParams({ src: q.src, dst: q.dst, protocol: q.protocol });
  if (q.port) params.set("port", String(q.port));
  if (q.src_intf) params.set("src_intf", q.src_intf);
  const res = await baseApi.get(`/policy/device/${deviceId}/policy-trace?${params}`);
  return res.data;
};

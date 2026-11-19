/**
 * SD-WAN — zones, members, performance SLAs and rules
 *
 * Carved out of api/policyObject.ts, which reached 2,391 lines carrying every device-proxy call in
 * the console. policyObject.ts re-exports this module, so the ~138 files that import from it keep
 * working unchanged; new code should import from here directly.
 */
import { baseApi } from "./http";
import { deviceBase, deviceList, DeviceRequestError, type DeviceReadOpts } from "./deviceRequest";

// ─── SD-WAN (Network ▸ SD-WAN) ───────────────────────────────────────────────
// system/sdwan is a complex object with child tables, so this is one read for the Zones tab and
// one each for the other two. All three tabs have full CRUD.

export type SDWANZone = {
  name: string;
  service_sla_tie_break: string;
  member_count: number;
};

export type SDWANMember = {
  seq_num: number;
  interface: string;
  zone: string;
  gateway: string;
  source: string;
  cost: number;
  weight: number;
  priority: number;
  volume_ratio: number;
  status: boolean;
  comment: string;
  // Runtime, joined server-side. Every one is optional: absent means the device did not say,
  // which must never render as a measured zero.
  link?: boolean;
  speed?: number;      // Mbps
  rx_bytes?: number;   // cumulative — the Volume chart
  tx_bytes?: number;
  download_bps?: number; // measured between two polls; absent on the first load
  upload_bps?: number;
  health_status?: string;
  runtime?: Record<string, unknown>;
};

export type SDWANOverview = {
  enabled: boolean;
  load_balance_mode: string;
  zones: SDWANZone[];
  members: SDWANMember[];
};

export const EMPTY_SDWAN: SDWANOverview = {
  enabled: false, load_balance_mode: "", zones: [], members: [],
};

export type SDWANZoneForm = { name: string; service_sla_tie_break?: string };

export type SDWANMemberForm = {
  seq_num?: number;
  interface: string;
  zone: string;
  gateway?: string;
  source?: string;
  cost?: number;
  weight?: number;
  priority?: number;
  volume_ratio?: number;
  status?: boolean;
  comment?: string;
};

export type SDWANRuleSLATarget = { health_check: string; id: number };

/** The Priority Rule dialog, GUI-shaped. Which fields matter depends on `mode`. */
export type SDWANRule = {
  id: number;
  name: string;
  status: boolean;
  source: string[];
  user_groups: string[];
  users: string[];
  destination: string[];
  route_tag: number;
  internet_service: boolean;
  internet_service_names: string[];
  /** manual | priority (Best quality) | sla (Lowest cost) | load-balance (Maximize bandwidth) */
  mode: string;
  interface_preference: number[];
  zone_preference: string[];
  measured_sla: string[];
  required_sla_targets: SDWANRuleSLATarget[];
  quality_criteria: string;
  hash_mode: string;
  forward_dscp: boolean;
  forward_dscp_tag: string;
  reverse_dscp: boolean;
  reverse_dscp_tag: string;
  protocol: number;
  start_port: number;
  end_port: number;
};

/** Not a stored rule — the device's fallback for traffic that matches none of them. */
export type SDWANImplicitRule = { name: string; criteria: string; mode: string };

export type SDWANRuleList = { rules: SDWANRule[]; implicit: SDWANImplicitRule };

export type SDWANRuleForm = Omit<SDWANRule, "id"> & { id?: number };

/** One numbered SLA target inside a health check. */
export type SDWANSLARow = {
  id: number;
  /**
   * The criteria SET, exploded — "latency" | "jitter" | "packet-loss" | "mos".
   *
   * The CMDB stores it as one space-separated string, but it is what the dialog's per-threshold
   * toggles really switch: a criterion that is not in this list has no effect, and the device
   * resets its threshold to the default the moment it is dropped.
   */
  link_cost_factor: string[];
  latency_threshold: number;
  jitter_threshold: number;
  packetloss_threshold: number;
  /** A decimal STRING on the device ("3.6"), not a number. */
  mos_threshold: string;
};

/** What the device currently measures for one member of one check. */
export type SDWANHealthLive = {
  interface: string;
  status?: string;
  /** Absent, not zero, when the device did not report it. */
  latency?: number;
  jitter?: number;
  packet_loss?: number;
};

/** The "New Performance SLA" dialog, GUI-shaped. */
export type SDWANHealthCheck = {
  name: string;
  /** Probe mode: active | passive | prefer-passive. */
  detect_mode: string;
  /** ping | http | dns — the three the FortiGate dialog offers. */
  protocol: string;
  /** The Server rows. At most two: the device refuses a third. */
  servers: string[];
  /** DNS Server = "Same as System DNS" (true) or "Specify" (false). */
  system_dns: boolean;
  port: number;
  /** Participants, as SD-WAN member SEQUENCE NUMBERS. Empty = All SD-WAN Members. */
  members: number[];
  /** Those sequence numbers resolved to interfaces, for display only. */
  member_names: string[];
  /** The SLA Target section. Empty means the toggle is off. */
  sla: SDWANSLARow[];
  interval: number;
  probe_timeout: number;
  failtime: number;
  recoverytime: number;
  update_static_route: boolean;
  update_cascade_interface: boolean;
  /** system/dns, filled in only when system_dns is on. */
  system_dns_servers?: string[];
  live?: SDWANHealthLive[];
};

/** What the create/edit form sends. The server re-checks all of it. */
export type SDWANHealthCheckForm = {
  name: string;
  detect_mode: string;
  protocol: string;
  servers: string[];
  system_dns: boolean;
  members: number[];
  sla: SDWANSLARow[];
  interval: number;
  failtime: number;
  recoverytime: number;
  update_static_route: boolean;
};

const sdwanBase = (deviceId: number) => `${deviceBase(deviceId)}/sdwan`;

/** Strict by default is not offered here: the page always presents config, so it always reads strictly. */
export const DeviceGetSDWAN = async (deviceId: number): Promise<SDWANOverview> => {
  try {
    const res = await baseApi.get(sdwanBase(deviceId));
    return {
      enabled: !!res.data?.enabled,
      load_balance_mode: res.data?.load_balance_mode ?? "",
      zones: res.data?.zones ?? [],
      members: res.data?.members ?? [],
    };
  } catch (err) {
    throw new DeviceRequestError("Could not load SD-WAN", err);
  }
};

export const DeviceListSDWANRules = async (deviceId: number): Promise<SDWANRuleList> => {
  try {
    const res = await baseApi.get(`${sdwanBase(deviceId)}/rules`);
    return {
      rules: res.data?.rules ?? [],
      implicit: res.data?.implicit ?? { name: "sd-wan", criteria: "", mode: "" },
    };
  } catch (err) {
    throw new DeviceRequestError("Could not load SD-WAN rules", err);
  }
};

export const DeviceGetSDWANRule = async (deviceId: number, id: number): Promise<SDWANRule> => {
  const res = await baseApi.get(`${sdwanBase(deviceId)}/rules/${id}`);
  return res.data;
};

export const DeviceCreateSDWANRule = async (
  deviceId: number, form: SDWANRuleForm
): Promise<void> => {
  await baseApi.post(`${sdwanBase(deviceId)}/rules`, form);
};

export const DeviceUpdateSDWANRule = async (
  deviceId: number, id: number, form: SDWANRuleForm
): Promise<void> => {
  await baseApi.put(`${sdwanBase(deviceId)}/rules/${id}`, form);
};

export const DeviceDeleteSDWANRule = async (deviceId: number, id: number): Promise<void> => {
  await baseApi.delete(`${sdwanBase(deviceId)}/rules/${id}`);
};

export const DeviceListSDWANHealthChecks = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<SDWANHealthCheck[]> =>
  deviceList<SDWANHealthCheck>(
    `${sdwanBase(deviceId)}/performance-slas`, "Could not load performance SLAs", opts);

/** Names carry spaces on a stock FortiGate ("Default_Google Search"), so every key is encoded. */
const slaKey = (name: string) => encodeURIComponent(name);

export const DeviceGetSDWANHealthCheck = async (
  deviceId: number, name: string
): Promise<SDWANHealthCheck> => {
  const res = await baseApi.get(`${sdwanBase(deviceId)}/performance-slas/${slaKey(name)}`);
  return res.data;
};

export const DeviceCreateSDWANHealthCheck = async (
  deviceId: number, form: SDWANHealthCheckForm
): Promise<void> => {
  await baseApi.post(`${sdwanBase(deviceId)}/performance-slas`, form);
};

export const DeviceUpdateSDWANHealthCheck = async (
  deviceId: number, name: string, form: SDWANHealthCheckForm
): Promise<void> => {
  await baseApi.put(`${sdwanBase(deviceId)}/performance-slas/${slaKey(name)}`, form);
};

export const DeviceDeleteSDWANHealthCheck = async (
  deviceId: number, name: string
): Promise<void> => {
  await baseApi.delete(`${sdwanBase(deviceId)}/performance-slas/${slaKey(name)}`);
};

export const DeviceCreateSDWANZone = async (deviceId: number, form: SDWANZoneForm): Promise<void> => {
  await baseApi.post(`${sdwanBase(deviceId)}/zones`, form);
};

export const DeviceUpdateSDWANZone = async (
  deviceId: number, name: string, form: SDWANZoneForm
): Promise<void> => {
  await baseApi.put(`${sdwanBase(deviceId)}/zones/${encodeURIComponent(name)}`, form);
};

export const DeviceDeleteSDWANZone = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${sdwanBase(deviceId)}/zones/${encodeURIComponent(name)}`);
};

export const DeviceCreateSDWANMember = async (
  deviceId: number, form: SDWANMemberForm
): Promise<void> => {
  await baseApi.post(`${sdwanBase(deviceId)}/members`, form);
};

export const DeviceUpdateSDWANMember = async (
  deviceId: number, seqNum: number, form: SDWANMemberForm
): Promise<void> => {
  await baseApi.put(`${sdwanBase(deviceId)}/members/${seqNum}`, form);
};

export const DeviceDeleteSDWANMember = async (deviceId: number, seqNum: number): Promise<void> => {
  await baseApi.delete(`${sdwanBase(deviceId)}/members/${seqNum}`);
};

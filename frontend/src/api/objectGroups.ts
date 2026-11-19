import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// Policy & Objects ▸ the four object types the console could reference but not create, plus the
// "what uses this?" scan that sits in front of deleting any of them.
//
// Its own module rather than more of api/policyObject.ts: that file is 2,391 lines and is tracked
// in backend/test/layout-budget.json as needing a split, so a new domain goes in a new file — the
// same rule deviceInfo.ts and inspectionProfiles.ts already follow.
//
// Every list helper takes DeviceReadOpts. Pages that PRESENT what the firewall enforces pass
// `{ strict: true }`, so an unreachable device renders as an error and never as "there is nothing
// configured". Picker call sites keep the lenient default.

// ── Address groups (firewall/addrgrp) ────────────────────────────────────────

export type AddressGroup = {
  name: string;
  type: string;                 // default | folder
  members: string[];
  exclude: boolean;
  exclude_members: string[];
  allow_routing: boolean;
  fabric_object: boolean;
  comment: string;
  color: number;
};

export type AddressGroupPayload = {
  name: string;
  type?: string;
  members: string[];
  exclude?: boolean;
  exclude_members?: string[];
  allow_routing?: boolean;
  fabric_object?: boolean;
  comment?: string;
  color?: number;
};

export const DeviceListAddressGroups = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<AddressGroup[]> =>
  deviceList<AddressGroup>(`${deviceBase(deviceId)}/address-groups`, "Could not load address groups", opts);

/**
 * A write that succeeded, plus anything the device quietly did not do.
 *
 * `warning` is set when FortiOS answered 200 and dropped a field — today that is only
 * allow-routing on a group whose members do not have it (see services/fortigate_group.go, trap 4).
 * The save is real; the screen has to say which part of it is not.
 */
export type WriteResult = { message: string; warning?: string };

export const DeviceCreateAddressGroup = async (
  deviceId: number, payload: AddressGroupPayload
): Promise<WriteResult> => {
  const res = await baseApi.post(`${deviceBase(deviceId)}/address-groups`, payload);
  return res.data as WriteResult;
};

export const DeviceUpdateAddressGroup = async (
  deviceId: number, name: string, payload: AddressGroupPayload
): Promise<WriteResult> => {
  const res = await baseApi.patch(`${deviceBase(deviceId)}/address-groups/${encodeURIComponent(name)}`, payload);
  return res.data as WriteResult;
};

export const DeviceDeleteAddressGroup = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/address-groups/${encodeURIComponent(name)}`);
};

// ── Service groups (firewall.service/group) ──────────────────────────────────

export type ServiceGroup = {
  name: string;
  members: string[];
  proxy: boolean;
  fabric_object: boolean;
  comment: string;
  color: number;
};

export type ServiceGroupPayload = {
  name: string;
  members: string[];
  proxy?: boolean;
  fabric_object?: boolean;
  comment?: string;
  color?: number;
};

export const DeviceListServiceGroups = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<ServiceGroup[]> =>
  deviceList<ServiceGroup>(`${deviceBase(deviceId)}/service-groups`, "Could not load service groups", opts);

export const DeviceCreateServiceGroup = async (deviceId: number, payload: ServiceGroupPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/service-groups`, payload);
};

export const DeviceUpdateServiceGroup = async (
  deviceId: number, name: string, payload: ServiceGroupPayload
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/service-groups/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteServiceGroup = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/service-groups/${encodeURIComponent(name)}`);
};

// ── IP pools (firewall/ippool) ───────────────────────────────────────────────

export type IPPoolType = "overload" | "one-to-one" | "fixed-port-range" | "port-block-allocation";

export type IPPool = {
  name: string;
  type: IPPoolType;
  start_ip: string;
  end_ip: string;
  source_start_ip?: string;
  source_end_ip?: string;
  block_size?: number;
  num_blocks_per_user?: number;
  arp_reply: boolean;
  arp_interface?: string;
  associated_interface?: string;
  permit_any_host: boolean;
  comments: string;
};

export type IPPoolPayload = Omit<IPPool, "arp_reply"> & { arp_reply?: boolean };

export const DeviceListIPPools = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<IPPool[]> =>
  deviceList<IPPool>(`${deviceBase(deviceId)}/ip-pools`, "Could not load IP pools", opts);

export const DeviceCreateIPPool = async (deviceId: number, payload: IPPoolPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/ip-pools`, payload);
};

export const DeviceUpdateIPPool = async (
  deviceId: number, name: string, payload: IPPoolPayload
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/ip-pools/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteIPPool = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/ip-pools/${encodeURIComponent(name)}`);
};

// ── Zones (system/zone) ──────────────────────────────────────────────────────

export type Zone = {
  name: string;
  interfaces: string[];
  intrazone: string;   // allow | deny
  description: string;
};

export type ZonePayload = Zone;

export const DeviceListZones = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<Zone[]> =>
  deviceList<Zone>(`${deviceBase(deviceId)}/zones`, "Could not load zones", opts);

export const DeviceCreateZone = async (deviceId: number, payload: ZonePayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/zones`, payload);
};

export const DeviceUpdateZone = async (deviceId: number, name: string, payload: ZonePayload): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/zones/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteZone = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/zones/${encodeURIComponent(name)}`);
};

// ── "What uses this object?" ─────────────────────────────────────────────────

export type UsageKind =
  | "address" | "addrgrp" | "service" | "servicegrp" | "ippool" | "zone" | "interface" | "schedule";

export type UsageRef = {
  table: string;
  label: string;
  key: string;
  name: string;
  field: string;
  field_label: string;
  route: string;
};

export type UsageReport = {
  kind: string;
  name: string;
  refs: UsageRef[];
  /** FortiOS's own reference count, or -1 when it could not be read. NOT the same as 0. */
  device_count: number;
  found: number;
  /** True only when every table was readable and `found` accounts for `device_count`. */
  complete: boolean;
  unreadable: string[];
  /** complete && found === 0 — the only state in which a delete button may be armed. */
  safe_to_delete: boolean;
};

/**
 * Reads the usage report for one object.
 *
 * Deliberately NOT lenient: there is no safe empty answer here. A caught error returning
 * `{ refs: [] }` would render as "nothing uses this" and arm a delete, which is the one mistake
 * this endpoint exists to prevent. Callers handle the rejection.
 */
export const DeviceObjectUsage = async (
  deviceId: number, kind: UsageKind, name: string
): Promise<UsageReport> => {
  const res = await baseApi.get(
    `${deviceBase(deviceId)}/usage/${kind}/${encodeURIComponent(name)}`
  );
  return res.data as UsageReport;
};

// ── Firewall policy: clone and bulk actions ──────────────────────────────────

export type BulkResult = { policy_id: number; ok: boolean; error?: string };
export type BulkResponse = { message: string; results: BulkResult[]; failed: number };

/** Clones a policy. The copy lands DISABLED, directly below the original. */
export const DeviceClonePolicy = async (
  deviceId: number, policyId: number, name: string
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/firewall-policies/${policyId}/clone`, { name });
};

/**
 * Enables or disables several policies.
 *
 * The response is read even on 207 (partial failure), which is why this returns the body rather
 * than void: the caller has to show which rows did not take.
 */
export const DeviceBulkPolicyStatus = async (
  deviceId: number, policyIds: number[], enable: boolean
): Promise<BulkResponse> => {
  const res = await baseApi.patch(
    `${deviceBase(deviceId)}/firewall-policies/bulk/status?enable=${enable}`,
    { policy_ids: policyIds }
  );
  return res.data as BulkResponse;
};

export const DeviceBulkDeletePolicies = async (
  deviceId: number, policyIds: number[]
): Promise<BulkResponse> => {
  const res = await baseApi.post(
    `${deviceBase(deviceId)}/firewall-policies/bulk/delete`,
    { policy_ids: policyIds }
  );
  return res.data as BulkResponse;
};

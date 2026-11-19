import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// Policy & Objects ▸ Traffic Shaping.
//
// Follows the same rule as every other device read here: a page that PRESENTS what the firewall
// enforces passes `{ strict: true }`, so an unreachable device renders as an error and never as
// "there is nothing configured".

export type TrafficShaper = {
  name: string;
  guaranteed_bandwidth: number;
  maximum_bandwidth: number;
  bandwidth_unit: string;   // kbps | mbps | gbps
  priority: string;         // low | medium | high
  /** OFF means the maximum is SHARED by every policy using this shaper. */
  per_policy: boolean;
  diffserv: boolean;
  diffservcode?: string;
  /** How many shaping policies point at it. -1 means the policy table could not be read. */
  used_by: number;
};

export type ShapingPolicy = {
  id: number;
  name: string;
  status: boolean;
  comment: string;
  srcaddr: string[];
  dstaddr: string[];
  srcintf: string[];
  dstintf: string[];
  service: string[];
  traffic_shaper: string;
  traffic_shaper_reverse: string;
  per_ip_shaper: string;
};

export const DeviceListTrafficShapers = async (
  deviceId: number, opts?: DeviceReadOpts,
): Promise<TrafficShaper[]> =>
  deviceList<TrafficShaper>(`${deviceBase(deviceId)}/traffic-shapers`, "Could not load traffic shapers", opts);

export const DeviceCreateTrafficShaper = async (deviceId: number, payload: TrafficShaper): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/traffic-shapers`, payload);
};

export const DeviceUpdateTrafficShaper = async (
  deviceId: number, name: string, payload: TrafficShaper,
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/traffic-shapers/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteTrafficShaper = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/traffic-shapers/${encodeURIComponent(name)}`);
};

export const DeviceListShapingPolicies = async (
  deviceId: number, opts?: DeviceReadOpts,
): Promise<ShapingPolicy[]> =>
  deviceList<ShapingPolicy>(`${deviceBase(deviceId)}/shaping-policies`, "Could not load shaping policies", opts);

export const DeviceCreateShapingPolicy = async (deviceId: number, payload: ShapingPolicy): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/shaping-policies`, payload);
};

export const DeviceDeleteShapingPolicy = async (deviceId: number, id: number): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/shaping-policies/${id}`);
};

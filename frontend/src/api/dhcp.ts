import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// Network ▸ DHCP Servers. The backend's shape is in services/fortigate_dhcp.go, including the two
// traps this layer inherits: 0.0.0.0 has already been turned into "" on the way out, and the four
// dns-serverN fields have already been collapsed into one list.

/** One address range — both ip_ranges and exclude_ranges have this shape. */
export type DHCPRange = {
  /** Assigned by the device. 0 on a row the operator just added. */
  id: number;
  start_ip: string;
  end_ip: string;
};

/**
 * One MAC binding.
 *
 * `action` is doing more than it looks: `reserved` gives this MAC that address, `assign` gives it
 * one from the pool, and `block` refuses it a lease — so this table is also the MAC deny list.
 */
export type DHCPReservation = {
  id: number;
  mac: string;
  ip: string;
  action: "reserved" | "assign" | "block";
  description: string;
};

export type DHCPServer = {
  id: number;
  status: boolean;
  interface: string;
  ip_ranges: DHCPRange[];
  exclude_ranges: DHCPRange[];
  netmask: string;
  default_gateway: string;
  /** local = the FortiGate itself · default = the system DNS · specify = dns_servers below */
  dns_service: string;
  dns_servers: string[];
  ntp_service: string;
  ntp_servers: string[];
  lease_time: number;
  domain: string;
  reservations: DHCPReservation[];
  /** `ipsec` serves dial-up VPN clients rather than a segment. Read-only here. */
  server_type: string;
  /** `usrgrp` takes addresses from a user group instead of ip_ranges. Read-only here. */
  ip_mode: string;
};

/** What the create/edit form sends. The device assigns the id, so it is not in here. */
export type DHCPServerPayload = {
  enabled: boolean;
  interface: string;
  ip_ranges: Array<{ id?: number; start_ip: string; end_ip: string }>;
  exclude_ranges: Array<{ id?: number; start_ip: string; end_ip: string }>;
  netmask: string;
  default_gateway: string;
  dns_service: string;
  dns_servers: string[];
  ntp_service: string;
  ntp_servers: string[];
  lease_time: number;
  domain: string;
  reservations: Array<{ id?: number; mac: string; ip: string; action: string; description: string }>;
};

export const DeviceListDHCPServers = (
  deviceId: number,
  opts?: DeviceReadOpts,
): Promise<DHCPServer[]> =>
  deviceList<DHCPServer>(`${deviceBase(deviceId)}/dhcp-servers`, "Could not load DHCP servers", opts);

export const DeviceCreateDHCPServer = async (
  deviceId: number,
  payload: DHCPServerPayload,
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/dhcp-servers`, payload);
};

export const DeviceUpdateDHCPServer = async (
  deviceId: number,
  id: number,
  payload: DHCPServerPayload,
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/dhcp-servers/${id}`, payload);
};

export const DeviceDeleteDHCPServer = async (deviceId: number, id: number): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/dhcp-servers/${id}`);
};

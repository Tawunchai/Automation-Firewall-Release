import { baseApi } from "./http";

// Topology ▸ pinned devices — the user's own auxiliary devices drawn on the 3D map.
//
// These are NOT firewalls this console logs in to. They are things one of the firewalls can PING — a
// switch, an access point, a server — identified by an IP. The firewall checks reachability on a
// schedule (set per device) and the result rides back on `last_status`, which the 3D scene colours.
//
// Per user: the list is only ever the signed-in user's own pins, so two operators keep their own
// maps. Every call is owner-scoped on the server.

export const TOPOLOGY_DEVICE_KINDS = [
  "switch", "router", "endpoint", "access-point", "server", "firewall", "other",
] as const;

export type TopologyDeviceKind = (typeof TOPOLOGY_DEVICE_KINDS)[number];

export type TopologyDeviceStatus = "up" | "down" | "unknown";

export type TopologyDevice = {
  id: number;
  owner_user_id: number;
  device_id: number;
  name: string;
  description: string;
  ip_address: string;
  kind: TopologyDeviceKind;
  ping_interval_seconds: number;
  enabled: boolean;
  last_status: TopologyDeviceStatus;
  last_latency_ms?: number;
  last_loss_percent?: number;
  last_checked_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
};

/** The writable shape — what the Add/Edit form sends. */
export type TopologyDeviceInput = {
  name: string;
  description?: string;
  ip_address: string;
  kind: TopologyDeviceKind;
  ping_interval_seconds: number;
  enabled?: boolean;
  device_id?: number;
};

export async function ListTopologyDevices(): Promise<TopologyDevice[]> {
  const res = await baseApi.get<{ data: TopologyDevice[] }>("/topology-devices");
  return res.data?.data ?? [];
}

export async function CreateTopologyDevice(input: TopologyDeviceInput): Promise<TopologyDevice> {
  const res = await baseApi.post<{ data: TopologyDevice }>("/topology-devices", input);
  return res.data.data;
}

export async function UpdateTopologyDevice(
  id: number, input: TopologyDeviceInput,
): Promise<TopologyDevice> {
  const res = await baseApi.patch<{ data: TopologyDevice }>(`/topology-devices/${id}`, input);
  return res.data.data;
}

export async function DeleteTopologyDevice(id: number): Promise<void> {
  await baseApi.delete(`/topology-devices/${id}`);
}

/** Ping one device right now and get the fresh reading, instead of waiting for the next sweep. */
export async function CheckTopologyDevice(id: number): Promise<TopologyDevice> {
  const res = await baseApi.post<{ data: TopologyDevice }>(`/topology-devices/${id}/check`, {});
  return res.data.data;
}

/**
 * Re-ping ALL of my enabled pinned devices right now and get the fresh list. The Topology page fires
 * this on open so the map confirms live up/down instead of trusting a status left over from the last
 * scheduled sweep. `firewallId` scopes it to the firewall currently in view (the one the map draws).
 */
export async function RecheckTopologyDevices(firewallId?: number): Promise<TopologyDevice[]> {
  const res = await baseApi.post<{ data: TopologyDevice[] }>(
    "/topology/recheck", {}, { params: firewallId ? { device_id: firewallId } : undefined },
  );
  return res.data?.data ?? [];
}

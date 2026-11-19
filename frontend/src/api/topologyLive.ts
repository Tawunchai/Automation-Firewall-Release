import { baseApi } from "./http";

// The fast half of Network ▸ Topology — see backend/services/fortigate_topology.go for why this is
// a separate, cheap, pollable call rather than re-reading the five CMDB tables the diagram itself
// is built from.

export type LiveInterface = {
  name: string;
  link: boolean;
  /** Measured bits/second. 0 on the very first poll of a session — see the backend's own note. */
  rx_bps: number;
  tx_bps: number;
};

export type LiveTunnel = {
  name: string;
  health: "up" | "partial" | "down" | "no-phase2";
  phase1_up: boolean;
};

/** One policy's RAW cumulative byte counter — see liveOverlay.ts for why this stays raw (a rate
 *  needs two readings and their gap) and why it can replace the old rx/tx-based INFERENCE with a
 *  real measurement of that specific policy's own traffic. */
export type LivePolicy = {
  policy_id: number;
  bytes: number;
};

export type TopologyLive = {
  interfaces: LiveInterface[];
  tunnels: LiveTunnel[];
  policies: LivePolicy[];
};

export const DeviceGetTopologyLive = async (deviceId: number): Promise<TopologyLive> => {
  const res = await baseApi.get(`/policy/device/${deviceId}/topology-live`);
  return res.data;
};

import type { TopologyLive } from "../../api/topologyLive";
import type { TopoNode, Topology } from "./model";
import type { EdgeActivity } from "./flowAnimation";

/** How often the live overlay (link state + measured throughput) is re-polled. */
export const LIVE_POLL_MS = 3_000;
/** Below this, a port counts as idle rather than "some traffic" — a link doing a few bytes of
 *  keepalive chatter should not look like it is carrying something. */
export const LOW_BPS = 1_000; // 1 kbps
export const HIGH_BPS = 1_000_000; // 1 Mbps

/**
 * Folds the live overlay's per-INTERFACE status onto the diagram's nodes and edges.
 *
 * Interfaces and tunnels get their status dot's `up` overridden by the live read where the live
 * probe actually named them (an interface the live poll has not reported on yet keeps the config
 * read's own `up`, so a page that just loaded does not flash every port to "unknown"). A zone is up
 * when any live-reporting member is.
 *
 * ── Edge "activity": measured when it can be, inferred when it must be ───────────────────────
 *
 * This used to be a pure INFERENCE always — the lesser of the two endpoints' combined rx+tx — for
 * the documented reason that FortiOS has no "this policy's own bits/second" API. That premise was
 * only half true: `monitor/firewall/policy` (backend/services/fortigate_topology.go's own doc
 * comment has the full story) carries each policy's cumulative byte COUNTER, not a rate — but a
 * caller holding two readings and the gap between them can turn a counter into a rate, the exact
 * technique frontend/src/pages/interfaces/throughput.ts already uses for interface counters. So
 * when the caller can supply a PREVIOUS reading and how long ago it was taken, an edge's activity
 * is computed from the sum of its own policies' byte delta — a real measurement of that specific
 * path's own traffic, not a proxy for it. Falls back to the old inference whenever it cannot: the
 * very first poll of a session (no previous reading yet), an edge with no policies attached (an
 * "any/any" badge has none), or a counter that went backwards (a reset, not negative traffic) —
 * never silently claiming a precision this data cannot back up. `measured` tells the caller which
 * edges got the real thing, so the page can say so rather than calling everything "measured".
 */
export function applyLiveOverlay(
  topo: Topology, nodes: TopoNode[], live: TopologyLive | null,
  previous: TopologyLive | null = null, elapsedSeconds = 0,
): { nodes: TopoNode[]; activity: Map<string, EdgeActivity>; measured: Set<string> } {
  const activity = new Map<string, EdgeActivity>();
  const measured = new Set<string>();
  if (!live) return { nodes, activity, measured };

  const ifaceByName = new Map(live.interfaces.map((i) => [i.name.toLowerCase(), i]));
  const tunnelByName = new Map(live.tunnels.map((t) => [t.name.toLowerCase(), t]));

  /** Total bits/second a node accounts for, by folding in every interface it represents. */
  const bpsFor = (n: TopoNode): number => {
    const names = n.kind === "zone" ? (n.members ?? []) : [n.label];
    return names.reduce((sum, name) => {
      const l = ifaceByName.get(name.toLowerCase());
      return l ? sum + l.rx_bps + l.tx_bps : sum;
    }, 0);
  };

  const overlaid = nodes.map((n) => {
    if (n.kind === "interface") {
      const l = ifaceByName.get(n.label.toLowerCase());
      return l ? { ...n, up: l.link } : n;
    }
    if (n.kind === "tunnel") {
      const l = tunnelByName.get(n.label.toLowerCase());
      return l ? { ...n, up: l.health === "up" || l.health === "partial" } : n;
    }
    if (n.kind === "zone" && n.members?.length) {
      const reporting = n.members.map((m) => ifaceByName.get(m.toLowerCase())).filter(Boolean);
      if (reporting.length === 0) return n;
      return { ...n, up: reporting.some((l) => l!.link) };
    }
    return n;
  });

  /** This edge's own policies' combined byte counter, or null if none of them reported one. */
  const policyBytes = (data: TopologyLive, ids: number[]): number | null => {
    if (ids.length === 0 || data.policies.length === 0) return null;
    const byPolicyId = new Map(data.policies.map((p) => [p.policy_id, p.bytes]));
    let sum = 0;
    let any = false;
    ids.forEach((id) => {
      const bytes = byPolicyId.get(id);
      if (bytes != null) { sum += bytes; any = true; }
    });
    return any ? sum : null;
  };

  const tierOf = (bps: number): EdgeActivity => (bps >= HIGH_BPS ? 2 : bps >= LOW_BPS ? 1 : 0);

  const byId = new Map(overlaid.map((p) => [p.id, p]));
  topo.edges.forEach((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;

    if (previous && elapsedSeconds > 0) {
      const curBytes = policyBytes(live, e.policyIds);
      const prevBytes = policyBytes(previous, e.policyIds);
      if (curBytes != null && prevBytes != null && curBytes >= prevBytes) {
        activity.set(e.id, tierOf(((curBytes - prevBytes) * 8) / elapsedSeconds));
        measured.add(e.id);
        return;
      }
    }
    activity.set(e.id, tierOf(Math.min(bpsFor(a), bpsFor(b))));
  });

  return { nodes: overlaid, activity, measured };
}

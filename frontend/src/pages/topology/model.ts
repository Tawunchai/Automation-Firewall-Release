import type { SystemInterface, StaticRoute, FirewallPolicy } from "../../api/policyObject";
import type { IPsecTunnel } from "../../api/vpn";
import type { Zone } from "../../api/objectGroups";

// The firewall's shape, worked out from what the console already reads.
//
// ── Why this is computed and not fetched ─────────────────────────────────────
//
// FortiOS has no topology endpoint. What it has is five tables this console already loads on other
// pages — interfaces, zones, static routes, IPsec tunnels and the policy table — and between them
// they say everything a diagram needs: which ports exist, which are up, which are grouped, where
// each one's traffic goes, and which pairs of them any rule actually permits. So the map is a
// PROJECTION of the config, not a second source of truth that could disagree with the pages it
// was drawn from.
//
// ── What the map is FOR ──────────────────────────────────────────────────────
//
// One question, which the policy table cannot answer by being read top to bottom: *what is
// connected to what, and what is allowed between them.* A rule base of ten rows is legible as a
// list; the same information as "these four segments, these three paths between them, this one
// path with nothing inspecting it" is a different thought, and it is the one people arrive with.
//
// ── The honesty rules, same as everywhere else in this console ───────────────
//
// A section that could not be read is NOT drawn as empty. Each source carries its own
// `unreadable` flag up into the model, and the page says which part of the picture is missing
// rather than showing a firewall with no routes on it.

/** A thing on the map. */
export type NodeKind = "device" | "zone" | "interface" | "tunnel" | "internet";

export type TopoNode = {
  id: string;
  kind: NodeKind;
  label: string;
  /** Second line: the address, the member count, the remote gateway. */
  detail: string;
  /** Interfaces only: administrative status. A port with no link is drawn, not hidden. */
  up?: boolean;
  /** Interface role as FortiOS classifies it: lan | wan | dmz | undefined. */
  role?: string;
  /** The zone this interface belongs to, when it belongs to one. */
  zone?: string;
  /** Where the node's own page is, so a click goes somewhere useful. */
  route: string;
  /** Interfaces only: the hard-switch/aggregate members folded into this node. */
  members?: string[];
};

/** A permitted path between two nodes, as the policy table describes it. */
export type TopoEdge = {
  id: string;
  from: string;
  to: string;
  /** How many enabled policies permit this pair. */
  policies: number;
  /** True when every policy on this pair is a deny. */
  denyOnly: boolean;
  /** True when at least one permitting policy has NAT on. */
  nat: boolean;
  /** True when at least one permitting policy attaches no security profile at all. */
  uninspected: boolean;
  /** Policy ids, so a click can filter the policy table to exactly this path. */
  policyIds: number[];
};

export type Topology = {
  nodes: TopoNode[];
  edges: TopoEdge[];
  /** Which sources could not be read — the page names them instead of drawing an empty firewall. */
  unreadable: string[];
  /** Counts for the caption under the map. */
  stats: {
    interfaces: number;
    interfacesUp: number;
    zones: number;
    tunnels: number;
    tunnelsUp: number;
    paths: number;
    uninspectedPaths: number;
  };
};

/** The interface types that are a container for other ports rather than a port of their own. */
const AGGREGATES = new Set(["hard-switch", "aggregate", "redundant", "switch"]);

/** Tunnel pseudo-interfaces FortiOS keeps for its own features; they are not cables. */
const SYSTEM_TUNNELS = /^(ssl|l2t|naf|vsys)\./;

/** An edge's colour and weight, by what the path means — shared by the SVG and 3D renderers so a
 *  path never reads differently between the two. */
export type EdgeTone = { stroke: string; width: number; dash?: string; crawl?: boolean };

export const edgeTone = (e: TopoEdge): EdgeTone => {
  if (e.denyOnly) return { stroke: "var(--flow-deny)", width: 1.5, dash: "5 4" };
  // Dashed AND crawling: the one path state that should visibly unsettle the eye, because it is
  // the one state that means "nothing is watching this traffic".
  if (e.uninspected) return { stroke: "var(--flow-warn)", width: 2.5, dash: "6 4", crawl: true };
  return { stroke: "var(--flow-allow)", width: 2 };
};

/** True when a policy has any UTM profile attached at all. */
export const hasInspection = (p: FirewallPolicy): boolean =>
  Boolean(p.av_profile || p.webfilter_profile || p.dnsfilter_profile || p.app_control
    || p.ips_sensor || p.file_filter_profile
    // certificate-inspection is the do-nothing default; it is not inspection.
    || (p.ssl_ssh_profile && p.ssl_ssh_profile !== "certificate-inspection"));

/** The node id an interface name maps to. Zones absorb their members. */
const nodeIdFor = (name: string, zoneOf: Map<string, string>): string => {
  const zone = zoneOf.get(name.toLowerCase());
  return zone ? `zone:${zone}` : `if:${name}`;
};

export type TopologyInput = {
  interfaces: SystemInterface[];
  zones: Zone[];
  routes: StaticRoute[];
  tunnels: IPsecTunnel[];
  policies: FirewallPolicy[];
  deviceName: string;
  /** Section labels that failed to load. */
  unreadable: string[];
};

/**
 * Builds the map.
 *
 * Order matters in one place: zones are resolved BEFORE interfaces, because an interface inside a
 * zone is not drawn as its own node — the zone is what a policy names, so the zone is what the map
 * has to show. Drawing both would put two nodes on the diagram for one thing a rule can reference,
 * and the edges would attach to whichever one the policy happened to spell.
 */
export const buildTopology = (input: TopologyInput): Topology => {
  const { interfaces, zones, routes, tunnels, policies, deviceName } = input;

  // interface name → zone name
  const zoneOf = new Map<string, string>();
  zones.forEach((z) => z.interfaces.forEach((i) => zoneOf.set(i.toLowerCase(), z.name)));

  // Members of a hard-switch / aggregate are folded into their container: they carry no address
  // and no policy can name them, so eleven identical empty ports would be eleven nodes saying
  // nothing. The container keeps the list and the page shows it as a count.
  const foldedInto = new Map<string, string>();
  interfaces.forEach((i) => {
    if (AGGREGATES.has(i.type)) {
      (i.members ?? []).forEach((m) => foldedInto.set(m.toLowerCase(), i.name));
    }
  });

  const nodes: TopoNode[] = [{
    id: "device",
    kind: "device",
    label: deviceName || "FortiGate",
    detail: `${interfaces.length} interfaces`,
    route: "/admin/dashboard",
  }];

  // One node per zone.
  zones.forEach((z) => {
    nodes.push({
      id: `zone:${z.name}`,
      kind: "zone",
      label: z.name,
      detail: `${z.interfaces.length} interface${z.interfaces.length === 1 ? "" : "s"}`
        + (z.intrazone === "allow" ? " · intra-zone allowed" : ""),
      route: "/admin/zones",
      members: z.interfaces,
      // A zone is up when any member is.
      up: z.interfaces.some((m) =>
        interfaces.find((i) => i.name.toLowerCase() === m.toLowerCase())?.status === "up"),
    });
  });

  // One node per interface that is neither zoned nor folded into a container.
  //
  // `up` counts the same set the caption's denominator does — the REAL interfaces. Counting it
  // over the unfiltered list made the tile read "21 up / 19 interfaces" on the lab device, because
  // FortiOS's three pseudo-tunnels (ssl.root, l2t.root, naf.root) are always up and are excluded
  // from the total. A ratio whose halves are drawn from different sets is worse than no ratio.
  let up = 0;
  interfaces.forEach((i) => {
    const key = i.name.toLowerCase();
    if (SYSTEM_TUNNELS.test(i.name)) return;
    if (i.status === "up") up += 1;
    if (zoneOf.has(key)) return;
    if (foldedInto.has(key)) return;

    const members = AGGREGATES.has(i.type) ? (i.members ?? []) : undefined;
    nodes.push({
      id: `if:${i.name}`,
      kind: "interface",
      label: i.name,
      detail: [
        i.ip || "no address",
        i.alias || "",
        members?.length ? `${members.length} ports` : "",
      ].filter(Boolean).join(" · "),
      up: i.status === "up",
      role: i.role,
      route: "/admin/fw-interfaces",
      members,
    });
  });

  // One node per IPsec tunnel, attached to the interface it binds to.
  let tunnelsUp = 0;
  tunnels.forEach((t) => {
    if (t.up) tunnelsUp += 1;
    const remote = t.remote_gw && t.remote_gw !== "0.0.0.0" ? t.remote_gw : "dial-up";
    nodes.push({
      id: `vpn:${t.name}`,
      kind: "tunnel",
      label: t.name,
      detail: `${remote} · IKEv${t.ike_version} · ${t.phase2.length} phase 2`,
      up: t.up,
      route: "/admin/ipsec-tunnels",
    });
  });

  // The internet, when a default route says there is one. Drawn only if something points at it:
  // inventing an internet cloud on a firewall with no default route would be drawing a guess.
  const defaultRoutes = routes.filter((r) => r.enabled && (r.dst === "0.0.0.0/0" || r.dst === "0.0.0.0 0.0.0.0"));
  if (defaultRoutes.length > 0) {
    nodes.push({
      id: "internet",
      kind: "internet",
      label: "Internet",
      detail: defaultRoutes
        .map((r) => `via ${r.device_alias || r.device}${r.gateway ? ` → ${r.gateway}` : ""}`)
        .join(" · "),
      route: "/admin/static-routes",
    });
  }

  // ── Edges: what the policy table permits between which pair ────────────────
  //
  // Keyed on the NODE pair, not the interface pair, so a zone's rules aggregate onto the zone. A
  // policy naming several interfaces on either side contributes one edge per combination, which is
  // what it actually permits.
  const byPair = new Map<string, TopoEdge>();
  const known = new Set(nodes.map((n) => n.id));

  policies.forEach((p) => {
    if (!p.enabled) return; // a disabled rule permits nothing; it belongs in the table, not here
    const srcs = p.src_intf_list?.length ? p.src_intf_list : [p.src_intf];
    const dsts = p.dst_intf_list?.length ? p.dst_intf_list : [p.dst_intf];

    srcs.forEach((s) => dsts.forEach((d) => {
      const from = nodeIdFor(s, zoneOf);
      const to = nodeIdFor(d, zoneOf);
      // "any" is not a node — a rule on any/any is drawn as a badge on the device, not as a cable
      // to a place that does not exist.
      if (!known.has(from) || !known.has(to) || from === to) return;

      const id = `${from}->${to}`;
      const existing = byPair.get(id);
      const permits = p.action === "accept";
      if (existing) {
        existing.policies += 1;
        existing.policyIds.push(p.id);
        existing.denyOnly = existing.denyOnly && !permits;
        existing.nat = existing.nat || (permits && p.nat);
        existing.uninspected = existing.uninspected || (permits && !hasInspection(p));
        return;
      }
      byPair.set(id, {
        id, from, to,
        policies: 1,
        denyOnly: !permits,
        nat: permits && p.nat,
        uninspected: permits && !hasInspection(p),
        policyIds: [p.id],
      });
    }));
  });

  const edges = [...byPair.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    nodes,
    edges,
    unreadable: input.unreadable,
    stats: {
      interfaces: interfaces.filter((i) => !SYSTEM_TUNNELS.test(i.name)).length,
      interfacesUp: up,
      zones: zones.length,
      tunnels: tunnels.length,
      tunnelsUp,
      paths: edges.length,
      uninspectedPaths: edges.filter((e) => e.uninspected && !e.denyOnly).length,
    },
  };
};

import type { SystemInterface, StaticRoute } from "../../../api/policyObject";
import type { Topology, TopoNode } from "../model";
import { faceplateSlots } from "../../../components/ui/faceplateSlots";
import { linkState } from "../../../components/ui/interfaceStatus";

// Turns the config projection (model.ts) into what the stage actually draws: a chassis with real
// jacks, three lanes of tiles around it, and an honest account of everything it chose not to draw.
//
// ── Why anything is left out at all ──────────────────────────────────────────
// The old ring drew a node for every interface, so a lab 80E became thirty identical grey boxes
// of which twenty-odd were empty ports nobody had plugged anything into. The information was all
// there and none of it was legible. Here an interface earns a TILE only by being configured —
// an address, a policy, a zone, or members — and everything else stays as what it physically is:
// a dark socket on the faceplate, counted in a caption. Nothing is hidden; unconfigured things
// are just drawn at the size of their importance.

export type SocketState = "up" | "down" | "admin-down" | "unknown";

export type Socket = {
  /** Interface name — `port3`, `wan1`. */
  name: string;
  /** What the silk-screen prints under the jack. */
  label: string;
  row: 0 | 1;
  /** Column within the whole faceplate, fixed block first. */
  col: number;
  block: "fixed" | "numbered";
  state: SocketState;
  /** The tile whose cable lands here, when one does. */
  nodeId?: string;
  /** The container that owns this jack, when it is a switch/aggregate member. */
  owner?: string;
  /** No address, no rule, no zone, no container — a jack with nothing plugged into it. */
  unused: boolean;
};

export type Lane = "outside" | "inside" | "vpn";

export type StageNode = TopoNode & {
  lane: Lane;
  /** Jacks this tile owns: its own, or every member jack for a switch. */
  sockets: string[];
  /** Interfaces with no jack of their own (switch, aggregate, tunnel) connect to the chassis body. */
  logical: boolean;
};

export type StageModel = {
  nodes: StageNode[];
  sockets: Socket[];
  captions: { fixed: string; numbered: string };
  /** Named, not hidden: what was left off the stage and why. */
  fold: {
    /** Jacks drawn dark, with no tile. */
    unused: string[];
    /** Interfaces with neither a jack nor a tile — fortilink, ssl.root, npu vlinks. */
    system: string[];
  };
  /** True when NOT ONE jack reported a link state, which means the read failed (see linkState). */
  linkUnreadable: boolean;
  ports: { jacks: number; up: number; down: number; unknown: number; unused: number };
  wan: { via: string[]; gateway: string; up: number; total: number };
};

/** Containers: they hold other ports rather than being one. Mirrors model.ts's AGGREGATES. */
const CONTAINERS = new Set(["hard-switch", "aggregate", "redundant", "switch"]);

/**
 * Which lane a tile belongs in.
 *
 * The default route decides "outside", not the role field: on the lab 80E the port carrying the
 * default route is `port1`, which FortiOS reports with `role: "lan"` and the alias "External".
 * Trusting the role there would have drawn the live internet uplink in the Inside lane.
 */
const laneFor = (n: TopoNode, wanNames: Set<string>): Lane => {
  if (n.kind === "internet") return "outside";
  if (n.kind === "tunnel") return "vpn";
  if (n.kind === "interface" && wanNames.has(n.label)) return "outside";
  return "inside";
};

export type StageInput = {
  topo: Topology;
  interfaces: SystemInterface[];
  routes: StaticRoute[];
};

export const buildStage = ({ topo, interfaces, routes }: StageInput): StageModel => {
  const byName = new Map(interfaces.map((i) => [i.name, i]));
  const slots = faceplateSlots(interfaces);

  // Interfaces the policy table actually references, so an addressless port that a rule names is
  // still "in use". Edges are keyed on node ids, which are already zone-resolved.
  const edged = new Set<string>();
  topo.edges.forEach((e) => { edged.add(e.from); edged.add(e.to); });

  // ── The default route is the truth about which port faces the internet ─────
  const defaults = routes.filter((r) => r.enabled && (r.dst === "0.0.0.0/0" || r.dst === "0.0.0.0 0.0.0.0"));
  const via = defaults.map((r) => r.device).filter(Boolean);
  const wanNames = new Set<string>(via);
  interfaces.forEach((i) => { if (i.role === "wan") wanNames.add(i.name); });

  // ── Tiles ─────────────────────────────────────────────────────────────────
  // A node earns a tile by being configured. `device` is the chassis itself, never a tile.
  const ownerOf = new Map<string, string>(); // member name → container name
  interfaces.forEach((i) => {
    if (CONTAINERS.has(i.type)) (i.members ?? []).forEach((m) => ownerOf.set(m, i.name));
  });

  const configured = (n: TopoNode): boolean => {
    if (n.kind !== "interface") return true;
    const i = byName.get(n.label);
    if (!i) return true;
    return Boolean(i.ip) || edged.has(n.id) || Boolean(n.zone) || (n.members?.length ?? 0) > 0;
  };

  const nodes: StageNode[] = [];
  const system: string[] = [];

  topo.nodes.forEach((n) => {
    if (n.id === "device") return;
    const iface = n.kind === "interface" ? byName.get(n.label) : undefined;
    if (!configured(n)) {
      // No tile. It keeps its jack if it has one; otherwise it is invisible and counted instead.
      if (!slots.drawnNames.has(n.label)) system.push(n.label);
      return;
    }
    const own = iface && slots.drawnNames.has(iface.name) ? [iface.name] : [];
    const members = iface && CONTAINERS.has(iface.type)
      ? (iface.members ?? []).filter((m) => slots.drawnNames.has(m))
      : [];
    nodes.push({
      ...n,
      lane: laneFor(n, wanNames),
      sockets: own.length ? own : members,
      logical: own.length === 0,
    });
  });

  // ── Jacks ─────────────────────────────────────────────────────────────────
  const claimed = new Map<string, string>(); // jack name → node id
  nodes.forEach((n) => n.sockets.forEach((s) => claimed.set(s, n.id)));

  const cells = [
    ...slots.topCells.map((c, idx) => ({ ...c, row: 0 as const, col: idx, block: "fixed" as const })),
    ...slots.bottomCells.map((c, idx) => ({ ...c, row: 1 as const, col: idx, block: "fixed" as const })),
    ...slots.odds.map((n, idx) => ({
      name: `port${n}`, label: String(n), row: 0 as const,
      col: slots.topCells.length + idx, block: "numbered" as const,
    })),
    ...slots.evens.map((n, idx) => ({
      name: `port${n}`, label: String(n), row: 1 as const,
      col: slots.bottomCells.length + idx, block: "numbered" as const,
    })),
  ];

  const sockets: Socket[] = [];
  cells.forEach((c) => {
    const iface = byName.get(c.name);
    if (!iface) return; // a cell this model does not fit — the row keeps its gap, the stage does not
    const owner = ownerOf.get(c.name);
    const nodeId = claimed.get(c.name);
    sockets.push({
      name: c.name,
      label: c.label,
      row: c.row,
      col: c.col,
      block: c.block,
      state: linkState(iface),
      nodeId,
      owner,
      unused: !nodeId && !owner,
    });
  });

  // Every jack reporting null means the link read failed, not that nothing is plugged in — the
  // backend turns a failed `monitor/system/interface` into an empty map with no error.
  const linkUnreadable = sockets.length > 0 && sockets.every((s) => s.state === "unknown");

  const count = (f: (s: Socket) => boolean) => sockets.filter(f).length;

  // A WAN-role port with no address and no route through it is a label on the chassis, not an
  // uplink. Counting it made the lab device read "1/3 up" when it has exactly two uplinks
  // configured and one of them is live — a denominator nobody could reconcile with the config.
  const wanIfaces = ([...wanNames].map((n) => byName.get(n)).filter(Boolean) as SystemInterface[])
    .filter((i) => Boolean(i.ip) || via.includes(i.name));

  return {
    nodes,
    sockets,
    captions: { fixed: slots.fixedCaption, numbered: slots.odds.length + slots.evens.length ? "Internal" : "" },
    fold: { unused: sockets.filter((s) => s.unused).map((s) => s.name), system },
    linkUnreadable,
    ports: {
      jacks: sockets.length,
      up: count((s) => s.state === "up"),
      down: count((s) => s.state === "down" || s.state === "admin-down"),
      unknown: count((s) => s.state === "unknown"),
      unused: count((s) => s.unused),
    },
    wan: {
      via,
      gateway: defaults.map((r) => r.gateway).filter(Boolean).join(" · "),
      up: wanIfaces.filter((i) => linkState(i) === "up").length,
      total: wanIfaces.length,
    },
  };
};

import type { StageModel, Socket, StageNode, Lane } from "./stageModel";
import type {
  Vec3,
  PlacedNode,
  PlacedSocket,
  NodeGroup,
  GroupSide,
  StageLayout,
  EgressRail,
  FirewallEgress,
} from "./contracts";

// Where everything stands on the stage. Pure arithmetic, so the one part of the scene that decides
// whether the picture is legible can be tested without a WebGL context.
//
// ── From lanes to grouped platforms ──────────────────────────────────────────
// The first redesign laid a firewall out as a sentence — Outside, the box, Inside, VPN raised
// behind — so a cable only had to travel from its lane to its own socket instead of through a hub.
// This pass keeps that reading but stops drawing forty individual tiles strung down a column:
// nodes are GROUPED onto a handful of labelled platforms (so forty ports read as ~five groups),
// and the firewall exposes short edge-egress RAILS that bundled trunks physically plug into.
//
// The faceplate socket + cable (trunk) arithmetic is UNCHANGED — the jacks and their looms are the
// honest hardware layer and are still placed one-per-port on the chassis top surface.

// Re-export the shared contract shapes so existing `from "./layout3d"` importers keep resolving.
export type { Vec3, PlacedNode, PlacedSocket, StageLayout } from "./contracts";

// ── Faceplate (unchanged) ─────────────────────────────────────────────────────
/** Socket pitch across the faceplate, and the gap between the fixed block and the numbered one. */
const SOCKET_PITCH = 0.3;
const BLOCK_GAP = 0.26;
/** Half-depth between the faceplate's two rows. */
const ROW_Z = 0.21;
/** Top surface of the chassis — sockets are recessed into it, not hidden on a vertical face. */
export const CHASSIS_H = 0.34;
export const CHASSIS_D = 1.18;

// ── Group placement ────────────────────────────────────────────────────────────
/** Spacing between a group's columns (major axis, grows AWAY from the firewall). */
const GRID_MAJOR = 2.4;
/** Spacing between members within a column (minor axis, bounded & centred). */
const GRID_MINOR = 1.5;
/** A column holds at most this many members before a new column starts. */
const GRID_MINOR_MAX = 4;
/** Members shown before the rest fold into one "+N more" tile. */
const MEMBERS_CAP = 23;
/** A single member cell's footprint, used only to size the platform slab. */
const CELL_W = 1.3;
const CELL_D = 0.6;
/** Padding from the outermost cell to the slab edge (labels overhang). */
const GROUP_PAD = 0.7;
/** Gap between two role-groups stacked in the same lane. */
const GROUP_GAP = 1.1;
/** How far a group's near edge sits beyond the chassis face. */
const GROUP_CLEAR = 1.9;
/** Height a trunk/ping line attaches at, on the near edge facing the firewall. */
const ANCHOR_Y = 0.3;
/** The VPN shelf is raised, so its members and region float above the floor. */
const VPN_Y = 1.05;

/** The internet floats beyond the Outside lane and off the floor: it is not part of the device. */
const INTERNET_Y = 0.72;
/** Clearance from the far edge of the Outside group out to the internet node. */
const INTERNET_GAP = 1.6;

/** Roles a lane may be subdivided along. Anything else is "other". */
const ROLES = new Set(["lan", "wan", "dmz"]);

// ── Faceplate helpers (unchanged math) ────────────────────────────────────────
/** Columns run across the whole faceplate; the two blocks are pushed apart by one gap. */
const socketX = (s: Socket, cols: number): number =>
  (s.col - (cols - 1) / 2) * SOCKET_PITCH + (s.block === "numbered" ? BLOCK_GAP / 2 : -BLOCK_GAP / 2);

// ── Firewall edge-egress ───────────────────────────────────────────────────────
/**
 * The three short "patch rails" trunks physically plug into — one per lane side of the chassis.
 * Routing spreads a side's trunks ALONG its rail so they never stack on one point.
 */
export const firewallEgress = (chassis: { width: number; height: number; depth: number }): FirewallEgress => {
  const { width, depth } = chassis;
  const outside: EgressRail = {
    side: "outside",
    center: { x: -width / 2 - 0.05, y: 0.42, z: 0 },
    out: { x: -1, y: 0, z: 0 },
    along: { x: 0, y: 0, z: 1 },
    halfSpan: 0.6,
    railY: 0.42,
  };
  const inside: EgressRail = {
    side: "inside",
    center: { x: width / 2 + 0.05, y: 0.42, z: 0 },
    out: { x: 1, y: 0, z: 0 },
    along: { x: 0, y: 0, z: 1 },
    halfSpan: 0.6,
    railY: 0.42,
  };
  const vpn: EgressRail = {
    side: "vpn",
    center: { x: 0, y: 1.05, z: -depth / 2 - 0.05 },
    out: { x: 0, y: 0, z: -1 },
    along: { x: 1, y: 0, z: 0 },
    halfSpan: Math.max(0.6, width * 0.35),
    railY: 1.05,
  };
  return { rails: { outside, inside, vpn } };
};

// ── Per-side local frame ───────────────────────────────────────────────────────
// Each lane has a major axis (grows away from the firewall) and a minor axis (bounded, centred).
type Frame = { major: Vec3; minor: Vec3; firewallHalf: number };

const frameFor = (lane: Lane, width: number, depth: number): Frame => {
  switch (lane) {
    case "inside":
      return { major: { x: 1, y: 0, z: 0 }, minor: { x: 0, y: 0, z: 1 }, firewallHalf: width / 2 };
    case "outside":
      return { major: { x: -1, y: 0, z: 0 }, minor: { x: 0, y: 0, z: 1 }, firewallHalf: width / 2 };
    case "vpn":
      return { major: { x: 0, y: 0, z: -1 }, minor: { x: 1, y: 0, z: 0 }, firewallHalf: depth / 2 };
  }
};

/** The grid a group folds into: how many columns/rows, what it spans, and the overflow. */
type Grid = {
  total: number;
  shown: StageNode[];
  overflow: number;
  cells: number;
  minor: number;
  major: number;
  majorExtent: number;
  minorExtent: number;
};

const gridOf = (members: StageNode[]): Grid => {
  const total = members.length;
  const shown = members.slice(0, MEMBERS_CAP);
  const overflow = total - shown.length;
  // The overflow "+N more" tile occupies one trailing cell (StageScene draws it from `overflow`).
  const cells = shown.length + (overflow > 0 ? 1 : 0);
  const minor = Math.min(GRID_MINOR_MAX, Math.max(1, cells));
  const major = Math.ceil(cells / minor);
  const majorExtent = (major - 1) * GRID_MAJOR + CELL_W;
  const minorExtent = (minor - 1) * GRID_MINOR + CELL_D;
  return { total, shown, overflow, cells, minor, major, majorExtent, minorExtent };
};

type SubSpec = { id: string; label: string; members: StageNode[] };

const laneLabel = (lane: Lane): string =>
  lane === "vpn" ? "VPN" : lane[0].toUpperCase() + lane.slice(1);

/**
 * Lay one group onto its side. Pure: plain arithmetic on `{x,y,z}`, no three/WebGL.
 * `minorOffset` stacks role-groups that share a lane along the minor axis.
 */
const placeGroup = (
  spec: SubSpec,
  grid: Grid,
  frame: Frame,
  minorOffset: number,
  baseY: number,
  side: GroupSide,
): NodeGroup => {
  const nearEdge = frame.firewallHalf + GROUP_CLEAR;

  const members: PlacedNode[] = grid.shown.map((n, i) => {
    const col = Math.floor(i / grid.minor);
    const row = i % grid.minor;
    const rowsHere = Math.min(grid.minor, grid.cells - col * grid.minor);
    const along = nearEdge + col * GRID_MAJOR;
    const across = (row - (rowsHere - 1) / 2) * GRID_MINOR + minorOffset;
    return {
      ...n,
      groupId: spec.id,
      pos: {
        x: frame.major.x * along + frame.minor.x * across,
        y: baseY,
        z: frame.major.z * along + frame.minor.z * across,
      },
    };
  });

  // Project the cell span onto X/Z, then pad for the overhanging labels.
  const widthExtent = grid.majorExtent * Math.abs(frame.major.x) + grid.minorExtent * Math.abs(frame.minor.x);
  const depthExtent = grid.majorExtent * Math.abs(frame.major.z) + grid.minorExtent * Math.abs(frame.minor.z);
  const centerAlong = nearEdge + grid.majorExtent / 2;
  const region = {
    center: {
      x: frame.major.x * centerAlong + frame.minor.x * minorOffset,
      y: baseY,
      z: frame.major.z * centerAlong + frame.minor.z * minorOffset,
    },
    width: widthExtent + 2 * GROUP_PAD,
    depth: depthExtent + 2 * GROUP_PAD,
  };

  // The near-edge midpoint facing the firewall — where a trunk (or ping line) attaches.
  const anchorAlong = nearEdge - 0.15;
  const anchor: Vec3 = {
    x: frame.major.x * anchorAlong + frame.minor.x * minorOffset,
    y: ANCHOR_Y,
    z: frame.major.z * anchorAlong + frame.minor.z * minorOffset,
  };

  return {
    id: spec.id,
    label: spec.label,
    side,
    anchor,
    region,
    members,
    overflow: grid.overflow,
    total: grid.total,
    plinth: true,
  };
};

export const layoutStage = (model: StageModel): StageLayout => {
  // ── Faceplate: sockets + chassis dims (UNCHANGED) ───────────────────────────
  const cols = Math.max(...model.sockets.map((s) => s.col + 1), 1);
  const width = cols * SOCKET_PITCH + BLOCK_GAP + 0.34;

  const sockets: PlacedSocket[] = model.sockets.map((s) => ({
    ...s,
    pos: { x: socketX(s, cols), y: CHASSIS_H, z: s.row === 0 ? -ROW_Z : ROW_Z },
  }));

  const chassis = { width, depth: CHASSIS_D, height: CHASSIS_H };
  const firewall = { pos: { x: 0, y: 0, z: 0 }, width, depth: CHASSIS_D, height: CHASSIS_H };
  const egress = firewallEgress({ width, height: CHASSIS_H, depth: CHASSIS_D });

  // ── Groups ──────────────────────────────────────────────────────────────────
  // Group config nodes by lane; the Internet pseudo-node is placed on its own, not grouped.
  const configNodes = model.nodes.filter((n) => n.kind !== "internet");
  const lanes: Lane[] = ["outside", "inside", "vpn"];
  const groups: NodeGroup[] = [];
  const placed: PlacedNode[] = [];

  for (const lane of lanes) {
    const laneNodes = configNodes.filter((n) => n.lane === lane);
    if (laneNodes.length === 0) continue;

    // Subdivide a lane into role platforms only once it is both crowded AND genuinely mixed.
    const recognized = new Set(
      laneNodes.map((n) => n.role).filter((r): r is string => !!r && ROLES.has(r)),
    );
    const subdivide = laneNodes.length >= 8 && recognized.size >= 2;

    let specs: SubSpec[];
    if (subdivide) {
      const byRole = new Map<string, StageNode[]>();
      for (const n of laneNodes) {
        const key = n.role && n.role.length ? n.role : "other";
        const bucket = byRole.get(key);
        if (bucket) bucket.push(n);
        else byRole.set(key, [n]);
      }
      specs = [...byRole.entries()].map(([role, members]) => ({
        id: `grp:${lane}:${role}`,
        label: role.toUpperCase(),
        members,
      }));
    } else {
      specs = [{ id: `grp:${lane}`, label: laneLabel(lane), members: laneNodes }];
    }

    const frame = frameFor(lane, width, CHASSIS_D);
    const baseY = lane === "vpn" ? VPN_Y : 0;
    const grids = specs.map((s) => gridOf(s.members));

    // Stack role-groups along the minor axis, symmetric about 0.
    const totalSpan =
      grids.reduce((a, g) => a + g.minorExtent, 0) + (grids.length - 1) * GROUP_GAP;
    let cursor = -totalSpan / 2;
    const offsets = grids.map((g) => {
      const off = cursor + g.minorExtent / 2;
      cursor += g.minorExtent + GROUP_GAP;
      return off;
    });

    specs.forEach((spec, idx) => {
      const group = placeGroup(spec, grids[idx], frame, offsets[idx], baseY, lane);
      groups.push(group);
      placed.push(...group.members);
    });
  }

  // ── Internet ────────────────────────────────────────────────────────────────
  // Beyond the Outside lane, off the floor, its own node — never part of a group.
  let internet: PlacedNode | undefined;
  const inet = model.nodes.find((n) => n.kind === "internet");
  if (inet) {
    const outsideGroups = groups.filter((g) => g.side === "outside");
    const nearEdge = width / 2 + GROUP_CLEAR;
    const reach = outsideGroups.length
      ? Math.max(...outsideGroups.map((g) => nearEdge + (g.region.width - 2 * GROUP_PAD)))
      : width / 2;
    internet = { ...inet, groupId: "", pos: { x: -(reach + INTERNET_GAP), y: INTERNET_Y, z: 0 } };
  }

  // ── Cables (UNCHANGED) ────────────────────────────────────────────────────────
  // One per tile-to-socket pair. A switch with eleven members draws eleven thin cables into its
  // own eleven jacks, which is what is physically true and reads as a loom.
  const posOf = new Map(sockets.map((s) => [s.name, s.pos]));
  const trunks: StageLayout["trunks"] = [];
  placed.forEach((n) => {
    n.sockets.forEach((name) => {
      const to = posOf.get(name);
      if (!to) return;
      trunks.push({
        id: `${n.id}->${name}`,
        nodeId: n.id,
        socket: name,
        from: n.pos,
        to,
        state: sockets.find((s) => s.name === name)!.state,
      });
    });
  });

  // ── Bounds ────────────────────────────────────────────────────────────────────
  // Union of every group's region (grown by PAD, since labels overhang), the firewall box, and
  // the internet node.
  const PAD = 1.55;
  const xsMin: number[] = [-width / 2];
  const xsMax: number[] = [width / 2];
  const zsMin: number[] = [-CHASSIS_D];
  const zsMax: number[] = [CHASSIS_D];
  groups.forEach((g) => {
    xsMin.push(g.region.center.x - g.region.width / 2);
    xsMax.push(g.region.center.x + g.region.width / 2);
    zsMin.push(g.region.center.z - g.region.depth / 2);
    zsMax.push(g.region.center.z + g.region.depth / 2);
  });
  if (internet) {
    xsMin.push(internet.pos.x);
    xsMax.push(internet.pos.x);
    zsMin.push(internet.pos.z);
    zsMax.push(internet.pos.z);
  }
  const minX = Math.min(...xsMin) - PAD;
  const maxX = Math.max(...xsMax) + PAD;
  const minZ = Math.min(...zsMin) - PAD;
  const maxZ = Math.max(...zsMax) + PAD;

  return {
    firewall,
    chassis,
    egress,
    groups,
    nodes: placed,
    internet,
    sockets,
    trunks,
    bounds: {
      center: { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
      width: maxX - minX,
      depth: maxZ - minZ,
    },
  };
};

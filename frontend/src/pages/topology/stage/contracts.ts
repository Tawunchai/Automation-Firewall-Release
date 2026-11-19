import type * as THREE from "three";
import type { StageNode, Socket } from "./stageModel";
import type { EdgeActivity } from "../flowAnimation";

// The shared contract for the redesigned 3D topology stage.
//
// The stage is built by three cooperating pieces that must agree on these shapes and nothing else:
//   • layout3d.ts  — places the firewall, groups the nodes, and exposes the firewall's edge-egress
//                     rails. Produces `StageLayout`.
//   • routing.ts   — turns the config edges into tidy, bundled, low orthogonal TRUNKS between the
//                     firewall and each group (with per-edge splay on hover). Produces `RoutedScene`.
//   • StageScene.tsx — renders all of it (the appliance, the group platforms, the trunks, the tiles).
//
// Keeping the types here (rather than in whichever file happens to implement one) means the three can
// be worked on independently and still fit together — the whole point of the redesign, which replaced
// a tangle of per-edge arcs bowing over the box with a hub-and-spoke of labelled trunks.

export type Vec3 = { x: number; y: number; z: number };

export type PlacedSocket = Socket & { pos: Vec3 };
/** A node placed on the stage. `groupId` says which platform it stands on. */
export type PlacedNode = StageNode & { pos: Vec3; groupId: string };

// ── Firewall edge-egress ───────────────────────────────────────────────────────
// A short "patch rail" per side of the chassis that trunks physically connect to. Routing spreads a
// side's trunks ALONG its rail so they never stack on one point; the firewall model renders a small
// connector nub at each connection point so lines read as plugging into hardware.

export type EgressSide = "outside" | "inside" | "vpn";

export type EgressRail = {
  side: EgressSide;
  /** Centre of the rail segment on the chassis face for this side (world space). */
  center: Vec3;
  /** Unit vector pointing AWAY from the chassis into this side's lane (e.g. outside = (-1,0,0)). */
  out: Vec3;
  /** Unit vector ALONG the rail; trunks are distributed on this axis. */
  along: Vec3;
  /** Half the usable rail length — trunks sit within ±halfSpan on `along`. */
  halfSpan: number;
  /** Constant height the horizontal trunks run at before dropping to a group (the "bus" height). */
  railY: number;
};

export type FirewallEgress = { rails: Record<EgressSide, EgressRail> };

// ── Groups ─────────────────────────────────────────────────────────────────────
// Devices are organised into a handful of labelled platforms so forty nodes read as ~five groups.
// `pinned` is the user's own ping-watched devices (front shelf); the other three mirror the lanes.

export type GroupSide = "outside" | "inside" | "vpn" | "pinned";

export type NodeGroup = {
  /** Stable id: "grp:outside", "grp:inside:dmz", "grp:pinned". */
  id: string;
  /** Header text: "Outside", "DMZ", "My Devices". */
  label: string;
  side: GroupSide;
  /** Where a firewall→group trunk (or a ping line) attaches — near the group, facing the firewall. */
  anchor: Vec3;
  /** Floor footprint — drives the platform slab, the header sprite, and the scene bounds. */
  region: { center: Vec3; width: number; depth: number };
  /** Placed members (each with `.pos`). Capped; the rest fold into `overflow`. */
  members: PlacedNode[];
  /** How many members are hidden behind the "+N more" tile (0 when none). */
  overflow: number;
  /** total === members-shown + overflow; the header shows this. */
  total: number;
  /** false only for the Internet pseudo-group (floats, no slab). */
  plinth: boolean;
};

export type StageLayout = {
  /** The premium central appliance, at the origin. */
  firewall: { pos: Vec3; width: number; depth: number; height: number };
  /** Back-compat alias == firewall dims (older code reads `layout.chassis`). */
  chassis: { width: number; depth: number; height: number };
  /** Where trunks leave the firewall — consumed by routing, rendered as nubs. */
  egress: FirewallEgress;
  groups: NodeGroup[];
  /** Flat union of every group's members, so edge/tile code can look a node up by id. */
  nodes: PlacedNode[];
  /** Internet stays its own off-stage, off-floor node — not in any group. */
  internet?: PlacedNode;
  sockets: PlacedSocket[];
  /** Cables: one per tile-to-socket pair, resolved to world points. */
  trunks: { id: string; nodeId: string; socket: string; from: Vec3; to: Vec3; state: Socket["state"] }[];
  /** What the camera has to frame. */
  bounds: { center: Vec3; width: number; depth: number };
};

// ── Routing ────────────────────────────────────────────────────────────────────
// routing.ts turns StageLayout + edges into this. A `Grouping` is the routing-facing projection of
// the layout's groups (only the three egress sides; pinned devices keep their own ping lines).

export type RoutedGroup = {
  id: string;
  side: EgressSide;
  label: string;
  anchor: Vec3;
  /** Ordering key along the lane (mean member z for outside/inside, mean x for vpn) — used to assign
   *  non-crossing rail tracks. */
  laneOrder: number;
  members: { nodeId: string; pos: Vec3 }[];
};

export type Grouping = {
  groups: RoutedGroup[];
  /** Every drawn node id → its group id. Must resolve every edge endpoint, or the edge is skipped. */
  groupOfNode: Map<string, string>;
};

/** A bundle of N edges, firewall egress → group anchor, drawn as ONE tube. */
export type RoutedTrunk = {
  id: string;                     // `trunk:${groupId}`
  groupId: string;
  side: EgressSide;
  curve: THREE.CatmullRomCurve3;  // smooth centreline: the tube + FlowDots ride this
  color: string;                  // severity-reduced colour for the whole bundle
  count: number;                  // paths bundled onto this trunk
  uninspected: number;            // how many are uninspected (the alarm)
  denyOnly: boolean;              // whole bundle is deny-only
  activity: EdgeActivity;         // max tier among members → FlowDots speed
  radius: number;                 // tube radius, encodes count
  labelPos: Vec3;                 // where the "label · N" caption sits
};

/** One edge, fully splayed: memberFrom → firewall → memberTo. Drawn on hover / in tiny scenes. */
export type RoutedPath = {
  id: string;                     // edge id
  groupIds: [string, string];
  points: Vec3[];                 // ordered polyline for a drei <Line>
  curve: THREE.CatmullRomCurve3;  // for FlowDots when drawn individually
  color: string;
  uninspected: boolean;
  denyOnly: boolean;
  activity: EdgeActivity;
};

export type RoutedScene = {
  /** Groups whose path-count > splayThreshold, drawn as one labelled tube each. */
  trunks: RoutedTrunk[];
  /** Every edge's full route, keyed by edge id. Used for hover-splay AND tiny-scene direct draw. */
  paths: Map<string, RoutedPath>;
  /** Group ids drawn as individual member lines instead of a trunk (small groups). */
  splayedGroups: Set<string>;
};

import * as THREE from "three";
import type {
  FirewallEgress,
  EgressSide,
  Grouping,
  RoutedGroup,
  RoutedTrunk,
  RoutedPath,
  RoutedScene,
  StageLayout,
  Vec3,
} from "./contracts";
import type { StagePalette } from "./palette";
import { edgeColor } from "./paths";
import type { TopoEdge } from "../model";
import type { EdgeActivity } from "../flowAnimation";

// Routes the stage's config edges into tidy bundled TRUNKS.
//
// The old scene drew one tall QuadraticBezierCurve3 arc per edge, bowing over the firewall; two
// dozen of them overlapped into spaghetti. This module replaces that with a hub-and-spoke: every
// edge that touches a group rides ONE low, horizontal, orthogonal trunk from the firewall's egress
// rail to that group's anchor. Only small groups (or hover) fall back to per-edge lines.
//
// Pure: it does vector maths with three's Vector3/CatmullRomCurve3 and returns plain geometry. No
// React, no WebGL, no geometry/material — those belong to the renderer (StageScene.tsx).

const EGRESS_SIDES: readonly EgressSide[] = ["outside", "inside", "vpn"];

/** Perpendicular departure from the rail, so a trunk leaves the body cleanly before it sweeps away. */
const STUB = 0.25;

const v3 = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const toVec3 = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Rounded corners with NO overshoot — low tension so the orthogonal path reads as tidy bends, not
 *  a loose spline that bulges past its control points. */
const smooth = (pts: THREE.Vector3[]): THREE.CatmullRomCurve3 =>
  new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0);

/**
 * Projects the layout's groups into the routing-facing `Grouping`.
 *
 * Only the three egress sides are projected — `pinned` devices keep their own ping lines and are
 * not routed as trunks. The Internet, which lives off-stage in its own node rather than any group,
 * becomes a singleton routed group on the outside rail so an internet↔port edge has somewhere to
 * land.
 */
export const buildGrouping = (layout: StageLayout): Grouping => {
  const groups: RoutedGroup[] = [];
  const groupOfNode = new Map<string, string>();

  for (const g of layout.groups) {
    if (g.side === "pinned") continue;
    const side = g.side as EgressSide;
    const members = g.members.map((m) => ({ nodeId: m.id, pos: m.pos }));
    // Ordering key along the lane: mean member z for the horizontal lanes, mean member x for VPN
    // (whose lane runs the other way). Sorting trunks by this keeps their rail tracks from crossing.
    const laneOrder = members.length
      ? members.reduce((s, m) => s + (side === "vpn" ? m.pos.x : m.pos.z), 0) / members.length
      : 0;
    groups.push({ id: g.id, side, label: g.label, anchor: g.anchor, laneOrder, members });
    for (const m of g.members) groupOfNode.set(m.id, g.id);
  }

  if (layout.internet) {
    const net = layout.internet;
    groups.push({
      id: net.id,
      side: "outside",
      label: "Internet",
      anchor: net.pos,
      laneOrder: -9999, // outermost: it sits beyond every real outside group on the rail
      members: [{ nodeId: net.id, pos: net.pos }],
    });
    groupOfNode.set(net.id, net.id);
  }

  return { groups, groupOfNode };
};

/** The whole bundle's colour, reduced to its worst state: an uninspected (non-deny) path makes the
 *  trunk warn, an all-deny bundle reads deny, otherwise allow. */
export const severityColor = (bucket: TopoEdge[], palette: StagePalette): string =>
  bucket.some((e) => e.uninspected && !e.denyOnly)
    ? palette.warn
    : bucket.every((e) => e.denyOnly)
      ? palette.deny
      : palette.allow;

/**
 * Turns the grouping + edges into bundled trunks, per-edge splay paths, and the small-group set.
 *
 * `palette` is threaded through so each trunk/path can be coloured here (via `edgeColor` /
 * `severityColor`) rather than making the renderer re-derive it.
 */
export const routeEdges = (
  egress: FirewallEgress,
  grouping: Grouping,
  edges: TopoEdge[],
  activity: Map<string, EdgeActivity>,
  palette: StagePalette,
  opts?: { splayThreshold?: number },
): RoutedScene => {
  const splayThreshold = opts?.splayThreshold ?? 3;
  const { groupOfNode } = grouping;
  const byId = new Map(grouping.groups.map((g) => [g.id, g] as const));

  // 1. Bucket every edge onto each group it touches. An edge missing an endpoint group is skipped
  //    outright — routing never invents a place for a cable to land.
  const buckets = new Map<string, TopoEdge[]>();
  const valid: { edge: TopoEdge; gf: string; gt: string }[] = [];
  const push = (gid: string, e: TopoEdge) => {
    const b = buckets.get(gid);
    if (b) b.push(e);
    else buckets.set(gid, [e]);
  };
  for (const e of edges) {
    if (e.from === e.to) continue;
    const gf = groupOfNode.get(e.from);
    const gt = groupOfNode.get(e.to);
    if (!gf || !gt) continue;
    valid.push({ edge: e, gf, gt });
    push(gf, e);
    if (gt !== gf) push(gt, e); // don't double-count an edge that lives inside one group
  }

  // 2. Assign a non-crossing rail track per group. Sorting a side's groups by laneOrder before
  //    spreading them across ±halfSpan guarantees the tracks keep the lane's order, so trunks fan
  //    out without crossing.
  const railE = new Map<string, THREE.Vector3>();
  for (const side of EGRESS_SIDES) {
    const rail = egress.rails[side];
    const sideGroups = grouping.groups
      .filter((g) => g.side === side)
      .sort((a, b) => a.laneOrder - b.laneOrder);
    const T = sideGroups.length;
    sideGroups.forEach((g, t) => {
      const offset = lerp(-rail.halfSpan, rail.halfSpan, (t + 0.5) / T);
      railE.set(g.id, v3(rail.center).addScaledVector(v3(rail.along), offset));
    });
  }

  // 3. A FLAT horizontal trunk from the firewall rail straight out to a group's anchor. It used to
  //    lift its midpoint well above both ends (max(E.y, anchor.y) + 0.3), which bowed the bundle up
  //    and OVER the top of the chassis — the "cable draped over the firewall" the redesign was meant
  //    to kill. The rail already sits just outside the box face (rail.out points away from the body),
  //    so the trunk never has to climb over anything: it leaves the rail horizontally and runs level
  //    to the anchor. Keeping the midpoint ON the straight E1→anchor line (no y override) makes the
  //    smoothed curve a clean, nearly-horizontal sweep instead of an arch.
  const trunkRoute = (g: RoutedGroup): THREE.Vector3[] => {
    const rail = egress.rails[g.side];
    const out = v3(rail.out);
    const E = railE.get(g.id)!.clone();
    const E1 = E.clone().addScaledVector(out, STUB);
    const anchor = v3(g.anchor);
    // Hold the run at the rail's height until it nears the anchor, so the bundle reads as a level
    // patch lead leaving the chassis rather than a line that dives toward the floor straight away.
    const mid = E1.clone().lerp(anchor, 0.5);
    mid.y = lerp(E.y, anchor.y, 0.5);
    return [E, E1, mid, anchor];
  };

  // 4. Trunk vs splay. Small buckets become member lines the renderer draws itself; larger ones
  //    collapse into one labelled tube.
  const trunks: RoutedTrunk[] = [];
  const splayedGroups = new Set<string>();
  for (const [gid, bucket] of buckets) {
    const g = byId.get(gid);
    if (!g) continue;
    if (bucket.length <= splayThreshold) {
      splayedGroups.add(gid);
      continue;
    }
    const pts = trunkRoute(g);
    const count = bucket.length;
    const activityTier = bucket.reduce<number>(
      (m, e) => Math.max(m, activity.get(e.id) ?? 0),
      0,
    ) as EdgeActivity;
    // labelPos rides the lifted midpoint of the sweep, clear of the tube.
    const mid = pts[2];
    trunks.push({
      id: `trunk:${gid}`,
      groupId: gid,
      side: g.side,
      curve: smooth(pts),
      color: severityColor(bucket, palette),
      count,
      uninspected: bucket.filter((e) => e.uninspected && !e.denyOnly).length,
      denyOnly: bucket.every((e) => e.denyOnly),
      activity: activityTier,
      radius: clamp(0.012 + 0.006 * Math.log2(1 + count), 0.012, 0.055),
      labelPos: { x: mid.x, y: mid.y + 0.14, z: mid.z },
    });
  }

  // 5. Per-edge full route (member → firewall → member). Built for EVERY surviving edge so the
  //    renderer can splay a trunk on hover and so tiny scenes can draw members directly.
  const memberPos = (g: RoutedGroup, nodeId: string): THREE.Vector3 => {
    const m = g.members.find((mm) => mm.nodeId === nodeId);
    return v3(m ? m.pos : g.anchor);
  };
  const paths = new Map<string, RoutedPath>();
  for (const { edge, gf, gt } of valid) {
    const fromGroup = byId.get(gf)!;
    const toGroup = byId.get(gt)!;
    const Pf = memberPos(fromGroup, edge.from);
    const Pt = memberPos(toGroup, edge.to);
    // A clean sweep that routes INTO the firewall hub — member → its egress → through the box → the
    // other egress → member. The junction used to be LIFTED over the lid (max(Ef,Et)+0.42), which is
    // the cable "draped over the firewall's head" we are removing. Instead, a cross-zone edge
    // (outside ↔ inside) drops its junction DOWN INTO the chassis: the box occludes the middle, so the
    // edge reads as plugging into the device and passing through it, with nothing riding over the top.
    const Ef = (railE.get(gf) ?? v3(fromGroup.anchor)).clone();
    const Et = (railE.get(gt) ?? v3(toGroup.anchor)).clone();
    // Keep the leads below the chassis lid (top ≈ 0.34) so they enter the SIDE of the box, never its
    // top. The VPN shelf is raised on purpose, so a VPN lead keeps its height.
    if (fromGroup.side !== "vpn") Ef.y = 0.3;
    if (toGroup.side !== "vpn") Et.y = 0.3;
    const crossZone = fromGroup.side !== toGroup.side;
    const throughBox = crossZone && fromGroup.side !== "vpn" && toGroup.side !== "vpn";
    const hub = Ef.clone().add(Et).multiplyScalar(0.5);
    // Through-box: sink the junction inside the chassis (y well under the 0.34 lid) so it is hidden.
    // Otherwise (same side, or a raised VPN edge) hold it level with the lower end — never lifted.
    hub.y = throughBox ? 0.12 : Math.min(Ef.y, Et.y);
    const full = [Pf, Ef, hub, Et, Pt];
    paths.set(edge.id, {
      id: edge.id,
      groupIds: [gf, gt],
      points: full.map(toVec3),
      curve: smooth(full),
      color: edgeColor(edge, palette),
      uninspected: edge.uninspected,
      denyOnly: edge.denyOnly,
      activity: activity.get(edge.id) ?? 0,
    });
  }

  return { trunks, paths, splayedGroups };
};

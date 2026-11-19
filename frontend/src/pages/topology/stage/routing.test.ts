import { describe, it, expect } from "vitest";
import { buildGrouping, routeEdges, severityColor } from "./routing";
import { PALETTE } from "./palette";
import type {
  FirewallEgress,
  Grouping,
  RoutedGroup,
  StageLayout,
  Vec3,
  NodeGroup,
  PlacedNode,
} from "./contracts";
import type { TopoEdge } from "../model";

// Pure fixtures — plain objects, no renderer, no layout3d.

const egress = (): FirewallEgress => ({
  rails: {
    outside: { side: "outside", center: { x: -2, y: 0.5, z: 0 }, out: { x: -1, y: 0, z: 0 }, along: { x: 0, y: 0, z: 1 }, halfSpan: 2, railY: 0.6 },
    inside: { side: "inside", center: { x: 2, y: 0.5, z: 0 }, out: { x: 1, y: 0, z: 0 }, along: { x: 0, y: 0, z: 1 }, halfSpan: 2, railY: 0.6 },
    vpn: { side: "vpn", center: { x: 0, y: 0.5, z: 2 }, out: { x: 0, y: 0, z: 1 }, along: { x: 1, y: 0, z: 0 }, halfSpan: 2, railY: 0.6 },
  },
});

const edge = (id: string, from: string, to: string, over: Partial<TopoEdge> = {}): TopoEdge => ({
  id, from, to, policies: 1, denyOnly: false, nat: false, uninspected: false, policyIds: [], ...over,
});

const member = (nodeId: string, pos: Vec3) => ({ nodeId, pos });

const group = (id: string, laneOrder: number, anchorZ: number, members: { nodeId: string; pos: Vec3 }[]): RoutedGroup =>
  ({ id, side: "inside", label: id, anchor: { x: 4, y: 0, z: anchorZ }, laneOrder, members });

const groupingOf = (groups: RoutedGroup[]): Grouping => {
  const groupOfNode = new Map<string, string>();
  for (const g of groups) for (const m of g.members) groupOfNode.set(m.nodeId, g.id);
  return { groups, groupOfNode };
};

const PAL = PALETTE.light;

describe("routeEdges — bundling", () => {
  it("collapses 10 edges across 2 groups into at most 2 trunks (bounded by group count, not edge count)", () => {
    const A = group("A", -1, -1, [member("a0", { x: 4, y: 0, z: -1 }), member("a1", { x: 4, y: 0, z: -1 })]);
    const B = group("B", 1, 1, ["b0", "b1", "b2", "b3", "b4"].map((b) => member(b, { x: 4, y: 0, z: 1 })));
    const grouping = groupingOf([A, B]);

    const edges: TopoEdge[] = [];
    for (const a of ["a0", "a1"]) for (const b of ["b0", "b1", "b2", "b3", "b4"]) edges.push(edge(`${a}->${b}`, a, b));
    expect(edges).toHaveLength(10);

    const scene = routeEdges(egress(), grouping, edges, new Map(), PAL);
    expect(scene.trunks.length).toBeLessThanOrEqual(2);
    expect(scene.trunks.length).toBeLessThanOrEqual(grouping.groups.length);
    expect(scene.trunks).toHaveLength(2); // both buckets hold 10 edges > threshold
  });

  it("splays a small group (<= 3 edges) instead of trunking it", () => {
    const C = group("C", -1, -1, [member("c0", { x: 4, y: 0, z: -1 })]);
    const D = group("D", 1, 1, [member("d0", { x: 4, y: 0, z: 1 })]);
    const grouping = groupingOf([C, D]);
    const edges = [edge("e0", "c0", "d0"), edge("e1", "c0", "d0"), edge("e2", "c0", "d0")];

    const scene = routeEdges(egress(), grouping, edges, new Map(), PAL);
    expect(scene.trunks).toHaveLength(0);
    expect(scene.splayedGroups.has("C")).toBe(true);
    expect(scene.splayedGroups.has("D")).toBe(true);
    expect(scene.paths.size).toBe(3); // still routed per-edge for direct draw / hover
  });

  it("skips an edge whose endpoint belongs to no group", () => {
    const A = group("A", -1, -1, [member("a0", { x: 4, y: 0, z: -1 })]);
    const B = group("B", 1, 1, [member("b0", { x: 4, y: 0, z: 1 })]);
    const grouping = groupingOf([A, B]);
    const edges = [edge("real", "a0", "b0"), edge("ghost", "a0", "nowhere")];

    const scene = routeEdges(egress(), grouping, edges, new Map(), PAL);
    expect(scene.paths.has("real")).toBe(true);
    expect(scene.paths.has("ghost")).toBe(false);
  });

  it("assigns rail tracks in laneOrder order so trunks do not cross (laneOrder a < b ⇒ offset oa < ob)", () => {
    // Two outside groups with distinct laneOrder, each with enough edges to earn a trunk.
    const lo: RoutedGroup = { id: "lo", side: "outside", label: "lo", anchor: { x: -4, y: 0, z: -3 }, laneOrder: -3, members: ["l0", "l1"].map((n) => member(n, { x: -4, y: 0, z: -3 })) };
    const hi: RoutedGroup = { id: "hi", side: "outside", label: "hi", anchor: { x: -4, y: 0, z: 3 }, laneOrder: 3, members: ["h0", "h1"].map((n) => member(n, { x: -4, y: 0, z: 3 })) };
    const grouping = groupingOf([lo, hi]);
    const edges: TopoEdge[] = [];
    for (const a of ["l0", "l1"]) for (const b of ["h0", "h1"]) edges.push(edge(`${a}->${b}`, a, b)); // 4 each > threshold
    const scene = routeEdges(egress(), grouping, edges, new Map(), PAL);

    const rail = egress().rails.outside;
    const alongOffset = (gid: string): number => {
      const t = scene.trunks.find((tr) => tr.groupId === gid)!;
      const e0 = (t.curve as unknown as { points: { x: number; y: number; z: number }[] }).points[0]; // rail connection E
      return (e0.x - rail.center.x) * rail.along.x + (e0.z - rail.center.z) * rail.along.z;
    };
    expect(alongOffset("lo")).toBeLessThan(alongOffset("hi"));
  });
});

describe("severityColor", () => {
  it("is warn when any edge is uninspected (and not deny)", () => {
    const bucket = [edge("a", "x", "y"), edge("b", "x", "y", { uninspected: true })];
    expect(severityColor(bucket, PAL)).toBe(PAL.warn);
  });
  it("is deny when every edge is deny-only", () => {
    const bucket = [edge("a", "x", "y", { denyOnly: true }), edge("b", "x", "y", { denyOnly: true })];
    expect(severityColor(bucket, PAL)).toBe(PAL.deny);
  });
  it("is allow otherwise", () => {
    const bucket = [edge("a", "x", "y"), edge("b", "x", "y", { denyOnly: true })];
    expect(severityColor(bucket, PAL)).toBe(PAL.allow);
  });
});

describe("buildGrouping", () => {
  // Minimal StageLayout: buildGrouping only reads group id/side/label/anchor/members and internet.
  const mkMember = (id: string, pos: Vec3) => ({ id, pos } as unknown as PlacedNode);
  const mkGroup = (id: string, side: string, members: PlacedNode[]): NodeGroup =>
    ({ id, side, label: id, anchor: { x: 0, y: 0, z: 0 }, members } as unknown as NodeGroup);

  it("maps every member id, skips pinned, and adds the Internet singleton", () => {
    const layout = {
      groups: [
        mkGroup("grp:outside", "outside", [mkMember("if:wan1", { x: -4, y: 0, z: 0 }), mkMember("if:wan2", { x: -4, y: 0, z: 1 })]),
        mkGroup("grp:inside", "inside", [mkMember("zone:lan", { x: 4, y: 0, z: 0 })]),
        mkGroup("grp:pinned", "pinned", [mkMember("dev:1", { x: 0, y: 0, z: -4 })]),
      ],
      internet: mkMember("internet", { x: -8, y: 1, z: 0 }),
    } as unknown as StageLayout;

    const g = buildGrouping(layout);

    // Every non-pinned member is mapped; pinned is skipped.
    expect(g.groupOfNode.get("if:wan1")).toBe("grp:outside");
    expect(g.groupOfNode.get("if:wan2")).toBe("grp:outside");
    expect(g.groupOfNode.get("zone:lan")).toBe("grp:inside");
    expect(g.groupOfNode.has("dev:1")).toBe(false);
    expect(g.groups.some((rg) => rg.side === ("pinned" as unknown))).toBe(false);

    // Internet singleton present and mapped to itself, outermost on the outside rail.
    const net = g.groups.find((rg) => rg.id === "internet");
    expect(net).toBeDefined();
    expect(net!.side).toBe("outside");
    expect(net!.laneOrder).toBe(-9999);
    expect(net!.members).toEqual([{ nodeId: "internet", pos: { x: -8, y: 1, z: 0 } }]);
    expect(g.groupOfNode.get("internet")).toBe("internet");
  });
});

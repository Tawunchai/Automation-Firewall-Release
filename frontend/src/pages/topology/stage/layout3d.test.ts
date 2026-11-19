import { describe, it, expect } from "vitest";
import { buildTopology } from "../model";
import { buildStage, type StageModel, type Lane } from "./stageModel";
import { layoutStage, firewallEgress, CHASSIS_H, CHASSIS_D } from "./layout3d";
import { FGT80E_INTERFACES, FGT80E_ROUTES, FGT80E_POLICIES } from "./fixture80e";

const laid = () => layoutStage(buildStage({
  topo: buildTopology({
    interfaces: FGT80E_INTERFACES, zones: [], routes: FGT80E_ROUTES, tunnels: [],
    policies: FGT80E_POLICIES, deviceName: "FortiGate-80E", unreadable: [],
  }),
  interfaces: FGT80E_INTERFACES,
  routes: FGT80E_ROUTES,
}));

describe("layoutStage", () => {
  it("reads outside → device → inside along one axis", () => {
    const l = laid();
    const x = (label: string) => l.nodes.find((n) => n.label === label)!.pos.x;
    expect(l.internet!.pos.x).toBeLessThan(x("port1")); // internet sits beyond the Outside lane
    expect(x("port1")).toBeLessThan(0);         // Outside lane
    expect(x("lan")).toBeGreaterThan(0);        // Inside lane
    expect(x("dmz")).toBeGreaterThan(0);
  });

  it("centres a single-group lane on the chassis instead of starting it at the back", () => {
    const l = laid();
    const z = l.nodes.filter((n) => n.lane === "inside").map((n) => n.pos.z);
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });

  it("keeps the faceplate's two rows apart and puts every jack on the top surface", () => {
    const l = laid();
    const top = l.sockets.filter((s) => s.row === 0);
    const bottom = l.sockets.filter((s) => s.row === 1);
    expect(top.every((s) => s.pos.z < 0)).toBe(true);
    expect(bottom.every((s) => s.pos.z > 0)).toBe(true);
    expect(l.sockets.every((s) => s.pos.y === l.chassis.height)).toBe(true);
    expect(l.chassis.height).toBe(CHASSIS_H);
    expect(l.chassis.depth).toBe(CHASSIS_D);
  });

  it("never stacks two jacks on the same spot", () => {
    const seen = new Set(laid().sockets.map((s) => `${s.pos.x.toFixed(4)}|${s.pos.z.toFixed(4)}`));
    expect(seen.size).toBe(16);
  });

  it("keeps the faceplate inside the chassis it is cut into", () => {
    const l = laid();
    const widest = Math.max(...l.sockets.map((s) => Math.abs(s.pos.x)));
    expect(widest).toBeLessThan(l.chassis.width / 2);
  });

  // Eleven thin cables into eleven real jacks, not one fat line that hides where they land.
  it("draws one cable per jack a tile owns", () => {
    const l = laid();
    expect(l.trunks.filter((t) => t.nodeId === "if:lan")).toHaveLength(11);
    expect(l.trunks.filter((t) => t.nodeId === "if:dmz")).toHaveLength(1);
    // The internet has no jack of its own: it reaches the device through port1's cable.
    expect(l.trunks.some((t) => t.nodeId === "internet")).toBe(false);
  });

  it("lands every cable exactly on its own socket", () => {
    const l = laid();
    l.trunks.forEach((t) => {
      const s = l.sockets.find((x) => x.name === t.socket)!;
      expect(t.to).toEqual(s.pos);
    });
  });

  it("raises the internet off the floor so it does not read as another port", () => {
    expect(laid().internet!.pos.y).toBeGreaterThan(0.3);
  });

  it("firewall dims and its back-compat chassis alias agree", () => {
    const l = laid();
    expect(l.chassis).toEqual({ width: l.firewall.width, depth: l.firewall.depth, height: l.firewall.height });
    expect(l.firewall.pos).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ── Grouping ──────────────────────────────────────────────────────────────────
describe("layoutStage — groups", () => {
  it("makes one group per occupied lane, and does not group the internet", () => {
    const l = laid();
    expect(l.groups.filter((g) => g.side === "outside")).toHaveLength(1);
    expect(l.groups.filter((g) => g.side === "inside")).toHaveLength(1);
    expect(l.groups.filter((g) => g.side === "vpn")).toHaveLength(0); // no VPN nodes in the fixture
    // The internet is returned on its own, never inside a group, with an empty groupId.
    expect(l.groups.flatMap((g) => g.members).some((n) => n.kind === "internet")).toBe(false);
    expect(l.internet!.groupId).toBe("");
    // Every placed node carries the id of the group it stands on.
    expect(l.nodes.every((n) => n.groupId.length > 0)).toBe(true);
  });

  it("anchors a group between the firewall centre and its region (closer to the firewall)", () => {
    const g = layoutStage(many(6, "inside")).groups[0];
    // Inside grows +x; firewall centre is at x=0.
    expect(g.anchor.x).toBeGreaterThan(0);
    expect(g.anchor.x).toBeLessThan(g.region.center.x);
    expect(g.anchor.y).toBeCloseTo(0.3); // ANCHOR_Y
  });
});

// Build a bare StageModel of `n` identical interface tiles in one lane, each with an optional role.
const many = (n: number, lane: Lane = "inside", roles?: string[]): StageModel => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `if:seg${i}`, kind: "interface" as const, label: `seg${i}`, detail: "",
    route: "/admin/fw-interfaces", lane, sockets: [], logical: true,
    ...(roles ? { role: roles[i % roles.length] } : {}),
  })),
  sockets: [],
  captions: { fixed: "", numbered: "" },
  fold: { unused: [], system: [] },
  linkUnreadable: false,
  ports: { jacks: 0, up: 0, down: 0, unknown: 0, unused: 0 },
  wan: { via: [], gateway: "", up: 0, total: 0 },
});

describe("layoutStage — a lane longer than the stage", () => {
  // A dozen zones in one column made the lane deeper than the stage is wide, and framing something
  // that long shrinks the chassis to a smudge — the ring's mistake, rotated 90°.
  it("wraps into columns instead of growing one very long row", () => {
    const l = layoutStage(many(12));
    const xs = new Set(l.nodes.map((n) => Math.round(n.pos.x * 100)));
    expect(xs.size).toBeGreaterThan(1);
    const depth = Math.max(...l.nodes.map((n) => n.pos.z)) - Math.min(...l.nodes.map((n) => n.pos.z));
    expect(depth).toBeLessThan(9);
  });

  it("grows outward, never back over the device", () => {
    expect(layoutStage(many(12)).nodes.every((n) => n.pos.x > 0)).toBe(true);
  });

  it("keeps one column when a lane is short", () => {
    expect(new Set(layoutStage(many(4)).nodes.map((n) => n.pos.x)).size).toBe(1);
  });

  it("caps a huge group and folds the rest into overflow", () => {
    const g = layoutStage(many(25)).groups[0];
    expect(g.members).toHaveLength(23); // MEMBERS_CAP
    expect(g.overflow).toBe(2);
    expect(g.total).toBe(25);
  });
});

describe("layoutStage — role subdivision", () => {
  const laneGroups = (m: StageModel) => layoutStage(m).groups.filter((g) => g.side === "inside");

  it("splits a crowded, genuinely-mixed lane into role platforms", () => {
    const groups = laneGroups(many(8, "inside", ["lan", "dmz"]));
    expect(groups.length).toBeGreaterThan(1);
    expect(new Set(groups.map((g) => g.label))).toEqual(new Set(["LAN", "DMZ"]));
  });

  it("does not split a lane that is mixed but not crowded (< 8 members)", () => {
    expect(laneGroups(many(7, "inside", ["lan", "dmz"]))).toHaveLength(1);
  });

  it("does not split a crowded lane that is all one role", () => {
    expect(laneGroups(many(10, "inside", ["lan"]))).toHaveLength(1);
  });
});

describe("firewallEgress", () => {
  it("puts outside on −x, inside on +x, and vpn behind, at the stated rail heights", () => {
    const { rails } = firewallEgress({ width: 1, height: CHASSIS_H, depth: CHASSIS_D });
    expect(rails.outside.center.x).toBeLessThan(0);
    expect(rails.outside.out).toEqual({ x: -1, y: 0, z: 0 });
    expect(rails.outside.railY).toBe(0.42);
    expect(rails.inside.center.x).toBeGreaterThan(0);
    expect(rails.inside.out).toEqual({ x: 1, y: 0, z: 0 });
    expect(rails.inside.railY).toBe(0.42);
    expect(rails.vpn.center.z).toBeLessThan(0);
    expect(rails.vpn.railY).toBe(1.05);
    expect(rails.vpn.halfSpan).toBe(Math.max(0.6, 1 * 0.35));
  });
});

import { describe, expect, it } from "vitest";
import { layoutUserDevices, shapeForKind } from "./userDevices";
import type { StageLayout } from "./layout3d";
import type { TopologyDevice } from "../../../api/topologyDevices";

const BASE: StageLayout = {
  firewall: { pos: { x: 0, y: 0, z: 0 }, width: 2, depth: 1.18, height: 0.34 },
  chassis: { width: 2, depth: 1.18, height: 0.34 },
  egress: {
    rails: {
      outside: { side: "outside", center: { x: -1.05, y: 0.42, z: 0 }, out: { x: -1, y: 0, z: 0 }, along: { x: 0, y: 0, z: 1 }, halfSpan: 0.6, railY: 0.42 },
      inside: { side: "inside", center: { x: 1.05, y: 0.42, z: 0 }, out: { x: 1, y: 0, z: 0 }, along: { x: 0, y: 0, z: 1 }, halfSpan: 0.6, railY: 0.42 },
      vpn: { side: "vpn", center: { x: 0, y: 1.05, z: -0.64 }, out: { x: 0, y: 0, z: -1 }, along: { x: 1, y: 0, z: 0 }, halfSpan: 0.7, railY: 1.05 },
    },
  },
  groups: [],
  nodes: [],
  sockets: [],
  trunks: [],
  bounds: { center: { x: 0, y: 0, z: 0 }, width: 6, depth: 4 },
};

const dev = (over: Partial<TopologyDevice>): TopologyDevice => ({
  id: 1, owner_user_id: 1, device_id: 1, name: "sw1", description: "",
  ip_address: "10.0.0.2", kind: "switch", ping_interval_seconds: 60, enabled: true,
  last_status: "unknown", created_at: "", updated_at: "", ...over,
});

describe("layoutUserDevices", () => {
  it("returns the base bounds untouched when there are no devices", () => {
    const out = layoutUserDevices([], BASE);
    expect(out.nodes).toHaveLength(0);
    expect(out.bounds).toEqual(BASE.bounds);
  });

  it("places devices in front of the chassis, centred, and grows the frame to include them", () => {
    const out = layoutUserDevices([dev({ id: 1 }), dev({ id: 2, name: "sw2" })], BASE);
    expect(out.nodes).toHaveLength(2);
    // In front: positive z, beyond the chassis.
    expect(out.nodes.every((n) => n.pos.z > 0)).toBe(true);
    // Centred: two devices sit symmetrically about x = 0.
    expect(out.nodes[0].pos.x).toBeCloseTo(-out.nodes[1].pos.x, 5);
    // The frame grew to reach the new shelf.
    const reach = out.bounds.center.z + out.bounds.depth / 2;
    expect(reach).toBeGreaterThan(BASE.bounds.center.z + BASE.bounds.depth / 2);
  });

  it("wraps a long list onto a second shelf rather than one very wide row", () => {
    const many = Array.from({ length: 8 }, (_, i) => dev({ id: i + 1, name: `d${i}` }));
    const out = layoutUserDevices(many, BASE);
    const zValues = new Set(out.nodes.map((n) => Number(n.pos.z.toFixed(3))));
    expect(zValues.size).toBeGreaterThan(1); // more than one shelf
  });

  it("maps a disabled device to unknown and labels it, whatever its last reading was", () => {
    const [n] = layoutUserDevices([dev({ enabled: false, last_status: "up" })], BASE).nodes;
    expect(n.status).toBe("unknown");
    expect(n.detail).toBe("ping off");
  });

  it("labels a reachable device with its latency", () => {
    const [n] = layoutUserDevices(
      [dev({ last_status: "up", last_latency_ms: 2.6, last_checked_at: "2026-11-10T00:00:00Z" })],
      BASE,
    ).nodes;
    expect(n.status).toBe("up");
    expect(n.detail).toBe("up · 3 ms");
  });

  it("maps every kind to a shape", () => {
    expect(shapeForKind("access-point")).toBe("ap");
    expect(shapeForKind("switch")).toBe("switch");
    expect(shapeForKind("firewall")).toBe("firewall");
  });
});

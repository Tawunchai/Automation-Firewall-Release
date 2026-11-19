import type { StageLayout, Vec3 } from "./layout3d";
import type { TopologyDevice, TopologyDeviceKind, TopologyDeviceStatus } from "../../../api/topologyDevices";

// Where the user's own pinned devices stand on the stage, and how each one reads.
//
// They are a LAYER ON TOP of the firewall-derived scene, not part of it: the config map answers
// "what is this firewall", these answer "what else is out there that it can see". So they get their
// own shelf in FRONT of the chassis (positive z, toward the camera) rather than being threaded into
// the Outside/Inside lanes, whose geometry carries the direction of traffic and must not be
// disturbed. A thin line from the chassis to each device says who is doing the pinging.
//
// Pure arithmetic and pure mapping, like layout3d.ts and stageModel.ts — the part that decides
// whether the extra devices are legible is tested without a WebGL context.

/** The shape the scene draws for each kind. Primitives only, so the glyph reads at any camera angle. */
export type DeviceShape = "switch" | "router" | "endpoint" | "ap" | "server" | "firewall" | "other";

export type PlacedUserDevice = {
  id: number;
  name: string;
  ip: string;
  kind: TopologyDeviceKind;
  shape: DeviceShape;
  status: TopologyDeviceStatus;
  latencyMs?: number;
  /** Shown under the glyph: "up · 1 ms" / "down" / "not checked yet". */
  detail: string;
  pos: Vec3;
};

export type UserDeviceLayout = {
  nodes: PlacedUserDevice[];
  /** The base bounds grown to include the device shelf, so the camera frames them too. */
  bounds: StageLayout["bounds"];
  /** Where the ping lines leave the chassis from. */
  anchor: Vec3;
};

const SHAPE_FOR: Record<TopologyDeviceKind, DeviceShape> = {
  switch: "switch",
  router: "router",
  endpoint: "endpoint",
  "access-point": "ap",
  server: "server",
  firewall: "firewall",
  other: "other",
};

export const shapeForKind = (k: TopologyDeviceKind): DeviceShape => SHAPE_FOR[k] ?? "other";

// ── Placement ─────────────────────────────────────────────────────────────────

/** First shelf's distance in front of the chassis centre. */
const FRONT_Z = 3.5;
/** Extra shelves step further forward so a long list does not pile onto one row. */
const ROW_PITCH_Z = 1.55;
/** Spacing across a row. Wider than a tile because the label is wider than the glyph. */
const X_PITCH = 2.0;
/** A row wraps to the next shelf after this many, so the stage never grows wider than it is deep. */
const PER_ROW = 6;
/** Chassis half-height / half-depth the ping lines leave from (mirrors layout3d's CHASSIS_*). */
const ANCHOR = { y: 0.34, z: 1.18 / 2 };

function detailFor(d: TopologyDevice): string {
  if (!d.enabled) return "ping off";
  if (!d.last_checked_at) return "not checked yet";
  if (d.last_status === "up") {
    return d.last_latency_ms != null ? `up · ${Math.round(d.last_latency_ms)} ms` : "up";
  }
  if (d.last_status === "down") return "down";
  return "unknown";
}

/**
 * Lays the devices out in front of the chassis and grows the camera's frame to include them.
 *
 * `base` is the firewall layout already computed by layoutStage. The returned bounds are the union of
 * its bounds and the new shelf, so expanding from one firewall's handful of ports to a wall of pinned
 * devices reframes the camera rather than letting them fall off the front of the stage.
 */
export function layoutUserDevices(devices: TopologyDevice[], base: StageLayout): UserDeviceLayout {
  const anchor: Vec3 = { x: 0, y: ANCHOR.y, z: ANCHOR.z };

  const nodes: PlacedUserDevice[] = devices.map((d, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const inRow = Math.min(PER_ROW, devices.length - row * PER_ROW);
    return {
      id: d.id,
      name: d.name,
      ip: d.ip_address,
      kind: d.kind,
      shape: shapeForKind(d.kind),
      status: d.enabled ? d.last_status : "unknown",
      latencyMs: d.last_latency_ms,
      detail: detailFor(d),
      pos: {
        x: (col - (inRow - 1) / 2) * X_PITCH,
        y: 0,
        z: FRONT_Z + row * ROW_PITCH_Z,
      },
    };
  });

  // Grow the frame. With no devices the base bounds are returned untouched, so the firewall-only
  // scene is framed exactly as before.
  if (nodes.length === 0) {
    return { nodes, bounds: base.bounds, anchor };
  }

  const b = base.bounds;
  const baseMinX = b.center.x - b.width / 2;
  const baseMaxX = b.center.x + b.width / 2;
  const baseMinZ = b.center.z - b.depth / 2;
  const baseMaxZ = b.center.z + b.depth / 2;

  const PAD = 1.7; // a label plus an address sits above each glyph
  const xs = nodes.map((n) => n.pos.x);
  const zs = nodes.map((n) => n.pos.z);
  const minX = Math.min(baseMinX, ...xs.map((x) => x - PAD));
  const maxX = Math.max(baseMaxX, ...xs.map((x) => x + PAD));
  const minZ = Math.min(baseMinZ, ...zs.map((z) => z - PAD));
  const maxZ = Math.max(baseMaxZ, ...zs.map((z) => z + PAD));

  return {
    nodes,
    bounds: {
      center: { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
      width: maxX - minX,
      depth: maxZ - minZ,
    },
    anchor,
  };
}

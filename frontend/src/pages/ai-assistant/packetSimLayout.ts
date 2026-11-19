// packetSimLayout — where every box, band and packet path sits.
//
// Split out of the renderer for the same reason flowLayout.ts was before it: geometry is arithmetic
// and arithmetic is testable, while SVG attributes are not. PacketWalk.tsx turns these numbers into
// elements and does no maths of its own, so "the label overlaps the badge at nine rules" is a
// failing assertion here rather than something somebody notices in a screenshot.
//
// THE PICTURE IS A NETWORK, NOT A TABLE WITH DECORATION.
//
//        ┌── FortiGate ───────────────────────┐
//   src ─┤ port  #4 rule …                    ├─ port ──NAT──▶  ☁ internet
//        │       #5 rule …                    │
//        └────────────────────────────────────┘
//
// The rule table lives INSIDE the chassis because that is where it lives: a packet arrives on an
// interface, is walked down the table by the firewall, and leaves through another interface. The
// first version drew the table as a free-floating column between two cards, which is a picture of a
// list rather than a picture of a device — and it left a reader to supply the machine from memory.
//
// IT IS DRIVEN BY THE MEASURED WIDTH, not by a fixed drawing size. Columns are ALLOCATED from
// whatever width the container reports, and what does not fit is dropped in a deliberate order —
// the minimap first (it is context, not content) — while the rule table is never allowed below
// MIN_RUNG_W, because it is the whole point.
//
// TWO LINES PER RULE, also on purpose. One line could not hold position + name + source + service +
// action AND the status column ("unreachable", "✕ service", "→ forwarded"), and pushing the status
// outside the row runs it under the chassis wall.

import type { SimRow } from "./packetSim";

// ── The columns ──────────────────────────────────────────────────────────────

export type SimLayoutOpts = {
  width: number;
  /** y of the first row. The chassis header sits in the space above it. */
  top: number;
  mapX: number; mapW: number;
  srcX: number; srcW: number;
  /** The device: everything between its walls is inside the firewall. */
  chassisX: number; chassisW: number; chassisHeadH: number;
  /** The vertical line the walk descends, inside the chassis. */
  railX: number;
  rungX: number; rungW: number;
  /** Where the traffic ends up — a cloud for the internet, a card for a named network. */
  outX: number; outW: number;
  ruleH: number; bandH: number; gap: number;
  /** Type sizes, so a narrow drawing can shrink its labels instead of clipping them. */
  nameSize: number; metaSize: number;
};

/**
 * Where the walk is being drawn. It decides the row height and the type scale; the COLUMNS come
 * from the measured width in every mode, so none of the three has a fixed drawing size.
 */
export type SimLayoutMode = "compact" | "panel" | "wide";

const PAD = 12;
const COL_GAP = 14;
/** Source card → the chassis wall. */
const WIRE_IN = 26;
/**
 * Chassis wall → the destination.
 *
 * It was 72 to fit an egress port pill straddling the wall and a NAT badge beyond it. Neither is
 * drawn any more, so the wire is back to being a wire and the width goes to the rule table, which
 * is what the drawing is actually about.
 */
const WIRE_OUT = 50;
/** Inside the chassis, between its wall and the rail / the last rule column. */
const CHASSIS_PAD = 15;
/** Rail → the first rule column. */
const RAIL_GAP = 17;
const MIN_RUNG_W = 240;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const MODE = {
  compact: { top: 52, ruleH: 34, bandH: 21, gap: 3, nameSize: 10.5, metaSize: 8.5, mapW: 0,  head: 24 },
  panel:   { top: 62, ruleH: 40, bandH: 24, gap: 4, nameSize: 11,   metaSize: 9,   mapW: 22, head: 27 },
  wide:    { top: 68, ruleH: 44, bandH: 26, gap: 5, nameSize: 12,   metaSize: 9.5, mapW: 28, head: 30 },
} as const;

/**
 * Allocate the columns across `width`.
 *
 * `withMap` is the caller's answer to "is the whole rule base worth a scale bar?". On a table of
 * eight rules the minimap is a grey column next to a table that already fits — context nobody
 * needed, in the one place the drawing had spare width. PacketWalk turns it on only when the walk
 * is genuinely a window onto something bigger.
 */
export function simLayout(width: number, mode: SimLayoutMode, withMap = true): SimLayoutOpts {
  const m = MODE[mode];
  const w = Math.max(320, Math.round(width));

  let mapW = mode === "compact" || !withMap ? 0 : m.mapW;
  let srcW = clamp(Math.round(w * 0.15), 100, 170);
  let outW = clamp(Math.round(w * 0.15), 118, 168);

  const rungFor = () =>
    w - PAD * 2 - mapW - (mapW ? COL_GAP : 0)
      - srcW - WIRE_IN - CHASSIS_PAD - RAIL_GAP - CHASSIS_PAD - WIRE_OUT - outW;

  if (rungFor() < MIN_RUNG_W && mapW) mapW = 0;
  if (rungFor() < MIN_RUNG_W) { srcW = 100; outW = 112; }

  // Below this the table stops being a table. If even the floor does not fit — a phone in portrait,
  // a panel dragged very narrow — the DRAWING widens past the container and the SVG scales itself
  // down to fit, which costs a little type size and still never produces a sideways scrollbar.
  const rungW = Math.max(170, rungFor());

  const mapX = PAD;
  const srcX = mapX + mapW + (mapW ? COL_GAP : 0);
  const chassisX = srcX + srcW + WIRE_IN;
  const railX = chassisX + CHASSIS_PAD;
  const rungX = railX + RAIL_GAP;
  const chassisW = rungX + rungW + CHASSIS_PAD - chassisX;
  const outX = chassisX + chassisW + WIRE_OUT;

  return {
    width: Math.max(w, outX + outW + PAD), top: m.top,
    mapX, mapW, srcX, srcW,
    chassisX, chassisW, chassisHeadH: m.head,
    railX, rungX, rungW, outX, outW,
    ruleH: m.ruleH, bandH: m.bandH, gap: m.gap,
    nameSize: m.nameSize, metaSize: m.metaSize,
  };
}

/** The presets the tests and the still frame use when nothing has been measured yet. */
export const SIM_LAYOUT = simLayout(1180, "wide");
export const SIM_LAYOUT_PANEL = simLayout(700, "panel");
export const SIM_LAYOUT_COMPACT = simLayout(560, "compact");

// ── Rows ─────────────────────────────────────────────────────────────────────

export type PlacedRow = { y: number; h: number; mid: number; line1: number; line2: number };

export function layoutRows(rows: SimRow[], o: SimLayoutOpts): PlacedRow[] {
  let y = o.top;
  return rows.map((r) => {
    const h = r.kind === "band" ? o.bandH : o.ruleH;
    const box: PlacedRow = {
      y, h, mid: y + h / 2,
      // Baselines, not box tops: SVG text hangs from its baseline, and a rule row carries two.
      line1: y + Math.round(h * 0.43),
      line2: y + Math.round(h * 0.79),
    };
    y += h + o.gap;
    return box;
  });
}

/** The device's outline: the header strip above the first row down to below the last one. */
export function chassisBox(placed: PlacedRow[], o: SimLayoutOpts): { x: number; y: number; w: number; h: number } {
  const last = placed[placed.length - 1];
  const y = o.top - o.chassisHeadH;
  const bottom = (last ? last.y + last.h : o.top) + CHASSIS_PAD;
  return { x: o.chassisX, y, w: o.chassisW, h: bottom - y };
}

export function totalHeight(placed: PlacedRow[], o: SimLayoutOpts): number {
  const box = chassisBox(placed, o);
  return Math.max(220, box.y + box.h + 16);
}

/**
 * How many characters fit in `px` at `size`.
 *
 * Clipping used to be a constant per label, which is wrong the moment the drawing is a different
 * width — the same 30-character budget either wasted half a column or ran a rule name under the
 * ACCEPT badge. 0.56em is the measured average for the console's UI face at these sizes; it errs
 * short, which loses a letter rather than overlapping the next column.
 */
export function charsFor(px: number, size: number): number {
  return Math.max(4, Math.floor(px / (size * 0.56)));
}

// ── Paths ────────────────────────────────────────────────────────────────────

/** Source card → the ingress port on the chassis wall. */
export function ingressPath(o: SimLayoutOpts, srcMid: number, portY: number): string {
  const x0 = o.srcX + o.srcW;
  const mid = (x0 + o.chassisX) / 2;
  return `M ${x0} ${srcMid} C ${mid} ${srcMid}, ${mid} ${portY}, ${o.chassisX} ${portY}`;
}

/** Inside the chassis: the wall port → the top of the rail. */
export function entryPath(o: SimLayoutOpts, portY: number, railTop: number): string {
  return `M ${o.chassisX} ${portY} L ${o.railX} ${portY} L ${o.railX} ${railTop}`;
}

/** The vertical line the walk descends. */
export function railPath(o: SimLayoutOpts, from: number, to: number): string {
  return `M ${o.railX} ${from} L ${o.railX} ${to}`;
}

/**
 * The matched row → out of the chassis → the destination.
 *
 * Every allowed flow leaves through the SAME egress port, so the wires converge on one point on the
 * wall instead of drawing three arrows into three different places on one interface.
 */
export function outboundPath(o: SimLayoutOpts, fromY: number, portY: number): string {
  const wall = o.chassisX + o.chassisW;
  const mid = (wall + o.outX) / 2;
  return `M ${o.rungX + o.rungW} ${fromY} L ${wall - 2} ${fromY} `
    + `C ${mid} ${fromY}, ${mid} ${portY}, ${o.outX} ${portY}`;
}

// ── The minimap ──────────────────────────────────────────────────────────────

export type MapBar = { y: number; h: number; kind: "band" | "rule"; state: string; isNew: boolean };

/**
 * The whole rule base as one column of bars, so the expanded window has a scale.
 *
 * Bar heights are proportional to how many policies each row stands for, and they add up to the
 * table AFTER the change — counting only the visible rows would leave the last band hanging off the
 * bottom on any run that inserts a rule.
 */
export function layoutMinimap(rows: SimRow[], o: SimLayoutOpts, height: number): {
  bars: MapBar[]; total: number; windowY: number; windowH: number;
} {
  const total = rows.reduce(
    (n, r) => n + (r.kind === "band" ? r.count : (r.key === "implicit" ? 0 : 1)), 0);
  const mapTop = o.top;
  const mapH = height - o.top - 18;
  const per = total > 0 ? mapH / total : 0;

  const bars: MapBar[] = [];
  let cursor = 0, windowY = mapTop, windowH = 0, seenRule = false;
  for (const r of rows) {
    const n = r.kind === "band" ? r.count : (r.key === "implicit" ? 0 : 1);
    if (!n) continue;
    const y = mapTop + cursor * per;
    const h = Math.max(1.6, n * per - 1);
    bars.push({
      y, h, kind: r.kind,
      state: r.kind === "band" ? "band" : r.state,
      isNew: r.kind === "rule" && r.isNew,
    });
    // The bracket spans the candidate window — the rules the walk actually expands.
    if (r.kind === "rule") {
      if (!seenRule) { windowY = y; seenRule = true; }
      windowH = y + h - windowY;
    }
    cursor += n;
  }
  return { bars, total, windowY, windowH };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * The internet, as a GLOBE in a 24×24 box.
 *
 * It was a cloud, scaled to the width of its column — which on a wide drawing produced a 170px
 * balloon that was the loudest thing on screen and said the least. A destination is a label, not a
 * landmark: the glyph is now drawn at a FIXED 22px inside a card the same family as the source
 * card, so all three nodes read as one row of nodes rather than two boxes and a weather system.
 *
 * Drawn as arcs rather than as <circle>/<ellipse> so the whole mark is three path strings the
 * renderer can hand straight to the same <path> it uses everywhere else.
 */
export const GLOBE_D = {
  /** The sphere. Two half-arcs, because one arc cannot close a full circle. */
  disc: "M 12 1.6 a 10.4 10.4 0 1 0 0 20.8 a 10.4 10.4 0 1 0 0 -20.8",
  /** The line of longitude that makes a circle read as a globe rather than as a clock face. */
  meridian: "M 12 1.6 C 6.7 5.2 6.7 18.8 12 22.4 C 17.3 18.8 17.3 5.2 12 1.6",
  /** Tropics and equator. */
  lats: ["M 3.4 7.4 H 20.6", "M 1.6 12 H 22.4", "M 3.4 16.6 H 20.6"],
} as const;

/** Feather's `shield`, for the chassis badge. Same reason. */
export const SHIELD_D = "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z";

/**
 * Ease a 0→1 leg of a packet's journey.
 *
 * Linear travel is why the old walk read as a conveyor belt: every packet left, crossed and
 * arrived at exactly one speed, so nothing in the motion said where the interesting moment was.
 * Eased, a packet leans out of the source, coasts, and settles into the device — which puts the
 * emphasis on the ENDS of each leg, and the ends are where the decisions happen.
 */
export function ease(k: number): number {
  const v = k < 0 ? 0 : k > 1 ? 1 : k;
  return v < 0.5 ? 2 * v * v : 1 - ((-2 * v + 2) ** 2) / 2;
}

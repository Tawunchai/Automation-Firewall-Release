import { describe, expect, it } from "vitest";
import {
  SIM_LAYOUT, SIM_LAYOUT_COMPACT, SIM_LAYOUT_PANEL, charsFor, chassisBox, entryPath, ingressPath,
  layoutMinimap, layoutRows, outboundPath, railPath, simLayout, totalHeight,
} from "./packetSimLayout";
import type { SimRow } from "./packetSim";

// Geometry is arithmetic, and arithmetic is where a diagram goes wrong invisibly: a row that
// overlaps the one above it, a minimap whose bars add up to more than the table, columns that add
// up to more than the drawing and force a horizontal scrollbar. None of that shows up in a type
// error and all of it shows up on somebody's screen.

const rule = (over: Partial<Extract<SimRow, { kind: "rule" }>> = {}): SimRow => ({
  kind: "rule", key: `r${Math.random()}`, id: 1, name: "r", shown: 1,
  srcIntf: [], dstIntf: [], srcAddr: ["all"], dstAddr: ["all"], service: ["ALL"],
  action: "accept", nat: false, profiles: [], enabled: true, isNew: false,
  state: "survives", note: "", ...over,
});
const band = (count: number): SimRow => ({ kind: "band", count, why: "srcintf dmz ≠ internal" });

// The widths the three real callers report: the chat bubble, the right-hand panel, full screen.
const WIDTHS = [420, 560, 700, 900, 1180, 1600];

describe("simLayout", () => {
  it("never lets the columns add up to more than the drawing", () => {
    for (const w of WIDTHS) {
      for (const mode of ["compact", "panel", "wide"] as const) {
        const o = simLayout(w, mode);
        expect(o.outX + o.outW, `${mode} @ ${w}`).toBeLessThanOrEqual(o.width);
      }
    }
  });

  it("orders the columns left to right, never overlapping", () => {
    for (const w of WIDTHS) {
      const o = simLayout(w, "wide");
      if (o.mapW) expect(o.mapX + o.mapW).toBeLessThan(o.srcX);
      expect(o.srcX + o.srcW).toBeLessThanOrEqual(o.chassisX);
      expect(o.chassisX).toBeLessThan(o.railX);
      expect(o.railX).toBeLessThan(o.rungX);
      expect(o.rungX + o.rungW).toBeLessThanOrEqual(o.chassisX + o.chassisW);
      expect(o.chassisX + o.chassisW).toBeLessThan(o.outX);
    }
  });

  it("puts the rail and the whole rule table inside the chassis walls", () => {
    // The device is not decoration: a packet is inside it while it is being evaluated, and a rule
    // drawn outside the walls would say the opposite.
    for (const w of WIDTHS) {
      const o = simLayout(w, "wide");
      expect(o.railX).toBeGreaterThan(o.chassisX);
      expect(o.rungX + o.rungW).toBeLessThanOrEqual(o.chassisX + o.chassisW);
    }
  });

  it("leaves room on the outbound wire for the NAT pill", () => {
    for (const w of WIDTHS) {
      const o = simLayout(w, "wide");
      expect(o.outX - (o.chassisX + o.chassisW)).toBeGreaterThanOrEqual(46);
    }
  });

  it("gives the rule table the room first, and drops the minimap before the table", () => {
    const wide = simLayout(1180, "wide");
    expect(wide.mapW).toBeGreaterThan(0);

    const tiny = simLayout(380, "panel");
    expect(tiny.mapW).toBe(0);
    expect(tiny.rungW).toBeGreaterThanOrEqual(170);
  });

  it("gives the rule table more room as the drawing grows", () => {
    let prev = 0;
    for (const w of [560, 700, 900, 1180, 1600]) {
      const o = simLayout(w, "wide");
      expect(o.rungW).toBeGreaterThan(prev);
      prev = o.rungW;
    }
  });

  it("keeps the chat bubble denser than the panel, and the panel denser than full screen", () => {
    expect(SIM_LAYOUT_COMPACT.ruleH).toBeLessThan(SIM_LAYOUT_PANEL.ruleH);
    expect(SIM_LAYOUT_PANEL.ruleH).toBeLessThan(SIM_LAYOUT.ruleH);
    // The chat bubble has no room for the whole-table minimap.
    expect(SIM_LAYOUT_COMPACT.mapW).toBe(0);
  });

  it("refuses to lay out something narrower than a phone", () => {
    expect(simLayout(40, "panel").width).toBeGreaterThanOrEqual(320);
  });
});

describe("charsFor", () => {
  it("scales the label budget with the column and the type size", () => {
    expect(charsFor(200, 10)).toBeGreaterThan(charsFor(100, 10));
    expect(charsFor(200, 8)).toBeGreaterThan(charsFor(200, 12));
  });

  it("never returns a budget so small the label becomes one ellipsis", () => {
    expect(charsFor(1, 12)).toBeGreaterThanOrEqual(4);
  });
});

describe("layoutRows", () => {
  it("stacks rows without overlap and gives a rule more room than a band", () => {
    const rows = [band(9), rule(), rule(), band(30)];
    const placed = layoutRows(rows, SIM_LAYOUT);
    expect(placed[0].h).toBe(SIM_LAYOUT.bandH);
    expect(placed[1].h).toBe(SIM_LAYOUT.ruleH);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].y).toBeGreaterThanOrEqual(placed[i - 1].y + placed[i - 1].h);
    }
  });

  it("puts both text baselines inside the row", () => {
    const [box] = layoutRows([rule()], SIM_LAYOUT);
    expect(box.line1).toBeGreaterThan(box.y);
    expect(box.line2).toBeGreaterThan(box.line1);
    expect(box.line2).toBeLessThan(box.y + box.h);
  });

  it("sizes the drawing to the rows it actually holds", () => {
    const placed = layoutRows(Array.from({ length: 14 }, () => rule()), SIM_LAYOUT);
    const many = totalHeight(placed, SIM_LAYOUT);
    const few = totalHeight(layoutRows([rule(), rule()], SIM_LAYOUT), SIM_LAYOUT);
    expect(many).toBeGreaterThan(few);
    // A 14-row table must not be cropped by the viewBox.
    expect(many).toBeGreaterThan(placed[13].y + placed[13].h);
  });
});

describe("chassisBox", () => {
  const placed = layoutRows([rule(), band(4), rule()], SIM_LAYOUT);
  const box = chassisBox(placed, SIM_LAYOUT);

  it("wraps every row, with the header above the first one", () => {
    expect(box.y).toBeLessThan(placed[0].y);
    expect(box.y + SIM_LAYOUT.chassisHeadH).toBeLessThanOrEqual(placed[0].y);
    const last = placed[placed.length - 1];
    expect(box.y + box.h).toBeGreaterThan(last.y + last.h);
  });

  it("is inside the drawing", () => {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(SIM_LAYOUT.width);
    expect(totalHeight(placed, SIM_LAYOUT)).toBeGreaterThan(box.y + box.h);
  });
});

describe("paths", () => {
  it("starts the ingress curve at the source and ends it on the chassis wall", () => {
    const d = ingressPath(SIM_LAYOUT, 100, 140);
    expect(d.startsWith(`M ${SIM_LAYOUT.srcX + SIM_LAYOUT.srcW} 100`)).toBe(true);
    expect(d.endsWith(`${SIM_LAYOUT.chassisX} 140`)).toBe(true);
  });

  it("draws the rail as one vertical line down the table", () => {
    expect(railPath(SIM_LAYOUT, 60, 400)).toBe(`M ${SIM_LAYOUT.railX} 60 L ${SIM_LAYOUT.railX} 400`);
  });

  it("carries a flow out of the chassis wall and on to the destination", () => {
    const d = outboundPath(SIM_LAYOUT, 200, 260);
    expect(d.startsWith(`M ${SIM_LAYOUT.rungX + SIM_LAYOUT.rungW} 200`)).toBe(true);
    // Through the wall, then a curve to the shared egress height.
    expect(d).toContain(`L ${SIM_LAYOUT.chassisX + SIM_LAYOUT.chassisW - 2} 200`);
    expect(d.endsWith(`${SIM_LAYOUT.outX} 260`)).toBe(true);
  });

  it("takes the packet in through the wall before it reaches the rail", () => {
    const d = entryPath(SIM_LAYOUT, 120, 160);
    expect(d.startsWith(`M ${SIM_LAYOUT.chassisX} 120`)).toBe(true);
    expect(d).toContain(`L ${SIM_LAYOUT.railX} 120`);
    expect(d.endsWith(`${SIM_LAYOUT.railX} 160`)).toBe(true);
  });
});

describe("layoutMinimap", () => {
  const rows = [band(10), rule(), rule({ isNew: true }), rule({ state: "dead" }), band(39), rule({ key: "implicit" })];

  it("counts the whole table, not just the rows on screen", () => {
    // 10 + 3 + 39 = 52. The implicit deny is not a policy and must not inflate it.
    const { total } = layoutMinimap(rows, SIM_LAYOUT, 600);
    expect(total).toBe(52);
  });

  it("keeps every bar inside the drawing", () => {
    const height = 600;
    const { bars } = layoutMinimap(rows, SIM_LAYOUT, height);
    for (const b of bars) {
      expect(b.y).toBeGreaterThanOrEqual(SIM_LAYOUT.top);
      expect(b.y + b.h).toBeLessThanOrEqual(height - 17);
    }
  });

  it("brackets exactly the rules the walk expands", () => {
    const { bars, windowY, windowH } = layoutMinimap(rows, SIM_LAYOUT, 600);
    const ruleBars = bars.filter((b) => b.kind === "rule");
    expect(windowY).toBeCloseTo(ruleBars[0].y, 5);
    const lastRule = ruleBars[ruleBars.length - 1];
    expect(windowY + windowH).toBeCloseTo(lastRule.y + lastRule.h, 5);
  });

  it("does not divide by zero on an empty table", () => {
    const { bars, total } = layoutMinimap([], SIM_LAYOUT, 400);
    expect(total).toBe(0);
    expect(bars).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { toRate } from "./hitRate";

// The device reports a policy's hit count as a total since boot, so the raw series only ever climbs
// and every rule looks the same: a line going up. What a reader wants is hits per interval, which is
// the difference between consecutive samples — and the difference is where this can go quietly
// wrong, because nothing about a wrong answer looks wrong on a chart.

describe("toRate", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 8, 16, 0, n * 5)).toISOString();

  it("turns a climbing counter into per-interval hits", () => {
    const got = toRate([
      { at: at(0), value: 100 },
      { at: at(1), value: 140 },
      { at: at(2), value: 145 },
    ]);
    expect(got).toEqual([
      { at: at(1), value: 40 },
      { at: at(2), value: 5 },
    ]);
  });

  it("has one fewer point than it was given — the first sample has nothing to subtract from", () => {
    const pts = [1, 2, 3, 4].map((v, i) => ({ at: at(i), value: v }));
    expect(toRate(pts)).toHaveLength(3);
  });

  it("drops a reboot instead of plotting a negative or clamping it to zero", () => {
    // The counter resets on reboot. The difference is then negative, and it is neither "minus four
    // thousand hits" nor "zero hits": it is a boundary where the old total is gone. Dropping it
    // leaves a gap, which is honest; a zero would read as "quiet at this moment" when the truth is
    // "unknown across this moment".
    const got = toRate([
      { at: at(0), value: 4000 },
      { at: at(1), value: 12 },   // rebooted
      { at: at(2), value: 30 },
    ]);
    expect(got).toEqual([{ at: at(2), value: 18 }]);
    expect(got.every((p) => p.value >= 0)).toBe(true);
  });

  it("reports zero for a rule that matched nothing, rather than dropping it", () => {
    // A rule with no traffic is a real answer and the one this page exists to surface. It must
    // still draw a line along the bottom, not vanish from the chart.
    const got = toRate([
      { at: at(0), value: 7 },
      { at: at(1), value: 7 },
      { at: at(2), value: 7 },
    ]);
    expect(got).toEqual([
      { at: at(1), value: 0 },
      { at: at(2), value: 0 },
    ]);
  });

  it("returns nothing when there is not enough to compare", () => {
    expect(toRate([])).toEqual([]);
    expect(toRate([{ at: at(0), value: 5 }])).toEqual([]);
  });
});

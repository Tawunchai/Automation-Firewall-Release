import { describe, expect, it } from "vitest";
import { axisMode, mergeSeriesRows, seriesKey } from "./historyRows";

// The bug this file exists to prevent: a recharts dataKey is a PATH. Keying a column by the series
// label meant a VLAN interface ("port1.100") or any other dotted name was looked up as a nested
// object, found nothing, and drew an empty chart with no error anywhere.

describe("mergeSeriesRows", () => {
  it("keys columns positionally, so a dotted label still gets a column", () => {
    const rows = mergeSeriesRows([
      { label: "port1.100", points: [{ at: "2026-09-17T00:00:00Z", value: 12 }] },
    ]);
    expect(rows).toEqual([{ at: "2026-09-17T00:00:00Z", s0: 12 }]);
    // The value is reachable by a flat key — which is what recharts will ask for.
    expect(rows[0][seriesKey(0)]).toBe(12);
  });

  it("keeps two series apart even when they share a label", () => {
    const rows = mergeSeriesRows([
      { label: "wan1", points: [{ at: "2026-09-17T00:00:00Z", value: 1 }] },
      { label: "wan1", points: [{ at: "2026-09-17T00:00:00Z", value: 2 }] },
    ]);
    expect(rows[0].s0).toBe(1);
    expect(rows[0].s1).toBe(2);
  });

  it("leaves a missing sample ABSENT rather than zero", () => {
    const rows = mergeSeriesRows([
      { label: "a", points: [{ at: "2026-09-17T00:00:00Z", value: 5 }, { at: "2026-09-17T00:10:00Z", value: 7 }] },
      { label: "b", points: [{ at: "2026-09-17T00:00:00Z", value: 9 }] },
    ]);
    expect(rows).toHaveLength(2);
    // A gap in sampling must not draw a line down to the floor and back up.
    expect("s1" in rows[1]).toBe(false);
  });

  it("sorts by timestamp whatever order the series arrive in", () => {
    const rows = mergeSeriesRows([
      { label: "a", points: [{ at: "2026-09-17T02:00:00Z", value: 1 }, { at: "2026-09-17T01:00:00Z", value: 2 }] },
    ]);
    expect(rows.map((r) => r.at)).toEqual(["2026-09-17T01:00:00Z", "2026-09-17T02:00:00Z"]);
  });

  it("survives an empty series list", () => {
    expect(mergeSeriesRows([])).toEqual([]);
  });
});

describe("axisMode", () => {
  // Timestamps are built in LOCAL time on purpose: what the axis has to decide is whether the
  // reader crossed a midnight, and midnight is local.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).toISOString();
  const window_ = (a: string, b: string) =>
    mergeSeriesRows([{ label: "a", points: [{ at: a, value: 1 }, { at: b, value: 1 }] }]);

  it("shows a clock time within one day", () => {
    expect(axisMode(window_(at(17, 0), at(17, 23)))).toBe("time");
  });

  it("adds the date once the window crosses midnight, even if it is short", () => {
    // THE BUG: samples either side of an overnight gap rendered as "05:19 PM … 10:47 AM", which
    // reads as a chart with its points shuffled. Nineteen hours, two calendar days.
    expect(axisMode(window_(at(16, 17, 19), at(17, 12, 1)))).toBe("dayTime");
  });

  it("drops the time once the window is long enough for it to be noise", () => {
    expect(axisMode(window_(at(10, 0), at(17, 0)))).toBe("day");
  });

  it("says something harmless when there is nothing to span", () => {
    expect(axisMode([])).toBe("time");
  });
});

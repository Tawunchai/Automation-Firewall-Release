import { describe, expect, it } from "vitest";
import { BUCKET_FOR_WINDOW, bucketForWindow, bucketSeries } from "./bucket";

const HOUR = 3600_000;
const at = (iso: string) => iso;

describe("bucketSeries", () => {
  it("sums the samples inside each bucket", () => {
    // Per-interval deltas: "hits this hour" really is the sum of the five-minute counts in it.
    const out = bucketSeries([
      { at: at("2026-01-01T00:05:00.000Z"), value: 3 },
      { at: at("2026-01-01T00:35:00.000Z"), value: 4 },
      { at: at("2026-01-01T01:05:00.000Z"), value: 10 },
    ], HOUR);
    expect(out).toEqual([
      { at: "2026-01-01T00:00:00.000Z", value: 7 },
      { at: "2026-01-01T01:00:00.000Z", value: 10 },
    ]);
  });

  it("floors to the bucket start, so the same hour is always the same column", () => {
    const [first] = bucketSeries([{ at: at("2026-01-01T13:59:59.000Z"), value: 1 }], HOUR);
    expect(first.at).toBe("2026-01-01T13:00:00.000Z");
  });

  it("omits an empty bucket instead of emitting zero", () => {
    // Zero means the firewall reported no matches. A gap means nothing was sampled — usually the
    // console was down. Drawing the second as the first invents a quiet hour nobody observed.
    const out = bucketSeries([
      { at: at("2026-01-01T00:10:00.000Z"), value: 5 },
      { at: at("2026-01-01T03:10:00.000Z"), value: 6 },
    ], HOUR);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.at)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
    ]);
  });

  it("returns the points untouched when there is nothing to bucket", () => {
    expect(bucketSeries([], HOUR)).toEqual([]);
    const pts = [{ at: at("2026-01-01T00:00:00.000Z"), value: 1 }];
    expect(bucketSeries(pts, 0)).toBe(pts);
  });

  it("drops a sample with an unparseable timestamp rather than bucketing it at the epoch", () => {
    const out = bucketSeries([
      { at: "not-a-date", value: 99 },
      { at: at("2026-01-01T00:10:00.000Z"), value: 5 },
    ], HOUR);
    expect(out).toEqual([{ at: "2026-01-01T00:00:00.000Z", value: 5 }]);
  });

  it("keeps the output in time order whatever order the input arrived in", () => {
    const out = bucketSeries([
      { at: at("2026-01-01T05:00:00.000Z"), value: 1 },
      { at: at("2026-01-01T02:00:00.000Z"), value: 2 },
    ], HOUR);
    expect(out.map((p) => p.at)).toEqual([
      "2026-01-01T02:00:00.000Z",
      "2026-01-01T05:00:00.000Z",
    ]);
  });
});

describe("bucketForWindow", () => {
  it("lands every window between 7 and 24 columns", () => {
    // Below 7 the chart wastes its width; above 24 the bars inside a group get thinner than the
    // gap between groups and the grouping stops reading.
    const hours: Record<string, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90 };
    for (const [key, span] of Object.entries(hours)) {
      const columns = (span * HOUR) / BUCKET_FOR_WINDOW[key];
      expect(columns, `${key} produces ${columns} columns`).toBeGreaterThanOrEqual(7);
      expect(columns, `${key} produces ${columns} columns`).toBeLessThanOrEqual(24);
    }
  });

  it("falls back to hourly for a window it does not know", () => {
    expect(bucketForWindow("made-up")).toBe(HOUR);
  });
});

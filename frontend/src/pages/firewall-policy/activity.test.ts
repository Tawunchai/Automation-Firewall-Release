import { describe, expect, it } from "vitest";
import type { MetricSeries } from "../../api/metrics";
import { activityLabel, compactHits, summarisePolicyActivity } from "./activity";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 17, 0, minute)).toISOString();

const hits = (subject: string, totals: number[]): MetricSeries => ({
  kind: "policy_hits",
  subject,
  points: totals.map((value, i) => ({ at: at(i * 5), value })),
});

describe("summarisePolicyActivity", () => {
  it("reads the cumulative counter as traffic in the window, not as the device's running total", () => {
    // The device has counted 1,000 hits since boot; 30 of them happened in this window.
    const map = summarisePolicyActivity([hits("3", [1000, 1010, 1020, 1030])]);
    const a = map.get(3)!;
    expect(a.total).toBe(30);
    expect(a.rate).toEqual([10, 10, 10]);
  });

  it("drops the reboot boundary rather than charting a negative or a zero", () => {
    // A zero there would read as "quiet at this moment"; the truth is "unknown across this moment".
    const map = summarisePolicyActivity([hits("1", [900, 950, 20, 40])]);
    expect(map.get(1)!.rate).toEqual([50, 20]);
    expect(map.get(1)!.total).toBe(70);
  });

  it("separates 'measured and quiet' from 'not measured'", () => {
    const map = summarisePolicyActivity([hits("7", [500, 500, 500])]);
    const quiet = map.get(7)!;
    expect(quiet.samples).toBe(3);
    expect(quiet.total).toBe(0);
    expect(quiet.lastHitAt).toBeNull();
    // A rule nobody sampled is simply absent, and the column says so differently.
    expect(map.get(99)).toBeUndefined();
  });

  it("remembers when the traffic last stopped", () => {
    const map = summarisePolicyActivity([hits("2", [0, 5, 5, 5])]);
    // The one delta with hits lands on the sample that closed it.
    expect(map.get(2)!.lastHitAt).toBe(at(5));
  });

  it("ignores a subject that is not a policy id", () => {
    const map = summarisePolicyActivity([
      { kind: "policy_hits", subject: "wan1", points: [{ at: at(0), value: 1 }] },
      { kind: "policy_hits", subject: "", points: [{ at: at(0), value: 1 }] },
    ]);
    expect(map.size).toBe(0);
  });

  it("survives a series with a single sample, which has no delta at all", () => {
    const map = summarisePolicyActivity([hits("4", [10])]);
    expect(map.get(4)!).toMatchObject({ rate: [], total: 0, samples: 1 });
  });
});

describe("what the column says", () => {
  it("keeps the three states as three different sentences", () => {
    const measured = summarisePolicyActivity([hits("1", [0, 1200])]).get(1);
    const quiet = summarisePolicyActivity([hits("2", [3, 3])]).get(2);
    expect(activityLabel(undefined)).toMatch(/No samples/);
    expect(activityLabel(quiet)).toMatch(/No traffic matched/);
    expect(activityLabel(measured)).toBe("1.2k hits in the last 24 hours");
  });
});

describe("compactHits", () => {
  it("shortens only what is long enough to be noise", () => {
    expect(compactHits(0)).toBe("0");
    expect(compactHits(999)).toBe("999");
    expect(compactHits(1000)).toBe("1.0k");
    expect(compactHits(12_400)).toBe("12.4k");
    expect(compactHits(3_000_000)).toBe("3.0M");
  });
});

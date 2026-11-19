import { describe, expect, it } from "vitest";
import type { DriftAnalytics } from "../../api/drift";
import { busiestDay, compact, dayLabel, errorText, isQuietWindow, outsideShare, tickInterval } from "./analytics";

const analytics = (over: Partial<DriftAnalytics["totals"]> = {}): DriftAnalytics => ({
  days: 7,
  from: "2026-09-04T00:00:00+07:00",
  totals: { console: 0, failed: 0, reverted: 0, outside: 0, runs: 0, drift_runs: 0, ...over },
  daily: [],
  tables: [],
});

describe("dayLabel", () => {
  it("shows the server's day exactly, with no timezone shift", () => {
    // new Date("2026-09-01") would be Aug 31 anywhere west of UTC.
    expect(dayLabel("2026-09-01")).toBe("Sep 1");
    expect(dayLabel("2026-12-31")).toBe("Dec 31");
  });

  it("passes through anything that is not a date rather than inventing one", () => {
    expect(dayLabel("not-a-date")).toBe("not-a-date");
    expect(dayLabel("2026-13-01")).toBe("2026-13-01");
  });
});

describe("tickInterval", () => {
  it("labels every day of a short window", () => {
    expect(tickInterval(7)).toBe(0);
  });

  it("keeps a long window to about eight labels", () => {
    for (const days of [30, 90]) {
      const every = tickInterval(days) + 1;
      expect(Math.ceil(days / every)).toBeLessThanOrEqual(8);
    }
  });
});

describe("outsideShare", () => {
  it("is null, not 0%, when nothing changed — a quiet window is not a clean bill", () => {
    expect(outsideShare(analytics())).toBeNull();
    expect(outsideShare(null)).toBeNull();
  });

  it("is the unaccounted share of everything that changed", () => {
    expect(outsideShare(analytics({ console: 3, outside: 1 }))).toBe(25);
    expect(outsideShare(analytics({ console: 0, outside: 4 }))).toBe(100);
  });

  it("leaves rejected writes out — they never changed the device", () => {
    expect(outsideShare(analytics({ console: 1, outside: 1, failed: 50 }))).toBe(50);
  });
});

describe("isQuietWindow", () => {
  it("counts a window of only failed writes as activity worth charting", () => {
    expect(isQuietWindow(analytics())).toBe(true);
    expect(isQuietWindow(analytics({ failed: 1 }))).toBe(false);
  });
});

describe("busiestDay", () => {
  const daily = [
    { date: "2026-09-01", console: 1, failed: 0, outside: 0 },
    { date: "2026-09-02", console: 4, failed: 0, outside: 2 },
    { date: "2026-09-03", console: 4, failed: 0, outside: 5 },
  ];

  it("names the first day with the peak value", () => {
    expect(busiestDay(daily, "console")?.date).toBe("2026-09-02");
    expect(busiestDay(daily, "outside")?.date).toBe("2026-09-03");
  });

  it("has no busiest day when the series is all zero", () => {
    expect(busiestDay(daily.map((d) => ({ ...d, outside: 0 })), "outside")).toBeNull();
  });
});

describe("compact", () => {
  it("abbreviates thousands without trailing .0", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1000)).toBe("1K");
    expect(compact(1250)).toBe("1.3K");
    expect(compact(12_400)).toBe("12K");
  });
});

describe("errorText", () => {
  it("prefers the server's own message", () => {
    expect(errorText({ response: { data: { error: "admin only" } } }, "fallback")).toBe("admin only");
  });

  it("falls back when the failure carried no usable message", () => {
    expect(errorText(new Error("Network Error"), "Could not load")).toBe("Could not load");
    expect(errorText({ response: { data: { error: "" } } }, "Could not load")).toBe("Could not load");
    expect(errorText(null, "Could not load")).toBe("Could not load");
  });
});

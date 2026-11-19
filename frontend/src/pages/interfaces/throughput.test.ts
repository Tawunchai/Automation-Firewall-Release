import { describe, expect, it } from "vitest";
import type { MetricSeries } from "../../api/metrics";
import {
  formatBitsPerSecond, formatBytes, summariseThroughput, toBitsPerSecond,
} from "./throughput";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 17, 0, minute)).toISOString();

const counter = (kind: "if_rx_bytes" | "if_tx_bytes", subject: string, totals: number[],
  spacingMin = 5): MetricSeries => ({
  kind,
  subject,
  points: totals.map((value, i) => ({ at: at(i * spacingMin), value })),
});

describe("toBitsPerSecond", () => {
  it("measures the elapsed time instead of assuming the sampling interval", () => {
    // 300 seconds apart, 37,500 bytes → 1,000 bps.
    const rate = toBitsPerSecond([
      { at: at(0), value: 0 },
      { at: at(5), value: 37_500 },
    ]);
    expect(rate).toEqual([{ at: at(5), value: 1000 }]);
  });

  it("halves the rate when a sweep was missed, rather than doubling it", () => {
    // The same bytes over ten minutes is half the throughput. Dividing by a nominal five minutes
    // would report a link twice as busy as it was, exactly when the console was struggling.
    const rate = toBitsPerSecond([
      { at: at(0), value: 0 },
      { at: at(10), value: 37_500 },
    ]);
    expect(rate[0].value).toBe(500);
  });

  it("drops a counter reset instead of charting a spike or a false idle", () => {
    const rate = toBitsPerSecond([
      { at: at(0), value: 1_000_000 },
      { at: at(5), value: 12 },       // the interface bounced
      { at: at(10), value: 37_512 },
    ]);
    expect(rate).toHaveLength(1);
    expect(rate[0].at).toBe(at(10));
    expect(rate[0].value).toBe(1000);
  });

  it("refuses to divide by a zero gap", () => {
    expect(toBitsPerSecond([
      { at: at(0), value: 0 },
      { at: at(0), value: 500 },
    ])).toEqual([]);
  });

  it("needs two readings before it can say anything", () => {
    expect(toBitsPerSecond([{ at: at(0), value: 5 }])).toEqual([]);
    expect(toBitsPerSecond([])).toEqual([]);
  });
});

describe("summariseThroughput", () => {
  it("pairs each interface's two counters and reports peak and volume", () => {
    const rows = summariseThroughput([
      counter("if_rx_bytes", "wan1", [0, 37_500, 75_000]),
      counter("if_tx_bytes", "wan1", [0, 375_000, 375_000]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("wan1");
    expect(rows[0].rx).toHaveLength(2);
    expect(rows[0].peakBps).toBe(10_000); // the transmit burst, not the receive average
    expect(rows[0].totalBytes).toBe(75_000 + 375_000);
  });

  it("ranks by volume, so one burst does not make an idle port the busiest", () => {
    const rows = summariseThroughput([
      // A single large jump, then nothing.
      counter("if_rx_bytes", "spiky", [0, 1_000_000, 1_000_000, 1_000_000]),
      // Steady, and more in total.
      counter("if_rx_bytes", "steady", [0, 600_000, 1_200_000, 1_800_000]),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["steady", "spiky"]);
    expect(rows[1].peakBps).toBeGreaterThan(rows[0].peakBps);
  });

  it("handles an interface that reported only one direction", () => {
    const rows = summariseThroughput([counter("if_rx_bytes", "port3", [0, 37_500])]);
    expect(rows[0].tx).toEqual([]);
    expect(rows[0].rx).toHaveLength(1);
  });

  it("ignores kinds that are not interface counters", () => {
    expect(summariseThroughput([
      { kind: "cpu_pct", subject: "", points: [{ at: at(0), value: 40 }] },
    ])).toEqual([]);
  });
});

describe("the units", () => {
  it("writes a rate the way a link is described", () => {
    expect(formatBitsPerSecond(0)).toBe("0 bps");
    expect(formatBitsPerSecond(940)).toBe("940 bps");
    expect(formatBitsPerSecond(12_300)).toBe("12.3 kbps");
    expect(formatBitsPerSecond(340_000_000)).toBe("340 Mbps");
    expect(formatBitsPerSecond(1_200_000_000)).toBe("1.2 Gbps");
  });

  it("writes a volume the way an allowance is written", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

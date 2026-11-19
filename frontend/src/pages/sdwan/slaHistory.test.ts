import { describe, expect, it } from "vitest";
import type { MetricSeries } from "../../api/metrics";
import type { SDWANHealthCheck, SDWANSLARow } from "../../api/sdwan";
import {
  METRIC_KIND, defaultSelection, metricUnit, sharedThreshold, splitSubject, summariseSLAHistory,
  thresholdFor,
} from "./slaHistory";

const slaRow = (over: Partial<SDWANSLARow>): SDWANSLARow => ({
  id: 1,
  link_cost_factor: ["latency"],
  latency_threshold: 100,
  jitter_threshold: 20,
  packetloss_threshold: 2,
  mos_threshold: "3.6",
  ...over,
});

const check = (name: string, sla: SDWANSLARow[]): SDWANHealthCheck => ({
  name,
  detect_mode: "active",
  protocol: "ping",
  servers: ["8.8.8.8"],
  system_dns: false,
  port: 0,
  members: [],
  member_names: [],
  sla,
  interval: 500,
  probe_timeout: 500,
  failtime: 5,
  recoverytime: 5,
  update_static_route: true,
  update_cascade_interface: false,
});

const series = (subject: string, values: number[]): MetricSeries => ({
  kind: "sla_latency_ms",
  subject,
  points: values.map((value, i) => ({
    at: new Date(Date.UTC(2026, 8, 17, 0, i * 5)).toISOString(),
    value,
  })),
});

describe("splitSubject", () => {
  it("splits at the last slash, because a check name may contain one and an interface may not", () => {
    expect(splitSubject("ISP-Health/wan1")).toEqual({ check: "ISP-Health", member: "wan1" });
    expect(splitSubject("Default_Google Search/port1.100"))
      .toEqual({ check: "Default_Google Search", member: "port1.100" });
    expect(splitSubject("a/b/wan2")).toEqual({ check: "a/b", member: "wan2" });
  });

  it("treats a subject with no slash as a bare member rather than throwing it away", () => {
    expect(splitSubject("wan1")).toEqual({ check: "", member: "wan1" });
  });
});

describe("thresholdFor", () => {
  it("ignores a threshold whose criterion the check does not select on", () => {
    // The device RESETS latency-threshold to its default 5 when "latency" leaves link_cost_factor,
    // so reading it regardless would draw a limit nobody set.
    const checks = [check("C", [slaRow({ link_cost_factor: ["packet-loss"] })])];
    expect(thresholdFor(checks, "C", "latency")).toBeNull();
    expect(thresholdFor(checks, "C", "packet-loss")).toBe(2);
  });

  it("takes the strictest of several SLA targets — the first one a member falls out of", () => {
    const checks = [check("C", [
      slaRow({ id: 1, latency_threshold: 250 }),
      slaRow({ id: 2, latency_threshold: 80 }),
    ])];
    expect(thresholdFor(checks, "C", "latency")).toBe(80);
  });

  it("keeps a zero threshold, which is a real target and not a missing one", () => {
    const checks = [check("C", [
      slaRow({ link_cost_factor: ["packet-loss"], packetloss_threshold: 0 }),
    ])];
    expect(thresholdFor(checks, "C", "packet-loss")).toBe(0);
  });

  it("is null for a check that is not there at all", () => {
    expect(thresholdFor([], "gone", "latency")).toBeNull();
  });
});

describe("summariseSLAHistory", () => {
  const checks = [
    check("ISP", [slaRow({ latency_threshold: 100 })]),
    check("NoLimit", [slaRow({ link_cost_factor: [] })]),
  ];

  it("reports the average, the worst sample and the share past the limit", () => {
    const rows = summariseSLAHistory([series("ISP/wan1", [50, 150, 50, 50])], checks, "latency");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ check: "ISP", member: "wan1", samples: 4, threshold: 100 });
    expect(rows[0].avg).toBe(75);
    expect(rows[0].worst).toBe(150);
    expect(rows[0].breachPct).toBe(25);
  });

  it("ranks by breach share before average — a failed SLA outranks a merely slow link", () => {
    const rows = summariseSLAHistory([
      // Averages 90: never over the limit, but higher than the one that breached.
      series("ISP/slow", [90, 90, 90, 90]),
      // Averages 55, yet a quarter of the window was out of SLA.
      series("ISP/flappy", [40, 40, 40, 200]),
    ], checks, "latency");
    expect(rows.map((r) => r.member)).toEqual(["flappy", "slow"]);
  });

  it("leaves a member with no threshold unjudged, and sorts it below anything that breached", () => {
    const rows = summariseSLAHistory([
      series("NoLimit/wan2", [400, 400]),
      series("ISP/wan1", [10, 200]),
    ], checks, "latency");
    expect(rows[0].member).toBe("wan1");
    expect(rows[0].breachPct).toBe(50);
    expect(rows[1].member).toBe("wan2");
    expect(rows[1].breachPct).toBeNull();
    // Not judged is not the same as fine: the numbers are still reported.
    expect(rows[1].avg).toBe(400);
  });

  it("says nothing rather than zero when a member has no samples", () => {
    const rows = summariseSLAHistory([{ kind: "sla_latency_ms", subject: "ISP/wan1", points: [] }],
      checks, "latency");
    expect(rows[0].avg).toBeNull();
    expect(rows[0].worst).toBeNull();
    expect(rows[0].breachPct).toBeNull();
  });

  it("counts only samples strictly over the limit — sitting exactly on it is in SLA", () => {
    const rows = summariseSLAHistory([series("ISP/wan1", [100, 100, 101])], checks, "latency");
    expect(rows[0].breachPct).toBeCloseTo(33.33, 1);
  });
});

describe("the chart's selection", () => {
  const rows = summariseSLAHistory(
    ["a", "b", "c", "d", "e"].map((n) => series(`ISP/${n}`, [10])),
    [check("ISP", [slaRow({ latency_threshold: 100 })])], "latency",
  );

  it("offers at most four lines, because the palette is four colours and does not cycle", () => {
    expect(defaultSelection(rows)).toHaveLength(4);
  });

  it("draws the SLA line only when every plotted member is judged against the same number", () => {
    const mixed = summariseSLAHistory([series("ISP/wan1", [10]), series("OTHER/wan2", [10])], [
      check("ISP", [slaRow({ latency_threshold: 100 })]),
      check("OTHER", [slaRow({ latency_threshold: 250 })]),
    ], "latency");
    expect(sharedThreshold(mixed, ["ISP/wan1"])).toBe(100);
    expect(sharedThreshold(mixed, ["ISP/wan1", "OTHER/wan2"])).toBeNull();
    expect(sharedThreshold(mixed, [])).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("maps each of the FortiGate's three measurements to the kind that stores it", () => {
    expect(METRIC_KIND).toEqual({
      latency: "sla_latency_ms",
      jitter: "sla_jitter_ms",
      "packet-loss": "sla_loss_pct",
    });
  });

  it("knows which one is a percentage", () => {
    expect(metricUnit("packet-loss")).toBe("%");
    expect(metricUnit("latency")).toBe("ms");
    expect(metricUnit("jitter")).toBe("ms");
  });
});

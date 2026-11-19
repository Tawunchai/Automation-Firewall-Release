import { describe, it, expect } from "vitest";
import {
  diagnoseTrace, buildSegments, biggestJump, latencyPoints, hopAvg,
} from "./traceroute-model";
import type { TraceHop, HopGeoEntry } from "../../api/diagnostics";

const hop = (h: number, ip: string | undefined, rtts: number[], timeouts = 0): TraceHop =>
  ({ hop: h, ip, rtts, timeouts });

describe("diagnoseTrace", () => {
  it("returns nothing while the run is not finished", () => {
    expect(diagnoseTrace([hop(1, "10.0.0.1", [1])], "8.8.8.8", false)).toBeNull();
    expect(diagnoseTrace([], "8.8.8.8", true)).toBeNull();
  });

  it("says reached when the destination is on the path", () => {
    const hops = [hop(1, "10.0.0.1", [1]), hop(2, "8.8.8.8", [12, 13])];
    const v = diagnoseTrace(hops, "8.8.8.8", true)!;
    expect(v.tone).toBe("ok");
    expect(v.title).toContain("Reached 8.8.8.8");
    expect(v.title).toContain("2 hops");
    expect(v.detail).toContain("12.5 ms");
  });

  it("flags a total silence as danger", () => {
    const hops = [hop(1, undefined, []), hop(2, undefined, [])];
    const v = diagnoseTrace(hops, "8.8.8.8", true)!;
    expect(v.tone).toBe("danger");
    expect(v.title).toBe("No hop answered");
  });

  it("explains a trailing run of silent hops as a warning, not a fault", () => {
    const hops = [hop(1, "10.0.0.1", [1]), hop(2, "203.0.113.9", [10]), hop(3, undefined, []), hop(4, undefined, [])];
    const v = diagnoseTrace(hops, "8.8.8.8", true)!;
    expect(v.tone).toBe("warn");
    expect(v.title).toContain("hop 2");
    expect(v.detail).toContain("203.0.113.9");
    expect(v.detail).toContain("2 silent");
    expect(v.detail.toLowerCase()).toContain("ping tab");
  });
});

describe("buildSegments", () => {
  it("merges consecutive hops of the same address kind", () => {
    const hops = [hop(1, "192.168.1.1", [1]), hop(2, "10.0.0.1", [2]), hop(3, "8.8.8.8", [10])];
    const segs = buildSegments(hops, {});
    // private, private → one segment; then public
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: "private", fromHop: 1, toHop: 2, count: 2 });
    expect(segs[1]).toMatchObject({ kind: "public", fromHop: 3, toHop: 3, count: 1 });
  });

  it("groups public hops by AS owner when geo is present, across different IPs", () => {
    const geo: Record<string, HopGeoEntry> = {
      "203.0.113.1": { ip: "203.0.113.1", kind: "public", kind_label: "Public", geo: { asn: 15169, org: "Google LLC", country_code: "US" } },
      "203.0.113.2": { ip: "203.0.113.2", kind: "public", kind_label: "Public", geo: { asn: 15169, org: "Google LLC", country_code: "US" } },
      "198.51.100.9": { ip: "198.51.100.9", kind: "public", kind_label: "Public", geo: { asn: 2906, org: "Netflix", country_code: "US" } },
    };
    const hops = [hop(1, "203.0.113.1", [5]), hop(2, "203.0.113.2", [6]), hop(3, "198.51.100.9", [9])];
    const segs = buildSegments(hops, geo);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: "as", asn: 15169, count: 2, countryCode: "US" });
    expect(segs[0].label).toContain("AS15169");
    expect(segs[1]).toMatchObject({ kind: "as", asn: 2906, count: 1 });
  });

  it("makes a silent run its own zone", () => {
    const hops = [hop(1, "10.0.0.1", [1]), hop(2, undefined, []), hop(3, "8.8.8.8", [10])];
    const segs = buildSegments(hops, {});
    expect(segs.map((s) => s.kind)).toEqual(["private", "silent", "public"]);
    // the private-helper key must not leak out
    expect((segs[0] as Record<string, unknown>)._key).toBeUndefined();
  });
});

describe("biggestJump + latencyPoints", () => {
  it("finds the largest increase over the previous answering hop", () => {
    const hops = [hop(1, "a", [1]), hop(2, "b", [2]), hop(3, "c", [40]), hop(4, "d", [41])];
    const j = biggestJump(latencyPoints(hops))!;
    expect(j.index).toBe(2); // 2ms → 40ms
    expect(Math.round(j.delta)).toBe(38);
  });

  it("ignores sub-millisecond wobble and single points", () => {
    expect(biggestJump(latencyPoints([hop(1, "a", [10])]))).toBeNull();
    expect(biggestJump(latencyPoints([hop(1, "a", [10]), hop(2, "b", [10.4])]))).toBeNull();
  });

  it("hopAvg averages the probes that answered", () => {
    expect(hopAvg(hop(1, "a", [10, 20]))).toBe(15);
    expect(hopAvg(hop(1, undefined, []))).toBeNull();
  });
});

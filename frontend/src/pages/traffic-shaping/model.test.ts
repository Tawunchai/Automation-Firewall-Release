import { describe, expect, it } from "vitest";
import { describeShaper, validateShaper } from "./model";
import type { TrafficShaper } from "../../api/trafficShaper";

const shaper = (over: Partial<TrafficShaper> = {}): TrafficShaper => ({
  name: "s", guaranteed_bandwidth: 0, maximum_bandwidth: 1000,
  bandwidth_unit: "kbps", priority: "high", per_policy: false, diffserv: false, used_by: 0,
  ...over,
});

describe("validateShaper", () => {
  it("accepts an ordinary shaper", () => {
    expect(validateShaper(shaper())).toBeNull();
  });

  it("requires a name", () => {
    expect(validateShaper(shaper({ name: "  " }))).toContain("Name");
  });

  // ⚠️ 0 is UNLIMITED on FortiOS. A form whose entire purpose is to impose a limit should not
  // silently store "no limit".
  it("refuses a maximum of 0", () => {
    expect(validateShaper(shaper({ maximum_bandwidth: 0 }))).toContain("UNLIMITED");
  });

  it("refuses a floor above the ceiling", () => {
    expect(validateShaper(shaper({ guaranteed_bandwidth: 5000, maximum_bandwidth: 1000 })))
      .toContain("floor cannot be above the ceiling");
  });

  it("allows a floor equal to the ceiling — a fixed allocation", () => {
    expect(validateShaper(shaper({ guaranteed_bandwidth: 1000, maximum_bandwidth: 1000 }))).toBeNull();
  });
});

describe("describeShaper", () => {
  // ⚠️ The per-policy wording is the point: the same two numbers mean different things depending
  // on this one field, and a checkbox label does not carry that.
  it("says whether the allowance is shared", () => {
    expect(describeShaper(shaper({ per_policy: false }))).toContain("SHARED by every policy");
    expect(describeShaper(shaper({ per_policy: true }))).toContain("each policy gets its own");
  });

  it("mentions the floor only when there is one", () => {
    expect(describeShaper(shaper())).not.toContain("never below");
    expect(describeShaper(shaper({ guaranteed_bandwidth: 100 }))).toContain("never below 100 kbps");
  });

  it("carries the unit and the priority", () => {
    const d = describeShaper(shaper({ maximum_bandwidth: 50, bandwidth_unit: "mbps", priority: "low" }));
    expect(d).toContain("50 mbps");
    expect(d).toContain("low priority");
  });
});

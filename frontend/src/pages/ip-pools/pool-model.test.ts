import { describe, expect, it } from "vitest";
import { ipToNumber, rangeCount, poolSizes, describePool, validateDraft, type PoolDraft } from "./pool-model";
import type { IPPool } from "../../api/objectGroups";

// The IP pool arithmetic. Every case here is one FortiOS accepts with a 200 and then does not do.

const draft = (over: Partial<PoolDraft> = {}): PoolDraft => ({
  name: "p", type: "overload", startIp: "203.0.113.10", endIp: "203.0.113.20",
  sourceStartIp: "", sourceEndIp: "", blockSize: 128, numBlocksPerUser: 8,
  arpReply: true, arpInterface: "", associatedInterface: "", permitAnyHost: false, comments: "",
  ...over,
});

describe("ipToNumber", () => {
  it("parses a dotted quad", () => {
    expect(ipToNumber("0.0.0.0")).toBe(0);
    expect(ipToNumber("255.255.255.255")).toBe(4294967295);
    expect(ipToNumber(" 10.0.0.1 ")).toBe(167772161);
  });

  it("rejects everything that is not one", () => {
    // "256" and "1.2.3" both used to slip through a regex-free check and become NaN, which then
    // compared false against everything and silently disabled the range warnings.
    for (const bad of ["", "10.0.0", "10.0.0.1.5", "256.0.0.1", "10.0.0.-1", "abc", "10.0.0.a", "::1"]) {
      expect(ipToNumber(bad), bad).toBeNull();
    }
  });
});

describe("rangeCount", () => {
  it("is inclusive", () => {
    expect(rangeCount("10.0.0.1", "10.0.0.1")).toBe(1);
    expect(rangeCount("10.0.0.1", "10.0.0.10")).toBe(10);
  });

  it("is zero for a backwards or unparseable range", () => {
    expect(rangeCount("10.0.0.10", "10.0.0.1")).toBe(0);
    expect(rangeCount("nonsense", "10.0.0.1")).toBe(0);
  });
});

describe("poolSizes", () => {
  // ⚠️ The case the whole module exists for.
  it("refuses a fixed-port-range with more internal addresses than external", () => {
    const s = poolSizes(draft({
      type: "fixed-port-range",
      startIp: "203.0.113.10", endIp: "203.0.113.12",   // 3
      sourceStartIp: "10.0.0.1", sourceEndIp: "10.0.0.10", // 10
    }));
    expect(s.warning).toBeTruthy();
    expect(s.warning).toContain("7");   // 10 - 3 hosts left untranslated
  });

  it("accepts a fixed-port-range that fits", () => {
    const s = poolSizes(draft({
      type: "fixed-port-range",
      startIp: "203.0.113.10", endIp: "203.0.113.20",
      sourceStartIp: "10.0.0.1", sourceEndIp: "10.0.0.5",
    }));
    expect(s.warning).toBeNull();
    expect(s.summary).toContain("one-for-one");
  });

  it("refuses more ports per user than an address has", () => {
    const s = poolSizes(draft({ type: "port-block-allocation", blockSize: 4096, numBlocksPerUser: 32 }));
    expect(s.warning).toContain("64,512");
  });

  it("works out concurrent users for a sane port-block pool", () => {
    const s = poolSizes(draft({
      type: "port-block-allocation", blockSize: 128, numBlocksPerUser: 8,
      startIp: "203.0.113.10", endIp: "203.0.113.11",
    }));
    expect(s.warning).toBeNull();
    // 64512 / 1024 = 63 users per address, × 2 addresses
    expect(s.summary).toContain("126");
  });

  // Legal, but a very common misreading of the type name, so it is said out loud.
  it("points out that a one-address overload pool is plain PAT", () => {
    const s = poolSizes(draft({ startIp: "203.0.113.10", endIp: "203.0.113.10" }));
    expect(s.warning).toBeNull();
    expect(s.summary).toContain("PAT");
  });

  it("says nothing useful until there is a range to talk about", () => {
    const s = poolSizes(draft({ startIp: "", endIp: "" }));
    expect(s.warning).toBeNull();
    expect(s.summary).toContain("Enter an external IP range");
  });
});

describe("validateDraft", () => {
  it("passes a plain overload pool", () => {
    expect(validateDraft(draft())).toBeNull();
  });

  it("requires a name", () => {
    expect(validateDraft(draft({ name: "  " }))).toContain("Name");
  });

  it("rejects a backwards external range", () => {
    expect(validateDraft(draft({ startIp: "203.0.113.20", endIp: "203.0.113.10" })))
      .toContain("ends before it starts");
  });

  it("requires the internal range for fixed-port-range", () => {
    expect(validateDraft(draft({ type: "fixed-port-range" }))).toContain("internal IP range");
  });

  // The silent-failure cases are blocking errors, not advice: the operator is about to write a
  // pool the device will accept and that will not work.
  it("blocks the save on an oversubscribed fixed-port-range", () => {
    const msg = validateDraft(draft({
      type: "fixed-port-range",
      startIp: "203.0.113.10", endIp: "203.0.113.11",
      sourceStartIp: "10.0.0.1", sourceEndIp: "10.0.0.50",
    }));
    expect(msg).toBeTruthy();
    expect(msg).toContain("not be translated");
  });

  it("requires block settings for port-block-allocation", () => {
    expect(validateDraft(draft({ type: "port-block-allocation", blockSize: 0 }))).toContain("Block size");
  });
});

describe("describePool", () => {
  const pool = (over: Partial<IPPool> = {}): IPPool => ({
    name: "p", type: "overload", start_ip: "203.0.113.10", end_ip: "203.0.113.20",
    arp_reply: true, permit_any_host: false, comments: "", ...over,
  });

  it("counts the external range", () => {
    expect(describePool(pool()).externalCount).toBe(11);
  });

  it("flags an oversubscribed fixed-port-range row", () => {
    const d = describePool(pool({
      type: "fixed-port-range", start_ip: "203.0.113.10", end_ip: "203.0.113.11",
      source_start_ip: "10.0.0.1", source_end_ip: "10.0.0.10",
    }));
    expect(d.warning).toContain("8");  // 10 internal - 2 external
  });

  it("leaves a healthy row unflagged", () => {
    expect(describePool(pool()).warning).toBeNull();
  });
});

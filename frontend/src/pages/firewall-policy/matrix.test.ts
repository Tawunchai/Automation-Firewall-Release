import { describe, expect, it } from "vitest";
import { buildMatrix, describeCell, isWideOpen, hasInspection } from "./matrix";
import type { FirewallPolicy } from "../../api/policyObject";

// The grid exists to make an ABSENCE visible — the pair with no rule — and to make one finding
// jump out of a table that is ordered by precedence rather than by pair. The tests are about the
// severity rules, because a cell that under-reports is worse than no cell.

const policy = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 1, seq_num: 1, name: "p", src_intf: "lan", dst_intf: "wan1",
  src_intf_list: [], dst_intf_list: [], src_addr: "", dst_addr: "",
  schedule: "always", service: "", action: "accept", nat: false, log_traffic: "all",
  enabled: true, comments: "", src_addr_list: ["LAN"], dst_addr_list: ["all"],
  service_list: ["HTTPS"], created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
} as FirewallPolicy);

const cellOf = (ps: FirewallPolicy[], src = "lan", dst = "wan1") =>
  buildMatrix(ps).cells.get(`${src}|${dst}`);

describe("isWideOpen", () => {
  // All THREE have to be any. A rule with any source and any destination but one named service is
  // broad and not the same finding, and calling it wide-open would cry wolf on ordinary egress.
  it("needs source, destination AND service to be the catch-all", () => {
    expect(isWideOpen(policy({ src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"] }))).toBe(true);
    expect(isWideOpen(policy({ src_addr_list: ["LAN"], dst_addr_list: ["all"], service_list: ["ALL"] }))).toBe(false);
    expect(isWideOpen(policy({ src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["HTTPS"] }))).toBe(false);
  });

  it("is not a finding about a deny", () => {
    expect(isWideOpen(policy({
      action: "deny", src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
    }))).toBe(false);
  });

  // An empty list is "the device did not tell us", not "everything".
  it("does not treat an empty list as any", () => {
    expect(isWideOpen(policy({ src_addr_list: [], dst_addr_list: [], service_list: [] }))).toBe(false);
  });
});

describe("hasInspection", () => {
  it("counts any real UTM profile", () => {
    expect(hasInspection(policy({ av_profile: "default" }))).toBe(true);
    expect(hasInspection(policy({ ips_sensor: "default" }))).toBe(true);
    expect(hasInspection(policy({}))).toBe(false);
  });

  it("does not count certificate-inspection", () => {
    expect(hasInspection(policy({ ssl_ssh_profile: "certificate-inspection" }))).toBe(false);
  });
});

describe("buildMatrix", () => {
  it("levels a permitted, inspected pair", () => {
    expect(cellOf([policy({ av_profile: "default" })])).toMatchObject({ level: "permitted", count: 1 });
  });

  it("levels a permitted pair with nothing inspecting it", () => {
    expect(cellOf([policy({})])?.level).toBe("uninspected");
  });

  it("levels an any/any/any pair above everything else", () => {
    expect(cellOf([policy({
      src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"], av_profile: "default",
    })])?.level).toBe("wide-open");
  });

  it("levels a pair whose rules all deny", () => {
    expect(cellOf([policy({ action: "deny" })])?.level).toBe("deny-only");
  });

  // ⚠️ The cell takes the WORST thing true of the pair, because that is what an attacker gets.
  it("takes the worst level on a pair, whatever order the rules are in", () => {
    const inspected = policy({ id: 1, av_profile: "default" });
    const bare = policy({ id: 2 });
    expect(cellOf([inspected, bare])?.level).toBe("uninspected");
    expect(cellOf([bare, inspected])?.level).toBe("uninspected");
  });

  it("a deny beside an accept is not deny-only", () => {
    expect(cellOf([policy({ id: 1, action: "deny" }), policy({ id: 2, av_profile: "default" })])?.level)
      .toBe("permitted");
  });

  it("skips disabled rules entirely", () => {
    const m = buildMatrix([policy({ enabled: false })]);
    expect(m.cells.size).toBe(0);
    expect(m.sources).toEqual([]);
  });

  it("builds its axes from the rules, not from an interface list", () => {
    const m = buildMatrix([
      policy({ id: 1, src_intf: "lan", dst_intf: "wan1" }),
      policy({ id: 2, src_intf: "dmz", dst_intf: "wan1" }),
    ]);
    expect(m.sources).toEqual(["dmz", "lan"]);
    expect(m.destinations).toEqual(["wan1"]);
  });

  // "any" overrides how every other cell reads, so it must not be buried alphabetically.
  it("sorts any first on both axes", () => {
    const m = buildMatrix([
      policy({ id: 1, src_intf: "zzz", dst_intf: "zzz" }),
      policy({ id: 2, src_intf: "any", dst_intf: "any" }),
    ]);
    expect(m.sources[0]).toBe("any");
    expect(m.destinations[0]).toBe("any");
  });

  // The empty cell is the panel's most useful output, so it is counted.
  it("counts the pairs with no rule", () => {
    const m = buildMatrix([
      policy({ id: 1, src_intf: "lan", dst_intf: "wan1" }),
      policy({ id: 2, src_intf: "dmz", dst_intf: "dmz2" }),
    ]);
    // 2 sources × 2 destinations = 4 pairs, 2 of which have a rule.
    expect(m.totals.none).toBe(2);
  });

  it("sums hits across a pair when the caller supplies them", () => {
    const m = buildMatrix(
      [policy({ id: 1 }), policy({ id: 2 })],
      { hitsOf: (id) => (id === 1 ? 100 : 40) },
    );
    expect(m.cells.get("lan|wan1")?.hits).toBe(140);
  });

  it("expands a multi-interface rule into every pair it permits", () => {
    const m = buildMatrix([policy({ src_intf_list: ["lan", "dmz"], dst_intf_list: ["wan1", "wan2"] })]);
    expect([...m.cells.keys()].sort())
      .toEqual(["dmz|wan1", "dmz|wan2", "lan|wan1", "lan|wan2"]);
  });
});

describe("describeCell", () => {
  // The grid has to be readable out loud: colour is the third signal, never the only one.
  it("says what an empty cell means", () => {
    expect(describeCell(undefined, "lan", "dmz")).toContain("no enabled rule");
  });

  it("names the finding for a wide-open pair", () => {
    const c = cellOf([policy({ src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"] })]);
    expect(describeCell(c, "lan", "wan1")).toContain("ANY source to ANY destination");
  });

  it("mentions NAT only when a permitting rule translates", () => {
    expect(describeCell(cellOf([policy({ nat: true, av_profile: "x" })]), "lan", "wan1")).toContain("NAT");
    expect(describeCell(cellOf([policy({ av_profile: "x" })]), "lan", "wan1")).not.toContain("NAT");
  });
});

import { describe, expect, it } from "vitest";
import {
  modeLabel, ruleCriteria, ruleMembers, ruleDestination, ruleSource,
  rulePerformanceSLA, ruleProtocol, rulePort, emptyRule, validateRule,
} from "./ruleFormat";
import type { SDWANRule } from "../../api/policyObject";

const rule = (over: Partial<SDWANRule> = {}): SDWANRule => ({ ...emptyRule(), ...over });

describe("strategy labels", () => {
  it("maps every CMDB mode to the label the dialog shows", () => {
    // The device stores `mode`; the dialog calls it "Interface selection strategy" with four names
    // that look nothing like the stored values. A wrong pairing means the list and the form
    // disagree about the same rule.
    expect(modeLabel("manual")).toBe("Manual");
    expect(modeLabel("priority")).toBe("Best quality");
    expect(modeLabel("sla")).toBe("Lowest cost (SLA)");
    expect(modeLabel("load-balance")).toBe("Maximize bandwidth (SLA)");
  });

  it("shows an unmapped mode as itself rather than guessing", () => {
    expect(modeLabel("something-new")).toBe("something-new");
  });
});

describe("list columns", () => {
  it("shows what each strategy actually selects on", () => {
    expect(ruleCriteria(rule({ mode: "manual" }))).toBe("Manual");
    expect(ruleCriteria(rule({ mode: "priority", quality_criteria: "jitter" })))
      .toBe("Best quality · jitter");
    expect(ruleCriteria(rule({
      mode: "sla",
      required_sla_targets: [{ health_check: "Default_DNS", id: 1 }],
    }))).toBe("Default_DNS#1");
  });

  it("falls back to the strategy name when an SLA rule has no target yet", () => {
    expect(ruleCriteria(rule({ mode: "load-balance" }))).toBe("Maximize bandwidth (SLA)");
  });

  it("prefers zones over member numbers in the Members column", () => {
    expect(ruleMembers(rule({ zone_preference: ["virtual-wan-link"], interface_preference: [1] })))
      .toBe("virtual-wan-link");
    expect(ruleMembers(rule({ interface_preference: [1, 2] }))).toBe("#1, #2");
    expect(ruleMembers(rule())).toBe("—");
  });

  it("lets Internet Service replace the destination, as the device does", () => {
    // The two are alternatives on the device. Showing an address list for a rule that matches on
    // internet service would describe traffic the rule does not touch.
    expect(ruleDestination(rule({ destination: ["all"] }))).toBe("all");
    expect(ruleDestination(rule({
      destination: ["all"], internet_service: true, internet_service_names: ["Microsoft-Office365"],
    }))).toBe("Microsoft-Office365");
    expect(ruleDestination(rule({ internet_service: true }))).toBe("Internet service");
  });

  it("treats addresses, groups and users all as sources", () => {
    expect(ruleSource(rule({ source: ["lan"], user_groups: ["Guest-group"], users: ["guest"] })))
      .toBe("lan, Guest-group, guest");
    expect(ruleSource(rule())).toBe("—");
  });

  it("reports the health checks a rule watches, whichever way it selects", () => {
    expect(rulePerformanceSLA(rule({ measured_sla: ["Default_DNS"] }))).toBe("Default_DNS");
    expect(rulePerformanceSLA(rule({
      required_sla_targets: [
        { health_check: "Default_DNS", id: 1 },
        { health_check: "Default_DNS", id: 2 },
      ],
    }))).toBe("Default_DNS"); // de-duplicated: two targets, one SLA
    expect(rulePerformanceSLA(rule())).toBe("—");
  });
});

describe("protocol and port", () => {
  it("names the protocols the dialog offers", () => {
    expect(ruleProtocol(rule({ protocol: 0 }))).toBe("any");
    expect(ruleProtocol(rule({ protocol: 6 }))).toBe("TCP");
    expect(ruleProtocol(rule({ protocol: 17 }))).toBe("UDP");
    expect(ruleProtocol(rule({ protocol: 132 }))).toBe("132"); // unnamed → its number
  });

  it("prints the device's full range as 'any' rather than a filter it does not apply", () => {
    // 1-65535 is how the device stores "no port restriction". Showing it as a range would suggest
    // the rule narrows traffic when it does not.
    expect(rulePort(rule({ protocol: 6, start_port: 1, end_port: 65535 }))).toBe("any");
    expect(rulePort(rule({ protocol: 6, start_port: 443, end_port: 443 }))).toBe("443");
    expect(rulePort(rule({ protocol: 6, start_port: 80, end_port: 443 }))).toBe("80-443");
  });

  it("says 'any' for protocols that have no ports at all", () => {
    expect(rulePort(rule({ protocol: 1, start_port: 80, end_port: 443 }))).toBe("any");
    expect(rulePort(rule({ protocol: 0 }))).toBe("any");
  });
});

describe("validation — a mirror of the server's rules", () => {
  const base = (): SDWANRule =>
    rule({ name: "to-cloud", destination: ["all"], zone_preference: ["virtual-wan-link"] });

  it("accepts a complete manual rule", () => {
    expect(validateRule(base())).toBe("");
  });

  it("requires a name", () => {
    expect(validateRule(rule({ ...base(), name: "  " }))).toMatch(/name/i);
  });

  it("requires an outgoing interface — without one the rule silently does nothing", () => {
    expect(validateRule(rule({ ...base(), zone_preference: [] }))).toMatch(/outgoing/i);
    expect(validateRule(rule({ ...base(), zone_preference: [], interface_preference: [2] }))).toBe("");
  });

  it("requires a destination or an internet service, never neither", () => {
    expect(validateRule(rule({ ...base(), destination: [] }))).toMatch(/destination/i);
    expect(validateRule(rule({ ...base(), destination: [], internet_service: true })))
      .toMatch(/internet service/i);
    expect(validateRule(rule({
      ...base(), destination: [], internet_service: true, internet_service_names: ["X"],
    }))).toBe("");
  });

  it("holds each strategy to the field it selects on", () => {
    expect(validateRule(rule({ ...base(), mode: "priority" }))).toMatch(/measured SLA/i);
    expect(validateRule(rule({ ...base(), mode: "priority", measured_sla: ["Default_DNS"] }))).toBe("");

    for (const mode of ["sla", "load-balance"]) {
      expect(validateRule(rule({ ...base(), mode }))).toMatch(/SLA target/i);
      expect(validateRule(rule({
        ...base(), mode, required_sla_targets: [{ health_check: "Default_DNS", id: 1 }],
      }))).toBe("");
    }
  });

  it("rejects an inverted port range and a DSCP toggle with no tag", () => {
    expect(validateRule(rule({ ...base(), protocol: 6, start_port: 443, end_port: 80 })))
      .toMatch(/start port/i);
    expect(validateRule(rule({ ...base(), forward_dscp: true }))).toMatch(/forward DSCP/i);
    expect(validateRule(rule({ ...base(), forward_dscp: true, forward_dscp_tag: "000010" }))).toBe("");
    expect(validateRule(rule({ ...base(), reverse_dscp: true }))).toMatch(/reverse DSCP/i);
  });

  it("opens on Manual and enabled, like the dialog", () => {
    const fresh = emptyRule();
    expect(fresh.mode).toBe("manual");
    expect(fresh.status).toBe(true);
    expect(fresh.start_port).toBe(1);
    expect(fresh.end_port).toBe(65535);
  });
});

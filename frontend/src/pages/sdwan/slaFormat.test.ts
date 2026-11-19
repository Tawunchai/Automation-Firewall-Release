import { describe, expect, it } from "vitest";
import {
  probeModeLabel, protocolLabel, hasLinkStatus, hasProbeTarget,
  detectServerLines, httpProbeURL, participantsLabel, criteriaUsed,
  thresholdLabel, measurementSeries,
  emptyHealthCheckForm, emptySLARow, toHealthCheckForm, toHealthCheckPayload,
  validateHealthCheck, toggleCriterion, MAX_SERVERS, checkSLAName,
} from "./slaFormat";
import type { SDWANHealthCheck, SDWANHealthCheckForm } from "../../api/policyObject";

// The reference row is one of the six checks this lab FortiGate ships with, read off the device.
const check = (over: Partial<SDWANHealthCheck> = {}): SDWANHealthCheck => ({
  name: "Default_AWS",
  detect_mode: "active",
  protocol: "http",
  servers: ["aws.amazon.com"],
  system_dns: false,
  port: 0,
  members: [],
  member_names: [],
  sla: [{
    id: 1,
    link_cost_factor: ["latency", "jitter", "packet-loss"],
    latency_threshold: 250,
    jitter_threshold: 50,
    packetloss_threshold: 5,
    mos_threshold: "",
  }],
  interval: 1000,
  probe_timeout: 1000,
  failtime: 5,
  recoverytime: 10,
  update_static_route: true,
  update_cascade_interface: true,
  ...over,
});

// Underscored, like the device's own Default_AWS: this table refuses a hyphen in the mkey.
const form = (over: Partial<SDWANHealthCheckForm> = {}): SDWANHealthCheckForm =>
  ({ ...emptyHealthCheckForm(), name: "Corp_SLA", servers: ["1.1.1.1"], ...over });

describe("the dialog's vocabulary", () => {
  it("names the three probe modes and the three protocols", () => {
    expect(probeModeLabel("active")).toBe("Active");
    expect(probeModeLabel("passive")).toBe("Passive");
    expect(probeModeLabel("prefer-passive")).toBe("Prefer Passive");
    expect(protocolLabel("ping")).toBe("Ping");
    expect(protocolLabel("http")).toBe("HTTP");
    expect(protocolLabel("dns")).toBe("DNS");
  });

  it("shows an unmapped value as itself rather than guessing", () => {
    // The CMDB has modes and protocols the dialog does not offer (remote, twamp, ftp…). A check
    // built over the CLI must still be recognisable in the list.
    expect(probeModeLabel("remote")).toBe("remote");
    expect(protocolLabel("twamp")).toBe("twamp");
  });

  it("hides Link Status only in Passive, which is where the device discards it", () => {
    // Measured live: with detect-mode passive, a PUT carrying failtime/recoverytime/
    // update-static-route returns 200 and reads back unchanged. Prefer Passive keeps them.
    expect(hasLinkStatus("active")).toBe(true);
    expect(hasLinkStatus("prefer-passive")).toBe(true);
    expect(hasLinkStatus("passive")).toBe(false);
    expect(hasProbeTarget("passive")).toBe(false);
  });
});

describe("the Detect Server column", () => {
  it("prints an HTTP probe as the URL it fetches", () => {
    // The CMDB holds a bare host ("aws.amazon.com"); the FortiGate list shows the URL.
    expect(detectServerLines(check())).toEqual(["http://aws.amazon.com/"]);
    expect(httpProbeURL("www.office.com")).toBe("http://www.office.com/");
  });

  it("does not prefix a server that already carries a scheme", () => {
    expect(httpProbeURL("https://example.com/health")).toBe("https://example.com/health");
  });

  it("prints a Ping probe as the bare address", () => {
    // Default_Gmail on this device: protocol ping, server gmail.com.
    expect(detectServerLines(check({ protocol: "ping", servers: ["gmail.com"] })))
      .toEqual(["gmail.com"]);
  });

  it("names the system resolvers for a DNS probe that uses them", () => {
    // Default_DNS: system-dns enable, and the list shows both resolvers plus the label.
    expect(detectServerLines(check({
      protocol: "dns", system_dns: true, servers: [],
      system_dns_servers: ["96.45.45.45", "96.45.46.46"],
    }))).toEqual(["96.45.45.45", "96.45.46.46", "(System DNS)"]);
  });

  it("still says System DNS when the device would not report its resolvers", () => {
    expect(detectServerLines(check({ protocol: "dns", system_dns: true, servers: [] })))
      .toEqual(["(System DNS)"]);
  });

  it("shows nothing for a Passive check, which probes no server at all", () => {
    expect(detectServerLines(check({ detect_mode: "passive" }))).toEqual([]);
  });
});

describe("participants", () => {
  it("reads an empty list as every member, the way the dialog does", () => {
    expect(participantsLabel(check({ members: [] }))).toBe("All SD-WAN Members");
  });

  it("names the interfaces rather than the sequence numbers the CMDB stores", () => {
    expect(participantsLabel(check({ members: [1, 2], member_names: ["wan1", "wan2"] })))
      .toBe("wan1, wan2");
  });
});

describe("the threshold columns", () => {
  it("prints a threshold only when its criterion is switched on", () => {
    // Dropping "latency" from link-cost-factor makes the device reset latency-threshold to its
    // default 5 — printing that would show a limit nobody set.
    expect(thresholdLabel(check(), "latency")).toBe("250ms");
    expect(thresholdLabel(check(), "jitter")).toBe("50ms");
    expect(thresholdLabel(check(), "packet-loss")).toBe("5%");

    const lossOnly = check({
      sla: [{
        id: 1, link_cost_factor: ["packet-loss"],
        latency_threshold: 5, jitter_threshold: 5, packetloss_threshold: 3, mos_threshold: "",
      }],
    });
    expect(thresholdLabel(lossOnly, "packet-loss")).toBe("3%");
    expect(thresholdLabel(lossOnly, "latency")).toBe("");
  });

  it("leaves the cell blank when the check has no SLA target at all", () => {
    expect(thresholdLabel(check({ sla: [] }), "latency")).toBe("");
  });

  it("lists every SLA number's threshold when a check defines several", () => {
    const two = check({
      sla: [
        { id: 1, link_cost_factor: ["latency"], latency_threshold: 100, jitter_threshold: 5, packetloss_threshold: 0, mos_threshold: "" },
        { id: 2, link_cost_factor: ["latency"], latency_threshold: 300, jitter_threshold: 5, packetloss_threshold: 0, mos_threshold: "" },
      ],
    });
    expect(thresholdLabel(two, "latency")).toBe("100ms / 300ms");
  });

  it("collects the criteria a check selects on, without repeats", () => {
    expect(criteriaUsed(check())).toEqual(["latency", "jitter", "packet-loss"]);
    expect(criteriaUsed(check({ sla: [] }))).toEqual([]);
  });
});

describe("the measurement charts", () => {
  it("drops members the device reported nothing for instead of drawing them at zero", () => {
    // SD-WAN is off on the lab device, so monitor/virtual-wan/health-check answers `{}` for every
    // check. A bar at 0 would claim a reading nobody took — the chart must simply be empty.
    const quiet = check({ live: [{ interface: "wan1", status: "error" }] });
    expect(measurementSeries([quiet], "latency")).toEqual([]);
    expect(measurementSeries([check()], "packet-loss")).toEqual([]);
  });

  it("keeps a genuine zero, which is a measurement and not an absence", () => {
    const perfect = check({ live: [{ interface: "wan1", packet_loss: 0 }] });
    expect(measurementSeries([perfect], "packet-loss")).toEqual([
      { label: "Default_AWS · wan1", value: 0, display: "0%" },
    ]);
  });

  it("ranks members worst-first across every check, the way the device's charts do", () => {
    const a = check({ name: "A", live: [{ interface: "wan1", latency: 12 }] });
    const b = check({ name: "B", live: [{ interface: "wan2", latency: 40.5 }] });
    expect(measurementSeries([a, b], "latency")).toEqual([
      { label: "B · wan2", value: 40.5, display: "40.50ms" },
      { label: "A · wan1", value: 12, display: "12ms" },
    ]);
  });
});

describe("loading a check into the form", () => {
  it("round-trips a device row", () => {
    const f = toHealthCheckForm(check());
    expect(f.name).toBe("Default_AWS");
    expect(f.protocol).toBe("http");
    expect(f.servers).toEqual(["aws.amazon.com"]);
    expect(f.sla[0].link_cost_factor).toEqual(["latency", "jitter", "packet-loss"]);
    expect(f.interval).toBe(1000);
  });

  it("gives a serverless check one empty row so the field can be typed in", () => {
    expect(toHealthCheckForm(check({ servers: [] })).servers).toEqual([""]);
  });

  it("does not share the criteria array with the row it was loaded from", () => {
    const source = check();
    const f = toHealthCheckForm(source);
    f.sla[0].link_cost_factor.push("mos");
    expect(source.sla[0].link_cost_factor).toEqual(["latency", "jitter", "packet-loss"]);
  });
});

describe("what goes on the wire", () => {
  it("drops blank server rows", () => {
    expect(toHealthCheckPayload(form({ servers: ["1.1.1.1", "  ", "8.8.8.8"] })).servers)
      .toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("strips everything Passive mode owns none of", () => {
    // The device would accept these with a 200 and discard them; sending them would make the form
    // claim a save that never happened.
    const p = toHealthCheckPayload(form({
      detect_mode: "passive", servers: ["1.1.1.1"], interval: 900,
      failtime: 3, recoverytime: 7, update_static_route: true,
    }));
    expect(p.servers).toEqual([]);
    expect(p.interval).toBe(0);
    expect(p.failtime).toBe(0);
    expect(p.recoverytime).toBe(0);
    expect(p.update_static_route).toBe(false);
  });

  it("turns System DNS off for a probe that is not DNS", () => {
    // system-dns is a DNS-probe setting; left on after a switch to Ping the device would go on
    // probing something the form no longer shows.
    expect(toHealthCheckPayload(form({ protocol: "ping", system_dns: true })).system_dns).toBe(false);
    expect(toHealthCheckPayload(form({ protocol: "dns", system_dns: true })).system_dns).toBe(true);
  });
});

describe("the form's validator", () => {
  it("accepts a well-formed check", () => {
    expect(validateHealthCheck(form(), false)).toBe("");
  });

  it("refuses the characters the firewall reserves in this table", () => {
    // Probed on the device: "-" comes back as "char(-) is reserved" / -651, and < > ' " # ( ) as
    // "The string contains XSS vulnerability characters" / -173. The hyphen is why every check the
    // FortiGate ships with is named Default_AWS rather than Default-AWS.
    expect(checkSLAName("Voice-SLA")).toContain("hyphen");
    expect(checkSLAName("Voice#SLA")).toContain("#");
    expect(checkSLAName("Voice_SLA")).toBe("");
    // Everything else that was tried on the device is accepted, and must not be refused here.
    expect(checkSLAName("Default_Google Search")).toBe("");
    expect(checkSLAName("SLA.v2+eu@east")).toBe("");

    expect(validateHealthCheck(form({ name: "Voice-SLA" }), false)).toContain("hyphen");
    // On an edit the mkey comes from the URL, so an existing odd name must not block a save.
    expect(validateHealthCheck(form({ name: "Voice-SLA" }), true)).toBe("");
  });

  it("requires a name on create and not on edit", () => {
    expect(validateHealthCheck(form({ name: " " }), false)).toBe("Enter a name");
    expect(validateHealthCheck(form({ name: " " }), true)).toBe("");
    expect(validateHealthCheck(form({ name: "x".repeat(36) }), false))
      .toBe("The name is limited to 35 characters");
  });

  it("demands a server on create, because the device does", () => {
    // "Attribute 'server' MUST be set. … Return code -56" is the device's own answer.
    expect(validateHealthCheck(form({ servers: [""] }), false)).not.toBe("");
    // DNS with the system resolvers is the one way to have no server of your own.
    expect(validateHealthCheck(form({ servers: [""], protocol: "dns", system_dns: true }), false))
      .toBe("");
    // Passive never sends a packet.
    expect(validateHealthCheck(form({ servers: [""], detect_mode: "passive" }), false)).toBe("");
    // On an edit an empty server is a no-op on the device, so it must not block a save.
    expect(validateHealthCheck(form({ servers: [""] }), true)).toBe("");
  });

  it("stops at two servers, which is the field's own ceiling", () => {
    expect(MAX_SERVERS).toBe(2);
    expect(validateHealthCheck(form({ servers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"] }), false))
      .toContain("at most 2");
  });

  it("refuses a server carrying a space or a quote", () => {
    // The CMDB packs the list into one quoted string, so either would come back mangled.
    expect(validateHealthCheck(form({ servers: ['a" b'] }), false)).not.toBe("");
  });

  it("checks the link status ranges the schema defines", () => {
    expect(validateHealthCheck(form({ interval: 19 }), false)).toContain("20-3600000");
    expect(validateHealthCheck(form({ failtime: 0 }), false)).toContain("1-3600");
    expect(validateHealthCheck(form({ recoverytime: 3601 }), false)).toContain("1-3600");
    // Passive has no link status at all, so those numbers cannot be wrong there.
    expect(validateHealthCheck(form({ detect_mode: "passive", interval: 0, failtime: 0, recoverytime: 0 }), false))
      .toBe("");
  });

  it("refuses an SLA target that measures nothing", () => {
    // The device stores it happily and every member passes it, which looks like a working SLA.
    expect(validateHealthCheck(form({ sla: [{ ...emptySLARow(), link_cost_factor: [] }] }), false))
      .toContain("at least one threshold");
  });

  it("checks the SLA number and refuses duplicates", () => {
    expect(validateHealthCheck(form({ sla: [{ ...emptySLARow(), id: 0 }] }), false)).toContain("1-32");
    expect(validateHealthCheck(form({ sla: [{ ...emptySLARow(), id: 33 }] }), false)).toContain("1-32");
    expect(validateHealthCheck(form({ sla: [emptySLARow(1), emptySLARow(1)] }), false))
      .toContain("same number");
  });

  it("caps packet loss at 100%", () => {
    expect(validateHealthCheck(form({ sla: [{ ...emptySLARow(), packetloss_threshold: 101 }] }), false))
      .toContain("0-100");
  });
});

describe("the per-threshold toggles", () => {
  it("adds and removes a criterion from the set the device stores", () => {
    const row = emptySLARow();
    const off = toggleCriterion(row, "jitter");
    expect(off.link_cost_factor).toEqual(["latency", "packet-loss"]);
    expect(toggleCriterion(off, "jitter").link_cost_factor)
      // Back in the CMDB's own order, so a round trip does not read as an edit.
      .toEqual(["latency", "jitter", "packet-loss"]);
  });

  it("leaves the thresholds alone — only the criteria set changes", () => {
    const row = { ...emptySLARow(), latency_threshold: 250 };
    expect(toggleCriterion(row, "latency").latency_threshold).toBe(250);
  });

  it("keeps a MOS criterion the dialog does not show", () => {
    // A check built over the CLI can select on MOS. Editing its latency toggle must not quietly
    // throw that away.
    const row = { ...emptySLARow(), link_cost_factor: ["latency", "mos"], mos_threshold: "3.6" };
    expect(toggleCriterion(row, "jitter").link_cost_factor).toEqual(["latency", "jitter", "mos"]);
  });
});

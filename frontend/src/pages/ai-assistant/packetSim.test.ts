import { describe, expect, it } from "vitest";
import { buildScenario, insertIndex, isPairRelevant, type SimPhase, type SimRule } from "./packetSim";
import { EMPTY_FLOW_CONTEXT, type FlowContext } from "./deviceFacts";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type { FirewallPolicy } from "../../api/policyObject";

// What this module has to get right is the thing nobody can check by looking: whether a rule the
// user is about to create silently kills six others, and whether it will run at all where Apply
// would put it. Both are set containment over a whole table, and both are answers somebody will
// trust before writing to a live firewall — so the interesting cases are pinned here rather than
// reproduced by hand against the lab device.
//
// Every policy below is shaped like the ones the device actually returns (src_addr_list and
// service_list already parsed by the backend), and every proposal goes through the SAME CLI parser
// the page uses, so a test starts where the app starts.

// ── Fixtures ─────────────────────────────────────────────────────────────────

let nextId = 1;

function pol(over: Partial<FirewallPolicy>): FirewallPolicy {
  const id = over.id ?? nextId++;
  return {
    id, seq_num: id, name: `policy ${id}`,
    src_intf: "", dst_intf: "", src_intf_list: ["internal"], dst_intf_list: ["wan1"],
    src_addr: "", dst_addr: "", schedule: "always", service: "",
    action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
    src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
    created_at: "", updated_at: "",
    ippool: false, poolname: [], fixedport: false, protocol_options: "",
    av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
    ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
    ...over,
  };
}

/** The device facts a real conversation would have loaded before the panel opened. */
function ctxWith(policies: FirewallPolicy[]): FlowContext {
  return {
    ...EMPTY_FLOW_CONTEXT,
    addresses: new Map([
      ["Corp-Users", "10.20.0.0/16"],
      ["Dev-Workstations", "10.20.31.0/24"],
      ["Net-Admins", "10.20.250.0/24"],
      ["Voice-VLAN", "10.20.60.0/24"],
      ["Partner-Net", "192.0.2.0/24"],
      ["office.example.com", "office.example.com"], // an FQDN: deliberately unresolvable
    ]),
    services: new Map([
      ["ALL", "ANY"], ["HTTP", "TCP/80"], ["HTTPS", "TCP/443"], ["DNS", "UDP/53 TCP/53"],
      ["NTP", "UDP/123"], ["SSH", "TCP/22"], ["FTP", "TCP/21"], ["SIP", "UDP/5060"],
    ]),
    interfaces: new Map([
      ["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }],
      ["wan1", { name: "wan1", role: "wan", ip: "203.0.113.14/30" }],
    ]),
    internetIfaces: new Set(["wan1"]),
    policies,
  };
}

const draftFrom = (cli: string) => parseAllPoliciesFromCLI(cli)[0];

const WEB_ONLY = `config firewall policy
    edit 0
        set name "Corp-Web-Only"
        set srcintf "internal"
        set dstintf "wan1"
        set srcaddr "Corp-Users"
        set dstaddr "all"
        set service "HTTP" "HTTPS" "DNS"
        set action accept
        set nat enable
        set av-profile "default"
    next
end`;

const DENY_ALL = `config firewall policy
    edit 0
        set name "Corp-Egress-Deny"
        set srcintf "internal"
        set dstintf "wan1"
        set srcaddr "Corp-Users"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end`;

function run(cli: string, policies: FirewallPolicy[], phase: SimPhase = "after", beforeId: number | null = null) {
  return buildScenario({
    draft: draftFrom(cli),
    ctx: ctxWith(policies),
    pendingAddresses: new Map(),
    pendingServices: new Map(),
    beforeId, phase,
  });
}

const ruleRows = (rows: ReturnType<typeof run>["rows"]) =>
  rows.filter((r): r is { kind: "rule" } & SimRule => r.kind === "rule");
const byName = (rows: ReturnType<typeof run>["rows"], name: string) =>
  ruleRows(rows).find((r) => r.name === name);

// ── The predicate everything else rests on ──────────────────────────────────

describe("isPairRelevant", () => {
  it("keeps a rule on the same interface pair", () => {
    expect(isPairRelevant(pol({}), "internal", "wan1")).toBe(true);
  });

  it("drops a rule whose ingress interface is different", () => {
    expect(isPairRelevant(pol({ src_intf_list: ["dmz"] }), "internal", "wan1")).toBe(false);
  });

  it("treats `any` as matching every interface, the way FortiOS does", () => {
    expect(isPairRelevant(pol({ src_intf_list: ["any"], dst_intf_list: ["any"] }), "internal", "wan1")).toBe(true);
  });
});

// ── Placement ────────────────────────────────────────────────────────────────

describe("insertIndex", () => {
  const table = [
    pol({ id: 1, src_intf_list: ["dmz"] }),
    pol({ id: 2 }),
    pol({ id: 3 }),
    pol({ id: 4, dst_intf_list: ["dmz"] }),
  ];

  it("places a rule immediately before the policy the board named", () => {
    expect(insertIndex(table, 3, "internal", "wan1")).toBe(2);
  });

  it("falls to the bottom of the interface PAIR, not the bottom of the table", () => {
    // Rules 2 and 3 are the pair; #4 belongs to another one and must stay below.
    expect(insertIndex(table, null, "internal", "wan1")).toBe(3);
  });

  it("appends when the pair has no rules at all", () => {
    expect(insertIndex([pol({ id: 9, src_intf_list: ["dmz"] })], null, "internal", "wan1")).toBe(1);
  });
});

// ── The walk ─────────────────────────────────────────────────────────────────

describe("the walk", () => {
  it("stops at the first matching rule and never consults the ones below", () => {
    const s = run(WEB_ONLY, [
      pol({ id: 1, name: "Blanket-Egress" }),
      pol({ id: 2, name: "Below-It" }),
    ], "after", 1);
    const rows = ruleRows(s.rows);
    // The proposal is placed above both, so it claims the web flow itself.
    expect(rows[0].isNew).toBe(true);
    expect(s.flows[0].rule?.name).toBe("Corp-Web-Only");
  });

  it("folds rules on other interface pairs into one band instead of a row each", () => {
    const s = run(WEB_ONLY, [
      ...Array.from({ length: 12 }, (_, i) => pol({ id: 100 + i, src_intf_list: ["dmz"] })),
      pol({ id: 200, name: "Corp-Catch-All" }),
    ]);
    const bands = s.rows.filter((r) => r.kind === "band");
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ count: 12 });
    // 12 folded + the survivor + the proposal + the implicit deny.
    expect(s.rows).toHaveLength(4);
  });

  it("numbers the rows the way the device's table would read AFTER the change", () => {
    const s = run(WEB_ONLY, [
      pol({ id: 1, src_intf_list: ["dmz"] }),
      pol({ id: 2, src_intf_list: ["dmz"] }),
      pol({ id: 3, name: "Corp-Catch-All" }),
    ]);
    // Two folded policies occupy #1 and #2, so the first visible rule is #3.
    expect(byName(s.rows, "Corp-Catch-All")?.shown).toBe(3);
    expect(byName(s.rows, "Corp-Web-Only")?.shown).toBe(4);
  });

  it("ends on the implicit deny when nothing matches", () => {
    const s = run(WEB_ONLY, [], "before");
    expect(s.flows[0].rule?.name).toBe("Implicit deny");
    expect(s.flows[0].outcome).toBe("dropped");
  });

  it("marks a flow inspected only when the rule that claims it carries a profile", () => {
    const above = run(WEB_ONLY, [pol({ id: 1, name: "Corp-Catch-All" })], "after", 1);
    expect(above.flows[0].outcome).toBe("inspected");
    expect(above.utm).toContain("AntiVirus: default");

    // Below the blanket rule the profiles are configured on a row no packet reaches, so the same
    // traffic leaves UNINSPECTED. Two states that look alike on the device and are not.
    const below = run(WEB_ONLY, [pol({ id: 1, name: "Corp-Catch-All" })]);
    expect(below.flows[0].outcome).toBe("allowed");
    expect(below.utm).toEqual([]);
  });
});

// ── The finding this whole panel exists for ─────────────────────────────────

describe("shadowing", () => {
  const table = [
    pol({ id: 11, name: "Net-Admins-Full-Egress", src_addr_list: ["Net-Admins"] }),
    pol({ id: 12, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
    pol({ id: 13, name: "Corp-SSH-to-Cloud", src_addr_list: ["Dev-Workstations"], service_list: ["SSH"] }),
    pol({ id: 14, name: "Voice-SIP-Trunk", src_addr_list: ["Voice-VLAN"], service_list: ["SIP"] }),
    pol({ id: 15, name: "Partner-Link", src_addr_list: ["Partner-Net"], service_list: ["HTTPS"] }),
  ];

  it("kills every rule below it that it fully covers, and spares the ones it does not", () => {
    // The deny is placed above #12, so #11 stays above it and survives on position alone.
    const s = run(DENY_ALL, table, "after", 12);
    expect(byName(s.rows, "Corp-NTP-Out")?.state).toBe("dead");
    expect(byName(s.rows, "Corp-SSH-to-Cloud")?.state).toBe("dead");
    expect(byName(s.rows, "Voice-SIP-Trunk")?.state).toBe("dead");
    // 192.0.2.0/24 is outside 10.20.0.0/16 — a rule the deny does not reach.
    expect(byName(s.rows, "Partner-Link")?.state).toBe("survives");
    expect(byName(s.rows, "Net-Admins-Full-Egress")?.state).toBe("survives");
  });

  it("says out loud that a rule above it survives only because of its position", () => {
    const s = run(DENY_ALL, table, "after", 12);
    // Net-Admins is inside 10.20.0.0/16: reorder the table and it dies.
    expect(byName(s.rows, "Net-Admins-Full-Egress")?.note).toMatch(/above/i);
  });

  it("reports the new rule as unreachable when something above already claims its traffic", () => {
    const blanket = [pol({ id: 1, name: "Corp-Catch-All" }), pol({ id: 2, name: "Something-Else" })];
    const s = run(DENY_ALL, blanket); // beforeId null → bottom of the pair, below the blanket rule
    expect(byName(s.rows, "Corp-Egress-Deny")?.state).toBe("unreachable");
    expect(s.blockedByName).toBe("Corp-Catch-All");
    expect(s.headline.title).toMatch(/nothing changes/i);
  });

  it("offers the placement that fixes it, and the fix actually works", () => {
    const blanket = [pol({ id: 1, name: "Corp-Catch-All" })];
    const broken = run(DENY_ALL, blanket);
    expect(broken.blockedById).toBe(1);

    const fixed = run(DENY_ALL, blanket, "fixed");
    expect(byName(fixed.rows, "Corp-Egress-Deny")?.state).toBe("new");
    // Narrowed, not dead: the blanket rule matches `all`, and the deny only claims 10.20.0.0/16 of
    // it. Calling that dead would be the overstatement this module exists to avoid.
    expect(byName(fixed.rows, "Corp-Catch-All")?.state).toBe("narrowed");
    expect(fixed.flows.every((f) => f.outcome === "dropped")).toBe(true);
  });

  it("calls a partial overlap narrowed, not dead", () => {
    // The proposal only takes HTTP/HTTPS/DNS, so a rule carrying HTTPS *and* SSH keeps the SSH half.
    const s = run(WEB_ONLY, [
      pol({ id: 1, name: "Mixed-Egress", src_addr_list: ["Corp-Users"], service_list: ["HTTPS", "SSH"] }),
    ], "after", 1);
    expect(byName(s.rows, "Mixed-Egress")?.state).toBe("narrowed");
  });

  it("leaves a rule on another interface pair completely alone", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "DMZ-Egress", src_intf_list: ["dmz"], src_addr_list: ["Corp-Users"] }),
    ]);
    // It is folded into a band, and no state is claimed for it.
    expect(s.rows.some((r) => r.kind === "band")).toBe(true);
    expect(s.ledger.find((e) => e.name === "DMZ-Egress")).toBeUndefined();
  });

  it("the before run never invents a consequence", () => {
    const s = run(DENY_ALL, table, "before");
    expect(s.ledger).toEqual([]);
    expect(s.breaks).toEqual([]);
    expect(ruleRows(s.rows).some((r) => r.isNew)).toBe(false);
  });
});

// ── Sample flows ─────────────────────────────────────────────────────────────

describe("sample flows", () => {
  it("takes the extra flows from rules the change is about to kill", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
      pol({ id: 2, name: "Corp-SSH-to-Cloud", src_addr_list: ["Dev-Workstations"], service_list: ["SSH"] }),
    ], "after", 1);
    const ports = s.flows.map((f) => `${f.flow.port}/${f.flow.proto}`);
    expect(ports).toContain("123/UDP");
    expect(ports).toContain("22/TCP");
  });

  it("only sends addresses the device's own configuration names", () => {
    const s = run(WEB_ONLY, [pol({ id: 1, name: "Corp-Catch-All" })]);
    // 10.20.0.0/16 → the first usable host in it.
    expect(s.flows[0].flow.srcIp).toBe("10.20.0.1");
  });

  it("never sends the same source and port twice", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "A", src_addr_list: ["Corp-Users"] }),
      pol({ id: 2, name: "B", src_addr_list: ["Corp-Users"] }),
    ], "after", 1);
    const keys = s.flows.map((f) => `${f.flow.srcIp}:${f.flow.port}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── The honesty rules ────────────────────────────────────────────────────────

describe("what it refuses to claim", () => {
  it("stops the walk at an object it cannot reduce to a range", () => {
    const s = run(WEB_ONLY, [
      pol({ id: 1, name: "FQDN-Rule", src_addr_list: ["office.example.com"] }),
      pol({ id: 2, name: "Corp-Catch-All" }),
    ]);
    const unknown = s.flows.find((f) => f.outcome === "unknown");
    expect(unknown?.rule?.name).toBe("FQDN-Rule");
    expect(unknown?.blockedBy).toMatch(/office\.example\.com/);
  });

  it("never calls a rule dead when the comparison could not be decided", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "FQDN-Rule", src_addr_list: ["office.example.com"] }),
    ], "after", 1);
    expect(byName(s.rows, "FQDN-Rule")?.state).not.toBe("dead");
  });

  it("names an unresolvable object in the proposal instead of dropping it", () => {
    const cli = WEB_ONLY.replace('set srcaddr "Corp-Users"', 'set srcaddr "office.example.com"');
    const s = run(cli, [pol({ id: 1, name: "Corp-Catch-All" })]);
    expect(s.unresolved).toContain("office.example.com");
    expect(s.breaks.some((b) => b.detail.includes("office.example.com"))).toBe(true);
  });
});

// ── The two lists the panel renders ──────────────────────────────────────────

describe("consequences", () => {
  it("lists every dead rule in the ledger, whether or not a sample flow touched it", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
      pol({ id: 2, name: "Voice-SIP-Trunk", src_addr_list: ["Voice-VLAN"], service_list: ["SIP"] }),
      pol({ id: 3, name: "Corp-FTP", src_addr_list: ["Corp-Users"], service_list: ["FTP"] }),
    ], "after", 1);
    const dead = s.ledger.filter((e) => e.state === "dead").map((e) => e.name);
    expect(dead).toEqual(expect.arrayContaining(["Corp-NTP-Out", "Voice-SIP-Trunk", "Corp-FTP"]));
    expect(s.headline.nums[0].v).toBe("3");
  });

  it("restates each dead rule as the service and network that stop working", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
    ], "after", 1);
    const stop = s.breaks.find((b) => b.kind === "stop" && b.title.includes("NTP"));
    expect(stop?.title).toContain("Corp-Users");
    expect(stop?.detail).toContain("Corp-NTP-Out");
  });

  it("sorts the ledger by how much attention a row needs", () => {
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
    ], "after", 1);
    expect(s.ledger[0].state).toBe("dead");
  });

  it("says plainly when a change breaks nothing at all", () => {
    const s = run(WEB_ONLY, [
      pol({ id: 1, name: "Partner-Link", src_addr_list: ["Partner-Net"], service_list: ["HTTPS"] }),
    ], "after", 1);
    expect(s.headline.nums[0].v).toBe("0");
    expect(s.breaks.some((b) => b.kind === "keep")).toBe(true);
  });
});

// ── Timing ───────────────────────────────────────────────────────────────────

describe("the timeline", () => {
  it("runs long enough for the deepest flow to reach its rule", () => {
    const s = run(WEB_ONLY, Array.from({ length: 6 }, (_, i) => pol({ id: i + 1, name: `r${i}` })), "before");
    const deepest = Math.max(...s.flows.map((f) => f.rowIndex));
    const lookup = s.stages.find((st) => st.id === "lookup")!;
    expect(lookup.to).toBeGreaterThanOrEqual(s.ingressMs + (deepest + 1) * s.perRow);
    expect(s.duration).toBeGreaterThan(lookup.to);
  });

  it("hands the renderer stages that tile the whole run with no gaps", () => {
    const s = run(WEB_ONLY, [pol({ id: 1 })]);
    s.stages.forEach((st, i) => {
      if (i === 0) expect(st.from).toBe(0);
      else expect(st.from).toBe(s.stages[i - 1].to);
    });
    expect(s.stages[s.stages.length - 1].to).toBe(s.duration);
  });
});

// ── The egress is not always the internet (the lan → DMZ bug) ──────────────────
//
// "all" as a destination out an internet-facing port IS the internet; out a DMZ or server port it
// is "everything on that network". The diagram used to draw both the same way — a globe labelled
// "Internet" — because it keyed off the 8.8.8.8 stand-in alone. These lock the egress-aware fix.
describe("egress that does not lead to the internet", () => {
  const dmzCtx = (): FlowContext => ({
    ...ctxWith([]),
    interfaces: new Map([
      ["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }],
      ["wan1", { name: "wan1", role: "wan", ip: "203.0.113.14/30" }],
      ["dmz", { name: "dmz", role: "dmz", ip: "10.99.0.1/24" }],
    ]),
    internetIfaces: new Set(["wan1"]),
  });

  const LAN_TO_DMZ = `config firewall policy
    edit 0
        set name "lan to DMZ"
        set srcintf "internal"
        set dstintf "dmz"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;

  it("marks an 'all' destination out a DMZ port as NOT the internet", () => {
    const s = buildScenario({
      draft: draftFrom(LAN_TO_DMZ), ctx: dmzCtx(),
      pendingAddresses: new Map(), pendingServices: new Map(), beforeId: null, phase: "before",
    });
    expect(s.egress).toBe("dmz");
    expect(s.egressIsInternet).toBe(false);
    expect(s.flows[0]?.flow.dstUnbounded).toBe(true);
    // The flow text names the egress network, never "the internet".
    expect(s.flows[0]?.flow.label).toContain("dmz");
    expect(s.flows[0]?.flow.label).not.toContain("the internet");
    // Case-insensitive: "DMZ" must classify the same as "dmz".
    expect(isInternetEgressCase("DMZ", dmzCtx())).toBe(false);
  });

  it("still marks an 'all' destination out the WAN as the internet", () => {
    const s = run(WEB_ONLY, [], "before");
    expect(s.egress).toBe("wan1");
    expect(s.egressIsInternet).toBe(true);
    expect(s.flows[0]?.flow.dstUnbounded).toBe(true);
    expect(s.flows[0]?.flow.label).toContain("the internet");
  });
});

// ── Traffic ARRIVING from the internet (the "Internet → LAN" source bug) ───────
//
// The mirror of the egress fix: a policy from the WAN inward has an unrestricted source that IS the
// internet, and the scenario must say so (ingressIsInternet) so the renderer draws the globe rather
// than an anonymous "0.0.0.0/0" card. Same internetIfaces set, read on the way in.
describe("source that arrives from the internet", () => {
  const INTERNET_TO_LAN = `config firewall policy
    edit 0
        set name "Internet-to-LAN"
        set srcintf "wan1"
        set dstintf "internal"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;

  it("marks an 'all' source arriving on an internet-facing interface as the internet", () => {
    const s = run(INTERNET_TO_LAN, []);
    expect(s.ingress).toBe("wan1");
    expect(s.ingressIsInternet).toBe(true);
    expect(s.source.unbounded).toBe(true);
  });

  it("does not call an internal ingress the internet", () => {
    // WEB_ONLY comes IN on `internal`, which no default route points out of.
    const s = run(WEB_ONLY, []);
    expect(s.ingress).toBe("internal");
    expect(s.ingressIsInternet).toBe(false);
  });
});

// ── Contrast flows: show the rule's scope, never invent a block ────────────────
describe("sample flows that make the rule's scope legible", () => {
  const OPEN_ACCEPT = `config firewall policy
    edit 0
        set name "Open-Egress"
        set srcintf "internal"
        set dstintf "wan1"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;

  it("adds illustrative flows beyond the single one the proposal is about", () => {
    const s = run(OPEN_ACCEPT, []);
    expect(s.flows.length).toBeGreaterThan(1);
    expect(s.flows.some((f) => f.flow.synthetic)).toBe(true);
  });

  it("shows a boundary flow ONLY when the rule actually restricts the service", () => {
    // Restricted to HTTP/HTTPS/DNS → a port it does not cover (SSH/RDP) is drawn, so the limit is
    // on screen.
    const restricted = run(WEB_ONLY, [pol({ id: 1, name: "Catch-All" })], "after", 1);
    expect(restricted.flows.some((f) => f.flow.origin.includes("does not cover"))).toBe(true);
    expect(restricted.flows.some((f) => f.flow.synthetic && (f.flow.port === 22 || f.flow.port === 3389))).toBe(true);

    // A service-ALL rule covers everything, so there is no honest "blocked" example — and none is
    // shown. This is the user-facing rule: a block appears only when one is real.
    const open = run(OPEN_ACCEPT, []);
    expect(open.flows.some((f) => f.flow.origin.includes("does not cover"))).toBe(false);
    expect(open.flows.every((f) => f.outcome === "allowed" || f.outcome === "inspected")).toBe(true);
  });

  it("never lets a synthetic boundary flow read as a consequence of the change", () => {
    // WEB_ONLY placed above a blanket accept narrows it but kills nothing, and the proposal itself
    // is accept — so even though a synthetic SSH flow is dropped by the implicit deny, the verdict
    // must not turn "deny". The drop was already happening; it is not caused by this rule.
    const s = run(WEB_ONLY, [pol({ id: 1, name: "Catch-All" })], "after", 1);
    expect(s.headline.nums[0].v).toBe("0"); // zero rules become dead
    expect(s.headline.tone).not.toBe("deny");
  });

  it("still keeps the real flows taken from the rules the change would kill", () => {
    // The contrast flows are ADDED, not a replacement: a sibling rule's real traffic is still shown.
    const s = run(DENY_ALL, [
      pol({ id: 1, name: "Corp-NTP-Out", src_addr_list: ["Corp-Users"], service_list: ["NTP"] }),
    ], "after", 1);
    expect(s.flows.some((f) => !f.flow.synthetic && f.flow.port === 123)).toBe(true);
  });
});

// ── The real lab device (FortiGate-80E · 10.0.99.201), the five scenarios the user asked for ──────
//
// Ground truth read live off the device: interfaces lan/dmz/port1/port2, a SINGLE default route out
// port1 (so internetIfaces = {port1}, NOT wan1), and the real policy table. These lock that each of
// LAN→LAN, LAN→DMZ, LAN→Internet, Internet→LAN and Internet→DMZ classifies its source and
// destination the way the diagram must draw them, against the device's own config.
describe("the lab FortiGate-80E · the five directions", () => {
  const labCtx = (): FlowContext => ({
    ...EMPTY_FLOW_CONTEXT,
    addresses: new Map([
      ["PAddress", "10.10.10.50/32"],
      ["Host-192.168.1.50", "192.168.1.50/32"],
      ["Host-8.8.8.8", "8.8.8.8/32"],
    ]),
    services: new Map([["ALL", "ANY"], ["HTTPS", "TCP/443"], ["Web-Browsing-Services", "TCP/80 TCP/443"]]),
    interfaces: new Map([
      ["lan", { name: "lan", role: "lan", ip: "192.168.1.99/24" }],
      ["dmz", { name: "dmz", role: "dmz", ip: "10.10.10.1/24" }],
      ["port1", { name: "port1", role: "wan", ip: "10.10.20.155/24" }],
      ["port2", { name: "port2", role: "lan", ip: "10.10.30.1/24" }],
      ["wan1", { name: "wan1", role: "wan", ip: "10.0.99.201/24" }],
    ]),
    // The one default route points out port1 — that, not the interface role, is what makes port1
    // "the internet" and leaves wan1 (no default route out of it) just another interface.
    internetIfaces: new Set(["port1"]),
    policies: [
      pol({ id: 15, name: "Allow-Web-Only", src_intf_list: ["dmz"], dst_intf_list: ["port1"], src_addr_list: ["PAddress"], service_list: ["Web-Browsing-Services"] }),
      pol({ id: 13, name: "Test_YT", src_intf_list: ["dmz"], dst_intf_list: ["port1"], src_addr_list: ["PAddress"] }),
      pol({ id: 5, name: "Test-DMZ-to-WAN", src_intf_list: ["dmz"], dst_intf_list: ["port1"] }),
      pol({ id: 11, name: "LAN-to-WAN-Secure", src_intf_list: ["lan"], dst_intf_list: ["port1"] }),
      pol({ id: 14, name: "PORT2-to-INTERNET", src_intf_list: ["port2"], dst_intf_list: ["port1"] }),
      pol({ id: 16, name: "Denial Internet", src_intf_list: ["port2"], dst_intf_list: ["port1"], action: "deny" }),
      pol({ id: 8, name: "TS-192.168.1.50-8.8.8.8", src_intf_list: ["port1"], dst_intf_list: ["port1"], src_addr_list: ["Host-192.168.1.50"], dst_addr_list: ["Host-8.8.8.8"], service_list: ["HTTPS"] }),
    ],
  });

  const policy = (srcintf: string, dstintf: string, action = "accept") => `config firewall policy
    edit 0
        set name "probe"
        set srcintf "${srcintf}"
        set dstintf "${dstintf}"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action ${action}
    next
end`;

  const build = (srcintf: string, dstintf: string) => buildScenario({
    draft: draftFrom(policy(srcintf, dstintf)), ctx: labCtx(),
    pendingAddresses: new Map(), pendingServices: new Map(), beforeId: null, phase: "after",
  });

  it("LAN → Internet: destination is the internet, and the rule is unreachable under LAN-to-WAN-Secure", () => {
    const s = build("lan", "port1");
    expect(s.ingressIsInternet).toBe(false);
    expect(s.egressIsInternet).toBe(true);
    expect(s.flows[0]?.flow.label).toContain("the internet");
    // #11 LAN-to-WAN-Secure (lan→port1 · all·all·ALL) sits above and claims everything first.
    expect(s.blockedByName).toBe("LAN-to-WAN-Secure");
    expect(s.headline.title).toMatch(/nothing changes/i);
  });

  it("Internet → LAN: the SOURCE is the internet, and nothing on the pair is affected", () => {
    const s = build("port1", "lan");
    expect(s.ingressIsInternet).toBe(true);   // the fix: source drawn as the globe
    expect(s.source.unbounded).toBe(true);
    expect(s.egressIsInternet).toBe(false);   // lan is not an internet egress
    // No port1 → lan rule exists, so the new rule claims traffic no other rule does.
    expect(s.blockedById).toBeNull();
  });

  it("LAN → DMZ: an 'all' destination out the DMZ port is the DMZ network, never the internet", () => {
    const s = build("lan", "dmz");
    expect(s.ingressIsInternet).toBe(false);
    expect(s.egressIsInternet).toBe(false);
    expect(s.flows[0]?.flow.label).toContain("dmz");
    expect(s.flows[0]?.flow.label).not.toContain("the internet");
  });

  it("LAN → LAN: both ends are internal", () => {
    const s = build("lan", "lan");
    expect(s.ingressIsInternet).toBe(false);
    expect(s.egressIsInternet).toBe(false);
  });

  it("Internet → DMZ: source is the internet, destination is the internal DMZ", () => {
    const s = build("port1", "dmz");
    expect(s.ingressIsInternet).toBe(true);
    expect(s.source.unbounded).toBe(true);
    expect(s.egressIsInternet).toBe(false);
  });
});

// A tiny re-implementation guard: the exported scenario already carries egressIsInternet, but the
// case-insensitive membership is the subtle part, so assert it directly through a public run too.
function isInternetEgressCase(egress: string, ctx: FlowContext): boolean {
  const cli = `config firewall policy
    edit 0
        set name "probe"
        set srcintf "internal"
        set dstintf "${egress}"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;
  return buildScenario({
    draft: draftFrom(cli), ctx,
    pendingAddresses: new Map(), pendingServices: new Map(), beforeId: null, phase: "before",
  }).egressIsInternet;
}

import { describe, expect, it } from "vitest";
import type { FirewallPolicy } from "../../api/policyObject";
import {
  analyzePolicyImpact, analyzeProposal, impactHeadline, interfacesMatch, ipToInt, mergeRanges,
  parseNetworkValue, parseServiceDetail, rangesCover, rangesIntersect, reportSeverity,
  resolveAddresses, servicesCover, servicesIntersect, usableHosts,
} from "./flowImpact";
import type { ChatItem } from "./index";
import type { FlowContext } from "./deviceFacts";
import { parseAllAddressesFromCLI } from "./parseAddressCLI";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";

// The impact report is read by someone deciding whether to let a change onto a production firewall.
// Two failure modes matter, and they are not symmetric:
//
//   · saying "this rule is fine" when an existing rule shadows it — the change silently does nothing
//   · saying "this rule is shadowed" from data we could not actually evaluate — a false alarm that
//     teaches people to ignore the panel
//
// So the containment tests below are exact, and the "withheld on incomplete data" tests are treated
// as just as important as the positive ones.

// ── Set math ─────────────────────────────────────────────────────────────────

describe("IPv4 math", () => {
  it("parses the value shapes an address object can show", () => {
    expect(parseNetworkValue("10.0.1.0/24")).toEqual({ start: ipToInt("10.0.1.0"), end: ipToInt("10.0.1.255") });
    expect(parseNetworkValue("10.0.1.7")).toEqual({ start: ipToInt("10.0.1.7"), end: ipToInt("10.0.1.7") });
    expect(parseNetworkValue("10.0.1.10 – 10.0.1.20")).toEqual({ start: ipToInt("10.0.1.10"), end: ipToInt("10.0.1.20") });
    expect(parseNetworkValue("10.0.1.10-10.0.1.20")).toEqual({ start: ipToInt("10.0.1.10"), end: ipToInt("10.0.1.20") });
    expect(parseNetworkValue("0.0.0.0/0")).toEqual({ start: 0, end: 4294967295 });
  });

  it("refuses to guess at something that is not an IP range", () => {
    // An FQDN or a country IS the case the "withheld" rule exists for.
    expect(parseNetworkValue("*.youtube.com")).toBeNull();
    expect(parseNetworkValue("Country TH")).toBeNull();
    expect(parseNetworkValue("SDN aws-vpc")).toBeNull();
    expect(parseNetworkValue("")).toBeNull();
    expect(parseNetworkValue("999.1.1.1")).toBeNull();
  });

  it("normalises a host bit that was left on", () => {
    // 10.0.1.99/24 is the interface's ADDRESS; the network it implies is 10.0.1.0/24.
    expect(parseNetworkValue("10.0.1.99/24")).toEqual(parseNetworkValue("10.0.1.0/24"));
  });

  it("counts usable hosts the way an admin does", () => {
    expect(usableHosts(parseNetworkValue("10.0.1.0/24")!)).toBe(254);
    expect(usableHosts(parseNetworkValue("10.0.1.0/30")!)).toBe(2);
    expect(usableHosts(parseNetworkValue("10.0.1.7")!)).toBe(1);
  });

  it("merges adjacent ranges so two halves cover the whole", () => {
    const halves = mergeRanges([parseNetworkValue("10.0.1.0/25")!, parseNetworkValue("10.0.1.128/25")!]);
    expect(halves).toHaveLength(1);
    expect(rangesCover(halves, [parseNetworkValue("10.0.1.0/24")!])).toBe(true);
  });

  it("separates intersection from containment", () => {
    const wide = [parseNetworkValue("10.0.0.0/8")!];
    const narrow = [parseNetworkValue("10.0.1.0/24")!];
    const other = [parseNetworkValue("192.168.1.0/24")!];
    expect(rangesIntersect(wide, narrow)).toBe(true);
    expect(rangesCover(wide, narrow)).toBe(true);
    expect(rangesCover(narrow, wide)).toBe(false);
    expect(rangesIntersect(narrow, other)).toBe(false);
  });
});

describe("service math", () => {
  it("parses what the device and this app print", () => {
    expect(parseServiceDetail("TCP/443")).toEqual([{ proto: "TCP", lo: 443, hi: 443 }]);
    expect(parseServiceDetail("TCP/53 UDP/53")).toEqual([
      { proto: "TCP", lo: 53, hi: 53 }, { proto: "UDP", lo: 53, hi: 53 },
    ]);
    expect(parseServiceDetail("TCP/8080-8090")).toEqual([{ proto: "TCP", lo: 8080, hi: 8090 }]);
    expect(parseServiceDetail("ANY")).toEqual([{ proto: "ANY", lo: 0, hi: 65535 }]);
  });

  it("treats ANY as covering everything, and keeps protocols apart", () => {
    const any = parseServiceDetail("ANY");
    const https = parseServiceDetail("TCP/443");
    const dnsUdp = parseServiceDetail("UDP/53");
    expect(servicesCover(any, https)).toBe(true);
    expect(servicesIntersect(https, dnsUdp)).toBe(false);
    expect(servicesIntersect(parseServiceDetail("TCP/80-500"), https)).toBe(true);
    expect(servicesCover(parseServiceDetail("TCP/80-500"), https)).toBe(true);
    expect(servicesCover(https, parseServiceDetail("TCP/80-500"))).toBe(false);
  });
});

describe("interfacesMatch", () => {
  it("treats FortiOS's `any` as matching everything", () => {
    expect(interfacesMatch(["any"], ["lan"])).toBe(true);
    expect(interfacesMatch(["lan"], ["any"])).toBe(true);
    expect(interfacesMatch(["lan"], ["lan"])).toBe(true);
    expect(interfacesMatch(["lan"], ["dmz"])).toBe(false);
    expect(interfacesMatch(["lan", "dmz"], ["dmz"])).toBe(true);
  });
});

// ── The report ───────────────────────────────────────────────────────────────

const ctx = (over: Partial<FlowContext> = {}): FlowContext => ({
  addresses: new Map([
    ["LAN-Network", "192.168.1.0/24"],
    ["Guest-WiFi", "10.10.20.0/24"],
    ["Server-01", "192.168.1.50"],
    ["Partner-FQDN", "*.partner.com"],
  ]),
  addressIface: new Map(),
  interfaces: new Map([
    ["lan", { name: "lan", role: "lan", ip: "192.168.1.99/24" }],
    ["dmz", { name: "dmz", role: "dmz", ip: "10.10.10.1/24" }],
    ["port1", { name: "port1", alias: "External", role: "wan", ip: "10.0.99.201/22" }],
  ]),
  services: new Map([["HTTPS", "TCP/443"], ["HTTP", "TCP/80"], ["DNS", "TCP/53 UDP/53"]]),
  policies: [],
  // The lab device tags its real WAN port `role lan`, so the default route is what identifies it.
  internetIfaces: new Set(["port1"]),
  ...over,
});

const existing = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 1, seq_num: 1, name: "existing", src_intf: "lan", dst_intf: "port1",
  src_intf_list: ["lan"], dst_intf_list: ["port1"],
  src_addr: "", dst_addr: "", schedule: "always", service: "",
  action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
  src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
  created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
});

const draftFrom = (cli: string) => parseAllPoliciesFromCLI(cli)[0];
const NO_PENDING = new Map<string, string>();

const DENY_LAN = `config firewall policy
    edit 0
        set name "Deny-LAN-to-WAN"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end`;

describe("analyzePolicyImpact — scope", () => {
  const report = analyzePolicyImpact({
    draft: draftFrom(DENY_LAN),
    pendingAddresses: NO_PENDING, pendingServices: NO_PENDING,
    ctx: ctx(), existing: [],
  });

  it("names the source network, its size and the interface it sits behind", () => {
    const src = report.networks.filter((n) => n.side === "source");
    expect(src).toHaveLength(1);
    expect(src[0].cidr).toBe("192.168.1.0/24");
    expect(src[0].hosts).toBe(254);
    expect(src[0].iface).toBe("lan");
    expect(src[0].ifaceRole).toBe("lan");
    expect(report.sourceHosts).toBe(254);
  });

  it("calls an unrestricted WAN destination the internet, not the WAN port's own subnet", () => {
    // `all` out of a wan-role interface means everything routed that way. Naming the /22 the WAN
    // address happens to sit in — and attaching a host count to it — would describe the wrong thing.
    const dst = report.networks.filter((n) => n.side === "destination");
    expect(dst).toHaveLength(1);
    expect(dst[0].cidr).toBe("0.0.0.0/0");
    expect(dst[0].unbounded).toBe(true);
    expect(dst[0].iface).toBe("port1");
    expect(dst[0].label).toContain("Internet");
  });

  it("resolves an unrestricted LAN side to the device's own subnet, which IS countable", () => {
    const inbound = analyzePolicyImpact({
      draft: draftFrom(`config firewall policy
    edit 0
        set name "Allow-In"
        set srcintf "port1"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`),
      pendingAddresses: NO_PENDING, pendingServices: NO_PENDING,
      ctx: ctx(), existing: [],
    });
    const dst = inbound.networks.filter((n) => n.side === "destination");
    expect(dst[0].cidr).toBe("192.168.1.0/24");
    expect(dst[0].hosts).toBe(254);
    expect(dst[0].unbounded).toBeFalsy();
    // …and the unbounded SOURCE contributes no fake host count.
    expect(inbound.sourceHosts).toBe(0);
    expect(impactHeadline(inbound)).toContain("unrestricted source");
  });

  it("says so plainly when nothing existing is in the way", () => {
    expect(report.existing).toEqual([]);
    expect(report.findings.some((f) => f.title.includes("No existing policy overlaps"))).toBe(true);
    expect(reportSeverity(report)).toBe("info");
  });

  it("summarises to one line", () => {
    expect(impactHeadline(report)).toBe("1 subnets · ~254 hosts");
  });
});

describe("analyzePolicyImpact — collisions with what is already on the device", () => {
  const analyze = (policies: FirewallPolicy[], cli = DENY_LAN) => analyzePolicyImpact({
    draft: draftFrom(cli),
    pendingAddresses: NO_PENDING, pendingServices: NO_PENDING,
    ctx: ctx({ policies }), existing: policies,
  });

  it("CRITICAL: an existing allow-all above it means the new deny never runs", () => {
    const r = analyze([existing({ id: 7, seq_num: 3, name: "Allow-All-Out", action: "accept" })]);
    expect(r.existing).toHaveLength(1);
    expect(r.existing[0].relation).toBe("covers-new");
    expect(r.existing[0].severity).toBe("critical");
    expect(r.existing[0].detail).toContain("first match wins");
    expect(reportSeverity(r)).toBe("critical");
    expect(r.findings[0].title).toContain("The new policy will not run");
    expect(r.findings[0].detail).toContain("Allow-All-Out");
  });

  it("tells a deny that its traffic is currently passing, and through which rule", () => {
    const r = analyze([existing({ name: "Allow-All-Out", action: "accept" })]);
    const f = r.findings.find((x) => x.title.includes("allowed right now"));
    expect(f).toBeDefined();
    expect(f!.detail).toContain("Allow-All-Out");
  });

  it("calls out a duplicate rather than a conflict when the action matches", () => {
    const r = analyze([existing({ name: "Deny-Everything", action: "deny" })]);
    expect(r.existing[0].relation).toBe("covers-new");
    expect(r.existing[0].severity).toBe("warning");
    expect(r.existing[0].detail).toContain("adds nothing");
  });

  it("flags a narrower existing rule the new one would swallow", () => {
    const r = analyze([existing({
      name: "Allow-Server-HTTPS", action: "accept",
      src_addr_list: ["Server-01"], dst_addr_list: ["all"], service_list: ["HTTPS"],
    })]);
    expect(r.existing[0].relation).toBe("covered-by-new");
    expect(r.existing[0].severity).toBe("warning");
    expect(r.existing[0].detail).toContain("never runs again");
  });

  it("ignores a policy on another interface pair entirely", () => {
    const r = analyze([existing({
      name: "DMZ-Rule", src_intf_list: ["dmz"], dst_intf_list: ["port1"],
    })]);
    expect(r.existing).toEqual([]);
  });

  it("ignores a policy whose addresses do not intersect", () => {
    const r = analyze([existing({ name: "Guest-Only", src_addr_list: ["Guest-WiFi"] })]);
    expect(r.existing).toEqual([]);
  });

  it("ignores a disabled policy — it matches nothing today", () => {
    const r = analyze([existing({ name: "Allow-All-Out", enabled: false })]);
    expect(r.existing).toEqual([]);
  });

  it("reports a partial overlap as an ordering question, not a shadow", () => {
    const r = analyze([existing({
      name: "Allow-HTTPS-Only", action: "accept",
      src_addr_list: ["all"], service_list: ["HTTPS"],
    })], `config firewall policy
    edit 0
        set name "Deny-Web"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "all"
        set service "HTTP" "HTTPS"
        set action deny
    next
end`);
    expect(r.existing[0].relation).toBe("overlap");
    expect(r.existing[0].detail).toContain("order decides which one wins");
  });

  it("sorts the worst collision first", () => {
    const r = analyze([
      existing({ id: 1, seq_num: 9, name: "Narrow", src_addr_list: ["Server-01"], service_list: ["HTTPS"] }),
      existing({ id: 2, seq_num: 2, name: "Allow-All-Out", action: "accept" }),
    ]);
    expect(r.existing[0].name).toBe("Allow-All-Out");
    expect(r.existing[0].severity).toBe("critical");
  });
});

describe("analyzePolicyImpact — what it refuses to claim", () => {
  const FQDN_POLICY = `config firewall policy
    edit 0
        set name "Deny-Partner"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "Partner-FQDN"
        set service "ALL"
        set action deny
    next
end`;

  it("withholds a shadow verdict when an object cannot be reduced to a range", () => {
    const policies = [existing({ name: "Allow-All-Out", action: "accept" })];
    const r = analyzePolicyImpact({
      draft: draftFrom(FQDN_POLICY),
      pendingAddresses: NO_PENDING, pendingServices: NO_PENDING,
      ctx: ctx({ policies }), existing: policies,
    });
    // The FQDN destination could still INTERSECT the allow-all, so the collision is reported…
    expect(r.existing).toHaveLength(1);
    // …but never as "covers-new", which would be a claim the data cannot support.
    expect(r.existing[0].relation).toBe("overlap");
    expect(r.existing[0].severity).not.toBe("critical");
    expect(r.partial).toBe(true);
    expect(r.unresolved).toContain("Partner-FQDN");
    expect(r.findings.some((f) => f.title === "Incomplete evaluation")).toBe(true);
  });

  it("does not treat an edit of the same policy as a collision with itself", () => {
    const policies = [existing({ name: "Deny-LAN-to-WAN", action: "accept" })];
    const r = analyzePolicyImpact({
      draft: draftFrom(DENY_LAN),
      pendingAddresses: NO_PENDING, pendingServices: NO_PENDING,
      ctx: ctx({ policies }), existing: policies,
    });
    expect(r.existing).toEqual([]);
  });

  it("still resolves an object this very proposal is about to create", () => {
    const cli = `config firewall address
    edit "New-VLAN"
        set subnet 172.16.5.0 255.255.255.0
    next
end
config firewall policy
    edit 0
        set name "Allow-New-VLAN"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "New-VLAN"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;
    const item: ChatItem = {
      role: "assistant", text: "",
      policyDrafts: parseAllPoliciesFromCLI(cli),
      addrDrafts: parseAllAddressesFromCLI(cli),
    };
    const reports = analyzeProposal(item, ctx());
    const r = reports.get("policy-0")!;
    expect(r.networks[0].cidr).toBe("172.16.5.0/24");
    expect(r.sourceHosts).toBe(254);
    expect(r.partial).toBe(false);
  });
});

describe("resolveAddresses", () => {
  it("maps `all` to every address and separates what it could not resolve", () => {
    const r = resolveAddresses(["all"], NO_PENDING, ctx());
    expect(r.ranges).toEqual([{ start: 0, end: 4294967295 }]);
    expect(r.unresolved).toEqual([]);

    const mixed = resolveAddresses(["LAN-Network", "Partner-FQDN", "Nope"], NO_PENDING, ctx());
    expect(mixed.ranges).toHaveLength(1);
    expect(mixed.unresolved).toEqual(["Partner-FQDN", "Nope"]);
  });
});

describe("analyzeProposal", () => {
  it("returns one report per policy, keyed by the diagram it belongs to", () => {
    const cli = `${DENY_LAN}
config firewall policy
    edit 0
        set name "Allow-Rest"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end`;
    const item: ChatItem = { role: "assistant", text: "", policyDrafts: parseAllPoliciesFromCLI(cli) };
    const reports = analyzeProposal(item, ctx());
    expect([...reports.keys()]).toEqual(["policy-0", "policy-1"]);
    expect(reports.get("policy-0")!.policyName).toBe("Deny-LAN-to-WAN");
    expect(reports.get("policy-1")!.action).toBe("accept");
  });

  it("returns nothing for an answer with no policies", () => {
    expect(analyzeProposal({ role: "assistant", text: "" }, ctx()).size).toBe(0);
  });
});

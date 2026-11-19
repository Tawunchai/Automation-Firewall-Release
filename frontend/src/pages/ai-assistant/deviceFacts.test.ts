import { describe, expect, it } from "vitest";
import {
  addressDetail, hasFlowDrafts, hasPolicyDrafts, pendingObjectMaps, scheduleDetail, serviceDetail,
} from "./deviceFacts";
import type { ChatItem } from "./index";
import { parseAllAddressesFromCLI } from "./parseAddressCLI";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import { parseAllServicesFromCLI } from "./parseServiceCLI";

// These helpers turn a draft into the one value the rest of the page reasons about — the subnet
// behind a name, the ports behind a service. Everything downstream (the simulation, the impact
// report, the Apply dialog) inherits whatever they get wrong, so the formats stay pinned here.
//
// They came out of flowModel.ts when the diagram code it lived in was deleted; these assertions
// came with them.

const CLI = `config firewall address
    edit "LAN-Subnet"
        set subnet 10.0.1.0 255.255.255.0
    next
end
config firewall service custom
    edit "Web-8443"
        set tcp-portrange 8443
    next
end
config firewall policy
    edit 0
        set name "Deny-LAN-to-WAN"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN-Subnet"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end`;

const itemFromCLI = (cli: string): ChatItem => ({
  role: "assistant",
  text: "",
  policyDrafts: parseAllPoliciesFromCLI(cli),
  addrDrafts: parseAllAddressesFromCLI(cli),
  svcDrafts: parseAllServicesFromCLI(cli),
});

describe("detail formatting", () => {
  it("converts a FortiOS subnet to CIDR", () => {
    expect(addressDetail({ type: "ipmask", subnet: "10.0.1.0 255.255.255.0" })).toBe("10.0.1.0/24");
    expect(addressDetail({ type: "fqdn", fqdn: "*.youtube.com" })).toBe("*.youtube.com");
    expect(addressDetail({ type: "geography", country: "TH" })).toBe("Country TH");
  });

  it("infers the value field when the CLI omits `set type`", () => {
    expect(addressDetail({ subnet: "192.168.1.0 255.255.255.0" })).toBe("192.168.1.0/24");
  });

  it("prints service ports the way the Services page does", () => {
    expect(serviceDetail({
      protocol: "TCP/UDP/SCTP",
      destPorts: [{ id: 1, protocol: "TCP", low: "443", high: "", srcLow: "", srcHigh: "" }],
    })).toBe("TCP/443");
    expect(serviceDetail({ protocol: "IP", ipProto: 50 })).toBe("IP/50");
    expect(serviceDetail({ protocol: "ICMP", icmpType: -1, icmpCode: -1 })).toBe("ICMP/any");
  });

  it("prints a schedule as days plus hours", () => {
    expect(scheduleDetail({ name: "x", type: "recurring", day: ["monday"], start: "08:00", end: "17:00" }))
      .toBe("Mon · 08:00 – 17:00");
    expect(scheduleDetail({ name: "x", type: "onetime", start: "2026/01/01 08:00", end: "2026/01/02 17:00" }))
      .toBe("2026/01/01 08:00 – 2026/01/02 17:00");
  });
});

describe("hasFlowDrafts / hasPolicyDrafts", () => {
  it("is false for a query answer that creates nothing", () => {
    expect(hasFlowDrafts({ role: "assistant", text: "get system status" })).toBe(false);
    expect(hasPolicyDrafts({ role: "assistant", text: "get system status" })).toBe(false);
  });

  it("is true as soon as one object of any kind was parsed", () => {
    expect(hasFlowDrafts(itemFromCLI(CLI))).toBe(true);
  });

  it("separates 'creates something' from 'creates a POLICY'", () => {
    // Only a policy carries traffic, so only a policy can be walked down the rule table. An answer
    // that makes three address objects has plenty to show and nothing to simulate.
    const objectsOnly = itemFromCLI(`config firewall address
    edit "LAN-Subnet"
        set subnet 10.0.1.0 255.255.255.0
    next
end`);
    expect(hasFlowDrafts(objectsOnly)).toBe(true);
    expect(hasPolicyDrafts(objectsOnly)).toBe(false);
  });
});

describe("pendingObjectMaps", () => {
  it("resolves an object this answer has not created yet", () => {
    // The whole point: the simulation can evaluate a policy that references an address the firewall
    // has never heard of, because the same answer defines it a few lines higher.
    const { addresses, services } = pendingObjectMaps(itemFromCLI(CLI));
    expect(addresses.get("LAN-Subnet")).toBe("10.0.1.0/24");
    expect(services.get("Web-8443")).toBe("TCP/8443");
  });

  it("is empty for a message that defines nothing", () => {
    const { addresses, services } = pendingObjectMaps({ role: "assistant", text: "" });
    expect(addresses.size).toBe(0);
    expect(services.size).toBe(0);
  });
});

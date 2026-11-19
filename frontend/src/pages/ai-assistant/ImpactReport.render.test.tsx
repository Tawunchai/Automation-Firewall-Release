import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImpactReport from "./ImpactReport";
import { analyzePolicyImpact } from "./flowImpact";
import type { FirewallPolicy } from "../../api/policyObject";
import type { FlowContext } from "./deviceFacts";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";

// This panel is what someone reads before approving a change to a production firewall. The things
// that must be on screen are the numbers (how big is this), the verdict (does it work), and the
// name of whatever is in the way — checked here so a refactor cannot quietly drop one.

const ctx: FlowContext = {
  addresses: new Map([["LAN-Network", "192.168.1.0/24"]]),
  addressIface: new Map(),
  interfaces: new Map([
    ["lan", { name: "lan", role: "lan", ip: "192.168.1.99/24" }],
    ["port1", { name: "port1", alias: "External", role: "wan", ip: "10.0.99.201/22" }],
  ]),
  services: new Map([["HTTPS", "TCP/443"]]),
  policies: [],
  internetIfaces: new Set(["port1"]),
};

const allowAll: FirewallPolicy = {
  id: 4, seq_num: 2, name: "Allow-All-Out", src_intf: "lan", dst_intf: "port1",
  src_intf_list: ["lan"], dst_intf_list: ["port1"],
  src_addr: "", dst_addr: "", schedule: "always", service: "",
  action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
  src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
  created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
};

const CLI = `config firewall policy
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

const report = analyzePolicyImpact({
  draft: parseAllPoliciesFromCLI(CLI)[0],
  pendingAddresses: new Map(), pendingServices: new Map(),
  ctx, existing: [allowAll],
});

const html = renderToStaticMarkup(<ImpactReport report={report} accent="#845ADF" />);

describe("ImpactReport", () => {
  it("leads with the blast radius", () => {
    expect(html).toContain("source networks affected");
    expect(html).toContain("~254");
    expect(html).toContain("hosts in scope");
    expect(html).toContain("existing policies involved");
  });

  it("names the affected network and the interface it sits behind", () => {
    expect(html).toContain("192.168.1.0/24");
    expect(html).toContain("LAN-Network");
    expect(html).toContain("behind lan");
    expect(html).toContain("Source");
    expect(html).toContain("Destination");
  });

  it("states the verdict that decides whether the rule works at all", () => {
    expect(html).toContain("The new policy will not run");
    expect(html).toContain("Allow-All-Out");
    expect(html).toContain("shadows the new policy");
  });

  it("shows the offending policy's own position and action", () => {
    expect(html).toContain("#2 Allow-All-Out");
    expect(html).toContain("ACCEPT");
  });

  it("colours by theme token, so it reads in dark mode too", () => {
    expect(html).toContain("var(--flow-deny)");
    expect(html).not.toMatch(/color:#(dc2626|f87171)/i);
  });

  it("says when the device is still being read", () => {
    const loading = renderToStaticMarkup(<ImpactReport report={report} accent="#845ADF" loading />);
    expect(loading).toContain("Reading from the device");
    expect(html).not.toContain("Reading from the device");
  });
});

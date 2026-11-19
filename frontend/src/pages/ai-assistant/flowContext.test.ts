import { describe, expect, it } from "vitest";
import { buildFlowContext } from "./flowContext";
import { buildScenario } from "./packetSim";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type {
  AddressObject, FirewallPolicy, ServiceObject, StaticRoute, SystemInterface, VirtualIP,
} from "../../api/policyObject";

// THE BUG THIS FILE EXISTS FOR.
//
// The walk on the lab FortiGate's `port1 -> lan` pair stopped on its very first rule and reported
// "0/2 arrive" for a policy that was, in fact, fine. That rule is an inbound DNAT rule — the most
// ordinary thing there is on a WAN-facing interface pair — and its dstaddr names a VIP:
//
//     edit 4   set srcintf "port1"   set dstintf "lan"   set dstaddr "Web_Server_VIP"
//
// firewall/vip is a separate table from firewall/address, and the context only ever read the
// second. So the name resolved to nothing, verdictFor() returned `unsure`, and the walk halted
// rather than guess — correct behaviour on top of an incomplete lookup, which is the worst kind of
// wrong: the picture looked like a finding.
//
// These fixtures are the lab device's own values (10.0.99.201, FGT80E 7.2.10), so a regression
// reproduces what was actually seen on screen rather than an invented shape.

const addr = (over: Partial<AddressObject>): AddressObject => ({
  id: 0, name: "", type: "ipmask", subnet: "", start_ip: "", end_ip: "", interface: "",
  comment: "", color: 0, country: "", mac_addrs: [], allow_routing: false, sub_type: "",
  sdn: "", sdn_addr_type: "", builtin: false, ref_count: 0, created_at: "", updated_at: "",
  ...over,
});

const vip = (over: Partial<VirtualIP>): VirtualIP => ({
  name: "", comment: "", type: "static-nat", interface: "any",
  ext_ip: "", mapped_ip: "", ext_addr: "", mapped_addr: "",
  source_filter: [], services: [], port_forward: false, protocol: "tcp",
  port_mapping_type: "1-to-1", ext_port: "", mapped_port: "",
  ...over,
});

const svc = (name: string, details: string): ServiceObject => ({
  id: 0, name, protocol: "TCP/UDP/SCTP", tcp_ports: "", udp_ports: "", sctp_ports: "",
  ip_proto: 0, icmp_type: -1, icmp_code: -1, category: "General", comment: "", color: 0,
  ip_fqdn: "", builtin: true, details, ref_count: 0, created_at: "", updated_at: "",
} as unknown as ServiceObject);

const iface = (name: string, role: string, ip: string, alias = ""): SystemInterface => ({
  name, alias, type: "physical", vdom: "root", ip, status: "up", role, vlanid: 0,
  interface: "", mode: "static", allowaccess: [], description: "", members: [],
} as unknown as SystemInterface);

const route = (dst: string, device: string): StaticRoute => ({
  seq_num: 2, dst_type: "subnet", dst, gateway: "10.0.99.1", device, device_alias: "",
  distance: 10, priority: 0, weight: 0, enabled: true, comment: "", blackhole: false,
  dstaddr: "", internet_service: 0, internet_service_name: "",
} as unknown as StaticRoute);

const pol = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 0, seq_num: 0, name: "",
  src_intf: "", dst_intf: "", src_intf_list: [], dst_intf_list: [],
  src_addr: "", dst_addr: "", schedule: "always", service: "",
  action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
  src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
  created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
} as unknown as FirewallPolicy);

const ADDRESSES = [
  addr({ name: "LAN-Network", subnet: "192.168.1.0/24" }),
  addr({ name: "Host-8.8.8.8", subnet: "8.8.8.8/32" }),
  addr({ name: "Host-192.168.1.50", subnet: "192.168.1.50/32" }),
];
const SERVICES = [svc("ALL", "ANY"), svc("HTTPS", "TCP/443")];
const INTERFACES = [
  iface("port1", "lan", "10.0.99.201/22", "External"),
  iface("lan", "lan", "192.168.1.99/24"),
  iface("wan1", "wan", "172.200.200.1/30", "WAN1"),
];
const ROUTES = [route("0.0.0.0/0", "port1")];
const VIPS = [vip({
  name: "Web_Server_VIP", ext_ip: "203.150.100.10", mapped_ip: "192.168.1.100", interface: "port1",
})];

/** The two rules that already sit on `port1 -> lan`, in device order. */
const INBOUND_TABLE = (): FirewallPolicy[] => [
  pol({
    id: 4, seq_num: 9, name: "Web-Server", src_intf_list: ["port1"], dst_intf_list: ["lan"],
    src_addr_list: ["all"], dst_addr_list: ["Web_Server_VIP"], service_list: ["ALL"],
  }),
  pol({
    id: 9, seq_num: 10, name: "TS-8.8.8.8-192.168.1.50", src_intf_list: ["port1"],
    dst_intf_list: ["lan"], src_addr_list: ["Host-8.8.8.8"], dst_addr_list: ["Host-192.168.1.50"],
    service_list: ["HTTPS"], nat: false,
  }),
];

const WAN_TO_LAN = `config firewall policy
    edit 0
        set name "WAN-to-LAN-2"
        set srcintf "port1"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "LAN-Network"
        set service "ALL"
        set action accept
        set nat disable
        set av-profile "default"
    next
end`;

const scenarioWith = (vips: VirtualIP[]) => {
  const ctx = buildFlowContext(ADDRESSES, SERVICES, INTERFACES, INBOUND_TABLE(), ROUTES, vips);
  return buildScenario({
    draft: parseAllPoliciesFromCLI(WAN_TO_LAN)[0], ctx,
    pendingAddresses: new Map(), pendingServices: new Map(), beforeId: null, phase: "after",
  });
};

describe("buildFlowContext — virtual IPs", () => {
  it("resolves a VIP name to its EXTERNAL address, which is what a packet is addressed to", () => {
    const ctx = buildFlowContext([], [], [], [], [], VIPS);
    expect(ctx.addresses.get("Web_Server_VIP")).toBe("203.150.100.10");
  });

  it("keeps an fqdn-type VIP as a name, so comparisons against it stay undecidable", () => {
    const ctx = buildFlowContext([], [], [], [], [], [
      vip({ name: "Portal-VIP", type: "fqdn", ext_addr: "portal.example.com" }),
    ]);
    expect(ctx.addresses.get("Portal-VIP")).toBe("portal.example.com");
  });

  it("does not let a VIP shadow an address object of the same name", () => {
    const ctx = buildFlowContext(
      [addr({ name: "Web_Server_VIP", subnet: "10.9.9.9/32" })], [], [], [], [], VIPS,
    );
    expect(ctx.addresses.get("Web_Server_VIP")).toBe("10.9.9.9/32");
  });

  it("carries VIPs through even when every other list is empty", () => {
    expect(buildFlowContext([], [], [], [], [], VIPS).addresses.size).toBe(1);
  });
});

describe("the inbound walk that used to stop on its first rule", () => {
  it("halts with UNKNOWN when the VIP cannot be resolved (the regression)", () => {
    const s = scenarioWith([]);
    expect(s.flows.length).toBeGreaterThan(0);
    expect(s.flows.every((f) => f.outcome === "unknown")).toBe(true);
    expect(s.flows[0].blockedBy).toContain("Web_Server_VIP");
    expect(s.flows[0].rule?.name).toBe("Web-Server");
  });

  it("walks past the DNAT rule and reaches the proposal once VIPs are loaded", () => {
    const s = scenarioWith(VIPS);
    expect(s.flows.length).toBeGreaterThan(0);
    for (const f of s.flows) {
      expect(f.outcome).not.toBe("unknown");
      // 203.150.100.10 is not inside 192.168.1.0/24, so the DNAT rule is SKIPPED, not matched.
      expect(f.rule?.name).not.toBe("Web-Server");
    }
    // The proposal carries an AV profile, so what it claims is inspected rather than waved through.
    expect(s.flows[0].rule?.isNew).toBe(true);
    expect(s.flows[0].outcome).toBe("inspected");
  });

  it("stops filing 'could not be evaluated' against the Impact tab", () => {
    // `scenario.unresolved` only ever carries the PROPOSAL's own objects, so an undecidable name on
    // a LIVE rule surfaces here instead — which is the line the user was reading on screen.
    const cannotEvaluate = (s: ReturnType<typeof scenarioWith>) =>
      s.breaks.filter((b) => b.title.includes("could not be evaluated"));
    expect(cannotEvaluate(scenarioWith([])).length).toBeGreaterThan(0);
    expect(cannotEvaluate(scenarioWith(VIPS))).toHaveLength(0);
  });
});

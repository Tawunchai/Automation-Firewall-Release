import { describe, expect, it } from "vitest";
import { buildTopology, hasInspection, edgeTone, type TopologyInput, type TopoEdge } from "./model";
import type { SystemInterface, StaticRoute, FirewallPolicy } from "../../api/policyObject";
import type { IPsecTunnel } from "../../api/vpn";

// The map is a PROJECTION of the config, so the tests are about what the projection is allowed to
// lose and what it must never invent.

const iface = (over: Partial<SystemInterface>): SystemInterface => ({
  name: "port1", alias: "", type: "physical", vdom: "root", ip: "", status: "up",
  role: "undefined", vlanid: 0, interface: "", mode: "static", allowaccess: [],
  description: "", vlan_protocol: "", device_identification: "", members: [],
  ...over,
} as SystemInterface);

const policy = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 1, seq_num: 1, name: "p", src_intf: "lan", dst_intf: "wan1",
  src_intf_list: [], dst_intf_list: [], src_addr: "", dst_addr: "",
  schedule: "always", service: "", action: "accept", nat: false, log_traffic: "all",
  enabled: true, comments: "", src_addr_list: ["all"], dst_addr_list: ["all"],
  service_list: ["ALL"], created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
} as FirewallPolicy);

const input = (over: Partial<TopologyInput> = {}): TopologyInput => ({
  interfaces: [iface({ name: "lan", ip: "192.168.1.1/24", role: "lan" }),
               iface({ name: "wan1", ip: "203.0.113.1/30", role: "wan" })],
  zones: [], routes: [], tunnels: [], policies: [],
  deviceName: "fgt-lab", unreadable: [],
  ...over,
});

describe("buildTopology — nodes", () => {
  it("puts the device in the middle and one node per interface", () => {
    const t = buildTopology(input());
    expect(t.nodes.map((n) => n.id).sort()).toEqual(["device", "if:lan", "if:wan1"]);
  });

  // FortiOS keeps ssl.root / l2t.root / naf.root on every unit. They are features, not cables, and
  // drawing them would put three nodes on every map that nobody configured.
  it("drops the system pseudo-tunnels", () => {
    const t = buildTopology(input({
      interfaces: [iface({ name: "lan" }), iface({ name: "ssl.root", type: "tunnel" }),
                   iface({ name: "l2t.root", type: "tunnel" }), iface({ name: "naf.root", type: "tunnel" })],
    }));
    expect(t.nodes.map((n) => n.id)).toEqual(["device", "if:lan"]);
  });

  // ⚠️ A zone is what a POLICY names, so the zone is the node. Drawing the members as well would
  // put two nodes on the map for one thing a rule can reference, and the edges would attach to
  // whichever one the policy happened to spell.
  it("absorbs a zoned interface into its zone", () => {
    const t = buildTopology(input({
      interfaces: [iface({ name: "wan1" }), iface({ name: "wan2" }), iface({ name: "lan" })],
      zones: [{ name: "outside", interfaces: ["wan1", "wan2"], intrazone: "deny", description: "" }],
    }));
    const ids = t.nodes.map((n) => n.id);
    expect(ids).toContain("zone:outside");
    expect(ids).not.toContain("if:wan1");
    expect(ids).not.toContain("if:wan2");
    expect(ids).toContain("if:lan");
  });

  // The 80E's `lan` hard-switch holds eleven ports with no address that no policy can name.
  it("folds hard-switch members into their container", () => {
    const t = buildTopology(input({
      interfaces: [
        iface({ name: "lan", type: "hard-switch", ip: "192.168.1.1/24", members: ["port2", "port3"] }),
        iface({ name: "port2" }), iface({ name: "port3" }),
      ],
    }));
    expect(t.nodes.map((n) => n.id)).toEqual(["device", "if:lan"]);
    expect(t.nodes.find((n) => n.id === "if:lan")?.members).toEqual(["port2", "port3"]);
  });

  // ⚠️ An internet cloud with no default route pointing at it is a drawn guess.
  it("draws the internet only when a default route says there is one", () => {
    expect(buildTopology(input()).nodes.some((n) => n.kind === "internet")).toBe(false);

    const route: StaticRoute = {
      seq_num: 1, dst_type: "subnet", dst: "0.0.0.0/0", gateway: "203.0.113.2",
      device: "wan1", device_alias: "", distance: 10, priority: 0, weight: 0,
      enabled: true, comment: "", blackhole: false, dstaddr: "",
      internet_service: 0, internet_service_name: "",
    };
    const t = buildTopology(input({ routes: [route] }));
    expect(t.nodes.find((n) => n.kind === "internet")?.detail).toContain("wan1");
  });

  it("ignores a disabled default route", () => {
    const route = {
      seq_num: 1, dst_type: "subnet", dst: "0.0.0.0/0", gateway: "203.0.113.2",
      device: "wan1", device_alias: "", distance: 10, priority: 0, weight: 0,
      enabled: false, comment: "", blackhole: false, dstaddr: "",
      internet_service: 0, internet_service_name: "",
    } as StaticRoute;
    expect(buildTopology(input({ routes: [route] })).nodes.some((n) => n.kind === "internet")).toBe(false);
  });

  it("adds a node per IPsec tunnel and counts the ones that are up", () => {
    const tun = (name: string, up: boolean): IPsecTunnel => ({
      name, interface: "wan1", remote_gw: "198.51.100.1", ike_version: "2", type: "static",
      comments: "", up, phase2: [], ref_count: 0, kind: "custom",
    });
    const t = buildTopology(input({ tunnels: [tun("branch-a", true), tun("branch-b", false)] }));
    expect(t.stats.tunnels).toBe(2);
    expect(t.stats.tunnelsUp).toBe(1);
  });
});

describe("buildTopology — edges", () => {
  it("draws one path per permitted interface pair", () => {
    const t = buildTopology(input({ policies: [policy({ av_profile: "default" })] }));
    expect(t.edges).toHaveLength(1);
    expect(t.edges[0]).toMatchObject({ from: "if:lan", to: "if:wan1", policies: 1, uninspected: false });
  });

  // ⚠️ A disabled rule permits nothing today. Drawing it would show exposure that does not exist.
  it("ignores disabled policies", () => {
    expect(buildTopology(input({ policies: [policy({ enabled: false })] })).edges).toHaveLength(0);
  });

  it("marks a path with no security profile", () => {
    const t = buildTopology(input({ policies: [policy({})] }));
    expect(t.edges[0].uninspected).toBe(true);
    expect(t.stats.uninspectedPaths).toBe(1);
  });

  // certificate-inspection does not inspect anything — it just does not break TLS.
  it("does not count certificate-inspection as inspection", () => {
    expect(hasInspection(policy({ ssl_ssh_profile: "certificate-inspection" }))).toBe(false);
    expect(hasInspection(policy({ ssl_ssh_profile: "deep-inspection" }))).toBe(true);
  });

  it("folds several rules on one pair into one path, taking the worst of them", () => {
    const t = buildTopology(input({
      policies: [
        policy({ id: 1, av_profile: "default" }),
        policy({ id: 2 }),                       // no inspection
        policy({ id: 3, nat: true, av_profile: "default" }),
      ],
    }));
    expect(t.edges).toHaveLength(1);
    expect(t.edges[0]).toMatchObject({ policies: 3, uninspected: true, nat: true, denyOnly: false });
    expect(t.edges[0].policyIds).toEqual([1, 2, 3]);
  });

  it("marks a pair whose rules are all denies", () => {
    const t = buildTopology(input({ policies: [policy({ action: "deny" })] }));
    expect(t.edges[0].denyOnly).toBe(true);
    expect(t.stats.uninspectedPaths).toBe(0); // a deny is not an uninspected path
  });

  // ⚠️ "any" is not a place. A cable to a node that does not exist is worse than no cable.
  it("draws no path for a rule on any/any", () => {
    expect(buildTopology(input({ policies: [policy({ src_intf: "any", dst_intf: "any" })] })).edges)
      .toHaveLength(0);
  });

  it("attaches a zoned pair to the zone, not to the member", () => {
    const t = buildTopology(input({
      interfaces: [iface({ name: "wan1" }), iface({ name: "lan" })],
      zones: [{ name: "outside", interfaces: ["wan1"], intrazone: "deny", description: "" }],
      policies: [policy({ src_intf: "lan", dst_intf: "wan1", av_profile: "default" })],
    }));
    expect(t.edges[0]).toMatchObject({ from: "if:lan", to: "zone:outside" });
  });

  it("expands a multi-interface policy into one path per combination", () => {
    const t = buildTopology(input({
      interfaces: [iface({ name: "lan" }), iface({ name: "dmz" }), iface({ name: "wan1" })],
      policies: [policy({ src_intf_list: ["lan", "dmz"], dst_intf_list: ["wan1"], av_profile: "default" })],
    }));
    expect(t.edges.map((e) => e.id).sort()).toEqual(["if:dmz->if:wan1", "if:lan->if:wan1"]);
  });
});

describe("buildTopology — honesty", () => {
  it("carries the unreadable sections through untouched", () => {
    const t = buildTopology(input({ unreadable: ["IPsec tunnels"] }));
    expect(t.unreadable).toEqual(["IPsec tunnels"]);
    // and does NOT report them as zero-of-nothing
    expect(t.stats.tunnels).toBe(0);
  });
});

// ⚠️ Caught by running the model over the lab device: the tile read "21 up / 19 interfaces",
// because `up` was counted over the unfiltered list while the total excluded FortiOS's three
// always-up pseudo-tunnels. A ratio whose halves come from different sets is worse than no ratio.
describe("buildTopology — the up/total ratio", () => {
  it("counts up over the same set as the total", () => {
    const t = buildTopology(input({
      interfaces: [
        iface({ name: "lan", status: "up" }),
        iface({ name: "wan2", status: "down" }),
        iface({ name: "ssl.root", type: "tunnel", status: "up" }),
        iface({ name: "l2t.root", type: "tunnel", status: "up" }),
        iface({ name: "naf.root", type: "tunnel", status: "up" }),
      ],
    }));
    expect(t.stats.interfaces).toBe(2);
    expect(t.stats.interfacesUp).toBe(1);
    expect(t.stats.interfacesUp).toBeLessThanOrEqual(t.stats.interfaces);
  });
});

// edgeTone is shared by the SVG and 3D renderers — see model.ts's doc comment — so a path has to
// read the same no matter which one drew it.
describe("edgeTone", () => {
  const edge = (over: Partial<TopoEdge>): TopoEdge => ({
    id: "if:a->if:b", from: "if:a", to: "if:b",
    policies: 1, denyOnly: false, nat: false, uninspected: false, policyIds: [1],
    ...over,
  });

  it("colours a deny-only path red and dashed, never crawling", () => {
    const tone = edgeTone(edge({ denyOnly: true }));
    expect(tone.stroke).toBe("var(--flow-deny)");
    expect(tone.dash).toBeTruthy();
    expect(tone.crawl).toBeFalsy();
  });

  it("colours an uninspected permitted path amber, dashed AND crawling", () => {
    const tone = edgeTone(edge({ uninspected: true }));
    expect(tone.stroke).toBe("var(--flow-warn)");
    expect(tone.crawl).toBe(true);
  });

  it("colours an ordinary permitted path green with a plain solid line", () => {
    const tone = edgeTone(edge({}));
    expect(tone.stroke).toBe("var(--flow-allow)");
    expect(tone.dash).toBeUndefined();
    expect(tone.crawl).toBeUndefined();
  });

  it("denyOnly wins over uninspected when both happen to be set", () => {
    const tone = edgeTone(edge({ denyOnly: true, uninspected: true }));
    expect(tone.stroke).toBe("var(--flow-deny)");
    expect(tone.crawl).toBeFalsy();
  });
});

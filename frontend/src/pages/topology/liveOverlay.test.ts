import { describe, expect, it } from "vitest";
import { buildTopology, type TopologyInput } from "./model";
import { applyLiveOverlay, LOW_BPS, HIGH_BPS } from "./liveOverlay";
import type { SystemInterface, FirewallPolicy } from "../../api/policyObject";
import type { IPsecTunnel } from "../../api/vpn";
import type { TopologyLive } from "../../api/topologyLive";

const tunnel = (name: string, up: boolean): IPsecTunnel => ({
  name, interface: "wan1", remote_gw: "198.51.100.1", ike_version: "2", type: "static",
  comments: "", up, phase2: [], ref_count: 0, kind: "custom",
});

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

const live = (over: Partial<TopologyLive> = {}): TopologyLive => ({
  interfaces: [], tunnels: [], policies: [], ...over,
});

describe("applyLiveOverlay — no live data yet", () => {
  it("returns the nodes unchanged and no edge activity", () => {
    const topo = buildTopology(input({ policies: [policy({})] }));
    const { nodes: out, activity } = applyLiveOverlay(topo, topo.nodes, null);
    expect(out).toBe(topo.nodes);
    expect(activity.size).toBe(0);
  });
});

describe("applyLiveOverlay — interface status", () => {
  it("overrides an interface's up flag from the live read", () => {
    const topo = buildTopology(input());
    const { nodes: out } = applyLiveOverlay(topo, topo.nodes, live({
      interfaces: [{ name: "lan", link: false, rx_bps: 0, tx_bps: 0 }],
    }));
    const lan = out.find((n) => n.id === "if:lan")!;
    expect(lan.up).toBe(false);
  });

  it("leaves an interface the live probe did not name exactly as the config read had it", () => {
    const topo = buildTopology(input());
    const { nodes: out } = applyLiveOverlay(topo, topo.nodes, live({ interfaces: [] }));
    const lan = out.find((n) => n.id === "if:lan")!;
    expect(lan.up).toBe(true); // the config read's own status (iface() defaults to "up")
  });
});

describe("applyLiveOverlay — tunnel status", () => {
  it("treats 'partial' health as up — some traffic is still flowing", () => {
    const topo = buildTopology(input({
      tunnels: [tunnel("vpn1", false)],
    }));
    const { nodes: out } = applyLiveOverlay(topo, topo.nodes, live({
      tunnels: [{ name: "vpn1", health: "partial", phase1_up: true }],
    }));
    const vpn = out.find((n) => n.id === "vpn:vpn1")!;
    expect(vpn.up).toBe(true);
  });

  it("treats 'down' health as down", () => {
    const topo = buildTopology(input({
      tunnels: [tunnel("vpn1", true)],
    }));
    const { nodes: out } = applyLiveOverlay(topo, topo.nodes, live({
      tunnels: [{ name: "vpn1", health: "down", phase1_up: false }],
    }));
    const vpn = out.find((n) => n.id === "vpn:vpn1")!;
    expect(vpn.up).toBe(false);
  });
});

describe("applyLiveOverlay — edge activity", () => {
  it("is 0 (idle) below LOW_BPS", () => {
    const topo = buildTopology(input({ policies: [policy({})] }));
    const { activity } = applyLiveOverlay(topo, topo.nodes, live({
      interfaces: [
        { name: "lan", link: true, rx_bps: 10, tx_bps: 10 },
        { name: "wan1", link: true, rx_bps: 10, tx_bps: 10 },
      ],
    }));
    expect(activity.get("if:lan->if:wan1")).toBe(0);
  });

  it("is 1 (some traffic) between LOW_BPS and HIGH_BPS", () => {
    const topo = buildTopology(input({ policies: [policy({})] }));
    const { activity } = applyLiveOverlay(topo, topo.nodes, live({
      interfaces: [
        { name: "lan", link: true, rx_bps: LOW_BPS, tx_bps: 0 },
        { name: "wan1", link: true, rx_bps: LOW_BPS, tx_bps: 0 },
      ],
    }));
    expect(activity.get("if:lan->if:wan1")).toBe(1);
  });

  it("is 2 (busy) at or above HIGH_BPS", () => {
    const topo = buildTopology(input({ policies: [policy({})] }));
    const { activity } = applyLiveOverlay(topo, topo.nodes, live({
      interfaces: [
        { name: "lan", link: true, rx_bps: HIGH_BPS, tx_bps: 0 },
        { name: "wan1", link: true, rx_bps: HIGH_BPS, tx_bps: 0 },
      ],
    }));
    expect(activity.get("if:lan->if:wan1")).toBe(2);
  });

  it("uses the LESSER endpoint, not the greater — a busy port says nothing about a quiet one", () => {
    const topo = buildTopology(input({ policies: [policy({})] }));
    const { activity } = applyLiveOverlay(topo, topo.nodes, live({
      interfaces: [
        { name: "lan", link: true, rx_bps: HIGH_BPS, tx_bps: 0 }, // busy
        { name: "wan1", link: true, rx_bps: 0, tx_bps: 0 },       // idle
      ],
    }));
    expect(activity.get("if:lan->if:wan1")).toBe(0);
  });
});

describe("applyLiveOverlay — measured vs inferred edge activity", () => {
  it("measures from the policy's own byte delta when a previous reading is given", () => {
    const topo = buildTopology(input({ policies: [policy({ id: 7 })] }));
    const previous = live({ policies: [{ policy_id: 7, bytes: 0 }] });
    const current = live({ policies: [{ policy_id: 7, bytes: Math.round(HIGH_BPS / 8) }] }); // 1s of HIGH_BPS

    const { activity, measured } = applyLiveOverlay(topo, topo.nodes, current, previous, 1);

    expect(measured.has("if:lan->if:wan1")).toBe(true);
    expect(activity.get("if:lan->if:wan1")).toBe(2);
  });

  it("falls back to inference with no previous reading — the very first poll of a session", () => {
    const topo = buildTopology(input({ policies: [policy({ id: 7 })] }));
    const current = live({
      policies: [{ policy_id: 7, bytes: 999_999_999 }],
      interfaces: [
        { name: "lan", link: true, rx_bps: 10, tx_bps: 10 },
        { name: "wan1", link: true, rx_bps: 10, tx_bps: 10 },
      ],
    });

    const { activity, measured } = applyLiveOverlay(topo, topo.nodes, current, null, 0);

    expect(measured.size).toBe(0);
    expect(activity.get("if:lan->if:wan1")).toBe(0); // the inferred (idle) reading, not a guess from the huge counter
  });

  it("falls back to inference when the policy counter went backwards — a reset, not negative traffic", () => {
    const topo = buildTopology(input({ policies: [policy({ id: 7 })] }));
    const previous = live({ policies: [{ policy_id: 7, bytes: 1_000_000 }] });
    const current = live({
      policies: [{ policy_id: 7, bytes: 10 }], // the device rebooted; the counter restarted near zero
      interfaces: [
        { name: "lan", link: true, rx_bps: 10, tx_bps: 10 },
        { name: "wan1", link: true, rx_bps: 10, tx_bps: 10 },
      ],
    });

    const { activity, measured } = applyLiveOverlay(topo, topo.nodes, current, previous, 1);

    expect(measured.has("if:lan->if:wan1")).toBe(false);
    expect(activity.get("if:lan->if:wan1")).toBe(0);
  });

  it("falls back to inference when neither reading names this edge's policy at all", () => {
    const topo = buildTopology(input({ policies: [policy({ id: 7 })] }));
    const previous = live({ policies: [{ policy_id: 99, bytes: 0 }] });
    const current = live({ policies: [{ policy_id: 99, bytes: 1_000_000 }] });

    const { measured } = applyLiveOverlay(topo, topo.nodes, current, previous, 1);

    expect(measured.has("if:lan->if:wan1")).toBe(false);
  });
});

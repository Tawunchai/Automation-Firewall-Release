import { describe, expect, it } from "vitest";
import type { FixPlan, FixStep, PolicyTrace, PolicyVerdict, TraceCheck } from "../../api/troubleshoot";
import {
  closestSentence, endpointKind, fixesFor, fixTitle, flowStages, fmtSpeed, gatewayOf, isPrivateAddress,
  newPolicyCli, planCli, stepSentence, stopIndex, whatIfSentence, wireHeaders,
} from "./trace-model";

// What these pin: the animation stops where the packet stops, every sentence is true of the trace,
// and the suggested fix follows from the rule that actually failed.

const check = (field: TraceCheck["field"], ok: boolean, got = ""): TraceCheck => ({ field, ok, want: [], got, detail: "" });

const policy = (over: Partial<PolicyVerdict> = {}): PolicyVerdict => ({
  policy_id: 1, name: "default", enabled: true, action: "accept", matched: true,
  src_intf: ["lan"], dst_intf: ["port1"], src_addr: ["all"], dst_addr: ["all"], service: ["ALL"],
  schedule: "always", nat: true, utm: false, bytes: 0, packets: 0, active_sessions: 0,
  checks: [], failed: 0, ...over,
});

const trace = (over: Partial<PolicyTrace> = {}): PolicyTrace => ({
  query: { src_ip: "192.168.1.50", dst_ip: "8.8.8.8", protocol: 6, dst_port: 443, src_intf: "" },
  ingress: "lan", ingress_via: "route",
  ingress_route: { success: true, network: "192.168.1.0/24", gateway: "0.0.0.0", interface: "lan" },
  egress: "port1", egress_route: { success: true, network: "0.0.0.0/0", gateway: "10.0.99.1", interface: "port1" },
  routable: true,
  ingress_link: { name: "lan", link: true, speed_mbps: 1000 },
  egress_link: { name: "port1", ip: "10.0.99.201", link: true, speed_mbps: 1000 },
  verdict: "allowed", summary: "", matched: policy(), evaluated: [policy()], below: 0, total: 1,
  snat: { mode: "interface", ip: "10.0.99.201" },
  ...over,
});

describe("flowStages / stopIndex", () => {
  it("runs the packet to the destination when it is allowed", () => {
    const s = flowStages(trace());
    expect(stopIndex(s)).toBe(s.length - 1);
    expect(s.find((x) => x.key === "nat")?.sub).toBe("as 10.0.99.201");
  });

  it("stops at the policy when nothing matches, and greys everything after it", () => {
    const s = flowStages(trace({ verdict: "implicit-deny", matched: null }));
    expect(s[stopIndex(s)].key).toBe("policy");
    expect(s.slice(stopIndex(s) + 1).every((x) => x.state === "skip")).toBe(true);
  });

  it("stops at routing when there is no route — before any policy", () => {
    const s = flowStages(trace({ routable: false, verdict: "no-route", matched: null }));
    expect(s[stopIndex(s)].key).toBe("route");
    expect(s.find((x) => x.key === "policy")?.state).toBe("skip");
  });

  it("stops at the incoming interface when its link is down", () => {
    const s = flowStages(trace({ ingress_link: { name: "lan", link: false, speed_mbps: 0 } }));
    expect(s[stopIndex(s)].key).toBe("ingress");
  });
});

describe("fixes", () => {
  it("turns the closest rule's failed checks into the fix", () => {
    const p = policy({ matched: false, failed: 1, checks: [check("status", false)] });
    expect(closestSentence(p)).toBe("Policy #1 default would match if you enable the policy.");
    const q = policy({ policy_id: 7, name: "Host", matched: false, failed: 2,
      checks: [check("srcaddr", false, "192.168.1.50"), check("service", false, "TCP/443")] });
    expect(closestSentence(q)).toBe("Policy #7 Host would match if you add 192.168.1.50 to its source addresses and add TCP/443 to its services.");
  });

  it("offers a new-policy CLI with placeholders, never invented address names", () => {
    const cli = newPolicyCli(trace({ verdict: "implicit-deny", matched: null }));
    expect(cli).toContain('set service "HTTPS"');
    expect(cli).toContain("<an address object for 192.168.1.50>");
    expect(cli).toContain('set dstintf "port1"');
  });

  it("suggests moving an accept rule that a deny above it hides", () => {
    const f = fixesFor(trace({ verdict: "denied", matched: policy({ policy_id: 3, action: "deny" }),
      shadowed: [policy({ policy_id: 9, action: "accept", matched: false })] }));
    expect(f[0].title).toBe("Move policy #9 above #3");
  });

  it("links an allowed trace to the real log for this pair", () => {
    const f = fixesFor(trace());
    expect(f[0].link?.to).toBe("/admin/logs/local-traffic?log=forward&q=srcip%3D%3D192.168.1.50%20dstip%3D%3D8.8.8.8");
  });
});

describe("endpointKind / isPrivateAddress", () => {
  it("draws a private source as a client and a private destination as a server", () => {
    expect(endpointKind("192.168.1.50", "source")).toBe("client");
    expect(endpointKind("10.0.0.5", "destination")).toBe("server");
  });

  it("draws a public address as the internet on either side", () => {
    expect(endpointKind("8.8.8.8", "destination")).toBe("internet");
    expect(endpointKind("8.8.4.4", "source")).toBe("internet");
  });

  it("draws the mapped server behind a Virtual IP, not the internet", () => {
    const vip = trace({
      query: { src_ip: "8.8.4.4", dst_ip: "203.150.100.10", protocol: 6, dst_port: 8080, src_intf: "" },
      dnat: { vip: "Web_Server_VIP", ext_ip: "203.150.100.10", mapped_ip: "192.168.1.100", port_forward: true },
    });
    const dest = flowStages(vip).find((s) => s.key === "destination")!;
    expect(endpointKind(dest.label, "destination")).toBe("server");
  });

  it("knows the edges of every private range", () => {
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.254")).toBe(true);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.128.0.1")).toBe(false);
    expect(isPrivateAddress("169.254.10.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("2001:4860::8888")).toBe(false);
  });

  it("is not fooled by an address that only looks private at a glance", () => {
    expect(isPrivateAddress("192.169.1.1")).toBe(false);
    expect(isPrivateAddress("11.0.0.1")).toBe(false);
  });

  it("treats anything malformed as public rather than inventing a host", () => {
    expect(isPrivateAddress("10.0.0.300")).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(false);
    expect(isPrivateAddress("")).toBe(false);
  });
});

describe("fix it", () => {
  const step = (over: Partial<FixStep>): FixStep => ({ op: "create-address", table: "firewall/address", name: "", cli: "", ...over });
  const plan = (over: Partial<FixPlan> = {}): FixPlan => ({
    id: "create", kind: "create", steps: [], fingerprint: "f",
    scope: { policy_id: 0, policy_name: "TS-x", src_intf: [], dst_intf: [], src_addr: [], dst_addr: [], service: [], broad: false },
    ...over,
  });
  const denied = trace({ verdict: "implicit-deny", matched: null, closest: [policy({ policy_id: 2, name: "Testing" })] });

  it("puts the narrow new-policy fix first and links it to its plan", () => {
    const f = fixesFor({ ...denied, fixes: [plan(), plan({ id: "adjust-2", kind: "adjust", policy_id: 2 })] });
    expect(f[0]).toMatchObject({ title: "Add a policy for exactly this connection", planId: "create" });
    expect(f[1]).toMatchObject({ title: "Adjust policy #2", planId: "adjust-2" });
    // The placeholder CLI is gone once the plan carries the real one.
    expect(f.some((x) => x.cli?.includes("<an address object"))).toBe(false);
  });

  it("keeps the written advice, with its CLI, when the trace carries no plan", () => {
    const f = fixesFor(denied);
    expect(f.every((x) => !x.planId)).toBe(true);
    expect(f.find((x) => x.title === "Or add a policy for this traffic")?.cli).toContain("config firewall policy");
  });

  it("links a rule-order fix to its move plan", () => {
    const deny = policy({ policy_id: 10, name: "Block", action: "deny" });
    const t = trace({ verdict: "denied", matched: deny, shadowed: [policy({ policy_id: 1 })], fixes: [plan({ id: "move-1", kind: "move" })] });
    expect(fixesFor(t)[0]).toMatchObject({ title: "Move policy #1 above #10", planId: "move-1" });
  });

  it("names each kind of plan", () => {
    expect(fixTitle(plan())).toBe("A new policy for exactly this connection");
    expect(fixTitle(plan({ ref_id: 10 }))).toBe("A new policy for exactly this connection, above #10");
    expect(fixTitle(plan({ kind: "move", policy_id: 5, policy_name: "Allow", ref_id: 3 }))).toBe("Move policy #5 Allow above #3");
    expect(fixTitle(plan({ kind: "adjust", policy_id: 2, policy_name: "" }))).toBe("Adjust policy #2 (unnamed)");
  });

  it("says each step in words", () => {
    expect(stepSentence(step({ name: "Host-192.168.1.50", value: "192.168.1.50/32" }))).toBe("Create address Host-192.168.1.50 for 192.168.1.50/32");
    expect(stepSentence(step({ op: "add-member", name: "2", field: "dstintf", value: "lan" }))).toBe("Add lan to the outgoing interfaces of policy #2");
    expect(stepSentence(step({ op: "enable-policy", name: "30" }))).toBe("Enable policy #30");
    expect(stepSentence(step({ op: "move-policy", name: "new", value: "10" }))).toBe("Place the new policy above #10");
    expect(stepSentence(step({ op: "move-policy", name: "5", value: "3" }))).toBe("Move policy #5 above #3");
  });

  it("describes the simulated outcome, naming a created policy as new", () => {
    const after = trace({ matched: policy({ policy_id: 0, name: "TS-192.168.1.50-192.168.1.60" }) });
    expect(whatIfSentence(after)).toBe("192.168.1.50 → 8.8.8.8 (TCP/443) would be allowed by the new policy TS-192.168.1.50-192.168.1.60.");
    expect(flowStages(after).find((s) => s.key === "policy")?.label).toBe("New policy");
    expect(whatIfSentence(trace())).toBe("192.168.1.50 → 8.8.8.8 (TCP/443) would be allowed by policy #1 default.");
  });

  it("copies every step's CLI in order", () => {
    expect(planCli(plan({ steps: [step({ cli: "a" }), step({ cli: "b" })] }))).toBe("a\n\nb");
  });
});

describe("gatewayOf", () => {
  it("returns the next hop of a routed network", () => {
    expect(gatewayOf({ success: true, network: "0.0.0.0/0", gateway: "10.0.99.1", interface: "port1" })).toBe("10.0.99.1");
  });

  it("draws no router for a directly connected network", () => {
    expect(gatewayOf({ success: true, network: "192.168.1.0/24", gateway: "0.0.0.0", interface: "lan" })).toBeNull();
  });

  it("draws no router when there is no route at all", () => {
    expect(gatewayOf({ success: false, network: "", gateway: "10.0.99.1", interface: "" })).toBeNull();
    expect(gatewayOf(undefined)).toBeNull();
  });
});

describe("fmtSpeed", () => {
  it("writes the badge the way a switch port label does", () => {
    expect(fmtSpeed(100)).toBe("100M");
    expect(fmtSpeed(1000)).toBe("1G");
    expect(fmtSpeed(2500)).toBe("2.5G");
    expect(fmtSpeed(10000)).toBe("10G");
  });

  it("shows nothing for a speed the device did not report", () => {
    expect(fmtSpeed(0)).toBe("");
    expect(fmtSpeed(undefined)).toBe("");
  });
});

describe("wireHeaders", () => {
  it("shows source NAT rewriting only the source", () => {
    const h = wireHeaders(trace());
    expect(h.before).toMatchObject({ src: "192.168.1.50", dst: "8.8.8.8:443" });
    expect(h.after).toEqual({ src: "10.0.99.201", dst: "8.8.8.8:443", srcChanged: true, dstChanged: false });
  });

  it("falls back to the egress interface's own address when the SNAT ip is not given", () => {
    expect(wireHeaders(trace({ snat: { mode: "interface" } })).after?.src).toBe("10.0.99.201");
  });

  it("never prints a bare interface name where the translated address belongs", () => {
    const h = wireHeaders(trace({ snat: { mode: "interface" }, egress: "lan", egress_link: undefined }));
    expect(h.after?.src).toBe("lan IP");
  });

  it("shows a Virtual IP rewriting the destination and its forwarded port", () => {
    const h = wireHeaders(trace({
      query: { src_ip: "8.8.4.4", dst_ip: "203.150.100.10", protocol: 6, dst_port: 8080, src_intf: "" },
      snat: undefined,
      dnat: { vip: "Web_Server_VIP", ext_ip: "203.150.100.10", mapped_ip: "192.168.1.100", port_forward: true, ext_port: "8080", mapped_port: "80" },
    }));
    expect(h.before.dst).toBe("203.150.100.10:8080");
    expect(h.after).toEqual({ src: "8.8.4.4", dst: "192.168.1.100:80", srcChanged: false, dstChanged: true });
  });

  it("marks nothing changed when the policy does no NAT", () => {
    const h = wireHeaders(trace({ snat: undefined }));
    expect(h.after).toMatchObject({ srcChanged: false, dstChanged: false });
  });

  it("carries no port for ICMP", () => {
    expect(wireHeaders(trace({ query: { src_ip: "192.168.1.50", dst_ip: "8.8.8.8", protocol: 1, dst_port: 0, src_intf: "" } })).before.dst)
      .toBe("8.8.8.8");
  });

  it("has no far-side header for a packet that is dropped", () => {
    expect(wireHeaders(trace({ verdict: "implicit-deny", matched: null })).after).toBeNull();
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PacketOverview from "./PacketOverview";
import { buildScenario, type SimPhase } from "./packetSim";
import { EMPTY_FLOW_CONTEXT } from "./deviceFacts";
import { GLOBE_D, SHIELD_D } from "./packetSimLayout";
import { PANEL_TRAFFIC } from "./walkClock";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type { FirewallPolicy } from "../../api/policyObject";

// The panel's picture: a network, the device, the internet. What it has to get right is the story —
// three nodes in the order a packet meets them, one lane per sample flow, and an honest count at the
// far end. The rule-by-rule detail is PacketWalk's job and is tested there.

const CLI = `config firewall policy
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

const pol = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 1, seq_num: 1, name: "Corp-NTP-Out",
  src_intf: "", dst_intf: "", src_intf_list: ["internal"], dst_intf_list: ["wan1"],
  src_addr: "", dst_addr: "", schedule: "always", service: "",
  action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
  src_addr_list: ["Corp-Users"], dst_addr_list: ["all"], service_list: ["NTP"],
  created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
});

function scenarioFor(phase: SimPhase = "after") {
  return buildScenario({
    draft: parseAllPoliciesFromCLI(CLI)[0],
    ctx: {
      ...EMPTY_FLOW_CONTEXT,
      addresses: new Map([["Corp-Users", "10.20.0.0/16"]]),
      services: new Map([["ALL", "ANY"], ["NTP", "UDP/123"]]),
      interfaces: new Map([
        ["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }],
        ["wan1", { name: "wan1", role: "wan", ip: "203.0.113.14/30" }],
      ]),
      // wan1 is the internet-facing interface, so an "all" destination out of it is the internet.
      internetIfaces: new Set(["wan1"]),
      policies: [pol({ id: 1, name: "Corp-NTP-Out" }), pol({ id: 2, name: "Corp-Catch-All", service_list: ["ALL"] })],
    },
    pendingAddresses: new Map(),
    pendingServices: new Map(),
    beforeId: 1,
    phase,
  });
}

const draw = (phase: SimPhase = "after", props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <PacketOverview scenario={scenarioFor(phase)} accent="#845ADF" {...props} />,
  );

describe("PacketOverview", () => {
  it("draws the three nodes a packet meets, in order", () => {
    const html = draw("after", { deviceName: "FortiGate-80E" });
    expect(html).toContain(">SOURCE<");
    expect(html).toContain("FortiGate-80E");
    expect(html).toContain(">Internet<");
    // The device is the shield and the internet is a globe, both drawn at a FIXED size inside a
    // card. The destination used to be a cloud scaled to its column, which made the least
    // informative node the biggest object in the picture.
    expect(html).toContain(SHIELD_D);
    expect(html).toContain(GLOBE_D.disc);
    expect(html).toContain(GLOBE_D.meridian);
  });

  it("gives every sample flow its own lane and its own tail", () => {
    const s = scenarioFor();
    const html = draw();
    s.flows.forEach((_, i) => {
      // Several packets per lane — the panel shows a device under load, not one packet followed.
      for (let g = 0; g < PANEL_TRAFFIC.inFlight; g++) {
        expect(html).toContain(`data-ov-lane="${i}-${g}"`);
        expect(html).toContain(`data-ov-tail="${i}-${g}-0"`);
      }
      // And no more than that: the panel deliberately carries less than the full walk, because
      // three per flow in a 700px box beside a chat column reads as a swarm.
      expect(html).not.toContain(`data-ov-lane="${i}-${PANEL_TRAFFIC.inFlight}"`);
    });
  });

  it("names the rule that decided, which is what the full table exists to establish", () => {
    const s = scenarioFor();
    const html = draw();
    const decided = s.flows[0].rule;
    expect(html).toContain(`#${decided?.shown} ${decided?.name}`);
  });

  it("counts what actually arrives, never what was sent", () => {
    const s = scenarioFor();
    const arrived = s.flows.filter((f) => f.outcome !== "dropped" && f.outcome !== "unknown").length;
    expect(draw()).toContain(`${arrived}/${s.flows.length} arrive`);
  });

  it("keeps the destination the same size whatever the column is", () => {
    // The regression this guards: a glyph scaled to its own column. At full-screen width that
    // produced a 170px balloon carrying two words — the least informative node drawn as the
    // biggest object in the picture. Every scale in the drawing is now a shrink.
    const scales = [...draw().matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(scales.length).toBeGreaterThan(0);
    for (const v of scales) expect(v).toBeLessThanOrEqual(1.2);
  });

  it("draws a drop marker only for a flow that dies inside the device", () => {
    const s = scenarioFor();
    const html = draw();
    s.flows.forEach((f, i) => {
      const marked = html.includes(`data-ov-drop="${i}"`);
      expect(marked).toBe(f.outcome === "dropped" || f.outcome === "unknown");
    });
  });

  it("draws no rule table — that is the other picture's job", () => {
    const html = draw();
    expect(html).not.toContain('data-row="0"');
    expect(html).not.toContain("rules passed over");
  });

  it("takes every colour from a theme token or the accent — never a bare hex", () => {
    const hexes = draw().match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    for (const h of hexes) expect(h.toLowerCase()).toContain("845adf");
  });

  it("scales to its container and never forces a sideways scroll", () => {
    const html = draw();
    expect(html).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(html).toContain("width:100%");
    expect(html).not.toContain("min-width");
  });

  it("has no transport, and hides the stage chips in the still form", () => {
    // The progress bar, the running clock and the speed switch are gone: they described a
    // recording, and the traffic in this panel does not end. What is left is the stages, as
    // buttons that replay the lookup, and the still form has no controls at all.
    expect(draw()).not.toContain('type="range"');
    expect(draw("after", { still: true })).not.toContain("data-walkstep");
    expect(draw()).toContain("data-walkstep");
  });

  it("names the finding for a screen reader instead of leaving an unlabelled graphic", () => {
    expect(draw()).toContain('role="img"');
    expect(draw()).toContain(scenarioFor().headline.title);
  });

  it("draws the source as the internet when the traffic arrives from the WAN", () => {
    // The "Internet → LAN" case: an unrestricted source on an internet-facing interface is the
    // internet, and the source node becomes the globe rather than a "0.0.0.0/0" card.
    const INBOUND = `config firewall policy
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
    const scenario = buildScenario({
      draft: parseAllPoliciesFromCLI(INBOUND)[0],
      ctx: {
        ...EMPTY_FLOW_CONTEXT,
        services: new Map([["ALL", "ANY"]]),
        interfaces: new Map([
          ["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }],
          ["wan1", { name: "wan1", role: "wan", ip: "203.0.113.14/30" }],
        ]),
        internetIfaces: new Set(["wan1"]),
        policies: [],
      },
      pendingAddresses: new Map(), pendingServices: new Map(), beforeId: null, phase: "after",
    });
    const html = renderToStaticMarkup(<PacketOverview scenario={scenario} accent="#845ADF" />);
    expect(html).toContain(GLOBE_D.disc);
    expect(html).toContain(">Internet<");
    expect(html).toContain("any source · on wan1");
  });
});

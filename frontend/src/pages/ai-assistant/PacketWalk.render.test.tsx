import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PacketWalk from "./PacketWalk";
import { buildScenario, type SimPhase } from "./packetSim";
import { EMPTY_FLOW_CONTEXT } from "./deviceFacts";
import { GLOBE_D } from "./packetSimLayout";
import { IN_FLIGHT } from "./walkClock";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type { FirewallPolicy } from "../../api/policyObject";

// What the renderer has to get right is mostly invisible in a diff: a colour written as a raw hex
// instead of a theme token (unreadable in the other theme), a fill painted as a presentation
// attribute holding var() (silently ignored), a packet with no hook for the clock to move it.
//
// Rendered to static markup rather than mounted: the animation is imperative and does not run
// server-side, so what this checks is the FIRST FRAME — which is also what a paused panel, a
// reduced-motion visitor and the still frame in the chat all get.

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
      interfaces: new Map([["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }]]),
      internetIfaces: new Set(["wan1"]),
      policies: [
        pol({ id: 1, name: "Corp-NTP-Out" }),
        pol({ id: 2, name: "Other-Pair", src_intf_list: ["dmz"] }),
      ],
    },
    pendingAddresses: new Map(),
    pendingServices: new Map(),
    beforeId: 1,
    phase,
  });
}

/** The same proposal against a rule base big enough for the walk to be a WINDOW onto it. */
function bigScenario() {
  return buildScenario({
    draft: parseAllPoliciesFromCLI(CLI)[0],
    ctx: {
      ...EMPTY_FLOW_CONTEXT,
      addresses: new Map([["Corp-Users", "10.20.0.0/16"]]),
      services: new Map([["ALL", "ANY"], ["NTP", "UDP/123"]]),
      interfaces: new Map([["internal", { name: "internal", role: "lan", ip: "10.20.0.1/16" }]]),
      internetIfaces: new Set(["wan1"]),
      policies: [
        ...Array.from({ length: 18 }, (_, i) =>
          pol({ id: 100 + i, name: `Other-Pair-${i}`, src_intf_list: ["dmz"] })),
        pol({ id: 1, name: "Corp-NTP-Out" }),
      ],
    },
    pendingAddresses: new Map(),
    pendingServices: new Map(),
    beforeId: 1,
    phase: "after",
  });
}

const draw = (phase: SimPhase = "after", props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <PacketWalk scenario={scenarioFor(phase)} accent="#845ADF" {...props} />,
  );

describe("PacketWalk", () => {
  it("draws one row per simulated row, and hooks each one for the clock", () => {
    const html = draw();
    const s = scenarioFor();
    for (let i = 0; i < s.rows.length; i++) {
      expect(html).toContain(`data-row="${i}"`);
    }
  });

  it("gives every packet a lane the clock can move", () => {
    const s = scenarioFor();
    const html = draw();
    // One lane per packet, not per flow: each flow keeps IN_FLIGHT of them in the air.
    s.flows.forEach((_, i) => {
      for (let g = 0; g < IN_FLIGHT; g++) expect(html).toContain(`data-lane="${i}-${g}"`);
    });
  });

  it("labels each packet with the port it carries, so two flows are told apart", () => {
    const html = draw();
    expect(html).toMatch(/443\/tcp|123\/udp/);
  });

  it("takes every colour from a theme token or the accent — never a bare hex", () => {
    const html = draw();
    // The one hex allowed is the accent, which is a prop and cannot be a token.
    const hexes = html.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    for (const h of hexes) expect(h.toLowerCase()).toContain("845adf");
  });

  it("paints through style, not through fill/stroke attributes that would drop var()", () => {
    const html = draw();
    expect(html).not.toMatch(/fill="var\(/);
    expect(html).not.toMatch(/stroke="var\(/);
    expect(html).toMatch(/style="[^"]*fill:var\(/);
  });

  it("names the finding for a screen reader instead of leaving an unlabelled graphic", () => {
    const html = draw();
    const s = scenarioFor();
    expect(html).toContain('role="img"');
    expect(html).toContain(s.headline.title);
  });

  it("draws the arrow marker it references", () => {
    const html = draw();
    expect(html).toContain('id="pw-arrow"');
    expect(html).toContain('marker-end="url(#pw-arrow)"');
  });

  it("hides the stage chips in the still form, and shows them otherwise", () => {
    expect(draw("after", { still: true })).not.toContain("data-walkstep");
    expect(draw()).toContain("data-walkstep");
  });

  it("has no transport at all — the traffic never stops, so there is nothing to drive", () => {
    // A progress bar, a running clock and a speed switch described this as a recording: something
    // with a length, a position in it, and a playback rate. Packets now stream continuously, so a
    // progress bar measures something with no end and the speed switch offered a choice between
    // "too fast to read" and the speed it should always have run at.
    const html = draw();
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('aria-label="Scrub the simulation"');
    expect(html).not.toContain('aria-label="Play"');
    expect(html).not.toContain('aria-label="Pause"');
    expect(html).not.toContain('aria-label="Replay"');
    for (const speed of ["0.5\u00d7", "1\u00d7", "2\u00d7"]) expect(html).not.toContain(speed);
    // What is left names the moment it jumps to, rather than a percentage of a running time.
    expect(html).toContain("Policy lookup");
  });

  it("puts several packets of every flow in the air at once", () => {
    // One packet per flow made this a diagram of an event. Traffic arrives continuously, and the
    // picture is worth watching precisely because the rule table is under load.
    const html = draw();
    for (let g = 0; g < IN_FLIGHT; g++) expect(html).toContain(`data-lane="0-${g}"`);
    // But only the lead packet carries the port pill: three copies chasing each other down one
    // wire is noise, and what it says is a property of the flow, stated once.
    expect(html).toContain('data-lane-label="0-0"');
    expect(html).not.toContain('data-lane-label="0-1"');
  });

  it("draws the minimap only when the walk is a window onto a bigger rule base", () => {
    // 19 policies, most of them elided into bands: "where am I in this?" is a real question and the
    // bar answers it.
    const big = bigScenario();
    const total = big.rows.reduce(
      (n, r) => n + (r.kind === "band" ? r.count : (r.key === "implicit" ? 0 : 1)), 0);
    const wide = renderToStaticMarkup(<PacketWalk scenario={big} accent="#845ADF" />);
    expect(wide).toContain(`ALL ${total}`);
    // And never in the chat bubble, which has no room for it.
    expect(renderToStaticMarkup(<PacketWalk scenario={big} accent="#845ADF" variant="compact" />))
      .not.toContain("ALL ");
  });

  it("leaves the minimap out of a table that already shows every rule", () => {
    // Four policies, all of them on screen. The bar was then a grey column beside a complete table
    // — the first thing a reader had to decide to ignore, in the one place with spare width.
    expect(draw("after")).not.toContain("ALL ");
  });

  it("never asks the reader to scroll sideways", () => {
    // The drawing is laid out from the measured width, so the SVG scales to its container instead
    // of forcing one. A min-width here is what produced the horizontal scrollbar in the panel.
    for (const props of [{}, { variant: "compact" }, { still: true }]) {
      expect(draw("after", props)).not.toContain("min-width");
    }
  });

  it("scales to its container rather than to a fixed drawing size", () => {
    const html = draw();
    expect(html).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(html).toContain("width:100%");
  });

  it("draws an outbound wire only for a flow that actually gets out", () => {
    const s = scenarioFor("before");
    const html = draw("before");
    s.flows.forEach((f, i) => {
      const drawn = html.includes(`data-path="out-${i}"`);
      expect(drawn).toBe(f.outcome !== "dropped" && f.outcome !== "unknown");
    });
  });

  it("marks the proposal so it cannot be mistaken for a rule already on the device", () => {
    expect(draw()).toContain(">NEW<");
    expect(draw("before")).not.toContain(">NEW<");
  });

  it("draws the device, with the rule table inside its walls", () => {
    const html = draw("after", { deviceName: "FortiGate-80E" });
    expect(html).toContain("FortiGate-80E");
    // The interface pair belongs on the chassis header, where it is stated once.
    expect(html).toContain("internal → wan1 · first match wins");
  });

  it("puts no pills on the wall the packets cross", () => {
    // Interface pills on both walls plus a NAT badge on the wire stacked three labels into the
    // busiest forty pixels of the drawing, and each repeated something already on screen: the
    // interface pair is on the chassis header, NAT is a property of the rule and lives in the
    // Rules tab. The join has to stay legible more than it has to be annotated.
    const html = draw("after", { deviceName: "FortiGate-80E" });
    expect(html).not.toContain("data-port=");
    expect(html).not.toContain("data-nat=");
    expect(html).not.toContain(">NAT<");
  });

  it("ends at a globe when the traffic is bound for the internet", () => {
    const html = draw("before");
    expect(html).toContain(">INTERNET<");
    expect(html).toContain(">Internet<");
    // A globe in a card the same family as the source card — the same node drawn by the same
    // component the panel's overview uses, so the two pictures cannot disagree about it.
    expect(html).toContain(GLOBE_D.disc);
    expect(html).toContain(GLOBE_D.meridian);
  });

  it("gives every packet a comet tail, so its direction is readable at a glance", () => {
    const s = scenarioFor();
    const html = draw();
    s.flows.forEach((_, i) => {
      for (let g = 0; g < IN_FLIGHT; g++) {
        expect(html).toContain(`data-tail="${i}-${g}-0"`);
        expect(html).toContain(`data-tail="${i}-${g}-2"`);
      }
    });
  });

  it("no longer draws an inspection column", () => {
    // The profiles are a property of the rule that matched. They are stated on the flow chip and in
    // the Impact tab; a fifth column of chips crowded the one thing worth looking at, and on a
    // narrow panel it collided with the NAT pill.
    const html = draw();
    expect(html).not.toContain("INSPECTION");
    expect(html).not.toContain("data-utm");
  });
});

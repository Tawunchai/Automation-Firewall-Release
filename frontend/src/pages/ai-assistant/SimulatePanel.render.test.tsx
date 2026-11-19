import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SimulatePanel from "./SimulatePanel";
import { EMPTY_FLOW_CONTEXT, type FlowContext } from "./deviceFacts";
import { parseAllAddressesFromCLI } from "./parseAddressCLI";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type { ChatItem } from "./index";
import type { FirewallPolicy } from "../../api/policyObject";

// A smoke test for the panel the Simulate button opens. The maths is pinned in packetSim.test.ts
// and the two drawings in PacketWalk.render.test.tsx and PacketOverview.render.test.tsx; what these
// catch is the class of failure none of those can — a panel that throws on a message with no policy,
// or on a policy whose source is an FQDN and therefore has no packet to send.
//
// The chat used to render a still frame of the simulation under every proposal. It does not any
// more: nothing is drawn until the button is pressed, which is what the last test here pins.

const pol = (over: Partial<FirewallPolicy>): FirewallPolicy => ({
  id: 1, seq_num: 1, name: "Catch-All",
  src_intf: "", dst_intf: "", src_intf_list: ["lan"], dst_intf_list: ["wan1"],
  src_addr: "", dst_addr: "", schedule: "always", service: "",
  action: "accept", nat: true, log_traffic: "all", enabled: true, comments: "",
  src_addr_list: ["all"], dst_addr_list: ["all"], service_list: ["ALL"],
  created_at: "", updated_at: "",
  ippool: false, poolname: [], fixedport: false, protocol_options: "",
  av_profile: "", webfilter_profile: "", dnsfilter_profile: "", app_control: "",
  ips_sensor: "", file_filter_profile: "", ssl_ssh_profile: "", decrypted_traffic_mirror: "",
  ...over,
});

const ctx: FlowContext = {
  ...EMPTY_FLOW_CONTEXT,
  addresses: new Map([["LAN-Net", "10.0.1.0/24"], ["shop.example.com", "shop.example.com"]]),
  services: new Map([["ALL", "ANY"], ["HTTPS", "TCP/443"]]),
  interfaces: new Map([["lan", { name: "lan", role: "lan", ip: "10.0.1.1/24" }]]),
  internetIfaces: new Set(["wan1"]),
  policies: [pol({ id: 1 })],
};

const itemFor = (cli: string): ChatItem => ({
  role: "assistant", text: "",
  policyDrafts: parseAllPoliciesFromCLI(cli),
  addrDrafts: parseAllAddressesFromCLI(cli),
});

const DENY = `config firewall policy
    edit 0
        set name "Block-LAN"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN-Net"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end`;

const FQDN_SOURCE = DENY
  .replace('set srcaddr "LAN-Net"', 'set srcaddr "shop.example.com"')
  .replace('"Block-LAN"', '"Block-Shop"');

const panel = (item: ChatItem) => renderToStaticMarkup(
  <SimulatePanel hostname="FortiGate-80E" item={item} ctx={ctx} accent="#845ADF"
    enriching={false} anchorFor={() => null} onExpand={() => {}} onClose={() => {}} />,
);

/** The same panel with no way out — a caller outside a router gets exactly this. */
const panelWithoutPage = (item: ChatItem) => renderToStaticMarkup(
  <SimulatePanel hostname="FortiGate-80E" item={item} ctx={ctx} accent="#845ADF"
    enriching={false} anchorFor={() => null} onClose={() => {}} />,
);

describe("SimulatePanel", () => {
  it("puts the verdict above the tabs, so the answer is never scrolled past", () => {
    const html = panel(itemFor(DENY));
    // The blanket rule above it claims the same traffic, so the proposal cannot run where Apply
    // would put it — the finding this panel exists for, and it is in the first screen.
    expect(html).toMatch(/unreachable|never runs/i);
    const verdictAt = html.search(/unreachable|never runs/i);
    const tabsAt = html.indexOf(">Walk<");
    expect(verdictAt).toBeGreaterThan(-1);
    expect(tabsAt).toBeGreaterThan(verdictAt);
  });

  it("splits the detail across three tabs instead of one long column", () => {
    const html = panel(itemFor(DENY));
    expect(html).toContain(">Walk<");
    expect(html).toContain(">Rules<");
    expect(html).toContain(">Impact<");
    // Only the open tab is rendered, so the panel is never taller than the tab in view.
    expect(html).not.toContain("Objects that would be created");
  });

  it("opens on the OVERVIEW, not on the rule-by-rule walk", () => {
    // Three nodes and a journey answer "does my traffic still get out?", which is the question
    // somebody has while still reading the proposal. The table needs room it does not have here.
    const html = panel(itemFor(DENY));
    expect(html).toContain(">SOURCE<");
    expect(html).toContain(">Internet<");
    expect(html).toContain("Open full view");
    // The rule rows and the chassis ports belong to the full walk. Both views say "first match
    // wins" — that is true of the device in either picture — but only one of them draws the table.
    expect(html).not.toContain('data-row="0"');
    expect(html).not.toContain('data-port=');
    expect(html).toContain("walks the same run down the");
  });

  it("sends the drawing that wants the room to its own page, not to an overlay", () => {
    const html = panel(itemFor(DENY));
    expect(html).toContain("Open full view");
    // The overlay this replaced was portalled onto document.body and carried a second copy of the
    // whole panel, with three separate controls that closed something. One Close is left.
    expect(html).not.toContain("Exit full screen");
    expect(html).not.toContain("Bring it back here");
  });

  it("lists the sample flows as lines, not as a row of cards", () => {
    // Three items of identical structure wrapped as cards left two on one line and one on the
    // next, and every card repeated a border to say the same three things. Down the page they
    // align, and a fourth flow costs a row rather than rearranging the block.
    const html = panel(itemFor(DENY));
    const items = html.match(/<li /g) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("<ul");
  });

  it("no longer offers the Now / After Apply / Above-it run toggle", () => {
    // The panel is only ever open to answer one question — what the proposed rule does once it
    // lands — so the three-way run switch was comparison machinery nobody was reading. It is gone;
    // the run shown is always "After Apply".
    const html = panel(itemFor(DENY));
    expect(html).not.toContain(">Now<");
    expect(html).not.toContain("After Apply");
    expect(html).not.toMatch(/Above [“"]/);
  });

  it("offers no way out when the caller cannot navigate", () => {
    // The page is reached through a callback, so a panel rendered outside a router simply has no
    // button rather than one that throws when it is pressed.
    expect(panelWithoutPage(itemFor(DENY))).not.toContain("Open full view");
  });

  it("says there is nothing to walk rather than drawing an empty stage", () => {
    const html = panel({ role: "assistant", text: "get system status" });
    expect(html).toContain("proposes no firewall policy");
    expect(html).not.toContain('role="img"');
  });

  it("refuses to pass another rule's packet off as this policy's traffic", () => {
    // srcaddr is an FQDN, so nothing can stand for what this rule would carry. The blanket rule's
    // own flow is still drawn — it is real — but the panel must not let that read as a result for
    // the policy being proposed.
    const html = panel(itemFor(FQDN_SOURCE));
    expect(html).toContain("could not be simulated");
    expect(html).toContain("belong to other rules");
    expect(html).toContain("shop.example.com");
    expect(html).not.toContain("0.0.0.0/0");
    // And nothing anywhere forces the reader sideways.
    expect(html).not.toContain("min-width");
  });

  it("names the rule in the way when the proposal is unreachable", () => {
    // The "place it above" run is gone with the toggle, but the verdict still has to say WHICH rule
    // already claims the traffic — "which one?" is the next question whether or not a button offers
    // to fix it.
    expect(panel(itemFor(DENY))).toContain("Catch-All");
  });
});

describe("the chat", () => {
  it("draws no simulation of its own — the button is the only way in", () => {
    // Asserted against the SOURCE rather than a render, because the failure this guards is somebody
    // dropping a picture back into a list that re-renders on every streamed token of an AI answer.
    // The panel is where the simulation lives; the chat gets a button.
    // Relative to the frontend root, which is where vitest runs.
    const chat = readFileSync("src/pages/ai-assistant/index.tsx", "utf8");
    expect(chat).not.toMatch(/<PacketWalk|<PacketOverview|InlineSimulate/);
    // And the button that opens it is still there.
    expect(chat).toContain("Simulate");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { ContextProvider } from "../../contexts/ProviderContext";
import SimulatePage from "./simulate";
import { clearSimHandoff, putSimHandoff } from "./simulateHandoff";
import { EMPTY_FLOW_CONTEXT, type FlowContext } from "./deviceFacts";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import type { FirewallPolicy } from "../../api/policyObject";

// The page the Simulate panel expands into. What it has to get right is not the drawing — that is
// PacketWalk's job and is tested there — but the two states it can be in: a run handed over from
// the chat, and a reload that lost it.

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
  addresses: new Map([["LAN-Net", "10.0.1.0/24"]]),
  services: new Map([["ALL", "ANY"]]),
  interfaces: new Map([["lan", { name: "lan", role: "lan", ip: "10.0.1.1/24" }]]),
  internetIfaces: new Set(["wan1"]),
  policies: [pol({ id: 1 })],
};

const CLI = `config firewall policy
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

const page = () => renderToStaticMarkup(
  <ContextProvider>
    <MemoryRouter initialEntries={["/admin/ai-assistant/simulate"]}>
      <SimulatePage />
    </MemoryRouter>
  </ContextProvider>,
);

describe("the Simulate page", () => {
  beforeEach(() => clearSimHandoff());

  it("walks the handed-over run down the whole rule table", () => {
    putSimHandoff({
      hostname: "FortiGate-80E",
      item: { role: "assistant", text: "", policyDrafts: parseAllPoliciesFromCLI(CLI) },
      ctx, accent: "#845ADF", enriching: false, anchors: [null],
      itemIndex: 0, policyIndex: 0, phase: "after",
    });
    const html = page();
    expect(html).toContain("FortiGate-80E");
    // The rule table — the reason to leave the panel at all.
    expect(html).toContain('data-row="0"');
    expect(html).toContain("first match wins");
    // And the verdict is still stated once, above the tabs.
    expect(html).toMatch(/unreachable|never runs/i);
    expect(html).toContain(">Walk<");
  });

  it("goes back rather than closing — nothing here is a modal", () => {
    putSimHandoff({
      hostname: "FortiGate-80E",
      item: { role: "assistant", text: "", policyDrafts: parseAllPoliciesFromCLI(CLI) },
      ctx, accent: "#845ADF", enriching: false, anchors: [null],
      itemIndex: 0, policyIndex: 0, phase: "after",
    });
    const html = page();
    expect(html).toContain("Back to AI Assistant");
    expect(html).not.toContain("Exit full screen");
    expect(html).not.toContain("Full screen");
  });

  it("states the run's facts once, across the top, so the stage holds only the view", () => {
    putSimHandoff({
      hostname: "FortiGate-80E",
      item: { role: "assistant", text: "", policyDrafts: parseAllPoliciesFromCLI(CLI) },
      ctx, accent: "#845ADF", enriching: false, anchors: [null],
      itemIndex: 0, policyIndex: 0, phase: "after",
    });
    const html = page();
    // The verdict, its numbers and the sample flows belong to the whole run, not to one tab — so
    // they run across the top, ahead of the tab bar, and do not move when the tab changes.
    expect(html).toContain("Sample flows");
    expect(html.indexOf("Sample flows")).toBeLessThan(html.indexOf(">Walk<"));
    // Stated once: the stage must not repeat them.
    expect((html.match(/Sample flows/g) ?? [])).toHaveLength(1);
    // And laid out along the width rather than stacked in a rail.
    expect(html).toContain("border-l px-3 first:border-l-0");
  });

  it("says why there is nothing to draw after a reload, and offers the way back", () => {
    const html = page();
    expect(html).toContain("no run loaded");
    expect(html).toContain("There is no simulation loaded");
    expect(html).toContain("Back to AI Assistant");
    expect(html).not.toContain('role="img"');
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SystemInterface } from "../../api/policyObject";
import DeviceFaceplate from "./DeviceFaceplate";

// The faceplate's whole job is to answer "what is plugged into this firewall", so the things
// worth pinning are the ones that would make it lie: a count that sweeps in interfaces the board
// does not draw, a shut port shown as merely unplugged, and a caption that names hardware the
// device does not have.

const ACCENT = "#845ADF";

const iface = (over: Partial<SystemInterface> & { name: string }): SystemInterface => ({
  alias: "", type: "physical", vdom: "root", ip: "", status: "up", role: "undefined",
  vlanid: 0, interface: "", mode: "static", allowaccess: [], description: "",
  vlan_protocol: "", device_identification: "", members: [], secondary_ip: false,
  ref_count: 0, dhcp_ranges: null,
  default_gw: false, distance: 0, dns_server_override: false, ip_managed_by_ipam: false,
  pppoe_username: "", security_mode: "", egress_shaping_profile: "",
  link_up: false, speed_mbps: 0,
  ...over,
});

/** Strips tags so assertions match visible text, not markup. */
const text = (el: React.ReactElement): string =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&middot;|&#xB7;/g, "·").replace(/\s+/g, " ");

// A slice of the lab FortiGate 80E: WAN1 carrying the link, WAN2 unplugged, DMZ shut by an
// administrator, no HA port fitted, four LAN ports, plus a VLAN that is up but has no jack.
const LAB: SystemInterface[] = [
  iface({ name: "wan1", alias: "External", link_up: true, ip: "171.97.97.81/24", speed_mbps: 1000 }),
  iface({ name: "wan2" }),
  iface({ name: "dmz", status: "down" }),
  iface({ name: "port1", link_up: true }),
  iface({ name: "port2" }),
  iface({ name: "port3" }),
  iface({ name: "port4" }),
  iface({ name: "office", type: "vlan", vlanid: 10, interface: "lan", link_up: true }),
];

describe("DeviceFaceplate", () => {
  it("counts only the ports it draws", () => {
    const out = text(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} />,
    );
    // wan1 + port1 — the VLAN is up too, but it has no jack on the chassis.
    expect(out).toContain("2 up");
    expect(out).toContain("4 down");   // wan2, port2, port3, port4
    expect(out).toContain("1 off");    // dmz, shut administratively
  });

  it("separates an administratively shut port from an unplugged one", () => {
    const html = renderToStaticMarkup(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} />,
    );
    expect(html).toContain("dmz — Disabled (admin down)");
    expect(html).toContain("wan2 — Not connected");
    expect(html).toContain("wan1 — Connected");
  });

  it("captions the fixed block from the ports actually fitted", () => {
    const out = text(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} />,
    );
    expect(out).toContain("WAN · DMZ");
    expect(out).not.toContain("HA");   // no HA port on this device
    expect(out).toContain("LAN");
  });

  it("draws the dashboard scale larger than the compact strip", () => {
    const small = renderToStaticMarkup(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} />,
    );
    const large = renderToStaticMarkup(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} size="lg" fill />,
    );
    expect(small).toContain('width="30"');
    expect(large).toContain('width="38"');
    expect(large).toContain("h-full w-full");
  });

  it("renders nothing clickable when no port handler is given", () => {
    const html = renderToStaticMarkup(
      <DeviceFaceplate model="FortiGate 80E" interfaces={LAB} currentColor={ACCENT} />,
    );
    expect(html).not.toContain("Click a port");
  });
});

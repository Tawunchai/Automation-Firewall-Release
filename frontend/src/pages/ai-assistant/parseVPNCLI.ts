// parseVPNCLI — the single entry point that turns ANY VPN suggestion the AI emits (prompt sections
// 9 / 9b / 9c) into the ONE create payload the device-proxy needs, so the chat's Apply button builds
// the whole tunnel object set over REST (~0.25s) with Fallback undo — the same first-class treatment
// every other AI object gets. It dispatches by the phase1 shape:
//   · auto-discovery flag        → Hub-and-Spoke (delegated to parseHubSpokeFromCLI)
//   · mode-cfg / wizard-type=dialup → Remote Access (dialup mode-config)
//   · otherwise                  → Site-to-Site
// A VPN suggestion is SELF-CONTAINED (phase1/phase2 + its addresses/policies/routes), so this returns
// a SINGLE payload and applyViaREST creates it wholesale — never piece-by-piece (the policies
// reference a tunnel interface that doesn't exist until the tunnel is built).

import type { IPsecNATTraversal, IPsecTunnelPayload } from "../../api/policyObject";
import { parseHubSpokeFromCLI } from "./parseHubSpokeCLI";
import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import { fgSubnetToCIDR } from "./fgFormat";

export type VPNKind = "hub-spoke" | "site-to-site" | "remote-access";
export type ParsedVPN = { kind: VPNKind; name: string; payload: IPsecTunnelPayload };

// ── small shared readers ──────────────────────────────────────────────────────
const setValue = (body: string[], key: string): string => {
  for (const l of body) {
    const m = l.match(new RegExp(`^\\s*set\\s+${key}\\s+(.+?)\\s*$`, "i"));
    if (m) return m[1].replace(/^"|"$/g, "").trim();
  }
  return "";
};
const isOn = (body: string[], key: string): boolean => setValue(body, key).toLowerCase() === "enable";
// "set member "A" "B"" → ["A","B"].
const parseMembers = (body: string[]): string[] => {
  for (const l of body) {
    const m = l.match(/^\s*set\s+member\s+(.+?)\s*$/i);
    if (m) return (m[1].match(/"[^"]+"|\S+/g) || []).map((s) => s.replace(/^"|"$/g, ""));
  }
  return [];
};
const findBlock = (blocks: { header: string; inner: string[] }[], re: RegExp) => blocks.find((b) => re.test(b.header));

// The top-level sections that belong to a VPN tunnel's own object set. A suggestion is treated as a
// VPN (and applied wholesale) ONLY when EVERY section is one of these — so a mixed suggestion (e.g. a
// DNS filter that happens to sit next to a tunnel) is NOT swallowed by the VPN path and drops through
// to the normal per-object flow / SSH.
const VPN_SECTION_RE = /^(vpn[.\s]ipsec phase1-interface|vpn[.\s]ipsec phase2-interface|vpn l2tp|system interface|router bgp|router static|firewall address|firewall addrgrp|firewall service custom|firewall policy|user peer)$/;

// parseVPNFromCLI returns { kind, name, payload } for a clean VPN suggestion, or null otherwise (no
// phase1, or a non-VPN section riding along).
export function parseVPNFromCLI(cli: string): ParsedVPN | null {
  if (!cli) return null;
  const lines = normalizeCLI(cli).split("\n");
  const blocks = topLevelConfigBlocks(lines);
  const p1Block = findBlock(blocks, /^vpn[.\s]ipsec phase1-interface$/);
  if (!p1Block) return null;
  // A non-VPN section riding along ⇒ not a clean VPN suggestion; let the normal flow handle it.
  if (!blocks.every((b) => VPN_SECTION_RE.test(b.header))) return null;

  // Hub-and-Spoke first (its phase1 carries an auto-discovery flag).
  const hs = parseHubSpokeFromCLI(cli);
  if (hs) return { kind: "hub-spoke", name: hs.name, payload: hs.payload };
  const p1 = topLevelEdits(p1Block.inner)[0];
  if (!p1?.name) return null;

  const name = p1.name;
  const wizardType = setValue(p1.body, "wizard-type");
  const dialup = isOn(p1.body, "mode-cfg") || /^dialup/i.test(wizardType);

  return dialup
    ? { kind: "remote-access", name, payload: parseRemoteAccess(name, p1.body, blocks) }
    : { kind: "site-to-site", name, payload: parseSiteToSite(name, p1.body, blocks) };
}

/**
 * The nattraversal the CLI asked for, held to the three values FortiOS accepts.
 *
 * Anything else — a typo in a pasted config, a field this parser has not seen — becomes "enable",
 * which is what an absent field already produced. It was `as any` before, which meant whatever
 * string the CLI carried went to the device and came back as a refusal nobody could read.
 */
const natTraversalFrom = (raw: string): IPsecNATTraversal =>
  raw === "disable" || raw === "forced" ? raw : "enable";

// ── Site-to-Site ──────────────────────────────────────────────────────────────
function parseSiteToSite(name: string, p1: string[], blocks: { header: string; inner: string[] }[]): IPsecTunnelPayload {
  const auth = (setValue(p1, "authmethod") || "psk").toLowerCase() === "signature" ? "signature" : "psk";
  const remoteGW = setValue(p1, "remote-gw");
  const remoteDDNS = setValue(p1, "remotegw-ddns");
  const remoteType = remoteDDNS ? "ddns" : setValue(p1, "type").toLowerCase() === "dynamic" ? "dynamic" : "static";

  // Selectors from every phase2 → local/remote subnets (deduped, "0.0.0.0/0" dropped as noise).
  const p2Block = findBlock(blocks, /^vpn[.\s]ipsec phase2-interface$/);
  const locals = new Set<string>(), remotes = new Set<string>();
  if (p2Block) {
    for (const e of topLevelEdits(p2Block.inner)) {
      if (setValue(e.body, "phase1name") && setValue(e.body, "phase1name") !== name) continue;
      const s = fgSubnetToCIDR(setValue(e.body, "src-subnet"));
      const d = fgSubnetToCIDR(setValue(e.body, "dst-subnet"));
      if (s && s !== "0.0.0.0/0") locals.add(s);
      if (d && d !== "0.0.0.0/0") remotes.add(d);
    }
  }

  return {
    name,
    interface: setValue(p1, "interface"),
    ike_version: setValue(p1, "ike-version") || "2",
    remote_type: remoteType,
    remote_gw: remoteType === "static" ? remoteGW : "",
    remote_ddns: remoteType === "ddns" ? remoteDDNS : "",
    nattraversal: natTraversalFrom(setValue(p1, "nattraversal")),
    psk: auth === "psk" ? setValue(p1, "psksecret") : "",
    auth_method: auth,
    certificate: auth === "signature" ? setValue(p1, "certificate") : "",
    local_subnets: [...locals],
    remote_subnets: [...remotes],
    local_interface: localInterfaceFor(name, blocks),
    internet_access: "none",
    create_static_route: true,
    create_firewall_policy: true,
    comments: `Site to Site — created by the AI Assistant`,
  };
}

// ── Remote Access (dialup) ────────────────────────────────────────────────────
function parseRemoteAccess(name: string, p1: string[], blocks: { header: string; inner: string[] }[]): IPsecTunnelPayload {
  const auth = (setValue(p1, "authmethod") || "psk").toLowerCase() === "signature" ? "signature" : "psk";
  const wizardType = setValue(p1, "wizard-type");
  const raClient =
    /cisco/i.test(wizardType) ? "cisco" :
    /ios/i.test(wizardType) ? "ios" :
    /android/i.test(wizardType) ? "android" :
    /windows/i.test(wizardType) ? "windows" : "forticlient";

  const splitInclude = setValue(p1, "ipv4-split-include");
  const splitTunnel = !!splitInclude;

  // The split group's members = the local addresses reachable over the VPN.
  let localAddresses: string[] = [];
  if (splitInclude) {
    const grpBlock = findBlock(blocks, /^firewall[.\s]addrgrp$/);
    if (grpBlock) {
      const e = topLevelEdits(grpBlock.inner).find((x) => x.name === splitInclude);
      if (e) localAddresses = parseMembers(e.body);
    }
  }

  const peerId = setValue(p1, "peerid");
  const aggressive = setValue(p1, "mode").toLowerCase() === "aggressive";

  return {
    name,
    interface: setValue(p1, "interface"),
    ike_version: setValue(p1, "ike-version") || "1",
    remote_type: "dynamic",
    remote_gw: "",
    psk: auth === "psk" ? setValue(p1, "psksecret") : "",
    auth_method: auth,
    certificate: auth === "signature" ? setValue(p1, "certificate") : "",
    local_subnets: [],
    remote_subnets: [],
    local_interface: localInterfaceFor(name, blocks),
    create_firewall_policy: true,
    comments: `Remote Access (${raClient}) — created by the AI Assistant`,

    remote_access: true,
    ra_client: raClient,
    user_group: setValue(p1, "authusrgrp"),
    client_range_start: setValue(p1, "ipv4-start-ip"),
    client_range_end: setValue(p1, "ipv4-end-ip"),
    client_netmask: setValue(p1, "ipv4-netmask") || "255.255.255.255",
    dns_mode: (setValue(p1, "dns-mode") || "auto") === "manual" ? "manual" : "auto",
    dns_server: setValue(p1, "ipv4-dns-server1"),
    split_tunnel: splitTunnel,
    local_addresses: localAddresses,
    save_password: isOn(p1, "save-password"),
    require_group_name: !!peerId && aggressive,
    group_name: peerId,
  };
}

// localInterfaceFor finds the LAN side of the tunnel from its firewall policies: the interface paired
// with the tunnel interface (dstintf when the tunnel is srcintf, or srcintf when it is dstintf).
function localInterfaceFor(name: string, blocks: { header: string; inner: string[] }[]): string {
  const polBlock = findBlock(blocks, /^firewall[.\s]policy$/);
  if (!polBlock) return "";
  for (const e of topLevelEdits(polBlock.inner)) {
    const src = setValue(e.body, "srcintf");
    const dst = setValue(e.body, "dstintf");
    if (src === name && dst && dst !== name) return dst;
    if (dst === name && src && src !== name) return src;
  }
  return "";
}

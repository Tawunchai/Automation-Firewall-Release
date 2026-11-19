// parseHubSpokeCLI — turns the AI's Hub-and-Spoke FortiOS CLI (prompt section 9b) into the ONE
// create payload the backend's device-proxy expects (IPsecTunnelPayload with a hub_spoke block), so
// the chat's Apply button can create the whole ADVPN object set over REST in ~0.25s — the same
// fast-path the Policy/Address/… objects use — instead of the slow SSH config-deploy fallback.
//
// A Hub-and-Spoke suggestion is SELF-CONTAINED: one phase1 (with an auto-discovery flag), its tunnel
// interface, its BGP process, its <name>_local address(es) and its two policies. So unlike the other
// parsers this one returns a SINGLE payload for the whole suggestion (not a list of objects), and the
// backend's CreateHubSpoke path builds every piece in dependency order — which is exactly why the AI
// must NOT try to apply the individual policies/addresses separately (see applyViaREST).

import type { IPsecTunnelPayload, IPsecHubSpokePayload } from "../../api/policyObject";
import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";

// setValue reads `set <key> <value...>` from a block body → the raw value (quotes stripped, the
// rest of the line kept so "10.10.1.1 255.255.255.255" survives intact).
const setValue = (body: string[], key: string): string => {
  for (const l of body) {
    const m = l.match(new RegExp(`^\\s*set\\s+${key}\\s+(.+?)\\s*$`, "i"));
    if (m) return m[1].replace(/^"|"$/g, "").trim();
  }
  return "";
};

const hasSet = (body: string[], key: string, val: string): boolean =>
  setValue(body, key).toLowerCase() === val.toLowerCase();

// firstToken: "10.10.1.1 255.255.255.255" → "10.10.1.1".
const firstToken = (v: string): string => v.trim().split(/\s+/)[0] ?? "";

// maskToBits: "255.255.255.0" → 24.
const maskToBits = (mask: string): number =>
  mask.trim().split(".").reduce((n, o) => n + ((Number(o) >>> 0).toString(2).match(/1/g) || []).length, 0);

// fgIpMaskToCIDR keeps the HOST and appends the prefix length: "10.10.1.2 255.255.255.0" → "10.10.1.2/24".
// A value that is already a CIDR or a bare host is passed through.
const fgIpMaskToCIDR = (v: string): string => {
  const parts = v.trim().split(/\s+/);
  if (parts.length === 2 && /^\d{1,3}(\.\d{1,3}){3}$/.test(parts[1])) return `${parts[0]}/${maskToBits(parts[1])}`;
  return v.trim();
};

export type ParsedHubSpoke = { name: string; payload: IPsecTunnelPayload };

// parseHubSpokeFromCLI returns the single create payload if the CLI is a Hub-and-Spoke suggestion
// (its phase1 carries auto-discovery-sender or -receiver), or null otherwise. Null is the signal to
// applyViaREST that this is NOT a hub-spoke suggestion and the normal per-object flow applies.
export function parseHubSpokeFromCLI(cli: string): ParsedHubSpoke | null {
  if (!cli) return null;
  const lines = normalizeCLI(cli).split("\n");
  const blocks = topLevelConfigBlocks(lines);

  // 1. phase1 — the tunnel identity + role. No phase1 with an auto-discovery flag ⇒ not hub-spoke.
  const p1Block = blocks.find((b) => b.header === "vpn.ipsec phase1-interface" || b.header === "vpn ipsec phase1-interface");
  if (!p1Block) return null;
  const p1 = topLevelEdits(p1Block.inner)[0];
  if (!p1?.name) return null;
  const sender = hasSet(p1.body, "auto-discovery-sender", "enable");
  const receiver = hasSet(p1.body, "auto-discovery-receiver", "enable");
  if (!sender && !receiver) return null;

  const name = p1.name;
  const role: "hub" | "spoke" = receiver ? "spoke" : "hub";
  const authMethod = (setValue(p1.body, "authmethod") || "psk").toLowerCase() === "signature" ? "signature" : "psk";

  // 2. Tunnel interface overlay IPs.
  const ifBlock = blocks.find((b) => b.header === "system interface" || b.header === "system.interface");
  let tunnelIP = "", remoteIP = "";
  if (ifBlock) {
    const e = topLevelEdits(ifBlock.inner).find((x) => x.name === name);
    if (e) {
      tunnelIP = firstToken(setValue(e.body, "ip"));
      remoteIP = fgIpMaskToCIDR(setValue(e.body, "remote-ip"));
    }
  }

  // 3. BGP — local AS, this device's networks, and the neighbor set (individual IPs or a range).
  const bgpBlock = blocks.find((b) => b.header === "router bgp" || b.header === "router.bgp");
  let localAS = "", spokeType: "individual" | "range" = "individual";
  const spokeTunnelIPs: string[] = [];
  let spokeRangePrefix = "";
  const bgpNetworks: string[] = [];
  if (bgpBlock) {
    localAS = setValue(bgpBlock.inner, "as");
    for (const sub of topLevelConfigBlocks(bgpBlock.inner)) {
      if (sub.header === "neighbor") {
        for (const e of topLevelEdits(sub.inner)) if (e.name) spokeTunnelIPs.push(e.name);
      } else if (sub.header === "neighbor-range") {
        spokeType = "range";
        const e = topLevelEdits(sub.inner)[0];
        if (e) spokeRangePrefix = fgSubnetToCIDR(setValue(e.body, "prefix"));
      } else if (sub.header === "neighbor-group") {
        spokeType = "range";
      } else if (sub.header === "network") {
        for (const e of topLevelEdits(sub.inner)) {
          const p = fgSubnetToCIDR(setValue(e.body, "prefix"));
          if (p) bgpNetworks.push(p);
        }
      }
    }
  }

  // 4. Local subnets — from the <name>_local address set, falling back to the BGP networks.
  const addrBlock = blocks.find((b) => b.header === "firewall address" || b.header === "firewall.address");
  const localSubnets: string[] = [];
  if (addrBlock) {
    const prefix = `${name}_local`;
    for (const e of topLevelEdits(addrBlock.inner)) {
      if (e.name === prefix || e.name.startsWith(prefix + "_")) {
        const s = fgSubnetToCIDR(setValue(e.body, "subnet"));
        if (s) localSubnets.push(s);
      }
    }
  }
  const subnets = localSubnets.length ? localSubnets : bgpNetworks;

  const hub_spoke: IPsecHubSpokePayload = {
    role,
    tunnel_ip: tunnelIP,
    remote_ip: remoteIP,
    local_as: localAS,
    local_interface: "", // not in the CLI — the backend defaults it to the binding interface
    local_subnets: subnets,
  };
  if (role === "hub") {
    hub_spoke.spoke_type = spokeType;
    if (spokeType === "range") hub_spoke.spoke_range_prefix = spokeRangePrefix;
    else hub_spoke.spoke_tunnel_ips = spokeTunnelIPs;
  } else {
    hub_spoke.remote_gw = setValue(p1.body, "remote-gw");
  }

  const payload: IPsecTunnelPayload = {
    name,
    interface: setValue(p1.body, "interface"),
    ike_version: "2",
    remote_gw: role === "spoke" ? setValue(p1.body, "remote-gw") : "",
    psk: authMethod === "psk" ? stripPSK(setValue(p1.body, "psksecret")) : "",
    local_subnets: [],
    remote_subnets: [],
    auth_method: authMethod,
    certificate: authMethod === "signature" ? parseCertName(p1.body) : "",
    comments: `Hub-and-Spoke (FortiGate ${role === "spoke" ? "Spoke" : "Hub"}) — created by the AI Assistant`,
    hub_spoke,
  };
  return { name, payload };
}

// fgSubnetToCIDR: "10.0.96.0 255.255.252.0" → "10.0.96.0/22"; a CIDR or bare value passes through.
const fgSubnetToCIDR = (v: string): string => {
  const parts = v.trim().split(/\s+/);
  if (parts.length === 2 && /^\d{1,3}(\.\d{1,3}){3}$/.test(parts[1])) return `${parts[0]}/${maskToBits(parts[1])}`;
  return v.trim();
};

// stripPSK removes surrounding quotes the AI sometimes leaves on the secret.
const stripPSK = (v: string): string => v.replace(/^"|"$/g, "");

// parseCertName reads the first name out of `set certificate "X"` (a member table on the device, but
// the AI writes it as a plain value).
const parseCertName = (body: string[]): string => setValue(body, "certificate");

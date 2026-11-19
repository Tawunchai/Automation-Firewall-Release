/**
 * Hub-and-spoke (ADVPN + BGP): validation and payload.
 *
 * Split out of ipsec-wizard-rules.ts, which reached 1,316 lines holding the validation, the object
 * summary and the payload builder for all four VPN templates at once. Every template's rules now
 * live together; the shared state, constants and predicates are in ./ipsec-wizard-state.
 */
import type {
  IPsecHubSpokePayload, IPsecHubSpokeReadback, IPsecTunnelPayload,
} from "../../api/policyObject";
import type { VPNSummaryRow, VPNWizardState } from "./ipsec-wizard-state";
import { BLANK_VPN_WIZARD, hubIsHub, hubIsSpoke, isIPv4 } from "./ipsec-wizard-state";

// ─── Hub-and-Spoke template (ADVPN + BGP) ──────────────────────────────────────────────────────
// The FortiGate wizard's Hub-and-Spoke template builds an overlay tunnel routed by BGP: a dialup
// hub that accepts many spokes on one phase1, or a spoke that dials a single hub. Every value here
// was verified live against a FortiGate 7.2.10 (see services/fortigate_hubspoke.go for the CMDB
// mapping). The steps mirror the GUI: VPN Setup -> Authentication -> Tunnel Interface -> Policy &
// Routing -> Review.

// The "Easy configuration key" the GUI shows on the Spoke role is a FortiManager/cloud feature that
// pastes a hub-generated blob to auto-fill the spoke. It is not reproducible over the device REST
// API, so this wizard asks the spoke's fields directly instead — the field is shown, disabled, with
// this note.
export const HUB_SPOKE_EASY_KEY_UNSUPPORTED =
  "Easy configuration key is a FortiManager feature — enter the hub's gateway and tunnel settings manually below.";

const cleanHS = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);

// A permissive CIDR check (ip/prefix). Enough to catch typos before the device does.
export const isCIDR = (v: string): boolean => {
  const s = v.trim();
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return false;
  return isIPv4(m[1]) && Number(m[2]) >= 0 && Number(m[2]) <= 32;
};

// A remote IP/netmask accepts a bare host (defaults to /32) or an ip/prefix.
export const isHostOrCIDR = (v: string): boolean => {
  const s = v.trim();
  return s.includes("/") ? isCIDR(s) : isIPv4(s);
};

// A BGP AS number: 1 .. 4294967295.
export const isBGPAS = (v: string): boolean => {
  const s = v.trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= 1 && n <= 4294967295;
};

// maskBitsToOctets turns a prefix length into the four mask octets.
const maskOctets = (bits: number): number[] =>
  [0, 1, 2, 3].map((i) => {
    const rem = bits - i * 8;
    if (rem >= 8) return 255;
    if (rem <= 0) return 0;
    return (256 - (1 << (8 - rem))) & 255;
  });

// deriveOverlaySubnet turns the "Remote IP/netmask" (10.10.1.2/24) into the overlay subnet
// (10.10.1.0/24) the Range-mode neighbor-range accepts — the network the tunnel IPs live on. Used to
// prefill the Spoke range prefix.
export const deriveOverlaySubnet = (remoteIP: string): string => {
  const m = remoteIP.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return "";
  const bits = Number(m[2]);
  const oct = m[1].split(".").map(Number);
  const mo = maskOctets(bits);
  return `${oct.map((o, i) => o & mo[i]).join(".")}/${bits}`;
};

// deriveInterfaceSubnet turns an interface's "ip" ("192.168.50.1 255.255.255.0", or a CIDR) into the
// network CIDR ("192.168.50.0/24") — what the Policy & Routing step auto-fills Local subnets from
// when a Local interface is chosen, exactly like the FortiGate GUI.
export const deriveInterfaceSubnet = (ipField: string): string => {
  const s = (ipField || "").trim();
  if (!s) return "";
  let ip = "";
  let bits = -1;
  const cidr = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    ip = cidr[1];
    bits = Number(cidr[2]);
  } else {
    const parts = s.split(/\s+/);
    if (parts.length === 2 && isIPv4(parts[0]) && isIPv4(parts[1])) {
      ip = parts[0];
      bits = parts[1].split(".").reduce((n, o) => n + ((Number(o) >>> 0).toString(2).match(/1/g) || []).length, 0);
    }
  }
  if (!ip || bits < 0 || bits > 32) return "";
  const oct = ip.split(".").map(Number);
  const mo = maskOctets(bits);
  return `${oct.map((o, i) => o & mo[i]).join(".")}/${bits}`;
};

// validateHubSpokeStep — the five Hub-and-Spoke steps. Review (step 4) has nothing to validate. On an
// EDIT the PSK is intentionally blank (it is never read back from the device; a blank on save keeps
// the stored secret), so the PSK-required check is skipped.
export const validateHubSpokeStep = (s: VPNWizardState, step: number, editing = false): Record<string, string> => {
  const e: Record<string, string> = {};

  if (step === 0) {
    if (!s.name.trim()) e.name = "This field is required.";
  }

  if (step === 1) {
    if (!s.outInterface) e.outInterface = "This field is required.";
    if (!editing && s.authMethod === "psk" && !s.psk.trim()) e.psk = "This field is required.";
    if (s.authMethod === "signature" && !s.certificate.trim()) e.certificate = "This field is required.";
  }

  if (step === 2) {
    if (!isIPv4(s.hsTunnelIP)) e.hsTunnelIP = "Enter a valid IPv4 address.";
    if (!isHostOrCIDR(s.hsRemoteIP)) e.hsRemoteIP = "Enter a valid IP/netmask (e.g. 10.10.1.2/24).";
  }

  if (step === 3) {
    if (!isBGPAS(s.hsLocalAS)) e.hsLocalAS = "Enter an AS number (1-4294967295).";
    if (!s.localInterface) e.localInterface = "This field is required.";
    const subs = cleanHS(s.localSubnets);
    if (!subs.length) e.localSubnets = "At least one local subnet is required.";
    else if (subs.some((x) => !isCIDR(x))) e.localSubnets = "Each subnet must be a CIDR (e.g. 10.0.96.0/22).";

    if (hubIsSpoke(s)) {
      if (!isIPv4(s.hsRemoteGW)) e.hsRemoteGW = "Enter the hub's public IPv4 address.";
    } else if (s.hsSpokeType === "range") {
      if (!isCIDR(s.hsSpokeRangePrefix)) e.hsSpokeRangePrefix = "Enter the spoke overlay subnet (e.g. 10.10.1.0/24).";
    } else {
      const ips = cleanHS(s.hsSpokeTunnelIPs);
      if (!ips.length) e.hsSpokeTunnelIPs = "Add at least one spoke tunnel IP.";
      else if (ips.some((x) => !isIPv4(x))) e.hsSpokeTunnelIPs = "Each spoke tunnel IP must be a valid IPv4 address.";
    }
  }

  return e;
};

// The objects a Hub-and-Spoke tunnel creates, named exactly the way the FortiGate wizard's "Review
// Settings -> Object Summary" names them. MUST agree with services.HubSpokeObjectNamesFor — both
// sides are pinned by tests.
export const hubSpokeObjectNames = (tunnel: string) => ({
  phase1: tunnel,
  phase2: tunnel,
  tunnelInterface: tunnel,
  localAddress: `${tunnel}_local`,
  policySpoke2Hub: `vpn_${tunnel}_spoke2hub`,
  policySpoke2Spoke: `vpn_${tunnel}_spoke2spoke`,
  neighborGroup: tunnel,
});

// hubSpokeObjectSummary lists every object the configuration will create, in the GUI's order.
export const hubSpokeObjectSummary = (s: VPNWizardState): VPNSummaryRow[] => {
  const n = hubSpokeObjectNames(s.name.trim() || "VPN");
  return [
    { label: "Phase 1 interface", value: n.phase1 },
    { label: "Local address group", value: n.localAddress },
    { label: "Phase 2 interface", value: n.phase2 },
    { label: "Tunnel interface", value: n.tunnelInterface },
    { label: "Remote to local policies", value: n.policySpoke2Hub },
    { label: "Local to remote policies", value: n.policySpoke2Spoke },
    { label: "BGP route", value: "bgp" },
  ];
};

// buildHubSpokePayload turns the wizard's state into the backend's tunnelInput for a Hub-and-Spoke
// tunnel. Fields that do not apply to the role are sent empty, and hub_spoke:{...} is what routes the
// request down the backend's ADVPN path.
export const buildHubSpokePayload = (s: VPNWizardState): IPsecTunnelPayload => {
  const signature = s.authMethod === "signature";
  const hub = hubIsHub(s);
  const hs: IPsecHubSpokePayload = {
    role: hub ? "hub" : "spoke",
    tunnel_ip: s.hsTunnelIP.trim(),
    remote_ip: s.hsRemoteIP.trim(),
    local_as: s.hsLocalAS.trim(),
    local_interface: s.localInterface,
    local_subnets: cleanHS(s.localSubnets),
  };
  if (hub) {
    hs.spoke_type = s.hsSpokeType;
    if (s.hsSpokeType === "range") {
      hs.spoke_range_prefix = s.hsSpokeRangePrefix.trim();
    } else {
      hs.spoke_tunnel_ips = cleanHS(s.hsSpokeTunnelIPs);
    }
  } else {
    hs.remote_gw = s.hsRemoteGW.trim();
  }
  return {
    name: s.name.trim(),
    interface: s.outInterface, // Incoming Interface
    ike_version: "2",
    remote_gw: hub ? "" : s.hsRemoteGW.trim(),
    psk: signature ? "" : s.psk,
    local_subnets: [],
    remote_subnets: [],
    auth_method: s.authMethod,
    certificate: signature ? s.certificate.trim() : "",
    peer_ca: signature ? s.peerCA.trim() : "",
    comments: `Hub-and-Spoke (FortiGate ${hub ? "Hub" : "Spoke"}) — created by the VPN Creation Wizard`,
    hub_spoke: hs,
  };
};

// hubSpokeStateFromEdit builds a wizard state (Hub-and-Spoke template) pre-filled from a tunnel read
// off the device (services.FGHubSpokeReadback / api.IPsecHubSpokeReadback). The PSK is never read
// back, so it stays blank — a blank PSK on save keeps the stored secret. Used by the wizard's Edit
// mode (item 1).
export const hubSpokeStateFromEdit = (rb: IPsecHubSpokeReadback): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  templateType: "hub-and-spoke",
  name: rb.name,
  hsRole: rb.role,
  outInterface: rb.interface,
  authMethod: rb.auth_method || "psk",
  certificate: rb.certificate || "",
  peerCA: rb.peer_ca || "",
  psk: "",
  hsTunnelIP: rb.tunnel_ip || "",
  hsRemoteIP: rb.remote_ip || "",
  hsLocalAS: rb.local_as || "",
  localInterface: "",
  localSubnets: rb.local_subnets?.length ? rb.local_subnets : [""],
  hsSpokeType: rb.spoke_type === "range" ? "range" : "individual",
  hsSpokeTunnelIPs: rb.spoke_tunnel_ips?.length ? rb.spoke_tunnel_ips : [""],
  hsSpokeRangePrefix: rb.spoke_range_prefix || "",
  hsRemoteGW: rb.remote_gw || "",
});

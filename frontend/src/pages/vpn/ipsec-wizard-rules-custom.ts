/**
 * The Custom template: validation, payload, and loading a tunnel back into the form.
 *
 * Split out of ipsec-wizard-rules.ts, which reached 1,316 lines holding the validation, the object
 * summary and the payload builder for all four VPN templates at once. Every template's rules now
 * live together; the shared state, constants and predicates are in ./ipsec-wizard-state.
 */
import type {
  IPsecCustomPayload, IPsecNATTraversal, IPsecTunnelEdit, IPsecTunnelPayload,
} from "../../api/policyObject";
import type { CustomDPD, CustomIKEMode, CustomPeerType, CustomProposalRow, CustomRemoteGateway, VPNSummaryRow, VPNWizardState } from "./ipsec-wizard-state";
import { BLANK_CUSTOM, BLANK_VPN_WIZARD, CUSTOM_DH_GROUPS, customRemoteTypeOf, isAEADCipher, isIPv4 } from "./ipsec-wizard-state";

// ─── Custom template ─────────────────────────────────────────────────────────────────────────
// The GUI's manual "New VPN Tunnel" form. It builds ONLY phase1 + phase2 — no address objects,
// policies or routes — so its rules are all about producing a valid phase1/phase2 the device
// accepts, not about the surrounding object set the other templates carry.


// A proposal row is usable once it has an encryption algorithm and — unless the cipher is AEAD in a
// phase2 (where the cipher authenticates itself) — an authentication/PRF algorithm.
export const p1RowComplete = (r: CustomProposalRow): boolean => !!r.enc && !!r.auth;
export const p2RowComplete = (r: CustomProposalRow): boolean => !!r.enc && (isAEADCipher(r.enc) || !!r.auth);

// serializeP1Proposal joins the phase1 rows into FortiOS's space-separated `enc-auth` form (AEAD
// ciphers carry a PRF, e.g. "aes128gcm-prfsha256").
export const serializeP1Proposal = (rows: CustomProposalRow[]): string =>
  rows.filter(p1RowComplete).map((r) => `${r.enc}-${r.auth}`).join(" ");

// serializeP2Proposal is the same, except an AEAD cipher stands alone in phase2 ("aes128gcm"), with
// no second algorithm — verified against the device's Custom form.
export const serializeP2Proposal = (rows: CustomProposalRow[]): string =>
  rows.filter(p2RowComplete).map((r) => (isAEADCipher(r.enc) ? r.enc : `${r.enc}-${r.auth}`)).join(" ");

// serializeDH joins selected Diffie-Hellman groups into the space list FortiOS stores, in the
// canonical high-to-low order the device itself uses.
export const serializeDH = (groups: number[]): string =>
  CUSTOM_DH_GROUPS.filter((g) => groups.includes(g)).join(" ");

// A permissive IPv6 check — enough to catch typos before the device does (hex groups + colons,
// optionally a zone/CIDR the caller strips first).
export const isIPv6 = (v: string): boolean => {
  const s = v.trim();
  return s.includes(":") && /^[0-9a-fA-F:]+$/.test(s) && (s.match(/::/g) || []).length <= 1;
};
// Family-aware address / subnet checks — Custom tunnels are IPv4 or IPv6.
export const ipValidFor = (v: string, ver: "4" | "6"): boolean => (ver === "6" ? isIPv6(v) : isIPv4(v));
export const subnetValidFor = (v: string, ver: "4" | "6"): boolean => {
  const s = v.trim();
  if (ver === "6") {
    const [ip, mask] = s.split("/");
    if (mask === undefined) return isIPv6(ip);
    const m = Number(mask);
    return isIPv6(ip) && Number.isInteger(m) && m >= 0 && m <= 128;
  }
  return isSubnetSpec(s);
};

const isPort = (v: string): boolean => /^\d+$/.test(v.trim()) && Number(v.trim()) >= 0 && Number(v.trim()) <= 65535;
const isProtocol = (v: string): boolean => /^\d+$/.test(v.trim()) && Number(v.trim()) >= 0 && Number(v.trim()) <= 255;
const isPositiveInt = (v: string): boolean => /^\d+$/.test(v.trim()) && Number(v.trim()) > 0;

// validateCustomStep — the Custom flow's five steps: VPN Setup → Network → Authentication →
// Phase 2 → Review. Review (the last step) has nothing to validate.
export const validateCustomStep = (s: VPNWizardState, step: number): Record<string, string> => {
  const c = s.custom;
  const e: Record<string, string> = {};

  if (step === 0) {
    if (!s.name.trim()) e.name = "This field is required.";
  }

  if (step === 1) {
    const fam = c.ipVersion === "6" ? "IPv6" : "IPv4";
    if (c.remoteGateway === "static") {
      if (!c.remoteGwIP.trim()) e.remoteGwIP = "This field is required.";
      else if (!ipValidFor(c.remoteGwIP, c.ipVersion)) e.remoteGwIP = `Enter a valid ${fam} address.`;
    }
    if (c.remoteGateway === "ddns" && !c.remoteDdns.trim()) e.remoteDdns = "This field is required.";
    if (!s.outInterface) e.outInterface = "This field is required.";
    if (c.localGwEnabled && c.localGwMode === "specify") {
      if (!c.localGwIP.trim()) e.localGwIP = "This field is required.";
      else if (!ipValidFor(c.localGwIP, c.ipVersion)) e.localGwIP = `Enter a valid ${fam} address.`;
    }
    if (c.keepalive.trim() && !/^\d+$/.test(c.keepalive.trim())) e.keepalive = "Enter a number.";
    if (c.dpd !== "disable") {
      if (c.dpdRetryCount.trim() && !/^\d+$/.test(c.dpdRetryCount.trim())) e.dpdRetryCount = "Enter a number.";
      if (c.dpdRetryInterval.trim() && !/^\d+$/.test(c.dpdRetryInterval.trim())) e.dpdRetryInterval = "Enter a number.";
    }
  }

  if (step === 2) {
    if (s.authMethod === "psk" && !s.psk.trim()) e.psk = "This field is required.";
    if (s.authMethod === "signature" && !s.certificate.trim()) e.certificate = "This field is required.";
    if (s.authMethod === "signature" && c.peerType === "one" && !c.peerId.trim()) {
      e.peerId = "A peer ID is required when Accept Types is 'Specify a peer ID'.";
    }
    if (!c.p1Proposals.some(p1RowComplete)) e.p1Proposals = "Add at least one complete proposal.";
    if (!c.p1DHGroups.length) e.p1DHGroups = "Select at least one Diffie-Hellman group.";
    if (c.keylife.trim() && !isPositiveInt(c.keylife)) e.keylife = "Enter a positive number of seconds.";
  }

  if (step === 3) {
    const cidrHint = c.ipVersion === "6" ? "Enter a valid CIDR (e.g. 2001:db8::/64)." : "Enter a valid CIDR (e.g. 192.168.1.0/24).";
    if (c.p2LocalSubnet.trim() && !subnetValidFor(c.p2LocalSubnet, c.ipVersion)) e.p2LocalSubnet = cidrHint;
    if (c.p2RemoteSubnet.trim() && !subnetValidFor(c.p2RemoteSubnet, c.ipVersion)) e.p2RemoteSubnet = cidrHint;
    if (!c.p2Proposals.some(p2RowComplete)) e.p2Proposals = "Add at least one complete proposal.";
    if (c.p2Pfs && !c.p2DHGroups.length) e.p2DHGroups = "Select at least one Diffie-Hellman group (or turn off PFS).";
    if (!c.p2LocalPortAll && !isPort(c.p2LocalPort)) e.p2LocalPort = "Enter a port between 0 and 65535.";
    if (!c.p2RemotePortAll && !isPort(c.p2RemotePort)) e.p2RemotePort = "Enter a port between 0 and 65535.";
    if (!c.p2ProtocolAll && !isProtocol(c.p2Protocol)) e.p2Protocol = "Enter a protocol number between 0 and 255.";
    if (c.p2KeylifeSeconds.trim() && !isPositiveInt(c.p2KeylifeSeconds)) e.p2KeylifeSeconds = "Enter a positive number of seconds.";
  }

  return e;
};

// isSubnetSpec — a permissive CIDR / bare-host check, matching the backend's IsValidSubnetSpec so
// the wizard rejects the same typos the device would.
const isSubnetSpec = (v: string): boolean => {
  const s = v.trim();
  if (!s) return false;
  const [ip, mask] = s.split("/");
  if (mask === undefined) return isIPv4(ip);
  const m = Number(mask);
  return isIPv4(ip) && Number.isInteger(m) && m >= 0 && m <= 32;
};

// The Custom template's Object Summary — just the tunnel itself, because that is all it creates.
export const customObjectSummary = (s: VPNWizardState): VPNSummaryRow[] => {
  const name = s.name.trim() || "VPN";
  return [
    { label: "Phase 1 interface", value: name },
    { label: "Phase 2 interface", value: name },
  ];
};

// buildCustomPayload turns the wizard's Custom state into the backend's tunnelInput. The proposal
// lists and DH grids are serialized here (the backend passes the strings straight to the device),
// and fields that don't apply to the chosen shape are sent empty.
export const buildCustomPayload = (s: VPNWizardState): IPsecTunnelPayload => {
  const c = s.custom;
  const remoteType = customRemoteTypeOf(c);
  const signature = s.authMethod === "signature";

  const custom: IPsecCustomPayload = {
    ip_version: c.ipVersion,
    // Local Gateway: only a "Specify" value is a real local-gw; Primary IP leaves it at the default.
    local_gateway: c.localGwEnabled && c.localGwMode === "specify" ? c.localGwIP.trim() : "",
    mode_config: c.modeConfig,
    keepalive: c.keepalive.trim(),
    dpd: c.dpd,
    dpd_retry_count: c.dpd !== "disable" ? c.dpdRetryCount.trim() : "",
    dpd_retry_interval: c.dpd !== "disable" ? c.dpdRetryInterval.trim() : "",
    fec_egress: c.fecEgress,
    fec_ingress: c.fecIngress,

    add_route: c.addRoute,
    auto_discovery_sender: c.autoDiscoverySender,
    auto_discovery_receiver: c.autoDiscoveryReceiver,
    exchange_interface_ip: c.exchangeInterfaceIP,
    net_device: c.netDevice,
    aggregate_member: c.aggregateMember,

    // Mode is IKEv1-only; never send it on IKEv2. Peer ID is a signature-only Peer Option.
    ike_mode: c.ikeVersion === "1" ? c.ikeMode : undefined,
    peer_type: signature ? c.peerType : "any",
    peer_id: signature && c.peerType === "one" ? c.peerId.trim() : "",
    local_id: c.localId.trim(),
    keylife: c.keylife.trim(),

    p2_local_subnet: c.p2LocalSubnet.trim(),
    p2_remote_subnet: c.p2RemoteSubnet.trim(),
    p2_proposal: serializeP2Proposal(c.p2Proposals),
    p2_replay: c.p2Replay,
    p2_pfs: c.p2Pfs,
    p2_dhgroup: c.p2Pfs ? serializeDH(c.p2DHGroups) : "",
    p2_local_port: c.p2LocalPortAll ? "0" : c.p2LocalPort.trim(),
    p2_remote_port: c.p2RemotePortAll ? "0" : c.p2RemotePort.trim(),
    p2_protocol: c.p2ProtocolAll ? "0" : c.p2Protocol.trim(),
    p2_auto_negotiate: c.p2AutoNegotiate,
    p2_keepalive: c.p2Keepalive,
    p2_keylife_seconds: c.p2KeylifeSeconds.trim(),
  };

  return {
    name: s.name.trim(),
    interface: s.outInterface,
    ike_version: c.ikeVersion,
    remote_type: remoteType,
    remote_gw: remoteType === "static" ? c.remoteGwIP.trim() : "",
    remote_ddns: remoteType === "ddns" ? c.remoteDdns.trim() : "",
    nattraversal: c.natTraversal,
    auth_method: s.authMethod,
    psk: signature ? "" : s.psk,
    certificate: signature ? s.certificate.trim() : "",
    peer_ca: signature ? s.peerCA.trim() : "",
    proposal: serializeP1Proposal(c.p1Proposals),
    dhgroup: serializeDH(c.p1DHGroups),
    local_subnets: [],
    remote_subnets: [],
    comments: c.comments.trim() || "Custom — created by the VPN Creation Wizard",
    custom,
  };
};

// ─── Edit (load a tunnel back into the Custom form) ──────────────────────────────────────────

// parseProposal is the inverse of serializeP1/P2Proposal: it turns FortiOS's space-separated
// `enc-auth` string back into editor rows. An AEAD cipher standing alone (phase2 "aes128gcm") has
// no second algorithm, so its auth is left blank.
export const parseProposal = (proposal: string): CustomProposalRow[] => {
  const rows = (proposal || "").trim().split(/\s+/).filter(Boolean).map((tok) => {
    const dash = tok.indexOf("-");
    return dash === -1 ? { enc: tok, auth: "" } : { enc: tok.slice(0, dash), auth: tok.slice(dash + 1) };
  });
  return rows.length ? rows : [{ enc: "aes256", auth: "sha256" }];
};

// parseDH turns a "14 5" DH string back into the number list the grid uses.
export const parseDH = (dh: string): number[] =>
  (dh || "").trim().split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));

// customStateFromEdit builds a wizard state (Custom template) pre-filled from a tunnel read off the
// device — the inverse of buildCustomPayload. The PSK stays blank: it is never read back, and a
// blank one on save keeps the stored secret.
export const customStateFromEdit = (e: IPsecTunnelEdit): VPNWizardState => {
  const ec = e.custom;
  const ipVersion: "4" | "6" = ec.ip_version === "6" ? "6" : "4";
  const remoteGateway: CustomRemoteGateway =
    e.remote_type === "dynamic" ? "dialup" : e.remote_type === "ddns" ? "ddns" : "static";
  const portAll = (v: string) => !v || v.trim() === "0";
  return {
    ...BLANK_VPN_WIZARD,
    name: e.name,
    templateType: "custom",
    outInterface: e.interface,
    authMethod: e.auth_method === "signature" ? "signature" : "psk",
    psk: "",
    certificate: e.certificate || "",
    peerCA: "",
    custom: {
      ...BLANK_CUSTOM,
      comments: e.comments || "",
      ipVersion,
      remoteGateway,
      remoteGwIP: e.remote_gw || "",
      remoteDdns: e.remote_ddns || "",
      localGwEnabled: !!ec.local_gateway,
      localGwMode: ec.local_gateway ? "specify" : "primary",
      localGwIP: ec.local_gateway || "",
      modeConfig: !!ec.mode_config,
      natTraversal: (e.nattraversal || "enable") as IPsecNATTraversal,
      keepalive: ec.keepalive || "10",
      dpd: (ec.dpd || "on-demand") as CustomDPD,
      dpdRetryCount: ec.dpd_retry_count || "3",
      dpdRetryInterval: ec.dpd_retry_interval || "20",
      fecEgress: !!ec.fec_egress,
      fecIngress: !!ec.fec_ingress,
      addRoute: !!ec.add_route,
      autoDiscoverySender: !!ec.auto_discovery_sender,
      autoDiscoveryReceiver: !!ec.auto_discovery_receiver,
      exchangeInterfaceIP: !!ec.exchange_interface_ip,
      netDevice: !!ec.net_device,
      aggregateMember: !!ec.aggregate_member,
      ikeVersion: e.ike_version === "1" ? "1" : "2",
      ikeMode: (ec.ike_mode === "aggressive" ? "aggressive" : "main") as CustomIKEMode,
      peerType: (ec.peer_type === "one" ? "one" : "any") as CustomPeerType,
      peerId: ec.peer_id || "",
      localId: ec.local_id || "",
      keylife: ec.keylife || "86400",
      p1Proposals: parseProposal(e.proposal),
      p1DHGroups: parseDH(e.dhgroup),
      p2LocalSubnet: ec.p2_local_subnet || "",
      p2RemoteSubnet: ec.p2_remote_subnet || "",
      p2Proposals: parseProposal(ec.p2_proposal),
      p2Replay: !!ec.p2_replay,
      p2Pfs: !!ec.p2_pfs,
      p2DHGroups: parseDH(ec.p2_dhgroup),
      p2LocalPortAll: portAll(ec.p2_local_port),
      p2LocalPort: ec.p2_local_port || "0",
      p2RemotePortAll: portAll(ec.p2_remote_port),
      p2RemotePort: ec.p2_remote_port || "0",
      p2ProtocolAll: portAll(ec.p2_protocol),
      p2Protocol: ec.p2_protocol || "0",
      p2AutoNegotiate: !!ec.p2_auto_negotiate,
      p2Keepalive: !!ec.p2_keepalive,
      p2KeylifeSeconds: ec.p2_keylife_seconds || "43200",
    },
  };
};

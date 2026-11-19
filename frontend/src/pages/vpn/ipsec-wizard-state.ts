import type {
  IPsecAuthMethod, IPsecInternetAccess, IPsecNATTraversal, IPsecRemoteType,
} from "../../api/policyObject";


// Hub-and-Spoke roles + spoke enumeration modes (the GUI's "Role" and "Spoke type" toggles).
export type HubSpokeRole = "hub" | "spoke";
export type HubSpokeSpokeType = "individual" | "range";

// The pure rules behind the VPN Creation Wizard — everything that decides what the user sees and
// what gets POSTed, with no React in the way. They live here rather than inside the component so
// they can be unit-tested: the mapping is subtle (a "NAT configuration" choice silently changes
// the tunnel's TYPE), and a wrong branch produces a tunnel that builds cleanly and never comes up.

export type VPNTemplateType = "site-to-site" | "hub-and-spoke" | "remote-access" | "custom";
export type VPNNATConfig = "none" | "this-site" | "remote-site";
export type VPNRemoteDeviceType = "fortigate" | "cisco";
export type VPNRemoteDeviceKind = "ip" | "ddns";

// Remote Access (dialup) — the "Remote device type" row of the GUI's VPN Setup step.
export type RADeviceKind = "client-based" | "native";
export type RAClientType = "forticlient" | "cisco";
export type RANativeType = "ios" | "android" | "windows";
export type RADNSMode = "auto" | "manual";

export type VPNWizardState = {
  // Step 1 — VPN Setup
  name: string;
  templateType: VPNTemplateType;
  natConfig: VPNNATConfig;
  remoteDeviceType: VPNRemoteDeviceType;

  // Step 1 — VPN Setup (Remote Access variant of "Remote device type")
  raDeviceKind: RADeviceKind;
  raClient: RAClientType;
  raNative: RANativeType;

  // Step 2 — Authentication
  remoteDeviceKind: VPNRemoteDeviceKind;
  remoteGw: string;
  remoteFqdn: string;
  outInterface: string;
  authMethod: IPsecAuthMethod;
  psk: string;
  certificate: string;
  peerCA: string;
  userGroup: string;        // Remote Access — the User Group clients authenticate against (authusrgrp)
  requireGroupName: boolean; // Cisco only — "Require 'Group Name' on VPN client"
  groupName: string;         // Cisco only — the group name (peerid)

  // Step 3 — Policy & Routing
  localInterface: string;
  localSubnets: string[];
  remoteSubnets: string[];
  internetAccess: IPsecInternetAccess;
  sharedWAN: string;
  localGateway: string;

  // Step 3 — Policy & Routing (Remote Access)
  localAddresses: string[]; // existing addresses reached over the VPN (the split-tunnel group members)
  clientRangeStart: string; // ipv4-start-ip
  clientRangeEnd: string;   // ipv4-end-ip
  clientNetmask: string;    // ipv4-netmask
  dnsMode: RADNSMode;       // Use System DNS | Specify
  dnsServer: string;        // when dnsMode = manual
  splitTunnel: boolean;     // Enable IPv4 Split Tunnel
  endpointRegistration: boolean; // Allow Endpoint Registration

  // Step 4 — Client Options (Remote Access only)
  savePassword: boolean;
  autoConnect: boolean;
  alwaysUp: boolean;

  // Custom template — the GUI's manual "New VPN Tunnel" form (see CustomState).
  custom: CustomState;

  // ── Hub-and-Spoke template (ADVPN + BGP) ──
  // Step 1 — VPN Setup
  hsRole: HubSpokeRole;   // Hub | Spoke
  hsEasyKey: string;      // Spoke — the GUI's "Easy configuration key" (FortiManager feature; see note)
  // Step 3 — Tunnel Interface
  hsTunnelIP: string;     // this device's tunnel-interface IP (10.10.1.1)
  hsRemoteIP: string;     // the peer end of the overlay + mask (10.10.1.2/24)
  // Step 4 — Policy & Routing (BGP). localInterface + localSubnets above are reused.
  hsLocalAS: string;      // 65400
  hsSpokeType: HubSpokeSpokeType; // Hub — Individual | Range
  hsSpokeTunnelIPs: string[];     // Hub Individual — one BGP neighbor per spoke tunnel IP
  hsSpokeRangePrefix: string;     // Hub Range — the overlay subnet (10.10.1.0/24)
  hsRemoteGW: string;     // Spoke — the hub's public IP (phase1 remote-gw)
};

// ─── Custom template state ───────────────────────────────────────────────────────────────────
// One editable Encryption+Authentication pair in a proposal list. For an AEAD cipher (GCM /
// ChaCha20) the second column is a PRF in phase1 and is unused in phase2 (the cipher authenticates
// itself) — see serializeP1Proposal / serializeP2Proposal.
export type CustomProposalRow = { enc: string; auth: string };

export type CustomRemoteGateway = "static" | "dialup" | "ddns";
export type CustomLocalGateway = "primary" | "specify";
export type CustomDPD = "disable" | "on-idle" | "on-demand";
export type CustomIKEMode = "aggressive" | "main";
export type CustomPeerType = "any" | "one";

export type CustomState = {
  comments: string;

  // ── Network ──
  ipVersion: "4" | "6";
  remoteGateway: CustomRemoteGateway; // Static IP Address | Dialup User | Dynamic DNS
  remoteGwIP: string;                 // when remoteGateway = "static"
  remoteDdns: string;                 // when remoteGateway = "ddns"
  localGwMode: CustomLocalGateway;    // Primary IP | Specify  (toggle off = primary)
  localGwEnabled: boolean;            // the "Local Gateway" toggle
  localGwIP: string;                  // when localGwMode = "specify"
  modeConfig: boolean;
  natTraversal: IPsecNATTraversal;
  keepalive: string;                  // Keepalive Frequency (seconds)
  dpd: CustomDPD;
  dpdRetryCount: string;
  dpdRetryInterval: string;
  fecEgress: boolean;
  fecIngress: boolean;

  // Network → Advanced
  advancedOpen: boolean;              // UI-only: is the Advanced panel expanded
  addRoute: boolean;
  autoDiscoverySender: boolean;
  autoDiscoveryReceiver: boolean;
  exchangeInterfaceIP: boolean;
  netDevice: boolean;                 // "Device creation"
  aggregateMember: boolean;

  // ── Authentication ──
  ikeVersion: "1" | "2";
  ikeMode: CustomIKEMode;             // IKEv1 only
  peerType: CustomPeerType;           // Accept Types (signature Peer Options)
  peerId: string;                     // when peerType = "one"
  p1Proposals: CustomProposalRow[];
  p1DHGroups: number[];
  keylife: string;                    // phase1 key lifetime (seconds)
  localId: string;

  // ── Phase 2 Selector ──
  p2LocalSubnet: string;
  p2RemoteSubnet: string;
  p2Proposals: CustomProposalRow[];
  p2Replay: boolean;
  p2Pfs: boolean;
  p2DHGroups: number[];
  p2LocalPortAll: boolean;
  p2LocalPort: string;
  p2RemotePortAll: boolean;
  p2RemotePort: string;
  p2ProtocolAll: boolean;
  p2Protocol: string;
  p2AutoNegotiate: boolean;
  p2Keepalive: boolean;               // Autokey Keep Alive
  p2KeylifeSeconds: string;
};

export const BLANK_VPN_WIZARD: VPNWizardState = {
  name: "",
  templateType: "site-to-site",
  natConfig: "none",
  remoteDeviceType: "fortigate",

  raDeviceKind: "client-based",
  raClient: "forticlient",
  raNative: "ios",

  remoteDeviceKind: "ip",
  remoteGw: "",
  remoteFqdn: "",
  outInterface: "",
  authMethod: "psk",
  psk: "",
  certificate: "",
  peerCA: "",
  userGroup: "",
  requireGroupName: false,
  groupName: "",

  localInterface: "",
  localSubnets: [""],
  remoteSubnets: [""],
  internetAccess: "none",
  sharedWAN: "",
  localGateway: "",

  localAddresses: [""],
  clientRangeStart: "",
  clientRangeEnd: "",
  clientNetmask: "255.255.255.0",
  dnsMode: "auto",
  dnsServer: "",
  splitTunnel: true,
  endpointRegistration: true,

  savePassword: true,
  autoConnect: false,
  alwaysUp: false,

  custom: BLANK_CUSTOM_HOLDER(),

  hsRole: "hub",
  hsEasyKey: "",
  hsTunnelIP: "",
  hsRemoteIP: "",
  hsLocalAS: "",
  hsSpokeType: "individual",
  hsSpokeTunnelIPs: [""],
  hsSpokeRangePrefix: "",
  hsRemoteGW: "",
};

// ─── Custom template constants ───────────────────────────────────────────────────────────────

// The proposal pickers' option lists, straight from the FortiGate 7.2.10 Custom form.
export const CUSTOM_ENC_OPTIONS = ["aes128", "aes192", "aes256", "aes128gcm", "aes256gcm", "chacha20poly1305", "3des", "des"];
export const CUSTOM_AUTH_OPTIONS = ["md5", "sha1", "sha256", "sha384", "sha512"];      // for CBC ciphers
export const CUSTOM_PRF_OPTIONS = ["prfsha1", "prfsha256", "prfsha384", "prfsha512"]; // for AEAD ciphers in phase1
export const CUSTOM_DH_GROUPS = [32, 31, 30, 29, 28, 27, 21, 20, 19, 18, 17, 16, 15, 14, 5, 2, 1];

// isAEADCipher reports whether an encryption algorithm authenticates itself (GCM / ChaCha20-Poly1305).
// Such a cipher takes a PRF (not a hash) in a phase1 proposal, and NO second algorithm in phase2.
export const isAEADCipher = (enc: string): boolean =>
  /gcm$/i.test(enc) || enc.toLowerCase() === "chacha20poly1305";

// The default proposal sets the GUI fills in, per IKE version — read from the Custom form's own
// Phase 1 Proposal list (IKEv1 uses HMAC pairs; IKEv2 adds the AEAD+PRF rows).
export const P1_PROPOSAL_DEFAULT_V1: CustomProposalRow[] = [
  { enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" },
  { enc: "aes128", auth: "sha1" }, { enc: "aes256", auth: "sha1" },
];
export const P1_PROPOSAL_DEFAULT_V2: CustomProposalRow[] = [
  { enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" },
  { enc: "aes128gcm", auth: "prfsha256" }, { enc: "aes256gcm", auth: "prfsha384" },
  { enc: "chacha20poly1305", auth: "prfsha256" },
];

// The default proposal set for an IKE version — used at init and whenever the version toggles (the
// GUI re-defaults the list too, since an AEAD+PRF row is invalid on IKEv1 and vice-versa).
export const p1ProposalDefaultFor = (ike: "1" | "2"): CustomProposalRow[] =>
  (ike === "1" ? P1_PROPOSAL_DEFAULT_V1 : P1_PROPOSAL_DEFAULT_V2).map((r) => ({ ...r }));

export function BLANK_CUSTOM_HOLDER(): CustomState {
  return {
    comments: "",
    ipVersion: "4",
    remoteGateway: "static",
    remoteGwIP: "",
    remoteDdns: "",
    localGwMode: "primary",
    localGwEnabled: false,
    localGwIP: "",
    modeConfig: false,
    natTraversal: "enable",
    keepalive: "10",
    dpd: "on-demand",
    dpdRetryCount: "3",
    dpdRetryInterval: "20",
    fecEgress: false,
    fecIngress: false,
    advancedOpen: false,
    addRoute: true,
    autoDiscoverySender: false,
    autoDiscoveryReceiver: false,
    exchangeInterfaceIP: false,
    netDevice: false,
    aggregateMember: false,
    ikeVersion: "2",
    ikeMode: "main",
    peerType: "any",
    peerId: "",
    // Inlined literals (not the exported consts) so this holder stays self-contained — it runs at
    // module load inside BLANK_VPN_WIZARD, before the exported const arrays are initialised.
    p1Proposals: [
      { enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" },
      { enc: "aes128gcm", auth: "prfsha256" }, { enc: "aes256gcm", auth: "prfsha384" },
      { enc: "chacha20poly1305", auth: "prfsha256" },
    ],
    p1DHGroups: [14, 5],
    keylife: "86400",
    localId: "",
    p2LocalSubnet: "",
    p2RemoteSubnet: "",
    p2Proposals: [
      { enc: "aes128", auth: "sha1" }, { enc: "aes256", auth: "sha1" },
      { enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" },
      { enc: "aes128gcm", auth: "" }, { enc: "aes256gcm", auth: "" }, { enc: "chacha20poly1305", auth: "" },
    ],
    p2Replay: true,
    p2Pfs: true,
    p2DHGroups: [14, 5],
    p2LocalPortAll: true,
    p2LocalPort: "0",
    p2RemotePortAll: true,
    p2RemotePort: "0",
    p2ProtocolAll: true,
    p2Protocol: "0",
    p2AutoNegotiate: false,
    p2Keepalive: false,
    p2KeylifeSeconds: "43200",
  };
}

export const BLANK_CUSTOM: CustomState = BLANK_CUSTOM_HOLDER();

// Site to Site and Remote Access are implemented. Hub-and-Spoke and Custom are rendered (the real
// GUI has them) but selecting one is a dead end rather than a silently wrong tunnel.
export const VPN_TEMPLATES: { v: VPNTemplateType; l: string }[] = [
  { v: "site-to-site", l: "Site to Site" },
  { v: "hub-and-spoke", l: "Hub-and-Spoke" },
  { v: "remote-access", l: "Remote Access" },
  { v: "custom", l: "Custom" },
];
export const templateSupported = (t: VPNTemplateType) =>
  t === "site-to-site" || t === "remote-access" || t === "custom" || t === "hub-and-spoke";

// isHubSpoke / hubIsHub / hubIsSpoke — the Hub-and-Spoke template and its Role branch.
export const isHubSpoke = (s: VPNWizardState): boolean => s.templateType === "hub-and-spoke";
export const hubIsHub = (s: VPNWizardState): boolean => isHubSpoke(s) && s.hsRole !== "spoke";
export const hubIsSpoke = (s: VPNWizardState): boolean => isHubSpoke(s) && s.hsRole === "spoke";
export const hubIsRange = (s: VPNWizardState): boolean => hubIsHub(s) && s.hsSpokeType === "range";

export const isRemoteAccess = (s: VPNWizardState): boolean => s.templateType === "remote-access";

// Custom is the GUI's manual "New VPN Tunnel" form — a full phase1/phase2 editor that creates only
// the tunnel (no address objects, policies or routes).
export const isCustom = (s: VPNWizardState): boolean => s.templateType === "custom";

// Every Remote Access template is wired up end-to-end: the two client-based ones (FortiClient,
// Cisco) as IKE mode-config dialup, and the three Native ones as L2TP/IPsec.
export const remoteAccessDeviceSupported = (_s: VPNWizardState): boolean => true;

// raIsNative = the GUI's "Native" toggle (iOS / Android / Windows). ⚠️ It is NOT the same thing as
// "is an L2TP tunnel" — see raIsL2TP.
export const raIsNative = (s: VPNWizardState): boolean =>
  isRemoteAccess(s) && s.raDeviceKind === "native";

// 🔴 Only ANDROID and WINDOWS are L2TP over IPsec. **iOS is not** — despite sitting under "Native",
// its phase1 is a normal IKE mode-config dialup (mode-cfg=enable, l2tp=disable, tunnel-mode).
// Verified by reading back tunnels the device's own wizard created; it is also why the GUI titles
// iOS "Dialup - iOS (Native)" WITHOUT the "L2TP/IPsec" the other two carry.
//
// L2TP tunnels have no mode-config, so they have no split tunnel, no DNS push and no client options.
export const raIsL2TP = (s: VPNWizardState): boolean =>
  raIsNative(s) && (s.raNative === "android" || s.raNative === "windows");

// raClientId is the remote device type the backend keys off: "forticlient" | "cisco" for
// client-based, or the OS name for Native.
export const raClientId = (s: VPNWizardState): RAClientType | RANativeType =>
  s.raDeviceKind === "native" ? s.raNative : s.raClient;

// Only FortiClient has a Client Options step (Save Password / Auto Connect / Always Up) — those are
// IKE mode-config keys the other templates do not have. That is what makes FortiClient 5 steps and
// every other Remote Access template 4.
export const raHasClientOptions = (s: VPNWizardState): boolean =>
  isRemoteAccess(s) && s.raDeviceKind === "client-based" && s.raClient === "forticlient";

// "Require 'Group Name' on VPN client" — the Cisco AND iOS Authentication steps both carry it
// (verified against the GUI). Endpoint Registration stays FortiClient-only.
export const raShowsGroupName = (s: VPNWizardState): boolean =>
  isRemoteAccess(s) && (raClientId(s) === "cisco" || raClientId(s) === "ios");
export const raShowsEndpointRegistration = (s: VPNWizardState): boolean => raHasClientOptions(s);

// Split tunnel + DNS push are IKE mode-config features, so only the L2TP templates
// (Android/Windows) hide them. iOS keeps both — its Policy & Routing step shows DNS Server and
// Enable IPv4 Split Tunnel exactly like the client-based ones.
export const raShowsModeCfgOptions = (s: VPNWizardState): boolean =>
  isRemoteAccess(s) && !raIsL2TP(s);

// The Subnet Mask each template defaults to, matching the GUI: FortiClient and the L2TP templates
// fill in a /24, while Cisco and iOS simply show the device default (ipv4-netmask 255.255.255.255).
//
// ⚠️ On an L2TP VPN the Subnet Mask is NOT cosmetic and is NOT stored anywhere on the device: it is
// the only input that decides the L2TP route's destination (= range start masked by it).
export const RA_DEFAULT_NETMASK: Record<RAClientType | RANativeType, string> = {
  forticlient: "255.255.255.0",
  cisco: "255.255.255.255",
  ios: "255.255.255.255",
  android: "255.255.255.0",
  windows: "255.255.255.0",
};

export const VPN_NAT_CONFIGS: { v: VPNNATConfig; l: string }[] = [
  { v: "none", l: "No NAT between sites" },
  { v: "this-site", l: "This site is behind NAT" },
  { v: "remote-site", l: "The remote site is behind NAT" },
];

// ─── The mapping (verified live — see services/fortigate.go's FGIPsecTunnelWrite) ─────────────

// remoteTypeOf decides the phase1 `type`, and it is the least obvious rule in the wizard:
// "The remote site is behind NAT" is NOT a flag on a site-to-site tunnel — it makes the tunnel
// DIALUP (type=dynamic), because a remote behind NAT has no address this side can dial. That is
// exactly why the GUI's diagram re-titles itself "Dialup - FortiGate" the moment it is chosen.
export const remoteTypeOf = (s: VPNWizardState): IPsecRemoteType => {
  if (s.natConfig === "remote-site") return "dynamic";
  if (s.remoteDeviceKind === "ddns") return "ddns";
  return "static";
};

// "This site is behind NAT" forces NAT-T encapsulation instead of leaving it to auto-detection.
export const natTraversalOf = (s: VPNWizardState): IPsecNATTraversal =>
  s.natConfig === "this-site" ? "forced" : "enable";

// A dialup tunnel has no remote address to ask for, so the whole "Remote device" row goes away.
export const showsRemoteAddress = (s: VPNWizardState): boolean => s.natConfig !== "remote-site";

// ─── Diagram (the right-hand panel) ──────────────────────────────────────────────────────────

export const remoteDeviceLabel = (s: VPNWizardState): string =>
  s.remoteDeviceType === "cisco" ? "Cisco" : "FortiGate";

// The Remote Access remote-device label — mirrors the GUI's diagram heading per device type.
const RA_CLIENT_LABEL: Record<RAClientType, string> = {
  forticlient: "FortiClient (Windows, Mac OS, Android)",
  cisco: "Cisco IPsec Client",
};
const RA_NATIVE_LABEL: Record<RANativeType, string> = {
  ios: "iOS (Native)",
  android: "Android (Native L2TP/IPsec)",
  windows: "Windows (Native L2TP/IPsec)",
};
export const remoteAccessDeviceLabel = (s: VPNWizardState): string =>
  s.raDeviceKind === "native" ? RA_NATIVE_LABEL[s.raNative] : RA_CLIENT_LABEL[s.raClient];

// A short label for the diagram's remote device box.
const RA_NATIVE_SHORT: Record<RANativeType, string> = { ios: "iOS", android: "Android", windows: "Windows" };
export const remoteAccessShortLabel = (s: VPNWizardState): string =>
  s.raDeviceKind === "native" ? RA_NATIVE_SHORT[s.raNative] : (s.raClient === "cisco" ? "Cisco Client" : "FortiClient");

// The heading above the diagram. It follows the TUNNEL TYPE, not the template name: a remote
// behind NAT is a dialup tunnel and the GUI says so; Remote Access is always dialup.
export const diagramTitle = (s: VPNWizardState): string => {
  if (isCustom(s)) {
    const rt = customRemoteTypeOf(s.custom);
    return `Custom - ${rt === "dynamic" ? "Dialup" : rt === "ddns" ? "Dynamic DNS" : "Static"}`;
  }
  if (isHubSpoke(s)) return `Hub-and-Spoke - FortiGate (${hubIsSpoke(s) ? "Spoke" : "Hub"})`;
  if (isRemoteAccess(s)) return `Dialup - ${remoteAccessDeviceLabel(s)}`;
  return `${remoteTypeOf(s) === "dynamic" ? "Dialup" : "Site to Site"} - ${remoteDeviceLabel(s)}`;
};

// Which side of the Internet cloud the NAT badge sits on, or null for no NAT at all.
export const natBadgeSide = (s: VPNWizardState): "local" | "remote" | null => {
  if (s.natConfig === "this-site") return "local";
  if (s.natConfig === "remote-site") return "remote";
  return null;
};

// ─── Policy & Routing ────────────────────────────────────────────────────────────────────────

export const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);

// "Use Remote" means this site reaches the Internet THROUGH the tunnel, so the remote selector is
// the default route by definition — the field is shown locked at 0.0.0.0/0 rather than left for
// the user to get wrong.
export const remoteSubnetsLocked = (s: VPNWizardState): boolean => s.internetAccess === "use-remote";

export const effectiveRemoteSubnets = (s: VPNWizardState): string[] =>
  remoteSubnetsLocked(s) ? ["0.0.0.0/0"] : clean(s.remoteSubnets);

// A permissive IPv4 check - enough to catch typos before the device does, not a full validator.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIPv4 = (v: string): boolean => IPV4_RE.test(v.trim());

export type VPNSummaryRow = { label: string; value: string };

// customRemoteTypeOf maps the "Remote Gateway" choice to the phase1 `type`: Dialup User is a
// listener (dynamic) with no address to dial, exactly like a Site-to-Site "remote behind NAT".
export const customRemoteTypeOf = (c: CustomState): IPsecRemoteType =>
  c.remoteGateway === "dialup" ? "dynamic" : c.remoteGateway === "ddns" ? "ddns" : "static";

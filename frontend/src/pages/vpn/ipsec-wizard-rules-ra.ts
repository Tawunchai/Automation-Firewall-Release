/**
 * Remote-access (dial-up FortiClient and native clients): validation and payload.
 *
 * Split out of ipsec-wizard-rules.ts, which reached 1,316 lines holding the validation, the object
 * summary and the payload builder for all four VPN templates at once. Every template's rules now
 * live together; the shared state, constants and predicates are in ./ipsec-wizard-state.
 */
import type {
  IPsecTunnelPayload,
} from "../../api/policyObject";
import type { VPNSummaryRow, VPNWizardState } from "./ipsec-wizard-state";
import { clean, isIPv4, raClientId, raHasClientOptions, raIsL2TP, raIsNative, raShowsEndpointRegistration, raShowsGroupName, raShowsModeCfgOptions, remoteAccessDeviceLabel, remoteAccessDeviceSupported } from "./ipsec-wizard-state";

// ─── Remote Access (dialup FortiClient) ────────────────────────────────────────────────────────

// Per-step validation for the Remote Access flow (VPN Setup → Authentication → Policy & Routing →
// Client Options → Review). Client Options (step 3) is all toggles, so it has nothing to validate.
export const validateRAStep = (s: VPNWizardState, step: number): Record<string, string> => {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!s.name.trim()) e.name = "This field is required.";
    if (!remoteAccessDeviceSupported(s)) {
      e.raDevice = "Only the client-based templates (FortiClient, Cisco) are wired up here — build the Native clients in the FortiGate GUI.";
    }
  }
  if (step === 1) {
    if (!s.outInterface) e.outInterface = "This field is required.";
    if (!s.userGroup) e.userGroup = "This field is required.";
    if (s.authMethod === "psk" && !s.psk.trim()) e.psk = "This field is required.";
    if (s.authMethod === "signature" && !s.certificate.trim()) e.certificate = "This field is required.";
    // A Cisco client told to present a group name has nothing to present without one.
    if (raShowsGroupName(s) && s.requireGroupName && !s.groupName.trim()) {
      e.groupName = "This field is required.";
    }
  }
  if (step === 2) {
    if (!s.localInterface) e.localInterface = "This field is required.";
    // L2TP always needs a local address (it is the policy's destination); the mode-config templates
    // only need one when split tunnelling scopes the VPN to it.
    const needsLocalAddress = raIsL2TP(s) || s.splitTunnel;
    if (needsLocalAddress && !clean(s.localAddresses).length) {
      e.localAddresses = "Select at least one local address.";
    }
    if (!isIPv4(s.clientRangeStart)) e.clientRangeStart = "Enter a valid IP address.";
    if (!isIPv4(s.clientRangeEnd)) e.clientRangeEnd = "Enter a valid IP address.";
    if (!isIPv4(s.clientNetmask)) e.clientNetmask = "Enter a valid subnet mask.";
    // DNS push only exists on the mode-config (client-based) templates.
    if (raShowsModeCfgOptions(s) && s.dnsMode === "manual" && !isIPv4(s.dnsServer)) {
      e.dnsServer = "Enter a valid DNS server IP.";
    }
  }
  return e;
};

// The network the Native template's L2TP route points at: the client range's START masked by the
// Subnet Mask. ⚠️ NOT the range itself — verified live (10.10.70.1 + 255.255.0.0 → 10.10.0.0/16).
// Mirrors services.L2TPRouteDst; the Review screen shows it so the user can catch a wrong mask.
export const l2tpRouteNetwork = (startIP: string, netmask: string): string => {
  if (!isIPv4(startIP) || !isIPv4(netmask)) return "";
  const ip = startIP.trim().split(".").map(Number);
  const mask = netmask.trim().split(".").map(Number);
  const bits = mask.reduce((n, o) => n + (o >>> 0).toString(2).split("1").length - 1, 0);
  return `${ip.map((o, i) => o & mask[i]).join(".")}/${bits}`;
};

// The objects a Remote Access tunnel brings with it, named exactly the way FortiGate's own wizard
// names them (its "Review Settings → Object Summary" is where these come from). ⚠️ MUST agree with
// services.RemoteAccessObjectNamesFor in the backend — both sides are pinned by tests.
export const raObjectNames = (tunnel: string) => ({
  splitGroup: `${tunnel}_split`,
  phase1: tunnel,
  phase2: tunnel,
  clientRange: `${tunnel}_range`,
  policyL2TP: `vpn_${tunnel}_l2tp`, // Native only
  policyRemoteToLocal: `vpn_${tunnel}_remote`,
});

// raObjectSummary lists every object the Remote Access configuration will create, in the GUI's
// order. The Split Tunnel Group only exists when split tunnelling is on; Endpoint Registration is
// listed only when requested (and is GUI-only on FortiOS 7.2 — see the backend).
export const raObjectSummary = (s: VPNWizardState): VPNSummaryRow[] => {
  const n = raObjectNames(s.name.trim() || "VPN");

  // The L2TP templates (Android/Windows) have their own object set entirely — no split group, but
  // an L2TP server, an L2TP policy and an L2TP route. Order lifted from the GUI's Review screen.
  // (iOS falls through to the mode-config summary below — it DOES get a Split Tunnel Group.)
  if (raIsL2TP(s)) {
    return [
      { label: "Phase 1 interface", value: n.phase1 },
      { label: "Phase 2 interface", value: n.phase2 },
      { label: "L2TP", value: "l2tp" }, // the vpn/l2tp SINGLETON — one per VDOM, hence no tunnel name
      { label: "Address", value: n.clientRange },
      { label: "L2TP Policy", value: n.policyL2TP },
      { label: "Remote to local policies", value: n.policyRemoteToLocal },
      // FortiOS keys routes by sequence number, so the GUI's summary just says "static".
      { label: "L2TP Route", value: "static" },
    ];
  }

  const rows: VPNSummaryRow[] = [];
  if (s.splitTunnel) rows.push({ label: "Split Tunnel Group", value: n.splitGroup });
  rows.push({ label: "Phase 1 interface", value: n.phase1 });
  rows.push({ label: "Phase 2 interface", value: n.phase2 });
  rows.push({ label: "Address", value: n.clientRange });
  rows.push({ label: "Remote to local policies", value: n.policyRemoteToLocal });
  // Endpoint Registration is a FortiClient-template row — the Cisco summary has no such line.
  if (raShowsEndpointRegistration(s) && s.endpointRegistration) {
    rows.push({ label: "Endpoint Registration", value: n.phase1 });
  }
  return rows;
};

// buildRemoteAccessPayload turns the wizard's state into the backend's tunnelInput for a dialup
// FortiClient VPN. Fields that don't apply to Remote Access are sent empty, and remote_access:true
// is what routes the request down the backend's dialup path.
export const buildRemoteAccessPayload = (s: VPNWizardState): IPsecTunnelPayload => {
  const signature = s.authMethod === "signature";
  const l2tp = raIsL2TP(s);
  const clientLabel = raIsNative(s)
    ? remoteAccessDeviceLabel(s)
    : s.raClient === "cisco" ? "Cisco IPsec Client" : "FortiClient";
  // An L2TP tunnel carries no mode-config, so split tunnelling does not exist for it — but its
  // local addresses ARE still needed: they are the remote-to-local policy's destination.
  const sendsLocalAddresses = l2tp || s.splitTunnel;
  return {
    name: s.name.trim(),
    interface: s.outInterface, // "Incoming Interface"
    ike_version: "1",          // both clients negotiate IKEv1 mode-config
    remote_gw: "",
    psk: signature ? "" : s.psk,
    local_subnets: [],
    remote_subnets: [],
    remote_type: "dynamic",
    auth_method: s.authMethod,
    certificate: signature ? s.certificate.trim() : "",
    peer_ca: signature ? s.peerCA.trim() : "",
    local_interface: s.localInterface,
    comments: `Remote Access (${clientLabel}) — created by the VPN Creation Wizard`,
    create_firewall_policy: true,

    remote_access: true,
    ra_client: raClientId(s),
    user_group: s.userGroup, // Native puts it on `vpn l2tp`; client-based puts it on phase1
    client_range_start: s.clientRangeStart.trim(),
    client_range_end: s.clientRangeEnd.trim(),
    client_netmask: s.clientNetmask.trim(),

    // Split tunnel + DNS push are mode-config only — never send them for an L2TP tunnel.
    dns_mode: l2tp ? undefined : s.dnsMode,
    dns_server: !l2tp && s.dnsMode === "manual" ? s.dnsServer.trim() : "",
    split_tunnel: l2tp ? false : s.splitTunnel,
    local_addresses: sendsLocalAddresses ? clean(s.localAddresses) : [],

    // Client Options + Endpoint Registration exist only on the FortiClient template — never send a
    // leftover value from a FortiClient session on another template.
    save_password: raHasClientOptions(s) ? s.savePassword : false,
    auto_connect: raHasClientOptions(s) ? s.autoConnect : false,
    always_up: raHasClientOptions(s) ? s.alwaysUp : false,
    endpoint_registration: raShowsEndpointRegistration(s) ? s.endpointRegistration : false,

    // Group Name — Cisco and iOS only.
    require_group_name: raShowsGroupName(s) ? s.requireGroupName : false,
    group_name: raShowsGroupName(s) && s.requireGroupName ? s.groupName.trim() : "",
  };
};

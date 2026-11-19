import type {
  IPsecTunnelPayload,
} from "../../api/policyObject";
import { sessionScopedKey } from "../../lib/sessionScope";
import type { RANativeType, VPNSummaryRow, VPNWizardState } from "./ipsec-wizard-state";
import { BLANK_VPN_WIZARD, clean, effectiveRemoteSubnets, isCustom, isHubSpoke, isRemoteAccess, natTraversalOf, remoteDeviceLabel, remoteSubnetsLocked, remoteTypeOf, showsRemoteAddress, templateSupported } from "./ipsec-wizard-state";
import { validateRAStep } from "./ipsec-wizard-rules-ra";
import { validateCustomStep } from "./ipsec-wizard-rules-custom";
import { validateHubSpokeStep } from "./ipsec-wizard-rules-hubspoke";

// Site-to-site validation and payload, plus the AI Assistant handover. The other three templates
// moved to sibling files; everything they and this file share is in ./ipsec-wizard-state.
//
// The re-exports at the bottom keep every existing `from "./ipsec-wizard-rules"` import working.

// ─── Validation, per step ────────────────────────────────────────────────────────────────────

// A permissive IPv4 check — enough to catch typos before the device does, not a full validator.


export const validateVPNStep = (s: VPNWizardState, step: number, editing = false): Record<string, string> => {
  if (isCustom(s)) return validateCustomStep(s, step);
  if (isHubSpoke(s)) return validateHubSpokeStep(s, step, editing);
  if (isRemoteAccess(s)) return validateRAStep(s, step);

  const e: Record<string, string> = {};
  if (step === 0) {
    if (!s.name.trim()) e.name = "This field is required.";
    if (!templateSupported(s.templateType)) {
      e.templateType = "Only the Site to Site and Remote Access templates are supported here — use the FortiGate GUI for the others.";
    }
  }
  if (step === 1) {
    if (showsRemoteAddress(s)) {
      if (s.remoteDeviceKind === "ip" && !s.remoteGw.trim()) e.remoteGw = "This field is required.";
      if (s.remoteDeviceKind === "ddns" && !s.remoteFqdn.trim()) e.remoteFqdn = "This field is required.";
    }
    if (!s.outInterface) e.outInterface = "This field is required.";
    if (s.authMethod === "psk" && !s.psk.trim()) e.psk = "This field is required.";
    if (s.authMethod === "signature" && !s.certificate.trim()) e.certificate = "This field is required.";
  }
  if (step === 2) {
    if (!clean(s.localSubnets).length) e.localSubnets = "This field is required.";
    // The remote selector is filled in for the user in "Use Remote", so it cannot be missing.
    if (!remoteSubnetsLocked(s) && !clean(s.remoteSubnets).length) e.remoteSubnets = "This field is required.";
    if (s.internetAccess === "share-local" && !s.sharedWAN) e.sharedWAN = "This field is required.";
    if (s.internetAccess === "use-remote" && !s.localGateway.trim()) e.localGateway = "This field is required.";
  }
  return e;
};

export const vpnStepValid = (s: VPNWizardState, step: number): boolean =>
  Object.keys(validateVPNStep(s, step)).length === 0;

// ─── Object Summary (step 4) ─────────────────────────────────────────────────────────────────

// The objects a Site-to-Site tunnel brings with it, named exactly the way FortiGate's own wizard
// names them (its "Review Settings → Object Summary" screen is where these names come from).
//
// ⚠️ This MUST agree with services.VPNObjectNamesFor in the backend — the summary is what the
// user approves before pressing Create, so a name that drifts here is a lie on screen. Both sides
// are pinned by tests.
export const vpnObjectNames = (tunnel: string) => ({
  phase1: tunnel,
  phase2: tunnel,
  localAddress: `${tunnel}_local`,
  remoteAddress: `${tunnel}_remote`,
  remoteGatewayAddress: `${tunnel}_remote_gateway`,
  policyLocalToRemote: `vpn_${tunnel}_local`,
  policyRemoteToLocal: `vpn_${tunnel}_remote`,
});


// vpnObjectSummary lists every object this configuration will create, in the GUI's order.
//
// Rows are CONDITIONAL on the configuration rather than fixed, because the summary's whole job is
// to say what will actually happen: the Remote Gateway address/route only exist when the Internet
// is reached through the remote site (that is the only time the tunnel's own packets need a host
// route around the default route), and a dialup tunnel has no remote gateway at all.
export const vpnObjectSummary = (s: VPNWizardState): VPNSummaryRow[] => {
  const n = vpnObjectNames(s.name.trim() || "VPN");
  const rows: VPNSummaryRow[] = [
    { label: "Phase 1 interface", value: n.phase1 },
    { label: "Local address group", value: n.localAddress },
    { label: "Remote address group", value: n.remoteAddress },
    { label: "Phase 2 interface", value: n.phase2 },
    // FortiOS keys routes by sequence number, so the GUI's summary just says "static" for each.
    { label: "Static route", value: "static" },
    { label: "Blackhole route", value: "static" },
    { label: "Local to remote policies", value: n.policyLocalToRemote },
    { label: "Remote to local policies", value: n.policyRemoteToLocal },
  ];
  if (s.internetAccess === "share-local") {
    rows.push({ label: "Internet access policy", value: `vpn_${s.name.trim() || "VPN"}_share` });
  }
  if (s.internetAccess === "use-remote") {
    rows.push({ label: "Internet access policy", value: `vpn_${s.name.trim() || "VPN"}_internet` });
    if (remoteTypeOf(s) === "static") {
      rows.push({ label: "Remote Gateway Address", value: n.remoteGatewayAddress });
      rows.push({ label: "Remote Gateway Route", value: "static" });
    }
  }
  return rows;
};

// ─── Payload ─────────────────────────────────────────────────────────────────────────────────

// buildTunnelPayload turns the wizard's state into exactly what the backend's tunnelInput expects.
// Fields that do not apply to the chosen shape are sent EMPTY rather than left over from an
// earlier answer — a stale remote_gw on a dialup tunnel, or a stale PSK on a signature tunnel, is
// how a wizard quietly configures something the user did not choose.
export const buildTunnelPayload = (s: VPNWizardState): IPsecTunnelPayload => {
  const remoteType = remoteTypeOf(s);
  const signature = s.authMethod === "signature";
  return {
    name: s.name.trim(),
    interface: s.outInterface,
    // The GUI's Site-to-Site template asks for no IKE version; the backend pins the rest of the
    // crypto (proposal/DH) the same way.
    ike_version: "2",
    remote_type: remoteType,
    remote_gw: remoteType === "static" ? s.remoteGw.trim() : "",
    remote_ddns: remoteType === "ddns" ? s.remoteFqdn.trim() : "",
    nattraversal: natTraversalOf(s),
    auth_method: s.authMethod,
    psk: signature ? "" : s.psk,
    certificate: signature ? s.certificate.trim() : "",
    peer_ca: signature ? s.peerCA.trim() : "",
    local_interface: s.localInterface,
    local_subnets: clean(s.localSubnets),
    remote_subnets: effectiveRemoteSubnets(s),
    internet_access: s.internetAccess,
    shared_wan: s.internetAccess === "share-local" ? s.sharedWAN : "",
    local_gateway: s.internetAccess === "use-remote" ? s.localGateway.trim() : "",
    comments: `Site to Site (${remoteDeviceLabel(s)}) — created by the VPN Creation Wizard`,
    create_static_route: true,
    create_firewall_policy: true,
  };
};

// ─── AI Assistant → VPN Wizard prefill ─────────────────────────────────────────────────────────
// AI_VPN_PREFILL_KEY is the sessionStorage slot the AI chat writes a parsed VPN payload into before
// navigating to the wizard with ?aiPrefill=1. The wizard reads it once on mount, prefills every step,
// and clears it — so an AI VPN suggestion opens the SAME reviewed multi-step wizard as a manual build.
//
// Session-scoped (lib/sessionScope) because the payload is firewall config written by one signed-in
// administrator: if they sign out on the way to the wizard the slot is still sitting in this tab,
// and logout must take it with everything else. The name is the key here — the wizard reads raw
// sessionStorage, and the prefix is what makes clearSessionScoped find it.
export const AI_VPN_PREFILL_KEY = sessionScopedKey("vpn-prefill");

// vpnStateFromPayload rebuilds a full wizard state from the AI's create payload (any VPN type). It is
// the inverse of the build*Payload functions, dispatching on the payload's shape (hub_spoke /
// remote_access / else site-to-site). The PSK survives (the AI generated it), so Create works
// straight through after the user reviews the steps.
export const vpnStateFromPayload = (p: IPsecTunnelPayload): VPNWizardState => {
  // Hub-and-Spoke
  if (p.hub_spoke) {
    const hs = p.hub_spoke;
    return {
      ...BLANK_VPN_WIZARD, templateType: "hub-and-spoke", name: p.name,
      hsRole: hs.role, outInterface: p.interface, authMethod: p.auth_method || "psk",
      psk: p.psk || "", certificate: p.certificate || "", peerCA: p.peer_ca || "",
      hsTunnelIP: hs.tunnel_ip, hsRemoteIP: hs.remote_ip, hsLocalAS: hs.local_as,
      localInterface: hs.local_interface || "",
      localSubnets: hs.local_subnets?.length ? hs.local_subnets : [""],
      hsSpokeType: hs.spoke_type === "range" ? "range" : "individual",
      hsSpokeTunnelIPs: hs.spoke_tunnel_ips?.length ? hs.spoke_tunnel_ips : [""],
      hsSpokeRangePrefix: hs.spoke_range_prefix || "",
      hsRemoteGW: hs.remote_gw || "",
    };
  }
  // Remote Access (dialup)
  if (p.remote_access) {
    const native = p.ra_client === "ios" || p.ra_client === "android" || p.ra_client === "windows";
    return {
      ...BLANK_VPN_WIZARD, templateType: "remote-access", name: p.name,
      raDeviceKind: native ? "native" : "client-based",
      raClient: p.ra_client === "cisco" ? "cisco" : "forticlient",
      raNative: native ? (p.ra_client as RANativeType) : "ios",
      outInterface: p.interface, authMethod: p.auth_method || "psk", psk: p.psk || "",
      certificate: p.certificate || "", peerCA: p.peer_ca || "",
      userGroup: p.user_group || "", localInterface: p.local_interface || "",
      clientRangeStart: p.client_range_start || "", clientRangeEnd: p.client_range_end || "",
      clientNetmask: p.client_netmask || "255.255.255.0",
      dnsMode: p.dns_mode === "manual" ? "manual" : "auto", dnsServer: p.dns_server || "",
      splitTunnel: !!p.split_tunnel,
      localAddresses: p.local_addresses?.length ? p.local_addresses : [""],
      savePassword: !!p.save_password, autoConnect: !!p.auto_connect, alwaysUp: !!p.always_up,
      requireGroupName: !!p.require_group_name, groupName: p.group_name || "",
    };
  }
  // Site-to-Site (default)
  return {
    ...BLANK_VPN_WIZARD, templateType: "site-to-site", name: p.name,
    outInterface: p.interface, authMethod: p.auth_method || "psk", psk: p.psk || "",
    certificate: p.certificate || "", peerCA: p.peer_ca || "",
    natConfig: p.nattraversal === "forced" ? "this-site" : p.remote_type === "dynamic" ? "remote-site" : "none",
    remoteDeviceKind: p.remote_type === "ddns" ? "ddns" : "ip",
    remoteGw: p.remote_gw || "", remoteFqdn: p.remote_ddns || "",
    localInterface: p.local_interface || "",
    localSubnets: p.local_subnets?.length ? p.local_subnets : [""],
    remoteSubnets: p.remote_subnets?.length ? p.remote_subnets : [""],
  };
};

export * from "./ipsec-wizard-state";
export * from "./ipsec-wizard-rules-ra";
export * from "./ipsec-wizard-rules-custom";
export * from "./ipsec-wizard-rules-hubspoke";

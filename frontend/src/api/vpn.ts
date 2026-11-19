/**
 * VPN — IPsec tunnels, BGP health, hub-and-spoke readback, delete preview
 *
 * Carved out of api/policyObject.ts, which reached 2,391 lines carrying every device-proxy call in
 * the console. policyObject.ts re-exports this module, so the ~138 files that import from it keep
 * working unchanged; new code should import from here directly.
 */
import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// ─── VPN > IPsec Tunnels ─────────────────────────────────────────────────────
export type IPsecPhase2 = { name: string; phase1name: string; src_subnet: string; dst_subnet: string };

export type IPsecTunnel = {
  name: string;
  interface: string;         // binding (physical/outgoing interface)
  remote_gw: string;
  ike_version: string;       // 1 | 2
  type: string;              // static | dynamic | ddns
  comments: string;
  up: boolean;               // runtime status
  phase2: IPsecPhase2[];
  ref_count: number;
  kind: string;              // wizard template inferred from phase1: hub-and-spoke | remote-access | custom
};

// One Site-to-Site tunnel as the VPN Creation Wizard describes it. Field-for-field mirror of the
// backend's tunnelInput / services.FGIPsecTunnelWrite, where the GUI→CMDB mapping is documented.
export type IPsecRemoteType = "static" | "dynamic" | "ddns";
export type IPsecNATTraversal = "enable" | "disable" | "forced";
export type IPsecAuthMethod = "psk" | "signature";
export type IPsecInternetAccess = "none" | "share-local" | "use-remote";

export type IPsecTunnelPayload = {
  name: string;
  interface: string;         // outgoing/binding interface
  ike_version: string;       // "1" | "2"  (the GUI's Site-to-Site template hides this)
  remote_gw: string;
  psk: string;
  proposal?: string;
  dhgroup?: string;
  local_subnets: string[];
  remote_subnets: string[];
  comments?: string;

  // Step 1 — VPN Setup
  remote_type?: IPsecRemoteType;   // "dynamic" = the remote is behind NAT (a dialup tunnel)
  remote_ddns?: string;            // FQDN when remote_type is "ddns"
  nattraversal?: IPsecNATTraversal; // "forced" = this site is behind NAT

  // Step 2 — Authentication
  auth_method?: IPsecAuthMethod;
  certificate?: string;            // Certificate Name (signature)
  peer_ca?: string;                // Peer Certificate CA (signature)

  // Step 3 — Policy & Routing
  local_interface?: string;
  internet_access?: IPsecInternetAccess;
  shared_wan?: string;             // when internet_access is "share-local"
  local_gateway?: string;          // when internet_access is "use-remote"

  create_static_route?: boolean;
  create_firewall_policy?: boolean;

  // ── Remote Access (dialup FortiClient) ──
  // When remote_access is true the tunnel is a dialup mode-config listener; the fields above for
  // interface (= Incoming Interface), local_interface and auth are reused, plus these.
  remote_access?: boolean;
  // Remote device type — decides the whole tunnel shape: forticlient/cisco are IKE mode-config
  // dialup; ios/android/windows are L2TP over IPsec (no mode-config at all).
  ra_client?: "forticlient" | "cisco" | "ios" | "android" | "windows";
  user_group?: string;             // authusrgrp — the User Group clients authenticate against
  client_range_start?: string;     // ipv4-start-ip
  client_range_end?: string;       // ipv4-end-ip
  client_netmask?: string;         // ipv4-netmask
  dns_mode?: "auto" | "manual";    // Use System DNS | Specify
  dns_server?: string;             // ipv4-dns-server1 when dns_mode is "manual"
  split_tunnel?: boolean;          // Enable IPv4 Split Tunnel
  local_addresses?: string[];      // existing address names → the split tunnel group's members

  // FortiClient only (its Client Options step)
  save_password?: boolean;
  auto_connect?: boolean;
  always_up?: boolean;
  endpoint_registration?: boolean; // Allow Endpoint Registration (GUI-only on FortiOS 7.2)

  // Cisco only — "Require 'Group Name' on VPN client" ⇒ mode=aggressive + peertype=one + peerid
  require_group_name?: boolean;
  group_name?: string;

  // ── Custom template (the GUI's manual "New VPN Tunnel" form) ──
  // When custom is set the request builds ONLY phase1 + phase2 (no addresses/policies/routes). The
  // shared fields above are reused: name, interface, ike_version, remote_type, remote_gw,
  // remote_ddns, nattraversal, auth_method, psk, certificate, peer_ca, proposal, dhgroup, comments.
  custom?: IPsecCustomPayload;

  // ── Hub-and-Spoke template (ADVPN + BGP) ──
  // When hub_spoke is set the request builds an overlay tunnel (dialup hub or static spoke) with a
  // tunnel-interface IP and a BGP process. The shared name, interface, auth_method, psk, certificate,
  // peer_ca, proposal and comments fields are reused.
  hub_spoke?: IPsecHubSpokePayload;
};

// IPsecHubSpokePayload is the Hub-and-Spoke template's request. Each field maps to a
// services.FGHubSpokeWrite field (see the backend's fortigate_hubspoke.go for the CMDB mapping).
export type IPsecHubSpokePayload = {
  role: "hub" | "spoke";

  // Tunnel Interface (the overlay)
  tunnel_ip: string;   // this device's tunnel-interface IP (10.10.1.1)
  remote_ip: string;   // the peer end + mask (10.10.1.2/24)

  // Policy & Routing (BGP)
  local_as: string;         // 65400
  local_interface: string;  // LAN side of the hub↔spoke policy
  local_subnets: string[];  // BGP networks + local address group

  // Hub only
  spoke_type?: "individual" | "range";
  spoke_tunnel_ips?: string[];   // individual — one BGP neighbor each
  spoke_range_prefix?: string;   // range — the overlay subnet

  // Spoke only
  remote_gw?: string;   // the hub's public IP
};

// IPsecCustomPayload is the manual phase1/phase2 the Custom template exposes. Each field maps to a
// real vpn.ipsec/phase1-interface or phase2-interface CMDB key (see services.FGIPsecCustom).
export type IPsecCustomPayload = {
  // Network
  ip_version?: "4" | "6";
  local_gateway?: string;       // local-gw ("" = Primary IP / device default)
  mode_config?: boolean;        // mode-cfg
  keepalive?: string;           // keepalive frequency (seconds)
  dpd?: "disable" | "on-idle" | "on-demand";
  dpd_retry_count?: string;
  dpd_retry_interval?: string;
  fec_egress?: boolean;
  fec_ingress?: boolean;

  // Network → Advanced
  add_route?: boolean;
  auto_discovery_sender?: boolean;
  auto_discovery_receiver?: boolean;
  exchange_interface_ip?: boolean;
  net_device?: boolean;         // "Device creation"
  aggregate_member?: boolean;

  // Authentication
  ike_mode?: "aggressive" | "main";  // IKEv1 only
  peer_type?: "any" | "one";         // Accept Types (signature)
  peer_id?: string;                  // when peer_type is "one"
  local_id?: string;
  keylife?: string;                  // phase1 key lifetime (seconds)

  // Phase 2
  p2_local_subnet?: string;
  p2_remote_subnet?: string;
  p2_proposal?: string;
  p2_replay?: boolean;
  p2_pfs?: boolean;
  p2_dhgroup?: string;
  p2_local_port?: string;
  p2_remote_port?: string;
  p2_protocol?: string;
  p2_auto_negotiate?: boolean;
  p2_keepalive?: boolean;            // Autokey Keep Alive
  p2_keylife_seconds?: string;
};

// The device's own routing answer for an address — what fills "Outgoing Interface".
export type RouteLookup = {
  success: boolean;
  network: string;   // the matched route, e.g. "0.0.0.0/0"
  gateway: string;   // "0.0.0.0" when directly connected
  interface: string;
};

// DeviceRouterLookup asks the DEVICE which interface it would use to reach `destination`.
//
// This must never be replaced by a local "which interface's subnet contains this IP?" guess.
// Measured on the lab device: dmz is 10.10.10.1/24, so a local guess sends 10.10.10.254 out dmz —
// but dmz's link is down, its connected route isn't in the routing table, and the device (and the
// real FortiGate GUI) both answer port1. A guess would bind the tunnel to a dead interface.
export const DeviceRouterLookup = async (
  deviceId: number,
  destination: string
): Promise<RouteLookup | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/router-lookup`, { params: { destination } });
    return res.data ?? null;
  } catch { return null; }
};

// Everything the VPN Creation Wizard needs beyond the interface list.
export type VPNWizardMetadata = {
  certificates: string[];     // "Certificate Name" (signature auth)
  ca_certificates: string[];  // "Peer Certificate CA"
  default_gateway: string;    // prefills "Local Gateway" (Internet Access = Use Remote)
  user_groups: string[];      // "User Group" (Remote Access — authusrgrp)
  // The vpn/l2tp SINGLETON's live state — the Native templates warn when they'd overwrite it.
  l2tp_enabled: boolean;
  l2tp_range: string;
  l2tp_user_group: string;
};

export const DeviceGetVPNMetadata = async (deviceId: number): Promise<VPNWizardMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/vpn-metadata`);
    return {
      certificates: res.data?.certificates ?? [],
      ca_certificates: res.data?.ca_certificates ?? [],
      default_gateway: res.data?.default_gateway ?? "",
      user_groups: res.data?.user_groups ?? [],
      l2tp_enabled: res.data?.l2tp_enabled ?? false,
      l2tp_range: res.data?.l2tp_range ?? "",
      l2tp_user_group: res.data?.l2tp_user_group ?? "",
    };
  } catch {
    return { certificates: [], ca_certificates: [], default_gateway: "", user_groups: [], l2tp_enabled: false, l2tp_range: "", l2tp_user_group: "" };
  }
};

export const DeviceListIPsecTunnels = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<IPsecTunnel[]> =>
  deviceList<IPsecTunnel>(`${deviceBase(deviceId)}/ipsec-tunnels`, "Could not load IPsec tunnels", opts);

export const DeviceCreateIPsecTunnel = async (deviceId: number, payload: IPsecTunnelPayload): Promise<{ warnings?: string[] }> => {
  const res = await baseApi.post(`${deviceBase(deviceId)}/ipsec-tunnels`, payload);
  return res.data ?? {};
};

// A tunnel read back into the Custom form's shape, for editing. The PSK is never returned (it is
// write-only on the device) — has_psk just says one is set, and a blank PSK on save keeps it.
export type IPsecTunnelEdit = {
  name: string;
  interface: string;
  ike_version: string;
  remote_type: IPsecRemoteType;
  remote_gw: string;
  remote_ddns: string;
  nattraversal: IPsecNATTraversal;
  auth_method: IPsecAuthMethod;
  has_psk: boolean;
  certificate: string;
  comments: string;
  proposal: string;
  dhgroup: string;
  custom: Required<IPsecCustomPayload>;
};

// DeviceGetIPsecTunnelFull loads a tunnel into the Custom form's shape (any tunnel — S2S, RA or
// Custom — since editing on FortiGate always opens the full phase1/phase2 form).
export const DeviceGetIPsecTunnelFull = async (deviceId: number, name: string): Promise<IPsecTunnelEdit | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/ipsec-tunnels/${encodeURIComponent(name)}/full`);
    return res.data ?? null;
  } catch { return null; }
};

// DeviceUpdateIPsecTunnel edits a tunnel's phase1/phase2 (PATCH). A partial update: fields the
// Custom form doesn't cover are preserved on the device, and a blank psk keeps the stored secret.
export const DeviceUpdateIPsecTunnel = async (deviceId: number, name: string, payload: IPsecTunnelPayload): Promise<{ warnings?: string[] }> => {
  const res = await baseApi.patch(`${deviceBase(deviceId)}/ipsec-tunnels/${encodeURIComponent(name)}`, payload);
  return res.data ?? {};
};

// Deletes the tunnel AND the object set created with it (policies, routes, addresses). The tunnel
// itself is gone whenever this resolves; `warnings` names any follow-up object that could not be
// removed — most often because something else still references it. Surfacing them matters: a
// leftover is what breaks the next create with -5 (duplicate name) or -34 (duplicate gateway).
export const DeviceDeleteIPsecTunnel = async (
  deviceId: number,
  name: string
): Promise<{ warnings?: string[] }> => {
  const res = await baseApi.delete(`${deviceBase(deviceId)}/ipsec-tunnels/${encodeURIComponent(name)}`);
  return res.data ?? {};
};

// ── BGP health (item 2) — the device's BGP process + live neighbor states for the Hub-and-Spoke
//    health panel on the IPsec Tunnels page.
export type BGPNeighbor = { ip: string; remote_as: string; state: string; up: boolean };
export type BGPSummary = {
  configured: boolean;
  local_as: string;
  router_id: string;
  neighbors: BGPNeighbor[] | null;
};

export const DeviceGetBGPSummary = async (deviceId: number): Promise<BGPSummary> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/bgp-summary`);
    return res.data;
  } catch { return { configured: false, local_as: "", router_id: "", neighbors: null }; }
};

// ── Hub-and-Spoke readback (item 1) — a tunnel reconstructed from the device for the wizard's Edit
//    mode. The PSK is never returned; a blank on save keeps the stored secret.
export type IPsecHubSpokeReadback = {
  name: string;
  role: "hub" | "spoke";
  interface: string;
  auth_method: IPsecAuthMethod;
  certificate: string;
  peer_ca: string;
  proposal: string;
  tunnel_ip: string;
  remote_ip: string;
  local_as: string;
  local_subnets: string[];
  spoke_type: "individual" | "range" | "";
  spoke_tunnel_ips: string[] | null;
  spoke_range_prefix: string;
  remote_gw: string;
};

export const DeviceGetHubSpokeTunnel = async (
  deviceId: number, name: string
): Promise<IPsecHubSpokeReadback | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/ipsec-tunnels/${encodeURIComponent(name)}/hub-spoke`);
    return res.data;
  } catch { return null; }
};

// ── Delete-impact preview (item 5) — the exact object set a delete would remove, listed in the
//    confirm dialog instead of a generic sentence.
export type TunnelDeletionPreview = {
  tunnel: string;
  kind: string;
  phase2: string[] | null;
  policies: string[] | null;
  routes: string[] | null;
  addresses: string[] | null;
  bgp: string[] | null;
  l2tp_server: boolean;
};

export const DeviceGetTunnelDeletionPreview = async (
  deviceId: number, name: string
): Promise<TunnelDeletionPreview | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/ipsec-tunnels/${encodeURIComponent(name)}/deletion-preview`);
    return res.data;
  } catch { return null; }
};

// Fabric/SDN connectors — datasource for a Dynamic (Fabric Connector) address
export type SDNConnector = { name: string; type: string; status: string };

export const DeviceListSDNConnectors = async (deviceId: number): Promise<SDNConnector[]> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/sdn-connectors`);
    return Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
};

// Device identity lives in api/deviceInfo.ts — re-exported so no call site had to move.
export type { DeviceInfo } from "./deviceInfo";
export { DeviceGetInfo } from "./deviceInfo";

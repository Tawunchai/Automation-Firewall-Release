import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// ─── Device read helpers ─────────────────────────────────────────────────────
//
// Moved to ./deviceRequest so the modules carved off this file can use them without importing back
// from here — that would be a cycle. Re-exported because ~138 files already import the type and the
// error class from this path.
export { DeviceRequestError, deviceBase, deviceList } from "./deviceRequest";
export type { DeviceReadOpts } from "./deviceRequest";

// ─── Address Object ───────────────────────────────────────────────────────────

export type AddressType = "ipmask" | "iprange" | "fqdn" | "wildcard-fqdn" | "interface-subnet" | "geography" | "mac" | "dynamic";

export type AddressObject = {
  id: number;
  name: string;
  type: AddressType;
  subnet: string;      // CIDR for ipmask; FQDN string for fqdn types
  start_ip: string;
  end_ip: string;
  interface: string;
  comment: string;
  color: number;       // FortiGate color index 0-32 (0 = no color)
  country: string;     // ISO 3166-1 alpha-2 code (geography type)
  mac_addrs: string[]; // MAC address list (mac type)
  allow_routing: boolean; // "Static route configuration" toggle (ipmask & fqdn)
  sub_type: string;    // dynamic address sub-type (sdn | ems-tag | ...)
  sdn: string;         // SDN connector name (dynamic / Fabric Connector Address)
  sdn_addr_type: string; // private | public | all
  builtin: boolean;
  ref_count: number;
  created_at: string;
  updated_at: string;
};

export type AddressPayload = {
  name: string;
  type: AddressType;
  subnet?: string;
  start_ip?: string;
  end_ip?: string;
  interface?: string;
  comment?: string;
  color?: number;       // FortiGate color index 0-32
  country?: string;     // ISO 3166-1 alpha-2 (geography type)
  mac_addrs?: string[]; // MAC address list (mac type)
  allow_routing?: boolean; // "Static route configuration" toggle (ipmask & fqdn)
  sub_type?: string;    // dynamic address sub-type (sdn | ems-tag | ...)
  sdn?: string;         // SDN connector name (dynamic / Fabric Connector Address)
  sdn_addr_type?: string; // private | public | all
};

// ─── Virtual IP (firewall/vip — DNAT / port forward) ─────────────────────────
// Field-for-field mirror of the backend's FGVirtualIP (services/fortigate.go), which mirrors the
// FortiOS "New Virtual IP" page. Every mapping was verified against a live FortiGate 7.2.10.
export type VIPType = "static-nat" | "fqdn";
export type VIPProtocol = "tcp" | "udp" | "sctp" | "icmp";
export type VIPPortMapping = "1-to-1" | "m-to-n";

export type VirtualIP = {
  name: string;
  comment: string;
  type: VIPType;
  interface: string;   // "any" or an interface name

  // Static NAT
  ext_ip: string;      // external IP or range "a-b"
  mapped_ip: string;   // mapped IP or range "a-b"

  // FQDN — external/mapped are FQDN ADDRESS names (not IPs); ext_ip is unused here
  ext_addr: string;
  mapped_addr: string;

  // Optional Filters
  source_filter: string[];
  services: string[];

  // Port Forwarding
  port_forward: boolean;
  protocol: VIPProtocol;
  port_mapping_type: VIPPortMapping;
  ext_port: string;
  mapped_port: string;

  ref_count?: number;
};

export const DeviceListVirtualIPs = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<VirtualIP[]> =>
  deviceList<VirtualIP>(`${deviceBase(deviceId)}/virtual-ips`, "Could not load virtual IPs", opts);

export const DeviceGetVirtualIP = async (deviceId: number, name: string): Promise<VirtualIP | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/virtual-ips/${encodeURIComponent(name)}`);
    if (!res.data) return null;
    // The four list fields must be arrays for the form to bind them.
    return {
      ...res.data,
      source_filter: res.data.source_filter ?? [],
      services: res.data.services ?? [],
    };
  } catch { return null; }
};

export const DeviceCreateVirtualIP = async (deviceId: number, payload: VirtualIP): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/virtual-ips`, payload);
};

export const DeviceUpdateVirtualIP = async (deviceId: number, name: string, payload: VirtualIP): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/virtual-ips/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteVirtualIP = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/virtual-ips/${encodeURIComponent(name)}`);
};

// ─── Service Object ───────────────────────────────────────────────────────────

export type ServiceProtocol = "TCP/UDP/SCTP" | "IP" | "ICMP" | "ICMPv6";

export const SERVICE_CATEGORIES = [
  "General", "Network Services", "Remote Access", "VoIP/Messaging",
  "File Access", "Tunneling", "Authentication", "Email",
  "Web Access", "Database", "Uncategorized",
] as const;
export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

export type ServiceObject = {
  id: number;
  name: string;
  protocol: ServiceProtocol;
  tcp_ports: string;
  udp_ports: string;
  sctp_ports: string;
  ip_proto: number;
  icmp_type: number;   // -1 = any
  icmp_code: number;   // -1 = any
  category: ServiceCategory;
  comment: string;
  color: number;       // FortiGate color index 0-32 (0 = no color)
  ip_fqdn: string;    // IP range or FQDN associated with the service
  builtin: boolean;
  details: string;     // computed by backend
  ref_count: number;
  created_at: string;
  updated_at: string;
};

export type ServicePayload = {
  name: string;
  protocol: ServiceProtocol;
  tcp_ports?: string;
  udp_ports?: string;
  sctp_ports?: string;
  ip_proto?: number;
  icmp_type?: number;
  icmp_code?: number;
  category?: ServiceCategory;
  comment?: string;
  color?: number;      // FortiGate color index 0-32
};

// ─── Firewall Policy ──────────────────────────────────────────────────────────

export type PolicyAction = "accept" | "deny";
export type LogTraffic  = "all" | "utm" | "disable";

export type FirewallPolicy = {
  id: number;
  seq_num: number;
  name: string;
  src_intf: string;
  dst_intf: string;
  src_intf_list: string[];
  dst_intf_list: string[];
  src_addr: string;       // JSON string from backend
  dst_addr: string;
  schedule: string;
  service: string;
  action: PolicyAction;
  nat: boolean;
  log_traffic: LogTraffic;
  enabled: boolean;
  comments: string;
  // Parsed arrays returned by backend
  src_addr_list: string[];
  dst_addr_list: string[];
  service_list:  string[];
  created_at: string;
  updated_at: string;

  // NAT / security profiles
  ippool: boolean;
  poolname: string[];
  fixedport: boolean;
  protocol_options: string;
  av_profile: string;
  webfilter_profile: string;
  dnsfilter_profile: string;
  app_control: string;
  ips_sensor: string;
  file_filter_profile: string;
  ssl_ssh_profile: string;
  decrypted_traffic_mirror: string;
};

export type PolicyPayload = {
  name: string;
  src_intf: string;
  dst_intf: string;
  src_intf_list?: string[];
  dst_intf_list?: string[];
  src_addr: string[];
  dst_addr: string[];
  schedule?: string;
  service: string[];
  action: PolicyAction;
  nat?: boolean;
  log_traffic?: LogTraffic;
  enabled?: boolean;
  comments?: string;

  ippool?: boolean;
  poolname?: string[];
  fixedport?: boolean;
  protocol_options?: string;
  av_profile?: string;
  webfilter_profile?: string;
  dnsfilter_profile?: string;
  app_control?: string;
  ips_sensor?: string;
  file_filter_profile?: string;
  ssl_ssh_profile?: string;
  decrypted_traffic_mirror?: string;
};

// ─── Device-proxied API (reads/writes directly on FortiGate) ─────────────────

// Firewall policies — from real device
export const DeviceListPolicies = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<FirewallPolicy[]> =>
  deviceList<FirewallPolicy>(`${deviceBase(deviceId)}/firewall-policies`, "Could not load firewall policies", opts);

export const DeviceCreatePolicy = async (deviceId: number, payload: PolicyPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/firewall-policies`, payload);
};

export const DeviceUpdatePolicy = async (deviceId: number, policyId: number, payload: Partial<PolicyPayload>): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/firewall-policies/${policyId}`, payload);
};

export const DeviceTogglePolicy = async (deviceId: number, policyId: number, enabled: boolean): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/firewall-policies/${policyId}/toggle`, { enabled });
};

export const DeviceDeletePolicy = async (deviceId: number, policyId: number): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/firewall-policies/${policyId}`);
};

// Reposition a policy in the device rule base (FortiGate action=move). position relative to ref_id.
export const DeviceMovePolicy = async (
  deviceId: number, policyId: number, position: "before" | "after", refId: number
): Promise<void> => {
  await baseApi.put(`${deviceBase(deviceId)}/firewall-policies/${policyId}/move`, { position, ref_id: refId });
};

// Addresses — from real device
export const DeviceListAddresses = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<AddressObject[]> =>
  deviceList<AddressObject>(`${deviceBase(deviceId)}/addresses`, "Could not load addresses", opts);

export const DeviceCreateAddress = async (deviceId: number, payload: AddressPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/addresses`, payload);
};

export const DeviceUpdateAddress = async (deviceId: number, name: string, payload: Partial<AddressPayload>): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/addresses/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteAddress = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/addresses/${encodeURIComponent(name)}`);
};

// Services — from real device
export const DeviceListServices = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<ServiceObject[]> =>
  deviceList<ServiceObject>(`${deviceBase(deviceId)}/services`, "Could not load services", opts);

export const DeviceCreateService = async (deviceId: number, payload: ServicePayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/services`, payload);
};

export const DeviceUpdateService = async (deviceId: number, name: string, payload: Partial<ServicePayload>): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/services/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteService = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/services/${encodeURIComponent(name)}`);
};

// Device network interfaces
export type DeviceInterface = { name: string; alias: string; ip: string; type: string };

export const DeviceListInterfaces = async (deviceId: number): Promise<DeviceInterface[]> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/interfaces`);
    return Array.isArray(res.data) ? res.data : [{ name: "any", alias: "", ip: "", type: "any" }];
  } catch {
    return [{ name: "any", alias: "", ip: "", type: "any" }];
  }
};

// ─── System Interfaces (Network > Interfaces — full management) ──────────────
// Field-for-field mirror of the backend FGSystemInterface (see services/fortigate.go),
// itself confirmed against a live FortiGate 7.2.10 system/interface CMDB object.
export type SystemInterface = {
  name: string;
  alias: string;
  type: string;                 // physical | vlan | aggregate | redundant | hard-switch | switch | loopback | tunnel | ...
  vdom: string;
  ip: string;                   // CIDR ("10.10.10.1/24"); "" when unassigned
  status: string;               // administrative status: up | down
  role: string;                 // lan | wan | dmz | undefined
  vlanid: number;
  interface: string;            // parent interface (VLAN)
  mode: string;                 // static | dhcp | pppoe
  allowaccess: string[];        // administrative access services
  description: string;
  vlan_protocol: string;        // 8021q | 8021ad
  device_identification: string;// enable | disable
  members: string[];            // switch / aggregate member ports
  secondary_ip: boolean;
  ref_count: number;            // q_ref — how many other CMDB objects point at this interface
  dhcp_ranges: string[] | null; // configured DHCP scope(s) on this interface ("start-end" strings)
  // addressing-mode extras (edit prefill)
  default_gw: boolean;
  distance: number;
  dns_server_override: boolean;
  ip_managed_by_ipam: boolean;
  pppoe_username: string;
  security_mode: string;        // none | captive-portal | 802.1X
  egress_shaping_profile: string;
  link_up: boolean | null;      // runtime link state (null = unknown)
  speed_mbps: number;
};

// Datasources the interface create/edit form needs beyond the interface list.
export const DeviceListSystemInterfaces = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<SystemInterface[]> =>
  deviceList<SystemInterface>(`${deviceBase(deviceId)}/system-interfaces`, "Could not load interfaces", opts);

// ─── Static Routes (Network > Static Routes) ─────────────────────────────────
export type StaticRoute = {
  seq_num: number;
  dst_type: "subnet" | "internet-service";
  dst: string;                  // CIDR (subnet type)
  gateway: string;
  device: string;               // interface name
  device_alias: string;
  distance: number;
  priority: number;
  weight: number;
  enabled: boolean;
  comment: string;
  blackhole: boolean;
  dstaddr: string;              // named address / group (advanced)
  internet_service: number;     // firewall.internet-service.id
  internet_service_name: string;
};

export type StaticRoutePayload = {
  dst_type: "subnet" | "internet-service";
  dst?: string;                 // CIDR or "ip mask" (subnet)
  dstaddr?: string;
  gateway?: string;
  device?: string;              // "blackhole" sentinel → blackhole route
  blackhole?: boolean;
  internet_service?: number;
  distance?: number;
  priority?: number;
  weight?: number;
  enabled?: boolean;
  comment?: string;
};

// RouteInterface is the curated egress-interface entry for the Static Route form's
// Interface picker (backend GetRouteInterfaces) — a smaller, GUI-exact set, not the
// full Network > Interfaces list.
export type RouteInterface = { name: string; alias: string; ip: string; type: string };

export const DeviceListRouteInterfaces = async (deviceId: number): Promise<RouteInterface[]> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/route-interfaces`);
    return Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
};

export type InternetService = { id: number; name: string };

export const DeviceListStaticRoutes = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<StaticRoute[]> =>
  deviceList<StaticRoute>(`${deviceBase(deviceId)}/static-routes`, "Could not load static routes", opts);

export const DeviceGetStaticRoute = async (deviceId: number, seq: number): Promise<StaticRoute | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/static-routes/${seq}`);
    return res.data ?? null;
  } catch { return null; }
};

export const DeviceCreateStaticRoute = async (deviceId: number, payload: StaticRoutePayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/static-routes`, payload);
};

export const DeviceUpdateStaticRoute = async (deviceId: number, seq: number, payload: StaticRoutePayload): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/static-routes/${seq}`, payload);
};

export const DeviceDeleteStaticRoute = async (deviceId: number, seq: number): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/static-routes/${seq}`);
};

export const DeviceListInternetServices = async (deviceId: number): Promise<InternetService[]> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/internet-services`);
    return Array.isArray(res.data) ? res.data : [];
  } catch { return []; }
};

// ─── Troubleshoot: policy trace ── moved to api/troubleshoot.ts ────────────────

// ─── Audit / Review ── moved to api/audit.ts ─────────────────────────────────
// Re-exported so that every page reading it kept its import path.
export type {
  AuditException,
  AuditFinding,
  AuditReport,
  AuditSeverity,
  AuditTrendPoint,
  CheckRationale,
  ControlCoverage,
  ControlRef,
  ControlStatus,
  ControlStrength,
  Definition,
  FrameworkCoverage,
  Methodology,
  ReferenceDoc,
  TitleSource,
} from "./audit";
export {
  DeviceAcceptFinding,
  DeviceAudit,
  DeviceAuditHistory,
  DeviceListAuditExceptions,
  DeviceRevokeAuditException,
} from "./audit";

export type PolicySchedule = { name: string; type: "onetime" | "recurring" | "group" };
// Whether the device's own GUI shows a given security-profile category at all (System >
// Feature Visibility can hide a category — e.g. IPS — without removing its profile
// objects). Missing/absent keys should be treated as visible (fail open).
export type SecurityProfileVisibility = {
  antivirus: boolean;
  webfilter: boolean;
  dnsfilter: boolean;
  application_control: boolean;
  ips: boolean;
  file_filter: boolean;
};
export type DevicePolicyProfileOptions = {
  schedules: PolicySchedule[];
  av_profiles: string[];
  webfilter_profiles: string[];
  dnsfilter_profiles: string[];
  app_lists: string[];
  ips_sensors: string[];
  file_filter_profiles: string[];
  ssl_ssh_profiles: string[];
  ip_pools: string[];
  protocol_options: string[];
  address_groups: string[];
  service_groups: string[];
  decrypted_traffic_mirrors: string[];
  security_profile_visibility: SecurityProfileVisibility;
};

export const EMPTY_POLICY_PROFILE_OPTIONS: DevicePolicyProfileOptions = {
  schedules: [], av_profiles: [], webfilter_profiles: [], dnsfilter_profiles: [],
  app_lists: [], ips_sensors: [], file_filter_profiles: [], ssl_ssh_profiles: [],
  ip_pools: [], protocol_options: [], address_groups: [], service_groups: [],
  decrypted_traffic_mirrors: [],
  security_profile_visibility: {
    antivirus: true, webfilter: true, dnsfilter: true,
    application_control: true, ips: true, file_filter: true,
  },
};

export const DeviceGetPolicyProfiles = async (deviceId: number): Promise<DevicePolicyProfileOptions> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/policy-profiles`);
    return { ...EMPTY_POLICY_PROFILE_OPTIONS, ...res.data };
  } catch {
    return EMPTY_POLICY_PROFILE_OPTIONS;
  }
};

// ─── Firewall Schedules (recurring / onetime / group) ────────────────────────
// Mirrors the FortiGate GUI's Policy & Objects > Schedules page. A schedule lives in one of
// three FortiOS tables; `type` says which, and only that table's fields are meaningful:
//   recurring : start/end = "hh:mm", day = weekday names
//   onetime   : start/end = "hh:mm yyyy/mm/dd", expiration_days = Pre-expiration event log
//   group     : member    = names of other schedules
export type ScheduleType = "recurring" | "onetime" | "group";

export type Schedule = {
  name: string;
  type: ScheduleType;
  start: string;            // recurring "hh:mm"; onetime "hh:mm yyyy/mm/dd"; group ""
  end: string;
  day: string[];            // recurring only (sunday..saturday)
  expiration_days: number;  // onetime only (0 = Pre-expiration event log off)
  member: string[];         // group only
  color: number;            // 0-32 (0 = default)
  ref: number;              // how many policies use it (GUI "Ref" column)
  builtin: boolean;         // "always"/"none" — read-only in the GUI
};

// ScheduleForm is the create/update body. Omit the fields that don't apply to the chosen type.
export type ScheduleForm = {
  name: string;
  type: ScheduleType;
  start?: string;
  end?: string;
  day?: string[];
  expiration_days?: number;
  member?: string[];
  color?: number;
};

const scheduleBase = (deviceId: number) => `${deviceBase(deviceId)}/schedules`;

export const DeviceListSchedules = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<Schedule[]> => {
  // The device row, as this console reads it.
  //
  // Partial<T> rather than T: these are FortiOS CMDB objects, so which keys come back depends on the
  // firmware and on how the object was created, and the mapper below defaults every one of them for
  // exactly that reason. It was `any`, which said the same thing while also promising that any
  // property name at all would be there — including one misspelt.
  const rows = await deviceList<Partial<Schedule>>(scheduleBase(deviceId), "Could not load schedules", opts);
  return rows.map((s) => ({
    name: s.name ?? "", type: s.type ?? "recurring",
    start: s.start ?? "", end: s.end ?? "",
    day: s.day ?? [], expiration_days: s.expiration_days ?? 0,
    member: s.member ?? [], color: s.color ?? 0,
    ref: s.ref ?? 0, builtin: !!s.builtin,
  }));
};

export const DeviceGetSchedule = async (
  deviceId: number, type: ScheduleType, name: string
): Promise<Schedule> => {
  const res = await baseApi.get(`${scheduleBase(deviceId)}/${type}/${encodeURIComponent(name)}`);
  const s = res.data;
  return {
    name: s.name ?? "", type: s.type ?? type,
    start: s.start ?? "", end: s.end ?? "",
    day: s.day ?? [], expiration_days: s.expiration_days ?? 0,
    member: s.member ?? [], color: s.color ?? 0,
    ref: s.ref ?? 0, builtin: !!s.builtin,
  };
};

export const DeviceCreateSchedule = async (deviceId: number, form: ScheduleForm): Promise<void> => {
  await baseApi.post(scheduleBase(deviceId), form);
};

export const DeviceUpdateSchedule = async (
  deviceId: number, type: ScheduleType, name: string, form: ScheduleForm
): Promise<void> => {
  await baseApi.put(`${scheduleBase(deviceId)}/${type}/${encodeURIComponent(name)}`, form);
};

export const DeviceDeleteSchedule = async (
  deviceId: number, type: ScheduleType, name: string
): Promise<void> => {
  await baseApi.delete(`${scheduleBase(deviceId)}/${type}/${encodeURIComponent(name)}`);
};

// ─── Web Rating Overrides (webfilter/ftgd-local-rating) ──────────────────────
// Mirrors the FortiGate GUI's Security Profiles ▸ Web Rating Overrides page. One row re-rates
// one URL to one category, and the category is stored as an ID — the two dropdowns in the dialog
// (Category = group, Sub-Category = the categories in it) are just a way to pick that ID.

export type WebRatingOverride = {
  url: string;
  /**
   * FortiGuard (or custom) category ID, as a string.
   *
   * Always a string by the time it reaches here, whatever the firmware sent: FortiOS types this
   * field "user" rather than "integer" and 7.2.10 answers with a bare number, which `fgLooseString`
   * in `services/fortigate_webrating.go` decodes into a Go string before this console sees it.
   * Verified on the lab 80E — a round trip through this API reads back `"rating":"4"`.
   */
  rating: string;
  status: boolean;
  comment: string;
  /** Resolved server-side from the device's taxonomy; "" when the ID is not in it. */
  category: string;
  category_group: string;
};

export type WebRatingOverrideForm = {
  url: string;
  rating: string;
  status: boolean;
  comment: string;
};

/** One category of the device's own taxonomy — the shape shared with the Web Filter form. */
export type WebRatingCategory = {
  id: number;
  name: string;
  group: string;
  group_id: number;
};

export type WebRatingMetadata = {
  categories: WebRatingCategory[];
  local_categories: WebRatingCategory[];
  web_filter_licensed: boolean;
};

export const EMPTY_WEB_RATING_METADATA: WebRatingMetadata = {
  categories: [], local_categories: [], web_filter_licensed: false,
};

/**
 * The device's answer to "how is this URL rated right now".
 *
 * `fields` is passed through untouched rather than parsed into named keys: the lab device has no
 * FortiGuard web-filtering contract and answers with nothing but the URL, so there was no licensed
 * response to verify a shape against. `rated` is false in exactly that case.
 */
export type WebRatingLookup = {
  url: string;
  fields: Record<string, unknown>;
  rated: boolean;
};

const webRatingBase = (deviceId: number) => `${deviceBase(deviceId)}/web-rating-overrides`;

/**
 * The fields this console reads off this API's web-rating-override response.
 *
 * Every key is optional because a 2xx with a half-filled body is a real answer here — an older
 * firmware simply omits what it does not keep — but the TYPES are the ones our own handler
 * guarantees, not FortiOS's. `rating` is the one worth naming: FortiOS types it "user" rather than
 * "integer" and 7.2.10 answers with a bare number, and `fgLooseString`
 * (`services/fortigate_webrating.go`) decodes either form into a Go string. So a number never
 * reaches this file, and nothing here has to coerce one.
 */
type WebRatingRow = {
  url?: string;
  rating?: string;
  status?: boolean;
  comment?: string;
  category?: string;
  category_group?: string;
};

const toWebRatingOverride = (r: WebRatingRow | null | undefined): WebRatingOverride => ({
  url: r?.url ?? "",
  rating: r?.rating ?? "",
  status: !!r?.status,
  comment: r?.comment ?? "",
  category: r?.category ?? "",
  category_group: r?.category_group ?? "",
});

export const DeviceListWebRatingOverrides = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<WebRatingOverride[]> => {
  const rows = await deviceList<WebRatingRow>(
    webRatingBase(deviceId), "Could not load web rating overrides", opts);
  return rows.map(toWebRatingOverride);
};

export const DeviceGetWebRatingOverride = async (
  deviceId: number, url: string
): Promise<WebRatingOverride> => {
  const res = await baseApi.get(`${webRatingBase(deviceId)}/${encodeURIComponent(url)}`);
  return toWebRatingOverride(res.data);
};

export const DeviceGetWebRatingMetadata = async (
  deviceId: number
): Promise<WebRatingMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/web-rating-metadata`);
    return {
      categories: res.data?.categories ?? [],
      local_categories: res.data?.local_categories ?? [],
      web_filter_licensed: !!res.data?.web_filter_licensed,
    };
  } catch {
    return EMPTY_WEB_RATING_METADATA;
  }
};

export const DeviceCreateWebRatingOverride = async (
  deviceId: number, form: WebRatingOverrideForm
): Promise<void> => {
  await baseApi.post(webRatingBase(deviceId), form);
};

/** `originalUrl` is the key the form was loaded with — editing the URL renames the entry. */
export const DeviceUpdateWebRatingOverride = async (
  deviceId: number, originalUrl: string, form: WebRatingOverrideForm
): Promise<void> => {
  await baseApi.put(`${webRatingBase(deviceId)}/${encodeURIComponent(originalUrl)}`, form);
};

export const DeviceDeleteWebRatingOverride = async (
  deviceId: number, url: string
): Promise<void> => {
  await baseApi.delete(`${webRatingBase(deviceId)}/${encodeURIComponent(url)}`);
};

export const DeviceLookupWebRating = async (
  deviceId: number, url: string
): Promise<WebRatingLookup> => {
  const res = await baseApi.post(`${deviceBase(deviceId)}/web-rating-lookup`, { url });
  return {
    url: res.data?.url ?? url,
    fields: res.data?.fields ?? {},
    rated: !!res.data?.rated,
  };
};

// ─── Re-exports ──────────────────────────────────────────────────────────────
//
// The four domains split out of this file. Keeping them exported from here is what lets every
// existing `from "…/api/policyObject"` import keep working; new code should reach for the module it
// actually needs.
export * from "./vpn";
export * from "./securityProfiles";
export * from "./userAuth";
export * from "./sdwan";

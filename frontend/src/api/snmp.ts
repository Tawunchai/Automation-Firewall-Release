import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// System ▸ SNMP — the agent, the v1/v2c communities, and the v3 users.
//
// Its own file rather than another block in policyObject.ts: that file is the console's API
// monolith, it is already in backend/test/layout-budget.json at 2,391 lines, and the budget test
// stops it growing. A new domain gets a new file, the way deviceInfo.ts and inspectionProfiles.ts
// already did.
//
// Field names here are snake_case because that is what the Go layer emits — the FortiOS CMDB
// names (`query-v1-status`, `trap-lport`, `contact-info`) never reach the browser. They are
// translated once, in backend/services/fortigate_snmp.go, so the page never has to know which of
// the device's status fields are the strings "enable"/"disable" rather than booleans.

/** The agent itself — `system.snmp/sysinfo`, a single object. */
export type SNMPSysInfo = {
  status: boolean;
  description: string;
  contact_info: string;
  location: string;
  trap_high_cpu_threshold: number;
  trap_low_memory_threshold: number;
  trap_log_full_threshold: number;
};

/** One row of a community's nested `hosts` table. */
export type SNMPHost = {
  /** The device's own key for the row. Kept so an edit updates the row instead of replacing it. */
  id: number;
  /** An address, or `addr/mask` when the operator gave a real subnet rather than a single host. */
  ip: string;
  host_type: "any" | "query" | "trap" | string;
};

export type SNMPCommunity = {
  id: number;
  name: string;
  status: boolean;
  hosts: SNMPHost[];
  query_v1_status: boolean;
  query_v1_port: number;
  query_v2c_status: boolean;
  query_v2c_port: number;
  trap_v1_status: boolean;
  trap_v1_lport: number;
  trap_v1_rport: number;
  trap_v2c_status: boolean;
  trap_v2c_lport: number;
  trap_v2c_rport: number;
  events: string[];
};

export type SNMPSecurityLevel = "no-auth-no-priv" | "auth-no-priv" | "auth-priv";

/**
 * One v3 user.
 *
 * The two passwords are deliberately absent, and `has_auth_pwd` / `has_priv_pwd` are what stands
 * in for them. A read of this table returns the literal `ENC XXXX`, which says only "there is one"
 * — the backend turns that into these booleans so the placeholder can never reach a form field and
 * be posted back as a four-character password.
 */
export type SNMPUser = {
  name: string;
  status: boolean;
  security_level: SNMPSecurityLevel;
  auth_proto: string;
  priv_proto: string;
  has_auth_pwd: boolean;
  has_priv_pwd: boolean;
  notify_hosts: string[];
  queries: boolean;
  query_port: number;
  trap_status: boolean;
  trap_lport: number;
  trap_rport: number;
  events: string[];
};

export type SNMPSysInfoPayload = Partial<Omit<SNMPSysInfo, "status">> & { status: boolean };

/** A community write. `hosts` rows carry id 0 until the device has assigned one. */
export type SNMPCommunityPayload = Omit<SNMPCommunity, "id" | "hosts"> & {
  hosts: Partial<SNMPHost>[];
};

/**
 * A v3 user write.
 *
 * `auth_pwd` / `priv_pwd` are OPTIONAL on purpose, and the distinction matters: leaving the key
 * out means "keep the password the device is holding", which is what an edit form with a blank
 * password box means. Sending an empty string is refused by the backend rather than quietly
 * clearing a working credential.
 */
export type SNMPUserPayload = Omit<SNMPUser, "has_auth_pwd" | "has_priv_pwd"> & {
  auth_pwd?: string;
  priv_pwd?: string;
};

const snmpBase = (deviceId: number) => `${deviceBase(deviceId)}/snmp`;

// ── Agent ─────────────────────────────────────────────────────────────────────

/**
 * Reads the agent settings.
 *
 * Strict by default and with no lenient path at all: "the SNMP agent is off" and "we could not ask"
 * are the same screen if a failure returns a zero value, and the first of those is a claim about
 * the firewall's posture that this must never make up.
 */
export const DeviceGetSNMPSysInfo = async (deviceId: number): Promise<SNMPSysInfo> => {
  const res = await baseApi.get<SNMPSysInfo>(`${snmpBase(deviceId)}/sysinfo`);
  return res.data;
};

export const DeviceUpdateSNMPSysInfo = async (
  deviceId: number, payload: SNMPSysInfoPayload,
): Promise<void> => {
  await baseApi.patch(`${snmpBase(deviceId)}/sysinfo`, payload);
};

// ── Communities ───────────────────────────────────────────────────────────────

export const DeviceListSNMPCommunities = async (
  deviceId: number, opts?: DeviceReadOpts,
): Promise<SNMPCommunity[]> =>
  deviceList<SNMPCommunity>(
    `${snmpBase(deviceId)}/communities`, "Could not load SNMP communities", opts,
  );

export const DeviceCreateSNMPCommunity = async (
  deviceId: number, payload: SNMPCommunityPayload,
): Promise<void> => {
  await baseApi.post(`${snmpBase(deviceId)}/communities`, payload);
};

export const DeviceUpdateSNMPCommunity = async (
  deviceId: number, id: number, payload: SNMPCommunityPayload,
): Promise<void> => {
  await baseApi.patch(`${snmpBase(deviceId)}/communities/${id}`, payload);
};

export const DeviceDeleteSNMPCommunity = async (deviceId: number, id: number): Promise<void> => {
  await baseApi.delete(`${snmpBase(deviceId)}/communities/${id}`);
};

// ── v3 users ──────────────────────────────────────────────────────────────────

export const DeviceListSNMPUsers = async (
  deviceId: number, opts?: DeviceReadOpts,
): Promise<SNMPUser[]> =>
  deviceList<SNMPUser>(`${snmpBase(deviceId)}/users`, "Could not load SNMP users", opts);

export const DeviceCreateSNMPUser = async (
  deviceId: number, payload: SNMPUserPayload,
): Promise<void> => {
  await baseApi.post(`${snmpBase(deviceId)}/users`, payload);
};

export const DeviceUpdateSNMPUser = async (
  deviceId: number, name: string, payload: SNMPUserPayload,
): Promise<void> => {
  await baseApi.patch(`${snmpBase(deviceId)}/users/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteSNMPUser = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${snmpBase(deviceId)}/users/${encodeURIComponent(name)}`);
};

// ── The event catalogue ───────────────────────────────────────────────────────

/**
 * Every trap a community or a user can subscribe to, in the device's own order — which is the
 * order FortiGate's GUI lists them in, so the checkbox column reads the same way on both screens.
 *
 * The CMDB names and the GUI labels disagree too often to derive one from the other
 * (`ips-signature` is "IPS detected an attack", `ha-switch` is "HA cluster status change"), so the
 * pairing is written out. The names are the 42 confirmed on FortiOS 7.2.10 via `?action=schema`
 * and MUST stay in step with `SNMPEventOptions` in backend/services/fortigate_snmp.go — the
 * backend refuses an event it does not know, so a typo here surfaces as a rejected save rather
 * than a silently dropped subscription.
 */
export const SNMP_EVENTS: { name: string; label: string }[] = [
  { name: "cpu-high", label: "CPU usage too high" },
  { name: "mem-low", label: "Available memory is low" },
  { name: "log-full", label: "Available log space is low" },
  { name: "intf-ip", label: "Interface IP address changed" },
  { name: "vpn-tun-up", label: "VPN tunnel is up" },
  { name: "vpn-tun-down", label: "VPN tunnel is down" },
  { name: "ha-switch", label: "HA cluster status change" },
  { name: "ha-hb-failure", label: "HA heartbeat interface failure" },
  { name: "ips-signature", label: "IPS detected an attack" },
  { name: "ips-anomaly", label: "IPS detected an anomaly" },
  { name: "av-virus", label: "AV detected virus" },
  { name: "av-oversize", label: "AV detected oversized file" },
  { name: "av-pattern", label: "AV detected file matching pattern" },
  { name: "av-fragmented", label: "AV detected fragmented file" },
  { name: "fm-if-change", label: "Interface IP change (FM trap)" },
  { name: "fm-conf-change", label: "Configuration change (FM trap)" },
  { name: "bgp-established", label: "BGP FSM enters the established state" },
  { name: "bgp-backward-transition", label: "BGP FSM from a high numbered state to a lower numbered state" },
  { name: "ha-member-up", label: "HA cluster member up" },
  { name: "ha-member-down", label: "HA cluster member down" },
  { name: "ent-conf-change", label: "Entity config change (RFC4133)" },
  { name: "av-conserve", label: "AV system enters conserve mode" },
  { name: "av-bypass", label: "AV bypass happens" },
  { name: "av-oversize-passed", label: "AV oversized files passed" },
  { name: "av-oversize-blocked", label: "AV oversized files blocked" },
  { name: "ips-pkg-update", label: "IPS package updated" },
  { name: "ips-fail-open", label: "IPS network buffer is full" },
  { name: "temperature-high", label: "Temperature is too high" },
  { name: "voltage-alert", label: "Voltage is out of range" },
  { name: "power-supply-failure", label: "Power supply failure" },
  { name: "faz-disconnect", label: "Disconnected from FortiAnalyzer" },
  { name: "wc-ap-up", label: "AP is up" },
  { name: "wc-ap-down", label: "AP is down" },
  { name: "fswctl-session-up", label: "FortiSwitch controller session is up" },
  { name: "fswctl-session-down", label: "FortiSwitch controller session is down" },
  { name: "load-balance-real-server-down", label: "Load balance real-server is down" },
  { name: "device-new", label: "A new device is found" },
  { name: "per-cpu-high", label: "Per CPU usage is high" },
  { name: "dhcp", label: "DHCP addresses at limit" },
  { name: "pool-usage", label: "IP pool usage is high" },
  { name: "ospf-nbr-state-change", label: "OSPF neighbour state change" },
  { name: "ospf-virtnbr-state-change", label: "OSPF virtual neighbour state change" },
];

/** The two protocol menus, as the device offers them. Defaults are FortiOS's own. */
export const SNMP_AUTH_PROTOS = ["md5", "sha", "sha224", "sha256", "sha384", "sha512"] as const;
export const SNMP_PRIV_PROTOS = ["aes", "des", "aes256", "aes256cisco"] as const;

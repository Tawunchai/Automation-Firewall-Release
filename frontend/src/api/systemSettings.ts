import { baseApi } from "./http";
import { deviceBase } from "./deviceRequest";

// The three system-level surfaces of Phase 15: log settings, HA status and the firewall's own
// administrator accounts.
//
// One module because they are one area of the device — the box itself rather than the traffic
// through it — and because each is small. The Go side is split one file per domain; here the
// types are what differ and the transport is identical.

// ── Log settings ─────────────────────────────────────────────────────────────

export type LogEvents = {
  /** `fwpolicy-implicit-log`. Off by default, and the reason a log looks empty. */
  implicit_deny_log: boolean;
  local_in_allow: boolean;
  local_in_deny_unicast: boolean;
  local_in_deny_broadcast: boolean;
  local_out: boolean;
  log_invalid_packet: boolean;
  resolve_ip: boolean;
  resolve_port: boolean;
  brief_traffic_format: boolean;
  user_anonymize: boolean;
  log_policy_comment: boolean;
};

export type LogDisk = {
  enabled: boolean;
  max_log_file_size_mb: number;
  roll_schedule: string;
  roll_day: string;
  roll_time: string;
  disk_full: string;
  maximum_log_age_days: number;
  upload: boolean;
};

export type LogSyslog = {
  enabled: boolean;
  server: string;
  port: number;
  mode: string;
  facility: string;
  format: string;
  source_ip: string;
  enc_algorithm: string;
  certificate: string;
  priority: string;
  max_log_rate: number;
  /** False when the destination is switched on and has nowhere to send to. */
  configured: boolean;
};

export type LogFortiAnalyzer = {
  enabled: boolean;
  server: string;
  alt_server: string;
  upload_option: string;
  reliable: boolean;
  certificate_verification: boolean;
  source_ip: string;
  enc_algorithm: string;
  ssl_min_proto_version: string;
  max_log_rate: number;
  configured: boolean;
};

export type LogSettings = {
  events: LogEvents;
  memory: { enabled: boolean };
  disk: LogDisk;
  syslog: LogSyslog;
  fortianalyzer: LogFortiAnalyzer;
  /** Whether this model HAS a log disk. The lab FGT80E does not. */
  disk_available: boolean;
  disk_status: string;
};

/**
 * Only the sections being changed are sent.
 *
 * Each becomes its own PUT on the device, and an omitted section is not written at all — which is
 * what keeps a logging-option change from rewriting the syslog configuration, and keeps a failed
 * disk write (on a unit with no disk) from taking the others with it.
 */
export type LogSettingsPatch = {
  events?: LogEvents;
  memory_enabled?: boolean;
  disk?: Omit<LogDisk, never>;
  syslog?: Omit<LogSyslog, "configured">;
  fortianalyzer?: Omit<LogFortiAnalyzer, "configured">;
};

export const DeviceGetLogSettings = async (deviceId: number): Promise<LogSettings> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/log-settings`);
  return res.data as LogSettings;
};

export const DeviceUpdateLogSettings = async (
  deviceId: number,
  patch: LogSettingsPatch,
): Promise<{ applied: string[] }> => {
  const res = await baseApi.patch(`${deviceBase(deviceId)}/log-settings`, patch);
  return res.data as { applied: string[] };
};

// ── HA ───────────────────────────────────────────────────────────────────────

export type HAMember = {
  serial_number: string;
  hostname: string;
  priority: number;
  role: string;
  is_this_unit: boolean;
  cpu_usage: number;
  mem_usage: number;
  sessions: number;
  uptime_sec: number;
};

export type HAStatus = {
  /** standalone | a-p | a-a */
  mode: string;
  clustered: boolean;
  group_name: string;
  group_id: number;
  priority: number;
  override: boolean;
  heartbeat_devs: string[];
  monitored_intfs: string[];
  sync_config: boolean;
  session_pickup: boolean;
  encryption: boolean;
  authentication: boolean;
  hb_interval: number;
  hb_lost_threshold: number;
  ha_mgmt_status: boolean;
  uninterruptible_upgrade: boolean;
  members: HAMember[];
  /** False means the peer list could not be asked for — not that there are no peers. */
  peers_readable: boolean;
};

/** Read-only. There is no write endpoint — see services/fortigate_ha.go for why. */
export const DeviceGetHAStatus = async (deviceId: number): Promise<HAStatus> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/ha-status`);
  return res.data as HAStatus;
};

// ── Administrators ───────────────────────────────────────────────────────────

export type AdminUser = {
  name: string;
  accprofile: string;
  comments: string;
  /**
   * The slots that are NOT "any host". Empty means the account can log in from anywhere.
   * FortiOS/Go sends this as `null`, not `[]`, when there are none — never index it directly.
   */
  trust_hosts: string[] | null;
  restricted_to_hosts: boolean;
  /** A METHOD name — `disable`, `fortitoken`, `email`, `sms` — not a boolean. */
  two_factor: string;
  remote_auth: boolean;
  remote_group: string;
  vdoms: string[];
  ssh_public_key_set: boolean;
  is_super_admin: boolean;
};

export type AccProfile = {
  name: string;
  scope: string;
  comments: string;
  permissions: Record<string, string>;
  /** What the profile can change. FortiOS/Go sends `null`, not `[]`, when it's empty. */
  write_groups: string[] | null;
  is_super_admin: boolean;
};

export type AdminLists = {
  admins: AdminUser[];
  profiles: AccProfile[];
  profiles_readable: boolean;
};

export type AdminPayload = {
  name: string;
  /**
   * Absent means "leave the password alone", which is what an edit that did not touch it sends.
   * An empty string would replace the password with nothing.
   */
  password?: string;
  accprofile: string;
  comments: string;
  trust_hosts: string[];
  two_factor: string;
  remote_auth: boolean;
  remote_group: string;
  /** Set when narrowing an account's trusted hosts, after the operator has confirmed. */
  confirm_lockout?: boolean;
};

export const DeviceListAdminUsers = async (deviceId: number): Promise<AdminLists> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/admin-users`);
  return res.data as AdminLists;
};

export const DeviceCreateAdminUser = async (
  deviceId: number,
  payload: AdminPayload,
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/admin-users`, payload);
};

export const DeviceUpdateAdminUser = async (
  deviceId: number,
  name: string,
  payload: AdminPayload,
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/admin-users/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteAdminUser = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/admin-users/${encodeURIComponent(name)}`);
};

import { baseApi } from "./http";
import { DeviceRequestError } from "./policyObject";

// System > Dashboard > Status — live telemetry read straight off the FortiGate.
//
// Backed by two endpoints (see backend/controller/policyobject/device_dashboard.go):
//   GET /policy/device/:id/dashboard              full snapshot, ~1s
//   GET /policy/device/:id/dashboard/usage        chart series only, ~0.15s — the polling one
//
// Both are strict: the dashboard's entire job is to report what the firewall is doing, so a
// failed read must surface as an error state, never as a page full of zeroes.

// ── Chart series ──────────────────────────────────────────────────────────────

/** One sample. `t` is epoch **milliseconds** (as FortiOS reports it), `v` the value. */
export type UsagePoint = { t: number; v: number };

export type UsageSeries = {
  current: number;
  min: number;
  max: number;
  average: number;
  points: UsagePoint[];
};

/** Sampling windows FortiOS keeps history for. */
export const USAGE_INTERVALS = ["1-min", "10-min", "30-min", "1-hour", "12-hour", "24-hour"] as const;
export type UsageInterval = (typeof USAGE_INTERVALS)[number];

export type ResourceUsage = {
  interval: UsageInterval;
  /** Aggregate CPU. `cpu_cores` holds the individual cores the device also reports. */
  cpu: UsageSeries;
  cpu_cores: UsageSeries[];
  memory: UsageSeries;
  disk: UsageSeries;
  sessions: UsageSeries;
  setup_rate: UsageSeries;
  npu_sessions: UsageSeries;
  nturbo_sessions: UsageSeries;
};

// ── Widgets ───────────────────────────────────────────────────────────────────

export type SystemInformation = {
  hostname: string;
  serial: string;
  model: string;
  model_code: string;
  version: string;
  build: number;
  maturity: string;
  release_type: string;
  firmware_latest: string;
  operation_mode: string;
  /** Device clock as a **UTC** epoch (seconds); add `timezone_offset` for device-local time. */
  system_time: number;
  timezone_offset: number;
  timezone_name: string;
  /** 0 when the device could not be reached over SSH — FortiOS 7.2 has no REST uptime. */
  uptime_seconds: number;
  wan_ip: string;
  log_disk_status: string;
  vdom_used: number;
  vdom_max: number;
};

export type Performance = {
  cpu_user: number;
  cpu_system: number;
  cpu_nice: number;
  cpu_idle: number;
  cpu_iowait: number;
  cpu_cores: number;
  mem_total: number;
  mem_used: number;
  mem_free: number;
  mem_freeable: number;
};

export type SessionSummary = {
  session_count: number;
  npu_session_count: number;
  nturbo_session_count: number;
  setup_rate: number;
};

export type LicenseStatus =
  | "registered"
  | "licensed"
  | "expired"
  | "no_license"
  | "free_license"
  | "unknown"
  | string;

export type LicenseRow = {
  key: string;
  label: string;
  status: LicenseStatus;
  expires?: number;
  version?: string;
  entitlement?: string;
  last_update?: number;
};

export type LicenseOverview = {
  /** The rows the FortiGate's own Licenses widget lists. */
  primary: LicenseRow[];
  /** Every other entitlement the device reported. */
  secondary: LicenseRow[];
  forticare: { status: LicenseStatus; account: string; company: string };
  fortiguard: {
    connected: boolean;
    connection_issue: boolean;
    server_address: string;
    last_connection: number;
    next_update: number;
    wan_ip: string;
  };
  forticloud: {
    status: string;
    activated: boolean;
    account: string;
    domain: string;
    logging_status: LicenseStatus;
    log_retention_days: number;
    used_bytes: number;
    max_bytes: number;
  };
  fortitoken: { used: number; total: number };
  vdom_used: number;
  vdom_max: number;
};

export type FabricMember = {
  serial: string;
  hostname: string;
  model: string;
  version: string;
  mgmt_ip: string;
  is_current: boolean;
  ha_mode: string;
};

export type FabricStatus = {
  enabled: boolean;
  protocol_enabled: boolean;
  group_name: string;
  upstream: string;
  is_root: boolean;
  members: FabricMember[];
};

export type AdminSession = {
  id: number;
  admin: string;
  profile: string;
  interface: string;
  method: string;
  srcaddr: string;
  login_time: number;
  is_current: boolean;
};

export type DashboardSnapshot = {
  device: {
    id: number;
    name: string;
    mgmt_ip: string;
    platform: string;
    vendor: string;
    site: string;
    status: string;
  };
  system: SystemInformation;
  performance: Performance | null;
  usage: ResourceUsage | null;
  sessions: SessionSummary | null;
  licenses: LicenseOverview | null;
  fabric: FabricStatus | null;
  admins: AdminSession[] | null;
  /** Sections the device refused or does not support, keyed by section name. */
  errors?: Record<string, string>;
  /** Server epoch (seconds) at which the snapshot was taken. */
  fetched_at: number;
};

export type UsageSnapshot = {
  usage: ResourceUsage;
  performance: Performance | null;
  sessions: SessionSummary | null;
  fetched_at: number;
};

const base = (deviceId: number) => `/policy/device/${deviceId}/dashboard`;

/** Full dashboard snapshot. Throws DeviceRequestError when the firewall cannot be read. */
export const GetDeviceDashboard = async (
  deviceId: number,
  interval: UsageInterval = "1-min",
  signal?: AbortSignal,
): Promise<DashboardSnapshot> => {
  try {
    const res = await baseApi.get(base(deviceId), { params: { interval }, signal });
    return res.data as DashboardSnapshot;
  } catch (err) {
    throw new DeviceRequestError("Failed to read the device dashboard", err);
  }
};

/** Chart series only — cheap enough to poll every few seconds. */
export const GetDeviceUsage = async (
  deviceId: number,
  interval: UsageInterval = "1-min",
  signal?: AbortSignal,
): Promise<UsageSnapshot> => {
  try {
    const res = await baseApi.get(`${base(deviceId)}/usage`, { params: { interval }, signal });
    return res.data as UsageSnapshot;
  } catch (err) {
    throw new DeviceRequestError("Failed to read device resource usage", err);
  }
};

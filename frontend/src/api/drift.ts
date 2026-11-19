import { baseApi } from "./http";

// Configuration Drift — what changed on a firewall that this console did not do.
//
// The other half of the Change Ledger (see ledger.ts), and since the two were merged, the page that
// shows both: the ledger is a tab of Configuration Drift. The ledger records every write the console
// made; drift compares two backups and subtracts those, leaving the changes nobody here can
// account for. Like the ledger, it reads the app's own database, so it keeps working — and keeps
// being worth reading — while the device itself is unreachable.

/** baseline = first backup, nothing to compare against. */
export type DriftStatus = "baseline" | "clean" | "drift" | "error" | "never";

export type DriftAction = "created" | "deleted" | "modified";

export type DriftFinding = {
  id: number;
  drift_run_id: number;
  network_device_id: number;

  /** CLI path as the config file writes it, e.g. "firewall address". */
  table: string;
  cmdb_path: string;
  resource_key: string;
  action: DriftAction;

  /** The ±lines for this object. */
  detail: string;

  /** True when a Change Ledger row accounts for it — i.e. this console did it. */
  attributed: boolean;
  attributed_to?: string;

  /** The Change Ledger row that undid it, when it was undone from the console. */
  undo_change_id?: number;
};

export type DriftRun = {
  id: number;
  created_at: string;
  network_device_id: number;
  network_device?: { ID: number; name: string; mgmt_ip: string };

  from_backup_id: number;
  to_backup_id: number;
  status: DriftStatus;

  lines_added: number;
  lines_removed: number;

  total_changes: number;
  attributed_count: number;
  drift_count: number;

  summary: string;
  error_text?: string;
  triggered_by?: string;

  findings?: DriftFinding[];
};

export type DriftSummaryRow = {
  network_device_id: number;
  device_name: string;
  mgmt_ip: string;
  status: DriftStatus;
  last_run_id?: number;
  last_run_at?: string;
  summary?: string;
  /** Outside changes still in place across every run for this device — nothing undid them. */
  open_drift: number;
  backup_seen: boolean;
};

export const GetDriftSummary = async (): Promise<{ data: DriftSummaryRow[]; open_drift_total: number }> => {
  const res = await baseApi.get<{ data: DriftSummaryRow[]; open_drift_total: number }>("/drift/summary");
  return { data: res.data?.data ?? [], open_drift_total: res.data?.open_drift_total ?? 0 };
};

export const ListDriftRuns = async (params?: {
  device_id?: number; status?: string; page?: number; page_size?: number;
}): Promise<{ data: DriftRun[]; total: number }> => {
  const res = await baseApi.get<{ data: DriftRun[]; total: number }>("/drift/runs", { params });
  return { data: res.data?.data ?? [], total: res.data?.total ?? 0 };
};

export const GetDriftRun = async (id: number): Promise<DriftRun> => {
  const res = await baseApi.get<DriftRun>(`/drift/runs/${id}`);
  return res.data;
};

/** Compare the device's two newest backups now. Admin only. */
export const AnalyseDrift = async (deviceId: number): Promise<DriftRun> => {
  const res = await baseApi.post<{ data: DriftRun }>("/drift/analyse", { device_id: deviceId });
  return res.data.data;
};

// ── Change analytics (stat tiles + the two charts) ───────────────────────────

export type DriftAnalyticsDay = {
  /** YYYY-MM-DD in the viewer's zone. */
  date: string;
  /** Writes through this console that reached the device (applied, or applied then reverted). */
  console: number;
  /** Writes the device rejected — never counted as a change. */
  failed: number;
  /** Objects changed outside the console, dated by the drift run that found them. */
  outside: number;
};

export type DriftAnalyticsTable = {
  /** Canonical CMDB path, e.g. "firewall/policy"; "other" for the folded tail. */
  table: string;
  /** As the CLI writes it, e.g. "firewall policy". */
  label: string;
  console: number;
  outside: number;
};

export type DriftAnalyticsTotals = {
  console: number;
  failed: number;
  reverted: number;
  outside: number;
  runs: number;
  drift_runs: number;
};

export type DriftAnalytics = {
  days: number;
  from: string;
  device_id?: number;
  totals: DriftAnalyticsTotals;
  daily: DriftAnalyticsDay[];
  tables: DriftAnalyticsTable[];
};

/**
 * Both halves of "what changed", counted per day and per FortiOS table.
 *
 * The browser's UTC offset goes with it so a day starts where this viewer's day starts — the bar
 * labelled "Sep 3" then counts exactly what the ledger tab lists under Sep 3. JavaScript's
 * getTimezoneOffset() is west-positive; the API wants east-positive, hence the minus.
 */
export const GetDriftAnalytics = async (params: { days: number; device_id?: number }): Promise<DriftAnalytics> => {
  const res = await baseApi.get<{ data: DriftAnalytics }>("/drift/analytics", {
    params: { ...params, tz_offset: -new Date().getTimezoneOffset() },
  });
  return res.data.data;
};

// ── One timeline of every change (Change Ledger + outside changes) ───────────

export type TimelineFilter = "all" | "console" | "outside" | "failed";

/**
 * What taking this change back means:
 *   undo    — one click, this change only (exact inverse on the firewall)
 *   restore — only by restoring the backup taken before it: the whole configuration, and a reboot
 *   none    — nothing to take back; `undo_note` says why
 */
export type Fallback = "undo" | "restore" | "none";

export type TimelineItem = {
  kind: "console" | "outside";
  /** change_records.id for console rows, drift_findings.id for outside rows. */
  id: number;
  at: string;
  device_id: number;
  device_name?: string;
  action: "create" | "update" | "delete";
  /** FortiOS table as the CLI writes it, e.g. "firewall address". */
  table: string;
  key: string;
  fallback: Fallback;
  undo_note?: string;

  // console
  via?: string;
  user?: string;
  status?: "applied" | "failed" | "reverted";
  error_text?: string;
  reverted_at?: string;
  reverted_by?: string;
  revert_of_id?: number;
  has_before?: boolean;
  has_after?: boolean;

  // outside
  run_id?: number;
  /** The change happened after window_from and before window_to (the two backups). */
  window_from?: string;
  window_to?: string;
  /**
   * The Change Ledger row that took this change back. Its presence is the only thing that closes an
   * outside change — there is no sign-off any more — so a row without it is still on the firewall.
   */
  undo_change_id?: number;
  restore_backup_id?: number;
};

export type TimelineCounts = { all: number; console: number; outside: number; failed: number };

export type TimelinePage = {
  data: TimelineItem[];
  total: number;
  counts: TimelineCounts;
  limit: number;
  offset: number;
};

export const GetTimeline = async (params: {
  device_id?: number; filter: TimelineFilter; limit?: number; offset?: number;
}): Promise<TimelinePage> => {
  const res = await baseApi.get<TimelinePage>("/drift/timeline", { params });
  const d = res.data;
  return {
    data: d?.data ?? [],
    total: d?.total ?? 0,
    counts: d?.counts ?? { all: 0, console: 0, outside: 0, failed: 0 },
    limit: d?.limit ?? 0,
    offset: d?.offset ?? 0,
  };
};

// ── Who made an outside change, from the firewall's own log ──────────────────
//
// A device-proxy read, NOT part of the timeline: /drift/timeline answers from this platform's
// database and keeps working while the firewall is unreachable, which is the situation this whole
// page exists for. The names are asked for separately and afterwards, so losing them costs the
// history nothing.

/** What the firewall's config-change log could say about one finding. */
export type AttributionStatus = "matched" | "out-of-reach" | "unexplained";

export type ConfigChangeEvent = {
  at: string;
  user: string;
  /**
   * How they were connected, in the device's own words: "ssh", "GUI", "jsconsole", "console"…
   * ⚠️ FortiOS logs every REST call as "GUI" too, so this does not distinguish the web interface
   * from a tool driving the API. Say "over GUI", never "using the web interface".
   */
  via: string;
  source_ip?: string;
  action: string; // Add | Edit | Delete, as the device writes them
  path: string;   // cfgpath, e.g. "firewall.address"
  object: string;
  attrs: string;  // cfgattr — "comment[old->new]"
  uuid?: string;
};

export type DriftAttribution = {
  finding_id: number;
  status: AttributionStatus;
  /** Every event matching this object inside the window, newest first. Only when matched. */
  events?: ConfigChangeEvent[];
};

export type DriftAttributionPage = {
  /** Keyed by finding id. */
  data: Record<string, DriftAttribution>;
  /** The span the device's log actually covered — what makes "out-of-reach" a readable answer. */
  log_from?: string;
  log_to?: string;
  total: number;
};

export const GetDriftAttribution = async (deviceId: number): Promise<DriftAttributionPage> => {
  const res = await baseApi.get<DriftAttributionPage>(`/policy/device/${deviceId}/drift-attribution`);
  return {
    data: res.data?.data ?? {},
    log_from: res.data?.log_from,
    log_to: res.data?.log_to,
    total: res.data?.total ?? 0,
  };
};

/** One outside change with its ±lines — loaded when its row is opened. */
export const GetDriftFinding = async (id: number): Promise<DriftFinding> => {
  const res = await baseApi.get<{ data: DriftFinding }>(`/drift/findings/${id}`);
  return res.data.data;
};

/**
 * Takes back an object that was created OUTSIDE the console, by deleting it from the firewall.
 * Admin-only. The delete is recorded in the Change Ledger, so it can itself be undone.
 */
export const UndoDriftFinding = async (id: number): Promise<{ message: string; already_gone?: boolean }> => {
  const res = await baseApi.post(`/drift/findings/${id}/undo`);
  return res.data;
};

// ── Cross-device diff — "are these two firewalls consistent?" ────────────────
//
// A sibling of same-device drift above, not the same feature: this diffs two DIFFERENT devices'
// latest backups against each other rather than one device's backup against its own previous one,
// and there is no Change Ledger to subtract (two devices share no change history) — see the
// backend's services/crossdevicediff.go.

/** One object that differs between the two devices' latest backups. */
export type CrossDeviceChange = {
  table: string;
  cmdb_path: string;
  key: string;
  action: DriftAction;
  added: string[];
  removed: string[];
};

export type CrossDeviceDiffSide = {
  device_id: number;
  device_name: string;
  backup_id: number;
  backup_at: string;
};

export type CrossDeviceDiffResult = {
  a: CrossDeviceDiffSide;
  b: CrossDeviceDiffSide;
  changes: CrossDeviceChange[];
  /** Exists on b's backup but not a's. */
  only_in_b: number;
  /** Exists on a's backup but not b's. */
  only_in_a: number;
  differs: number;
  secrets_changed: number;
};


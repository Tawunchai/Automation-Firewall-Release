import { baseApi } from "./http";
import { deviceBase, DeviceRequestError, type DeviceReadOpts } from "./deviceRequest";

/**
 * Stored history — the numbers a FortiGate does not keep.
 *
 * Everything here comes out of the console's own metric_samples table, written by the scheduler
 * every five minutes (backend services/metrics.go). It is the only device-scoped endpoint that
 * never reaches the device, which is the point: a FortiGate remembers twenty-four hours of CPU and
 * no history of anything else, so a chart over a week cannot be answered by asking it.
 */

/** The kinds the backend records. Each one's UNIT is in its comment — the value is a bare number. */
export type MetricKind =
  | "cpu_pct"        // percent
  | "mem_pct"        // percent
  | "sessions"       // a count
  | "tunnel_up"      // 1 up, 0.5 partial, 0 down
  | "sla_latency_ms" // milliseconds
  | "sla_jitter_ms"  // milliseconds
  | "sla_loss_pct"   // percent
  | "policy_hits"    // the device's CUMULATIVE counter, not a rate
  | "if_rx_bytes"    // the device's CUMULATIVE byte counter, per interface
  | "if_tx_bytes";   // likewise

export type MetricPoint = { at: string; value: number };

export type MetricSeries = {
  kind: MetricKind;
  /** What the number is about: an interface, a tunnel name, a policy id, or "" for the device. */
  subject: string;
  points: MetricPoint[];
};

export type MetricHistory = {
  series: MetricSeries[];
  /** How far apart two points are. Without it a reader cannot tell a gap from a flat line. */
  sampled_every_seconds: number;
  retention_days: number;
};

export type MetricHistoryQuery = {
  kinds?: MetricKind[];
  subjects?: string[];
  from?: Date;
  to?: Date;
  /** Points per series. The backend caps at 1000 and thins by sampling, never by averaging. */
  limit?: number;
};

const EMPTY: MetricHistory = { series: [], sampled_every_seconds: 300, retention_days: 90 };

/**
 * Reads stored history for one device.
 *
 * Lenient by default like the other device readers, and for the same reason: a chart panel beside a
 * working page should degrade to "no history yet" rather than take the page down with it. Pages
 * that PRESENT the history as their subject pass `{ strict: true }`.
 */
export const DeviceGetMetricHistory = async (
  deviceId: number, q?: MetricHistoryQuery, opts?: DeviceReadOpts,
): Promise<MetricHistory> => {
  const params = new URLSearchParams();
  q?.kinds?.forEach((k) => params.append("kind", k));
  q?.subjects?.forEach((s) => params.append("subject", s));
  if (q?.from) params.set("from", q.from.toISOString());
  if (q?.to) params.set("to", q.to.toISOString());
  if (q?.limit) params.set("limit", String(q.limit));

  const qs = params.toString();
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/metrics${qs ? `?${qs}` : ""}`);
    const d = res.data as Partial<MetricHistory> | null;
    return {
      series: Array.isArray(d?.series) ? d!.series! : [],
      sampled_every_seconds: d?.sampled_every_seconds ?? EMPTY.sampled_every_seconds,
      retention_days: d?.retention_days ?? EMPTY.retention_days,
    };
  } catch (err) {
    if (opts?.strict) throw new DeviceRequestError("Could not load stored history", err);
    return EMPTY;
  }
};

/** Common windows, as the charts offer them. */
export const HISTORY_WINDOWS = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7 days", hours: 24 * 7 },
  { key: "30d", label: "30 days", hours: 24 * 30 },
  { key: "90d", label: "90 days", hours: 24 * 90 },
] as const;

export type HistoryWindowKey = (typeof HISTORY_WINDOWS)[number]["key"];

export const windowRange = (key: HistoryWindowKey): { from: Date; to: Date } => {
  const w = HISTORY_WINDOWS.find((x) => x.key === key) ?? HISTORY_WINDOWS[0];
  const to = new Date();
  return { from: new Date(to.getTime() - w.hours * 3600_000), to };
};

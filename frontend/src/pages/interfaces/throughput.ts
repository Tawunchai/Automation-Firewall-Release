import type { MetricPoint, MetricSeries } from "../../api/metrics";

/**
 * Turning stored byte counters into a throughput anyone recognises.
 *
 * The console stores what the device reports: `rx_bytes` and `tx_bytes`, cumulative since the
 * interface came up. Nobody thinks in cumulative bytes — a link is 200 Mbps or it is not — so the
 * conversion happens here, at read time, where the reader can see the arithmetic.
 *
 * ── Why the elapsed time is measured and not assumed ─────────────────────────
 *
 * Dividing by the nominal five minutes would be wrong exactly when it matters: a sweep that was
 * missed, a device that was unreachable for an hour, a backend restart. The gap between two samples
 * is right there in their timestamps, so it is used, and a pair with no elapsed time is dropped
 * rather than divided by zero.
 *
 * A NEGATIVE difference is a counter reset — the interface bounced, the device rebooted — and is
 * dropped rather than drawn as an enormous spike or clamped to a zero that would read as "idle".
 */

/** Bits per second between consecutive samples. One shorter than the input, and never negative. */
export const toBitsPerSecond = (points: MetricPoint[]): MetricPoint[] => {
  const out: MetricPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const seconds = (new Date(points[i].at).getTime() - new Date(points[i - 1].at).getTime()) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const deltaBytes = points[i].value - points[i - 1].value;
    if (deltaBytes < 0) continue;
    out.push({ at: points[i].at, value: (deltaBytes * 8) / seconds });
  }
  return out;
};

export type InterfaceThroughput = {
  name: string;
  rx: MetricPoint[];
  tx: MetricPoint[];
  /** The busiest single sample in either direction — what a link has to be sized for. */
  peakBps: number;
  /** Bytes moved across the whole window, both directions. */
  totalBytes: number;
};

/**
 * One row per interface, busiest first.
 *
 * Ranked by total volume rather than by peak: the question the list answers is "which of these
 * carries the traffic", and one 900 Mbps burst at 3am does not make an otherwise idle port the
 * busiest thing on the box.
 */
export const summariseThroughput = (series: MetricSeries[]): InterfaceThroughput[] => {
  const byName = new Map<string, { rxRaw: MetricPoint[]; txRaw: MetricPoint[] }>();
  for (const s of series) {
    if (s.kind !== "if_rx_bytes" && s.kind !== "if_tx_bytes") continue;
    const entry = byName.get(s.subject) ?? { rxRaw: [], txRaw: [] };
    if (s.kind === "if_rx_bytes") entry.rxRaw = s.points ?? [];
    else entry.txRaw = s.points ?? [];
    byName.set(s.subject, entry);
  }

  const volume = (points: MetricPoint[]): number => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const delta = points[i].value - points[i - 1].value;
      if (delta > 0) total += delta;
    }
    return total;
  };

  const rows: InterfaceThroughput[] = [...byName.entries()].map(([name, raw]) => {
    const rx = toBitsPerSecond(raw.rxRaw);
    const tx = toBitsPerSecond(raw.txRaw);
    const peaks = [...rx, ...tx].map((p) => p.value);
    return {
      name,
      rx,
      tx,
      peakBps: peaks.length === 0 ? 0 : Math.max(...peaks),
      totalBytes: volume(raw.rxRaw) + volume(raw.txRaw),
    };
  });

  return rows.sort((a, b) => b.totalBytes - a.totalBytes || a.name.localeCompare(b.name));
};

/** 1.2 Gbps, 340 Mbps, 12 kbps — the units a link is actually described in. */
export const formatBitsPerSecond = (bps: number): string => {
  if (!Number.isFinite(bps) || bps <= 0) return "0 bps";
  const units = ["bps", "kbps", "Mbps", "Gbps", "Tbps"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

/** Total moved, in the units a monthly allowance is written in. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

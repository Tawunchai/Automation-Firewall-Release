import type { LicenseStatus, UsageInterval, UsagePoint } from "../../api/deviceMonitor";

// Pure display helpers for the FortiGate status dashboard. Kept out of the components so the
// number-to-text rules — the part that is easy to get subtly wrong — can be tested directly.

/** Bytes as the FortiGate GUI writes them: "0 B", "1.5 GB", "488.3 TB". */
export const formatBytes = (n: number | null | undefined): string => {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

/**
 * Uptime in the device's own dd:hh:mm:ss form ("44:21:34:19").
 * Returns "—" when uptime is unknown (the SSH probe could not run).
 */
export const formatUptime = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days}:${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
};

/** Uptime spelled out for the tooltip: "44 days, 21 hours, 34 minutes". */
export const formatUptimeLong = (seconds: number | null | undefined): string => {
  if (!seconds || seconds < 0) return "Unknown";
  const s = Math.floor(seconds);
  const parts: string[] = [];
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(", ");
};

/**
 * Device-local wall clock, formatted the way the FortiGate GUI shows System Time.
 *
 * `epochUTC` is the device clock as a UTC epoch in **seconds** and `offsetSeconds` the device's
 * current (DST-adjusted) offset. Formatting happens in UTC after shifting, so the browser's own
 * timezone never leaks into a value that describes the firewall.
 */
export const formatDeviceTime = (epochUTC: number, offsetSeconds: number): string => {
  if (!epochUTC) return "—";
  const d = new Date((epochUTC + offsetSeconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
};

/** Chart axis label for one sample, scaled to the window being shown. */
export const formatAxisTime = (epochMs: number, interval: UsageInterval): string => {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (interval === "12-hour" || interval === "24-hour") {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};


/** Absolute date for licence expiry ("13 Apr 2023"). */
export const formatDate = (epochSeconds?: number): string => {
  if (!epochSeconds) return "—";
  const d = new Date(epochSeconds * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// ── Licence presentation ──────────────────────────────────────────────────────

/**
 * How a licence row is drawn. "ok" is green, "error" red (something that WAS licensed and
 * lapsed), "warn" amber (never licensed — a missing subscription, not a broken one), "muted"
 * grey (the device did not say).
 */
export type Tone = "ok" | "warn" | "error" | "muted";

export const licenseTone = (status: LicenseStatus): Tone => {
  switch (status) {
    case "licensed":
    case "registered":
    case "free_license":
      return "ok";
    case "expired":
      return "error";
    case "no_license":
      return "warn";
    default:
      return "muted";
  }
};

export const licenseStatusLabel = (status: LicenseStatus): string => {
  switch (status) {
    case "licensed":
      return "Licensed";
    case "registered":
      return "Registered";
    case "free_license":
      return "Free License";
    case "expired":
      return "Expired";
    case "no_license":
      return "Not Licensed";
    case "unknown":
      return "Unknown";
    default:
      return status;
  }
};

export const TONE_COLORS: Record<Tone, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  error: "#ef4444",
  muted: "#94a3b8",
};

/** FortiGate Cloud's server location is reported as a region code. */
export const cloudRegionLabel = (domain: string): string => {
  switch ((domain || "").toUpperCase()) {
    case "GLOBAL":
      return "Global";
    case "US":
      return "United States";
    case "EUROPE":
      return "Europe";
    case "":
      return "—";
    default:
      return domain;
  }
};

// ── Chart data ────────────────────────────────────────────────────────────────

export type ChartRow = { t: number; label: string } & Record<string, number | string>;

/**
 * Merges the aggregate series with its per-core siblings into one row set for recharts, keyed by
 * timestamp. Cores that are missing a sample simply leave that cell empty rather than dropping
 * the whole row — the aggregate line stays continuous.
 */
export const buildChartRows = (
  main: UsagePoint[],
  interval: UsageInterval,
  extra: { key: string; points: UsagePoint[] }[] = [],
): ChartRow[] => {
  const rows = new Map<number, ChartRow>();
  for (const p of main) {
    rows.set(p.t, { t: p.t, label: formatAxisTime(p.t, interval), value: p.v });
  }
  for (const series of extra) {
    for (const p of series.points) {
      const row = rows.get(p.t);
      if (row) row[series.key] = p.v;
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
};

/** Percentage of `total` that `part` represents, at one decimal ("0.0%"). */
export const percentOf = (part: number, total: number): string => {
  if (!total || total <= 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
};

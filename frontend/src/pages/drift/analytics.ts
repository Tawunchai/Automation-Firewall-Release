import type { DriftAnalytics, DriftAnalyticsDay, DriftAnalyticsTable } from "../../api/drift";

// Pure helpers for the Configuration Drift page — mostly the charts — kept out of the components so
// the arithmetic and the labelling can be pinned by tests without rendering anything.

/** The windows the page offers. The server clamps anything else; these are what the picker shows. */
export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: WindowDays = 30;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-03" → "Sep 3".
 *
 * Parsed by hand, not through `new Date(iso)`: a bare ISO date is read as UTC midnight, which is the
 * PREVIOUS day anywhere west of Greenwich — and the server already bucketed these in the viewer's
 * zone, so they must be shown exactly as they came.
 */
export const dayLabel = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : iso;
};

/**
 * How many x-axis ticks to skip between labels so they never collide.
 *
 * About eight labels fit across the chart at the widths this page lays out, so a 90-day window
 * labels every eleventh day rather than printing ninety overlapping dates.
 */
export const tickInterval = (days: number, maxLabels = 8): number =>
  days <= maxLabels ? 0 : Math.ceil(days / maxLabels) - 1;

/** True when nothing at all changed in the window — the charts then show a sentence, not axes. */
export const isQuietWindow = (a: DriftAnalytics | null): boolean =>
  !a || (a.totals.console === 0 && a.totals.outside === 0 && a.totals.failed === 0);

/** The peak day for each series — what the per-day chart's caption names. */
export const busiestDay = (
  daily: DriftAnalyticsDay[], key: "console" | "outside",
): DriftAnalyticsDay | null => {
  let best: DriftAnalyticsDay | null = null;
  for (const d of daily) if (d[key] > 0 && (!best || d[key] > best[key])) best = d;
  return best;
};

/**
 * Share of all changes in the window that the console cannot account for, as a whole percent.
 * `null` when there were no changes — "0% unaccounted" would claim a clean bill the data never gave.
 */
export const outsideShare = (a: DriftAnalytics | null): number | null => {
  if (!a) return null;
  const all = a.totals.console + a.totals.outside;
  return all === 0 ? null : Math.round((a.totals.outside / all) * 100);
};

/** Compact count for tiles and axis ticks: 999 / 1.2K / 12K. */
export const compact = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${Math.round(n / 1000)}K`;
};

/** Rows for the per-table chart, busiest first — the server already ranked and capped them. */
export const tableRows = (tables: DriftAnalyticsTable[]) =>
  tables.map((t) => ({ ...t, total: t.console + t.outside }));

/** The server's error text when it sent one, the caller's words otherwise. */
export const errorText = (e: unknown, fallback: string): string => {
  const data = (e as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
};

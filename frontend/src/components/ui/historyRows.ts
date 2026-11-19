import type { MetricPoint } from "../../api/metrics";

/**
 * Turning several series into the one row-per-timestamp table recharts wants.
 *
 * ── Why the column is `s0` and not the series' own name ──────────────────────
 *
 * A recharts `dataKey` is a PATH, not a key: given "port1.100" it looks for `row.port1["100"]`,
 * finds nothing, and draws no line at all — no warning, no error, an empty chart. Dotted names are
 * not exotic here: a VLAN interface is `port1.100`, and an SD-WAN member is one. Two series that
 * happened to share a label would also have collapsed into one column.
 *
 * So the column is a positional key and the label travels separately, as the series `name` that the
 * legend and the tooltip read.
 */

export type SeriesInput = { label: string; points: MetricPoint[] };

/** The column a series is stored under. Positional, so any label is safe. */
export const seriesKey = (index: number): string => `s${index}`;

export type MergedRow = Record<string, number | string> & { at: string };

/**
 * One row per timestamp, sorted. A series with no sample at some timestamp leaves the cell ABSENT
 * rather than zero — a gap in sampling must not draw a line down to the floor and back up.
 */
export const mergeSeriesRows = (series: SeriesInput[]): MergedRow[] => {
  const byTime = new Map<string, MergedRow>();
  series.forEach((s, i) => {
    const key = seriesKey(i);
    for (const p of s.points ?? []) {
      const row = byTime.get(p.at) ?? ({ at: p.at } as MergedRow);
      row[key] = p.value;
      byTime.set(p.at, row);
    }
  });
  return [...byTime.values()].sort((a, b) => a.at.localeCompare(b.at));
};

/**
 * What an axis tick has to say for the window to be readable.
 *
 * Three cases, and the middle one is the one that was wrong. A 24-hour window of samples taken
 * either side of an overnight gap renders as "05:19 PM … 10:47 AM … 12:01 PM", which reads as a
 * chart with its points shuffled — the times ARE in order, they just cross midnight, and a clock
 * alone cannot say so. So a window that crosses a calendar day gets the date on the tick, even
 * when it is shorter than a day.
 *
 *   "time"     one calendar day: 14:05
 *   "dayTime"  crosses midnight but is still short: 16 Sep 17:19
 *   "day"      long enough that the time of day is noise: 16 Sep
 */
export type AxisMode = "time" | "dayTime" | "day";

export const axisMode = (rows: MergedRow[]): AxisMode => {
  const first = rows[0]?.at;
  const last = rows[rows.length - 1]?.at;
  if (!first || !last) return "time";

  const a = new Date(first);
  const b = new Date(last);
  if (b.getTime() - a.getTime() > 36 * 3600_000) return "day";
  return a.toDateString() === b.toDateString() ? "time" : "dayTime";
};

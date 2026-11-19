import type { MetricPoint } from "../api/metrics";

/**
 * Collapses a fine-grained sample series into a readable number of columns.
 *
 * A line chart can take two thousand points and still read; a bar chart cannot. The sampler stores
 * one reading every five minutes, so a seven-day window is ~2,000 samples — drawn as columns that
 * is a solid block with no columns in it, and with four policies grouped side by side it is four
 * solid blocks. Bucketing is what makes a bar chart possible at all here, not a styling choice.
 *
 * Values are SUMMED, which is correct for this data and would be wrong for most: these points are
 * already per-interval deltas (see lib/hitRate.ts), so "hits in this hour" really is the sum of the
 * twelve five-minute counts inside it. A series of gauges — CPU percent, temperature — would have
 * to average instead, and this helper deliberately does not offer that rather than taking a mode
 * flag that a caller could set wrongly and never notice.
 *
 * A bucket with no samples is OMITTED rather than emitted as zero. Zero means "the firewall
 * reported no matches"; a gap means "nothing was sampled", usually because the console was down.
 * Drawing the second as the first is the console claiming a quiet hour it never observed.
 */
export const bucketSeries = (points: MetricPoint[], bucketMs: number): MetricPoint[] => {
  if (bucketMs <= 0 || points.length === 0) return points;

  const sums = new Map<number, number>();
  for (const p of points) {
    const t = new Date(p.at).getTime();
    if (!Number.isFinite(t)) continue;
    // Floor to the bucket's own start, so the same wall-clock hour always lands in the same
    // column whichever sample arrives first.
    const start = Math.floor(t / bucketMs) * bucketMs;
    sums.set(start, (sums.get(start) ?? 0) + p.value);
  }

  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, value]) => ({ at: new Date(start).toISOString(), value }));
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * The bucket width for each history window, chosen to land between about 7 and 24 columns.
 *
 * That range is what a grouped column chart can show without the groups touching — below it the
 * chart wastes its width, above it the bars within a group get thinner than the gap between them
 * and the grouping stops being readable. The numbers are per window rather than computed from the
 * point count so that the same window always produces the same column width, and switching
 * between two policies does not silently re-scale the x axis.
 */
export const BUCKET_FOR_WINDOW: Record<string, number> = {
  "24h": HOUR,        // 24 columns
  "7d": DAY,          // 7
  "30d": 2 * DAY,     // 15
  "90d": 7 * DAY,     // ~13
};

export const bucketForWindow = (key: string): number => BUCKET_FOR_WINDOW[key] ?? HOUR;

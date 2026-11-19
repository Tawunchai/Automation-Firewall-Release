import type { MetricKind, MetricPoint, MetricSeries } from "../../api/metrics";
import type { SDWANHealthCheck } from "../../api/sdwan";
import { thresholdValue, type SLAMetric } from "./slaFormat";

/**
 * The arithmetic behind "was this link bad last night?".
 *
 * The strip above the list shows what the device measures THIS SECOND, which is all a FortiGate can
 * answer — monitor/virtual-wan/health-check reports the present and keeps nothing. The console has
 * been sampling those same three numbers every five minutes into metric_samples since Phase 6, and
 * this is the arithmetic that turns those samples into the two things an operator actually writes
 * down: how far out of SLA a member ran, and how often.
 *
 * Pure on purpose — the panel renders it, the tests check it.
 */

/** Which stored kind carries which of the FortiGate's three measurements. */
export const METRIC_KIND: Record<SLAMetric, MetricKind> = {
  latency: "sla_latency_ms",
  jitter: "sla_jitter_ms",
  "packet-loss": "sla_loss_pct",
};

export const metricUnit = (metric: SLAMetric): string => (metric === "packet-loss" ? "%" : "ms");

/**
 * Splits the stored subject, which the sampler writes as `<health check>/<member interface>`.
 *
 * Split at the LAST slash, not the first: a FortiGate health-check name is free text and a stock
 * device ships one called "Default_Google Search", while an interface name cannot contain a slash
 * at all. So everything before the final slash is the check.
 */
export const splitSubject = (subject: string): { check: string; member: string } => {
  const cut = subject.lastIndexOf("/");
  if (cut < 0) return { check: "", member: subject };
  return { check: subject.slice(0, cut), member: subject.slice(cut + 1) };
};

/**
 * The threshold a member is judged against, or null when the check does not select on this metric.
 *
 * A check can carry several SLA targets (the device numbers them 1, 2, … and a rule names one). The
 * STRICTEST is used, because it is the first one a member falls out of — reporting against the
 * loosest would call a link healthy while the rule that depends on it has already moved traffic.
 *
 * A threshold only exists when its criterion is in `link_cost_factor`: drop "latency" from the set
 * and the device resets latency-threshold to its default 5, which would otherwise be drawn as a
 * limit nobody set.
 */
export const thresholdFor = (
  checks: SDWANHealthCheck[], checkName: string, metric: SLAMetric,
): number | null => {
  const check = checks.find((c) => c.name === checkName);
  if (!check) return null;
  const values = (check.sla ?? [])
    .filter((row) => row.link_cost_factor.includes(metric))
    .map((row) => thresholdValue(row, metric))
    .filter((v) => Number.isFinite(v));
  return values.length === 0 ? null : Math.min(...values);
};

export type SLAHistoryRow = {
  /** The stored subject, and the identity the chart selects on. */
  subject: string;
  check: string;
  member: string;
  points: MetricPoint[];
  samples: number;
  /** Mean over the window. null when nothing was sampled. */
  avg: number | null;
  /** The worst single sample — the spike a mean hides. */
  worst: number | null;
  threshold: number | null;
  /** Share of samples past the threshold, 0-100. null when the check sets no threshold. */
  breachPct: number | null;
};

/**
 * One row per member, worst first.
 *
 * "Worst" is breach share before average, because a link that sat 1ms over its limit for a third of
 * the night matters more than one that averages higher and never breached — the second is a slow
 * link, the first is an SLA that failed. Members whose check sets no threshold cannot be judged
 * that way and sort by average, below anything that did breach.
 */
export const summariseSLAHistory = (
  series: MetricSeries[], checks: SDWANHealthCheck[], metric: SLAMetric,
): SLAHistoryRow[] => {
  const rows: SLAHistoryRow[] = series.map((s) => {
    const { check, member } = splitSubject(s.subject);
    const threshold = thresholdFor(checks, check, metric);
    const points = s.points ?? [];
    const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
    const over = threshold === null ? 0 : values.filter((v) => v > threshold).length;
    return {
      subject: s.subject,
      check,
      member,
      points,
      samples: values.length,
      avg: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
      worst: values.length === 0 ? null : Math.max(...values),
      threshold,
      breachPct: threshold === null || values.length === 0 ? null : (over / values.length) * 100,
    };
  });

  return rows.sort((a, b) => {
    const ab = a.breachPct ?? -1;
    const bb = b.breachPct ?? -1;
    if (ab !== bb) return bb - ab;
    return (b.avg ?? -1) - (a.avg ?? -1);
  });
};

/**
 * How many members may be drawn at once.
 *
 * The shared chart's palette is four fixed colours and does not cycle, so a fifth line would repeat
 * one and make two members look like the same series.
 */
export const MAX_PLOTTED = 4;

/** The worst few, which is what someone opening the panel came to see. */
export const defaultSelection = (rows: SLAHistoryRow[]): string[] =>
  rows.slice(0, MAX_PLOTTED).map((r) => r.subject);

/**
 * The one threshold worth drawing on the chart.
 *
 * Only when every plotted member is judged against the same number: two dashed lines on one plot,
 * each applying to a different line, is a reader's mistake waiting to happen.
 */
export const sharedThreshold = (rows: SLAHistoryRow[], selected: string[]): number | null => {
  const picked = rows.filter((r) => selected.includes(r.subject));
  if (picked.length === 0) return null;
  const first = picked[0].threshold;
  if (first === null) return null;
  return picked.every((r) => r.threshold === first) ? first : null;
};

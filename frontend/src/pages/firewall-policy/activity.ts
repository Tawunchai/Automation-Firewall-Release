import type { MetricSeries } from "../../api/metrics";
import { toRate } from "../../lib/hitRate";

/**
 * What a rule did over the last day, per rule, for the column beside it.
 *
 * The list already says what a rule IS. The question people ask while looking at it — "is anything
 * still using this?" — was only answerable by leaving for Rule Lifecycle, and even there only as a
 * total since the firewall booted, which says nothing about whether the traffic stopped in March.
 *
 * The stored counter is CUMULATIVE, so everything here is built on deltas (see lib/hitRate): the
 * shape is hits per sample, and the total is what those deltas add up to across the window — not
 * the device's running total, which includes everything since the last reboot.
 */

export type PolicyActivity = {
  policyid: number;
  /** Hits per sample, oldest first. One shorter than the samples: a delta needs two of them. */
  rate: number[];
  /** Hits across the whole window. */
  total: number;
  /** The last sample that carried any hits, or null if the rule was quiet throughout. */
  lastHitAt: string | null;
  /** How many samples the window actually holds — 0 means "not measured", not "no traffic". */
  samples: number;
};

/**
 * Groups stored samples by policy.
 *
 * The subject is the policy id as a string. Anything that does not parse as a number is dropped
 * rather than shown against policy NaN: a subject this console did not write is not this page's to
 * guess at.
 */
export const summarisePolicyActivity = (series: MetricSeries[]): Map<number, PolicyActivity> => {
  const out = new Map<number, PolicyActivity>();
  for (const s of series) {
    // Matched, not coerced: Number("") is 0 and Number.isInteger(0) is true, so a device-level
    // sample — the sampler writes "" as the subject for CPU, memory and sessions — would otherwise
    // be filed under policy 0, which on a FortiGate is the implicit deny rule.
    if (!/^\d+$/.test(s.subject)) continue;
    const id = Number(s.subject);

    const rate = toRate(s.points ?? []);
    const withHits = rate.filter((p) => p.value > 0);
    out.set(id, {
      policyid: id,
      rate: rate.map((p) => p.value),
      total: rate.reduce((sum, p) => sum + p.value, 0),
      lastHitAt: withHits.length === 0 ? null : withHits[withHits.length - 1].at,
      samples: (s.points ?? []).length,
    });
  }
  return out;
};

/** 12,400 in a table column is noise; 12.4k is the same fact. */
export const compactHits = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

/**
 * What the column says in words, which is also what a screen reader gets.
 *
 * The three states are deliberately different sentences, because they are three different facts and
 * collapsing any two of them is how a page comes to claim something it does not know:
 *   · not measured  — no samples in the window (a device added an hour ago, sampling switched off)
 *   · quiet         — measured, and nothing matched this rule
 *   · a number      — measured, and this much traffic matched
 */
export const activityLabel = (a: PolicyActivity | undefined): string => {
  if (!a || a.samples === 0) return "No samples for this rule yet";
  if (a.total === 0) return "No traffic matched this rule in the last 24 hours";
  return `${compactHits(a.total)} hits in the last 24 hours`;
};

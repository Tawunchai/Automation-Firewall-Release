/**
 * A cumulative counter, read as a rate.
 *
 * The device reports a policy's hit count as a total since boot, so the raw series only ever climbs
 * and every rule looks identical: a line going up. What matters is hits PER INTERVAL, which is the
 * difference between consecutive samples.
 *
 * A reboot resets the counter, so a difference can come out negative. That is not "minus four
 * thousand hits" — it is a boundary where the old total is gone, and it is dropped rather than
 * clamped to zero, because a zero there would read as "quiet at this moment" when the truth is
 * "unknown across this moment".
 *
 * Shared, because two pages read the same counter: Rule Lifecycle charts it over a window and the
 * Firewall Policy list draws a sparkline of it per rule. It also keeps Fast Refresh working — a file
 * exporting both a component and a helper reloads the whole route instead of swapping the component.
 */

/** Consecutive differences, dropping the counter resets. */
export const toRate = (points: { at: string; value: number }[]): { at: string; value: number }[] => {
  const out: { at: string; value: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].value - points[i - 1].value;
    if (delta < 0) continue; // the device rebooted between these two samples
    out.push({ at: points[i].at, value: delta });
  }
  return out;
};

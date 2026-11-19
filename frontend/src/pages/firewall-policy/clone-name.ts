// Naming the copy.
//
// Its own module rather than a second export from clone.tsx: a file that exports a component and a
// plain function loses Fast Refresh. Being testable without a DOM is the useful side effect.

/** FortiOS caps a policy name at 35 characters. */
export const POLICY_NAME_MAX = 35;

/**
 * Suggests a free name for a copy: "lan-to-wan" → "lan-to-wan-copy", and then "-copy2", "-copy3"…
 *
 * It never returns a name already on the device, because FortiOS answers a duplicate with `-5` and
 * the operator would have to work out what happened from a number.
 */
export const suggestCopyName = (name: string, taken: string[]): string => {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const base = (name.endsWith("-copy") ? name : `${name}-copy`).slice(0, POLICY_NAME_MAX);
  if (!used.has(base.toLowerCase())) return base;

  for (let i = 2; i < 100; i += 1) {
    const suffix = String(i);
    // Trim the BASE, not the number: "…-copy1" and "…-copy12" truncated from the right would
    // collide with each other, which is the one thing this function must not produce.
    const candidate = base.slice(0, POLICY_NAME_MAX - suffix.length) + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return base;
};

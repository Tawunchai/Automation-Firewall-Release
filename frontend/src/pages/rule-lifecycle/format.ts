import type { PolicyAdvice, PolicyState, PolicyUsage } from "../../api/lifecycle";

// Presentation rules for the Rule Lifecycle page.
//
// Split out of the component so they can be tested without rendering: these are the functions that
// turn a device's raw counters into the words an operator acts on, and getting one wrong (printing
// "-1 days", or calling a disabled rule dead) is exactly the kind of mistake that gets a live rule
// deleted.

export type StateStyle = {
  label: string;
  color: string;
  bg: string;
  border: string;
  /** One line on what the state means — shown in the legend, not on every row. */
  blurb: string;
};

export const STATE_STYLE: Record<PolicyState, StateStyle> = {
  "never-used": {
    label: "Never used",
    color: "#b91c1c",
    bg: "#ef444412",
    border: "#ef444440",
    blurb: "The device has counted no packet for this rule since the counters were reset",
  },
  stale: {
    label: "Stale",
    color: "#b45309",
    bg: "#f59e0b14",
    border: "#f59e0b45",
    blurb: "It carried traffic once, but has been silent for longer than the threshold",
  },
  disabled: {
    label: "Disabled",
    color: "#6b7280",
    bg: "#6b728012",
    border: "#6b728038",
    blurb: "Switched off — the counter is zero because it is disabled, not because nobody needs it",
  },
  idle: {
    label: "Idle",
    color: "#0369a1",
    bg: "#0ea5e912",
    border: "#0ea5e940",
    blurb: "Still carries traffic, just not in the past week",
  },
  active: {
    label: "Active",
    color: "#15803d",
    bg: "#22c55e12",
    border: "#22c55e40",
    blurb: "Carried traffic within the past week",
  },
};

export const ADVICE_LABEL: Record<PolicyAdvice, string> = {
  "": "",
  review: "Worth reviewing",
  remove: "Suggested for removal",
};

/**
 * Renders idle age as words.
 *
 * `idle_days` is -1 when the device has never counted a packet for the rule. That is a sentinel,
 * not a duration — printing "-1 วัน" on a page whose whole purpose is deciding what to delete would
 * undermine every other number on it.
 */
export function idleText(idleDays: number): string {
  if (idleDays < 0) return "Never used";
  if (idleDays === 0) return "Today";
  if (idleDays === 1) return "1 day ago";
  return `${idleDays} days ago`;
}

/** Human-readable byte counter. */
export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

/**
 * Sorts the cleanup backlog to the top.
 *
 * The server already returns rows in this order; re-applying it here keeps client-side filtering
 * from reshuffling them, and makes the ordering testable without a device.
 */
const STATE_RANK: Record<PolicyState, number> = {
  "never-used": 0,
  stale: 1,
  disabled: 2,
  idle: 3,
  active: 4,
};

export function sortByPriority(rows: PolicyUsage[]): PolicyUsage[] {
  return [...rows].sort((a, b) => {
    const ra = STATE_RANK[a.state] ?? 9;
    const rb = STATE_RANK[b.state] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.idle_days !== b.idle_days) return b.idle_days - a.idle_days;
    return a.policyid - b.policyid;
  });
}

/**
 * deleteRisk — the one line the delete dialog must show, or null when there is nothing to warn about.
 *
 * This page proposes deletions, and a delete on a live firewall cannot be taken back (the lab device
 * runs `cfg-save automatic` with no revision to roll back to). The badge in the row already says what
 * the rule's state is; this says what deleting it would COST, worst reason first:
 *
 *   1. counters unavailable — the whole page's judgement is void, so nothing here proves the rule is
 *      dead. This outranks everything, including a row that says "never used".
 *   2. live sessions — traffic is matching this rule RIGHT NOW; deleting it drops those flows.
 *   3. active / idle — it has matched traffic within the reporting window.
 *   4. disabled — its zero counters mean "switched off", not "unwanted"; someone parked it.
 *
 * A never-used or stale rule with no live sessions returns null: that is exactly the backlog this
 * page exists to clear, and warning on it would train people to click through every warning.
 */
export function deleteRisk(p: PolicyUsage, countersAvailable: boolean): string | null {
  if (!countersAvailable) {
    return "The device returned no hit counters, so this page cannot confirm the rule is unused — check it yourself before deleting";
  }
  if (p.active_sessions > 0) {
    return `${p.active_sessions} live session(s) currently match this rule — deleting it drops that traffic immediately`;
  }
  if (p.state === "active") {
    return "This rule carried traffic within the past week — it is still in use";
  }
  if (p.state === "idle") {
    return `This rule has carried traffic before (last used ${idleText(p.idle_days)}) — idle, not dead`;
  }
  if (p.state === "disabled") {
    return "This rule is disabled, so its counter is zero because it is off rather than unused — find out who disabled it and why";
  }
  return null;
}

/**
 * Normalises the device's weekly histogram to 0..1 for the sparkline.
 *
 * A flat all-zero week must render as a flat line at the bottom, not as a full-height bar — which
 * is what dividing by a zero max would produce.
 */
export function sparkline(weekHits: number[] | undefined): number[] {
  if (!weekHits || weekHits.length === 0) return [];
  const max = Math.max(...weekHits);
  if (max <= 0) return weekHits.map(() => 0);
  return weekHits.map((v) => v / max);
}

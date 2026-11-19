import type {
  NotifyChannel, NotifyKindInfo, NotifyRule, NotifySeverity,
} from "../../api/notify";

// The wording of Notify Management.
//
// Pulled out of the components because every one of these turns an internal number into a sentence
// somebody makes an operational decision on — "this fires after two minutes", "this rule reaches
// nobody" — and each of them is easy to get subtly wrong in a way no type checker would catch.

/** How long a threshold has to hold before the alert goes out, in words. */
export const sustainText = (polls: number, pollSeconds: number): string => {
  if (polls <= 1) return "fires on the first check";
  const seconds = polls * pollSeconds;
  if (seconds < 120) return `fires after ${polls} checks (${seconds}s)`;
  const minutes = Math.round(seconds / 60);
  return `fires after ${polls} checks (about ${minutes} min)`;
};

/** The gap between two repeat alerts for the same thing, in words. */
export const cooldownText = (minutes: number): string => {
  if (minutes <= 0) return "repeats every check";
  if (minutes < 60) return `repeats at most every ${minutes} min`;
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? hours : hours.toFixed(1);
  return `repeats at most every ${rounded} h`;
};

/** A rule's threshold with the unit its kind measures in. */
export const thresholdText = (rule: NotifyRule, kind?: NotifyKindInfo): string => {
  if (!kind?.has_threshold) return "—";
  const unit = kind.threshold_unit ?? "";
  const value = Number.isInteger(rule.threshold) ? String(rule.threshold) : rule.threshold.toFixed(1);
  return unit === "%" ? `≥ ${value}%` : `≥ ${value} ${unit}`.trim();
};

/** What a rule watches, in one phrase — used as the row's second line. */
export const scopeText = (rule: NotifyRule): string => {
  const where = rule.network_device_id === 0 ? "every device" : rule.device_name || "one device";
  const subjects = rule.subjects.trim();
  return subjects ? `${where} · ${subjects}` : where;
};

export const severityChip = (s: NotifySeverity | string): string => {
  switch (s) {
    case "critical": return "chip chip-danger";
    case "warning": return "chip chip-warn";
    default: return "chip chip-info";
  }
};

export const deliveryChip = (status: string): string => {
  switch (status) {
    case "sent": return "chip chip-ok";
    case "partial": return "chip chip-warn";
    case "failed": return "chip chip-danger";
    default: return "chip chip-warn"; // no-recipients — an alert that reached nobody is not neutral
  }
};

export const deliveryText = (status: string, delivered: number, failed: number): string => {
  switch (status) {
    case "sent": return `sent to ${delivered}`;
    case "partial": return `${delivered} sent, ${failed} failed`;
    case "failed": return `failed (${failed})`;
    default: return "no recipients";
  }
};

/**
 * Why a rule would not actually reach anybody, or "" when it would.
 *
 * This is the single most useful thing the rules list can say. A rule can be enabled, correct and
 * completely mute — because it has no recipient, or because its only channel has been switched off
 * — and there is no other moment when anyone would discover that. The page shows this instead of a
 * green tick, so the failure is visible before the outage rather than after it.
 */
export const muteReason = (rule: NotifyRule, channels: NotifyChannel[]): string => {
  if (!rule.enabled) return "";
  if (rule.recipients.length === 0) return "no recipient — this alert would reach nobody";

  const byID = new Map(channels.map((c) => [c.id, c]));
  const live = rule.recipients.filter((r) => {
    const ch = byID.get(r.notify_channel_id);
    return r.enabled && ch?.enabled;
  });
  if (live.length === 0) return "every recipient is disabled — this alert would reach nobody";

  const unusable = live.filter((r) => {
    const ch = byID.get(r.notify_channel_id);
    return ch?.type === "line" && !ch.has_token;
  });
  if (unusable.length === live.length) return "the LINE channel has no access token";

  return "";
};

/** Compact "3m ago" / "2h ago" for a history timestamp. */
export const agoText = (iso: string, now: Date = new Date()): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

/**
 * Groups the catalogue into the two families the picker shows.
 *
 * Order is fixed rather than derived from the response, so a new kind added on the server lands in
 * a predictable place instead of shuffling the form.
 */
export const groupKinds = (kinds: NotifyKindInfo[]): { title: string; hint: string; kinds: NotifyKindInfo[] }[] => [
  {
    title: "Link & reachability",
    hint: "State changes — a port, or the whole firewall",
    kinds: kinds.filter((k) => k.family === "link"),
  },
  {
    title: "Resource thresholds",
    hint: "A number crossing a line you set",
    kinds: kinds.filter((k) => k.family === "resource"),
  },
];

import type { TrafficLogRow } from "../../api/logs";
import {
  destinationEndpoint, displayCountry, formatApplication, formatBytes, policyVerdict, rowDirection,
  sourceEndpoint,
} from "./format";

// Turning a traffic log entry into the answers people open the log for.
//
// A row is a set of fields — srcip, dstport, action, policyid — and every one of them is correct and
// none of them is an answer. Somebody reading the log wants four things, and this module is where
// each comes from:
//
//   WHERE did it go          → the destination, by name first ("globallogctrl.fortinet.net"), then address
//   HOW                      → which service, which interface it arrived on and left by
//   WHAT HAPPENED            → one result in plain words (rowResult), not "server-rst"
//   WHY / WHICH POLICY       → the rule that claimed it, and what that rule's verdict means
//
// Everything is pure and computed from the rows already on the page. Nothing here reaches the
// device, and nothing here states more than the fields carry — a reset is "reset by the server",
// never "the server is down".

// ── The result of one entry ───────────────────────────────────────────────────

/**
 * What happened to a connection, in the terms that decide what to do next.
 *
 * `server-rst` and `deny` are both "it didn't work", and they send you to completely different
 * places: one is the far end refusing (nothing on this firewall to change), the other is this
 * firewall stopping it (a rule or a profile to look at). The kinds keep that apart.
 */
export type ResultKind =
  | "allowed"          // accept / start — permitted, still running when logged
  | "completed"        // close — permitted and finished normally
  | "client-reset"     // the source hung up with a reset — usually an app closing, harmless
  | "server-reset"     // the destination refused or dropped it — the far end, not the firewall
  | "timeout"          // permitted, then went quiet until the session expired
  | "blocked-implicit" // no rule matched: the implicit deny
  | "blocked-rule"     // a rule matched and its action is deny
  | "blocked-profile"  // a rule allowed it and a security profile stopped it
  | "blocked"          // stopped, without a rule to name (local-in, unknown)
  | "other";

/** The three groups the charts and the "Show" switch use. */
export type ResultGroup = "ok" | "problem" | "blocked";

export type RowResult = {
  kind: ResultKind;
  group: ResultGroup;
  /** Short, for a chip: "Reset by the server". */
  label: string;
  /** One sentence: why, and what it means for whoever is reading. */
  why: string;
};

export const GROUP_LABEL: Record<ResultGroup, string> = {
  ok: "Allowed",
  problem: "Reset or timed out",
  blocked: "Blocked",
};

/** The chip class for a group — role, not colour. */
export const GROUP_CHIP: Record<ResultGroup, string> = {
  ok: "chip chip-ok",
  problem: "chip chip-warn",
  blocked: "chip chip-danger",
};

export function rowResult(row: TrafficLogRow): RowResult {
  const v = policyVerdict(row);
  if (v.blocked) {
    switch (v.by) {
      case "implicit-deny":
        return {
          kind: "blocked-implicit", group: "blocked", label: "Blocked — no rule matched",
          why: "No policy permits this traffic, so the implicit deny at the bottom of the policy table dropped it. To allow it, a policy has to be written for it.",
        };
      case "policy":
        return {
          kind: "blocked-rule", group: "blocked", label: "Blocked by a policy",
          why: "A policy matched this traffic and its action is deny. To allow it, change that policy or put an allowing one above it.",
        };
      case "security-profile":
        return {
          kind: "blocked-profile", group: "blocked", label: "Blocked by a security profile",
          why: "The policy that matched allows this traffic — a security profile on it (Web Filter, Application Control, AntiVirus, IPS) stopped it. The policy itself is fine; the profile is what decided.",
        };
      case "local-in":
        return {
          kind: "blocked", group: "blocked", label: "Blocked",
          why: "Traffic to the FortiGate itself was refused — by a local-in policy or by the interface's administrative access settings.",
        };
      default:
        return { kind: "blocked", group: "blocked", label: "Blocked", why: "The firewall stopped this traffic." };
    }
  }

  switch (row.action.toLowerCase()) {
    case "server-rst":
      return {
        kind: "server-reset", group: "problem", label: "Reset by the server",
        why: "The connection was let through and the destination closed it abruptly. That is the far end refusing or dropping it — nothing on this firewall blocked it.",
      };
    case "client-rst":
      return {
        kind: "client-reset", group: "ok", label: "Closed by the client",
        why: "The source ended the connection with a reset. Usually harmless — an app or browser closing a connection it no longer needs.",
      };
    case "timeout":
      return {
        kind: "timeout", group: "problem", label: "Timed out",
        why: "The connection was let through, then got no answer or sat idle until the session timer expired. Often the destination is unreachable or not responding.",
      };
    case "close":
    case "closed":
      return {
        kind: "completed", group: "ok", label: "Completed",
        why: "The connection was let through and finished normally.",
      };
    case "accept":
    case "start":
      return {
        kind: "allowed", group: "ok", label: "Allowed",
        why: "The connection was let through.",
      };
    default:
      return { kind: "other", group: "ok", label: row.action || "—", why: "" };
  }
}

// ── Names ─────────────────────────────────────────────────────────────────────

/** "The FortiGate" when the unit sent it itself, otherwise the source address. */
export function sourceLabel(row: TrafficLogRow): string {
  if (rowDirection(row) !== "inbound") return "The FortiGate";
  const ep = sourceEndpoint(row);
  return ep.name ? `${ep.name} (${ep.ip})` : ep.ip;
}

/** The destination by name when there is one — that is what a reader recognises. */
export function destinationLabel(row: TrafficLogRow): string {
  if (rowDirection(row) === "loopback") return "the FortiGate itself";
  const ep = destinationEndpoint(row);
  return ep.name || ep.ip;
}

/** "HTTPS (TCP/443)", "NTP (UDP/123)", "ICMP". */
export function serviceLabel(row: TrafficLogRow): string {
  const name = formatApplication(row);
  const port = row.dstport !== null && row.dstport !== undefined ? `${row.proto_name}/${row.dstport}` : row.proto_name;
  if (!name) return port || "—";
  if (!port || name.toLowerCase() === port.toLowerCase()) return name;
  return `${name} (${port})`;
}

/**
 * The interfaces a connection crossed, as "port5 → wan1".
 *
 * Traffic the FortiGate sends itself arrives on no interface — its `srcintf` is the VDOM name
 * ("root"), which reads as an interface called root. That side is dropped: "→ port1".
 */
export function interfacePath(row: TrafficLogRow): string {
  const from = row.srcintf && row.srcintf !== row.vd ? row.srcintf : "";
  const to = row.dstintf && row.dstintf !== row.vd ? row.dstintf : "";
  if (from && to) return from === to ? from : `${from} → ${to}`;
  if (to) return `→ ${to}`;
  return from;
}

// ── The story of one entry ────────────────────────────────────────────────────

/**
 * The entry as sentences: who went where, how, which rule decided, what happened, how much moved.
 *
 * Built as whole sentences with the values dropped into them, never as fragments glued together:
 * the console translates a sentence, and a sentence assembled from pieces has no entry to match.
 */
export function storyOf(row: TrafficLogRow): string[] {
  const dir = rowDirection(row);
  const dst = destinationEndpoint(row);
  // The country goes INSIDE the brackets with the address. As "… in United States" the English
  // "in" would sit inside a translated sentence's placeholder, untranslated, in Thai and Chinese.
  const country = displayCountry(row.dstcountry);
  const detail = country ? `${dst.ip}, ${country}` : dst.ip;
  const target = dst.name ? `${dst.name} (${detail})` : country ? `${dst.ip} (${country})` : dst.ip;
  const service = serviceLabel(row);
  const out: string[] = [];

  if (dir === "local-out") {
    out.push(row.dstintf
      ? `The FortiGate itself connected to ${target} using ${service}, leaving through ${row.dstintf}.`
      : `The FortiGate itself connected to ${target} using ${service}.`);
  } else if (dir === "loopback") {
    out.push(`The FortiGate talked to itself using ${service} (loopback).`);
  } else if (row.dstintf && row.dstintf !== row.vd) {
    out.push(`${sourceLabel(row)} connected to ${target} using ${service}, arriving on ${row.srcintf || "—"} and leaving through ${row.dstintf}.`);
  } else {
    out.push(`${sourceLabel(row)} connected to the FortiGate itself using ${service}, arriving on ${row.srcintf || "—"}.`);
  }

  const v = policyVerdict(row);
  switch (v.by) {
    case "local-out":
      out.push("Traffic the FortiGate sends itself is never checked against the policy table, so no policy decided this.");
      break;
    case "local-in":
      out.push("It was addressed to the FortiGate itself, so the implicit local-in policy handled it rather than a firewall policy.");
      break;
    case "implicit-deny":
      out.push("No policy matched it, so the implicit deny at the bottom of the policy table applied.");
      break;
    case "unknown":
      out.push("The log does not say which policy handled it.");
      break;
    default:
      out.push(v.missing
        ? `Policy ${v.label} handled it — that policy has since been deleted or renumbered.`
        : `Policy ${v.label} handled it.`);
  }

  const result = rowResult(row);
  if (result.why) out.push(result.why);

  if (!row.sentbyte && !row.rcvdbyte) {
    out.push("No data was exchanged.");
  } else {
    out.push(row.duration > 0
      ? `It sent ${formatBytes(row.sentbyte)} and received ${formatBytes(row.rcvdbyte)} over ${row.duration} s.`
      : `It sent ${formatBytes(row.sentbyte)} and received ${formatBytes(row.rcvdbyte)}.`);
  }
  return out;
}

// ── Search terms ──────────────────────────────────────────────────────────────

/** A search term the device will honour — see services/fortigate_logsearch.go. */
export function term(field: string, value: string | number): string {
  const v = String(value);
  return `${field}==${/\s/.test(v) ? `"${v}"` : v}`;
}

// ── Conversations ─────────────────────────────────────────────────────────────

/**
 * Many entries that are the same conversation, as one line.
 *
 * A Local Traffic log is mostly the same few exchanges repeated — the lab unit's 200 entries are
 * about a dozen conversations with FortiGuard, NTP and itself. Reading them as 200 rows hides that;
 * reading them as a dozen lines is the answer to "where is this traffic going".
 */
export type Conversation = {
  key: string;
  source: string;
  destination: string;
  /** Shown under a destination NAME: one name can front several addresses, each its own line. */
  destinationIp: string;
  country: string;
  service: string;
  /** "port1 → wan1", or "" when the path is not two interfaces. */
  path: string;
  /** The rule that decided, or how it was handled when no rule did. */
  policy: string;
  count: number;
  bytes: number;
  last: number;
  byGroup: Record<ResultGroup, number>;
  /** The most frequent result, for the line's chip. */
  result: RowResult;
  /** The search that shows exactly these entries. */
  pivot: string;
};

export function conversations(rows: TrafficLogRow[]): Conversation[] {
  const acc = new Map<string, Conversation & { results: Map<ResultKind, { r: RowResult; n: number }> }>();
  for (const row of rows) {
    const port = row.dstport ?? "";
    const verdict = policyVerdict(row);
    const key = `${row.srcip}|${row.dstip}|${row.proto}|${port}|${verdict.label}`;
    let c = acc.get(key);
    if (!c) {
      const terms = [row.srcip && term("srcip", row.srcip), row.dstip && term("dstip", row.dstip),
        row.dstport !== null && row.dstport !== undefined ? term("dstport", row.dstport) : ""].filter(Boolean);
      c = {
        key,
        source: sourceLabel(row),
        destination: destinationLabel(row),
        country: displayCountry(row.dstcountry),
        service: serviceLabel(row),
        destinationIp: row.dstip,
        path: interfacePath(row),
        policy: verdict.by === "local-out" ? "No policy (sent by the FortiGate)" : verdict.label,
        count: 0, bytes: 0, last: 0,
        byGroup: { ok: 0, problem: 0, blocked: 0 },
        result: rowResult(row),
        pivot: terms.join(" "),
        results: new Map(),
      };
      acc.set(key, c);
    }
    const r = rowResult(row);
    c.count += 1;
    c.bytes += (row.sentbyte || 0) + (row.rcvdbyte || 0);
    c.last = Math.max(c.last, row.timestamp);
    c.byGroup[r.group] += 1;
    const seen = c.results.get(r.kind) ?? { r, n: 0 };
    seen.n += 1;
    c.results.set(r.kind, seen);
  }
  return [...acc.values()]
    .map(({ results, ...c }) => ({
      ...c,
      // The line's headline result is the worst one present, not the most common: one blocked
      // attempt among ten completed ones is the thing to see.
      result: pickHeadline([...results.values()]),
    }))
    .sort((a, b) => b.count - a.count || b.last - a.last);
}

const SEVERITY: Record<ResultGroup, number> = { blocked: 0, problem: 1, ok: 2 };

function pickHeadline(results: { r: RowResult; n: number }[]): RowResult {
  return results.sort((a, b) => SEVERITY[a.r.group] - SEVERITY[b.r.group] || b.n - a.n)[0].r;
}

// ── Time ──────────────────────────────────────────────────────────────────────

export type TimeBucket = { at: number; ok: number; problem: number; blocked: number };

/**
 * The entries spread over their own time span, split by result group.
 *
 * A fixed number of buckets across whatever span the rows cover, so a two-minute burst and a
 * seven-day window read the same way. A flat line and a spike are different facts, and the table
 * shows neither.
 */
export function timeBuckets(rows: TrafficLogRow[], count = 24): TimeBucket[] {
  if (!rows.length) return [];
  let from = Infinity;
  let to = -Infinity;
  for (const r of rows) {
    if (r.timestamp < from) from = r.timestamp;
    if (r.timestamp > to) to = r.timestamp;
  }
  const width = Math.max(1, (to - from) / count);
  const out: TimeBucket[] = Array.from({ length: count }, (_, i) => ({ at: from + i * width, ok: 0, problem: 0, blocked: 0 }));
  for (const r of rows) {
    const i = Math.min(count - 1, Math.max(0, Math.floor((r.timestamp - from) / width)));
    out[i][rowResult(r).group] += 1;
  }
  return out;
}

/** Top destinations, split by result group — the "where does it go" chart. */
export type DestinationBar = { key: string; label: string; ok: number; problem: number; blocked: number; total: number; pivot: string };

export function topDestinations(rows: TrafficLogRow[], n = 8): DestinationBar[] {
  const acc = new Map<string, DestinationBar>();
  for (const r of rows) {
    if (!r.dstip) continue;
    const bar = acc.get(r.dstip) ?? {
      key: r.dstip, label: destinationLabel(r), ok: 0, problem: 0, blocked: 0, total: 0, pivot: term("dstip", r.dstip),
    };
    bar[rowResult(r).group] += 1;
    bar.total += 1;
    acc.set(r.dstip, bar);
  }
  const top = [...acc.values()].sort((a, b) => b.total - a.total).slice(0, n);
  // One name can front several addresses (FortiGuard does); disambiguate only where labels collide,
  // since the key — what a click filters on — is the address either way.
  const seen = new Map<string, number>();
  for (const t of top) seen.set(t.label, (seen.get(t.label) ?? 0) + 1);
  return top.map((t) => (seen.get(t.label)! > 1 && t.label !== t.key ? { ...t, label: `${t.label} · ${t.key}` } : t));
}

/** Filters rows by the "Show" switch. `all` returns the same array. */
export function filterByGroup(rows: TrafficLogRow[], show: ResultGroup | "all"): TrafficLogRow[] {
  return show === "all" ? rows : rows.filter((r) => rowResult(r).group === show);
}

// ── Clock labels ──────────────────────────────────────────────────────────────

/**
 * An instant as the DEVICE's wall clock — "14:05", or "Sep 8 14:05" when the span crosses days.
 *
 * The table shows the firewall's own time (its `date`/`time` strings), so the chart's axis must
 * too, or a bar labelled 14:00 would sit over rows stamped 07:00. `tz` is the device's offset as
 * the log writes it ("-0700"); without one, the viewer's clock is the fallback.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function deviceClock(ms: number, tz: string, withDate: boolean): string {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz || "");
  let d: Date;
  let get: (k: "h" | "m" | "mo" | "d") => number;
  if (m) {
    const offset = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    d = new Date(ms + offset * 60_000);
    get = (k) => (k === "h" ? d.getUTCHours() : k === "m" ? d.getUTCMinutes() : k === "mo" ? d.getUTCMonth() : d.getUTCDate());
  } else {
    d = new Date(ms);
    get = (k) => (k === "h" ? d.getHours() : k === "m" ? d.getMinutes() : k === "mo" ? d.getMonth() : d.getDate());
  }
  const hm = `${String(get("h")).padStart(2, "0")}:${String(get("m")).padStart(2, "0")}`;
  return withDate ? `${MONTHS[get("mo")]} ${get("d")} ${hm}` : hm;
}

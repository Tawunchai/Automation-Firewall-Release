import type { LogGates, LogSource, TrafficLogRow } from "../../api/logs";
import { countryCode, flagEmoji } from "../../lib/countries";

// How a FortiGate log row is turned into the six columns the device's own log view shows.
//
// Pure functions in their own file, with tests, because this is where a log view actually goes
// wrong: not in fetching the rows but in what it decides they mean. A port rendered as `:0`, a
// byte count rounded into a different unit, "no application" shown as an empty cell where the
// device would show the service — each is a small lie about a security record, and none of them
// needs a firewall to reproduce.

// ── Bytes ─────────────────────────────────────────────────────────────────────

/**
 * Bytes, in FortiOS's own units.
 *
 * ⚠️ BASE 1000, NOT 1024, and that is measured rather than assumed. Five rows read off the device's
 * own log view beside the raw byte counts it served over the API:
 *
 *      2332 B  →  "2.33 kB"     2332/1000 = 2.332      (1024 would give 2.28)
 *      1603 B  →  "1.60 kB"     1603/1000 = 1.603      (1024 would give 1.57)
 *     37409 B  →  "37.41 kB"   37409/1000 = 37.409     (1024 would give 36.5)
 *      4115 B  →  "4.12 kB"
 *      9557 B  →  "9.56 kB"
 *
 * Always two decimals from kB up — 37.41, not 37.4 — and a plain integer below 1 kB, where the
 * device prints "462 B" and "240 B".
 *
 * Matching this exactly matters more than picking a tidier scheme: an operator comparing this page
 * against the firewall's own screen should read the same number off both. A 1024-based column is
 * not wrong by a rounding hair, it is wrong by 7% on every row, which looks like a different
 * measurement rather than a different convention.
 *
 * 0 renders as "0 B" rather than a dash. A traffic log row with zero bytes is a real, common
 * observation — a denied SYN transfers nothing — and it is not the same as a missing value.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${Math.round(bytes)} B`;

  const units = ["kB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

/**
 * The "Sent / Received" column: two byte counts, in the device's order.
 *
 * BLANK when both are zero, which is what FortiOS's own log view shows. A denied SYN moves nothing
 * in either direction, and the lab buffer is full of them; printing "0 B / 0 B" down fifteen rows
 * is noise that reads like a measurement. One side at zero is still shown — "2.28 kB / 0 B" says
 * something real, that the far end never answered.
 */
export function formatSentReceived(row: TrafficLogRow): string {
  if (!row.sentbyte && !row.rcvdbyte) return "";
  return `${formatBytes(row.sentbyte)} / ${formatBytes(row.rcvdbyte)}`;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/** An address and its port, as one string. */
export type Endpoint = {
  /** The address itself, always present. */
  ip: string;
  /** `ip:port`, or just the address when the protocol has no ports. */
  address: string;
  /**
   * A name for the address, shown in brackets after it exactly as FortiOS does.
   *
   * Either the name the FIREWALL recorded at the time (`srcname`/`dstname`) or, failing that, the
   * reverse-DNS lookup the device performed for this query (`srchost`/`dsthost`). The recorded one
   * wins: it is what was true when the packet passed, whereas a lookup done now can disagree with
   * it, and on a log the historical answer is the honest one.
   */
  name: string;
  /** Country, when the device geolocated it. FortiOS's "Reserved" is dropped — see below. */
  country: string;
  /**
   * The country's flag, or "" for an address with no real country.
   *
   * An emoji rather than an image: the console ships no flag sprites, and where a platform has no
   * flag glyph (Windows is the common one) the pair of regional-indicator letters renders instead —
   * "US", "CA" — which is still the country, just spelled rather than drawn.
   */
  flag: string;
};

/**
 * `Reserved` is what FortiOS calls an RFC1918 address it will not geolocate, and it appears on
 * every row of a Local Traffic log on a lab network. It is noise, not information, so it is
 * dropped rather than rendered as if it were a country.
 */
const NON_COUNTRIES = new Set(["Reserved", "reserved", "N/A", ""]);

/** Country, or "" when the device did not really name one. */
export function displayCountry(country: string): string {
  return NON_COUNTRIES.has(country) ? "" : country;
}

/**
 * Formats one side of a connection.
 *
 * ⚠️ THE PORT MUST BE ABSENT, NOT ZERO. FortiOS omits `srcport`/`dstport` entirely on a protocol
 * that has none — an ICMP row has neither — so the API layer carries them as `number | null` and
 * this checks for null rather than falsiness. Rendering `10.0.99.201:0` would put a port on the
 * wire that was never there, and port 0 is additionally a real (if unusual) value, so the two
 * cases cannot be collapsed.
 */
export function formatEndpoint(ip: string, port: number | null, name: string, country: string): Endpoint {
  const address = port === null || port === undefined ? ip : `${ip}:${port}`;
  const shown = displayCountry(country);
  const code = shown ? countryCode(shown) : "";
  return { ip, address, name: name || "", country: shown, flag: code ? flagEmoji(code) : "" };
}

export const sourceEndpoint = (row: TrafficLogRow): Endpoint =>
  formatEndpoint(row.srcip, row.srcport, row.srcname || row.srchost || "", row.srccountry);

export const destinationEndpoint = (row: TrafficLogRow): Endpoint =>
  formatEndpoint(row.dstip, row.dstport, row.dstname || row.dsthost || "", row.dstcountry);

// ── Device ────────────────────────────────────────────────────────────────────

/**
 * The "Device" column: WHICH MACHINE the connection came from, as FortiOS identifies it.
 *
 * The MAC leads, and that is what the device's own log view shows — a row whose source carries
 * both `devtype: "Router"` and `srcmac: 00:09:0f:09:00:00` renders as the MAC. The reason is that
 * this column answers "which box", and a classification ("Router") is not an identity: every
 * router on the segment shares it. The MAC is the identity, and it is what an operator takes to
 * the switch to find the port.
 *
 * A name wins over the MAC when the firewall has one, because a name is a better identity still.
 * The classification falls to the second line (formatDeviceDetail).
 *
 * EMPTY IS A LEGITIMATE ANSWER and a common one here: traffic the FortiGate originates itself has
 * no source MAC at all, so those rows leave the column blank, exactly as the device's log does.
 * Falling back to the IP would repeat the Source column and imply an identification that never
 * happened.
 */
export function formatDevice(row: TrafficLogRow): string {
  return row.srcname || row.srcmac || row.mastersrcmac || row.devtype || row.srchwvendor || "";
}

/**
 * The second line under Device: what KIND of machine it is, once the line above has said which.
 *
 * Skipped when the line above is already showing the classification — there is no point printing
 * "Router" twice — and when the OS says the same thing as the type.
 */
export function formatDeviceDetail(row: TrafficLogRow): string {
  const shown = formatDevice(row);
  const parts = [row.devtype, row.osname, row.srchwvendor].filter(
    (v, i, all) => v && v !== shown && all.indexOf(v) === i,
  );
  return parts.slice(0, 2).join(" · ");
}

// ── Application ───────────────────────────────────────────────────────────────

/**
 * The "Application Name" column.
 *
 * `app` is what Application Control identified. Without an application sensor on the policy the
 * field is often absent, and FortiOS then shows the SERVICE — the port-based name it always knows
 * ("HTTPS", "PING"). Falling through to it is what the device does, and it keeps the column
 * meaningful on a firewall with no app control licensed, which is the lab's situation.
 *
 * The last resort is the protocol name, so a row of raw ESP or OSPF still says what it was.
 */
export function formatApplication(row: TrafficLogRow): string {
  return row.app || row.service || row.proto_name || "";
}

/**
 * True when the name shown came from the service rather than from Application Control.
 *
 * The column then reads as a port-based guess, not an identification, and the UI marks it — the
 * difference matters when someone is deciding whether an app sensor is working.
 */
export function applicationIsService(row: TrafficLogRow): boolean {
  return !row.app && Boolean(row.service);
}

// ── Action ────────────────────────────────────────────────────────────────────

/** How an action should read on screen: its role, not a colour. */
export type ActionTone = "allowed" | "blocked" | "closed" | "neutral";

/**
 * Classifies a traffic log action.
 *
 * The full set seen on the lab device in one afternoon is wider than allow/deny, and lumping the
 * rest into either bucket would misreport them:
 *
 *   accept                    the firewall permitted it
 *   deny / block / drop       the firewall stopped it
 *   close                     permitted, and finished normally
 *   client-rst / server-rst   permitted, and one END reset it — NOT a firewall block
 *   timeout                   permitted, and it expired
 *
 * `client-rst` is the one that matters: it is by far the most common action on a Local Traffic
 * log, it means the client hung up, and painting it red would have an operator hunting for a
 * firewall rule that blocked nothing.
 */
export function actionTone(action: string): ActionTone {
  switch (action.toLowerCase()) {
    case "accept":
    case "start":
      return "allowed";
    case "deny":
    case "block":
    case "drop":
    case "blocked":
      return "blocked";
    case "close":
    case "client-rst":
    case "server-rst":
    case "timeout":
      return "closed";
    default:
      return "neutral";
  }
}

/** The chip class for an action, from the design system's role vocabulary. */
export function actionChipClass(action: string): string {
  switch (actionTone(action)) {
    case "allowed":
      return "chip chip-ok";
    case "blocked":
      return "chip chip-danger";
    case "closed":
      return "chip";
    default:
      return "chip";
  }
}

// ── Time ──────────────────────────────────────────────────────────────────────

/**
 * The "Date/Time" column, in the DEVICE's own timezone.
 *
 * Built from the `date` and `time` strings the firewall already formatted, never re-derived from
 * the epoch. The device is on -0700 while the browser showing this may be on +0700; recomputing
 * would relabel every row with the viewer's clock and disagree with the same entry read over SSH
 * or shown in the FortiGate GUI. A log is a record of when the DEVICE saw something.
 */
export function formatLogTime(row: TrafficLogRow): string {
  if (!row.date && !row.time) return "";
  // Slashes, because that is how FortiOS prints a log date — 2026/08/26, not 2026-08-26. The
  // device sends the ISO form and renders the other, and matching the rendering is what lets
  // someone compare this table against the firewall's own screen line for line.
  return `${row.date.replace(/-/g, "/")} ${row.time}`.trim();
}

/**
 * How long ago, measured against the FIREWALL's clock rather than the browser's.
 *
 * `device_now` comes back on every log response for exactly this. The lab device's clock and the
 * container's are minutes apart, so "2 minutes ago" computed from Date.now() would drift — and
 * on the 1-hour window it could read "62 minutes ago" for a row the window just included.
 */
export function formatRelative(timestamp: number, deviceNow: number): string {
  if (!timestamp || !deviceNow) return "";
  const seconds = Math.round((deviceNow - timestamp) / 1000);
  // A row can be a second or two "in the future" when the device writes the entry just after it
  // reports its clock. That is not worth showing as a negative age.
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── The source picker ─────────────────────────────────────────────────────────

/**
 * Which log backends belong in the picker.
 *
 * Available AND enabled, which is what FortiOS itself offers: the lab device reports FortiAnalyzer
 * as available but not enabled, and its GUI's picker shows only Memory and FortiGate Cloud. An
 * entry for a backend that is off would query a collector this unit is not sending to, and answer
 * with an empty log that means nothing.
 */
export function selectableSources(sources: LogSource[]): LogSource[] {
  return sources.filter((s) => s.available && s.enabled);
}

// ── Why a log is empty ────────────────────────────────────────────────────────

/** One reason the Local Traffic log has no rows, with the CLI that changes it. */
export type EmptyReason = {
  title: string;
  detail: string;
  /** The exact commands, ready to paste into Config Deploy or an SSH session. */
  cli: string[];
};

/**
 * Turns the two gate readings into an explanation, or null when they do not explain anything.
 *
 * FortiOS shows "No results" here and says nothing more, which leaves an operator unable to tell
 * a quiet firewall from one that was told not to write anything down. Both gates are off by
 * DEFAULT, so this is the normal state of a fresh device rather than an exotic misconfiguration —
 * which is precisely why the page has to say so.
 */
export function explainEmpty(gates: LogGates | undefined, sourceLabel: string): EmptyReason | null {
  if (!gates) return null;

  const recording =
    gates.local_in_allow ||
    gates.local_in_deny_unicast ||
    gates.local_in_deny_broadcast ||
    gates.local_out;

  if (!recording) {
    return {
      title: "This firewall is not recording local traffic",
      detail:
        "Traffic addressed to the FortiGate itself is only logged when local-in logging is switched on, and it is off by default. Nothing is being written, so there is nothing for any log backend to show.",
      cli: [
        "config log setting",
        "    set local-in-allow enable",
        "    set local-in-deny-unicast enable",
        "end",
      ],
    };
  }

  // `source_accepts_local` is null when the backend keeps no filter table here — never claim a
  // misconfiguration on the strength of a table that could not be read.
  if (gates.source_accepts_local === false) {
    const path = gates.source_filter_path || "log.memory";
    return {
      title: `${sourceLabel} is set to discard local traffic`,
      detail:
        "The firewall is recording local traffic, but this log backend has the category filtered out, so none of it is kept here. Another backend may still have it — try the log source picker.",
      cli: [`config ${path.replace(".", " ")} filter`, "    set local-traffic enable", "end"],
    };
  }

  return null;
}

/**
 * The half of local logging that is on, as a sentence — shown when the log is empty but correctly
 * configured, so "nothing happened" is a conclusion rather than a shrug.
 */
export function describeRecording(gates: LogGates | undefined): string {
  if (!gates) return "";
  const on: string[] = [];
  if (gates.local_in_allow) on.push("accepted inbound");
  if (gates.local_in_deny_unicast) on.push("denied unicast");
  if (gates.local_in_deny_broadcast) on.push("denied broadcast");
  if (gates.local_out) on.push("firewall-originated");
  if (on.length === 0) return "";
  return `Recording: ${on.join(", ")}`;
}

// ── Which rule claimed the packet, and what that means ────────────────────────

/**
 * What the Policy column says about one entry.
 *
 * This is the column somebody opens the log FOR. "Why can't I get online" and "why won't YouTube
 * load" both reduce to one question — which rule claimed the packet — and the log answers it with
 * a bare number that means nothing until it is resolved and interpreted.
 */
export type PolicyVerdict = {
  /** The cell's main line: "#8 Block-FB-YT-172.16.100.123", "Implicit deny", "—". */
  label: string;
  /**
   * What actually decided the outcome. The distinction the whole column exists to draw:
   *
   *   implicit-deny     nothing matched — no rule permits this traffic at all
   *   policy            a rule matched and denied it
   *   security-profile  a rule PERMITTED it and a UTM sensor stopped it anyway
   *   allowed           it went through
   *   local-in          traffic to the firewall itself; there is no rule table to look at
   *   local-out         the FIREWALL sent it. No policy decided anything — see below
   *   unknown           the device did not say
   */
  by: "implicit-deny" | "policy" | "security-profile" | "allowed" | "local-in" | "local-out"
    | "unknown";
  /** True when the rule id no longer resolves — deleted or renumbered since the entry was written. */
  missing: boolean;
  /** True when this entry is worth someone's attention: traffic that did not get through. */
  blocked: boolean;
};

/** Actions that mean the firewall stopped the traffic, as opposed to it finishing or being reset. */
const BLOCKING_ACTIONS = new Set(["deny", "block", "drop", "blocked"]);

/**
 * True when the FIREWALL ITSELF sent this packet — local-out traffic.
 *
 * `srcintf` naming the VDOM rather than an interface means the packet arrived on no interface,
 * which is to say it did not arrive: the unit originated it. On the lab FGT80E every such row is
 * the device calling FortiGuard, NTP or its own DNS, and the source address is the unit's own.
 *
 * This is worth separating because it is most of what a Local Traffic log contains and because
 * NOTHING IN THE POLICY TABLE DECIDED IT. Local-out traffic is not matched against the rule base
 * at all, so any policy verdict on these rows — permitted, denied, implicit anything — is a claim
 * about a decision that was never made.
 *
 * Falsifier: a row where the firewall is the source but `srcintf` names a real interface would
 * read as ordinary inbound traffic here. None was seen on the lab unit, and the reading is the
 * field's own meaning rather than a heuristic over it.
 */
export type Direction =
  /** The FortiGate sent it. Never matched against the policy table. */
  | "local-out"
  /** It arrived on an interface and was addressed to the FortiGate. */
  | "inbound"
  /** The unit talking to itself — 127.0.0.1, its own daemons. */
  | "loopback";

export function rowDirection(row: TrafficLogRow): Direction {
  if (!row.vd) return "inbound";
  const fromDevice = row.srcintf === row.vd;
  const toDevice = row.dstintf === row.vd;
  if (fromDevice && toDevice) return "loopback";
  return fromDevice ? "local-out" : "inbound";
}

function isLocalOut(row: TrafficLogRow): boolean {
  return rowDirection(row) === "local-out";
}

/**
 * Reads one row's policy fields into something the column can render.
 *
 * THE THREE CASES THAT MATTER, and why they must not be collapsed:
 *
 *   1. BLOCKED BY THE IMPLICIT DENY — `policyid: 0` on forward traffic. No rule permits this, and
 *      the fix is to write one. This is the single most common answer to "I can't get online",
 *      and rendering it as "policy 0" sends someone hunting for a rule that does not exist.
 *
 *   2. BLOCKED BY A NAMED RULE — the rule is there and it says deny. The fix is to edit or reorder
 *      it, and the name is the whole answer.
 *
 *   3. PERMITTED BY THE RULE, STOPPED BY A PROFILE — the row's action is a block while the RULE's
 *      configured action is accept. That means a Web Filter, Application Control or AntiVirus
 *      sensor made the decision, not the rule. This is the YouTube case exactly, and it is the one
 *      people waste the most time on: the policy looks correct because it IS correct, and editing
 *      it changes nothing.
 */
export function policyVerdict(row: TrafficLogRow): PolicyVerdict {
  const ref = row.policy;
  const stopped = BLOCKING_ACTIONS.has(row.action.toLowerCase());

  if (!ref || row.policyid === null || row.policyid === undefined) {
    return { label: "—", by: "unknown", missing: false, blocked: stopped };
  }

  if (ref.implicit) {
    // The firewall's own outbound traffic never met the rule base, so it has no verdict to report.
    if (isLocalOut(row)) {
      return { label: "Local out", by: "local-out", missing: false, blocked: false };
    }
    // policyid 0 is two different rules, and getting it wrong either invents a blocked connection
    // or hides a real one. The SERVER decides which, because it knows the log being read; this
    // used to be re-derived here from a `policytype` the device does not always send, and the
    // result was every row in the Local Traffic log painted red as "no rule matched".
    if (ref.local_in ?? row.policytype === "local-in-policy") {
      return { label: "Implicit local-in", by: "local-in", missing: false, blocked: stopped };
    }
    return { label: "Implicit deny", by: "implicit-deny", missing: false, blocked: true };
  }

  const label = `#${row.policyid}${ref.name ? ` ${ref.name}` : ""}`;

  if (!ref.exists) {
    return { label, by: stopped ? "policy" : "allowed", missing: true, blocked: stopped };
  }
  if (stopped) {
    // The rule permits it but the traffic was stopped → something above the rule did it.
    const by = ref.action === "accept" ? "security-profile" : "policy";
    return { label, by, missing: false, blocked: true };
  }
  return { label, by: "allowed", missing: false, blocked: false };
}

/** The chip class for a verdict — role, not colour. */
export function verdictChipClass(v: PolicyVerdict): string {
  if (v.missing) return "chip chip-warn";
  switch (v.by) {
    case "implicit-deny":
    case "policy":
      return "chip chip-danger";
    case "security-profile":
      return "chip chip-warn";
    default:
      return "chip";
  }
}

// ── Paging ────────────────────────────────────────────────────────────────────

/**
 * Rows per page.
 *
 * The server already hands over up to 200 filtered rows in one read, so paging happens HERE, over
 * what is already in memory — pressing Next costs nothing and returns instantly, where paging on
 * the device would be a round trip to a firewall for every click.
 *
 * It also has to be that way round: the device does not filter by subcategory (see
 * services/fortigate_log.go), so the server drops rows after fetching them. Asking the device for
 * "rows 20-40" would return a window of the UNFILTERED buffer, and the page sizes would come out
 * ragged — 20 rows on one page, 6 on the next, with no gap visible to explain it.
 */
export const ROWS_PER_PAGE = 20;

/** How many pages a row count needs. Always at least 1, so an empty log still has a page 1. */
export function pageCount(total: number, perPage: number = ROWS_PER_PAGE): number {
  if (total <= 0 || perPage <= 0) return 1;
  return Math.ceil(total / perPage);
}

/**
 * Keeps a page index inside the range a row count allows.
 *
 * Load-bearing rather than defensive: the row count changes under the reader constantly — a search
 * is applied, the time window narrows, a refresh finds fewer entries in the ring buffer. Landing on
 * "page 5 of 2" would render an empty table that looks exactly like "the firewall saw nothing",
 * which on this page is the one thing that must never be shown by accident.
 */
export function clampPage(index: number, total: number, perPage: number = ROWS_PER_PAGE): number {
  const last = pageCount(total, perPage) - 1;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.trunc(index), last);
}

/** The slice of rows on one page. */
export function pageSlice<T>(rows: T[], index: number, perPage: number = ROWS_PER_PAGE): T[] {
  const safe = clampPage(index, rows.length, perPage);
  return rows.slice(safe * perPage, safe * perPage + perPage);
}

/** What the footer counts: the 1-based span on screen, and the whole. */
export type PageRange = { from: number; to: number; total: number };

/**
 * The "1–20 of 34" line.
 *
 * 1-based and inclusive, because it is read by a person rather than by an array. An empty log
 * reports 0–0 of 0 rather than "1–0", which would look like a rendering fault.
 */
export function pageRange(total: number, index: number, perPage: number = ROWS_PER_PAGE): PageRange {
  if (total <= 0) return { from: 0, to: 0, total: 0 };
  const safe = clampPage(index, total, perPage);
  const from = safe * perPage + 1;
  return { from, to: Math.min(from + perPage - 1, total), total };
}

import { baseApi, diagApi } from "./http";
import { DeviceRequestError } from "./policyObject";

// Log & Report — reading a device's own logs.
//
// Kept out of policyObject.ts, which is already ~2,800 lines covering Policy & Objects, Security
// Profiles, VPN and SD-WAN. Logs are a different errand against a different API namespace on the
// device (/api/v2/log/…, neither the CMDB nor the monitor API), and nothing here is shared with
// the configuration CRUD in there.
//
// Every read is STRICT — it throws rather than returning empty. That rule matters more here than
// anywhere else in the console: a page that renders "No results" when it actually failed to reach
// the firewall is telling an administrator that nothing happened, which on a security log is the
// most damaging thing it could say. See the note atop policyObject.ts.

/** Which backend a device keeps logs in. The picker is built from what the device reports. */
export type LogSource = {
  /** memory | disk | fortianalyzer | fortianalyzer_cloud | forticloud */
  key: string;
  /** The name FortiOS itself shows — "FortiGate Cloud", never "FortiCloud". */
  label: string;
  /** The unit has this backend at all. An 80E has no log disk, so `disk` comes back false. */
  available: boolean;
  /** It is switched on. Available-but-disabled is a real state and stays selectable. */
  enabled: boolean;
  /** FortiOS marks one as the default to open with. */
  is_default: boolean;
};

/**
 * A time period, or "all".
 *
 * "all" is what the MEMORY backend always gets, and it is not a convenience: the memory log is a
 * small ring buffer that holds whatever fits, so the buffer IS the result set. Filtering it by time
 * hides entries that are still in it — an operator returning after lunch would see an empty table
 * over a buffer holding 34 rows, which reads as "the firewall saw nothing".
 *
 * FortiOS agrees and shows it: its own log view DROPS the time-period control while the source is
 * Memory and offers it again for FortiGate Cloud. The server decides which applies and echoes the
 * one it used, so the page hides the control on "all" rather than guessing from the source name.
 */
export type LogWindow = "1h" | "24h" | "7d" | "all";

export const LOG_WINDOWS: { value: LogWindow; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

/**
 * One traffic log entry.
 *
 * ⚠️ `srcport`, `dstport`, `policyid` and `crscore` are `number | null`, and the null is load-bearing.
 * FortiOS OMITS a field rather than sending zero — an ICMP row carries no port at all — so a
 * missing port must render as nothing, never as `:0`, which would be a port number that was never
 * on the wire. Anything that reads these must check for null rather than falsiness, because 0 is a
 * real value for `policyid` (it means the implicit local-in policy).
 */
export type TrafficLogRow = {
  /** `_metadata.#` — the device's own 1-based index across the whole match. Stable React key. */
  row: number;
  /** `_metadata.timestamp`, epoch MILLISECONDS. The sortable instant. */
  timestamp: number;
  /**
   * The device's own rendering of that instant, in the DEVICE's timezone, with `tz` the offset.
   * Shown verbatim. Re-deriving it from `timestamp` in the browser would relabel every row with
   * the viewer's timezone and disagree with the same log read over SSH.
   */
  date: string;
  time: string;
  tz: string;

  logid: string;
  level: string;
  vd: string;
  type: string;
  subtype: string;
  /** `_metadata.archive` — the paperclip column: a packet capture or file was kept with the entry. */
  archive: boolean;

  srcip: string;
  srcport: number | null;
  srcintf: string;
  srcintfrole: string;
  srccountry: string;
  srcname: string;
  srcmac: string;
  /** The MAC behind a switch/AP, when the firewall could see past one. */
  mastersrcmac: string;
  srchwvendor: string;
  /** `devtype` — what the firewall thinks the source device is ("Router", "Windows PC"). */
  devtype: string;
  osname: string;
  user: string;
  group: string;

  dstip: string;
  dstport: number | null;
  dstintf: string;
  dstintfrole: string;
  dstcountry: string;
  dstname: string;
  dstmac: string;
  dsthwvendor: string;
  dstdevtype: string;

  sessionid: number;
  proto: number;
  /** Resolved server-side: 6 → "TCP". Falls back to the number for anything unmapped. */
  proto_name: string;
  action: string;
  policyid: number | null;
  policytype: string;
  service: string;
  app: string;
  appcat: string;
  trandisp: string;
  duration: number;

  sentbyte: number;
  rcvdbyte: number;
  sentpkt: number;
  rcvdpkt: number;

  crscore: number | null;
  crlevel: string;
  msg: string;

  /**
   * Reverse-DNS names for the two addresses — what puts "(globalgip.fortinet.net)" beside
   * 173.243.140.16, exactly as the device's own log view does.
   *
   * NOT fields of the log entry: the device resolves them per query and returns them in a separate
   * `_extra` object. Kept apart from srcname/dstname, which are what the firewall recorded AT THE
   * TIME — a lookup answered now can disagree with what was true then.
   */
  srchost?: string;
  dsthost?: string;

  /**
   * The RULE this entry matched, resolved from the device's policy table.
   *
   * The log carries only a number, and a number answers nothing: `policyid: 8` becomes useful the
   * moment it reads "Block-FB-YT-172.16.100.123". null when the device did not name a rule.
   *
   * ⚠️ `implicit` covers the two rules that are in no table — and `policyid: 0` means a DIFFERENT
   * one depending on `policytype`: the implicit DENY at the bottom of the forward table (nothing
   * matched — the usual answer to "I can't get online"), or the implicit LOCAL-IN policy, which
   * accepts and is how the GUI is reachable at all.
   */
  policy?: {
    name?: string;
    /** The rule's CONFIGURED action. Disagreeing with the row's own action is a diagnosis: a rule
     *  that says accept on a row logged deny means a security profile stopped it, not the rule. */
    action?: string;
    status?: string;
    /** false when the id names a rule that is no longer in the table — deleted or renumbered. */
    exists: boolean;
    implicit?: boolean;
    /**
     * Which of the two implicit rules this is — resolved by the SERVER, where the log being read
     * is known.
     *
     * ⚠️ Do not re-derive this from `policytype`. The lab FGT80E omits that field on every row
     * of its Local Traffic log, and reading its absence as "the forward implicit deny" labelled
     * 200 out of 200 rows as blocked, including NTP exchanges the firewall completed.
     */
    local_in?: boolean;
  } | null;

  /**
   * Every field the device sent, as TEXT, for the Details panel.
   *
   * Strings rather than numbers on purpose: `eventtime` exceeds 2^53, so as a JSON number the
   * browser would round it and the panel would display a value the firewall never emitted.
   */
  raw?: Record<string, string>;
};

export type TrafficLogPage = {
  rows: TrafficLogRow[];
  /** The device's `total_lines` — the whole match, BEFORE the time window is applied. */
  total: number;
  /** How many survived the time window. This is what the footer counts. */
  returned: number;
  start: number;
  /** The FIREWALL's clock, epoch ms. Relative times are measured from this, not the browser's. */
  device_now: number;
  /** False while FortiOS is still assembling the result set. */
  ready: boolean;
  completed: number;
  source: string;
  window: LogWindow;
  window_start: number;
  /** The device had more matching rows than one read returns. */
  truncated: boolean;
};

/**
 * Why a Local Traffic log is empty.
 *
 * Sent only when the result IS empty, because it answers nothing otherwise. Local Traffic is gated
 * twice on FortiOS and both gates are off by default, which is why a healthy, busy firewall shows
 * an empty Local Traffic log and its GUI explains nothing:
 *
 *   config log setting        →  local-in-allow / local-in-deny-unicast   nothing is RECORDED
 *   config log <backend> filter →  local-traffic                          the backend REJECTS it
 */
export type LogGates = {
  local_in_allow: boolean;
  local_in_deny_unicast: boolean;
  local_in_deny_broadcast: boolean;
  /** Traffic the firewall itself originates. On by default in 7.2, and it lands in this log too. */
  local_out: boolean;
  /** The chosen backend's own `local-traffic` filter. null when there is no such table to read. */
  source_accepts_local: boolean | null;
  /** The CLI table that came from, e.g. "log.memory" — so a hint can print a true command. */
  source_filter_path?: string;
};

export type TrafficLogResponse = {
  page: TrafficLogPage;
  sources: LogSource[];
  gates?: LogGates;
  /** What was actually sent to the device, so the UI can show the real query, not just the text. */
  applied_filters?: string[];
  subcategory: string;
};

/**
 * A traffic log FortiOS keeps separately.
 *
 * ⚠️ THE DEVICE DOES NOT FILTER BY THIS. Measured on the lab unit's memory backend: /traffic/local,
 * /traffic/forward, /traffic/sniffer and /traffic/multicast all return the SAME rows — every one
 * `subtype: "local"` — and the envelope echoes back whichever was asked for. The server filters on
 * each row's own `subtype` before answering, so what arrives here really is the log named.
 */
export type TrafficSubcategory = "local" | "forward" | "sniffer" | "multicast";

/**
 * The two traffic logs worth putting in front of someone, and what each one answers.
 *
 * Local is "who is touching the firewall". FORWARD is "who is going through it" — and it is the
 * only one that can answer "why can't I get online" or "why won't YouTube load", because those
 * packets never address the FortiGate itself. A page that offered only Local could never explain
 * either.
 */
export const TRAFFIC_LOGS: { value: TrafficSubcategory; label: string; hint: string }[] = [
  { value: "local", label: "Local Traffic", hint: "Addressed to the FortiGate itself" },
  { value: "forward", label: "Forward Traffic", hint: "Passing through, to the internet or another network" },
];

export type TrafficLogQuery = {
  source?: string;
  window?: LogWindow;
  search?: string;
  start?: number;
  rows?: number;
};

/**
 * A search the backend refused to send to the device.
 *
 * Distinct from a device failure because it is the person's typing, not the firewall — and because
 * it must be shown ON the search box rather than as a page-level error. The backend refuses rather
 * than forwarding, since the device accepts a nonsense filter and answers "no results", which would
 * read as a firewall that saw no traffic.
 */
export class LogSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogSearchError";
  }
}

/**
 * The message from a 400 the backend marked as a search problem, or null for anything else.
 *
 * Narrowed by hand rather than cast, because the distinction it draws is the one this module cares
 * most about: a refused search must not be reported as an unreachable firewall. Getting that wrong
 * by way of a loose `any` would put "could not read the log" on screen for a device that answered
 * perfectly well.
 */
function searchRefusal(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;

  const { status, data } = response as { status?: unknown; data?: unknown };
  if (status !== 400) return null;
  if (typeof data !== "object" || data === null) return null;

  const { search_error: flagged, error } = data as { search_error?: unknown; error?: unknown };
  if (!flagged) return null;
  return typeof error === "string" && error ? error : "That search could not be understood";
}

/** Builds the query string, omitting anything the server should default. */
function logParams(q: TrafficLogQuery): string {
  const params = new URLSearchParams();
  if (q.source) params.set("source", q.source);
  if (q.window) params.set("window", q.window);
  if (q.search?.trim()) params.set("search", q.search.trim());
  if (q.start) params.set("start", String(q.start));
  if (q.rows) params.set("rows", String(q.rows));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * GET one page of a traffic log. Always strict — see the note at the top of this file.
 *
 * diagApi rather than baseApi, for its longer timeout. baseApi gives up at 15s, which is ample for
 * the memory buffer but not for FortiGate Cloud: that query leaves the firewall for Fortinet's
 * service and comes back over the WAN, and a 7-day window is a real search rather than a buffer
 * read. An abort at 15s would surface as "the device could not be reached" for a firewall that was
 * answering perfectly well, just slowly.
 */
export async function DeviceGetTrafficLog(
  deviceId: number,
  subcategory: TrafficSubcategory,
  query: TrafficLogQuery = {},
): Promise<TrafficLogResponse> {
  try {
    const res = await diagApi.get(
      `/policy/device/${deviceId}/logs/traffic/${subcategory}${logParams(query)}`,
    );
    return res.data as TrafficLogResponse;
  } catch (err) {
    // A rejected search is the caller's input, not an unreachable firewall, and the page shows it
    // in a different place. The backend flags it so the two never get confused.
    const refused = searchRefusal(err);
    if (refused) throw new LogSearchError(refused);
    throw new DeviceRequestError("Could not read the log", err);
  }
}

/**
 * The AI's reading of the same entries.
 *
 * ⚠️ It is a SECOND read of the device, not a summary of what the table is holding. The browser
 * has already computed its own findings (pages/logs/insight.ts) and could have posted them, but
 * then the answer's numbers would have no independent source. This sends the QUESTION — which log,
 * which backend, which period, which search — and the server reads the firewall itself.
 *
 * On aiApi rather than diagApi: a model call takes tens of seconds and diagApi's timeout is set
 * for a device read.
 */
export type LogReading = {
  headline: string;
  reading: string;
  checks: string[];
  unknown?: string;
};

export type LogExplainResponse = {
  /** How many entries the server read — what the answer is actually about. */
  entries: number;
  source?: string;
  reading: LogReading | null;
  note?: string;
};


/**
 * The URL behind the download button.
 *
 * A URL rather than a fetch: the export is a file, and letting the browser navigate to it keeps
 * the Content-Disposition filename the server chose. It carries the SAME query the table ran, so
 * what lands on disk is what was on screen.
 */
export function trafficLogExportUrl(
  deviceId: number,
  subcategory: TrafficSubcategory,
  query: TrafficLogQuery = {},
): string {
  return `${baseApi.defaults.baseURL ?? ""}/policy/device/${deviceId}/logs/traffic/${subcategory}/export${logParams(query)}`;
}

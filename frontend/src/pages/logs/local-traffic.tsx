import React, { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FiAlertTriangle, FiCloud, FiClock, FiCpu, FiDownload, FiFileText, FiList, FiMessageSquare,
  FiPaperclip, FiRefreshCw, FiShield,
} from "react-icons/fi";
import { NoDeviceState, LoadingState, ErrorState, EmptyState } from "../../components/ui/StateBlock";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceData } from "../../hooks/useDeviceData";
import {
  DeviceGetTrafficLog, LOG_WINDOWS, TRAFFIC_LOGS, LogSearchError,
  trafficLogExportUrl,
  type LogWindow, type TrafficLogResponse, type TrafficLogRow, type TrafficSubcategory,
} from "../../api/logs";
import MenuButton, { type MenuOption } from "./MenuButton";
import LogSearchField from "./LogSearchField";
import LogPager from "./LogPager";
import SummaryTiles from "./SummaryTiles";
import Conversations from "./Conversations";
import EntryDetail from "./EntryDetail";
import { useResultHues } from "./resultHues";
import { filterByGroup, GROUP_CHIP, GROUP_LABEL, interfacePath, rowResult, serviceLabel, type ResultGroup } from "./story";
import {
  describeRecording, destinationEndpoint, explainEmpty, formatDevice, formatLogTime, formatRelative,
  formatSentReceived, clampPage, pageSlice, policyVerdict, selectableSources, sourceEndpoint,
  verdictChipClass, type Endpoint, type PolicyVerdict,
} from "./format";

// The two charts need recharts, the heaviest thing on the page; the table does not wait for them.
const TrafficCharts = lazy(() => import("./TrafficCharts"));

// Log & Report ▸ Local Traffic — the FortiGate's own traffic log, read for the questions people
// open it with.
//
// ── LOCAL vs FORWARD ─────────────────────────────────────────────────────────
//   Forward Traffic — packets that pass THROUGH the firewall, one interface to another
//   Local Traffic   — packets whose destination IS the firewall: GUI and SSH logins, the REST
//                     calls this console itself makes, IPsec and SSL-VPN terminating here, SNMP,
//                     pings to the unit — and, because `local-out` logging is on by default, the
//                     traffic the FortiGate itself originates (FortiGuard, its own DNS)
//
// ── THE PAGE READS TOP TO BOTTOM AS THE QUESTIONS DO ─────────────────────────
//   Search + "How to search"       the device's filter grammar, with clickable examples
//   Four numbers                   connections · blocked (and the main reason) · reset/timed out · data
//   When / Where charts            the entries over time and by destination, split by result
//   Which policy — and why blocked every rule (and the two cases that are not rules) with its results
//   Worth a look                   the computed checks (insight.ts) and the AI's second opinion
//   Traffic                        as CONVERSATIONS (one line per exchange) or as every ENTRY;
//                                  any entry opens to its story, its path and every field
//
// Every result is said in words ("Reset by the server", "Blocked by a security profile"), never as
// the raw action, because `server-rst` and `deny` are both "it didn't work" and send you to
// completely different places. See story.ts for the rules.
//
// ── THE ONE THING THIS DOES THAT FORTIOS DOES NOT ────────────────────────────
// When the DEVICE holds nothing at all it says why. Local Traffic is gated twice on FortiOS and
// both gates are off by default, so a perfectly healthy firewall shows an empty Local Traffic log
// and its GUI offers "No results" and nothing else. See services/fortigate_log.go's FGLogGates.
//
// EVERY NUMBER ON THIS PAGE IS A FILTER. The device's filter grammar is a set of `field==value`
// terms (services/fortigate_logsearch.go), so a pivot is that expression put in the search box —
// which means the reader can see what was asked and edit it, rather than being taken somewhere by
// a query they cannot inspect. The "Show" switch is the one filter applied here instead, over the
// entries already read, because "blocked by a security profile" is a judgement across two fields
// the device's filter cannot express.

/** The log the page opens on. Forward is a click away — see the note on TRAFFIC_LOGS. */
const DEFAULT_LOG: TrafficSubcategory = "local";

/**
 * The entry table's columns. One grid for the header and every row so the two cannot drift;
 * `minmax(0, …)` on each text column is what lets `truncate` work inside a grid.
 */
const GRID = "minmax(0,0.95fr) minmax(0,1.2fr) minmax(0,1.45fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1.15fr) minmax(0,0.8fr)";

const HEADERS = ["Date/Time", "Source", "Destination", "Service", "Policy", "Result", "Sent / Received"];

type View = "conversations" | "entries";

const SHOW: { key: ResultGroup | "all"; label: string }[] = [
  { key: "all", label: "All results" },
  { key: "blocked", label: GROUP_LABEL.blocked },
  { key: "problem", label: GROUP_LABEL.problem },
  { key: "ok", label: GROUP_LABEL.ok },
];

/** Stable empty response — a literal would be a new identity each render and re-fetch forever. */
const EMPTY: TrafficLogResponse = {
  page: {
    rows: [], total: 0, returned: 0, start: 0, device_now: 0, ready: true, completed: 100,
    source: "", window: "all", window_start: 0, truncated: false,
  },
  sources: [],
  subcategory: DEFAULT_LOG,
};

/**
 * One side of a connection, the way the device's own log view writes it: `10.0.99.201:443`, and for
 * anything outside the local network the country flag in front and the reverse-DNS name after.
 */
const EndpointCell: React.FC<{ endpoint: Endpoint; second?: string }> = ({ endpoint, second }) => {
  if (!endpoint.ip) return <span className="ink-3">—</span>;
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-baseline gap-1.5">
        {endpoint.flag && (
          <span className="shrink-0 text-[12px] leading-none" title={endpoint.country}>{endpoint.flag}</span>
        )}
        <span className="ink truncate text-[12px] tnum" title={endpoint.name ? `${endpoint.address} (${endpoint.name})` : endpoint.address}>
          {endpoint.name || endpoint.address}
        </span>
      </span>
      <span className="ink-3 block truncate text-[10.5px] tnum">{second ?? (endpoint.name ? endpoint.address : "")}</span>
    </span>
  );
};

/**
 * The Policy column — which rule claimed the packet. The result column beside it says what
 * happened; this one says who decided, with a chip only when the rule is gone.
 */
const PolicyCell: React.FC<{ verdict: PolicyVerdict }> = ({ verdict }) => (
  <span className="block min-w-0">
    <span className="ink block truncate text-[12px]" title={verdict.label}>
      {verdict.by === "local-out" ? "No policy" : verdict.label}
    </span>
    {verdict.missing ? (
      <span className={`${verdictChipClass(verdict)} mt-0.5`}>rule deleted</span>
    ) : verdict.by === "local-out" ? (
      <span className="ink-3 block truncate text-[10.5px]">sent by the FortiGate</span>
    ) : null}
  </span>
);

const LocalTrafficPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const hues = useResultHues();

  // ── Query state ────────────────────────────────────────────────────────────
  // `search` is what is in the box; `applied` is what has been submitted. They are separate because
  // the log query costs a round trip to a firewall — searching on every keystroke would queue a
  // read per character, and the FortiGate Cloud backend answers in seconds, not milliseconds.
  // A link can open the page on a question: ?log=forward&q=srcip==… — Troubleshooting links here
  // with the pair it just traced, so its answer can be checked against what the firewall logged.
  const [params] = useSearchParams();
  const linkedQuery = params.get("q") ?? "";
  const linkedLog = TRAFFIC_LOGS.find((l) => l.value === params.get("log"))?.value;
  const [search, setSearch] = useState(linkedQuery);
  const [applied, setApplied] = useState(linkedQuery);
  const [source, setSource] = useState<string>("");
  const [window_, setWindow] = useState<LogWindow>("1h");
  const [logType, setLogType] = useState<TrafficSubcategory>(linkedLog ?? DEFAULT_LOG);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Applied HERE, over the entries already read — see the header note.
  const [show, setShow] = useState<ResultGroup | "all">("all");
  const [view, setView] = useState<View>("conversations");
  const [opened, setOpened] = useState<TrafficLogRow | null>(null);

  const load = useCallback(
    async (deviceId: number) => {
      try {
        const res = await DeviceGetTrafficLog(deviceId, logType, {
          source: source || undefined,
          window: window_,
          search: applied || undefined,
        });
        setSearchError(null);
        return res;
      } catch (err) {
        // A search the server would not send is the person's typing, not an unreachable firewall.
        // It must NOT reach useDeviceData's error state, which renders "could not read the log
        // from this device" — an accusation against a firewall that is answering fine.
        if (err instanceof LogSearchError) {
          setSearchError(err.message);
          return EMPTY;
        }
        setSearchError(null);
        throw err;
      }
    },
    [source, window_, applied, logType],
  );

  const { data, error, reload, device, viewState } = useDeviceData<TrafficLogResponse>(load, EMPTY);
  const { page, sources, gates } = data;
  const rows = page.rows;
  const shownRows = useMemo(() => filterByGroup(rows, show), [rows, show]);

  /**
   * Which page of the entries is on screen, tied to the QUESTION that produced them. Compared during
   * render rather than reset from an effect, so page 3 of a new search is never painted at all.
   */
  const querySignature = `${logType}|${source}|${window_}|${applied}|${show}|${device?.id ?? ""}`;
  const [pager, setPager] = useState({ signature: querySignature, index: 0 });
  const pageIndex = pager.signature === querySignature ? pager.index : 0;
  const setPageIndex = (index: number) => setPager({ signature: querySignature, index });
  const safePage = clampPage(pageIndex, shownRows.length);
  const visibleRows = pageSlice(shownRows, safePage);

  const sourceOptions: MenuOption<string>[] = useMemo(
    () =>
      selectableSources(sources).map((s) => ({
        value: s.key,
        label: s.label,
        icon: s.key === "memory" ? <FiCpu size={12} /> : <FiCloud size={12} />,
      })),
    [sources],
  );

  // The button shows whichever source the SERVER actually read, not what this page asked for.
  const activeSource = page.source || source;
  const activeSourceLabel = sources.find((s) => s.key === activeSource)?.label ?? activeSource ?? "";

  // The time period belongs to the BACKEND: memory is a ring buffer that already is its own window,
  // and the server collapses the period to "all" for it, as FortiOS's own log view does.
  const windowApplies = page.window !== "all";
  const windowLabel = LOG_WINDOWS.find((w) => w.value === page.window)?.label ?? "";

  const emptyReason = logType === "local" ? explainEmpty(gates, activeSourceLabel) : null;
  const recording = describeRecording(gates);

  const submitSearch = () => setApplied(search);
  const clearSearch = () => { setSearch(""); setApplied(""); setSearchError(null); };

  /**
   * Search for one thing, from a click somewhere on the page. It writes the expression into the BOX
   * as well as running it, so the reader can see why the list got shorter, widen it, or undo it.
   */
  const pivot = useCallback((expression: string) => {
    setSearch(expression);
    setApplied(expression);
    setSearchError(null);
    setShow("all");
  }, []);

  const exportUrl = device
    ? trafficLogExportUrl(device.id, logType, {
        source: activeSource || undefined,
        window: page.window,
        search: applied || undefined,
      })
    : "";

  const state = viewState(rows.length);
  const hasRows = state === "rows" && !searchError;
  const logName = logType === "local" ? "Local Traffic" : "Forward Traffic";

  return (
    <div className="page-stack">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this toolbar keeps everything the old hero's `actions` slot carried
          (Refresh, Download), plus the search/filter controls it already had. The entry-count
          badge is not lost, just not repeated here — SummaryTiles below already shows it. */}
      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2.5">
        <LogSearchField
          value={search}
          onChange={setSearch}
          onSubmit={submitSearch}
          onClear={clearSearch}
          placeholder="Search — an address, a port, a word, or srcip==10.0.0.1"
        />

        {/* Filters and actions sit together on the right; the search box keeps the left. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Which of the device's traffic logs to read — first, because it changes what every other
            control means. */}
        <MenuButton
          value={logType}
          options={TRAFFIC_LOGS.map((l) => ({
            value: l.value,
            label: l.label,
            hint: l.hint,
            icon: l.value === "local" ? <FiFileText size={12} /> : <FiShield size={12} />,
          }))}
          onChange={(v) => setLogType(v as TrafficSubcategory)}
          accent={currentColor}
          icon={logType === "local" ? <FiFileText size={12} /> : <FiShield size={12} />}
          ariaLabel="Which traffic log"
          title="Local is traffic to the FortiGate itself; Forward is traffic passing through it"
          align="end"
          minWidth={280}
        />
        <MenuButton
          value={activeSource}
          options={sourceOptions}
          onChange={setSource}
          accent={currentColor}
          icon={activeSource === "memory" ? <FiCpu size={12} /> : <FiCloud size={12} />}
          placeholder="Log source"
          ariaLabel="Log source"
          title="Which store on the device these entries are read from"
          align="end"
          minWidth={190}
        />
        {/* Hidden for Memory, exactly as the device's own log view hides it. */}
        {windowApplies && (
          <MenuButton
            value={window_}
            options={LOG_WINDOWS.map((w) => ({ value: w.value, label: w.label, icon: <FiClock size={12} /> }))}
            onChange={setWindow}
            accent={currentColor}
            icon={<FiClock size={12} />}
            ariaLabel="Time period"
            title="How far back to look"
            align="end"
            minWidth={150}
          />
        )}

        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm hairline gap-1.5 border" onClick={() => void reload()}
            title="Refresh" aria-label="Refresh the log">
            <FiRefreshCw size={12} />
            Refresh
          </button>
          <a className={`btn btn-ghost btn-sm hairline gap-1.5 border ${rows.length === 0 ? "pointer-events-none opacity-50" : ""}`}
            href={exportUrl} title="Download these entries as CSV" aria-disabled={rows.length === 0}>
            <FiDownload size={12} />
            Download
          </a>
        </div>
        </div>
      </div>

      {/* A refused search: shown on the box that caused it, never as a device error. */}
      {searchError && (
        <div className="banner banner-warn flex items-start gap-2">
          <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="m-0 text-[12px] font-semibold">That search was not sent to the firewall</p>
            <p className="m-0 mt-0.5 text-[11.5px] opacity-90">{searchError}</p>
            <p className="m-0 mt-1 text-[11px] opacity-75">
              The device would have accepted it and answered “no results”, which would read as a
              firewall that saw no traffic.
            </p>
          </div>
        </div>
      )}

      {/* ── The reading: numbers, charts, policies, findings ─────────────────
          Only over entries that exist. An error or an empty log is never buried under a summary
          of it. */}
      {hasRows && (
        <>
          <p className="t-meta m-0">
            {page.truncated
              ? `Everything below is computed from the newest ${rows.length} entries read from ${activeSourceLabel || "the log"} — the device holds more than one read returns.`
              : `Everything below is computed from the ${rows.length} entries read from ${activeSourceLabel || "the log"}.`}
          </p>
          <SummaryTiles rows={rows} hues={hues} show={show} onShow={setShow} accent={currentColor} />
          <Suspense fallback={
            <div className="grid gap-3 xl:grid-cols-2" aria-busy="true">
              <span className="shell-skeleton block h-72" /><span className="shell-skeleton block h-72" />
            </div>
          }>
            <TrafficCharts rows={rows} hues={hues} onPivot={pivot} />
          </Suspense>
        </>
      )}

      {/* ── The traffic itself ─────────────────────────────────────────────── */}
      <div className="panel panel-flush">
        <div className="hairline-b2 flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="seg" role="tablist" aria-label="How to list the traffic">
            <button type="button" role="tab" aria-selected={view === "conversations"} onClick={() => setView("conversations")}
              className={`seg-item inline-flex items-center gap-1.5${view === "conversations" ? " seg-item--on" : ""}`}>
              <FiMessageSquare size={11} /> Conversations
            </button>
            <button type="button" role="tab" aria-selected={view === "entries"} onClick={() => setView("entries")}
              className={`seg-item inline-flex items-center gap-1.5${view === "entries" ? " seg-item--on" : ""}`}>
              <FiList size={11} /> Every entry
            </button>
          </div>
          <span className="t-meta hidden md:inline">
            {view === "conversations"
              ? "Repeats of the same exchange folded into one line"
              : "One line per log entry — click one for the full story"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Show">
            {SHOW.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={show === o.key} onClick={() => setShow(o.key)}
                className={`inline-flex items-center gap-1.5 rounded-[5px] border px-2.5 py-1 text-[11px] font-semibold transition ${
                  show === o.key ? "border-transparent text-white" : "hairline ink-2 surface-hover"}`}
                style={show === o.key ? { background: o.key === "all" ? currentColor : hues[o.key] } : undefined}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {hasRows && shownRows.length === 0 && (
          <p className="t-meta m-0 px-3 py-8 text-center">
            {`No entry here is “${SHOW.find((o) => o.key === show)?.label}”.`}
          </p>
        )}

        {hasRows && view === "conversations" && <Conversations rows={shownRows} hues={hues} onPivot={pivot} />}

        {view === "entries" && (
          <div className="shell-scroll overflow-x-auto">
            <div className="min-w-220">
              <div className="hairline-b2 grid items-center gap-3 border-b px-3 py-2" style={{ gridTemplateColumns: GRID }} role="row">
                {HEADERS.map((h) => (
                  <span key={h} className="t-label truncate" role="columnheader">{h}</span>
                ))}
              </div>

              {hasRows && visibleRows.map((row) => {
                const result = rowResult(row);
                const device_ = formatDevice(row);
                const bytes = formatSentReceived(row);
                return (
                  <button
                    type="button"
                    key={`${row.row}-${row.timestamp}-${row.sessionid}`}
                    onClick={() => setOpened(row)}
                    className="surface-hover hairline-b grid w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0"
                    style={{ gridTemplateColumns: GRID }}
                    title="Open this entry"
                  >
                    {/* Date/Time — the DEVICE's clock, in the device's own slashed format. */}
                    <span className="block min-w-0">
                      <span className="ink flex items-center gap-1 truncate text-[12px] tnum">
                        {formatLogTime(row)}
                        {row.archive && <FiPaperclip size={11} className="ink-3" title="This entry has an archived packet capture" />}
                      </span>
                      <span className="ink-3 block truncate text-[10.5px]">{formatRelative(row.timestamp, page.device_now)}</span>
                    </span>

                    {/* Source — the address, and underneath the device the firewall saw (its MAC
                        or name), or "the FortiGate" for traffic it sent itself. */}
                    <EndpointCell endpoint={sourceEndpoint(row)}
                      second={policyVerdict(row).by === "local-out" ? "the FortiGate itself" : device_ || undefined} />

                    <EndpointCell endpoint={destinationEndpoint(row)} />

                    <span className="block min-w-0">
                      <span className="ink block truncate text-[12px]" title={serviceLabel(row)}>{serviceLabel(row)}</span>
                      {interfacePath(row) && (
                        <span className="ink-3 block truncate font-mono text-[10.5px]">{interfacePath(row)}</span>
                      )}
                    </span>

                    <PolicyCell verdict={policyVerdict(row)} />

                    <span className="block min-w-0">
                      <span className={`${GROUP_CHIP[result.group]} max-w-full truncate text-[10.5px]`} title={result.why}>{result.label}</span>
                    </span>

                    {/* Blank when nothing moved — a denied SYN — as FortiOS leaves it. */}
                    <span className="ink block truncate text-[12px] tnum">{bytes}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* The four states, in the order useDeviceData fixes: an error NEVER falls through to
            "empty". "No traffic was logged" and "we could not read the log" must never look alike. */}
        {state === "no-device" && <NoDeviceState />}
        {state === "loading" && <LoadingState what="log entries" from={device?.name} />}
        {state === "error" && (
          <ErrorState
            title={`Could not read the ${logName} log from ${device?.name ?? "the device"}`}
            detail={error ?? undefined}
            note="The firewall may well be logging normally — this list is unreadable, not empty"
            onRetry={() => void reload()}
          />
        )}
        {state === "empty" && !searchError && (
          emptyReason ? (
            <div className="px-3 py-6">
              <div className="banner banner-warn flex items-start gap-2.5">
                <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="m-0 text-[12.5px] font-semibold">{emptyReason.title}</p>
                  <p className="m-0 mt-1 text-[11.5px] leading-relaxed opacity-90">{emptyReason.detail}</p>
                  <p className="m-0 mt-2 text-[11px] font-semibold opacity-80">Turn it on from the CLI:</p>
                  {/* <pre>: CLI, which the i18n runtime passes through untranslated. */}
                  <pre className="code-surface mt-1 overflow-x-auto px-3 py-2 text-[11px]">
                    {emptyReason.cli.join("\n")}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<FiFileText size={18} />}
              title={applied ? "No entries match this search" : "No results"}
              hint={
                applied
                  ? windowApplies
                    ? `Nothing in the last ${windowLabel} matched. Try a wider time period.`
                    : "Nothing in this log matched."
                  : logType === "forward"
                    ? `${activeSourceLabel || "This log"} holds no forward traffic. Forward traffic is only logged for policies whose Log Allowed Traffic setting is on, and only while traffic actually passes through the firewall.`
                    : `${activeSourceLabel || "This log"} holds no local traffic${windowApplies ? ` for the last ${windowLabel}` : ""}.${recording ? ` ${recording}.` : ""}`
              }
            />
          )
        )}

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="hairline-t flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <span className="t-meta">
            {activeSourceLabel && <>Read from {activeSourceLabel}</>}
            {page.truncated && (
              <>
                {" · "}
                <span className="chip chip-warn">showing the newest {rows.length} of {page.total}</span>
              </>
            )}
            {!page.ready && <> · <span className="chip chip-info">the device is still searching</span></>}
          </span>
          {view === "entries" && <LogPager total={shownRows.length} index={safePage} onChange={setPageIndex} />}
        </div>
      </div>

      <EntryDetail row={opened} hues={hues} onClose={() => setOpened(null)} onPivot={pivot} />
    </div>
  );
};

export default LocalTrafficPage;

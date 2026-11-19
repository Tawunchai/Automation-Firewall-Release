import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FiShare2, FiEdit2, FiTrash2, FiGlobe, FiActivity, FiZap, FiRefreshCw, FiPlus, FiSearch,
} from "react-icons/fi";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { message } from "../../components/ui/toast";
import {
  DeviceGetSDWAN, DeviceListSDWANRules, DeviceListSDWANHealthChecks,
  DeviceDeleteSDWANMember, DeviceDeleteSDWANZone, DeviceDeleteSDWANRule,
  DeviceDeleteSDWANHealthCheck,
  EMPTY_SDWAN,
  type SDWANOverview, type SDWANMember, type SDWANZone,
  type SDWANRule, type SDWANRuleList, type SDWANHealthCheck,
} from "../../api/policyObject";
import { chartsFor, buildRows, formatBytes, formatBps, type ChartTab } from "./format";
import SLAHistoryPanel from "./sla-history";
import {
  ruleSource, ruleDestination, ruleCriteria, ruleMembers,
  rulePerformanceSLA, rulePort, ruleProtocol,
} from "./ruleFormat";
import {
  measurementSeries, detectServerLines, participantsLabel, thresholdLabel,
  probeModeLabel, protocolLabel, hasLinkStatus, hasProbeTarget,
  type SLAMetric,
} from "./slaFormat";
import { SDWANDeleteConfirm, CreateNewMenu } from "./dialogs";
import { apiErrorDetail } from "../../api/errorText";

// Network ▸ SD-WAN — the FortiGate page, in this console's vocabulary.
//
// Three tabs, matching the device, and all three have full CRUD.
//
// `system/sdwan` is a complex CMDB object, so the Zones tab is really two tables shown as one
// nested list: zones, with each zone's interface members underneath it. The charts above it come
// from the device's own counters and show "No results" when it reports none, which is exactly what
// the real GUI does on a firewall with no members — the state this lab device is in.

type Tab = "zones" | "rules" | "slas";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "zones", label: "SD-WAN Zones", icon: <FiShare2 size={13} /> },
  { key: "rules", label: "SD-WAN Rules", icon: <FiZap size={13} /> },
  { key: "slas", label: "Performance SLAs", icon: <FiActivity size={13} /> },
];

const CHART_TABS: { key: ChartTab; label: string }[] = [
  { key: "bandwidth", label: "Bandwidth" },
  { key: "volume", label: "Volume" },
  { key: "sessions", label: "Sessions" },
];

const EMPTY_RULES: SDWANRuleList = { rules: [], implicit: { name: "sd-wan", criteria: "", mode: "" } };
const EMPTY_SLAS: SDWANHealthCheck[] = [];

// Why two of the FortiGate columns are always blank here. The device fills them from
// `diagnose sys sdwan service` over the CLI; FortiOS 7.2.10 has no REST equivalent (probed:
// monitor/virtual-wan/{members,health-check,sla-log,interface-log}, and monitor/firewall/sdwan-rule
// which 404s). A number invented for these would be indistinguishable from a measured one.
const HIT_COUNT_NOTE =
  "FortiOS 7.2 does not expose SD-WAN rule hit counters over the REST API";

// Why the Performance SLA chart is empty on a firewall like this one. Latency/jitter/packet loss
// are measurements taken while SD-WAN is probing; with SD-WAN off, monitor/virtual-wan/health-check
// answers `{}` for every check, and the real GUI prints "No data" too.
const SLA_LIVE_NOTE =
  "The firewall reports measurements only while SD-WAN is enabled and probing.";

const isTab = (v: string | null): v is Tab => v === "zones" || v === "rules" || v === "slas";

const SDWANPage: React.FC = () => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first — a role stored as
  // "Admin" made the router serve the admin page while every hand-rolled check hid the buttons.
  const { isAdmin } = useAuth();

  // The tab lives in the URL. The create/edit forms are their own pages now, so coming back from
  // one has to land on the tab it was opened from — and with it in the URL, that is just the Back
  // button working the way the browser's does everywhere else.
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab: Tab = isTab(urlTab) ? urlTab : "zones";
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="page-stack">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="SD-WAN view">
        {TABS.map(({ key, label, icon }) => {
          const on = tab === key;
          return (
            <button key={key} type="button" role="tab" aria-selected={on}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 rounded-[5px] border px-3.5 py-2 text-[12.5px] font-semibold transition ${
                on ? "border-transparent text-white" : "hairline surface-card ink-2 surface-hover"
              }`}
              style={on ? { background: currentColor } : undefined}>
              {icon} {label}
            </button>
          );
        })}
      </div>

      {tab === "zones" && <ZonesTab isAdmin={isAdmin} accent={currentColor} />}
      {tab === "rules" && <RulesTab isAdmin={isAdmin} />}
      {tab === "slas" && <SLAsTab isAdmin={isAdmin} accent={currentColor} />}
    </div>
  );
};

// ── SD-WAN Zones ─────────────────────────────────────────────────────────────

const ZonesTab: React.FC<{ isAdmin: boolean; accent: string }> = ({ isAdmin, accent }) => {
  const load = useCallback((deviceId: number) => DeviceGetSDWAN(deviceId), []);
  const {
    data, error, reload, device, viewState,
  } = useDeviceData<SDWANOverview>(load, EMPTY_SDWAN);

  const navigate = useNavigate();
  const [chartTab, setChartTab] = useState<ChartTab>("bandwidth");
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "member"; member: SDWANMember } | { kind: "zone"; zone: SDWANZone } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo(() => buildRows(data.zones, data.members), [data.zones, data.members]);
  const charts = useMemo(() => chartsFor(chartTab, data.members), [chartTab, data.members]);

  /** Every form is its own page, and each carries the device it was opened for. */
  const formURL = (what: "members" | "zones", key?: string | number) =>
    `/admin/sdwan/${what}/${key === undefined ? "create" : "edit"}?deviceId=${device?.id ?? ""}` +
    (key === undefined ? "" : `&${what === "members" ? "seq" : "name"}=${encodeURIComponent(String(key))}`);

  const runDelete = async () => {
    if (!pendingDelete || !device) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === "member") {
        await DeviceDeleteSDWANMember(device.id, pendingDelete.member.seq_num);
        message.success("SD-WAN member deleted");
      } else {
        await DeviceDeleteSDWANZone(device.id, pendingDelete.zone.name);
        message.success("SD-WAN zone deleted");
      }
      setPendingDelete(null);
      void reload();
    } catch (err) {
      message.error(apiErrorDetail(err, "The device refused the delete"));
    } finally {
      setDeleting(false);
    }
  };

  const GRID = "minmax(200px,1.4fr) 1fr 90px 1fr 1fr 90px";

  return (
    <div className="space-y-4">
      {/* Global SD-WAN state. Worth saying out loud: every number below is zero on a firewall whose
          SD-WAN is switched off, and without this line that reads as "nothing is flowing". */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${data.enabled ? "chip-ok" : "chip-warn"}`}>
          SD-WAN {data.enabled ? "enabled" : "disabled"}
        </span>
        {data.load_balance_mode && (
          <span className="chip">Load balance: {data.load_balance_mode}</span>
        )}
        <button type="button" className="btn btn-soft btn-sm ml-auto" onClick={() => void reload()}>
          <FiRefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Chart tabs */}
      <div className="panel">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CHART_TABS.map(({ key, label }) => {
            const on = chartTab === key;
            return (
              <button key={key} type="button" onClick={() => setChartTab(key)}
                className={`rounded-[4px] px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  on ? "text-white" : "ink-2 surface-hover"
                }`}
                style={on ? { background: accent } : undefined}>
                {label}
              </button>
            );
          })}
        </div>

        <div className={`grid gap-3 ${charts.length > 1 ? "md:grid-cols-2" : ""}`}>
          {charts.map(({ title, data: series }) => (
            <BarPanel key={title} title={title} data={series} accent={accent} note={
              chartTab === "sessions" && series.length === 0
                ? "This firewall reports no per-member session counts."
                : undefined
            } />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      {isAdmin && device && (
        <div className="flex flex-wrap items-center gap-2">
          <CreateNewMenu
            onMember={() => navigate(formURL("members"))}
            onZone={() => navigate(formURL("zones"))}
          />
        </div>
      )}

      {/* Interfaces table */}
      <div className="panel panel-flush">
        {viewState(rows.length) !== "empty" && viewState(rows.length) !== "error" && (
          <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: GRID }}>
            <span className="t-label">Interfaces</span>
            <span className="t-label">Gateway</span>
            <span className="t-label">Cost</span>
            <span className="t-label">Download</span>
            <span className="t-label">Upload</span>
            <span className="t-label" />
          </div>
        )}

        <DeviceStates
          state={viewState(rows.length)}
          from={device?.name}
          noun="SD-WAN zone"
          icon={<FiShare2 />}
          error={error}
          onRetry={() => void reload()}
        >
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {rows.map((row, idx) => {
              const last = idx === rows.length - 1;
              const border = last ? "" : "border-b hairline-2";

              if (row.kind === "zone") {
                return (
                  <div key={`z-${row.zone}`}
                    className={`grid items-center px-4 py-2.5 surface-sunken ${border}`}
                    style={{ gridTemplateColumns: GRID }}>
                    <div className="flex min-w-0 items-center gap-2">
                      <FiGlobe size={12} className="shrink-0 ink-3" />
                      <span className="truncate text-[13px] font-semibold ink">{row.zone}</span>
                      <span className="chip shrink-0">{row.memberCount}</span>
                      {row.orphan && (
                        <span className="chip chip-warn shrink-0" title="These members point at a zone that no longer exists">
                          orphaned
                        </span>
                      )}
                    </div>
                    <span /><span /><span /><span />
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && !row.orphan && (
                        <>
                          <button className="btn-icon" title="Edit zone"
                            onClick={() => navigate(formURL("zones", row.zone))}>
                            <FiEdit2 size={13} />
                          </button>
                          <button className="btn-icon btn-icon--danger" title="Delete zone"
                            onClick={() => {
                              const z = data.zones.find((x) => x.name === row.zone);
                              if (z) setPendingDelete({ kind: "zone", zone: z });
                            }}>
                            <FiTrash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              const m = row.member;
              return (
                <div key={`m-${m.seq_num}`}
                  className={`grid items-center px-4 py-2.5 surface-hover transition-colors ${border}`}
                  style={{ gridTemplateColumns: GRID }}>
                  <div className="flex min-w-0 items-center gap-2 pl-5">
                    {/* Link state is a fact about the cable, so it stays a status colour. */}
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: m.link === undefined ? "var(--shell-ink-3)"
                          : m.link ? "#10b981" : "#94a3b8",
                      }}
                      title={m.link === undefined ? "The device did not report this interface"
                        : m.link ? "Link up" : "Link down"} />
                    <span className="truncate text-[12.5px] font-semibold ink">{m.interface}</span>
                    {!m.status && <span className="chip chip-warn shrink-0">disabled</span>}
                    {m.health_status && (
                      <span className="chip shrink-0" title="monitor/virtual-wan/members status">
                        {m.health_status}
                      </span>
                    )}
                  </div>
                  <span className="truncate text-[12px] ink-2">{m.gateway || "—"}</span>
                  <span className="text-[12px] ink-2">{m.cost}</span>
                  {/* A rate is only shown once it has been measured between two polls. */}
                  <span className="text-[12px] ink-2">
                    {m.download_bps === undefined ? "—" : formatBps(m.download_bps)}
                  </span>
                  <span className="text-[12px] ink-2">
                    {m.upload_bps === undefined ? "—" : formatBps(m.upload_bps)}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    {isAdmin && (
                      <>
                        <button className="btn-icon" title="Edit member"
                          onClick={() => navigate(formURL("members", m.seq_num))}>
                          <FiEdit2 size={13} />
                        </button>
                        <button className="btn-icon btn-icon--danger" title="Delete member"
                          onClick={() => setPendingDelete({ kind: "member", member: m })}>
                          <FiTrash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DeviceStates>
      </div>

      {/* Volume is the one figure available without a second poll, so it gets its own line. */}
      {data.members.length > 0 && (
        <p className="text-right text-[11px] ink-3">
          {data.members.length} member{data.members.length !== 1 ? "s" : ""} ·{" "}
          {formatBytes(data.members.reduce((s, m) => s + (m.rx_bytes ?? 0), 0))} received,{" "}
          {formatBytes(data.members.reduce((s, m) => s + (m.tx_bytes ?? 0), 0))} sent
        </p>
      )}

      <SDWANDeleteConfirm
        open={pendingDelete !== null}
        what={pendingDelete?.kind === "zone" ? "SD-WAN zone" : "SD-WAN member"}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void runDelete()}
        detail={pendingDelete?.kind === "zone"
          ? <>Zone <b className="ink">{pendingDelete.zone.name}</b> will be removed from {device?.name}.</>
          : <>Member <b className="ink">{pendingDelete?.member.interface}</b> (seq {pendingDelete?.member.seq_num})
              will be removed from {device?.name}.</>}
      />
    </div>
  );
};

// ── A bar chart, small enough to not be worth a library ───────────────────────

const BarPanel: React.FC<{
  title: string;
  data: { label: string; value: number; display: string }[];
  accent: string;
  note?: string;
}> = ({ title, data, accent, note }) => {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  return (
    <div className="rounded-[4px] border hairline-2 p-3">
      <p className="t-label m-0 mb-2 text-center">{title}</p>
      {data.length === 0 ? (
        <div className="flex min-h-30 flex-col items-center justify-center gap-1">
          <p className="m-0 text-[12px] ink-3">No results</p>
          {note && <p className="m-0 max-w-60 text-center text-[10.5px] ink-3">{note}</p>}
        </div>
      ) : (
        <div className="min-h-30 space-y-1.5">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-[11px] ink-2" title={d.label}>{d.label}</span>
              <span className="h-3 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--shell-sunken)" }}>
                {/* A zero-width bar for a real zero is correct: the value was measured, and it was 0. */}
                <span className="block h-full rounded-sm"
                  style={{ width: max > 0 ? `${(d.value / max) * 100}%` : "0%", background: accent }} />
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] ink-2">{d.display}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── SD-WAN Rules ─────────────────────────────────────────────────────────────
//
// Full CRUD. The list follows the FortiGate columns, and the "Implicit" group at the bottom is the
// device's own fallback for traffic that matches no rule — not a stored object, so it has no
// controls and cannot be edited.
//
// Hit Count and Last Used are columns the FortiGate GUI fills from `diagnose sys sdwan service`
// over the CLI. FortiOS 7.2.10 exposes no REST equivalent (probed: monitor/virtual-wan/{members,
// health-check,sla-log,interface-log} and monitor/firewall/sdwan-rule, which is 404), so they are
// rendered as "—" with a title that says why rather than being filled with a made-up number.

const RulesTab: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const load = useCallback((deviceId: number) => DeviceListSDWANRules(deviceId), []);
  const { data, error, reload, device, viewState } = useDeviceData<SDWANRuleList>(load, EMPTY_RULES);

  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<SDWANRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** The Priority Rule form is its own page and loads its own pickers. */
  const formURL = (id?: number) =>
    `/admin/sdwan/rules/${id === undefined ? "create" : "edit"}?deviceId=${device?.id ?? ""}` +
    (id === undefined ? "" : `&id=${id}`);

  const runDelete = async () => {
    if (!pendingDelete || !device) return;
    setDeleting(true);
    try {
      await DeviceDeleteSDWANRule(device.id, pendingDelete.id);
      message.success("SD-WAN rule deleted");
      setPendingDelete(null);
      void reload();
    } catch (err) {
      message.error(apiErrorDetail(err, "The device refused the delete"));
    } finally {
      setDeleting(false);
    }
  };

  const GRID = "50px minmax(140px,1.1fr) 1fr 1fr 1fr 1fr 90px 90px 1fr 80px 80px 90px";
  const rules = data.rules;

  const Head: React.FC = () => (
    <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: GRID }}>
      {["ID", "Name", "Source", "Destination", "Criteria", "Members", "Hit Count", "Last Used",
        "Performance SLA", "Port", "Protocol", "Status"].map((h) => (
          <span key={h} className="t-label">{h}</span>
        ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {isAdmin && device && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-accent btn-sm"
            onClick={() => navigate(formURL())}>
            <FiPlus size={13} /> Create new
          </button>
        </div>
      )}

      <div className="panel panel-flush">
        {viewState(rules.length) !== "error" && <Head />}

        <DeviceStates
          state={viewState(rules.length) === "empty" ? "rows" : viewState(rules.length)}
          from={device?.name}
          noun="SD-WAN rule"
          icon={<FiZap />}
          error={error}
          onRetry={() => void reload()}
        >
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {rules.map((r) => (
              <div key={r.id}
                className="grid items-center border-b hairline-2 px-4 py-2.5 surface-hover transition-colors"
                style={{ gridTemplateColumns: GRID }}>
                <span className="text-[12px] ink-3">{r.id}</span>
                <span className="truncate pr-2 text-[12.5px] font-semibold ink" title={r.name}>
                  {r.name || "—"}
                </span>
                <span className="truncate pr-2 text-[12px] ink-2" title={ruleSource(r)}>{ruleSource(r)}</span>
                <span className="truncate pr-2 text-[12px] ink-2" title={ruleDestination(r)}>{ruleDestination(r)}</span>
                <span className="truncate pr-2 text-[12px] ink-2" title={ruleCriteria(r)}>{ruleCriteria(r)}</span>
                <span className="truncate pr-2 text-[12px] ink-2" title={ruleMembers(r)}>{ruleMembers(r)}</span>
                <span className="text-[12px] ink-3" title={HIT_COUNT_NOTE}>—</span>
                <span className="text-[12px] ink-3" title={HIT_COUNT_NOTE}>—</span>
                <span className="truncate pr-2 text-[12px] ink-2">{rulePerformanceSLA(r)}</span>
                <span className="text-[12px] ink-2">{rulePort(r)}</span>
                <span className="text-[12px] ink-2">{ruleProtocol(r)}</span>
                <div className="flex items-center justify-end gap-1">
                  <span className={`chip ${r.status ? "chip-ok" : "chip-warn"}`}>
                    {r.status ? "On" : "Off"}
                  </span>
                  {isAdmin && (
                    <>
                      <button className="btn-icon" title="Edit rule"
                        onClick={() => navigate(formURL(r.id))}>
                        <FiEdit2 size={13} />
                      </button>
                      <button className="btn-icon btn-icon--danger" title="Delete rule"
                        onClick={() => setPendingDelete(r)}>
                        <FiTrash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Implicit — the device's fallback, shown the way the FortiGate list shows it. */}
            <div className="grid items-center border-b hairline-2 px-4 py-2 surface-sunken"
              style={{ gridTemplateColumns: GRID }}>
              <span className="col-span-full text-[11.5px] font-bold uppercase tracking-wide ink-3">
                Implicit
              </span>
            </div>
            <div className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: GRID }}>
              <span />
              <span className="truncate pr-2 text-[12.5px] font-semibold ink">{data.implicit.name}</span>
              <span className="text-[12px] ink-2">all</span>
              <span className="text-[12px] ink-2">all</span>
              <span className="truncate pr-2 text-[12px] ink-2" title={data.implicit.mode}>
                {data.implicit.criteria || "—"}
              </span>
              <span className="text-[12px] ink-2">any</span>
              <span className="text-[12px] ink-3" title={HIT_COUNT_NOTE}>—</span>
              <span className="text-[12px] ink-3" title={HIT_COUNT_NOTE}>—</span>
              <span />
              <span className="text-[12px] ink-2">any</span>
              <span className="text-[12px] ink-2">any</span>
              <span />
            </div>
          </div>
        </DeviceStates>
      </div>

      <p className="text-right text-[11px] ink-3">
        {rules.length} rule{rules.length !== 1 ? "s" : ""} + the implicit fallback
      </p>

      <SDWANDeleteConfirm
        open={pendingDelete !== null}
        what="SD-WAN rule"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void runDelete()}
        detail={<>Rule <b className="ink">{pendingDelete?.name}</b> (id {pendingDelete?.id}) will be
          removed from {device?.name}.</>}
      />
    </div>
  );
};

// ── Performance SLAs ───────────────────────────────────────────────────
//
// Full CRUD, laid out the way the FortiGate tab is: a metric strip and a chart on top, then the
// list with its own toolbar.
//
// The chart is empty on this lab device and that is the correct answer, not a bug. Latency, jitter
// and packet loss are MEASUREMENTS — they exist only while SD-WAN is running and probing, and
// monitor/virtual-wan/health-check on a firewall with SD-WAN off answers `{}` for every check. The
// real GUI prints "No data" in exactly that state, so this does too rather than drawing three
// flat bars at zero.

const SLA_METRIC_TABS: { key: SLAMetric; label: string }[] = [
  { key: "packet-loss", label: "Packet Loss" },
  { key: "latency", label: "Latency" },
  { key: "jitter", label: "Jitter" },
];

const SLAsTab: React.FC<{ isAdmin: boolean; accent: string }> = ({ isAdmin, accent }) => {
  const load = useCallback(
    (deviceId: number) => DeviceListSDWANHealthChecks(deviceId, { strict: true }), []);
  const {
    data, error, reload, device, viewState,
  } = useDeviceData<SDWANHealthCheck[]>(load, EMPTY_SLAS);

  const navigate = useNavigate();
  const [metric, setMetric] = useState<SLAMetric>("packet-loss");
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SDWANHealthCheck | null>(null);
  const [deleting, setDeleting] = useState(false);

  const series = useMemo(() => measurementSeries(data, metric), [data, metric]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    // Search over what the row SHOWS, not only the name — someone hunting for "aws.amazon.com" is
    // looking at the Detect Server column.
    return data.filter((h) =>
      `${h.name} ${h.protocol} ${detectServerLines(h).join(" ")} ${participantsLabel(h)}`
        .toLowerCase().includes(q));
  }, [data, query]);

  const formURL = (name?: string) =>
    `/admin/sdwan/performance-slas/${name === undefined ? "create" : "edit"}` +
    `?deviceId=${device?.id ?? ""}` +
    (name === undefined ? "" : `&name=${encodeURIComponent(name)}`);

  const runDelete = async () => {
    if (!pendingDelete || !device) return;
    setDeleting(true);
    try {
      await DeviceDeleteSDWANHealthCheck(device.id, pendingDelete.name);
      message.success("Performance SLA deleted");
      setPendingDelete(null);
      void reload();
    } catch (err) {
      message.error(apiErrorDetail(err, "The device refused the delete"));
    } finally {
      setDeleting(false);
    }
  };

  const GRID = "minmax(150px,1.1fr) 1.2fr 90px 90px 90px 110px 120px 1fr 84px";

  return (
    <div className="space-y-4">
      {/* The measurement strip, mirroring the FortiGate's Packet Loss / Latency / Jitter tabs. */}
      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {SLA_METRIC_TABS.map(({ key, label }) => {
            const on = metric === key;
            return (
              <button key={key} type="button" onClick={() => setMetric(key)}
                className={`rounded-[4px] px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  on ? "text-white" : "ink-2 surface-hover"
                }`}
                style={on ? { background: accent } : undefined}>
                {label}
              </button>
            );
          })}
          <button type="button" className="btn btn-soft btn-sm ml-auto" onClick={() => void reload()}>
            <FiRefreshCw size={12} /> Refresh
          </button>
        </div>

        <BarPanel
          title={SLA_METRIC_TABS.find((t) => t.key === metric)?.label ?? ""}
          data={series}
          accent={accent}
          note={SLA_LIVE_NOTE}
        />
      </div>

      {/* The same measurement, over time. The bars above are what the device reports this second;
          this is what the console stored while nobody was looking. */}
      {device && (
        <SLAHistoryPanel deviceId={device.id} checks={data} metric={metric} accent={accent} />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && device && (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => navigate(formURL())}>
            <FiPlus size={13} /> Create New
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-2.5">
          <FiSearch size={12} className="ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
            className="h-8 w-56 bg-transparent text-[12px] ink outline-none" />
        </div>
      </div>

      <div className="panel panel-flush">
        {viewState(shown.length) !== "error" && (
          <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: GRID }}>
            {["Name", "Detect Server", "Packet Loss", "Latency", "Jitter",
              "Failure Threshold", "Recovery Threshold", "Participants", ""].map((h, i) => (
                <span key={h || i} className="t-label">{h}</span>
              ))}
          </div>
        )}

        <DeviceStates
          state={data.length > 0 && shown.length === 0 ? "rows" : viewState(shown.length)}
          from={device?.name}
          noun="performance SLA"
          icon={<FiActivity />}
          error={error}
          onRetry={() => void reload()}
        >
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {data.length > 0 && shown.length === 0 && (
              <p className="px-4 py-6 text-center text-[12px] ink-3">
                No performance SLA matches that search
              </p>
            )}
            {shown.map((h, idx) => (
              <div key={h.name}
                className={`grid items-start px-4 py-2.5 surface-hover transition-colors ${
                  idx < shown.length - 1 ? "border-b hairline-2" : ""}`}
                style={{ gridTemplateColumns: GRID }}>
                <div className="min-w-0 pr-2">
                  <p className="truncate text-[12.5px] font-semibold ink" title={h.name}>{h.name}</p>
                  <p className="text-[10.5px] ink-3">
                    {probeModeLabel(h.detect_mode)}
                    {hasProbeTarget(h.detect_mode) ? ` · ${protocolLabel(h.protocol)}` : ""}
                    {hasLinkStatus(h.detect_mode) ? ` · every ${h.interval}ms` : ""}
                  </p>
                </div>

                {/* The device's own list stacks two servers, and names the system resolvers. */}
                <div className="min-w-0 pr-2">
                  {detectServerLines(h).length === 0 ? (
                    <span className="text-[12px] ink-3">—</span>
                  ) : detectServerLines(h).map((line) => (
                    <p key={line} className="m-0 truncate text-[12px] ink-2" title={line}>{line}</p>
                  ))}
                </div>

                {/* Blank, not zero, when the check does not select on that criterion: the device
                    resets an unused threshold to its default, and printing it would show a limit
                    nobody set. */}
                <span className="text-[12px] ink-2">{thresholdLabel(h, "packet-loss") || "—"}</span>
                <span className="text-[12px] ink-2">{thresholdLabel(h, "latency") || "—"}</span>
                <span className="text-[12px] ink-2">{thresholdLabel(h, "jitter") || "—"}</span>

                {/* Passive has no link status at all: the device keeps whatever was there but never
                    acts on it. */}
                <span className="text-[12px] ink-2">
                  {hasLinkStatus(h.detect_mode) ? h.failtime : "—"}
                </span>
                <span className="text-[12px] ink-2">
                  {hasLinkStatus(h.detect_mode) ? h.recoverytime : "—"}
                </span>

                <div className="min-w-0 pr-2">
                  <span className="truncate text-[12px] ink-2" title={participantsLabel(h)}>
                    {participantsLabel(h)}
                  </span>
                  {(h.live ?? []).map((l) => (
                    <span key={l.interface} className="chip mr-1 mt-1">
                      {l.interface}{l.status ? `: ${l.status}` : ""}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-1">
                  {isAdmin && (
                    <>
                      <button className="btn-icon" title="Edit performance SLA"
                        onClick={() => navigate(formURL(h.name))}>
                        <FiEdit2 size={13} />
                      </button>
                      <button className="btn-icon btn-icon--danger" title="Delete performance SLA"
                        onClick={() => setPendingDelete(h)}>
                        <FiTrash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DeviceStates>
      </div>

      <p className="text-right text-[11px] ink-3">
        {data.length} performance SLA{data.length !== 1 ? "s" : ""}
      </p>

      <SDWANDeleteConfirm
        open={pendingDelete !== null}
        what="performance SLA"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void runDelete()}
        detail={<><b className="ink">{pendingDelete?.name}</b> will be removed from {device?.name}.
          An SD-WAN rule that still selects on it will block the delete.</>}
      />
    </div>
  );
};

export default SDWANPage;

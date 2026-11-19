import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FiBarChart2, FiMapPin } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import type { TrafficLogRow } from "../../api/logs";
import { deviceClock, GROUP_LABEL, timeBuckets, topDestinations, type ResultGroup } from "./story";

// The two charts on the traffic log page.
//
//   When     connections over the entries' own time span, split by result — a flat line and a
//            burst of blocks are different facts, and the table shows neither
//   Where    the destinations that take the most connections, split by result — click one to see
//            only its entries
//
// Rules held to (the same as every chart in this console):
//   · Stacked here, unlike the drift page: all three groups are the same unit (connections), so the
//     stack's height IS the total, which is the thing a reader wants first.
//   · Three validated colours (resultHues.ts), a legend always, and a table view with the exact
//     numbers — the relief the validator asks for, and the accessible reading of both charts.
//   · One y-axis, integers only, recessive grid.
//
// Loaded lazily: recharts is the heaviest thing on the page and the table does not need it.

const AXIS = "#94a3b8";
const GRID = "#94a3b826";
const GROUPS: ResultGroup[] = ["ok", "problem", "blocked"];

type Props = {
  rows: TrafficLogRow[];
  hues: Record<ResultGroup, string>;
  onPivot: (expression: string) => void;
};

const Legend: React.FC<{ hues: Record<ResultGroup, string> }> = ({ hues }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    {GROUPS.map((g) => (
      <span key={g} className="t-meta inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: hues[g] }} aria-hidden />
        {GROUP_LABEL[g]}
      </span>
    ))}
  </div>
);

// Named ViewToggle rather than Toggle: it is not a switch, it is a choice between two views, and
// calling it Toggle put it in the same bucket as the nine real switches elsewhere in the console.
const ViewToggle: React.FC<{ view: "chart" | "table"; onChange: (v: "chart" | "table") => void; label: string }> = ({ view, onChange, label }) => (
  <div className="seg" role="radiogroup" aria-label={label}>
    {(["chart", "table"] as const).map((v) => (
      <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => onChange(v)} className={`seg-item${view === v ? " seg-item--on" : ""}`}>
        {v === "chart" ? "Chart" : "Table"}
      </button>
    ))}
  </div>
);

/** Hover card: the exact counts under the cursor, text in ink with a swatch for identity. */
const HoverCard: React.FC<{
  active?: boolean;
  label?: string | number;
  payload?: { payload?: Record<string, unknown> }[];
  hues: Record<ResultGroup, string>;
  title: (row: Record<string, unknown>, label: string) => string;
  hint?: string;
}> = ({ active, label, payload, hues, title, hint }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="rounded-[4px] px-2.5 py-1.5"
      style={{ background: "var(--shell-card)", border: "1px solid var(--shell-border)", boxShadow: "var(--shell-elev-lg)" }}>
      <p className="t-meta m-0 font-semibold">{title(row, String(label ?? ""))}</p>
      {GROUPS.map((g) => (
        <p key={g} className="t-meta tnum m-0 flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hues[g] }} aria-hidden />
          <span className="ink-2">{GROUP_LABEL[g]}</span>
          <span className="ml-auto pl-3 font-bold ink">{Number(row[g] ?? 0)}</span>
        </p>
      ))}
      {hint && <p className="t-meta m-0 mt-0.5 ink-3">{hint}</p>}
    </div>
  );
};

const Card: React.FC<{
  title: string;
  icon: React.ReactNode;
  tint: string;
  view: "chart" | "table";
  onView: (v: "chart" | "table") => void;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, tint, view, onView, className = "", children }) => (
  <section className={`shell-card flex flex-col overflow-hidden ${className}`}>
    <header className="card-head">
      <h2 className="card-title t-card">
        <span className="medallion h-6 w-6 text-[12px]" style={{ color: tint, background: `${tint}1f` }}>{icon}</span>
        {title}
      </h2>
      <ViewToggle view={view} onChange={onView} label={`Show ${title} as a chart or a table`} />
    </header>
    <div className="flex-1 px-4 py-3">{children}</div>
  </section>
);

const TrafficCharts: React.FC<Props> = ({ rows, hues, onPivot }) => {
  const { currentMode } = useStateContext();
  // The 2px gap between stacked segments is drawn in the card's own colour.
  const gap = currentMode === "Dark" ? "#0f141e" : "#ffffff";
  const [timeView, setTimeView] = useState<"chart" | "table">("chart");
  const [destView, setDestView] = useState<"chart" | "table">("chart");

  const tz = rows[0]?.tz ?? "";
  const buckets = useMemo(() => timeBuckets(rows), [rows]);
  const spanDays = buckets.length > 1 && buckets[buckets.length - 1].at - buckets[0].at > 20 * 3_600_000;
  const timeRows = useMemo(
    () => buckets.map((b) => ({ ...b, label: deviceClock(b.at, tz, spanDays) })),
    [buckets, tz, spanDays],
  );
  const dests = useMemo(() => topDestinations(rows), [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card title="When: connections over time" icon={<FiBarChart2 />} tint={hues.ok} view={timeView} onView={setTimeView}>
        <div className="mb-2"><Legend hues={hues} /></div>
        {timeView === "table" ? (
          <div className="max-h-56 overflow-auto">
            <table className="shell-table">
              <thead><tr><th>From</th><th className="text-right">Allowed</th><th className="text-right">Reset or timed out</th><th className="text-right">Blocked</th></tr></thead>
              <tbody>
                {timeRows.filter((b) => b.ok + b.problem + b.blocked > 0).map((b) => (
                  <tr key={b.at}><td className="tnum">{b.label}</td><td className="td-num text-right">{b.ok}</td>
                    <td className="td-num text-right">{b.problem}</td><td className="td-num text-right">{b.blocked}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-52 min-w-0" role="img" aria-label="Connections over time, split by result">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
              <BarChart data={timeRows} margin={{ top: 4, right: 4, left: -4, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} axisLine={{ stroke: GRID }} tickLine={false}
                  interval="preserveStartEnd" minTickGap={24} />
                <YAxis allowDecimals={false} width={30} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--shell-hover, #94a3b81a)" }}
                  content={<HoverCard hues={hues} title={(_r, l) => `From ${l}`} />} />
                {GROUPS.map((g, i) => (
                  <Bar key={g} dataKey={g} stackId="t" fill={hues[g]} stroke={gap} strokeWidth={1}
                    radius={i === GROUPS.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={22} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="t-meta m-0 mt-2">Times are the FortiGate's own clock, like the table below.</p>
      </Card>

      <Card title="Where: top destinations" icon={<FiMapPin />} tint={hues.problem} view={destView} onView={setDestView}>
        <div className="mb-2"><Legend hues={hues} /></div>
        {destView === "table" ? (
          <div className="max-h-56 overflow-auto">
            <table className="shell-table">
              <thead><tr><th>Destination</th><th className="text-right">Allowed</th><th className="text-right">Reset or timed out</th><th className="text-right">Blocked</th></tr></thead>
              <tbody>
                {dests.map((d) => (
                  <tr key={d.key} className="cursor-pointer" onClick={() => onPivot(d.pivot)} title={`Search: ${d.pivot}`}>
                    <td className="font-mono text-[11px]">{d.label}</td><td className="td-num text-right">{d.ok}</td>
                    <td className="td-num text-right">{d.problem}</td><td className="td-num text-right">{d.blocked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height: Math.max(150, dests.length * 26 + 28) }} role="img" aria-label="Top destinations, split by result">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
              <BarChart data={dests} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%"
                onClick={(e) => {
                  // Clicking a bar filters the log to that destination — the chart is a way in.
                  const i = typeof e?.activeTooltipIndex === "number" ? e.activeTooltipIndex : Number(e?.activeTooltipIndex);
                  if (Number.isInteger(i) && dests[i]) onPivot(dests[i].pivot);
                }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 10 }} axisLine={{ stroke: GRID }} tickLine={false} />
                {/* Destination names are the device's words — never translated. */}
                <YAxis type="category" dataKey="label" width={170} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip cursor={{ fill: "var(--shell-hover, #94a3b81a)" }}
                  content={<HoverCard hues={hues} title={(r) => String(r.key ?? "")} hint="Click to see only these entries" />} />
                {GROUPS.map((g, i) => (
                  <Bar key={g} dataKey={g} stackId="d" fill={hues[g]} stroke={gap} strokeWidth={1}
                    radius={i === GROUPS.length - 1 ? [0, 3, 3, 0] : 0} maxBarSize={14} isAnimationActive={false}
                    className="cursor-pointer" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="t-meta m-0 mt-2">Click a destination to show only its entries.</p>
      </Card>
    </div>
  );
};

export default TrafficCharts;

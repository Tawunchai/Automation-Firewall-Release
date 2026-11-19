import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FiBarChart2, FiLayers } from "react-icons/fi";
import { Widget, WidgetError } from "../dashboard/widgets";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSeriesHues } from "./series";
import type { DriftAnalytics } from "../../api/drift";
import {
  busiestDay, compact, dayLabel, isQuietWindow, tableRows, tickInterval,
} from "./analytics";

// The analysis half of Configuration Drift: two charts, both halves of "what changed on this
// firewall" side by side. The four stat tiles above the list are in tiles.tsx — they need no chart
// library and double as the list's filters, so they render before this chunk has downloaded.
//
// Chart rules held to (the same ones the dashboard charts follow):
//   · Two series, and they are the SAME two series in both charts, in the same colours — "through
//     this console" and "outside it". A reader who learns the colours on one chart can read the
//     other without the legend.
//   · Side-by-side bars, never stacked. A ledger row is one write and a drift finding is one object
//     that differed between two backups; stacking them would draw a total that is not a number of
//     anything.
//   · One y-axis, integers only, grid recessive. Rejected writes never changed the device, so they
//     are not a third bar: they are a tile and a tooltip line.
//   · The palette is the dashboard's validated pair (METRIC_HUES slots 1–2). In light mode the cyan
//     is below 3:1 against the card, which the validator allows only with relief — so every chart
//     carries a table view with the exact numbers.
//
// Loaded lazily by the page: recharts is the heaviest thing on it, and the drift and ledger lists
// underneath do not need it to render.

const AXIS = "#94a3b8";
const GRID = "#94a3b826";

type Series = { key: "console" | "outside"; label: string; color: string };

const useSeries = (): Series[] => {
  const { consoleHue, outsideHue } = useSeriesHues();
  return useMemo(() => [
    { key: "console", label: "Through this console", color: consoleHue },
    { key: "outside", label: "Outside the console", color: outsideHue },
  ], [consoleHue, outsideHue]);
};

/** Swatch + name. Always shown: both charts draw two series. */
const Legend: React.FC<{ series: Series[] }> = ({ series }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    {series.map((s) => (
      <span key={s.key} className="t-meta inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
        {s.label}
      </span>
    ))}
  </div>
);

/** The hover card: exact values under the cursor, text in ink with a swatch for identity. */
const ChartTooltip: React.FC<{
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number; payload?: Record<string, unknown> }[];
  series: Series[];
  title: (label: string) => string;
}> = ({ active, label, payload, series, title }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const failed = typeof row.failed === "number" ? row.failed : 0;
  return (
    <div className="rounded-[4px] px-2.5 py-1.5"
      style={{ background: "var(--shell-card)", border: "1px solid var(--shell-border)", boxShadow: "var(--shell-elev-lg)" }}>
      <p className="t-meta m-0 font-semibold">{title(String(label ?? ""))}</p>
      {series.map((s) => (
        <p key={s.key} className="t-meta tnum m-0 flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
          <span className="ink-2">{s.label}</span>
          <span className="ml-auto pl-3 font-bold ink">{Number(row[s.key] ?? 0)}</span>
        </p>
      ))}
      {failed > 0 && <p className="t-meta m-0 mt-0.5 ink-3">{`${failed} rejected by the device`}</p>}
    </div>
  );
};

/** Chart ↔ table switch. The table is the accessible reading of the same numbers, not a fallback. */
const ViewToggle: React.FC<{ view: "chart" | "table"; onChange: (v: "chart" | "table") => void }> = ({
  view, onChange,
}) => (
  <div className="seg">
    {(["chart", "table"] as const).map((v) => (
      <button key={v} type="button" onClick={() => onChange(v)}
        className={`seg-item${view === v ? " seg-item--on" : ""}`}>
        {v === "chart" ? "Chart" : "Table"}
      </button>
    ))}
  </div>
);

// ── "Where changes land" donut ─────────────────────────────────────────────────
// A categorical breakdown: each slice is one FortiOS table, sized by its TOTAL changes
// (console + outside). The console/outside split stays in the table view — a donut encodes a single
// dimension, and "where" is which table. The 7-hue set is the app's validated categorical palette
// (dataviz skill; adjacent-pair CVD ΔE ≥ 8, normal-vision ≥ 15 in both modes). In light mode three
// of the fills sit below 3:1 on the card, which the validator allows only with relief — so every
// slice carries its value and percent in the legend beside it, and the table view holds the same
// numbers. Tables past the 6 largest fold into a single neutral "Other" slice rather than cycling
// the palette, as categorical colour must never be reused for a different entity.
const DONUT_HUES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"],
};
const OTHER_HUE = "#94a3b8";
const MAX_SLICES = 6;

type Slice = { label: string; value: number; color: string };

function buildSlices(rows: { label: string; console: number; outside: number }[], hues: string[]): Slice[] {
  const totals = rows
    .map((t) => ({ label: t.label, value: t.console + t.outside }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  // Up to 7 tables each take their own fixed hue; an 8th-and-beyond set folds into "Other".
  if (totals.length <= MAX_SLICES + 1) {
    return totals.map((s, i) => ({ ...s, color: hues[i % hues.length] }));
  }
  const head = totals.slice(0, MAX_SLICES).map((s, i) => ({ ...s, color: hues[i] }));
  const other = totals.slice(MAX_SLICES).reduce((sum, s) => sum + s.value, 0);
  return [...head, { label: "Other", value: other, color: OTHER_HUE }];
}

const DonutTooltip: React.FC<{
  active?: boolean;
  payload?: { value?: number; payload?: Slice }[];
  total: number;
}> = ({ active, payload, total }) => {
  if (!active || !payload?.length) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;
  const pct = total ? Math.round((slice.value / total) * 100) : 0;
  return (
    <div className="rounded-[4px] px-2.5 py-1.5"
      style={{ background: "var(--shell-card)", border: "1px solid var(--shell-border)", boxShadow: "var(--shell-elev-lg)" }}>
      <p className="t-meta m-0 flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden />
        <span className="ink-2">{slice.label}</span>
        <span className="ml-auto pl-3 font-bold ink tnum">{slice.value}</span>
        <span className="ink-3">· {pct}%</span>
      </p>
    </div>
  );
};

const WhereChangesLandDonut: React.FC<{ slices: Slice[]; total: number }> = ({ slices, total }) => (
  // h-full + justify-center so the donut sits in the MIDDLE of the card's height rather than at the
  // top — this card is as tall as the "Changes per day" chart beside it, and left-aligned to the top
  // it left a big empty band underneath.
  <div className="flex h-full flex-col items-center justify-center gap-5">
    {/* The donut itself, large and centred — the magnitude is the point, so it gets the room. */}
    <div className="relative h-72 w-72 shrink-0" role="img"
      aria-label={`Changes by FortiOS table — ${slices.map((s) => `${s.label}: ${s.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="92%"
            paddingAngle={2} stroke="var(--shell-card)" strokeWidth={2} isAnimationActive={false}>
            {slices.map((s) => <Cell key={s.label} fill={s.color} />)}
          </Pie>
          <Tooltip content={<DonutTooltip total={total} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-bold leading-none ink tnum">{total}</span>
        <span className="t-meta mt-1">changes</span>
      </div>
    </div>
    {/* Direct-labelled legend, UNDER the donut in small type — the relief the light-mode contrast
        WARN requires: every slice's value and share are read here, never colour alone. */}
    <div className="grid w-full grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
      {slices.map((s) => {
        const pct = total ? Math.round((s.value / total) * 100) : 0;
        return (
          <div key={s.label} className="flex items-center gap-1.5 text-[10.5px]">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="truncate font-mono ink-2" title={s.label}>{s.label}</span>
            <span className="ml-auto pl-2 tnum font-semibold ink">{s.value}</span>
            <span className="tnum w-8 text-right ink-3">{pct}%</span>
          </div>
        );
      })}
    </div>
  </div>
);

// ── The panel ─────────────────────────────────────────────────────────────────

const AnalyticsPanel: React.FC<{
  data: DriftAnalytics | null;
  loading: boolean;
  error: string | null;
  days: number;
}> = ({ data, loading, error, days }) => {
  const series = useSeries();
  const { currentMode } = useStateContext();
  const [dailyView, setDailyView] = useState<"chart" | "table">("chart");
  const [tableView, setTableView] = useState<"chart" | "table">("chart");

  const quiet = isQuietWindow(data);
  const daily = useMemo(() => data?.daily ?? [], [data]);
  const tables = useMemo(() => tableRows(data?.tables ?? []), [data]);
  const peakOutside = useMemo(() => busiestDay(daily, "outside"), [daily]);
  const donutHues = currentMode === "Dark" ? DONUT_HUES.dark : DONUT_HUES.light;
  const slices = useMemo(() => buildSlices(tables, donutHues), [tables, donutHues]);
  const donutTotal = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);
  const windowText = `last ${days} days`;

  const quietState = (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1.5 text-center">
      <FiBarChart2 size={22} className="ink-3 opacity-40" />
      <p className="t-body m-0 ink-2">{`Nothing changed in the ${windowText}`}</p>
      <p className="t-meta m-0">Neither through this console nor, as far as the backups show, outside it</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {error && <WidgetError message={error} />}

      <div className="grid gap-3 xl:grid-cols-5">
        {/* ── Changes per day ─────────────────────────────────────────── */}
        <Widget
          title="Changes per day"
          icon={<FiBarChart2 />}
          accent={series[0].color}
          className="xl:col-span-3"
          action={<ViewToggle view={dailyView} onChange={setDailyView} />}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Legend series={series} />
            {peakOutside && (
              <span className="t-meta">{`Most outside changes: ${dayLabel(peakOutside.date)} (${peakOutside.outside})`}</span>
            )}
          </div>
          {loading && !data ? (
            <span className="shell-skeleton block h-80 w-full" />
          ) : quiet ? quietState : dailyView === "table" ? (
            <div className="max-h-80 overflow-auto">
              <table className="shell-table">
                <thead>
                  <tr><th>Day</th><th className="text-right">Console</th><th className="text-right">Outside</th><th className="text-right">Rejected</th></tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => (
                    <tr key={d.date}>
                      <td>{dayLabel(d.date)}</td>
                      <td className="td-num text-right">{d.console}</td>
                      <td className="td-num text-right">{d.outside}</td>
                      <td className="td-num text-right ink-3">{d.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-80 min-w-0" role="img" aria-label="Changes per day, through this console and outside it">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
                <BarChart data={daily} margin={{ top: 4, right: 4, left: -4, bottom: 0 }} barGap={3} barCategoryGap="10%">
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} interval={tickInterval(daily.length)}
                    tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={4} />
                  <YAxis allowDecimals={false} width={32} tick={{ fill: AXIS, fontSize: 11 }}
                    axisLine={false} tickLine={false} tickFormatter={(v: number) => compact(v)} />
                  <Tooltip cursor={{ fill: "var(--shell-hover, #94a3b81a)" }}
                    content={<ChartTooltip series={series} title={dayLabel} />} />
                  {/* Wider, barely-rounded columns — the "blocky" look of the Local Traffic chart,
                      not the thin ticks these were before. */}
                  {series.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color}
                      radius={[2, 2, 0, 0]} maxBarSize={38} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="t-meta m-0 mt-2">
            Outside changes are dated by the backup that revealed them, not by when they were made — a
            change is only seen once the next backup has been compared.
          </p>
        </Widget>

        {/* ── Where changes land ──────────────────────────────────────── */}
        <Widget
          title="Where changes land"
          icon={<FiLayers />}
          accent={series[1].color}
          className="xl:col-span-2"
          action={<ViewToggle view={tableView} onChange={setTableView} />}
        >
          {loading && !data ? (
            <span className="shell-skeleton block h-56 w-full" />
          ) : quiet || tables.length === 0 ? quietState : tableView === "table" ? (
            <div className="max-h-64 overflow-auto">
              <table className="shell-table">
                <thead>
                  <tr><th>FortiOS table</th><th className="text-right">Console</th><th className="text-right">Outside</th></tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.table}>
                      <td className="font-mono text-[11px]">{t.label}</td>
                      <td className="td-num text-right">{t.console}</td>
                      <td className="td-num text-right">{t.outside}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <WhereChangesLandDonut slices={slices} total={donutTotal} />
          )}
        </Widget>
      </div>
    </div>
  );
};

export default AnalyticsPanel;

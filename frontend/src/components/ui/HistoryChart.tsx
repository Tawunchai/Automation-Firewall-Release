import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceDot,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { MetricPoint } from "../../api/metrics";
import { axisMode, mergeSeriesRows, seriesKey, type AxisMode } from "./historyRows";

/**
 * One chart of stored history, shared by every page that has some.
 *
 * ── The rules it enforces so callers cannot get them wrong ───────────────────
 *
 * ONE AXIS. There is no prop for a second y-scale, because two measures of different scale on one
 * chart is the mistake that makes a reader compare things that cannot be compared. Latency and
 * jitter share a chart legitimately — both milliseconds; packet loss is a percentage and gets its
 * own. The caller decides by making two charts.
 *
 * A LEGEND WHENEVER THERE ARE TWO OR MORE SERIES, so identity is never carried by colour alone. A
 * single series needs none: the title names it.
 *
 * COLOURS COME FROM THE CONSOLE'S OWN TOKENS, in a fixed order, never cycled — the same entity keeps
 * its colour when a filter changes the series count. The four were checked for colour-blind
 * separation rather than chosen by eye (worst adjacent pair ΔE 9.3 deutan, 23.3 normal vision).
 */

/**
 * Fixed order. A ninth series is not a generated hue — it is a sign the chart is doing too much.
 *
 * Same four hues as the dashboard's own `ICON_CHIP` family (teal / orange / blue / red) rather than
 * the previous unrelated set, so a chart on this page and a KPI card on the dashboard read as the
 * same design rather than two different ones that happen to share a shell.
 */
const SERIES_COLORS = ["#24997c", "#e8830f", "#3e7ead", "#d0504c"] as const;

const AXIS = "#94a3b8";
const GRID = "#94a3b826";
/** Dastone's column chart draws a real axis line and solid gridlines, at its own two greys. */
const BAR_AXIS = "#bec7e0";
const BAR_GRID = "#94a3b81f";

export type HistorySeries = {
  /** Identity, and what the legend shows. */
  label: string;
  points: MetricPoint[];
  /** Overrides the palette — for a series whose colour means something (a threshold, a status). */
  color?: string;
};

export type HistoryChartProps = {
  series: HistorySeries[];
  /** The unit, once, on the axis — never repeated on every point. */
  unit?: string;
  /** Drawn as a filled area instead of a line. For one series where the magnitude is the point. */
  area?: boolean;
  /**
   * Drawn as GROUPED COLUMNS instead of a line — Dastone's own "Basic Column Chart", ported from
   * its compiled config rather than eyeballed: 55% column width, a 2px gap inside a group, rounded
   * tops, horizontal gridlines only, and a visible grey axis line with ticks.
   *
   * ⚠️ A bar chart needs a readable number of categories. Pass series that have already been
   * bucketed (lib/bucket.ts) — handing this two thousand five-minute samples draws a solid block,
   * and this component deliberately does not bucket for you, because the right reduction (sum for
   * a counter, average for a gauge) is the CALLER's to know.
   */
  bar?: boolean;
  height?: number;
  /** A horizontal reference line: an SLA threshold, a capacity limit. */
  threshold?: { value: number; label: string };
  /** Formats a value for the axis and the tooltip. Defaults to a short number. */
  format?: (v: number) => string;
  /** Fixes the y-axis top. Percentages want 100 so a flat 2% does not fill the panel. */
  max?: number;
  /** Shown instead of the plot when there is nothing yet. */
  emptyText?: string;
  /** "linear" draws straight segments between points (Dastone's `stroke.curve: "straight"`)
      instead of the smoothed monotone spline every other chart on the console still uses. */
  curve?: "monotone" | "linear";
  /** Which axis gets dashed gridlines. Every existing chart keeps "horizontal"; a caller that wants
      Dastone's own vertical-rule-per-tick look (its own Audience Overview chart) opts into
      "vertical" instead of this console growing a second, differently-styled chart component. */
  gridAxis?: "horizontal" | "vertical";
  /** The area fill's top/bottom opacity stops. Dastone's own area charts are a near-flat 5% tint
      rather than this console's default fade-to-nothing gradient. */
  areaOpacity?: [number, number];
  /** Marks the single highest real sample across every series with a filled dot and a floating
      value pill — the same reads-as-a-callout move as Dastone's "50k" annotation, but tied to an
      actual data point rather than a fixed decorative position, since this console never draws a
      number that isn't real. */
  peakLabel?: boolean;
  /** Dastone's own Audience Overview hides its legend outright (`legend:{show:false}`) — color
      alone is enough once a tooltip and, usually, an axis label carry the rest. Every existing
      caller keeps the default two-or-more-series legend. */
  legend?: boolean;
  /** Lets the viewer narrow the visible window by scrolling over the chart, and widen it back out
      — a cheap read-only zoom, not a data-fetch: it slices the same `series` already in memory.
      Off by default so a chart embedded in a scrolling page doesn't start eating the page's own
      scroll the moment the cursor crosses it. */
  wheelZoom?: boolean;
};

const shortNumber = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
};

/** Axis ticks. See axisMode: the middle case is a window that crosses midnight. */
const tickFormatter = (mode: AxisMode) => (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (mode === "day") return day;
  return mode === "dayTime" ? `${day} ${time}` : time;
};

const HistoryTooltip: React.FC<{
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number; color?: string }[];
  format: (v: number) => string;
  unit?: string;
}> = ({ active, label, payload, format, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[4px] border hairline surface-card px-3 py-2 shadow-lg">
      <p className="mb-1 text-[11px] ink-3">{label ? new Date(label).toLocaleString() : ""}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] ink">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="ink-2">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums">
            {format(p.value ?? 0)}{unit ? ` ${unit}` : ""}
          </span>
        </p>
      ))}
    </div>
  );
};

const HistoryChart: React.FC<HistoryChartProps> = ({
  series, unit, area = false, bar = false, height = 200, threshold, format = shortNumber, max, emptyText,
  curve = "monotone", gridAxis = "horizontal", areaOpacity = [0.4, 0.04], peakLabel = false,
  legend = true, wheelZoom = false,
}) => {
  // Recharts wants one row per x with a column per series. The column is POSITIONAL (see
  // historyRows) because a dataKey is a path: a series labelled "port1.100" keyed by its own name
  // would be looked up as row.port1["100"] and drawn as nothing at all.
  const { rows, mode } = useMemo(() => {
    const merged = mergeSeriesRows(series);
    return { rows: merged, mode: axisMode(merged) };
  }, [series]);

  const colored = series.map((s, i) => ({
    ...s,
    color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
    key: seriesKey(i),
  }));

  // Scroll-to-zoom: an index window into `rows`, not a second data fetch. Resets whenever the
  // underlying series changes shape (a new history window, a different picked interface) — a held
  // zoom pointed at data that no longer exists would silently show the wrong slice.
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const zoomHostRef = useRef<HTMLDivElement>(null);
  const rowCount = rows.length;

  // Adjusting state during render (not in an effect) when a prop the state depends on changes —
  // the pattern React itself recommends over useEffect for this, and the one way to reset without
  // a cascading extra render each time the series shape changes.
  const [zoomedRowCount, setZoomedRowCount] = useState(rowCount);
  if (rowCount !== zoomedRowCount) {
    setZoomedRowCount(rowCount);
    setZoomRange(null);
  }

  useEffect(() => {
    if (!wheelZoom) return;
    const el = zoomHostRef.current;
    if (!el) return;
    const MIN_POINTS = 6;
    const onWheel = (e: WheelEvent) => {
      if (rowCount <= MIN_POINTS) return;
      e.preventDefault();
      setZoomRange((prev) => {
        const [start, end] = prev ?? [0, rowCount - 1];
        const span = end - start + 1;
        const step = Math.max(1, Math.round(span * 0.12));
        let nextStart = start;
        let nextEnd = end;
        if (e.deltaY < 0) {
          // Zoom in, centred on the current window.
          nextStart = start + step;
          nextEnd = end - step;
          if (nextEnd - nextStart + 1 < MIN_POINTS) {
            const mid = (start + end) / 2;
            nextStart = Math.round(mid - MIN_POINTS / 2);
            nextEnd = nextStart + MIN_POINTS - 1;
          }
        } else {
          nextStart = start - step;
          nextEnd = end + step;
        }
        nextStart = Math.max(0, nextStart);
        nextEnd = Math.min(rowCount - 1, nextEnd);
        return nextStart === 0 && nextEnd === rowCount - 1 ? null : [nextStart, nextEnd];
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelZoom, rowCount]);

  const visibleRows = zoomRange ? rows.slice(zoomRange[0], zoomRange[1] + 1) : rows;

  const peak = useMemo(() => {
    if (!peakLabel) return null;
    let best: { at: string; value: number; color: string } | null = null;
    for (const row of visibleRows) {
      for (const s of colored) {
        const v = (row as Record<string, unknown>)[s.key];
        if (typeof v === "number" && (!best || v > best.value)) {
          best = { at: row.at as string, value: v, color: s.color };
        }
      }
    }
    return best;
  }, [peakLabel, visibleRows, colored]);

  if (rows.length === 0) {
    return (
      <div className="flex min-w-0 items-center justify-center rounded-[4px] border border-dashed hairline"
        style={{ height }}>
        <p className="text-[12px] ink-3">{emptyText ?? "No history yet — the first samples arrive within five minutes."}</p>
      </div>
    );
  }

  // Dastone's own column palette, lifted from its compiled apexcharts init rather than sampled
  // from a screenshot: a pale blue wash, the primary violet, a soft amber. Only used in bar mode —
  // the line/area charts keep SERIES_COLORS, whose four hues were checked for colour-blind
  // separation and whose first member is nowhere near this faint.
  //
  // ⚠️ That faintness is Dastone's call, not an accident: `rgba(42,118,244,.18)` is an 18% wash,
  // which is legible as a filled column against a white card and much weaker than anything else
  // this console draws. It is used because the brief was to match the reference; a series whose
  // identity has to survive a projector or a printout wants SERIES_COLORS instead.
  // Solid, saturated columns rather than Dastone's pale washes: the one page that draws these
  // (Rule Lifecycle's hit history) asked for the blocky, legible look of the Local Traffic chart,
  // where a column reads as a real quantity on a projector or a printout, not a faint tint.
  const BAR_COLORS = ["#3E7EAD", "#6F6AF8", "#F59E0B", "#22B783"];

  const Chart = bar ? BarChart : area ? AreaChart : LineChart;

  return (
    <div className="min-w-0 w-full">
      {/* A legend whenever identity could otherwise rest on colour alone — a tinted pill per
          series (the same `.badge-soft` shape every status chip in the console now uses) rather
          than a thin dash, so the chart's own identity line reads as part of this design instead
          of a leftover from before it. */}
      {legend && colored.length > 1 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {colored.map((s) => (
            <span
              key={s.label}
              className="badge-soft"
              style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* Double-click resets a wheel zoom — the discoverable counterpart to the scroll gesture
          itself, the same convention most chart libraries (ApexCharts, Plotly) already use. */}
      <div ref={zoomHostRef} className="relative" onDoubleClick={() => wheelZoom && setZoomRange(null)}>
        {wheelZoom && zoomRange && (
          <button
            type="button"
            onClick={() => setZoomRange(null)}
            className="badge-soft absolute right-1 top-0 z-10"
            style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)", cursor: "pointer" }}
          >
            Reset zoom
          </button>
        )}
        {/* minWidth={0} and a min-w-0 wrapper are both required, and for different reasons: the
            wrapper stops a GRID/FLEX item refusing to shrink below its content (min-width defaults to
            auto, so the chart grows with the window and never comes back), and minWidth stops
            recharts holding a floor of its own. debounce coalesces the resize storm a sidebar
            collapse produces into one re-measure. */}
        <ResponsiveContainer width="100%" height={height} minWidth={0} debounce={80}>
        {/* right: 26 so the LAST x tick has somewhere to sit. At 8 it was drawn half outside the
            card, which on a narrow window cut "12:01 PM" in half. left: 0 rather than the -12 it
            used to carry — the y axis measures itself now (see width below) and pulling the chart
            left of its own margin puts that measured axis back under the card's padding. */}
        <Chart data={visibleRows} margin={{ top: 6, right: 26, bottom: 0, left: bar && unit ? 10 : 2 }}
          {...(bar ? { barCategoryGap: "20%", barGap: 2, maxBarSize: 40 } : {})}>
          {/* A fading gradient fill rather than one flat opacity — the same move the reference's
              own area charts make, and already proven in this console by the KPI tiles' own
              sparkline (pages/dashboard/kpi.tsx). One gradient per series, keyed so two series
              sharing a page never reuse each other's def. */}
          {area && (
            <defs>
              {colored.map((s) => (
                <linearGradient key={`grad-${s.key}`} id={`history-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={areaOpacity[0]} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={areaOpacity[1]} />
                </linearGradient>
              ))}
            </defs>
          )}
          {/* Dastone's column chart keeps a solid horizontal rule per gridline and no vertical
              ones; its line charts are the dashed ones. */}
          <CartesianGrid stroke={bar ? BAR_GRID : GRID} strokeDasharray={bar ? "0" : "3 3"}
            vertical={bar ? false : gridAxis === "vertical"}
            horizontal={bar ? true : gridAxis === "horizontal"} />
          {/* The column chart draws its axis line and ticks (`axisBorder`/`axisTicks` at #bec7e0 in
              Dastone's own config); the line charts leave both off. */}
          <XAxis dataKey="at" tickFormatter={tickFormatter(mode)} tick={{ fontSize: 10.5, fill: AXIS }}
            axisLine={bar ? { stroke: BAR_AXIS } : false} tickLine={bar ? { stroke: BAR_AXIS } : false}
            // A dated tick is three times as wide as a bare clock time, so the gap it needs to stay
            // legible is not the same number.
            minTickGap={mode === "dayTime" ? 72 : 32} />
          {/* width="auto" (recharts 3) measures the widest tick this chart actually draws. The
              fixed 44px it replaced was right for "100" and wrong for "32.0 kbps": recharts broke
              the label across two lines to make it fit, and the second line was then clipped to
              ") bps" by the card. A caller cannot be asked to know the pixel width of its own
              number formatter. */}
          <YAxis tickFormatter={format} tick={{ fontSize: 10.5, fill: AXIS }}
            axisLine={bar ? { stroke: BAR_AXIS } : false} tickLine={bar ? { stroke: BAR_AXIS } : false}
            width="auto" domain={[0, max ?? "auto"]}
            label={bar && unit
              ? { value: unit, angle: -90, position: "insideLeft",
                  style: { fontSize: 11, fill: AXIS, textAnchor: "middle" } }
              : undefined} />
          <Tooltip content={<HistoryTooltip format={format} unit={unit} />} />

          {threshold && (
            // Drawn as a series rather than a ReferenceLine so it appears in the tooltip too: the
            // question is always "how far over was it", and a line you cannot read a value off
            // makes the reader estimate.
            <Line dataKey={() => threshold.value} name={threshold.label} stroke="#dc2626"
              strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          )}

          {bar && colored.map((s, i) => (
            // endingShape:"rounded" → a 3px radius on the top corners only; columnWidth 55% →
            // barCategoryGap below; the 2px transparent stroke Dastone uses to separate bars in a
            // group is barGap, which is the thing that stroke was faking.
            <Bar key={s.key} dataKey={s.key} name={s.label}
              fill={BAR_COLORS[i % BAR_COLORS.length]} radius={[3, 3, 0, 0]}
              isAnimationActive={false} />
          ))}

          {!bar && colored.map((s) =>
            area ? (
              <Area key={s.key} type={curve} dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2.5} fill={`url(#history-grad-${s.key})`}
                dot={false} connectNulls={false} isAnimationActive={false} />
            ) : (
              <Line key={s.key} type={curve} dataKey={s.key} name={s.label}
                stroke={s.color} strokeWidth={2} dot={false} connectNulls={false}
                isAnimationActive={false} />
            ),
          )}

          {peak && (
            <ReferenceDot x={peak.at} y={peak.value} r={5}
              fill={peak.color} stroke="var(--shell-card)" strokeWidth={3}
              label={(props: { viewBox?: { cx?: number; cy?: number } }) => {
                const cx = props.viewBox?.cx ?? 0;
                const cy = props.viewBox?.cy ?? 0;
                const text = `${format(peak.value)}${unit ? ` ${unit}` : ""}`;
                const w = 16 + text.length * 6.2;
                return (
                  <g>
                    <rect x={cx - w / 2} y={cy - 34} width={w} height={21} rx={5} fill={peak.color} />
                    <text x={cx} y={cy - 19} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
                      {text}
                    </text>
                  </g>
                );
              }} />
          )}
        </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default HistoryChart;

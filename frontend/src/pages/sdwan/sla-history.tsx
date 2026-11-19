import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiClock } from "react-icons/fi";
import HistoryChart from "../../components/ui/HistoryChart";
import { errorText } from "../../api/errorText";
import {
  DeviceGetMetricHistory, HISTORY_WINDOWS, windowRange,
  type HistoryWindowKey, type MetricSeries,
} from "../../api/metrics";
import type { SDWANHealthCheck } from "../../api/sdwan";
import type { SLAMetric } from "./slaFormat";
import {
  METRIC_KIND, MAX_PLOTTED, defaultSelection, metricUnit, sharedThreshold, summariseSLAHistory,
} from "./slaHistory";

/**
 * Was the link bad last night?
 *
 * The strip above answers "how is it right now", which is the only question a FortiGate can answer:
 * monitor/virtual-wan/health-check reports the present and keeps nothing at all. Every five minutes
 * the console stores those same three numbers, so the questions that actually decide whether a link
 * is meeting its contract — how often were we over the limit, when did it start, is it getting
 * worse — become answerable here and nowhere else in the product.
 *
 * ── Why a list beside the chart, and only four lines ─────────────────────────
 *
 * Members are ranked by the share of samples that breached the SLA, not by average, because those
 * rank differently and the breach share is the one that matters: a link 1ms over its limit for a
 * third of the night has failed its SLA, while a slower link that never crossed it has not. The
 * chart draws at most four of them, since the palette is four fixed colours and does not cycle — a
 * fifth line would wear a colour already spoken for.
 *
 * It follows the metric tabs above rather than carrying its own: one choice, two views of it.
 */

type Props = {
  deviceId: number;
  checks: SDWANHealthCheck[];
  metric: SLAMetric;
  accent: string;
};

const SLAHistoryPanel: React.FC<Props> = ({ deviceId, checks, metric, accent }) => {
  const [win, setWin] = useState<HistoryWindowKey>("7d");
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const kind = METRIC_KIND[metric];
  const unit = metricUnit(metric);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = windowRange(win);
      // No subject filter: the stored subjects are the members that were actually PROBED, which is
      // not the same list as the members configured today — a member removed last week still has
      // last week's history, and hiding it would quietly rewrite what happened.
      const res = await DeviceGetMetricHistory(
        deviceId, { kinds: [kind], from, to }, { strict: true },
      );
      setSeries(res.series);
    } catch (e) {
      setSeries([]);
      setError(errorText(e, "Could not read the stored history"));
    } finally {
      setLoading(false);
    }
  }, [deviceId, kind, win]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => summariseSLAHistory(series, checks, metric), [series, checks, metric]);

  // A selection made for one metric or window may not exist in the next one; whatever is left of it
  // is kept, and an empty result falls back to the worst few rather than an empty chart.
  const known = picked.filter((s) => rows.some((r) => r.subject === s));
  const shown = known.length > 0 ? known : defaultSelection(rows);

  const toggle = (subject: string) => {
    const next = shown.includes(subject)
      ? shown.filter((s) => s !== subject)
      : [...shown, subject].slice(-MAX_PLOTTED);
    setPicked(next);
  };

  const threshold = sharedThreshold(rows, shown);
  const plotted = shown
    .map((subject) => rows.find((r) => r.subject === subject))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ label: `${r.check} · ${r.member}`, points: r.points }));

  const decimals = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const GRID = "1fr 64px 64px 68px";

  return (
    <div className="panel">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded"
            style={{ backgroundColor: `${accent}15`, color: accent }}>
            <FiClock size={12} />
          </span>
          <div>
            <h3 className="m-0 text-[13px] font-semibold ink">Over time</h3>
            <p className="m-0 text-[11px] ink-3">
              Sampled every five minutes and kept for 90 days — the firewall keeps none of this itself
            </p>
          </div>
        </div>
        <div className="seg" role="radiogroup" aria-label="History window">
          {HISTORY_WINDOWS.map((w) => (
            <button key={w.key} type="button" role="radio" aria-checked={win === w.key}
              onClick={() => setWin(w.key)}
              className={`seg-item${win === w.key ? " seg-item--on" : ""}`}>
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="flex h-[180px] items-center justify-center rounded-[4px] border border-dashed hairline">
          <p className="m-0 text-[12px] ink-3">{error}</p>
        </div>
      ) : loading ? (
        <div className="h-[180px] rounded-[4px] shell-skeleton" />
      ) : rows.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center rounded-[4px] border border-dashed hairline">
          <p className="m-0 max-w-md text-center text-[12px] ink-3">
            No samples in this window. The console records these only while SD-WAN is probing, so a
            firewall with SD-WAN off has nothing to show here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1">
            <div className="grid px-2 pb-1" style={{ gridTemplateColumns: GRID }}>
              <span className="t-label">Member</span>
              <span className="t-label">Average</span>
              <span className="t-label">Worst</span>
              <span className="t-label text-right">Out of SLA</span>
            </div>
            {rows.map((r) => {
              const on = shown.includes(r.subject);
              // Colour states a fact, never decorates: amber once anything breached, red past a
              // tenth of the window, which is where a link stops being a blip and starts being the
              // reason a rule moved traffic.
              const breach = r.breachPct;
              const tone = breach === null || breach === 0 ? "ink-2"
                : breach < 10 ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400";
              return (
                <button key={r.subject} type="button" onClick={() => toggle(r.subject)}
                  aria-pressed={on}
                  className={`grid w-full items-center rounded-[4px] px-2 py-1.5 text-left transition surface-hover ${
                    on ? "ring-1" : ""}`}
                  style={{
                    gridTemplateColumns: GRID,
                    ...(on ? { boxShadow: `0 0 0 1px ${accent}55` } : {}),
                  }}>
                  <span className="min-w-0 pr-2">
                    <span className="block truncate font-mono text-[12px] ink" title={r.subject}>
                      {r.member}
                    </span>
                    <span className="block truncate text-[10.5px] ink-3" title={r.check}>
                      {r.check}
                    </span>
                  </span>
                  <span className="text-[12px] tabular-nums ink-2">
                    {r.avg === null ? "—" : `${decimals(r.avg)}${unit}`}
                  </span>
                  <span className="text-[12px] tabular-nums ink-2">
                    {r.worst === null ? "—" : `${decimals(r.worst)}${unit}`}
                  </span>
                  <span className={`text-right text-[12px] font-semibold tabular-nums ${tone}`}>
                    {breach === null ? "no limit set" : `${decimals(breach)}%`}
                  </span>
                </button>
              );
            })}
            <p className="m-0 px-2 pt-1 text-[10.5px] ink-3">
              Click a member to add or remove its line — up to four at once
            </p>
          </div>

          <div className="min-w-0">
            <HistoryChart
              series={plotted}
              unit={unit}
              height={220}
              format={(v) => decimals(v)}
              max={metric === "packet-loss" ? 100 : undefined}
              threshold={threshold === null ? undefined : { value: threshold, label: "SLA limit" }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SLAHistoryPanel;

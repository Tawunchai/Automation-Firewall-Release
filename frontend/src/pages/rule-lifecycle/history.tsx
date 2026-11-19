import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiActivity } from "react-icons/fi";
import HistoryChart from "../../components/ui/HistoryChart";
import { errorText } from "../../api/errorText";
import {
  DeviceGetMetricHistory, HISTORY_WINDOWS, windowRange,
  type HistoryWindowKey, type MetricSeries,
} from "../../api/metrics";
import { toRate } from "../../lib/hitRate";
import { bucketForWindow, bucketSeries } from "../../lib/bucket";

/**
 * When a rule went quiet.
 *
 * The table above this answers "is this rule dead", from the counter as it stands right now. It
 * cannot answer the question anybody actually asks next — WHEN did it stop? — because a FortiGate
 * keeps no history of its own hit counters. The console's sampler does (backend services/metrics.go)
 * and this is the first page to use it.
 *
 * ── Why a cumulative counter is charted as a delta ───────────────────────────
 *
 * The device reports total hits since boot, so the raw series only ever climbs and every rule looks
 * identical: a line going up. What matters is hits PER INTERVAL, which is the difference between
 * consecutive samples.
 *
 * A reboot resets the counter, so a difference can come out negative. That is not "minus four
 * thousand hits" — it is a boundary where the old total is gone, and it is dropped rather than
 * clamped to zero, because a zero there would read as "quiet at this moment" when the truth is
 * "unknown across this moment".
 */

type Props = {
  deviceId: number;
  /** The policies worth plotting, in the order the table shows them. */
  policies: { policyid: number; name: string }[];
  currentColor: string;
};

const MAX_LINES = 4;

const PolicyHitHistory: React.FC<Props> = ({ deviceId, policies, currentColor }) => {
  const [win, setWin] = useState<HistoryWindowKey>("7d");
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The busiest few. More than four lines on one chart stops being readable, and the rules nobody
  // can see on it are the ones with no traffic — which the table already lists plainly.
  const plotted = useMemo(() => policies.slice(0, MAX_LINES), [policies]);

  const load = useCallback(async () => {
    if (plotted.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const { from, to } = windowRange(win);
      const res = await DeviceGetMetricHistory(
        deviceId,
        { kinds: ["policy_hits"], subjects: plotted.map((p) => String(p.policyid)), from, to },
        { strict: true },
      );
      setSeries(res.series);
    } catch (e) {
      setSeries([]);
      setError(errorText(e, "Could not read the stored history"));
    } finally {
      setLoading(false);
    }
  }, [deviceId, win, plotted]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = (policyid: string) =>
    plotted.find((p) => String(p.policyid) === policyid)?.name || `Policy ${policyid}`;

  // Bucketed before plotting, because this is a COLUMN chart now: a seven-day window holds about
  // two thousand five-minute samples, and two thousand columns is a solid block. The width comes
  // from the window (lib/bucket.ts) so the same window always draws the same number of columns.
  const bucketMs = bucketForWindow(win);
  const lines = series
    .map((s) => ({ label: nameOf(s.subject), points: bucketSeries(toRate(s.points), bucketMs) }))
    .filter((s) => s.points.length > 0);

  if (plotted.length === 0) return null;

  return (
    <section className="mt-4 rounded-[4px] border hairline surface-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded"
            style={{ backgroundColor: `${currentColor}15`, color: currentColor }}>
            <FiActivity size={12} />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold ink">Hits over time</h2>
            <p className="text-[11px] ink-3">
              Matches per five-minute sample — the device itself keeps no history of these
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
        <div className="flex h-[420px] items-center justify-center rounded-[4px] border border-dashed hairline">
          <p className="text-[12px] ink-3">{error}</p>
        </div>
      ) : loading ? (
        <div className="h-[420px] rounded-[4px] shell-skeleton" />
      ) : (
        <HistoryChart
          series={lines}
          // Dastone's "Basic Column Chart", which is also the right form for this data: hits per
          // bucket is a magnitude per period, and a column says "this much, in this window" where
          // a line implies a value that existed continuously between two samples.
          bar
          unit="hits"
          height={420}
          emptyText={
            // Two different nothings, and the difference matters: a console that started sampling an
            // hour ago has no history YET, which is not the same as a rule with no traffic.
            "No hits recorded in this window. If the console was restarted recently, history starts from then."
          }
        />
      )}
    </section>
  );
};

export default PolicyHitHistory;

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiRefreshCw } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { GetDriftAnalytics, type DriftAnalytics, type TimelineFilter } from "../../api/drift";
import { DEFAULT_WINDOW, WINDOWS, errorText, type WindowDays } from "./analytics";
import { useSeriesHues } from "./series";
import StatusStrip from "./status-strip";
import DriftTiles from "./tiles";
import ChangeTimeline from "./timeline";
import ComparisonHistory from "./history";

// Configuration Drift — every change to a firewall, in ONE history, with how to take each back.
//
// This page used to be two lists — the Change Ledger and the drift findings — on two tabs, and a
// reader had to work out how they related before either made sense. They are one history from two
// sources, so they are one list now (services/drifttimeline.go), and the page reads top to bottom:
//
//   Backup comparison       when this firewall was last compared, and "Compare now"
//   Three numbers           each one filters the history to the changes it counts (ⓘ = what it counts)
//   Analysis                changes per day, and where they land — the three numbers over time
//   Change history          the list — each row: where it came from, what changed, Undo / Restore
//   Backup comparisons      the evidence behind the outside rows (collapsed)
//
// Everything follows the navbar's one device selection. /admin/change-ledger redirects here and
// lands on the console changes (?tab=ledger is still understood).

// recharts is the heaviest thing on the page and only the two charts need it.
const AnalyticsPanel = lazy(() => import("./analytics-panel"));

const FILTERS: TimelineFilter[] = ["all", "console", "outside", "failed"];

const readFilter = (params: URLSearchParams): TimelineFilter => {
  const show = params.get("show") as TimelineFilter | null;
  if (show && FILTERS.includes(show)) return show;
  // The old Change Ledger page's address, redirected here.
  if (params.get("tab") === "ledger") return "console";
  return "all";
};

const DriftPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { isAdmin } = useAuth();
  const { device, loading: deviceLoading } = useSelectedDevice();
  const deviceId = device?.id;
  const { consoleHue, outsideHue } = useSeriesHues();

  const [params, setParams] = useSearchParams();
  const filter = readFilter(params);
  const historyRef = useRef<HTMLDivElement>(null);

  const setFilter = (next: TimelineFilter, scroll = false) => {
    setParams((p) => {
      const q = new URLSearchParams(p);
      q.delete("tab");
      if (next === "all") q.delete("show"); else q.set("show", next);
      return q;
    }, { replace: true });
    if (scroll) historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [days, setDays] = useState<WindowDays>(DEFAULT_WINDOW);
  const [analytics, setAnalytics] = useState<DriftAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  // Bumped after anything writes (Undo, Restore, Compare now) or on Refresh; every
  // section re-reads when it changes, so the numbers, the list and the status never disagree.
  const [reloadKey, setReloadKey] = useState(0);

  // Only the newest request may write state — a slow answer for the previous window or device must
  // not land last and paint the wrong numbers.
  const seq = useRef(0);
  const loadAnalytics = useCallback(async () => {
    if (deviceLoading) return;
    const mine = ++seq.current;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const data = await GetDriftAnalytics({ days, device_id: deviceId });
      if (mine === seq.current) setAnalytics(data);
    } catch (e: unknown) {
      if (mine === seq.current) setAnalyticsError(errorText(e, "Could not compute the change analysis"));
    } finally {
      if (mine === seq.current) setAnalyticsLoading(false);
    }
  }, [days, deviceId, deviceLoading]);

  useEffect(() => { void loadAnalytics(); }, [loadAnalytics, reloadKey]);

  const refreshAll = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: the
          analysis window and the manual refresh. The outside/console totals it used to badge
          are not lost, just not repeated here — StatusStrip and the tiles below both already
          show them. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="seg" role="radiogroup" aria-label="Analysis window">
          {WINDOWS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`seg-item${days === d ? " seg-item--on" : ""}`}>
              {`${d} days`}
            </button>
          ))}
        </div>
        <button type="button" onClick={refreshAll} disabled={analyticsLoading}
          className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition disabled:opacity-50">
          <FiRefreshCw size={13} className={analyticsLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <StatusStrip isAdmin={isAdmin} accent={currentColor} reloadKey={reloadKey} onChanged={refreshAll} />

      <DriftTiles data={analytics} loading={analyticsLoading} days={days}
        consoleHue={consoleHue} outsideHue={outsideHue}
        filter={filter} onPick={(f) => setFilter(filter === f ? "all" : f, true)} />

      {/* The charts sit right under the numbers they break down — "Changes per day" is the three
          tiles spread over time — rather than below a 50-row list where nobody scrolls to them. */}
      <Suspense fallback={
        <div className="grid gap-3 xl:grid-cols-5" aria-busy="true">
          <span className="shell-skeleton block h-80 xl:col-span-3" />
          <span className="shell-skeleton block h-80 xl:col-span-2" />
        </div>
      }>
        <AnalyticsPanel data={analytics} loading={analyticsLoading} error={analyticsError} days={days} />
      </Suspense>

      <div ref={historyRef} className="scroll-mt-4">
        {!deviceLoading && (
          <ChangeTimeline isAdmin={isAdmin} deviceId={deviceId} deviceName={device?.name ?? ""}
            filter={filter} onFilter={(f) => setFilter(f)}
            consoleHue={consoleHue} outsideHue={outsideHue}
            reloadKey={reloadKey} onChanged={refreshAll} />
        )}
      </div>

      <ComparisonHistory deviceId={deviceId} reloadKey={reloadKey} accent={currentColor} />
    </div>
  );
};

export default DriftPage;

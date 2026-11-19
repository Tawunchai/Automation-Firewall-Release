import React, { useCallback, useEffect, useMemo, useState } from "react";
import HistoryChart from "../../components/ui/HistoryChart";
import Dropdown from "../../components/ui/Dropdown";
import { errorText } from "../../api/errorText";
import {
  DeviceGetMetricHistory, HISTORY_WINDOWS, windowRange,
  type HistoryWindowKey, type MetricSeries,
} from "../../api/metrics";
import {
  formatBitsPerSecond, summariseThroughput, type InterfaceThroughput,
} from "./throughput";
import { Widget, WidgetError } from "../dashboard/widgets";

/**
 * How much has actually gone through these ports.
 *
 * The table below says what each interface IS — its address, its role, whether the link is up. The
 * question that follows is how much it carries, and a FortiGate cannot answer it for yesterday: the
 * bandwidth widget in its own GUI is computed from two readings taken while you watch, and nothing
 * is kept. The console samples the same counters every five minutes, so this panel can.
 *
 * ── Receive and transmit on one chart, one interface at a time ───────────────
 *
 * Both directions are bits per second, so they share an axis honestly — and reading them together is
 * the point: a link that is saturated outbound while inbound sits idle is a different problem from
 * one that is busy both ways. Several interfaces at once would need several pairs of lines, so the
 * list picks one, ranked by how much it moved.
 */

type Props = { deviceId: number; accent: string };

const ThroughputPanel: React.FC<Props> = ({ deviceId, accent }) => {
  const [win, setWin] = useState<HistoryWindowKey>("24h");
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = windowRange(win);
      const res = await DeviceGetMetricHistory(
        deviceId, { kinds: ["if_rx_bytes", "if_tx_bytes"], from, to }, { strict: true },
      );
      setSeries(res.series);
    } catch (e) {
      setSeries([]);
      setError(errorText(e, "Could not read the stored history"));
    } finally {
      setLoading(false);
    }
  }, [deviceId, win]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => summariseThroughput(series), [series]);

  const chosen: InterfaceThroughput | undefined =
    rows.find((r) => r.name === picked) ?? rows[0];

  const windowOptions = HISTORY_WINDOWS.map((w) => ({ value: w.key, label: w.label }));
  const interfaceOptions = rows.map((r) => ({
    value: r.name,
    label: `${r.name} · peak ${formatBitsPerSecond(r.peakBps)}`,
  }));

  return (
    <Widget
      title="Throughput"
      accent={accent}
      plainTitle
      action={
        rows.length > 0 ? (
          <div className="flex items-center gap-2">
            <Dropdown
              value={chosen?.name ?? rows[0].name}
              options={interfaceOptions}
              onChange={setPicked}
              ariaLabel="Interface"
            />
            <Dropdown
              value={win}
              options={windowOptions}
              onChange={setWin}
              ariaLabel="History window"
            />
          </div>
        ) : undefined
      }
    >
      <p className="t-meta m-0 mb-3">
        Measured from the device's own byte counters every five minutes — it keeps no history of
        these itself
      </p>

      {error ? (
        <WidgetError message={error} />
      ) : loading ? (
        <div className="h-45 rounded-[4px] shell-skeleton" />
      ) : rows.length === 0 ? (
        <div className="flex h-45 items-center justify-center rounded-[4px] border border-dashed hairline">
          <p className="t-meta m-0 max-w-md text-center">
            No samples in this window yet. Ports with no link that have never carried a byte are not
            recorded at all, so a box with nothing plugged in stays empty here.
          </p>
        </div>
      ) : (
        /* Dastone's own "Audience Overview" card: the chart runs the card's full width, with the
           interface and window pickers moved into the header (above) instead of a side list eating
           into the plot — the same verbatim config as before (index.init.js): straight (not
           smoothed) lines in #06afdd / #f4a14d, vertical-only dashed gridlines, a near-flat 5% area
           fill, and a callout pill on the standout point, tied to the real peak sample. */
        <div className="min-w-0 w-full">
          <HistoryChart
            series={chosen ? [
              { label: "Received", points: chosen.rx, color: "#06afdd" },
              { label: "Transmitted", points: chosen.tx, color: "#f4a14d" },
            ] : []}
            area
            curve="linear"
            gridAxis="vertical"
            areaOpacity={[0.05, 0.05]}
            peakLabel
            legend={false}
            wheelZoom
            height={275}
            format={formatBitsPerSecond}
            emptyText="Not enough samples yet — a rate needs two readings, so the first one draws nothing"
          />
        </div>
      )}
    </Widget>
  );
};

export default ThroughputPanel;

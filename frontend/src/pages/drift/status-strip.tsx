import React, { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiClock, FiInfo, FiRefreshCw } from "react-icons/fi";
import Tooltip from "../../components/ui/Tooltip";
import { message } from "../../components/ui/toast";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { AnalyseDrift, GetDriftSummary, type DriftStatus, type DriftSummaryRow } from "../../api/drift";
import { formatDateTime } from "../../lib/datetime";
import { errorText } from "./analytics";

// Where the selected firewall's backup comparison stands, in one line: when it last ran, what it
// found, and — for an admin — the button that runs it now. Outside changes only appear once a
// comparison has run, so "when did we last look" is the context every outside row depends on.
//
// Firewalls OTHER than the selected one that still carry outside changes are named underneath, one
// click from switching the navbar to them: the page follows one device, but the question "is
// anything unaccounted for anywhere" is about all of them. A firewall leaves that line when its
// outside changes are undone — undoing is the only thing that closes one.

const STATUS: Record<DriftStatus, { label: string; chip: string; icon: React.ReactNode }> = {
  drift:    { label: "Outside changes found", chip: "chip-danger", icon: <FiAlertTriangle size={11} /> },
  clean:    { label: "Nothing unaccounted for", chip: "chip-ok", icon: <FiCheckCircle size={11} /> },
  baseline: { label: "First backup — baseline", chip: "chip-info", icon: <FiClock size={11} /> },
  error:    { label: "Comparison failed", chip: "chip-danger", icon: <FiAlertTriangle size={11} /> },
  never:    { label: "Never compared", chip: "", icon: <FiClock size={11} /> },
};

/** What "Backup comparison" is — shown by the ⓘ beside the label. */
const COMPARISON_MEANING =
  "Every backup reads the firewall's whole configuration. The console compares it with the previous backup, " +
  "subtracts the changes it recorded itself, and lists whatever is left as “Outside the console”. " +
  "It runs by itself after each backup; Compare now runs it on the two newest backups straight away.";

const StatusStrip: React.FC<{
  isAdmin: boolean;
  accent: string;
  reloadKey: number;
  onChanged: () => void;
}> = ({ isAdmin, accent, reloadKey, onChanged }) => {
  const { device, devices, setDevice } = useSelectedDevice();
  const [rows, setRows] = useState<DriftSummaryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await GetDriftSummary()).data);
    } catch {
      setRows([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const mine = rows.find((r) => r.network_device_id === device?.id);
  const others = rows.filter((r) => r.network_device_id !== device?.id && r.open_drift > 0);
  const meta = STATUS[mine?.status ?? "never"] ?? STATUS.never;

  const compare = async () => {
    if (!device) return;
    setBusy(true);
    try {
      const run = await AnalyseDrift(device.id);
      message.success(run.summary);
      await load();
      onChanged();
    } catch (e: unknown) {
      message.error(errorText(e, "The comparison failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!device || !loaded) return null;

  return (
    <section className="shell-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="t-label inline-flex items-center gap-1">
          Backup comparison
          <Tooltip title={COMPARISON_MEANING} placement="bottom">
            <button type="button" aria-label={COMPARISON_MEANING} className="btn-icon h-5 w-5 text-[12px] ink-3">
              <FiInfo />
            </button>
          </Tooltip>
        </span>
        <span className={`chip ${meta.chip} text-[10.5px]`}>{meta.icon} {meta.label}</span>
        <span className="t-meta">
          {mine?.last_run_at
            ? `Last compared ${formatDateTime(mine.last_run_at)}`
            : "Outside changes appear only after two backups have been compared"}
        </span>

        {isAdmin && (
          <button type="button" onClick={() => void compare()} disabled={busy || !mine?.backup_seen}
            title={mine?.backup_seen ? "Compare the two newest backups now" : "Take a backup from Devices first"}
            className="ml-auto inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[11.5px] font-semibold text-white transition disabled:opacity-40"
            style={{ backgroundColor: accent }}>
            <FiRefreshCw size={11} className={busy ? "animate-spin" : ""} />
            {busy ? "Comparing…" : "Compare now"}
          </button>
        )}
      </div>

      {mine && !mine.backup_seen && (
        <p className="t-meta m-0 mt-1.5 flex items-start gap-1 text-amber-600 dark:text-amber-400">
          <FiAlertTriangle size={11} className="mt-0.5 shrink-0" />
          No backup yet — take one from Devices before anything can be compared.
        </p>
      )}

      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t hairline-2 pt-2">
          <span className="t-meta">Other firewalls with outside changes still in place:</span>
          {others.map((o) => {
            const target = devices.find((d) => d.id === o.network_device_id);
            return (
              <button key={o.network_device_id} type="button" disabled={!target}
                onClick={() => target && setDevice(target)}
                className="chip chip-danger text-[10.5px] disabled:opacity-50">
                {`${o.device_name} (${o.open_drift})`}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default StatusStrip;

import React, { useCallback, useEffect, useState } from "react";
import {
  FiAlertTriangle, FiCheckCircle, FiChevronDown, FiChevronRight, FiClock, FiGitPullRequest,
  FiShield, FiEyeOff,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import Modal from "../../components/ui/Modal";
import { GetDriftRun, ListDriftRuns, type DriftRun, type DriftStatus } from "../../api/drift";
import { formatDateTime } from "../../lib/datetime";
import { errorText } from "./analytics";

// "Backup comparisons" — the record of every time two backups were compared for this firewall, and
// what each comparison found. Collapsed by default: the change history above is what people act on;
// this is the evidence behind its outside rows ("we checked at 02:07 and nothing had changed" is
// also an answer an auditor asks for).
//
// A comparison opens to ALL the objects it found, including the ones the console accounted for —
// the history above lists only the unaccounted ones, since the ledger already lists the rest. The
// actions (Undo, Restore) live on the history rows, not here, so there is one place
// to act and it cannot disagree with this one.

const STATUS: Record<DriftStatus, { label: string; chip: string; icon: React.ReactNode }> = {
  drift:    { label: "Outside changes", chip: "chip-danger", icon: <FiAlertTriangle size={11} /> },
  clean:    { label: "All accounted for", chip: "chip-ok", icon: <FiCheckCircle size={11} /> },
  baseline: { label: "Baseline", chip: "chip-info", icon: <FiClock size={11} /> },
  error:    { label: "Failed", chip: "chip-danger", icon: <FiAlertTriangle size={11} /> },
  never:    { label: "Not run", chip: "", icon: <FiClock size={11} /> },
};

const ACTION: Record<string, string> = { created: "Created", deleted: "Deleted", modified: "Changed" };

const COLS = "150px 1fr 110px 80px";

const ComparisonHistory: React.FC<{
  deviceId: number | undefined;
  reloadKey: number;
  accent: string;
}> = ({ deviceId, reloadKey, accent }) => {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<DriftRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DriftRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ListDriftRuns({ device_id: deviceId, page_size: 25 });
      setRuns(r.data);
      setTotal(r.total);
    } catch (e: unknown) {
      message.error(errorText(e, "Could not load the comparisons"));
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Read only once opened — most visits never expand it.
  useEffect(() => { if (open) void load(); }, [open, load, reloadKey]);

  const openRun = async (id: number) => {
    try {
      setDetail(await GetDriftRun(id));
    } catch (e: unknown) {
      message.error(errorText(e, "Could not load that comparison"));
    }
  };

  return (
    <section className="shell-card overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="card-head w-full text-left surface-hover transition">
        <h2 className="card-title t-card">
          <span className="medallion h-6 w-6 text-[12px]" style={{ color: accent, background: `${accent}1f` }}>
            <FiGitPullRequest />
          </span>
          Backup comparisons
        </h2>
        <span className="t-meta inline-flex items-center gap-1">
          {open ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
        </span>
      </button>

      {open && (
        <div>
          <p className="t-meta m-0 border-b hairline-2 px-4 py-2">
            Each row is one comparison of a backup with the one before it. Outside changes in the
            history above come from these.
          </p>
          <div className="grid border-b hairline-2 px-4 py-2" style={{ gridTemplateColumns: COLS }}>
            <span className="t-label">When</span>
            <span className="t-label">Result</span>
            <span className="t-label">Lines</span>
            <span className="t-label" />
          </div>
          {loading && runs.length === 0 ? (
            <p className="t-meta m-0 py-8 text-center">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="t-meta m-0 py-8 text-center">No comparison has run yet. Take a backup, or press “Compare now” above.</p>
          ) : runs.map((r) => {
            const meta = STATUS[r.status] ?? STATUS.never;
            return (
              <div key={r.id} className="grid items-center border-b hairline-2 px-4 py-2 last:border-0 surface-hover"
                style={{ gridTemplateColumns: COLS }}>
                <span className="text-[12px] ink-2">{formatDateTime(r.created_at)}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`chip ${meta.chip} shrink-0 text-[10px]`}>{meta.icon} {meta.label}</span>
                  <span className="truncate text-[12px] ink-2" title={r.summary}>{r.summary}</span>
                </span>
                <span className="font-mono text-[11px] ink-3">
                  <span className="text-emerald-600 dark:text-emerald-400">+{r.lines_added}</span>
                  {" / "}
                  <span className="text-red-600 dark:text-red-400">−{r.lines_removed}</span>
                </span>
                <span className="text-right">
                  <button type="button" onClick={() => void openRun(r.id)}
                    className="rounded-[4px] border hairline px-2.5 py-1 text-[11px] font-semibold ink-2 surface-hover transition">
                    Open
                  </button>
                </span>
              </div>
            );
          })}
          {total > runs.length && (
            <p className="t-meta m-0 px-4 py-2">{`Showing the newest ${runs.length} of ${total}`}</p>
          )}
        </div>
      )}

      {detail && (
        <Modal open width="max-w-4xl" onClose={() => setDetail(null)}
          title={
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">
                {`Backup #${detail.from_backup_id} → #${detail.to_backup_id}`}
              </p>
              <p className="truncate text-[14px] font-semibold ink">{formatDateTime(detail.created_at)}</p>
            </div>
          }>
          <div className="space-y-3">
            <p className="text-[12px] ink-2">{detail.summary}</p>
            {detail.error_text && (
              <p className="rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
                {detail.error_text}
              </p>
            )}
            {(detail.findings?.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-[13px] ink-3">
                {detail.status === "baseline"
                  ? "This was the device's first backup — there was nothing to compare it against."
                  : "Nothing changed between these two backups."}
              </p>
            ) : (
              <div className="overflow-hidden rounded-[4px] border hairline">
                {detail.findings!.map((f) => (
                  <div key={f.id} className="border-b hairline-2 px-4 py-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {f.attributed ? (
                        <span className="chip chip-ok text-[10px]"><FiShield size={10} /> This console</span>
                      ) : (
                        <span className="chip chip-danger text-[10px]"><FiEyeOff size={10} /> Outside the console</span>
                      )}
                      <span className="text-[11.5px] font-semibold ink">{ACTION[f.action] ?? f.action}</span>
                      <span className="font-mono text-[11.5px] ink-2">{f.table}</span>
                      {f.resource_key && <span className="font-mono text-[11.5px] font-semibold ink">{f.resource_key}</span>}
                      {f.attributed && f.attributed_to && <span className="t-meta ml-auto">{f.attributed_to}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="t-meta m-0">Undo and Restore are on the matching rows of the change history.</p>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default ComparisonHistory;

import React, { useEffect, useState } from "react";
import { FiAlertTriangle, FiRotateCcw, FiXCircle, FiClock, FiFileText, FiCpu } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import { message } from "../../components/ui/toast";
import { GetRollbackPreview, RollbackBackup, type RollbackPreview, type ConfigBackup } from "../../api/device";
import { formatDateTime } from "../../lib/datetime";
import { apiErrorDetail } from "../../api/errorText";

/**
 * The confirm step for restoring a whole configuration.
 *
 * The old flow was a two-line confirm() — "this pushes the stored config back to the device" —
 * on an operation that, done properly, REBOOTS the firewall and replaces its entire
 * configuration. It is not something to agree to from one sentence, so this asks the backend what
 * would actually happen and shows it:
 *
 *   - whether the stored text is a configuration file at all (blocking if not),
 *   - whether it came from this model and firmware (overridable, because a lab or a staged
 *     upgrade is a real reason to proceed),
 *   - and the two consequences that are never optional: the reboot, and the fact that everything
 *     configured since the backup was taken is gone.
 *
 * The confirm button stays disabled until the preview has loaded. Agreeing to something that has
 * not been shown yet is exactly the failure this replaces.
 */
const RestoreConfirmModal: React.FC<{
  /** Only the id is read — Configuration Drift opens this with just the backup it wants restored. */
  backup: Pick<ConfigBackup, "id"> | null;
  deviceName: string;
  onClose: () => void;
}> = ({ backup, deviceName, onClose }) => {
  const [preview, setPreview] = useState<RollbackPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  // The whole restore lives here rather than on the page: the preview that justifies it and the
  // call that performs it belong together, and the page has no use for either half on its own.
  const run = async (force: boolean) => {
    if (!backup) return;
    setBusy(true);
    try {
      const r = await RollbackBackup(backup.id, { force });
      onClose();
      // Not "queued": the firewall has taken the file and is rebooting into it. The old wording
      // invited people to refresh and wonder why the device had stopped answering.
      message.success(r.message);
    } catch (e) {
      message.error(apiErrorDetail(e, "Restore failed"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!backup) { setPreview(null); setAccepted(false); setLoadError(""); return; }
    setLoading(true);
    setLoadError("");
    setAccepted(false);
    GetRollbackPreview(backup.id)
      .then(setPreview)
      .catch((e) => setLoadError(e?.response?.data?.error || "Could not read this backup"))
      .finally(() => setLoading(false));
  }, [backup]);

  if (!backup) return null;

  const blocked = !!preview && !preview.valid;
  const mismatch = !!preview && preview.valid && !preview.compatible;
  const canRun = !!preview && preview.valid && accepted && !busy;

  return (
    <Modal
      open
      width="max-w-2xl"
      onClose={busy ? () => {} : onClose}
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-red-500 text-white">
            <FiRotateCcw size={14} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-500">Restore configuration</p>
            <p className="text-[14px] font-semibold ink">{deviceName}</p>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-9 rounded-[4px] border hairline px-4 text-[13px] font-semibold ink-2 surface-hover transition disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={!canRun}
            onClick={() => run(mismatch)}
            className="h-9 rounded-[4px] bg-red-500 px-5 text-[13px] font-semibold text-white transition disabled:opacity-40">
            {busy ? "Restoring…" : mismatch ? "Restore anyway" : "Restore and reboot"}
          </button>
        </div>
      }
    >
      {loading && <p className="py-8 text-center text-[13px] ink-3">Checking this backup…</p>}

      {!loading && loadError && (
        <div className="flex items-start gap-2 rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
          <FiXCircle size={14} className="mt-0.5 shrink-0" /> {loadError}
        </div>
      )}

      {!loading && preview && (
        <div className="space-y-3">
          {/* Facts */}
          <div className="grid gap-2 rounded-[4px] border hairline surface-sunken px-4 py-3 text-[12px]"
            style={{ gridTemplateColumns: "auto 1fr" }}>
            <span className="flex items-center gap-1.5 ink-3"><FiClock size={12} /> Taken</span>
            <span className="ink">{formatDateTime(preview.taken_at)}</span>

            <span className="flex items-center gap-1.5 ink-3"><FiFileText size={12} /> Size</span>
            <span className="ink">
              {preview.lines.toLocaleString()} lines · {(preview.size_bytes / 1024).toFixed(0)} KB
            </span>

            <span className="flex items-center gap-1.5 ink-3"><FiCpu size={12} /> From</span>
            <span className="ink font-mono text-[11px]">{preview.file_model || "unknown"}</span>

            {(preview.device_model || preview.device_version) && (
              <>
                <span className="flex items-center gap-1.5 ink-3"><FiCpu size={12} /> This device</span>
                <span className="ink font-mono text-[11px]">
                  {preview.device_model} {preview.device_version}
                </span>
              </>
            )}
          </div>

          {/* Blocking: not a config file */}
          {blocked && (
            <div className="flex items-start gap-2 rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10">
              <FiXCircle size={14} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">This backup cannot be restored.</p>
                <p className="mt-0.5">{preview.invalid_error}</p>
              </div>
            </div>
          )}

          {/* Advisory: wrong model or firmware */}
          {mismatch && (
            <div className="flex items-start gap-2 rounded-[4px] border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
              <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">This backup does not match this firewall.</p>
                <p className="mt-0.5">{preview.incompatible_reason}. Restoring it is very likely to
                  leave the unit unusable. Continue only if you know why the two differ.</p>
              </div>
            </div>
          )}

          {/* Always: what a restore does */}
          {preview.valid && (
            <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600">
                <FiAlertTriangle size={13} /> What will happen
              </p>
              <ul className="mt-1.5 space-y-1 pl-5 text-[12px] text-red-600/90 dark:text-red-400">
                {preview.warnings.map((w) => <li key={w} className="list-disc">{w}</li>)}
              </ul>
            </div>
          )}

          {preview.valid && (
            <label className="flex cursor-pointer items-start gap-2 rounded-[4px] border hairline px-4 py-3 text-[12px] ink-2 surface-hover">
              <input type="checkbox" checked={accepted} disabled={busy}
                onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
              <span>
                I understand that <strong className="ink">{deviceName}</strong> will reboot and that
                its current configuration will be replaced.
              </span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
};

export default RestoreConfirmModal;

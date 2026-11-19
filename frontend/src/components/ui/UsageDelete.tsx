import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FiTrash2, FiLoader, FiAlertTriangle, FiExternalLink } from "react-icons/fi";
import { Link } from "react-router-dom";
import { DeviceObjectUsage, type UsageKind, type UsageReport } from "../../api/objectGroups";
import { errorText } from "../../api/errorText";

/**
 * "Delete this object" — but only after asking the firewall what still points at it.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * Every object page had the same dialog: "X will be permanently removed from <device>. Cancel /
 * Delete." Pressing Delete on an object something referenced produced the device's own refusal,
 * `error -15 object is in use`, which names nothing at all. The operator's only way to find out
 * WHAT was using it was to open the policy table and read it — a table this console had already
 * loaded twice on the way to that screen.
 *
 * ── The rule it enforces ─────────────────────────────────────────────────────
 *
 * Delete is armed ONLY on `safe_to_delete`, which the server sets only when every referring table
 * was readable AND the references it found account for FortiOS's own reference count. Three
 * distinct states therefore block the button, and each says which one it is:
 *
 *   references found      the list is shown, each row a link to the thing that uses it
 *   a table was unreadable  named, because an empty result from a table that never answered is
 *                           not evidence of anything
 *   counts disagree       "the device counts 4; 3 are listed" — the scan does not model every
 *                         FortiOS table and says so rather than implying it does
 *
 * A "Delete anyway" escape hatch is deliberately NOT offered. The device is the authority on
 * whether a delete is allowed; if this console cannot show the operator what a delete would break,
 * the right answer is to send them to the device's refusal, not to hand them a button that means
 * "I do not know what this will do".
 */

type Props = {
  deviceId: number;
  deviceName?: string;
  kind: UsageKind;
  /** What to call the object type in prose: "address group", "IP pool". */
  noun: string;
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const UsageDeleteModal: React.FC<Props> = ({
  deviceId, deviceName, kind, noun, name, busy = false, onCancel, onConfirm,
}) => {
  // One piece of state carrying WHICH object it describes, rather than a report plus an error plus
  // a clearing setState at the top of the effect. The effect body then never calls setState
  // synchronously (which cascades a render), and — the part that matters here — a report for the
  // previous object can never be shown beside the current object's name while the new scan is in
  // flight. On a dialog that arms a delete, showing the wrong object's references is the failure.
  const [scan, setScan] = useState<{ of: string; report: UsageReport | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    DeviceObjectUsage(deviceId, kind, name)
      .then((r) => { if (live) setScan({ of: name, report: r, error: null }); })
      // A failed scan is NOT "nothing uses it" — it leaves the delete disarmed, like every other
      // state this dialog cannot vouch for.
      .catch((e: unknown) => {
        if (live) setScan({ of: name, report: null, error: errorText(e, "the usage scan could not be run") });
      });
    return () => { live = false; };
  }, [deviceId, kind, name]);

  const current = scan?.of === name ? scan : null;
  const report = current?.report ?? null;
  const scanError = current?.error ?? null;
  const scanning = current === null;
  const armed = Boolean(report?.safe_to_delete) && !busy;

  /** "address group" → "Address group", for the head of a sentence. */
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);

  const countGap =
    report && report.device_count >= 0 && !report.complete && report.unreadable.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="modal-backdrop"
              onClick={busy ? undefined : onCancel} />
      <div className="modal-panel max-w-lg">
        <div className="modal-head">
          <span className="medallion h-8 w-8 bg-red-500 text-white"><FiTrash2 size={14} /></span>
          <div className="min-w-0">
            <p className="t-label m-0 text-red-500">DELETE {noun.toUpperCase()}</p>
            <h3 className="t-card m-0">Delete from device?</h3>
          </div>
        </div>

        <div className="modal-body t-body ink-2" data-allow-popup-scroll="true"
             style={{ maxHeight: "52vh", overflowY: "auto" }}>
          <p className="m-0">
            {deviceName
              ? `${label} "${name}" will be permanently removed from ${deviceName}.`
              : `${label} "${name}" will be permanently removed.`}
          </p>

          {scanning && (
            <p className="mt-3 mb-0 flex items-center gap-2 t-meta">
              <FiLoader className="animate-spin" size={13} />
              Checking what still references it…
            </p>
          )}

          {scanError && (
            <div className="banner banner-warn mt-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{`The usage check could not run (${scanError}), so this console cannot say what would break. Delete is disabled — retry, or remove the object on the device itself.`}</span>
            </div>
          )}

          {report && report.refs.length > 0 && (
            <div className="mt-3">
              <p className="t-label m-0 mb-1.5 text-red-500">
                {report.refs.length === 1
                  ? "Still referenced by 1 place"
                  : `Still referenced by ${report.refs.length} places`}
              </p>
              <div className="rounded-[4px] border hairline overflow-hidden">
                {report.refs.map((r, i) => (
                  <div key={`${r.table}-${r.key}-${r.field}-${i}`}
                       className={`flex items-center gap-2 px-2.5 py-1.5${i < report.refs.length - 1 ? " border-b hairline-2" : ""}`}>
                    <span className="t-meta shrink-0 w-28 truncate">{r.label}</span>
                    <Link to={r.route}
                          className="min-w-0 flex-1 truncate text-[12px] font-medium ink hover:underline">
                      {r.name || r.key}
                      <FiExternalLink size={10} className="ml-1 inline align-baseline ink-3" />
                    </Link>
                    <span className="chip shrink-0">{r.field_label}</span>
                  </div>
                ))}
              </div>
              <p className="t-meta m-0 mt-2">
                Remove it from these first. FortiOS refuses the delete anyway, with an error code
                that names none of them.
              </p>
            </div>
          )}

          {report && report.unreadable.length > 0 && (
            <div className="banner banner-warn mt-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{`Could not read ${report.unreadable.join(", ")}, so the list above may be incomplete. An empty result from a table that never answered is not evidence that nothing uses this object.`}</span>
            </div>
          )}

          {countGap && (
            <div className="banner banner-warn mt-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{`The device counts ${report!.device_count} references to this object and only ${report!.found} are listed above — something outside the tables this console reads is using it.`}</span>
            </div>
          )}

          {report?.safe_to_delete && (
            <p className="mt-3 mb-0 t-meta">
              Nothing references it. Every table was readable and the device agrees the count is zero.
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={!armed}>
            {busy && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UsageDeleteModal;

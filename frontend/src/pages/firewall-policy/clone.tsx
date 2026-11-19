import React, { useState } from "react";
import { createPortal } from "react-dom";
import { FiCopy, FiInfo } from "react-icons/fi";
import { DeviceClonePolicy } from "../../api/objectGroups";
import { errorText } from "../../api/errorText";
import { POLICY_NAME_MAX, suggestCopyName } from "./clone-name";

// "Make me another one like this."
//
// The eleventh near-identical egress rule is how a rule base ends up with eleven rules that are
// subtly different from each other, and every one of those differences was typed by hand into a
// form with forty fields.
//
// Two things this dialog is careful about, both stated on screen rather than left as a surprise:
//
//   the copy arrives DISABLED — it lands in the middle of a first-match table, and an enabled copy
//   starts deciding traffic before anyone has edited the field it was cloned to change;
//
//   the copy sits directly BELOW the original — anywhere else changes its meaning, because
//   everything between the two now matches first.
//
// Both are enforced on the server (services/fortigate_policybulk.go); this is where the operator
// finds out about them.

type Props = {
  deviceId: number;
  deviceName?: string;
  policyId: number;
  sourceName: string;
  /** Every policy name on the device, so the suggestion does not collide. */
  takenNames: string[];
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

const CloneDialog: React.FC<Props> = ({
  deviceId, deviceName, policyId, sourceName, takenNames, onCancel, onDone,
}) => {
  const [name, setName] = useState(() => suggestCopyName(sourceName, takenNames));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collides = takenNames.some((n) => n.toLowerCase() === name.trim().toLowerCase());

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("A name for the copy is required"); return; }
    setBusy(true);
    setError(null);
    try {
      await DeviceClonePolicy(deviceId, policyId, trimmed);
      await onDone();
    } catch (e: unknown) {
      setError(errorText(e, "The device refused the clone"));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="modal-backdrop"
              onClick={busy ? undefined : onCancel} />
      <div className="modal-panel max-w-md">
        <div className="modal-head">
          <span className="medallion h-8 w-8 bg-accent text-white"><FiCopy size={14} /></span>
          <div className="min-w-0">
            <p className="t-label m-0">CLONE POLICY</p>
            <h3 className="t-card m-0 truncate">{sourceName}</h3>
          </div>
        </div>

        <div className="modal-body">
          <label htmlFor="clone-name" className="field-label">Name for the copy</label>
          <input id="clone-name" className="shell-input" value={name} maxLength={POLICY_NAME_MAX}
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && !busy) void submit(); }} />
          {collides && (
            <p className="field-hint text-red-500">
              {`A policy called "${name.trim()}" already exists — FortiOS will refuse this with error -5.`}
            </p>
          )}

          <div className="banner banner-accent mt-3">
            <FiInfo size={14} className="shrink-0" />
            <span>{`The copy carries every field of the original, including the ones no form here shows. It arrives DISABLED, directly below "${sourceName}"${deviceName ? ` on ${deviceName}` : ""} — enable it once you have changed whatever you cloned it to change.`}</span>
          </div>

          {error && <p className="field-hint text-red-500">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-accent btn-sm" onClick={() => void submit()} disabled={busy || collides}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            Clone
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CloneDialog;

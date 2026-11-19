import React, { useMemo, useState } from "react";
import { FiCheck, FiX, FiToggleLeft, FiToggleRight, FiTrash2, FiAlertTriangle } from "react-icons/fi";
import { createPortal } from "react-dom";
import {
  DeviceBulkPolicyStatus, DeviceBulkDeletePolicies, type BulkResponse,
} from "../../api/objectGroups";
import { errorText } from "../../api/errorText";

// Acting on a SELECTION of rules rather than on one at a time.
//
// Turning a block of rules off for a maintenance window used to be one click per rule, each with
// its own confirmation and its own chance to hit the neighbour. The rule base is the one table in
// this console where the wrong row is not an inconvenience.
//
// ── Why the results are shown row by row ─────────────────────────────────────
//
// The server does not roll back a partial failure, and it should not: undoing writes that DID land
// means issuing more writes to a live firewall, which is a second chance to get it wrong. So it
// answers 207 with one result per policy, and this component's job is to put that in front of the
// operator rather than collapsing it into "something went wrong".

/** The tri-state header checkbox for a block of rows. */
export const SelectAllBox: React.FC<{
  ids: number[];
  selected: Set<number>;
  onChange: (ids: number[], on: boolean) => void;
  label: string;
}> = ({ ids, selected, onChange, label }) => {
  const chosen = ids.filter((id) => selected.has(id)).length;
  const all = ids.length > 0 && chosen === ids.length;
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={all}
      ref={(el) => { if (el) el.indeterminate = chosen > 0 && !all; }}
      onChange={() => onChange(ids, !all)}
    />
  );
};

type Props = {
  deviceId: number;
  deviceName?: string;
  selected: Set<number>;
  /** id → display name, for the delete confirmation. */
  nameOf: (id: number) => string;
  onClear: () => void;
  onDone: () => Promise<void> | void;
};

export const BulkBar: React.FC<Props> = ({ deviceId, deviceName, selected, nameOf, onClear, onDone }) => {
  const ids = useMemo(() => [...selected], [selected]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);

  if (ids.length === 0) return null;

  const run = async (fn: () => Promise<BulkResponse>) => {
    setBusy(true);
    try {
      const res = await fn();
      // A clean run needs no report; a partial one always gets shown.
      if (res.failed > 0) setResult(res);
      setConfirmDelete(false);
      onClear();
      await onDone();
    } catch (e: unknown) {
      setResult({
        message: errorText(e, "The request did not reach the device"),
        results: ids.map((id) => ({ policy_id: id, ok: false })),
        failed: ids.length,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The bar floats above the table so it stays reachable while scrolling a long rule base. */}
      <div className="sticky bottom-3 z-20 mx-auto flex w-fit items-center gap-2 rounded-[4px] border hairline surface-card px-3 py-2 shadow-lg">
        <span className="text-[12px] font-semibold ink">
          {ids.length} selected
        </span>
        <span className="h-4 w-px" style={{ background: "var(--shell-border)" }} />

        <button type="button" className="btn btn-soft btn-sm" disabled={busy}
                onClick={() => void run(() => DeviceBulkPolicyStatus(deviceId, ids, true))}>
          <FiToggleRight size={13} /> Enable
        </button>
        <button type="button" className="btn btn-soft btn-sm" disabled={busy}
                onClick={() => void run(() => DeviceBulkPolicyStatus(deviceId, ids, false))}>
          <FiToggleLeft size={13} /> Disable
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                onClick={() => setConfirmDelete(true)}>
          <FiTrash2 size={13} /> Delete
        </button>

        <button type="button" className="btn-icon" aria-label="Clear selection" onClick={onClear} disabled={busy}>
          <FiX size={13} />
        </button>
      </div>

      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="modal-backdrop"
                  onClick={busy ? undefined : () => setConfirmDelete(false)} />
          <div className="modal-panel max-w-md">
            <div className="modal-head">
              <span className="medallion h-8 w-8 bg-red-500 text-white"><FiTrash2 size={14} /></span>
              <div className="min-w-0">
                <p className="t-label m-0 text-red-500">{`DELETE ${ids.length} POLICIES`}</p>
                <h3 className="t-card m-0">Delete from device?</h3>
              </div>
            </div>
            <div className="modal-body t-body ink-2" style={{ maxHeight: "44vh", overflowY: "auto" }}>
              <p className="m-0">{`These rules will be permanently removed${deviceName ? ` from ${deviceName}` : ""}. They are deleted one at a time, highest id first, and a failure part-way through leaves the rest in place — the result is reported per rule.`}</p>
              <div className="mt-3 rounded-[4px] border hairline overflow-hidden">
                {ids.map((id, i) => (
                  <div key={id}
                       className={`flex items-center gap-2 px-2.5 py-1.5${i < ids.length - 1 ? " border-b hairline-2" : ""}`}>
                    <span className="t-meta w-8 shrink-0 tabular-nums">{id}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] ink">{nameOf(id)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" disabled={busy}
                      onClick={() => void run(() => DeviceBulkDeletePolicies(deviceId, ids))}>
                {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                {`Delete ${ids.length}`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {result && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="modal-backdrop" onClick={() => setResult(null)} />
          <div className="modal-panel max-w-md">
            <div className="modal-head">
              <span className="medallion h-8 w-8 bg-amber-500 text-white"><FiAlertTriangle size={14} /></span>
              <div className="min-w-0">
                <p className="t-label m-0 text-amber-600">PARTLY APPLIED</p>
                <h3 className="t-card m-0">{result.message}</h3>
              </div>
            </div>
            <div className="modal-body" style={{ maxHeight: "48vh", overflowY: "auto" }}>
              <div className="rounded-[4px] border hairline overflow-hidden">
                {result.results.map((r, i) => (
                  <div key={r.policy_id}
                       className={`flex items-start gap-2 px-2.5 py-1.5${i < result.results.length - 1 ? " border-b hairline-2" : ""}`}>
                    {r.ok
                      ? <FiCheck size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                      : <FiX size={13} className="mt-0.5 shrink-0 text-red-500" />}
                    <span className="t-meta w-8 shrink-0 tabular-nums">{r.policy_id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] ink">{nameOf(r.policy_id)}</span>
                      {r.error && <span className="block t-meta text-red-500">{r.error}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-soft btn-sm" onClick={() => setResult(null)}>Close</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

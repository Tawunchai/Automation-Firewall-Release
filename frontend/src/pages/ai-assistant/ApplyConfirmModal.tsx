import React from "react";
import { FiAlertTriangle, FiCpu, FiPlay, FiTerminal } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import type { ApplyImpact } from "./applyImpact";

// The dialog between the chat's Apply button and a live firewall.
//
// WHY IT IS NOT A ONE-LINE "are you sure?"
// "Are you sure?" adds a click and no information — people learn to click through it. What a user
// actually needs at this moment is the two things the CLI block above does not say plainly: WHICH
// objects are about to appear on the device, and WHAT TRAFFIC changes once they do. Both come from
// summarizeApplyImpact(), computed from the CLI text alone so this opens instantly.
//
// HONESTY RULES THIS DIALOG FOLLOWS
//   · It never claims an object is new. Apply skips a name the device already has, and only Dry-run
//     (which reads the device) can tell which is which — so the list is titled "will be created if
//     not already there" and points at Dry-run for the precise answer.
//   · The model's own Impact bullets are shown as the model's claim, in their own block, never mixed
//     into the lines this app computed.

const KIND_TONE: Record<string, string> = {
  policy: "chip-danger",
  "static-route": "chip-info",
  "ipsec-tunnel": "chip-info",
};

interface ApplyConfirmModalProps {
  open: boolean;
  impact: ApplyImpact | null;
  /** Which firewall this lands on — the one fact that makes the dialog concrete. */
  deviceName?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const ApplyConfirmModal: React.FC<ApplyConfirmModalProps> = ({
  open, impact, deviceName, busy = false, onCancel, onConfirm,
}) => {
  if (!impact) return null;

  const { objects, effects, warnings, aiImpact, transport, mode } = impact;
  const editing = mode === "edit";

  return (
    <Modal
      open={open}
      width="max-w-xl"
      onClose={busy ? () => {} : onCancel}
      title={
        <span className="flex items-center gap-2">
          <span className="medallion h-7 w-7 shrink-0" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
            <FiPlay size={13} />
          </span>
          <span className="min-w-0 flex-1">
            {editing ? "Confirm this change on the device" : "Confirm this creation on the device"}
            {deviceName ? ` — ${deviceName}` : ""}
          </span>
        </span>
      }
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {editing ? "Apply — overwrite the existing object" : "Apply — write to the device"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        {/* ── What lands on the device ── */}
        {transport === "ssh" ? (
          <div className="rounded-[4px] border hairline surface-sunken px-3 py-2.5">
            <p className="t-label m-0 mb-1 flex items-center gap-1.5 ink-2">
              <FiTerminal size={11} /> Sent as one block over SSH
            </p>
            <p className="m-0 text-[11.5px] ink-2">
              This config is not built object by object — the whole CLI block is sent to the device, and a before/after diff is shown once it finishes
            </p>
          </div>
        ) : (
          <div>
            <p className="t-label m-0 mb-1.5 ink-2">
              {editing ? "Will be written to the device" : "Will be created on the device"} ({objects.length})
            </p>
            {objects.length === 0 ? (
              <p className="m-0 text-[11.5px] ink-3">No object in this config is one the console can create</p>
            ) : (
              <div className="shell-scroll max-h-44 space-y-1 overflow-y-auto">
                {objects.map((o, i) => (
                  <div key={`${o.kind}-${o.name}-${i}`} className="flex items-center gap-2">
                    <span className={`chip ${KIND_TONE[o.kind] ?? ""}`}>{o.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold ink">{o.name}</span>
                  </div>
                ))}
              </div>
            )}
            {/* The one line about what this list does NOT say. It comes from the builder, not from
                here: the chat cannot know which names already exist, while a wizard has just
                checked — so the two paths owe the reader different caveats. */}
            {impact.note && <p className="m-0 mt-1.5 text-[10.5px] ink-3">{impact.note}</p>}
          </div>
        )}

        {/* ── Rough impact: what this changes for traffic ── */}
        {effects.length > 0 && (
          <div className="rounded-[4px] border hairline surface-sunken px-3 py-2.5">
            <p className="t-label m-0 mb-1.5 ink-2">Rough impact</p>
            <ul className="m-0 list-none space-y-1 p-0">
              {effects.map((e, i) => (
                <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed ink-2">
                  <span className="shrink-0 ink-3">·</span>
                  <span className="min-w-0">{e}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Warnings ── */}
        {warnings.length > 0 && (
          <div className="rounded-[4px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="m-0 mb-1 flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
              <FiAlertTriangle size={12} /> Read before you apply
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                  <span className="shrink-0 opacity-60">·</span>
                  <span className="min-w-0">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── The model's own impact bullets, kept clearly separate from ours ── */}
        {aiImpact.length > 0 && (
          <div>
            <p className="t-label m-0 mb-1.5 flex items-center gap-1.5 ink-3">
              <FiCpu size={11} /> Impact summary from the model
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {aiImpact.map((b, i) => (
                <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed ink-3">
                  <span className="shrink-0">·</span>
                  <span className="min-w-0">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ApplyConfirmModal;

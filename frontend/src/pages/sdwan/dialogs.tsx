import React, { useState } from "react";
import { FiPlus, FiTrash2, FiX } from "react-icons/fi";
import Modal from "../../components/ui/Modal";

// What is left of the SD-WAN dialogs: a delete confirmation, and the menu behind "Create New".
//
// The three forms that used to live here (member, zone, priority rule) are pages now — see
// form-shell.tsx for why.

// ── Delete confirm ───────────────────────────────────────────────────────────

export const SDWANDeleteConfirm: React.FC<{
  open: boolean;
  what: string;
  detail: React.ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ open, what, detail, busy, onCancel, onConfirm }) => (
  <Modal
    open={open}
    title={`Delete ${what}?`}
    onClose={busy ? () => {} : onCancel}
    width="max-w-md"
    footer={
      <>
        <button type="button" className="btn btn-soft btn-sm" onClick={onCancel} disabled={busy}>
          <FiX size={13} /> Cancel
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
          <FiTrash2 size={13} /> {busy ? "Deleting…" : "Delete"}
        </button>
      </>
    }
  >
    <p className="text-[12.5px] ink-2">{detail}</p>
  </Modal>
);

export const CreateNewMenu: React.FC<{
  onMember: () => void;
  onZone: () => void;
}> = ({ onMember, onZone }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn btn-accent btn-sm" onClick={() => setOpen((v) => !v)}>
        <FiPlus size={13} /> Create New
      </button>
      {open && (
        <>
          {/* A transparent catcher rather than a document listener: this menu holds two items and
              lives for one click. */}
          <div role="presentation" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Anchored to the button's LEFT edge. `right-0` put the menu's right edge on the
              button's, so a 192px menu hanging off a button at the far left of the toolbar ran
              past the viewport and was clipped — the first two entries were half off-screen. */}
          <div className="absolute left-0 z-50 mt-1.5 w-48 overflow-hidden rounded-[4px]"
            style={{
              background: "var(--shell-card)",
              border: "1px solid var(--shell-border)",
              boxShadow: "var(--shell-elev-lg)",
            }}>
            {[
              { label: "SD-WAN Member", run: onMember },
              { label: "SD-WAN Zone", run: onZone },
            ].map(({ label, run }) => (
              <button key={label} type="button"
                onClick={() => { setOpen(false); run(); }}
                className="block w-full px-4 py-2 text-left text-[12.5px] ink transition surface-hover">
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

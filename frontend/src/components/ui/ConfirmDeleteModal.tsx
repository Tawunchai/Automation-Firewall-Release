import React from "react";
import { createPortal } from "react-dom";
import { FiTrash2 } from "react-icons/fi";

interface ConfirmDeleteModalProps {
  /** Small red eyebrow above the title — e.g. "DELETE FROM DEVICE". */
  eyebrow?: string;
  title: string;
  /** What is about to be removed, and from where. */
  children: React.ReactNode;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}

/**
 * "Are you sure?" for a write that reaches a live firewall.
 *
 * Nine pages portalled their own copy of this dialog — same layout, same red medallion, nine
 * slightly different shadows and paddings. It is one component now, on the shell's own surfaces.
 *
 * It stays a portal to `document.body`: these pages have scroll containers and `overflow: hidden`
 * panels, and a dialog rendered inside one of those gets clipped.
 *
 * The confirm button keeps its destructive styling even while busy, and the backdrop stops
 * dismissing once the request is in flight — a delete that has already reached the device cannot
 * be called back by closing the dialog, so offering that is a lie.
 */
const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  eyebrow = "DELETE FROM DEVICE",
  title,
  children,
  busy = false,
  onCancel,
  onConfirm,
  confirmLabel = "Delete",
}) =>
  createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <div role="presentation" className="modal-backdrop" onClick={busy ? undefined : onCancel} />
      <div className="modal-panel max-w-sm">
        <div className="modal-head">
          <span className="medallion h-8 w-8 bg-red-500 text-white">
            <FiTrash2 size={14} />
          </span>
          <div className="min-w-0">
            <p className="t-label m-0 text-red-500">{eyebrow}</p>
            <h3 className="t-card m-0">{title}</h3>
          </div>
        </div>

        <div className="modal-body t-body ink-2">{children}</div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
            {busy && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

export default ConfirmDeleteModal;

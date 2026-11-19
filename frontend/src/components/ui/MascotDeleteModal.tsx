import React from "react";
import { createPortal } from "react-dom";
import { FiX, FiTrash2 } from "react-icons/fi";

interface MascotDeleteModalProps {
  /** The per-topic cartoon that heads the dialog — so the danger has a face, not a warning triangle. */
  mascot: React.ReactNode;
  /** The record's own name, shown as the dialog title (not "Delete X?"). */
  name: string;
  /** One short line under the title — what is about to be removed, and from where. */
  description?: React.ReactNode;
  /** Optional richer body (e.g. an impact / cascade table) rendered full-width, left-aligned. */
  children?: React.ReactNode;
  busy?: boolean;
  error?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The centred "mascot" delete modal (the convention the 2026-11-05 UI pass settled on): a
 * `surface-card` panel, `rounded-[6px]`, a `ring` and no drop shadow, a close `FiX` top-right, then
 * centred — a cartoon → the record's own name as the title → one short line → a full-width red
 * Delete button → Cancel. Dark-mode aware throughout (no forced white).
 *
 * Portalled to `document.body`: these pages have scroll containers and `overflow: hidden` panels, so
 * a dialog rendered inside one would be clipped. The backdrop stops dismissing once the request is
 * in flight — a delete that already reached the firewall cannot be called back by closing the box.
 */
const MascotDeleteModal: React.FC<MascotDeleteModalProps> = ({
  mascot,
  name,
  description,
  children,
  busy = false,
  error,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}) =>
  createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !busy && onCancel()} />
      <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
        <button
          type="button"
          onClick={() => !busy && onCancel()}
          disabled={busy}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60"
        >
          <FiX className="text-[16px]" />
        </button>

        <div className="px-6 pb-6 pt-7 text-center">
          <div className="mb-3 flex justify-center">{mascot}</div>
          <h3 className="truncate text-[17px] font-bold leading-tight ink" title={name}>{name}</h3>
          {description && (
            <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">{description}</p>
          )}

          {children && <div className="mt-3 text-left text-[12px] leading-5 ink-2">{children}</div>}

          {error && (
            <div className="mt-3 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-left text-[10.5px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              "mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
              busy
                ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50"
                : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
            ].join(" ")}
          >
            {busy ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <FiTrash2 className="text-[13px]" />
            )}
            {busy ? "Deleting…" : confirmLabel}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="mt-2 w-full rounded-[4px] border hairline py-2.5 text-[12.5px] font-semibold ink-2 surface-hover transition disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

export default MascotDeleteModal;

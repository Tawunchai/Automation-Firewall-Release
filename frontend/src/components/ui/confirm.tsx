import React from "react";
import { createRoot } from "react-dom/client";
import { FiAlertTriangle } from "react-icons/fi";
import Modal from "./Modal";

// An imperative "are you sure?" that resolves to a boolean.
//
// Replaces antd's `Modal.confirm`, which both call sites had already wrapped in a `new Promise` to
// get an answer out of its callbacks:
//
//     const ok = await new Promise<boolean>((resolve) => {
//       Modal.confirm({ …, onOk: () => resolve(true), onCancel: () => resolve(false) });
//     });
//
// So the promise IS the interface people wanted; this just exposes it directly. It mounts its own
// root and tears it down on answer, which keeps it callable from a plain async handler with no
// component holding open/close state for a dialog that exists for two seconds.
//
// Both current uses are destructive on a live firewall — reverting a change, dropping a tunnel's
// traffic — so `danger` styling is the default, not an option to remember.

export type ConfirmOptions = {
  title: React.ReactNode;
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  /** false for a merely-consequential confirm; destructive is the default here. */
  danger?: boolean;
};

export const confirm = ({
  title, content, okText = "Confirm", cancelText = "Cancel", danger = true,
}: ConfirmOptions): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const finish = (answer: boolean) => {
      resolve(answer);
      // Unmount on a later tick: React is mid-commit inside the click handler that called this.
      setTimeout(() => { root.unmount(); host.remove(); }, 0);
    };

    root.render(
      <Modal
        open
        width="max-w-md"
        onClose={() => finish(false)}
        title={
          <span className="flex items-center gap-2">
            <span
              className="medallion h-7 w-7 shrink-0"
              style={
                danger
                  ? { background: "rgba(239,68,68,0.12)", color: "#ef4444" }
                  : { background: "color-mix(in srgb, var(--accent) 13%, transparent)", color: "var(--accent)" }
              }
            >
              <FiAlertTriangle size={13} />
            </span>
            <span className="min-w-0 flex-1">{title}</span>
          </span>
        }
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => finish(false)}>
              {cancelText}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${danger ? "btn-danger" : "btn-accent"}`}
              onClick={() => finish(true)}
            >
              {okText}
            </button>
          </>
        }
      >
        {content && <p className="t-body ink-2 m-0">{content}</p>}
      </Modal>,
    );
  });

export default confirm;

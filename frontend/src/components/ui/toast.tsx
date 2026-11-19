import React from "react";
import { createRoot, type Root } from "react-dom/client";
import ToastHost from "./toast-host";
import { destroyAll, push, type ToastKind } from "./toast-store";

// The console's toast.
//
// WHY THIS EXISTS
// Ant Design was 935 KB of the bundle — the single largest chunk, downloaded on every first load —
// and 66 of the 76 files that imported it wanted exactly one thing from it: `message`. The
// components it also provided (buttons, inputs, modals, cards, tables) are now native CSS in
// index.css, so the library was being carried almost entirely for a toast.
//
// The API is deliberately the same shape antd's `message` had — `message.success(text)`,
// `.error()`, `.info()`, `.warning()`, `.loading()`, `.destroy()` — so the 476 call sites did not
// have to change, only their import. A rewrite of 476 calls is 476 chances to change a message's
// meaning; a changed import line is none.
//
// It renders into its own root outside the React tree because it is called from event handlers,
// promise catches and non-component code (api layers), where there is no component to render from.
//
// This file is the API only. The list lives in toast-store.ts and the view in toast-host.tsx, so
// that each of the three is a module one kind of change touches.

// The host mounts itself on first use, so nothing has to remember to render it — including code
// paths that fire a toast before the app tree exists (a failed session check on boot).
let root: Root | null = null;
const ensureHost = () => {
  if (root || typeof document === "undefined") return;
  const el = document.createElement("div");
  el.id = "toast-host";
  document.body.appendChild(el);
  root = createRoot(el);
  root.render(<ToastHost />);
};

/** antd accepted both `message.error("text")` and `message.error({ content, duration })`, and the
 *  login page uses the object form. Supporting both is what makes this a drop-in. */
export type ToastArg = React.ReactNode | { content: React.ReactNode; duration?: number };

const isConfig = (a: ToastArg): a is { content: React.ReactNode; duration?: number } =>
  typeof a === "object" && a !== null && !React.isValidElement(a) && "content" in a;

const show = (kind: ToastKind) => (arg: ToastArg, duration?: number) => {
  ensureHost();
  return isConfig(arg)
    ? push(kind, arg.content, arg.duration)
    : push(kind, arg, duration);
};

/**
 * Drop-in replacement for antd's `message`.
 *
 * `duration` is in SECONDS, as antd's was, so existing call sites keep their meaning.
 */
export const message = {
  success: show("success"),
  error: show("error"),
  info: show("info"),
  warning: show("warning"),
  loading: show("loading"),
  /** Clears everything on screen — used when a page navigates away mid-operation. */
  destroy: destroyAll,
};

export default message;

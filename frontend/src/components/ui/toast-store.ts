import type React from "react";

// The toast STORE: the list, its subscribers, and the two operations that change it.
//
// A module-level list plus subscribers, rather than context, so `message.error(...)` works from
// anywhere — including the axios interceptor, which is not inside the React tree.
//
// Split out of toast.tsx so that file defines no components at all. Vite's fast refresh gives up
// on a module that mixes components with anything else, and a module that DEFINES a component and
// exports something else — which is what toast.tsx was — reloads the whole file rather than
// re-rendering. For the toast that meant the stack on screen was dropped on every save.

export type ToastKind = "success" | "error" | "info" | "warning" | "loading";

export type Toast = {
  id: number;
  kind: ToastKind;
  text: React.ReactNode;
  /** ms; a loading toast stays until something replaces or destroys it. */
  duration: number;
};

const DEFAULT_MS: Record<ToastKind, number> = {
  success: 3000, error: 5000, info: 3000, warning: 4000, loading: 0,
};

// Exported as a `let`: the host reads it through the live binding, so it sees each new array.
export let toasts: Toast[] = [];
let nextId = 1;
export const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = () => { listeners.forEach((l) => l()); };

export const dismiss = (id: number) => {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
  toasts = toasts.filter((x) => x.id !== id);
  emit();
};

export const push = (kind: ToastKind, text: React.ReactNode, duration?: number): (() => void) => {
  const id = nextId++;
  const ms = duration != null ? duration * 1000 : DEFAULT_MS[kind];
  toasts = [...toasts, { id, kind, text, duration: ms }];
  // Cap the stack. Ten toasts on screen is never useful and pushes the newest off the fold.
  if (toasts.length > 5) {
    const dropped = toasts[0];
    toasts = toasts.slice(1);
    const t = timers.get(dropped.id);
    if (t) { clearTimeout(t); timers.delete(dropped.id); }
  }
  emit();
  if (ms > 0) timers.set(id, setTimeout(() => dismiss(id), ms));
  // antd returns a closer; a few call sites keep it for a loading toast.
  return () => dismiss(id);
};

/** Clears everything on screen — used when a page navigates away mid-operation. */
export const destroyAll = () => {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  toasts = [];
  emit();
};

import React from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

// ── Shared pieces ─────────────────────────────────────────────────────────────
//
// Declared at module scope, NOT inside the component. A component defined during render is a new
// component type on every keystroke, so React unmounts and remounts its subtree — which on a form
// means the input loses focus after each character typed.

export const INPUT_CLS =
  "auth-field h-11 w-full rounded-[10px] border border-slate-200 bg-white pl-11 pr-10 text-[13px] " +
  "text-slate-800 outline-none transition placeholder:text-slate-400 " +
  "dark:border-white/12 dark:bg-white/4 dark:text-white/90 dark:placeholder:text-white/30";

export const CODE_INPUT_CLS =
  "auth-field h-13 w-full rounded-[10px] border border-slate-200 bg-white text-center font-mono " +
  "text-[24px] tracking-[0.4em] text-slate-800 outline-none transition " +
  "dark:border-white/12 dark:bg-white/4 dark:text-white";

export const PRIMARY_BTN =
  "auth-primary inline-flex h-11 w-full items-center justify-center rounded-[10px] text-[14px] " +
  "font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60";

/** Label above a control. A <label> wrapping the control gives click-to-focus with no id wiring. */
export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="block">
    <span className="mb-1.5 block text-[12.5px] font-medium text-slate-600 dark:text-white/60">
      {label}
    </span>
    {children}
  </span>
);

/** The bordered glyph tile inside the left edge of an input, plus room for a trailing control. */
export const InputShell: React.FC<{
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, trailing, children }) => (
  <span className="relative block">
    <span
      aria-hidden
      className="pointer-events-none absolute left-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center
                 justify-center rounded-[4px] border border-slate-200 bg-white text-[13px] text-slate-400
                 dark:border-white/10 dark:bg-white/5 dark:text-white/40"
    >
      {icon}
    </span>
    {children}
    {trailing}
  </span>
);

/** Show/hide toggle for a password field. */
export const RevealBtn: React.FC<{ shown: boolean; onToggle: () => void }> = ({ shown, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={shown ? "Hide password" : "Show password"}
    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 dark:text-white/40 dark:hover:text-white/70"
  >
    {shown ? <FiEyeOff className="text-[15px]" /> : <FiEye className="text-[15px]" />}
  </button>
);

/**
 * Why the attempt failed, in the form's own words.
 *
 * Always the same block, in the same place, for every view — "wrong password", "code expired" and
 * "the server is in maintenance" are all answers to the same question and must not each get their
 * own styling for the reader to learn.
 */
export const ErrorBox: React.FC<{ text: string }> = ({ text }) =>
  text ? (
    <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-600 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-300">
      {text}
    </div>
  ) : null;

/** "← Back to sign in", shared by every secondary view. */
export const BackToSignIn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-4 w-full text-center text-[12px] text-slate-500 transition hover:text-slate-800 dark:text-white/45 dark:hover:text-white/80"
  >
    ← {label}
  </button>
);


import React from "react";
import { FiCheck, FiX } from "react-icons/fi";
import { activateOnKey } from "./keyActivate";
import { dismiss, listeners, toasts, type Toast, type ToastKind } from "./toast-store";

// The toast's VIEW, and nothing else: this module exports one component.
//
// It used to live in toast.tsx beside `message`, which is the thing every page imports. A module
// that exports a component AND something else is not a fast-refresh boundary, so a save anywhere
// in it reloaded the whole module and dropped whatever was on screen. The store is in
// toast-store.ts, the drop-in `message` API is in toast.tsx, and this is the part React renders.

/**
 * The glyph inside the filled disc.
 *
 * `!` and `i` are typed characters rather than icons on purpose: at 20px a triangle-with-a-bang or
 * a circled-i reduces to a smudge, while a single bold letter stays legible — which is the same
 * reason react-hot-toast draws its own check instead of using an icon font.
 */
const GLYPH: Record<Exclude<ToastKind, "loading">, React.ReactNode> = {
  success: <FiCheck size={13} strokeWidth={3.5} />,
  error: <FiX size={13} strokeWidth={3.5} />,
  warning: <span className="text-[13px] font-black leading-none">!</span>,
  info: <span className="text-[12px] font-black leading-none">i</span>,
};

// Each kind's colour, filling the disc. These are react-hot-toast's own green and red rather than
// this console's chip palette, because they are what the design being matched uses and they read
// the same on the white card in both themes.
const TONE: Record<ToastKind, string> = {
  success: "#61D345",
  error: "#FF4B4B",
  info: "#3B82F6",
  warning: "#F59E0B",
  loading: "var(--accent)",
};

/**
 * One toast, in the shape react-hot-toast draws it: a compact white pill, a filled disc carrying
 * the status, and the sentence. No close button and no coloured card.
 *
 * WHY NO ×
 * Both references this follows — react-hot-toast and antd's `message` — leave it out, and they are
 * right to: these are transient acknowledgements, not tasks. A × invites a decision on something
 * that resolves itself in three seconds, and it is one more 24px target sitting over whatever the
 * page was showing. Clicking anywhere on the toast dismisses it instead, which is react-hot-toast's
 * own behaviour and needs no affordance to discover — nobody is stuck if they miss it, because the
 * timer is already running.
 */
const ToastItem: React.FC<{ t: Toast }> = ({ t }) => (
  <div
    role={t.kind === "error" ? "alert" : "status"}
    tabIndex={0}
    onClick={() => dismiss(t.id)}
    onKeyDown={activateOnKey(() => dismiss(t.id))}
    title="Dismiss"
    className="toast-card pointer-events-auto"
    data-kind={t.kind}
  >
    {t.kind === "loading" ? (
      <span className="toast-spinner" aria-hidden />
    ) : (
      <span className="toast-badge" style={{ background: TONE[t.kind] }} aria-hidden>
        {GLYPH[t.kind]}
      </span>
    )}
    <span className="toast-text">{t.text}</span>
  </div>
);

const ToastHost: React.FC = () => {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-4 z-10000 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Scoped here rather than in index.css: the toast host is the only thing that renders these
          classes, it mounts outside the React tree, and keeping the rules next to the markup means
          the two cannot drift apart in a file nobody opens together. */}
      <style>{`
        .toast-card{
          display:flex;align-items:center;gap:10px;
          min-width:0;max-width:360px;
          padding:10px 14px;
          border-radius:10px;
          cursor:pointer;
          background:var(--shell-card);
          border:1px solid var(--shell-border);
          /* react-hot-toast's own elevation: a wide soft pass plus a tight contact shadow. */
          box-shadow:0 3px 10px rgba(0,0,0,.10),0 3px 3px rgba(0,0,0,.05);
          animation:toast-in 260ms cubic-bezier(.21,1.02,.73,1);
        }
        .dark .toast-card{ box-shadow:0 8px 26px rgba(0,0,0,.55); }
        .toast-badge{
          display:flex;align-items:center;justify-content:center;
          flex:0 0 auto;width:20px;height:20px;border-radius:9999px;color:#fff;
        }
        .toast-spinner{
          flex:0 0 auto;width:18px;height:18px;border-radius:9999px;
          border:2px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-top-color:var(--accent);
          animation:toast-spin .7s linear infinite;
        }
        .toast-text{
          min-width:0;color:var(--shell-ink);
          font-size:13.5px;line-height:1.35;
          overflow-wrap:break-word;
        }
        @keyframes toast-in{
          0%{opacity:0;transform:translate3d(0,-18px,0) scale(.92)}
          100%{opacity:1;transform:none}
        }
        @keyframes toast-spin{to{transform:rotate(360deg)}}
        /* The entry animation is decoration; the message is the point. */
        @media (prefers-reduced-motion: reduce){
          .toast-card{animation:none}
          .toast-spinner{animation-duration:2s}
        }
      `}</style>
      {toasts.map((t) => <ToastItem key={t.id} t={t} />)}
    </div>
  );
};

export default ToastHost;

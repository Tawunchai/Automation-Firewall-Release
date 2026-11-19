import React from "react";
import { FiAlertTriangle, FiLoader } from "react-icons/fi";

// Pieces the five Diagnostics pages share.
//
// They are here rather than repeated per page because these pages are unusually alike — each is a
// panel or two, a form that asks the firewall something, and a result — and the one thing they
// must agree on is how a FAILED diagnostic looks. A ping that could not run and a ping that ran
// and lost every packet are opposite answers; if two pages draw them the same way, the console is
// lying on one of them.

/** Section panel: hairline header with the accent tick, body below. */
export const Panel: React.FC<{
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  /** Set when the panel holds a table that should reach the panel's edges. */
  flush?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, right, flush, children }) => (
  <section className={`panel${flush ? " panel-flush" : ""}`}>
    <header className="card-head">
      <h2 className="card-title t-card">
        {icon}
        {title}
      </h2>
      {right}
    </header>
    {flush ? children : <div className="panel-body">{children}</div>}
  </section>
);

/** One number with a label under it. */
export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: "ok" | "warn" | "danger" | "plain";
  hint?: string;
}> = ({ label, value, unit, tone = "plain", hint }) => {
  const color =
    tone === "ok" ? "#15803d" : tone === "warn" ? "#b45309" : tone === "danger" ? "#b91c1c" : undefined;
  return (
    <div className="panel panel-body min-w-0" title={hint}>
      <p className="t-label m-0">{label}</p>
      <p className="t-metric tnum m-0 mt-1" style={color ? { color } : undefined}>
        {value}
        {unit && <span className="t-meta ml-1 font-semibold">{unit}</span>}
      </p>
    </div>
  );
};

/** Labelled form field. */
export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, hint, children, className }) => (
  <span className={`block min-w-0 ${className ?? ""}`}>
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </span>
);

/**
 * The result area's failure block.
 *
 * Deliberately the same shape as StateBlock's ErrorState on the list pages: "we could not ask the
 * firewall" must look identical wherever it happens, and must never be confused with the firewall
 * answering "no".
 */
export const DiagError: React.FC<{ message: string }> = ({ message }) => (
  <div className="banner banner-warn flex items-start gap-2">
    <FiAlertTriangle size={15} className="mt-0.5 shrink-0" />
    <div className="min-w-0">
      <p className="m-0 text-[12.5px] font-semibold">The command failed</p>
      <p className="m-0 mt-0.5 wrap-break-word text-[11.5px] opacity-90">{message}</p>
    </div>
  </div>
);

/** Inline "the firewall is working on it" line — these commands run on the device, so they take time. */
export const Running: React.FC<{ what: string }> = ({ what }) => (
  <div className="state-block">
    <span className="state-icon">
      <FiLoader className="animate-spin" size={18} />
    </span>
    <p className="state-title m-0">Running {what} on the device…</p>
    <p className="state-text m-0">This runs on the real FortiGate, so it can take a moment</p>
  </div>
);

/**
 * The device's own output, streamed in as it is printed.
 *
 * Kept alongside the parsed view rather than instead of it, because a firewall says things the
 * parser does not model — "Unable to resolve hostname", an ICMP admin-prohibited reply, a VRF
 * warning — and dropping them would leave the page reporting "0 received" with no reason.
 *
 * It follows the tail while a run is live, but only if the reader has not scrolled up: yanking
 * someone back to the bottom while they are reading an earlier line is worse than not following.
 */
export const LiveConsole: React.FC<{ lines: string[]; running: boolean; label?: string }> = ({
  lines, running, label = "Raw output from the device",
}) => {
  const boxRef = React.useRef<HTMLPreElement | null>(null);
  const stickRef = React.useRef(true);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (lines.length === 0) return null;

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    // 24px of slack: "close enough to the bottom" should survive a partial line and sub-pixel
    // rounding, or the view detaches the moment a new line grows the box.
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11.5px] font-semibold ink-2">{label}</span>
        {running && <span className="diag-live-dot" />}
        <span className="t-meta ml-auto tnum">{lines.length} lines</span>
      </div>
      <pre
        ref={boxRef}
        onScroll={onScroll}
        className="code-surface m-0 rounded-[4px] p-3 text-[11px] leading-relaxed"
      >
        {lines.join("\n")}
      </pre>
    </div>
  );
};

// fmtBytes, latencyTone and toneChip moved to ./diagFormat.ts: a module that exports functions
// alongside components cannot be fast-refreshed.

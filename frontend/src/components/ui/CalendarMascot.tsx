import React from "react";

/**
 * A wall-calendar character — heads the calendar's delete dialog, in the same drawing language as
 * VirusMascot / DeviceMascot (red gradient, worried eyes + angled brows + a downturned mouth, a soft
 * halo + contact shadow, one idle bob dropped under reduced motion). Here the body is a page on a
 * red binder band with two rings, so the "this date is being removed" reads at a glance.
 */

const CalendarMascot: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg viewBox="0 0 128 128" className={className} role="img" aria-label={title ?? "Calendar"}>
    <style>{`
      @keyframes cmBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      .cm-body { animation: cmBob 3.4s ease-in-out infinite; transform-origin: center; }
      @media (prefers-reduced-motion: reduce) { .cm-body { animation: none; } }
    `}</style>
    <defs>
      <linearGradient id="calBand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FF8A75" />
        <stop offset="100%" stopColor="#E23D3D" />
      </linearGradient>
      <radialGradient id="calGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Soft halo + contact shadow */}
    <circle cx="64" cy="62" r="54" fill="url(#calGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />

    <g className="cm-body">
      {/* Binder rings, poking above the band */}
      <rect x="45" y="29" width="6" height="13" rx="3" fill="#B91C1C" />
      <rect x="77" y="29" width="6" height="13" rx="3" fill="#B91C1C" />

      {/* Page */}
      <rect x="30" y="38" width="68" height="52" rx="9" fill="#ffffff" stroke="#FCA5A5" strokeWidth="2" />
      {/* Red binder band with rounded top corners */}
      <path d="M30 54 V47 a9 9 0 0 1 9 -9 H89 a9 9 0 0 1 9 9 V54 Z" fill="url(#calBand)" />
      {/* Three day-column ticks on the band */}
      <g fill="#ffffff" opacity="0.75">
        <rect x="42" y="45" width="8" height="3.5" rx="1.75" />
        <rect x="60" y="45" width="8" height="3.5" rx="1.75" />
        <rect x="78" y="45" width="8" height="3.5" rx="1.75" />
      </g>

      {/* A worried face on the page */}
      <circle cx="53" cy="68" r="3.6" fill="#7F1D1D" />
      <circle cx="75" cy="68" r="3.6" fill="#7F1D1D" />
      {/* Angled brows */}
      <path d="M46 61l10 3" stroke="#7F1D1D" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M82 61l-10 3" stroke="#7F1D1D" strokeWidth="2.8" strokeLinecap="round" />
      {/* Downturned mouth */}
      <path d="M54 81q10-7 20 0" fill="none" stroke="#7F1D1D" strokeWidth="3.2" strokeLinecap="round" />
    </g>
  </svg>
);

export default CalendarMascot;

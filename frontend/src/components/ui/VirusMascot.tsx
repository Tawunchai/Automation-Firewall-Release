import React from "react";

/**
 * The red virus character that heads the delete / remove dialogs — the same actor as the one on the
 * sign-in illustration (authentication/HeroArt.tsx), lifted into its own self-contained drawing so
 * the "danger" these modals carry has a face instead of a generic warning triangle.
 *
 * Shared here (not under one page) because several destructive dialogs use it: the user-management
 * delete and the per-user device-credential removal.
 *
 * Pure inline SVG: it stays crisp at any size, needs no second request, and the one soft idle bob
 * is dropped under `prefers-reduced-motion`.
 */

const CX = 64;
const CY = 60;
const R = 31;
const REACH = 45;
const SPIKES = 11;

const spikes = Array.from({ length: SPIKES }, (_, i) => {
  const a = (i / SPIKES) * Math.PI * 2 - Math.PI / 2;
  return {
    x1: CX + R * Math.cos(a),
    y1: CY + R * Math.sin(a),
    x2: CX + REACH * Math.cos(a),
    y2: CY + REACH * Math.sin(a),
  };
});

const VirusMascot: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg viewBox="0 0 128 128" className={className} role="img" aria-label={title ?? "Warning"}>
    <style>{`
      @keyframes vmBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      .vm-body { animation: vmBob 3.4s ease-in-out infinite; transform-origin: center; }
      @media (prefers-reduced-motion: reduce) { .vm-body { animation: none; } }
    `}</style>
    <defs>
      <linearGradient id="vmFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FF8A75" />
        <stop offset="100%" stopColor="#E23D3D" />
      </linearGradient>
      <radialGradient id="vmGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Soft halo + contact shadow, so the character sits in the panel rather than floating flat */}
    <circle cx={CX} cy={CY} r="54" fill="url(#vmGlow)" />
    <ellipse cx={CX} cy="112" rx="34" ry="6.5" fill="#0f172a" opacity="0.08" />

    <g className="vm-body">
      {/* Spikes — stalk + knob, drawn as one family */}
      <g stroke="#D93A3A" strokeWidth="5.5" strokeLinecap="round">
        {spikes.map((s) => (
          <line key={`s${s.x2.toFixed(1)}-${s.y2.toFixed(1)}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      {spikes.map((s) => (
        <circle key={`k${s.x2.toFixed(1)}-${s.y2.toFixed(1)}`} cx={s.x2} cy={s.y2} r="5.5" fill="#D93A3A" />
      ))}

      {/* Body */}
      <circle cx={CX} cy={CY} r={R} fill="url(#vmFill)" />
      <circle cx={CX - 13} cy={CY - 13} r="6" fill="#ffffff" opacity="0.22" />
      <circle cx={CX + 14} cy={CY + 11} r="4" fill="#ffffff" opacity="0.16" />

      {/* A worried, up-to-no-good face */}
      <ellipse cx={CX - 10} cy={CY - 5} rx="7.5" ry="8.5" fill="#ffffff" />
      <ellipse cx={CX + 12} cy={CY - 5} rx="7.5" ry="8.5" fill="#ffffff" />
      <circle cx={CX - 8} cy={CY - 3} r="3.4" fill="#7F1D1D" />
      <circle cx={CX + 14} cy={CY - 3} r="3.4" fill="#7F1D1D" />
      {/* Angled brows — turns "cute" into "menacing" */}
      <path d={`M${CX - 18} ${CY - 15}l10 4`} stroke="#7F1D1D" strokeWidth="3" strokeLinecap="round" />
      <path d={`M${CX + 20} ${CY - 15}l-10 4`} stroke="#7F1D1D" strokeWidth="3" strokeLinecap="round" />
      {/* Downturned mouth with two small fangs */}
      <path d={`M${CX - 11} ${CY + 16}q11-7 22 0`} fill="none" stroke="#7F1D1D" strokeWidth="3.2" strokeLinecap="round" />
      <path d={`M${CX - 5} ${CY + 14}l-1.5 4M${CX + 5} ${CY + 14}l1.5 4`} stroke="#7F1D1D" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  </svg>
);

export default VirusMascot;

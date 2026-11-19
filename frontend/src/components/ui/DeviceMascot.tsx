import React from "react";

/**
 * A network-appliance character — the device whose credential is about to be removed, given a face
 * so the "you're cutting this device off" lands the way the virus does on the user-delete dialog.
 *
 * Same drawing language as VirusMascot (red gradient body, worried eyes, angled brows, a downturned
 * mouth, a soft halo + contact shadow, one idle bob dropped under reduced motion) so the two read as
 * one family — only the body is an appliance (rounded chassis, two antennae, status LEDs, a vent
 * strip) instead of a spiked cell.
 */

const DeviceMascot: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <svg viewBox="0 0 128 128" className={className} role="img" aria-label={title ?? "Device"}>
    <style>{`
      @keyframes dmBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      .dm-body { animation: dmBob 3.4s ease-in-out infinite; transform-origin: center; }
      @media (prefers-reduced-motion: reduce) { .dm-body { animation: none; } }
    `}</style>
    <defs>
      <linearGradient id="dmFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FF8A75" />
        <stop offset="100%" stopColor="#E23D3D" />
      </linearGradient>
      <radialGradient id="dmGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Soft halo + contact shadow — the character sits in the panel rather than floating flat */}
    <circle cx="64" cy="62" r="54" fill="url(#dmGlow)" />
    <ellipse cx="64" cy="112" rx="34" ry="6.5" fill="#0f172a" opacity="0.08" />

    <g className="dm-body">
      {/* Antennae */}
      <g stroke="#D93A3A" strokeWidth="4" strokeLinecap="round">
        <line x1="47" y1="42" x2="43" y2="26" />
        <line x1="81" y1="42" x2="85" y2="26" />
      </g>
      <circle cx="43" cy="25" r="3.6" fill="#D93A3A" />
      <circle cx="85" cy="25" r="3.6" fill="#D93A3A" />

      {/* Chassis */}
      <rect x="29" y="40" width="70" height="47" rx="11" fill="url(#dmFill)" />
      {/* Top sheen */}
      <path d="M38 44h52a8 8 0 0 1 8 8v0a60 60 0 0 1-68 0v0a8 8 0 0 1 8-8z" fill="#ffffff" opacity="0.14" />

      {/* Vent strip + status LEDs across the top of the front panel */}
      <g stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round">
        <line x1="66" y1="50" x2="78" y2="50" />
        <line x1="66" y1="53.5" x2="78" y2="53.5" />
      </g>
      <circle cx="40" cy="51" r="2.6" fill="#ffffff" opacity="0.9" />
      <circle cx="48" cy="51" r="2.6" fill="#ffffff" opacity="0.45" />

      {/* A worried, about-to-be-unplugged face */}
      <ellipse cx="54" cy="66" rx="7" ry="8" fill="#ffffff" />
      <ellipse cx="74" cy="66" rx="7" ry="8" fill="#ffffff" />
      <circle cx="55.5" cy="68" r="3.1" fill="#7F1D1D" />
      <circle cx="75.5" cy="68" r="3.1" fill="#7F1D1D" />
      {/* Angled brows — worry, not anger-lite */}
      <path d="M45 59l10 3" stroke="#7F1D1D" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M83 59l-10 3" stroke="#7F1D1D" strokeWidth="2.8" strokeLinecap="round" />
      {/* Downturned mouth */}
      <path d="M53 80q11-7 22 0" fill="none" stroke="#7F1D1D" strokeWidth="3.2" strokeLinecap="round" />

      {/* Little feet */}
      <rect x="39" y="86" width="9" height="5" rx="2" fill="#B91C1C" />
      <rect x="80" y="86" width="9" height="5" rx="2" fill="#B91C1C" />
    </g>
  </svg>
);

export default DeviceMascot;

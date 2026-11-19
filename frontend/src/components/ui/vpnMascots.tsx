import React from "react";

/**
 * The delete-dialog mascot for the VPN section — a worried red character in the same drawing family
 * as VirusMascot / securityMascots / systemMascots / authMascots (red gradient body, dark worried
 * eyes + angled brows + downturned mouth, a soft halo + contact shadow, one idle bob dropped under
 * `prefers-reduced-motion`). The body is a **secure tunnel** (a tunnel mouth with depth rings + a
 * little padlock above it) so an IPsec-tunnel delete has a face that fits the topic.
 *
 * Unique gradient ids (`vpnFill` / `vpnGlow`) so it never clashes with the other mascot files.
 */

type MascotProps = { className?: string; title?: string };

const Face: React.FC<{ cx: number; cy: number; dx?: number; r?: number }> = ({ cx, cy, dx = 9, r = 3.3 }) => (
  <>
    <circle cx={cx - dx} cy={cy} r={r} fill="#7F1D1D" />
    <circle cx={cx + dx} cy={cy} r={r} fill="#7F1D1D" />
    <path d={`M${cx - dx - 8} ${cy - 7}l9 3`} stroke="#7F1D1D" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <path d={`M${cx + dx + 8} ${cy - 7}l-9 3`} stroke="#7F1D1D" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <path d={`M${cx - 10} ${cy + 13}q10-6 20 0`} fill="none" stroke="#7F1D1D" strokeWidth="3" strokeLinecap="round" />
  </>
);

/** Secure VPN tunnel. */
export const VpnMascot: React.FC<MascotProps> = ({ className, title }) => (
  <svg viewBox="0 0 128 128" className={className} role="img" aria-label={title ?? "Warning"}>
    <style>{`@keyframes vpnBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}.vpn-body{animation:vpnBob 3.4s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.vpn-body{animation:none}}`}</style>
    <defs>
      <linearGradient id="vpnFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FF8A75" />
        <stop offset="100%" stopColor="#E23D3D" />
      </linearGradient>
      <radialGradient id="vpnGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="64" cy="62" r="54" fill="url(#vpnGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />
    <g className="vpn-body">
      {/* tunnel mouth */}
      <path d="M38 102 V68 a26 26 0 0 1 52 0 V102 Z" fill="url(#vpnFill)" />
      {/* depth rings */}
      <g fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2.2">
        <path d="M38 68 a26 26 0 0 1 52 0" />
        <path d="M48 102 V72 a16 16 0 0 1 32 0 V102" />
      </g>
      <circle cx="53" cy="58" r="3.3" fill="#ffffff" opacity="0.16" />
      {/* a little padlock floating above — "secure" */}
      <path d="M59 34 v-3 a5 5 0 0 1 10 0 v3" fill="none" stroke="url(#vpnFill)" strokeWidth="3" strokeLinecap="round" />
      <rect x="56" y="34" width="16" height="12" rx="3.5" fill="url(#vpnFill)" />
      <circle cx="64" cy="40" r="1.6" fill="#7F1D1D" />
      {/* worried face inside the tunnel */}
      <Face cx={64} cy={82} dx={9} r={3.1} />
    </g>
  </svg>
);

export default VpnMascot;

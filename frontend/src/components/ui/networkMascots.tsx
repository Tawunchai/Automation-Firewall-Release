import React from "react";

/**
 * Delete-dialog mascots for the Network section — worried red characters in the same drawing family
 * as VirusMascot / securityMascots / systemMascots / authMascots (red gradient body, dark worried
 * eyes + angled brows + downturned mouth, a soft halo + contact shadow, one idle bob dropped under
 * `prefers-reduced-motion`). One character per topic:
 *
 *   RouteMascot — a directional route sign on a post (Static Routes)
 *   DhcpMascot  — a server handing out addresses   (DHCP Servers)
 *
 * Unique gradient ids (`netFill` / `netGlow`) so they never clash with the other mascot files.
 */

type MascotProps = { className?: string; title?: string };

const Defs: React.FC = () => (
  <defs>
    <linearGradient id="netFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FF8A75" />
      <stop offset="100%" stopColor="#E23D3D" />
    </linearGradient>
    <radialGradient id="netGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
      <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
    </radialGradient>
  </defs>
);

const Face: React.FC<{ cx: number; cy: number; dx?: number; r?: number }> = ({ cx, cy, dx = 9, r = 3.3 }) => (
  <>
    <circle cx={cx - dx} cy={cy} r={r} fill="#7F1D1D" />
    <circle cx={cx + dx} cy={cy} r={r} fill="#7F1D1D" />
    <path d={`M${cx - dx - 8} ${cy - 7}l9 3`} stroke="#7F1D1D" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <path d={`M${cx + dx + 8} ${cy - 7}l-9 3`} stroke="#7F1D1D" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    <path d={`M${cx - 10} ${cy + 13}q10-6 20 0`} fill="none" stroke="#7F1D1D" strokeWidth="3" strokeLinecap="round" />
  </>
);

const Svg: React.FC<MascotProps & { children: React.ReactNode }> = ({ className, title, children }) => (
  <svg viewBox="0 0 128 128" className={className} role="img" aria-label={title ?? "Warning"}>
    <style>{`@keyframes netBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}.net-body{animation:netBob 3.4s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.net-body{animation:none}}`}</style>
    <Defs />
    <circle cx="64" cy="62" r="54" fill="url(#netGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />
    <g className="net-body">{children}</g>
  </svg>
);

/** Static Routes — a directional route sign on a post. */
export const RouteMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* post */}
    <rect x="59" y="74" width="8" height="30" rx="2.5" fill="#B91C1C" />
    {/* right-pointing route sign */}
    <path d="M30 40 H84 L100 58 L84 76 H30 Z" fill="url(#netFill)" />
    <circle cx="40" cy="47" r="3" fill="#ffffff" opacity="0.16" />
    <Face cx={60} cy={58} dx={9} r={3.1} />
  </Svg>
);

/** DHCP Servers — a server dispensing addresses. */
export const DhcpMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* server body */}
    <rect x="42" y="34" width="44" height="52" rx="9" fill="url(#netFill)" />
    {/* status LEDs along the top */}
    <circle cx="56" cy="44" r="2.6" fill="#ffffff" opacity="0.85" />
    <circle cx="64" cy="44" r="2.6" fill="#ffffff" opacity="0.55" />
    <circle cx="72" cy="44" r="2.6" fill="#ffffff" opacity="0.3" />
    <circle cx="51" cy="78" r="3" fill="#ffffff" opacity="0.14" />
    {/* dispensing-down chevron — handing out an address */}
    <path d="M57 92 l7 7 l7 -7" fill="none" stroke="url(#netFill)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <Face cx={64} cy={64} dx={9} r={3.1} />
  </Svg>
);

export default RouteMascot;

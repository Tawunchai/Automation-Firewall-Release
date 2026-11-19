import React from "react";

/**
 * The delete-dialog mascots for the User & Authentication section — one worried red character per
 * page, in the same drawing language as VirusMascot / DeviceMascot / CalendarMascot (red gradient
 * body, dark worried eyes + angled brows + a downturned mouth, a soft halo + contact shadow, one
 * idle bob dropped under reduced motion). Only the body changes per topic:
 *
 *   UserMascot   — a single person (User Definition)
 *   GroupMascot  — a huddle of people (User Groups)
 *   LdapMascot   — a directory data-store cylinder (LDAP Servers)
 *   RadiusMascot — an auth server throwing radio waves (RADIUS Servers)
 */

type MascotProps = { className?: string; title?: string };

const Defs: React.FC = () => (
  <defs>
    <linearGradient id="amFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FF8A75" />
      <stop offset="100%" stopColor="#E23D3D" />
    </linearGradient>
    <radialGradient id="amGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
      <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
    </radialGradient>
  </defs>
);

/** Worried face centred on (cx, cy). */
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
    <style>{`@keyframes amBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}.am-body{animation:amBob 3.4s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.am-body{animation:none}}`}</style>
    <Defs />
    <circle cx="64" cy="62" r="54" fill="url(#amGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />
    <g className="am-body">{children}</g>
  </svg>
);

export const UserMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path d="M32 104 C32 82 48 74 64 74 C80 74 96 82 96 104 Z" fill="url(#amFill)" />
    <circle cx="64" cy="46" r="21" fill="url(#amFill)" />
    <circle cx="55" cy="37" r="4.5" fill="#ffffff" opacity="0.18" />
    <Face cx={64} cy={46} dx={8} r={3.1} />
  </Svg>
);

export const GroupMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* two companions behind */}
    <g opacity="0.5">
      <path d="M18 102 C18 86 27 80 38 80 C49 80 58 86 58 102 Z" fill="url(#amFill)" />
      <circle cx="38" cy="52" r="14" fill="url(#amFill)" />
      <path d="M70 102 C70 86 79 80 90 80 C101 80 110 86 110 102 Z" fill="url(#amFill)" />
      <circle cx="90" cy="52" r="14" fill="url(#amFill)" />
    </g>
    {/* the one in front, with the face */}
    <path d="M36 104 C36 84 50 77 64 77 C78 77 92 84 92 104 Z" fill="url(#amFill)" />
    <circle cx="64" cy="51" r="19" fill="url(#amFill)" />
    <circle cx="56" cy="43" r="4" fill="#ffffff" opacity="0.18" />
    <Face cx={64} cy={51} dx={7.5} r={2.9} />
  </Svg>
);

export const LdapMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* data-store cylinder */}
    <path d="M34 44 v40 a30 10 0 0 0 60 0 V44 Z" fill="url(#amFill)" />
    <ellipse cx="64" cy="44" rx="30" ry="10" fill="#FF9E8C" />
    <ellipse cx="64" cy="44" rx="30" ry="10" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" />
    {/* a stacked-disc divider */}
    <path d="M34 60 a30 10 0 0 0 60 0" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="2" />
    <Face cx={64} cy={75} dx={10} r={3.3} />
  </Svg>
);

export const RadiusMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* radio waves either side */}
    <g fill="none" stroke="#F87171" strokeWidth="3" strokeLinecap="round" opacity="0.85">
      <path d="M31 42 a15 15 0 0 0 0 20" />
      <path d="M22 35 a26 26 0 0 0 0 34" />
      <path d="M97 42 a15 15 0 0 1 0 20" />
      <path d="M106 35 a26 26 0 0 1 0 34" />
    </g>
    {/* the auth server */}
    <rect x="39" y="40" width="50" height="50" rx="9" fill="url(#amFill)" />
    <circle cx="48" cy="50" r="2.6" fill="#ffffff" opacity="0.85" />
    <circle cx="56" cy="50" r="2.6" fill="#ffffff" opacity="0.5" />
    <Face cx={64} cy={70} dx={9} r={3.3} />
  </Svg>
);

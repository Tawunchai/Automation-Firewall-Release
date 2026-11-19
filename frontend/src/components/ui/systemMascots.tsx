import React from "react";

/**
 * Delete-dialog mascots for the System section — same worried-red drawing family as
 * securityMascots.tsx / authMascots.tsx / VirusMascot (red gradient body, dark worried eyes +
 * angled brows + a downturned mouth, a soft halo + contact shadow, one idle bob dropped under
 * `prefers-reduced-motion`). Only the body changes per topic.
 *
 *   SnmpMascot — a reporting agent node throwing signal waves (System ▸ SNMP)
 *   PinMascot  — a padlock whose shackle has sprung open (System ▸ Device Identities)
 *
 * Unique gradient ids (`sys*`) so the fills never collide with the other mascot families when more
 * than one kind is mounted on the same page.
 */

type MascotProps = { className?: string; title?: string };

const Defs: React.FC = () => (
  <defs>
    <linearGradient id="sysFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FF8A75" />
      <stop offset="100%" stopColor="#E23D3D" />
    </linearGradient>
    <radialGradient id="sysGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#F87171" stopOpacity="0.28" />
      <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
    </radialGradient>
  </defs>
);

/** The shared worried face, centred on (cx, cy). */
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
    <style>{`@keyframes sysBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}.sys-body{animation:sysBob 3.4s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.sys-body{animation:none}}`}</style>
    <Defs />
    <circle cx="64" cy="62" r="54" fill="url(#sysGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />
    <g className="sys-body">{children}</g>
  </svg>
);

/** System ▸ SNMP — a monitored agent node reporting up a signal. */
export const SnmpMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* broadcast signal arcs rising off the node */}
    <g fill="none" stroke="#F87171" strokeWidth="3" strokeLinecap="round" opacity="0.85">
      <path d="M52 40 a18 18 0 0 1 24 0" />
      <path d="M45 31 a31 31 0 0 1 38 0" />
    </g>
    <circle cx="64" cy="41" r="3.2" fill="#E23D3D" />
    {/* the agent node */}
    <rect x="40" y="48" width="48" height="46" rx="11" fill="url(#sysFill)" />
    <circle cx="51" cy="59" r="3.3" fill="#ffffff" opacity="0.16" />
    <Face cx={64} cy={71} dx={9} r={3.2} />
  </Svg>
);

/**
 * System ▸ Device Identities — a padlock with its shackle sprung open.
 *
 * Clearing a pin is not a deletion, which is why this is not a bin or a shredder: the row goes, but
 * what actually happens is that the lock holding this firewall's identity comes off, and the next
 * connection re-locks it around whatever answers. An open shackle is that, in one picture.
 */
export const PinMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    {/* the shackle, swung open to the right rather than seated in the body */}
    <path
      d="M52 50V38a12 12 0 0 1 24 0v6"
      fill="none"
      stroke="#F87171"
      strokeWidth="7"
      strokeLinecap="round"
    />
    {/* the body */}
    <rect x="38" y="50" width="52" height="44" rx="10" fill="url(#sysFill)" />
    <circle cx="49" cy="60" r="3.3" fill="#ffffff" opacity="0.16" />
    <Face cx={64} cy={72} dx={9} r={3.2} />
  </Svg>
);

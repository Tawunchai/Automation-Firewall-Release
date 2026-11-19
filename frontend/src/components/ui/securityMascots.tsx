import React from "react";

/**
 * The delete-dialog mascots for the Security Profiles section — one worried red character per page,
 * in the same drawing language as VirusMascot / DeviceMascot / CalendarMascot / the authMascots
 * (red gradient body, dark worried eyes + angled brows + a downturned mouth, a soft halo + contact
 * shadow, one idle bob dropped under `prefers-reduced-motion`). Only the body changes per topic, so
 * every one of the eight Security Profiles pages gets a destructive dialog with a face of its own:
 *
 *   IpsMascot         — a guard shield          (Intrusion Prevention)
 *   (VirusMascot)     — the virus itself        (AntiVirus — reused from ./VirusMascot)
 *   WebFilterMascot   — a globe                  (Web Filter)
 *   DnsFilterMascot   — a name tag              (DNS Filter)
 *   AppControlMascot  — a CPU chip               (Application Control)
 *   FileFilterMascot  — a document              (File Filter)
 *   SslSshMascot      — a padlock               (SSL/SSH Inspection)
 *   WebRatingMascot   — a rating star           (Web Rating Overrides)
 *
 * Pure inline SVG: crisp at any size, no second request, one idle bob under reduced motion.
 */

type MascotProps = { className?: string; title?: string };

const Defs: React.FC = () => (
  <defs>
    <linearGradient id="smFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FF8A75" />
      <stop offset="100%" stopColor="#E23D3D" />
    </linearGradient>
    <radialGradient id="smGlow" cx="50%" cy="50%" r="50%">
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
    <style>{`@keyframes smBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}.sm-body{animation:smBob 3.4s ease-in-out infinite;transform-origin:center}@media (prefers-reduced-motion:reduce){.sm-body{animation:none}}`}</style>
    <Defs />
    <circle cx="64" cy="62" r="54" fill="url(#smGlow)" />
    <ellipse cx="64" cy="112" rx="33" ry="6.5" fill="#0f172a" opacity="0.08" />
    <g className="sm-body">{children}</g>
  </svg>
);

/** Intrusion Prevention — a guard shield. */
export const IpsMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path d="M64 28 L95 40 V64 C95 85 81 97 64 104 C47 97 33 85 33 64 V40 Z" fill="url(#smFill)" />
    <circle cx="54" cy="45" r="4" fill="#ffffff" opacity="0.16" />
    <Face cx={64} cy={60} dx={9} r={3.3} />
  </Svg>
);

/** Web Filter — a globe. */
export const WebFilterMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <circle cx="64" cy="62" r="31" fill="url(#smFill)" />
    <g fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="2">
      <ellipse cx="64" cy="62" rx="12.5" ry="31" />
      <path d="M35 51 h58 M34 73 h60" />
    </g>
    <circle cx="52" cy="48" r="4" fill="#ffffff" opacity="0.18" />
    <Face cx={64} cy={58} dx={9} r={3.1} />
  </Svg>
);

/** DNS Filter — a name tag (DNS is about names). */
export const DnsFilterMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path d="M48 36 L92 36 a8 8 0 0 1 8 8 V84 a8 8 0 0 1 -8 8 H48 L30 64 Z" fill="url(#smFill)" />
    <circle cx="44" cy="64" r="4.5" fill="#7F1D1D" opacity="0.5" />
    <circle cx="82" cy="46" r="3.5" fill="#ffffff" opacity="0.16" />
    <Face cx={68} cy={64} dx={9} r={3.1} />
  </Svg>
);

/** Application Control — a CPU chip. */
export const AppControlMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <g stroke="#D93A3A" strokeWidth="5" strokeLinecap="round">
      <path d="M48 30 v10 M64 30 v10 M80 30 v10" />
      <path d="M48 88 v10 M64 88 v10 M80 88 v10" />
      <path d="M30 48 h10 M30 64 h10 M30 80 h10" />
      <path d="M88 48 h10 M88 64 h10 M88 80 h10" />
    </g>
    <rect x="40" y="40" width="48" height="48" rx="9" fill="url(#smFill)" />
    <rect x="51" y="51" width="26" height="26" rx="4" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" />
    <Face cx={64} cy={64} dx={9} r={3.2} />
  </Svg>
);

/** File Filter — a document. */
export const FileFilterMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path d="M42 28 H74 L90 44 V96 a4 4 0 0 1 -4 4 H46 a4 4 0 0 1 -4 -4 Z" fill="url(#smFill)" />
    <path d="M74 28 V44 H90" fill="none" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2.4" />
    <g stroke="#ffffff" strokeOpacity="0.26" strokeWidth="3" strokeLinecap="round">
      <path d="M52 82 h24" />
      <path d="M52 90 h15" />
    </g>
    <Face cx={64} cy={62} dx={9} r={3.1} />
  </Svg>
);

/** SSL/SSH Inspection — a padlock. */
export const SslSshMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path d="M50 54 V44 a14 14 0 0 1 28 0 V54" fill="none" stroke="url(#smFill)" strokeWidth="7" strokeLinecap="round" />
    <rect x="38" y="52" width="52" height="47" rx="10" fill="url(#smFill)" />
    <circle cx="53" cy="63" r="3.5" fill="#ffffff" opacity="0.16" />
    <Face cx={64} cy={76} dx={9} r={3.2} />
  </Svg>
);

/** Web Rating Overrides — a rating star. */
export const WebRatingMascot: React.FC<MascotProps> = (props) => (
  <Svg {...props}>
    <path
      d="M64 30 L72.2 52.7 L96.3 53.5 L77.3 68.3 L84 91.5 L64 78 L44 91.5 L50.7 68.3 L31.7 53.5 L55.8 52.7 Z"
      fill="url(#smFill)"
      strokeLinejoin="round"
    />
    <Face cx={64} cy={58} dx={8} r={2.9} />
  </Svg>
);

import React from "react";
import { GLOBE_D, SHIELD_D } from "../ai-assistant/packetSimLayout";
import type { StageState } from "./trace-model";

// The pictures on the Troubleshooting packet path — drawn here as SVG paths, not loaded from an
// icon font or an image, because they live INSIDE another SVG and have to be coloured per stage by
// the flow tokens (`--flow-allow`, `--flow-deny` …) in both themes.
//
// Every glyph is drawn on a 24-unit grid with round caps and joins, so they read as one family.
// The globe and the shield are the AI Assistant's own (packetSimLayout.ts): the internet and the
// firewall look the same on both pages that draw a packet.

export type IconName =
  | "client"       // a laptop — the source, when it is an address inside the network
  | "server"       // a rack server — the destination, when it is inside the network
  | "internet"     // the globe — any public address, either end
  | "port"         // an RJ45 jack with its two link LEDs — the incoming and outgoing interface
  | "route"        // a path between two points — the routing lookup
  | "policy"       // a shield with a tick — the policy that allows it
  | "policy-deny"  // the same shield crossed — the policy (or implicit deny) that drops it
  | "nat"          // two opposing arrows — an address rewritten on the way through
  | "inspect"      // a magnifier with a scan trace — security profiles looking inside
  | "router"       // the network-diagram router: four arrows, two in and two out — a gateway hop
  | "firewall";    // a brick wall — the FortiGate itself, on its chassis

type Glyph = (colour: string) => React.ReactNode;

/** Solid bits (LEDs, dots) — the parent sets stroke-only, so fills are opted into per element. */
const solid = (colour: string): React.CSSProperties => ({ fill: colour, stroke: "none" });

const GLYPHS: Record<IconName, Glyph> = {
  client: () => (
    <>
      <rect x={4} y={4.5} width={16} height={11} rx={1.6} />
      <path d="M7.5 8.5h9M7.5 11.5h5.5" strokeOpacity={0.55} />
      <path d="M2 18.8h20" />
      <path d="M10 18.8l.7 1.2h2.6l.7-1.2" />
    </>
  ),
  server: (c) => (
    <>
      <rect x={3.5} y={3.5} width={17} height={7} rx={1.8} />
      <rect x={3.5} y={13.5} width={17} height={7} rx={1.8} />
      <circle cx={7.2} cy={7} r={1.05} style={solid(c)} />
      <circle cx={7.2} cy={17} r={1.05} style={solid(c)} />
      <path d="M11 7h6M11 17h6" strokeOpacity={0.55} />
    </>
  ),
  internet: () => (
    <>
      <path d={GLOBE_D.disc} />
      <path d={GLOBE_D.meridian} />
      {GLOBE_D.lats.map((d) => <path key={d} d={d} strokeOpacity={0.6} />)}
    </>
  ),
  port: (c) => (
    <>
      <rect x={3.5} y={4.5} width={17} height={15} rx={2.4} />
      {/* The jack's keyed opening, seen face-on */}
      <path d="M8 16.5v-4.8h1.7V9.6h4.6v2.1H16v4.8z" />
      <circle cx={6.4} cy={7.3} r={1} style={solid(c)} />
      <circle cx={17.6} cy={7.3} r={1} style={solid(c)} />
    </>
  ),
  route: () => (
    <>
      <circle cx={6} cy={18.5} r={2.3} />
      <circle cx={18} cy={5.5} r={2.3} />
      <path d="M8.3 18.5H16a3.25 3.25 0 0 0 0-6.5H8a3.25 3.25 0 0 1 0-6.5h7.7" />
    </>
  ),
  policy: () => (
    <>
      <path d={SHIELD_D} />
      <path d="M8.6 12.1l2.4 2.4 4.5-4.8" />
    </>
  ),
  "policy-deny": () => (
    <>
      <path d={SHIELD_D} />
      <path d="M9.4 9.4l5.2 5.2M14.6 9.4l-5.2 5.2" />
    </>
  ),
  nat: () => (
    <>
      <path d="M4 8.5h14.5M15 5l3.5 3.5L15 12" />
      <path d="M20 15.5H5.5M9 12l-3.5 3.5L9 19" />
    </>
  ),
  inspect: () => (
    <>
      <circle cx={10.5} cy={10.5} r={6.8} />
      <path d="M15.5 15.5L21 21" />
      <path d="M6.6 10.6h1.7l1.2-2.3 1.9 4.6 1.2-2.3h1.6" strokeOpacity={0.8} />
    </>
  ),
  // Drawn without its own circle: the node it sits in is the circle, as on a network diagram.
  router: () => (
    <>
      {/* In, from top-left and bottom-right */}
      <path d="M4.5 4.5l5 5M9.5 5.6v3.9H5.6" />
      <path d="M19.5 19.5l-5-5M14.5 18.4v-3.9h3.9" />
      {/* Out, towards top-right and bottom-left */}
      <path d="M14 10l5.5-5.5M15.6 4.5h3.9v3.9" />
      <path d="M10 14l-5.5 5.5M8.4 19.5H4.5v-3.9" />
    </>
  ),
  firewall: () => (
    <>
      <rect x={3} y={4.5} width={18} height={15} rx={2} />
      <path d="M3 9.5h18M3 14.5h18M9 4.5v5M15 4.5v5M12 9.5v5M7 14.5v5M17 14.5v5" />
    </>
  ),
};

/**
 * One glyph, centred on (cx, cy) and `size` units across.
 *
 * The stroke width is divided by the scale so every icon draws the same visual weight whatever its
 * size — otherwise the 32-unit endpoints would come out a third heavier than the 26-unit stages.
 */
export const FlowIcon: React.FC<{
  name: IconName; cx: number; cy: number; size: number; colour: string; weight?: number;
}> = ({ name, cx, cy, size, colour, weight = 2 }) => {
  const k = size / 24;
  return (
    <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`}
      style={{ stroke: colour, fill: "none" }} strokeWidth={weight / k}
      strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[name](colour)}
    </g>
  );
};

/** The mark inside a stage's status badge, centred on 0,0. */
const BADGE_D: Record<Exclude<StageState, "skip">, string> = {
  ok: "M-3.3 0.2l2.2 2.2 4.4-4.5",
  fail: "M-2.6 -2.6l5.2 5.2M2.6 -2.6l-5.2 5.2",
  warn: "M0 -3.4v3.7",
  off: "M-3 0h6",
};

/**
 * The small round badge on a stage's corner — ✓ ✕ ! – — so the verdict of every stage survives
 * without colour (and without motion).
 *
 * The mark is drawn in the card colour rather than white: on the dark theme the status hues are
 * the light ones (#34d399, #fbbf24), and white on those is barely there.
 */
export const StatusBadge: React.FC<{ x: number; y: number; state: StageState; colour: string }> = ({
  x, y, state, colour,
}) => {
  if (state === "skip") return null;
  const mark = "var(--flow-node-bg)";
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={8.5} style={{ fill: colour, stroke: mark }} strokeWidth={2.5} />
      <path d={BADGE_D[state]} style={{ stroke: mark, fill: "none" }} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" />
      {state === "warn" && <circle cy={3.2} r={1.15} style={{ fill: mark }} />}
    </g>
  );
};

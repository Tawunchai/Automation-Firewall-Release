import React, { useId, useMemo } from "react";
import type { PolicyTrace } from "../../api/troubleshoot";
import {
  endpointKind, flowStages, fmtSpeed, gatewayOf, stopIndex, wireHeaders,
  type Stage, type StageState, type WireHeader,
} from "./trace-model";
import { FlowIcon, StatusBadge, type IconName } from "./flowIcons";

// The packet's path as a small topology: the client (or the internet) on the left, the FortiGate
// appliance in the middle with its six stages — in · routing · policy · NAT · inspection · out —
// and the server (or the internet) on the right, cabled through the chassis' ports. Where a side
// is reached through a router rather than directly connected, that gateway sits on the cable.
//
// Packets stream from the source along the cable and go as far as the trace says they get: all the
// way when allowed — each stage glowing as a packet passes through it, the packet taking the NAT
// colour at the NAT stage when an address is rewritten, replies flowing back underneath — or up to
// the stage that stops them, where they tip off the wire and vanish. Stages after that one are
// greyed and dashed, because the packet never got there.
//
// Under the diagram, what the packet CARRIES on each wire: its header as sent, and as it leaves —
// the translated address in the NAT colour. That row is HTML, not SVG text, so it sizes itself to
// the translated caption and is translated like the rest of the page.
//
// Pure SVG with SMIL <animateMotion> and one CSS keyframe for the cable stream, so it costs no
// JavaScript per frame; remounting (the `key` the page passes) replays it. With "reduce motion" set
// in the OS nothing moves — the icons, the badges and the colours still tell the whole story.
//
// Colours are the `--flow-*` role tokens (index.css): an SVG cannot take Tailwind's `dark:`
// variants, and the dark theme needs the lighter hues, not the same ones at another opacity.

const W = 1120;
const H = 300;
/** Centre of each stage, source → destination. The six inside the chassis are evenly spaced on x=560. */
const XS = [58, 280, 392, 504, 616, 728, 840, 1062];
/** The gateway slots on the cable, between each end and the chassis. */
const GW = { left: 150, right: 970 };
/** The wire. */
const Y = 146;
/** A stage inside the FortiGate, an endpoint outside it, and a router on the cable (radius). */
const TILE = 54;
const END = 64;
const HOP = 21;
/** The FortiGate chassis, and the height of its header strip. */
const BOX = { x: 215, y: 40, w: 690, h: 204, head: 34 };
/** The row under the chassis that says what the packet carries on each wire. */
const WIRE_Y = 272;

type Tone = { line: string; tint: string };

const TONE: Record<StageState, Tone> = {
  ok: { line: "var(--flow-allow)", tint: "var(--flow-allow-bg)" },
  fail: { line: "var(--flow-deny)", tint: "var(--flow-deny-bg)" },
  warn: { line: "var(--flow-warn)", tint: "var(--flow-warn-bg)" },
  off: { line: "var(--shell-ink-3)", tint: "var(--flow-chip-bg)" },
  skip: { line: "var(--shell-ink-3)", tint: "transparent" },
};

/**
 * The packets' own colour — fixed, not the user's accent. An accent can be red, and red packets on
 * this diagram would read as "blocked" on a trace that succeeded.
 *
 * A literal on purpose: `--flow-info` is tuned for TEXT (sky-700 on the light theme) and a packet
 * drawn in it reads as a dark blob, not light moving down a cable. Sky-500 is the dashboard's
 * validated second-series hue, holds on both grounds, and is none of the status hues.
 */
const PACKET = "#0EA5E9";
/**
 * A packet whose address the FortiGate rewrote, and the rewritten address in the header row — the
 * same colour in both places, so the eye links the two. Violet-500: not a status hue, and far
 * enough from sky to read as "changed", not "the same thing, lighter".
 */
const NATTED = "#8B5CF6";
/** Replies are the allow colour: they exist only because the connection got through. */
const REPLY = "var(--flow-allow)";

/** Units per second along the wire — a full allowed run takes a little over three seconds. */
const SPEED = 300;
const PACKETS = 3;
/** How far a blocked packet falls when it tips off the wire. */
const DROP = 26;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Which picture each stage gets. The ends depend on the addresses; the policy on its verdict. */
function iconFor(s: Stage, t: PolicyTrace): IconName {
  switch (s.key) {
    case "source": return endpointKind(t.query.src_ip, "source");
    // The label, not the query: behind a Virtual IP it is the mapped server, which is private.
    case "destination": return endpointKind(s.label, "destination");
    case "ingress":
    case "egress": return "port";
    case "route": return "route";
    case "policy": return s.state === "fail" ? "policy-deny" : "policy";
    case "nat": return "nat";
    case "inspect": return "inspect";
  }
}

/** Where on its run a packet changes colour, and to what — present only when NAT rewrote it. */
type Recolour = { at: number; colour: string; tail: string };

/**
 * One packet riding a path: a bright head inside a soft glow, trailing a tail that fades behind it.
 *
 * `rotate="auto"` keeps the tail behind the head whichever way the path runs — to the right for
 * the packet, to the left for its reply — and tips it nose-down as a blocked packet falls off.
 * It is round and small on purpose: it crosses OVER each stage's icon, and a larger or boxier
 * shape sat on the icon like a second one.
 *
 * Colours are attributes, not `style`, because a SMIL <animate> of `fill` loses to an inline style —
 * and the NAT recolour is exactly such an animation.
 */
const Packet: React.FC<{
  path: string; dur: number; begin: number; colour: string; tail: string;
  glow: string; small?: boolean; fadeAt: number; recolour?: Recolour;
}> = ({ path, dur, begin, colour, tail, glow, small, fadeAt, recolour }) => {
  const r = small ? 3.1 : 4.4;
  const len = small ? 22 : 38;
  const thick = small ? 2.8 : 4.2;
  const timing = { dur: `${dur}s`, begin: `${begin}s`, repeatCount: "indefinite" } as const;
  // A short blend rather than a hard cut, centred on the NAT stage.
  const blend = recolour && (
    <animate attributeName="fill" values={`${colour};${colour};${recolour.colour};${recolour.colour}`}
      keyTimes={`0;${Math.max(0.01, recolour.at - 0.02)};${Math.min(0.99, recolour.at + 0.02)};1`} {...timing} />
  );
  // The tail is a gradient, and animating `fill` between two url(#…) paints renders BLACK in
  // Chromium (seen on the first try, for the whole run, not just after NAT). So there are two
  // tails, one per colour, and the NAT stage swaps which one is visible.
  const swap = (from: number, to: number) => recolour && (
    <animate attributeName="opacity" values={`${from};${to}`} keyTimes={`0;${recolour.at}`} calcMode="discrete" {...timing} />
  );
  // A tapered trail: wide at the head, narrowing to nothing at the back, so it reads as a comet
  // rather than a pill. Drawn as a triangle-ish polygon with rounded head via the gradient.
  const tailShape = (paint: string, visible: boolean, anim: React.ReactNode) => (
    <path d={`M0 ${-thick / 2} L0 ${thick / 2} L${-len} 0 Z`} fill={`url(#${paint})`} opacity={visible ? 1 : 0}>
      {anim}
    </path>
  );
  return (
    <g opacity={0}>
      {tailShape(tail, true, swap(1, 0))}
      {recolour && tailShape(recolour.tail, false, swap(0, 1))}
      {/* Soft bloom → mid halo → bright head → white-hot core: a lit pulse, not a dot */}
      <circle r={r * 3} fill={colour} opacity={0.28} filter={`url(#${glow})`}>{blend}</circle>
      <circle r={r * 1.6} fill={colour} opacity={0.32}>{blend}</circle>
      <circle r={r} fill={colour} style={{ stroke: "var(--flow-node-bg)" }} strokeWidth={1.4}>{blend}</circle>
      <circle r={r * 0.42} fill="#fff" opacity={0.92} />
      <animateMotion path={path} rotate="auto" calcMode="linear" {...timing} />
      {/* Eased fade in and out so packets arrive and leave gently, not with a hard pop */}
      <animate attributeName="opacity" values="0;1;1;0" keyTimes={`0;0.1;${fadeAt};1`}
        calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1;0.5 0 0.3 1" {...timing} />
    </g>
  );
};

/** A gateway router on the cable. Round, as routers are on every network diagram. */
const Hop: React.FC<{ x: number; ip: string; reached: boolean; flash?: { begin: number; dur: number } }> = ({
  x, ip, reached, flash,
}) => (
  <g className="pf-node">
    <title>{`Gateway: ${ip}`}</title>
    <g opacity={reached ? 1 : 0.5}>
      <text x={x} y={Y - HOP - 14} textAnchor="middle" fontSize={10.5} fontWeight={700}
        style={{ fill: "var(--shell-ink-3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Gateway
      </text>
      {flash && (
        <circle cx={x} cy={Y} r={HOP + 6} style={{ fill: "var(--shell-ink-3)" }} opacity={0}>
          <animate attributeName="opacity" values="0;0.22;0;0" keyTimes="0;0.12;0.55;1"
            dur={`${flash.dur}s`} begin={`${flash.begin}s`} repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={x} cy={Y} r={HOP} style={{ fill: "var(--flow-node-bg)", stroke: "var(--shell-ink-3)" }}
        strokeWidth={1.6} strokeDasharray={reached ? undefined : "4 4"} />
      <FlowIcon name="router" cx={x} cy={Y} size={22} colour="var(--shell-ink-2)" weight={1.9} />
      <text x={x} y={Y + HOP + 19} textAnchor="middle" fontSize={11.5} fontWeight={700} style={{ fill: "var(--shell-ink-2)" }}>
        {ip}
      </text>
    </g>
  </g>
);

/** One wire's header, as a chip sitting on its bracket. HTML, so a translated caption fits itself. */
const WireChip: React.FC<{ x: number; caption: string; h: WireHeader; colour: string }> = ({ x, caption, h, colour }) => (
  <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(x / W) * 100}%`, top: `${(WIRE_Y / H) * 100}%` }}>
    <div className="surface-card inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1"
      style={{ borderColor: `${colour}55` }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colour }} />
      <span className="t-label">{caption}</span>
      <span className="t-mono ink">
        <span style={h.srcChanged ? { color: NATTED, fontWeight: 700 } : undefined}>{h.src}</span>
        <span className="ink-3"> → </span>
        <span style={h.dstChanged ? { color: NATTED, fontWeight: 700 } : undefined}>{h.dst}</span>
      </span>
    </div>
  </div>
);

const PacketFlow: React.FC<{ trace: PolicyTrace }> = ({ trace }) => {
  const stages = useMemo(() => flowStages(trace), [trace]);
  const headers = useMemo(() => wireHeaders(trace), [trace]);
  const last = stages.length - 1;
  const stop = stopIndex(stages);
  const reached = stages[stop].state !== "fail";
  const reduce = prefersReducedMotion();
  // Namespaces the defs: url(#…) is document-wide, and useId's own characters are not valid in it.
  const uid = `pf${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const natAt = stages.findIndex((s) => s.key === "nat");
  const translated = !!headers.after && (headers.after.srcChanged || headers.after.dstChanged);

  // The routers either side. The left one carries every packet that arrives, so it is always lit;
  // the right one only when the packet actually leaves.
  const gwIn = gatewayOf(trace.ingress_route);
  const gwOut = trace.routable ? gatewayOf(trace.egress_route) : null;

  // ── Motion ────────────────────────────────────────────────────────────────
  const x0 = XS[0] + END / 2; // packets leave from the source's edge
  // Allowed: into the destination. Blocked: to just short of the stage that stops them, then off.
  const endX = reached ? XS[last] - END / 2 : XS[stop] - TILE / 2 - 14;
  const fwdPath = reached ? `M${x0} ${Y} H${endX}` : `M${x0} ${Y} H${endX} q10 0 14 ${DROP}`;
  const fwdLen = endX - x0 + (reached ? 0 : DROP + 4);
  const dur = Math.max(1.6, fwdLen / SPEED);
  const gap = dur / PACKETS;
  /** Seconds after a packet leaves until its head reaches the near edge of something at x. Motion is linear. */
  const arrive = (x: number, half: number) => ((x - half - x0) / fwdLen) * dur;
  const replyPath = `M${XS[last] - END / 2} ${Y + 15} H${x0}`;
  const recolour: Recolour | undefined = translated && !reduce
    ? { at: (XS[natAt] - x0) / fwdLen, colour: NATTED, tail: `${uid}-tail-nat` }
    : undefined;

  const ledIn = TONE[stages[1].state].line;
  const ledOut = TONE[stages[last - 1].state].line;
  const speedOf = (key: Stage["key"]) => {
    const link = key === "ingress" ? trace.ingress_link : key === "egress" ? trace.egress_link : undefined;
    return link?.link ? fmtSpeed(link.speed_mbps) : "";
  };

  // The header row: the original header spans source → NAT (or → the stage that stops it), the
  // header it leaves with spans NAT → destination.
  const splitX = reached ? XS[natAt] : XS[stop];
  const brackets = [
    { x1: XS[0] - END / 2, x2: splitX, colour: PACKET },
    ...(headers.after ? [{ x1: splitX, x2: XS[last] + END / 2, colour: translated ? NATTED : PACKET }] : []),
  ];

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-215">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img"
          aria-label={reached ? "The packet reaches the destination" : `The packet stops at: ${stages[stop].title}`}>
          <style>{`
            @keyframes pfPop { from { opacity: 0; transform: translateY(7px) scale(.92); } to { opacity: 1; transform: none; } }
            @keyframes pfStream { to { stroke-dashoffset: -14; } }
            @keyframes pfBreathe { 0%,100% { opacity: .35; } 50% { opacity: .9; } }
            .pf-node { animation: pfPop .5s cubic-bezier(.2,.9,.25,1) both; transform-box: fill-box; transform-origin: center; }
            .pf-stream { animation: pfStream 1s linear infinite; }
            .pf-breathe { animation: pfBreathe 3.2s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) { .pf-node, .pf-stream, .pf-breathe { animation: none; } }
          `}</style>
          <defs>
            <filter id={`${uid}-lift`} x="-45%" y="-45%" width="190%" height="205%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.07" />
              <feDropShadow dx="0" dy="6" stdDeviation="9" floodColor="#0f172a" floodOpacity="0.14" />
            </filter>
            {/* A faint top-down sheen so each tile reads as a moulded panel, not a flat swatch */}
            <linearGradient id={`${uid}-panel`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.4 }} />
              <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
              <stop offset="1" style={{ stopColor: "#0f172a", stopOpacity: 0.06 }} />
            </linearGradient>
            {/* A soft bloom for the packets, so each reads as light travelling the cable, not a flat dot */}
            <filter id={`${uid}-glow`} x="-140%" y="-140%" width="380%" height="380%">
              <feGaussianBlur stdDeviation="2.6" />
            </filter>
            {/* The packets' tails: a smooth comet trail — invisible at the back, the packet's colour at the head */}
            {[{ id: "tail", c: PACKET }, { id: "tail-nat", c: NATTED }, { id: "tail-r", c: REPLY }].map((g) => (
              <linearGradient key={g.id} id={`${uid}-${g.id}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" style={{ stopColor: g.c, stopOpacity: 0 }} />
                <stop offset="0.65" style={{ stopColor: g.c, stopOpacity: 0.35 }} />
                <stop offset="1" style={{ stopColor: g.c, stopOpacity: 0.9 }} />
              </linearGradient>
            ))}
          </defs>

          {/* ── The FortiGate appliance ─────────────────────────────────────── */}
          <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} rx={20}
            style={{ fill: "var(--shell-sunken)", stroke: "var(--flow-node-line)" }} strokeWidth={1.2} />
          <path style={{ fill: "var(--flow-chip-bg)" }}
            d={`M${BOX.x} ${BOX.y + BOX.head} V${BOX.y + 20} a20 20 0 0 1 20 -20 H${BOX.x + BOX.w - 20} a20 20 0 0 1 20 20 V${BOX.y + BOX.head} Z`} />
          <path d={`M${BOX.x} ${BOX.y + BOX.head} H${BOX.x + BOX.w}`} style={{ stroke: "var(--flow-node-line)" }} strokeOpacity={0.7} />
          <FlowIcon name="firewall" cx={BOX.x + 22} cy={BOX.y + BOX.head / 2} size={17} colour="var(--shell-ink-2)" weight={1.8} />
          <text x={BOX.x + 38} y={BOX.y + BOX.head / 2 + 4.5} fontSize={12.5} fontWeight={700} style={{ fill: "var(--shell-ink-2)" }}>
            FortiGate
          </text>
          {/* Front-panel LEDs: power (steady), traffic (breathing while data flows), alarm (blinks when blocked) */}
          {[
            { c: "var(--flow-allow)", mode: "on" as const },
            { c: PACKET, mode: reached ? ("breathe" as const) : ("on" as const) },
            { c: reached ? "var(--flow-node-line)" : "var(--flow-deny)", mode: reached ? ("on" as const) : ("blink" as const) },
          ].map((led, i) => {
            const cx = BOX.x + BOX.w - 54 + i * 15;
            const cy = BOX.y + BOX.head / 2;
            return (
              <g key={i}>
                {led.mode === "breathe" && !reduce && (
                  <circle cx={cx} cy={cy} r={6} style={{ fill: led.c }} className="pf-breathe" />
                )}
                <circle cx={cx} cy={cy} r={3.4} style={{ fill: led.c }}>
                  {led.mode === "blink" && !reduce && (
                    <animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite" />
                  )}
                </circle>
              </g>
            );
          })}

          {/* ── The wire — a lit cable as far as the packet gets, dashed after ─── */}
          {XS.slice(0, -1).map((x, i) => {
            const live = i < stop;
            return live ? (
              <g key={`seg-${i}`}>
                <line x1={x} y1={Y} x2={XS[i + 1]} y2={Y} style={{ stroke: PACKET }} strokeOpacity={0.12}
                  strokeWidth={8} strokeLinecap="round" />
                <line x1={x} y1={Y} x2={XS[i + 1]} y2={Y} style={{ stroke: PACKET }} strokeOpacity={0.4}
                  strokeWidth={1.6} strokeLinecap="round" />
                <line x1={x} y1={Y} x2={XS[i + 1]} y2={Y} className="pf-stream" style={{ stroke: PACKET }}
                  strokeOpacity={0.65} strokeWidth={2.6} strokeDasharray="2 12" strokeLinecap="round" />
              </g>
            ) : (
              <line key={`seg-${i}`} x1={x} y1={Y} x2={XS[i + 1]} y2={Y} style={{ stroke: "var(--flow-node-line)" }}
                strokeWidth={2} strokeDasharray="4 6" strokeLinecap="round" />
            );
          })}

          {/* The chassis' two ports, where the cable enters and leaves — lit with that link's state */}
          {[{ x: BOX.x, led: ledIn }, { x: BOX.x + BOX.w, led: ledOut }].map((p) => (
            <g key={p.x}>
              <rect x={p.x - 6} y={Y - 13} width={12} height={26} rx={3.5}
                style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={1.5} />
              <circle cx={p.x} cy={Y} r={2.3} style={{ fill: p.led }} />
            </g>
          ))}

          {/* Replies, flowing back underneath — only when the packet got through */}
          {reached && (
            <path d={replyPath} style={{ stroke: REPLY }} strokeOpacity={0.28} strokeWidth={1.5} strokeDasharray="2 5" />
          )}
          {reached && !reduce && Array.from({ length: PACKETS }, (_, i) => (
            <Packet key={`r-${i}`} path={replyPath} dur={dur} begin={dur / 2 + i * gap} colour={REPLY}
              tail={`${uid}-tail-r`} glow={`${uid}-glow`} small fadeAt={0.9} />
          ))}

          {/* Where it stops, or that it arrived */}
          {(() => {
            const size = reached ? END : TILE;
            const colour = reached ? REPLY : "var(--flow-deny)";
            return (
              <g transform={`translate(${XS[stop]} ${Y})`}>
                <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={size * 0.31}
                  transform="scale(1.2)" style={{ fill: "none", stroke: colour }} strokeWidth={2} opacity={0.5}>
                  {!reduce && (
                    <>
                      <animateTransform attributeName="transform" type="scale" values="1;1.7" dur="1.9s"
                        calcMode="spline" keySplines="0.2 0.6 0.2 1" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.55;0" dur="1.9s"
                        calcMode="spline" keySplines="0.3 0 0.5 1" repeatCount="indefinite" />
                    </>
                  )}
                </rect>
              </g>
            );
          })()}

          {/* ── The gateways on the cable ───────────────────────────────────── */}
          {gwIn && (
            <Hop x={GW.left} ip={gwIn} reached
              flash={reduce ? undefined : { begin: arrive(GW.left, HOP), dur: gap }} />
          )}
          {gwOut && (
            <Hop x={GW.right} ip={gwOut} reached={reached}
              flash={reduce || !reached ? undefined : { begin: arrive(GW.right, HOP), dur: gap }} />
          )}

          {/* ── The stages ──────────────────────────────────────────────────── */}
          {stages.map((s, i) => {
            const tone = TONE[s.state];
            const outside = i === 0 || i === last;
            const size = outside ? END : TILE;
            const half = size / 2;
            const x = XS[i];
            const dim = s.state === "skip";
            const speed = speedOf(s.key);
            // A stage glows each time a packet passes through it — every stage the packet reaches,
            // not the one that stops it (that one has its own mark) and none after.
            const flashes = !reduce && !dim && i > 0 && (reached ? i <= last : i < stop);
            return (
              // Two groups on purpose: the entrance animation ends at opacity 1 and would override a
              // skipped stage's dimming if both sat on one element.
              <g key={s.key} className="pf-node" style={{ animationDelay: `${i * 0.07}s` }}>
                <title>{`${s.title}: ${s.label}${s.sub ? ` — ${s.sub}` : ""}`}</title>
                <g opacity={dim ? 0.5 : 1}>
                  <text x={x} y={Y - half - 14} textAnchor="middle" fontSize={10.5} fontWeight={700}
                    style={{ fill: "var(--shell-ink-3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    {s.title}
                  </text>

                  {flashes && (
                    <rect x={x - half - 6} y={Y - half - 6} width={size + 12} height={size + 12} rx={(size + 12) * 0.31}
                      style={{ fill: tone.line }} opacity={0}>
                      <animate attributeName="opacity" values="0;0.28;0;0" keyTimes="0;0.2;0.62;1"
                        calcMode="spline" keySplines="0.3 0 0.3 1;0.4 0 0.6 1;0 0 1 1"
                        dur={`${gap}s`} begin={`${arrive(x, half)}s`} repeatCount="indefinite" />
                    </rect>
                  )}

                  {/* The panel: a white moulded card, soft-shadowed, framed thinly in the status hue so
                      the row reads as a line of clean equipment tiles, not a block of solid colour. */}
                  <rect x={x - half} y={Y - half} width={size} height={size} rx={size * 0.3}
                    style={{ fill: "var(--flow-node-bg)", stroke: tone.line }} strokeWidth={1.4}
                    strokeOpacity={dim ? 1 : 0.5} strokeDasharray={dim ? "4 4" : undefined}
                    filter={dim ? undefined : `url(#${uid}-lift)`} />
                  {!dim && (
                    <rect x={x - half} y={Y - half} width={size} height={size} rx={size * 0.3}
                      fill={`url(#${uid}-panel)`} style={{ pointerEvents: "none" }} />
                  )}
                  {/* The icon chip: where the status colour lives, framing the device glyph like a badge. */}
                  <rect x={x - size * 0.31} y={Y - size * 0.31} width={size * 0.62} height={size * 0.62} rx={size * 0.2}
                    style={{ fill: tone.tint, stroke: tone.line }} strokeWidth={1.1} strokeOpacity={0.38} />
                  <FlowIcon name={iconFor(s, trace)} cx={x} cy={Y} size={outside ? 30 : 24} colour={tone.line}
                    weight={outside ? 2.1 : 2} />
                  <StatusBadge x={x + half - 4} y={Y - half + 4} state={s.state} colour={tone.line} />

                  {/* The port's negotiated speed, on the opposite corner from the verdict */}
                  {speed && (
                    <g transform={`translate(${x - half + 4} ${Y + half - 4})`}>
                      <title>{`${speed} link`}</title>
                      <rect x={-15} y={-7.5} width={30} height={15} rx={7.5}
                        style={{ fill: "var(--flow-node-bg)", stroke: tone.line }} strokeWidth={1.3} />
                      <text y={3.6} textAnchor="middle" fontSize={9.5} fontWeight={800} style={{ fill: tone.line }}>
                        {speed}
                      </text>
                    </g>
                  )}

                  <text x={x} y={Y + half + 19} textAnchor="middle" fontSize={12.5} fontWeight={700}
                    style={{ fill: s.state === "fail" ? "var(--flow-deny)" : "var(--shell-ink)" }}>
                    {clip(s.label, 16)}
                  </text>
                  {s.sub && (
                    <text x={x} y={Y + half + 35} textAnchor="middle" fontSize={10.5} style={{ fill: "var(--shell-ink-3)" }}>
                      {clip(s.sub, 20)}
                    </text>
                  )}
                </g>
              </g>
            );
          })}

          {/* The packets — over the stages, not under: a packet slid beneath a stage poked out of its
              edge as a stray pill. Crossing over it, in step with the stage's glow, reads as the stage
              handling it. Replies stay underneath, as the quieter return lane. */}
          {!reduce && Array.from({ length: PACKETS }, (_, i) => (
            <Packet key={`p-${i}`} path={fwdPath} dur={dur} begin={i * gap} colour={PACKET}
              tail={`${uid}-tail`} glow={`${uid}-glow`} fadeAt={reached ? 0.9 : 0.78} recolour={recolour} />
          ))}

          {/* ── What the packet carries on each wire — the brackets under the chips ─ */}
          {brackets.map((b) => (
            <g key={b.x1} style={{ stroke: b.colour }} strokeOpacity={0.55} strokeWidth={1.5} strokeLinecap="round">
              <path d={`M${b.x1 + 4} ${WIRE_Y} H${b.x2 - 4}`} />
              <path d={`M${b.x1 + 4} ${WIRE_Y - 6} v12 M${b.x2 - 4} ${WIRE_Y - 6} v12`} />
            </g>
          ))}
        </svg>

        <WireChip x={(brackets[0].x1 + brackets[0].x2) / 2} caption="Original packet" h={headers.before} colour={PACKET} />
        {headers.after && brackets[1] && (
          <WireChip x={(brackets[1].x1 + brackets[1].x2) / 2}
            caption={translated ? "After NAT" : "Leaves unchanged"} h={headers.after} colour={translated ? NATTED : PACKET} />
        )}
      </div>
    </div>
  );
};

export default PacketFlow;

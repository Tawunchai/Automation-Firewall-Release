import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Scenario, SimFlowResult, SimRow } from "./packetSim";
import {
  GLOBE_D, SHIELD_D, charsFor, chassisBox, entryPath, ingressPath, layoutMinimap, layoutRows,
  outboundPath, railPath, simLayout, totalHeight, type SimLayoutMode, type SimLayoutOpts,
} from "./packetSimLayout";
import { DEST_H, DestinationNode } from "./DestinationNode";
import { WALK_TRAFFIC, packetTime, syncSteps, useWalkClock, type PaintFn } from "./walkClock";
import { WalkSteps } from "./WalkSteps";

// PacketWalk — the FULL picture: sample packets entering a firewall, walked down its policy table
// rule by rule, and leaving for the internet or dying inside it.
//
// It is the full-screen half of a pair. PacketOverview.tsx draws the same run as three nodes — a
// network, the device, the internet — which is what fits in the right-hand panel and answers "does
// my traffic still get out?". This one answers "which of my forty rules just died?", which needs
// the table, which needs the room. They share a clock and a transport so that pausing in one and
// expanding to the other lands on the same moment.
//
// WHY IT IS ANIMATED. The fact this panel exists to convey is an ORDERING fact — "rule #4 claims the
// packet before yours is ever consulted" — and ordering is what a still diagram is worst at.
// Watching one packet peel off at #12 while two more carry on and die at #13 puts the whole of
// first-match-wins on screen in four seconds. Nothing else here moves for its own sake: the comet
// tail says which way a packet is going, the wire draws itself as the packet travels it, and the
// drop ring is where a packet stopped. Three effects, each carrying one fact.
//
// AND IT NEVER STOPS. The rule table is walked once and then holds its verdict, but the packets
// keep coming — three of each flow in the air at a time, relaunched the moment they land, drifting
// out of step because a flow that dies at rule #4 has a shorter journey than one that reaches #12.
// A firewall does not process one packet and wait; showing it that way, complete with a progress
// bar and a speed switch, described the picture as a recording of an event rather than a device
// under load. See walkClock.ts for the two times this runs on.
//
// WHAT IT DRAWS. A source network outside the device, the device with the rule table inside it, and
// the destination — a globe when the traffic is bound for the internet, a card when it is a named
// network. Three nodes and the wires between them, and nothing else.
//
// WHAT IT DELIBERATELY DOES NOT DRAW. No inspection column: the profiles are a property of the rule
// that matched and are stated in the Impact tab, and a fifth column of chips crowded the one thing
// worth looking at. No interface pills on the walls and no NAT badge on the wire: three labels
// stacked into forty pixels of the busiest join in the picture, each repeating something already
// said — the interface pair is on the chassis header, NAT is in the Rules tab.
//
// IT FITS WHATEVER IT IS GIVEN. Laid out from the container's MEASURED width, so it never scrolls
// sideways. Labels are clipped to their own column rather than to a constant character count.
//
// HOW IT DRAWS. React renders the structure once per scenario and per width; the clock then mutates
// a handful of attributes through refs. Re-rendering ~200 elements sixty times a second would be
// the obvious way and the wrong one — this component sits in a page that is already re-rendering on
// every streamed token of an AI answer.
//
// COLOUR IS BY ROLE. The palette is the console's --flow-* tokens, so a deny reads red in both
// themes and under all ten accents without this file naming a hex. Paint goes through `style`, not
// through fill=/stroke= attributes: a presentation attribute holding var() is not dependable.

export type PacketWalkProps = {
  scenario: Scenario;
  /** The user's accent colour — the one colour that cannot come from a token. */
  accent: string;
  /**
   * `compact` is the chat bubble and stays compact at any width. Everything else picks its own
   * density from the measured width, so the panel and the full-screen view share one component.
   */
  variant?: "full" | "compact";
  /** Extra controls rendered above the drawing (the panel puts its run switch here). */
  controls?: React.ReactNode;
  /** The device this rule base belongs to, for the chassis badge. */
  deviceName?: string;
  /**
   * Draw the finished frame and never start a clock.
   *
   * The chat bubble uses this. That list re-renders on every streamed token of an AI answer, and
   * three running animations per message is a cost paid for something nobody is watching yet —
   * the still frame says the same thing, and the panel one click away is where it moves.
   */
  still?: boolean;
};

const STATE_STROKE: Record<string, string> = {
  dead: "var(--flow-deny)",
  unreachable: "var(--flow-deny)",
  narrowed: "var(--flow-warn)",
};

/** How far behind the head each tail dot sits, in milliseconds of the same motion. */
const TAIL = [70, 140, 210];

/** Where the drawing stops widening and starts leaving margin instead. */
const MAX_DRAW_W = 1440;

export const PacketWalk: React.FC<PacketWalkProps> = ({
  scenario, accent, variant = "full", controls, deviceName, still = false,
}) => {
  const compact = variant === "compact";

  // ── Measure, then lay out ────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      // Ignore the sub-pixel churn a flex parent produces; anything smaller than a character is
      // not a layout change and re-laying out on it would thrash the whole subtree.
      setMeasured((prev) => (prev != null && Math.abs(prev - w) < 8 ? prev : w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  /**
   * The drawing stops growing at MAX_DRAW_W and centres itself in whatever is left.
   *
   * The rule table takes every pixel the layout does not spend elsewhere, and on a full-width page
   * that meant 1,400px rows: the policy name at the far left, the ACCEPT badge at the far right, and
   * a hand-span of nothing in between for the eye to cross. A table is not more readable for being
   * wider — past a point it is less. Past the cap the extra width becomes margin.
   */
  const raw = measured ?? (compact ? 560 : 1180);
  const width = compact ? raw : Math.min(raw, MAX_DRAW_W);
  const mode: SimLayoutMode = compact ? "compact" : width >= 1000 ? "wide" : "panel";

  /**
   * Is the table a WINDOW onto a bigger rule base, or the whole thing?
   *
   * The minimap is a scale for the first case and clutter in the second: on a device with eight
   * policies it drew a grey column beside a table that already showed every one of them, and it was
   * the first thing a reader had to decide to ignore. It appears when the walk elides rules and the
   * base is big enough for "where am I in it?" to be a real question.
   */
  const bigTable = useMemo(() => {
    const total = scenario.rows.reduce(
      (n, r) => n + (r.kind === "band" ? r.count : (r.key === "implicit" ? 0 : 1)), 0);
    return total > 14 && scenario.rows.some((r) => r.kind === "band");
  }, [scenario.rows]);

  const o = useMemo(() => simLayout(width, mode, bigTable), [width, mode, bigTable]);

  const placed = useMemo(() => layoutRows(scenario.rows, o), [scenario.rows, o]);
  const height = useMemo(() => totalHeight(placed, o), [placed, o]);
  const chassis = useMemo(() => chassisBox(placed, o), [placed, o]);
  const map = useMemo(
    () => (o.mapW > 0 ? layoutMinimap(scenario.rows, o, height) : null),
    [scenario.rows, o, height],
  );

  // ── Element handles the clock writes to, so a frame costs no React render ──
  const svgRef = useRef<SVGSVGElement | null>(null);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  const paintRef = useRef<PaintFn>(() => {});
  const clock = useWalkClock(scenario.duration, still, paintRef, WALK_TRAFFIC.speed);

  const stages = scenario.stages;
  const owner = `walk-${scenario.phase}`;
  const lookup = stages.find((s) => s.id === "lookup")!;
  const ingress = stages.find((s) => s.id === "ingress")!;

  // ── The fixed points of the picture ──────────────────────────────────────
  const railTop = placed[0]?.mid ?? o.top;
  const railBottom = placed[placed.length - 1]?.mid ?? o.top;
  /** The ingress port on the chassis wall: level with the first rule it will test. */
  const inPortY = railTop;
  /** Every allowed flow leaves through the same egress port. */
  const outPortY = useMemo(() => {
    const first = scenario.flows.find((f) => f.outcome === "allowed" || f.outcome === "inspected");
    return first ? placed[first.rowIndex].mid : railTop;
  }, [scenario.flows, placed, railTop]);

  // "all" as a destination is only the internet when the egress interface actually leads there; out
  // a DMZ or server port it reaches that network, drawn as a named node labelled with the interface.
  const firstFlow = scenario.flows[0]?.flow;
  const toInternet = scenario.egressIsInternet && !!firstFlow?.dstUnbounded;
  // Same fact on the way in: an unrestricted source on an internet-facing interface is the internet.
  const sourceInternet = scenario.ingressIsInternet && scenario.source.unbounded;
  const dstLabel = toInternet
    ? undefined
    : firstFlow?.dstUnbounded ? scenario.egress : firstFlow?.dstIp;
  const arrived = scenario.flows.filter((f) => f.outcome !== "dropped" && f.outcome !== "unknown").length;

  const q = useCallback(<T extends Element>(sel: string): T | null =>
    svgRef.current?.querySelector<T>(sel) ?? null, []);

  // ── Where one packet is at time t ────────────────────────────────────────
  //
  // One function for every phase, so the comet tail is the same motion sampled a few frames back
  // rather than three special cases that drift apart.
  const flowPos = useCallback((f: SimFlowResult, i: number, t: number): {
    x: number; y: number; vis: number; k: number;
  } => {
    const land = lookup.from + (f.rowIndex + 1) * scenario.perRow;
    const lag = i * 90;
    const rowY = placed[f.rowIndex].mid;

    if (t < ingress.to) {
      const k = (t - lag) / Math.max(1, ingress.to - ingress.from);
      const p = pointOn(q<SVGPathElement>('[data-path="ingress"]'), k);
      return { x: p?.x ?? o.srcX, y: p?.y ?? inPortY, vis: k <= 0 ? 0 : 1, k };
    }
    if (t < ingress.to + 260) {
      const k = (t - ingress.to - lag * 0.4) / 260;
      const p = pointOn(q<SVGPathElement>('[data-path="entry"]'), k);
      return { x: p?.x ?? o.chassisX, y: p?.y ?? inPortY, vis: 1, k };
    }
    const railFrom = ingress.to + 260;
    if (t < land) {
      const k = Math.max(0, (t - lag - railFrom) / Math.max(1, land - lag - railFrom));
      return { x: o.railX, y: railTop + (rowY - railTop) * Math.min(1, k), vis: 1, k };
    }
    if (t < land + 240) {
      const k = (t - land) / 240;
      return { x: o.railX + (o.rungX + 16 - o.railX) * Math.min(1, k), y: rowY, vis: 1, k };
    }
    if (f.outcome === "dropped" || f.outcome === "unknown") {
      const k = Math.min(1, (t - land - 240) / 420);
      return { x: o.rungX + 16 + (o.rungW - 20) * k, y: rowY, vis: k >= 1 ? 0 : 1, k };
    }
    const k = Math.min(1.25, (t - land - 240) / 1050);
    const p = pointOn(q<SVGPathElement>(`[data-path="out-${i}"]`), k);
    return { x: p?.x ?? o.rungX + o.rungW, y: p?.y ?? rowY, vis: k >= 1 ? 0 : 1, k };
  }, [lookup, ingress, scenario.perRow, placed, o, railTop, inPortY, q]);

  /**
   * How long one packet of each flow is on screen — and therefore how often the next one sets off.
   *
   * The same numbers flowPos walks by: down the rail to the rule that claims it, the rung across,
   * then either the exit wire or the few hundred milliseconds it takes to die there. A flow decided
   * by rule #4 has a shorter loop than one decided by #12, so the streams drift apart on their own
   * instead of pulsing in lockstep — which is both what real traffic looks like and the thing the
   * old single-timeline run could never show.
   */
  const periods = useMemo(() => scenario.flows.map((f) => {
    const land = lookup.from + (f.rowIndex + 1) * scenario.perRow;
    return land + 240 + (f.outcome === "dropped" || f.outcome === "unknown" ? 420 : 1050);
  }), [scenario.flows, scenario.perRow, lookup]);

  /**
   * How far one flow is offset from the next.
   *
   * A fixed offset is not enough. Flows are usually decided by the SAME rule — that is the normal
   * case, not the exception — which gives them the same period, so a constant skew leaves them
   * travelling as a tight clump forever, three port pills stacked on the same twenty pixels. Spread
   * across the period instead, every packet on screen is evenly spaced from the next: a stream,
   * which is what traffic looks like, rather than a convoy.
   */
  const skewOf = useCallback(
    (i: number) => i * (periods[i] / (scenario.flows.length * WALK_TRAFFIC.inFlight)),
    [periods, scenario.flows.length],
  );

  // ── One frame ────────────────────────────────────────────────────────────
  // `t` walks the rule table and stops at the verdict; `flowT` never stops. See walkClock.ts.
  const paint = useCallback((t: number, flowT: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const stage = stages.find((s) => t >= s.from && t < s.to) ?? stages[stages.length - 1];
    const settled = t >= lookup.to;
    const reachedRow = t < lookup.from
      ? -1
      : Math.min(scenario.rows.length - 1, Math.floor((t - lookup.from) / scenario.perRow));

    scenario.rows.forEach((row, i) => {
      const seen = i <= reachedRow;
      const claims = scenario.flows.filter((f) => f.rowIndex === i);
      const landing = seen && claims.length > 0;
      const dead = row.kind === "rule" && (row.state === "dead" || row.state === "unreachable");
      // A dead rule is the headline of the whole panel, so once the verdicts are in it has to stay
      // READABLE — greyed and struck through, not faded to the point of invisibility.
      //
      // Nor is "not reached yet" an excuse to be illegible. The floor used to be 0.32, which on a
      // light card is grey type on near-white and made a third of the rule base unreadable at rest
      // — and the run ENDS at rest. Dim enough to say "the walk has not been here", dark enough to
      // read the rule that is about to be tested.
      const lit = seen ? 1 : settled ? (dead ? 0.8 : 0.66) : 0.44;

      const box = q<SVGRectElement>(`[data-row="${i}"]`);
      if (box) {
        box.setAttribute("opacity", String(landing ? 1 : lit));
        box.setAttribute("stroke-width", landing ? "2" : (row.kind === "rule" && row.isNew ? "1.6" : "1.1"));
      }
      // The halo behind the matched row. It arrives with the verdict rather than with the packet,
      // so the eye is pulled to the answer and not to every rung on the way down.
      const halo = q<SVGRectElement>(`[data-halo="${i}"]`);
      if (halo) halo.setAttribute("opacity", landing && settled ? "1" : "0");

      svg.querySelectorAll<SVGElement>(`[data-rowink="${i}"]`).forEach((e) => e.setAttribute("opacity", String(lit)));
      const stripe = q<SVGRectElement>(`[data-stripe="${i}"]`);
      if (stripe) stripe.setAttribute("opacity", settled && dead ? "1" : "0");

      const ann = q<SVGTextElement>(`[data-ann="${i}"]`);
      if (ann && row.kind === "rule") {
        let text = "", colour = "var(--shell-ink-3)", op = 0;
        if (settled && row.state === "dead") { text = "unreachable"; colour = "var(--flow-deny)"; op = 1; }
        else if (settled && row.state === "unreachable") { text = "never runs"; colour = "var(--flow-deny)"; op = 1; }
        else if (settled && row.state === "narrowed") { text = "narrowed"; colour = "var(--flow-warn)"; op = 1; }
        else if (landing) {
          const ids = claims.map((c) => c.flow.id).join(" ");
          const worst = claims.some((c) => c.outcome === "dropped") ? "dropped"
            : claims.some((c) => c.outcome === "unknown") ? "unknown" : "forwarded";
          text = `${ids}  ${worst === "forwarded" ? "→ forwarded" : worst === "dropped" ? "✕ dropped" : "? unresolved"}`;
          colour = worst === "forwarded" ? "var(--flow-allow)"
            : worst === "dropped" ? "var(--flow-deny)" : "var(--flow-warn)";
          op = 1;
        }
        ann.textContent = text;
        ann.setAttribute("style", `fill:${colour}`);
        ann.setAttribute("opacity", String(op));
      }
      const strike = q<SVGTextElement>(`[data-name="${i}"]`);
      if (strike) strike.style.textDecoration = settled && dead ? "line-through" : "none";
    });

    // ── Packets: a continuous stream, IN_FLIGHT of each flow in the air at once ──
    scenario.flows.forEach((f, i) => {
      const skew = skewOf(i);
      const lead = flowPos(f, i, packetTime(flowT, periods[i], 0, skew, WALK_TRAFFIC.inFlight));

      for (let g = 0; g < WALK_TRAFFIC.inFlight; g++) {
        const pt = packetTime(flowT, periods[i], g, skew, WALK_TRAFFIC.inFlight);
        const here = g === 0 ? lead : flowPos(f, i, pt);

        const lane = q<SVGGElement>(`[data-lane="${i}-${g}"]`);
        if (lane) {
          lane.setAttribute("transform", `translate(${here.x.toFixed(1)}, ${here.y.toFixed(1)})`);
          lane.setAttribute("opacity", String(here.vis));
        }
        // Only the lead packet is labelled — see the JSX.
        const label = q<SVGGElement>(`[data-lane-label="${i}-${g}"]`);
        if (label) label.setAttribute("opacity", here.x > chassis.x + chassis.w - 10 ? "0" : "1");
        TAIL.forEach((back, n) => {
          const tail = q<SVGCircleElement>(`[data-tail="${i}-${g}-${n}"]`);
          if (!tail) return;
          // Clamped at 0: a tail sampled across a relaunch would otherwise whip back to where the
          // previous packet was, drawing a line across the whole picture for one frame.
          const p = flowPos(f, i, Math.max(0, pt - back));
          tail.setAttribute("cx", p.x.toFixed(1));
          tail.setAttribute("cy", p.y.toFixed(1));
          tail.setAttribute("opacity", String(here.vis * (0.34 - n * 0.1)));
        });
      }

      // The drop ring. Once the table has settled the cross is permanent — this is where this flow
      // dies, and it will die there again — while the ring expands afresh on each arrival.
      if (f.outcome === "dropped" || f.outcome === "unknown") {
        const burst = q<SVGGElement>(`[data-drop="${i}"]`);
        if (burst) {
          const hit = lead.k >= 0.9;
          burst.setAttribute("opacity", settled || hit ? "1" : "0");
          const ring = burst.querySelector("circle[data-ring]");
          if (ring) {
            const age = Math.min(1, Math.max(0, (lead.k - 0.9) / 0.1));
            ring.setAttribute("r", String(11 + age * 9));
            ring.setAttribute("opacity", hit ? String((1 - age) * 0.5) : "0");
          }
        }
      }

      // The wire draws itself as the first packet travels it, and then STAYS drawn. Re-drawing it
      // under every packet would make the route look provisional; it is established, and what moves
      // along it is the traffic.
      const wire = q<SVGPathElement>(`[data-path="out-${i}"]`);
      if (wire) {
        const len = wire.getTotalLength?.() ?? 0;
        const alive = f.outcome === "allowed" || f.outcome === "inspected";
        const drawn = !alive ? 0 : settled ? 1 : Math.min(1, Math.max(0, lead.k));
        if (len) {
          wire.setAttribute("stroke-dasharray", String(len));
          wire.setAttribute("stroke-dashoffset", String(len * (1 - drawn)));
        }
        wire.setAttribute("opacity", drawn > 0 ? "0.85" : "0");
      }
    });

    // ── Where the traffic ends up ──
    const dest = q<SVGGElement>('[data-dest="1"]');
    if (dest) dest.setAttribute("opacity", settled && arrived > 0 ? "1" : "0.32");
    // One ripple per ARRIVAL, timed off the flow that actually gets through. It used to fire once
    // and never again, which was right while the run ended — with traffic streaming it would be the
    // only thing in the picture that had stopped. Silent when nothing gets through.
    const ripple = q<SVGCircleElement>('[data-dest-ring="1"]');
    if (ripple) {
      const out = scenario.flows.findIndex((f) => f.outcome === "allowed" || f.outcome === "inspected");
      const since = out < 0
        ? Infinity
        : packetTime(flowT, periods[out], 0, skewOf(out), WALK_TRAFFIC.inFlight);
      const age = Math.min(1, since / 620);
      ripple.setAttribute("r", String(13 + age * 16));
      ripple.setAttribute("opacity", arrived > 0 && age < 1 ? String((1 - age) * 0.5) : "0");
    }

    // ── Chrome ──
    if (noteRef.current) noteRef.current.textContent = stage.detail;
    syncSteps(owner, stage.id);
  }, [scenario, stages, lookup, flowPos, periods, skewOf, arrived, owner, q, chassis]);

  // Publish the paint function for the geometry just laid out, then draw the first frame before the
  // browser draws one of its own — otherwise the picture flashes with every row at full opacity and
  // every packet parked at the origin. It runs again on a resize, which re-lays out.
  //
  // It deliberately does NOT reset `playing`: a new scenario arrives as a REMOUNT, because callers
  // key this component on what it is drawing.
  useLayoutEffect(() => {
    paintRef.current = paint;
    clock.prime();
  }, [clock, paint]);

  // ── Structure ────────────────────────────────────────────────────────────
  const srcH = compact ? 60 : 78;
  /**
   * The source card sits against the MIDDLE of the device, not against the ingress port.
   *
   * Against the port it rode at the very top of a tall drawing, and the left third of the picture
   * was then several hundred pixels of nothing — the single most unbalanced thing on the page. The
   * wire still lands on the port, so nothing about the story changes: the packets leave this
   * network and enter the device at the top of the table. It is just that the network is now
   * opposite the device rather than opposite the device's first row.
   */
  const srcTop = Math.max(8, Math.min(chassis.y + chassis.h / 2 - srcH / 2, height - srcH - 10));
  const srcMid = srcTop + srcH / 2;
  const srcChars = charsFor(o.srcW - 18, o.metaSize);
  const capY = Math.max(12, o.top - o.chassisHeadH - 12);

  return (
    <div className="flex min-w-0 flex-col">
      {controls}

      <div ref={wrapRef} className="min-w-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${o.width} ${height}`}
          // maxWidth, not width: below the cap it still scales to its container, and above it the
          // drawing renders at its own size and the leftover becomes margin either side.
          style={{ display: "block", width: "100%", maxWidth: o.width, height: "auto", margin: "0 auto" }}
          role="img"
          aria-label={`${scenario.headline.title}. ${scenario.headline.detail}`}
        >
          <defs>
            <marker id="pw-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: "var(--flow-node-line)" }} />
            </marker>
          </defs>

          {/* ── The whole rule base, as a scale for the window below ── */}
          {map && (
            <>
              <Caption x={o.mapX} y={capY} size={o.metaSize}>ALL {map.total}</Caption>
              {map.bars.map((b, i) => (
                <rect key={i} x={o.mapX} y={b.y} width={o.mapW} height={b.h} rx={2}
                  style={{
                    fill: b.isNew ? accent
                      : b.state === "dead" || b.state === "unreachable" ? "var(--flow-deny)"
                      : b.state === "narrowed" ? "var(--flow-warn)"
                      : b.kind === "band" ? "var(--flow-chip-bg)" : "var(--flow-node-line)",
                  }}
                  opacity={b.kind === "band" ? 0.5 : 0.85} />
              ))}
              <rect x={o.mapX - 3} y={map.windowY - 3} width={o.mapW + 6} height={map.windowH + 6} rx={4}
                style={{ fill: "none", stroke: accent }} strokeWidth={1.4} />
            </>
          )}

          {/* Each caption sits on top of the card it names. They used to share the drawing's top
              edge with the chassis header, which was fine only while all three columns happened to
              start at the same height — and they do not. */}
          <Caption x={o.srcX} y={Math.max(11, srcTop - 8)} size={o.metaSize}>
            {sourceInternet ? "INTERNET" : "SOURCE"}
          </Caption>
          <Caption x={o.outX} y={Math.max(11, outPortY - DEST_H / 2 - 8)} size={o.metaSize}>
            {toInternet ? "INTERNET" : firstFlow?.dstUnbounded && scenario.egress ? scenario.egress.toUpperCase() : "DESTINATION"}
          </Caption>

          {/* ── The device ── */}
          <rect x={chassis.x} y={chassis.y} width={chassis.w} height={chassis.h} rx={14}
            style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={1.5} />
          <rect x={chassis.x} y={chassis.y} width={chassis.w} height={o.chassisHeadH} rx={14}
            style={{ fill: "var(--flow-chip-bg)" }} />
          <rect x={chassis.x} y={chassis.y + o.chassisHeadH - 14} width={chassis.w} height={14}
            style={{ fill: "var(--flow-chip-bg)" }} />
          <line x1={chassis.x} y1={chassis.y + o.chassisHeadH} x2={chassis.x + chassis.w}
            y2={chassis.y + o.chassisHeadH} style={{ stroke: "var(--flow-node-line)" }} strokeWidth={1} />
          <g transform={`translate(${chassis.x + 11}, ${chassis.y + o.chassisHeadH / 2 - 6}) scale(${12 / 24})`}
            style={{ fill: "none", stroke: accent }} strokeWidth={2.2} strokeLinejoin="round">
            <path d={SHIELD_D} />
          </g>
          <text x={chassis.x + 30} y={chassis.y + o.chassisHeadH / 2 + 3.5}
            fontSize={o.metaSize + 1} fontWeight={800} style={{ fill: "var(--shell-ink-2)" }}>
            {clip(deviceName || "FortiGate", charsFor(chassis.w * 0.4, o.metaSize + 1))}
          </text>
          <text x={chassis.x + chassis.w - 12} y={chassis.y + o.chassisHeadH / 2 + 3.5}
            fontSize={o.metaSize} fontWeight={700} textAnchor="end"
            style={{ fill: "var(--shell-ink-3)", fontFamily: "var(--font-mono)" }}>
            {clip(`${scenario.ingress} → ${scenario.egress} · first match wins`,
              charsFor(chassis.w * 0.55, o.metaSize))}
          </text>

          {/* ── Source ──
              The globe when the traffic arrives from the internet (see sourceInternet), so the full
              walk and the panel overview draw the same shape for the same run. */}
          <rect x={o.srcX} y={srcTop} width={o.srcW} height={srcH} rx={10}
            style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={1.3} />
          {sourceInternet ? (
            <>
              <g transform={`translate(${o.srcX + 9}, ${srcTop + 10}) scale(${(o.nameSize + 8) / 24})`}>
                <path d={GLOBE_D.disc}
                  style={{ fill: "var(--flow-info-bg)", stroke: "var(--flow-info)" }} strokeWidth={1.5} />
                <path d={GLOBE_D.meridian}
                  style={{ fill: "none", stroke: "var(--flow-info)" }} strokeWidth={1.1} opacity={0.75} />
                {GLOBE_D.lats.map((d) => (
                  <path key={d} d={d} style={{ fill: "none", stroke: "var(--flow-info)" }}
                    strokeWidth={1.1} opacity={0.55} />
                ))}
              </g>
              <text x={o.srcX + 9 + o.nameSize + 8 + 7} y={srcTop + 18 + o.nameSize / 2}
                fontSize={o.nameSize} fontWeight={800} style={{ fill: "var(--shell-ink)" }}>Internet</text>
              <text x={o.srcX + 9} y={srcTop + 20 + o.nameSize + 14} fontSize={o.metaSize}
                style={{ fill: "var(--shell-ink-3)" }}>
                {clip(`any source · ${scenario.flows.length} sample flow${scenario.flows.length === 1 ? "" : "s"}`, srcChars)}
              </text>
            </>
          ) : (
          <>
          <text x={o.srcX + 9} y={srcTop + 18} fontSize={o.nameSize} fontWeight={800}
            style={{ fill: "var(--shell-ink)" }}>
            {clip(scenario.source.label, srcChars)}
          </text>
          <text x={o.srcX + 9} y={srcTop + 33} fontSize={o.metaSize + 1} fontWeight={700}
            style={{ fill: accent, fontFamily: "var(--font-mono)" }}>
            {clip(scenario.source.value, srcChars)}
          </text>
          <text x={o.srcX + 9} y={srcTop + 49} fontSize={o.metaSize} style={{ fill: "var(--shell-ink-3)" }}>
            {scenario.source.unbounded ? "unrestricted" : `~${scenario.source.hosts.toLocaleString()} addresses`}
          </text>
          {!compact && (
            <text x={o.srcX + 9} y={srcTop + 64} fontSize={o.metaSize} style={{ fill: "var(--shell-ink-3)" }}>
              {clip(`${scenario.flows.length} sample flow${scenario.flows.length === 1 ? "" : "s"}`, srcChars)}
            </text>
          )}
          </>
          )}

          <path data-path="ingress" d={ingressPath(o, srcMid, inPortY)}
            style={{ fill: "none", stroke: "var(--flow-node-line)" }} strokeWidth={1.4} markerEnd="url(#pw-arrow)" />
          <path data-path="entry" d={entryPath(o, inPortY, railTop)}
            style={{ fill: "none", stroke: "var(--flow-node-line)" }} strokeWidth={1.2} opacity={0.5} />
          <path d={railPath(o, railTop, railBottom)}
            style={{ fill: "none", stroke: "var(--flow-node-line)" }} strokeWidth={1.4} strokeDasharray="3 4" />

          {/* ── Rows ── */}
          {scenario.rows.map((row, i) => (
            <Row key={i} row={row} i={i} box={placed[i]} o={o} accent={accent} />
          ))}

          {/* ── Outbound wires ──
              No port pill and no NAT badge on the wire any more. Three labels were stacked into
              forty pixels of the busiest part of the drawing — the wall the packets cross — and all
              three said something the picture already says elsewhere: the interface pair is on the
              chassis header, and NAT is a property of the rule, which the Rules tab lists. They
              were decoration on the one join that needed to stay legible. */}
          {scenario.flows.map((f, i) =>
            f.outcome === "dropped" || f.outcome === "unknown" ? null : (
              <path key={f.flow.id} data-path={`out-${i}`}
                d={outboundPath(o, placed[f.rowIndex].mid, outPortY)}
                style={{ fill: "none", stroke: "var(--flow-allow)" }} strokeWidth={1.6}
                strokeLinecap="round" opacity={0} />
            ))}

          {/* ── Where it ends up ── */}
          <g data-dest="1" opacity={0.32}>
            <DestinationNode x={o.outX} w={o.outW} y={outPortY} toInternet={toInternet}
              arrived={arrived} total={scenario.flows.length}
              dstIp={dstLabel}
              nameSize={o.nameSize} metaSize={o.metaSize} />
          </g>

          {/* ── Drop rings ── */}
          {scenario.flows.map((f, i) =>
            f.outcome === "dropped" || f.outcome === "unknown" ? (
              <g key={f.flow.id} data-drop={i} opacity={0}
                transform={`translate(${o.rungX + o.rungW - 4 + i * 18}, ${placed[f.rowIndex].mid})`}>
                <circle data-ring="1" r={11} style={{
                  fill: "none",
                  stroke: f.outcome === "unknown" ? "var(--flow-warn)" : "var(--flow-deny)",
                }} strokeWidth={1.4} opacity={0} />
                <circle r={10} style={{
                  fill: f.outcome === "unknown" ? "var(--flow-warn-bg)" : "var(--flow-deny-bg)",
                  stroke: f.outcome === "unknown" ? "var(--flow-warn)" : "var(--flow-deny)",
                }} strokeWidth={1.2} />
                {f.outcome === "unknown"
                  ? <text y={3.5} fontSize={10} fontWeight={800} textAnchor="middle"
                      style={{ fill: "var(--flow-warn)" }}>?</text>
                  : <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" style={{ stroke: "var(--flow-deny)" }}
                      strokeWidth={2.2} strokeLinecap="round" />}
              </g>
            ) : null)}

          {/* ── Packets: IN_FLIGHT of each flow, each with three tail dots behind its head ── */}
          {scenario.flows.map((f, i) => (
            <g key={`tail-${f.flow.id}`}>
              {Array.from({ length: WALK_TRAFFIC.inFlight }, (_, g) => TAIL.map((_, n) => (
                <circle key={`${g}-${n}`} data-tail={`${i}-${g}-${n}`} r={4.2 - n * 0.9}
                  cx={-50} cy={-50} style={{ fill: outcomeColour(f) }} opacity={0} />
              )))}
            </g>
          ))}
          {scenario.flows.map((f, i) => Array.from({ length: WALK_TRAFFIC.inFlight }, (_, g) => (
            <g key={`${f.flow.id}-${g}`} data-lane={`${i}-${g}`} opacity={0}>
              <circle r={11} style={{ fill: outcomeColour(f) }} opacity={0.16} />
              <circle r={4.6} style={{ fill: outcomeColour(f) }} />
              {/* The port label rides above the LEAD packet only, and outside the chassis it would
                  ride straight over the egress port. It has done its job by then — it says what is
                  being sent, which matters while the rules are being tested — so it is dropped the
                  moment the packet crosses the wall. One pill per flow, not one per packet: three
                  copies of "443/tcp" chasing each other down one wire is noise, and what they say
                  is a property of the flow, which is stated once. */}
              {g === 0 && (
                <g data-lane-label={`${i}-0`}>
                  <rect x={-22} y={-25} width={44} height={13} rx={6.5}
                    style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={0.9} />
                  <text y={-15.5} fontSize={7.5} fontWeight={700} textAnchor="middle"
                    style={{ fill: "var(--shell-ink-2)", fontFamily: "var(--font-mono)" }}>
                    {`${f.flow.port}/${f.flow.proto.toLowerCase()}`}
                  </text>
                </g>
              )}
            </g>
          )))}
        </svg>
      </div>

      {!still && <WalkSteps stages={stages} owner={owner} onSeek={clock.seek} noteRef={noteRef} />}
    </div>
  );
};

// ── Pieces ───────────────────────────────────────────────────────────────────

const Caption: React.FC<{ x: number; y: number; size: number; children: React.ReactNode }> = ({
  x, y, size, children,
}) => (
  <text x={x} y={y} fontSize={size} fontWeight={800} letterSpacing="0.09em"
    style={{ fill: "var(--shell-ink-3)" }}>
    {children}
  </text>
);

const Row: React.FC<{
  row: SimRow; i: number; box: { y: number; h: number; mid: number; line1: number; line2: number };
  o: SimLayoutOpts; accent: string;
}> = ({ row, i, box, o, accent }) => {
  if (row.kind === "band") {
    return (
      <g>
        <rect data-row={i} x={o.rungX} y={box.y} width={o.rungW} height={box.h} rx={7}
          style={{ fill: "var(--flow-chip-bg)", stroke: "none" }} opacity={0.5} />
        <text data-rowink={i} x={o.rungX + 10} y={box.mid + 3.2} fontSize={o.metaSize + 0.5} fontWeight={700}
          style={{ fill: "var(--shell-ink-3)" }} opacity={0.5}>
          {row.count} rules passed over
        </text>
        <text data-rowink={i} x={o.rungX + o.rungW - 10} y={box.mid + 3.2} fontSize={o.metaSize} textAnchor="end"
          style={{ fill: "var(--shell-ink-3)", fontFamily: "var(--font-mono)" }} opacity={0.5}>
          {clip(row.why, charsFor(o.rungW - 150, o.metaSize))}
        </text>
      </g>
    );
  }

  const deny = row.action === "deny";
  const implicit = row.key === "implicit";
  const stroke = row.isNew ? accent : (STATE_STROKE[row.state] ?? "var(--flow-node-line)");
  const badgeW = o.rungW > 320 ? 46 : 38;
  const nameX = o.rungX + (row.isNew ? 76 : 34);
  const nameMax = charsFor(o.rungW - (row.isNew ? 76 : 34) - badgeW - 16, o.nameSize);
  const metaMax = charsFor((o.rungW - (row.isNew ? 76 : 34)) * 0.56, o.metaSize);

  return (
    <g>
      {/* The halo the verdict lands on. Behind the row, so it reads as light rather than as a box. */}
      <rect data-halo={i} x={o.rungX - 5} y={box.y - 4} width={o.rungW + 10} height={box.h + 8} rx={11}
        style={{ fill: deny ? "var(--flow-deny-bg)" : "var(--flow-allow-bg)" }} opacity={0} />
      <rect data-row={i} x={o.rungX} y={box.y} width={o.rungW} height={box.h} rx={8}
        style={{ fill: row.isNew ? `${accent}14` : "var(--flow-node-bg)", stroke }}
        strokeWidth={row.isNew ? 1.6 : 1.1} strokeDasharray={row.isNew ? "5 3" : undefined} opacity={0.32} />
      <rect data-stripe={i} x={o.rungX} y={box.y} width={3.5} height={box.h}
        style={{ fill: "var(--flow-deny)" }} opacity={0} />

      <text data-rowink={i} x={o.rungX + 10} y={box.line1} fontSize={o.metaSize + 0.5} fontWeight={700}
        style={{ fill: "var(--shell-ink-3)", fontFamily: "var(--font-mono)" }} opacity={0.32}>
        {implicit ? "—" : `#${row.shown}`}
      </text>
      {row.isNew && (
        <>
          <rect data-rowink={i} x={o.rungX + 34} y={box.line1 - 10} width={34} height={14} rx={7}
            style={{ fill: `${accent}2b` }} opacity={0.32} />
          <text data-rowink={i} x={o.rungX + 51} y={box.line1} fontSize={8} fontWeight={800}
            textAnchor="middle" style={{ fill: accent }} opacity={0.32}>NEW</text>
        </>
      )}
      <text data-rowink={i} data-name={i} x={nameX} y={box.line1}
        fontSize={o.nameSize} fontWeight={row.isNew ? 800 : 700}
        style={{ fill: row.isNew ? accent : "var(--shell-ink)" }} opacity={0.32}>
        {clip(row.name, nameMax)}
      </text>
      <rect data-rowink={i} x={o.rungX + o.rungW - badgeW - 8} y={box.line1 - 10} width={badgeW} height={14} rx={7}
        style={{ fill: deny ? "var(--flow-deny-bg)" : "var(--flow-allow-bg)" }} opacity={0.32} />
      <text data-rowink={i} x={o.rungX + o.rungW - badgeW / 2 - 8} y={box.line1} fontSize={8} fontWeight={800}
        letterSpacing="0.04em" textAnchor="middle"
        style={{ fill: deny ? "var(--flow-deny)" : "var(--flow-allow)" }} opacity={0.32}>
        {row.action.toUpperCase()}
      </text>

      <text data-rowink={i} x={nameX} y={box.line2} fontSize={o.metaSize}
        style={{ fill: "var(--shell-ink-3)", fontFamily: "var(--font-mono)" }} opacity={0.32}>
        {clip(`${row.srcAddr.join(", ")} → ${row.dstAddr.join(", ")} · ${row.service.join(", ")}`, metaMax)}
      </text>
      <text data-ann={i} x={o.rungX + o.rungW - 10} y={box.line2} fontSize={o.metaSize} fontWeight={700}
        textAnchor="end" style={{ fill: "var(--shell-ink-3)" }} opacity={0} />
    </g>
  );
};

// ── Utilities ────────────────────────────────────────────────────────────────

const outcomeColour = (f: SimFlowResult) =>
  f.outcome === "dropped" ? "var(--flow-deny)"
    : f.outcome === "unknown" ? "var(--flow-warn)"
    : "var(--flow-info)";

/** Clip to a character budget rather than measuring: SVG has no ellipsis and this is a label. */
function clip(s: string, max: number): string {
  const t = s ?? "";
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** A point along a path, or null if the path is not in the DOM yet. */
function pointOn(path: SVGPathElement | null, k: number): { x: number; y: number } | null {
  if (!path || typeof path.getTotalLength !== "function") return null;
  const len = path.getTotalLength();
  if (!len) return null;
  const p = path.getPointAtLength(len * Math.max(0, Math.min(1, k)));
  return { x: p.x, y: p.y };
}

export default PacketWalk;

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Scenario, SimFlowResult } from "./packetSim";
import { GLOBE_D, SHIELD_D, charsFor, ease } from "./packetSimLayout";
import { DestinationNode } from "./DestinationNode";
import { PANEL_TRAFFIC, packetTime, syncSteps, useWalkClock, type PaintFn } from "./walkClock";
import { WalkSteps } from "./WalkSteps";

// PacketOverview — the journey, in three nodes.
//
// WHY THERE ARE TWO PICTURES. "Does my traffic still get out?" and "which of my forty rules just
// died?" are different questions, and the second one needs a rule table that does not fit in a
// 700px panel without shrinking every label past reading. So the panel answers the first: the
// packets leave a network, cross the firewall, and either reach the internet or stop inside the
// device. Full screen answers the second — same scenario, same clock, the whole table.
//
// It is not a simplification of the truth, only of the drawing. The rule that decided each flow is
// named under the firewall, the counts are the same counts, and a packet that dies here dies at the
// same moment it dies in the full walk.
//
// THREE LANES, ONE PER SAMPLE FLOW, so a run where one flow survives and two are dropped reads as
// three separate fates rather than as an average.
//
// AND THE LANES ARE BUSY. Each carries several packets at a time, relaunched as they land, so the
// picture is a device under load rather than a single packet being followed. The verdict under the
// firewall settles once and stays; the traffic never does. See walkClock.ts.

export type PacketOverviewProps = {
  scenario: Scenario;
  accent: string;
  /** Shown on the device. */
  deviceName?: string;
  /** Draw the finished frame and start no clock — the still form. */
  still?: boolean;
};

const PAD = 16;
const LANE_GAP = 20;

export const PacketOverview: React.FC<PacketOverviewProps> = ({
  scenario, accent, deviceName, still = false,
}) => {
  // ── Measure ──────────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setMeasured((prev) => (prev != null && Math.abs(prev - w) < 8 ? prev : w));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(360, measured ?? 700);
  const n = Math.max(1, scenario.flows.length);
  const H = Math.max(200, 150 + n * LANE_GAP);
  const midY = H / 2 + 4;

  const g = useMemo(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const srcW = clamp(Math.round(W * 0.22), 118, 210);
    const fwW = clamp(Math.round(W * 0.21), 116, 190);
    const dstW = clamp(Math.round(W * 0.20), 124, 190);
    const free = W - PAD * 2 - srcW - fwW - dstW;
    const gap = Math.max(44, free / 2);
    const srcX = PAD;
    const fwX = srcX + srcW + gap;
    const dstX = fwX + fwW + gap;
    return { srcW, fwW, dstW, srcX, fwX, dstX, width: Math.max(W, dstX + dstW + PAD) };
  }, [W]);

  const srcH = 84, fwH = 92;
  const srcTop = midY - srcH / 2, fwTop = midY - fwH / 2;
  /** The window the scan bar sweeps: the inside of the chassis, inset from its walls. */
  const scanTop = fwTop + 7, scanH = fwH - 14;

  // "all" as a destination is only the internet when the egress interface actually leads there; out
  // a DMZ or server port it reaches that network, drawn as a named node labelled with the interface.
  const firstFlow = scenario.flows[0]?.flow;
  const toInternet = scenario.egressIsInternet && !!firstFlow?.dstUnbounded;
  // Mirror of toInternet on the way in: an unrestricted source arriving on an internet-facing
  // interface is the internet, and the source node becomes the globe rather than a "0.0.0.0/0" card.
  const sourceInternet = scenario.ingressIsInternet && scenario.source.unbounded;
  const dstLabel = toInternet
    ? undefined
    : firstFlow?.dstUnbounded ? scenario.egress : firstFlow?.dstIp;
  const arrived = scenario.flows.filter((f) => f.outcome !== "dropped" && f.outcome !== "unknown").length;

  /** Which rule decided, said once — the fact the full walk spends a whole table establishing. */
  const decidedBy = useMemo(() => {
    const rules = new Set(scenario.flows.map((f) => (f.rule ? `#${f.rule.shown} ${f.rule.name}` : "—")));
    if (rules.size === 1) return [...rules][0];
    return `${rules.size} rules decided`;
  }, [scenario.flows]);

  const laneY = useCallback((i: number) => midY + (i - (n - 1) / 2) * LANE_GAP, [midY, n]);

  // ── Element handles ──────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement | null>(null);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  const paintRef = useRef<PaintFn>(() => {});
  const clock = useWalkClock(scenario.duration, still, paintRef, PANEL_TRAFFIC.speed);

  const stages = scenario.stages;
  const ingress = stages.find((s) => s.id === "ingress")!;
  const lookup = stages.find((s) => s.id === "lookup")!;
  const owner = `ov-${scenario.phase}`;

  const q = useCallback(<T extends Element>(sel: string): T | null =>
    svgRef.current?.querySelector<T>(sel) ?? null, []);

  /**
   * Where one packet is at time t.
   *
   * Three legs, timed off the SAME stages the full walk uses, so pausing at "Policy lookup" shows
   * the packet inside the device in both pictures.
   */
  const pos = useCallback((f: SimFlowResult, i: number, t: number) => {
    const y = laneY(i);
    const lag = i * 80;
    const inX = g.srcX + g.srcW, fwIn = g.fwX, fwMid = g.fwX + g.fwW / 2;
    if (t < ingress.to) {
      const k = clamp01((t - lag) / Math.max(1, ingress.to - ingress.from));
      return { x: inX + (fwIn - inX) * ease(k), y, vis: k <= 0 ? 0 : 1, k };
    }
    if (t < lookup.to) {
      // Inside the device, drifting towards the middle while the rules are tested.
      const k = clamp01((t - lag - lookup.from) / Math.max(1, lookup.to - lookup.from));
      return { x: fwIn + (fwMid - fwIn) * ease(k), y, vis: 1, k };
    }
    const after = t - lookup.to - lag * 0.5;
    if (f.outcome === "dropped" || f.outcome === "unknown") {
      const k = clamp01(after / 420);
      return { x: fwMid, y, vis: k >= 1 ? 0 : 1, k };
    }
    const k = clamp01(after / 1100);
    const e = ease(k);
    return { x: fwMid + (g.dstX - fwMid) * e, y: y + (midY - y) * e, vis: k >= 1 ? 0 : 1, k };
  }, [g, laneY, ingress, lookup, midY]);

  /**
   * How long one packet of each flow is on screen, and so how often the next one sets off.
   *
   * Read off the same legs pos() walks: across to the device, through the lookup, then either the
   * run out to the destination or the moment it takes to die inside. A dropped flow has a shorter
   * loop than one that gets out, so the lanes drift out of step by themselves.
   */
  const periods = useMemo(() => scenario.flows.map((f, i) =>
    lookup.to + i * 40 + (f.outcome === "dropped" || f.outcome === "unknown" ? 420 : 1100),
  ), [scenario.flows, lookup]);

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
    (i: number) => i * (periods[i] / (scenario.flows.length * PANEL_TRAFFIC.inFlight)),
    [periods, scenario.flows.length],
  );

  // ── One frame ────────────────────────────────────────────────────────────
  // `t` walks the rule lookup and stops at the verdict; `flowT` never stops. See walkClock.ts.
  const paint = useCallback((t: number, flowT: number) => {
    if (!svgRef.current) return;
    const stage = stages.find((s) => t >= s.from && t < s.to) ?? stages[stages.length - 1];
    const settled = t >= lookup.to;

    scenario.flows.forEach((f, i) => {
      const skew = skewOf(i);
      const lead = pos(f, i, packetTime(flowT, periods[i], 0, skew, PANEL_TRAFFIC.inFlight));

      for (let gen = 0; gen < PANEL_TRAFFIC.inFlight; gen++) {
        const pt = packetTime(flowT, periods[i], gen, skew, PANEL_TRAFFIC.inFlight);
        const here = gen === 0 ? lead : pos(f, i, pt);
        const lane = q<SVGGElement>(`[data-ov-lane="${i}-${gen}"]`);
        if (lane) {
          lane.setAttribute("transform", `translate(${here.x.toFixed(1)}, ${here.y.toFixed(1)})`);
          lane.setAttribute("opacity", String(here.vis));
        }
        [70, 140].forEach((back, k) => {
          const tail = q<SVGCircleElement>(`[data-ov-tail="${i}-${gen}-${k}"]`);
          if (!tail) return;
          // Clamped at 0: sampled across a relaunch, a tail would otherwise whip back across the
          // whole picture for one frame.
          const p = pos(f, i, Math.max(0, pt - back));
          tail.setAttribute("cx", p.x.toFixed(1));
          tail.setAttribute("cy", p.y.toFixed(1));
          tail.setAttribute("opacity", String(here.vis * (0.32 - k * 0.12)));
        });
      }

      // The wire is drawn by the first packet and then stays: the route is established, and what
      // moves along it afterwards is the traffic.
      const wire = q<SVGPathElement>(`[data-ov-wire="${i}"]`);
      if (wire) {
        const alive = !(f.outcome === "dropped" || f.outcome === "unknown");
        const drawn = !alive ? 0 : settled ? 1 : clamp01(lead.k);
        const len = wire.getTotalLength?.() ?? 0;
        if (len) {
          wire.setAttribute("stroke-dasharray", String(len));
          wire.setAttribute("stroke-dashoffset", String(len * (1 - drawn)));
        }
        wire.setAttribute("opacity", settled && drawn > 0 ? "0.9" : "0");
      }
      // Where the flow dies. Permanent once the verdict is in — it dies there every time — with the
      // ring expanding again on each packet that reaches it.
      const burst = q<SVGGElement>(`[data-ov-drop="${i}"]`);
      if (burst) {
        const dead = f.outcome === "dropped" || f.outcome === "unknown";
        burst.setAttribute("opacity", settled && dead ? "1" : "0");
        const ring = burst.querySelector("circle[data-ring]");
        if (ring) {
          ring.setAttribute("r", String(10 + clamp01(lead.k) * 10));
          ring.setAttribute("opacity", dead ? String((1 - clamp01(lead.k)) * 0.55) : "0");
        }
      }
    });

    const dev = q<SVGGElement>('[data-ov-device="1"]');
    if (dev) dev.setAttribute("opacity", t > ingress.to * 0.5 ? "1" : "0.55");

    // The device is doing something while the packets sit inside it, and until now it just sat
    // there. The bar sweeps the chassis once, over exactly the window the rules are being tested
    // in — so the pause in the middle of the journey has a visible cause.
    const scan = q<SVGRectElement>('[data-ov-scan="1"]');
    if (scan) {
      const k = clamp01((t - lookup.from) / Math.max(1, lookup.to - lookup.from));
      scan.setAttribute("y", (scanTop + (scanH - 2) * ease(k)).toFixed(1));
      scan.setAttribute("opacity", k > 0 && k < 1 ? (0.55 * Math.sin(Math.PI * k) + 0.1).toFixed(3) : "0");
    }

    const verdict = q<SVGGElement>('[data-ov-verdict="1"]');
    if (verdict) verdict.setAttribute("opacity", settled ? "1" : "0");
    const dest = q<SVGGElement>('[data-ov-dest="1"]');
    if (dest) dest.setAttribute("opacity", settled && arrived > 0 ? "1" : "0.34");
    // One ripple per ARRIVAL, timed off the flow that gets through. It used to fire once and never
    // again, which was right while the run ended; with traffic streaming it would be the only part
    // of the picture that had stopped.
    const ripple = q<SVGCircleElement>('[data-dest-ring="1"]');
    if (ripple) {
      const out = scenario.flows.findIndex((f) => f.outcome !== "dropped" && f.outcome !== "unknown");
      const since = out < 0
        ? Infinity
        : packetTime(flowT, periods[out], 0, skewOf(out), PANEL_TRAFFIC.inFlight);
      const age = clamp01(since / 620);
      ripple.setAttribute("r", String(13 + age * 16));
      ripple.setAttribute("opacity", arrived > 0 && age < 1 ? ((1 - age) * 0.5).toFixed(3) : "0");
    }

    if (noteRef.current) noteRef.current.textContent = stage.detail;
    syncSteps(owner, stage.id);
  }, [scenario, stages, lookup, ingress, pos, periods, skewOf, arrived, owner, q, scanTop, scanH]);

  // Publish the paint function for the geometry just laid out, then draw the first frame before the
  // browser draws one of its own. Runs again on a resize.
  useLayoutEffect(() => {
    paintRef.current = paint;
    clock.prime();
  }, [clock, paint]);

  const srcChars = charsFor(g.srcW - 20, 10);
  const fwChars = charsFor(g.fwW - 18, 10);

  return (
    <div className="flex min-w-0 flex-col">
      <div ref={wrapRef} className="min-w-0">
        <svg ref={svgRef} viewBox={`0 0 ${g.width} ${H}`}
          style={{ display: "block", width: "100%", height: "auto" }}
          role="img" aria-label={`${scenario.headline.title}. ${scenario.headline.detail}`}>
          <defs>
            <marker id="ov-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: "var(--flow-node-line)" }} />
            </marker>
          </defs>

          {/* ── The wires, drawn faint and completed by the packets ── */}
          {scenario.flows.map((f, i) => (
            <path key={`rail-${f.flow.id}`}
              d={`M ${g.srcX + g.srcW} ${laneY(i)} L ${g.fwX} ${laneY(i)}`}
              style={{ fill: "none", stroke: "var(--flow-node-line)" }} strokeWidth={1.2}
              strokeDasharray="3 4" opacity={0.6} markerEnd="url(#ov-arrow)" />
          ))}
          {scenario.flows.map((f, i) => {
            if (f.outcome === "dropped" || f.outcome === "unknown") return null;
            const y = laneY(i);
            const x0 = g.fwX + g.fwW, mid = (x0 + g.dstX) / 2;
            return (
              <path key={`wire-${f.flow.id}`} data-ov-wire={i}
                d={`M ${x0} ${y} C ${mid} ${y}, ${mid} ${midY}, ${g.dstX} ${midY}`}
                style={{ fill: "none", stroke: "var(--flow-allow)" }} strokeWidth={1.8}
                strokeLinecap="round" opacity={0} />
            );
          })}

          {/* ── Source ──
              When the traffic ARRIVES from the internet (the ingress interface is one a default
              route points out of) and the source is unrestricted, the source IS the internet — drawn
              as the globe, the same shape the destination uses, so "Internet → LAN" reads at a glance
              instead of as an anonymous "0.0.0.0/0" box. */}
          <rect x={g.srcX} y={srcTop} width={g.srcW} height={srcH} rx={12}
            style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={1.4} />
          <text x={g.srcX + 12} y={srcTop + 22} fontSize={9} fontWeight={800} letterSpacing="0.09em"
            style={{ fill: "var(--shell-ink-3)" }}>SOURCE</text>
          {sourceInternet ? (
            <>
              <g transform={`translate(${g.srcX + 12}, ${srcTop + 34}) scale(${22 / 24})`}>
                <path d={GLOBE_D.disc}
                  style={{ fill: "var(--flow-info-bg)", stroke: "var(--flow-info)" }} strokeWidth={1.5} />
                <path d={GLOBE_D.meridian}
                  style={{ fill: "none", stroke: "var(--flow-info)" }} strokeWidth={1.1} opacity={0.75} />
                {GLOBE_D.lats.map((d) => (
                  <path key={d} d={d} style={{ fill: "none", stroke: "var(--flow-info)" }}
                    strokeWidth={1.1} opacity={0.55} />
                ))}
              </g>
              <text x={g.srcX + 12 + 22 + 10} y={srcTop + 50} fontSize={12} fontWeight={800}
                style={{ fill: "var(--shell-ink)" }}>Internet</text>
              <text x={g.srcX + 12} y={srcTop + 71} fontSize={9.5} style={{ fill: "var(--shell-ink-3)" }}>
                {clip(`any source · on ${scenario.ingress}`, srcChars)}
              </text>
            </>
          ) : (
            <>
              <text x={g.srcX + 12} y={srcTop + 40} fontSize={12} fontWeight={800}
                style={{ fill: "var(--shell-ink)" }}>{clip(scenario.source.label, srcChars)}</text>
              <text x={g.srcX + 12} y={srcTop + 56} fontSize={11} fontWeight={700}
                style={{ fill: accent, fontFamily: "var(--font-mono)" }}>
                {clip(scenario.source.value, srcChars)}
              </text>
              <text x={g.srcX + 12} y={srcTop + 71} fontSize={9.5} style={{ fill: "var(--shell-ink-3)" }}>
                {scenario.source.unbounded
                  ? `unrestricted · on ${scenario.ingress}`
                  : `~${scenario.source.hosts.toLocaleString()} addresses · on ${scenario.ingress}`}
              </text>
            </>
          )}

          {/* ── The device ── */}
          <g data-ov-device="1" opacity={0.55}>
            <rect x={g.fwX} y={fwTop} width={g.fwW} height={fwH} rx={13}
              style={{ fill: "var(--flow-node-bg)", stroke: accent }} strokeWidth={1.6} />
            <g transform={`translate(${g.fwX + g.fwW / 2 - 13}, ${fwTop + 12}) scale(${26 / 24})`}
              style={{ fill: `${accent}1f`, stroke: accent }} strokeWidth={1.8} strokeLinejoin="round">
              <path d={SHIELD_D} />
            </g>
            <text x={g.fwX + g.fwW / 2} y={fwTop + 56} fontSize={11.5} fontWeight={800} textAnchor="middle"
              style={{ fill: "var(--shell-ink)" }}>{clip(deviceName || "FortiGate", fwChars)}</text>
            <text x={g.fwX + g.fwW / 2} y={fwTop + 70} fontSize={9.5} textAnchor="middle"
              style={{ fill: "var(--shell-ink-3)", fontFamily: "var(--font-mono)" }}>
              {clip(`${scenario.ingress} → ${scenario.egress}`, fwChars)}
            </text>
            <text x={g.fwX + g.fwW / 2} y={fwTop + 83} fontSize={9} textAnchor="middle"
              style={{ fill: "var(--shell-ink-3)" }}>first match wins</text>
            <rect data-ov-scan="1" x={g.fwX + 5} y={scanTop} width={g.fwW - 10} height={2} rx={1}
              style={{ fill: accent }} opacity={0} />
          </g>

          {/* Which rule decided — the one fact the full table exists to establish. */}
          <g data-ov-verdict="1" opacity={0}>
            <rect x={g.fwX - 6} y={fwTop + fwH + 10} width={g.fwW + 12} height={19} rx={9.5}
              style={{ fill: "var(--flow-chip-bg)" }} />
            <text x={g.fwX + g.fwW / 2} y={fwTop + fwH + 23} fontSize={9.5} fontWeight={700}
              textAnchor="middle" style={{ fill: "var(--shell-ink-2)", fontFamily: "var(--font-mono)" }}>
              {clip(decidedBy, charsFor(g.fwW + 4, 9.5))}
            </text>
          </g>

          {/* ── Where it ends up ── */}
          <g data-ov-dest="1" opacity={0.34}>
            <DestinationNode x={g.dstX} w={g.dstW} y={midY} toInternet={toInternet}
              arrived={arrived} total={scenario.flows.length}
              dstIp={dstLabel} nameSize={12} metaSize={9.5} />
          </g>

          {/* ── Drops, inside the device ── */}
          {scenario.flows.map((f, i) =>
            f.outcome === "dropped" || f.outcome === "unknown" ? (
              <g key={`drop-${f.flow.id}`} data-ov-drop={i} opacity={0}
                transform={`translate(${g.fwX + g.fwW / 2}, ${laneY(i)})`}>
                <circle data-ring="1" r={10} style={{
                  fill: "none",
                  stroke: f.outcome === "unknown" ? "var(--flow-warn)" : "var(--flow-deny)",
                }} strokeWidth={1.4} opacity={0} />
                <circle r={9} style={{
                  fill: f.outcome === "unknown" ? "var(--flow-warn-bg)" : "var(--flow-deny-bg)",
                  stroke: f.outcome === "unknown" ? "var(--flow-warn)" : "var(--flow-deny)",
                }} strokeWidth={1.2} />
                {f.outcome === "unknown"
                  ? <text y={3.5} fontSize={10} fontWeight={800} textAnchor="middle"
                      style={{ fill: "var(--flow-warn)" }}>?</text>
                  : <path d="M -3.6 -3.6 L 3.6 3.6 M 3.6 -3.6 L -3.6 3.6"
                      style={{ stroke: "var(--flow-deny)" }} strokeWidth={2.1} strokeLinecap="round" />}
              </g>
            ) : null)}

          {/* ── Packets: IN_FLIGHT of each flow, streaming ── */}
          {scenario.flows.map((f, i) => (
            <g key={`tail-${f.flow.id}`}>
              {Array.from({ length: PANEL_TRAFFIC.inFlight }, (_, gen) => [0, 1].map((k) => (
                <circle key={`${gen}-${k}`} data-ov-tail={`${i}-${gen}-${k}`} r={3.8 - k}
                  cx={-50} cy={-50} style={{ fill: tone(f) }} opacity={0} />
              )))}
            </g>
          ))}
          {scenario.flows.map((f, i) => Array.from({ length: PANEL_TRAFFIC.inFlight }, (_, gen) => (
            <g key={`${f.flow.id}-${gen}`} data-ov-lane={`${i}-${gen}`} opacity={0}>
              <circle r={10} style={{ fill: tone(f) }} opacity={0.16} />
              <circle r={4.4} style={{ fill: tone(f) }} />
              {/* The lane is labelled on its lead packet only. Three copies of "A · 443/tcp"
                  chasing each other down one lane says nothing the first one did not. */}
              {gen === 0 && (
                <text x={0} y={-13} fontSize={8} fontWeight={700} textAnchor="middle"
                  style={{ fill: "var(--shell-ink-2)", fontFamily: "var(--font-mono)" }}>
                  {f.flow.id} · {f.flow.port}/{f.flow.proto.toLowerCase()}
                </text>
              )}
            </g>
          )))}
        </svg>
      </div>

      {!still && <WalkSteps stages={stages} owner={owner} onSeek={clock.seek} noteRef={noteRef} />}
    </div>
  );
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const tone = (f: SimFlowResult) =>
  f.outcome === "dropped" ? "var(--flow-deny)"
    : f.outcome === "unknown" ? "var(--flow-warn)"
    : "var(--flow-info)";

function clip(s: string, max: number): string {
  const t = s ?? "";
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}

export default PacketOverview;

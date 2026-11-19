import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

// The clock both simulation views run on.
//
// There are two pictures of one scenario — the overview in the panel and the rule-by-rule walk in
// full screen — and they must behave identically: the same cadence, the same respect for a
// reduced-motion preference. Sharing a hook is how they stay identical; copying the loop into each
// renderer is how they drift.
//
// IT DRIVES PAINT THROUGH A REF, not through a prop. Each renderer's paint() closes over its own
// layout and its own element handles, so it is rebuilt whenever those change — and a hook that took
// paint as a value would restart the animation frame loop on every one of those rebuilds. The ref
// lets the loop keep running while the function it calls is swapped underneath it.
//
// ── TWO TIMES, AND WHY ───────────────────────────────────────────────────────
//
// This used to be one run on one timeline: three packets set off together, the table lit up rung by
// rung, everything landed, the picture froze, and 2.2 seconds later the whole thing started over
// from an empty stage. It had a progress bar, a running clock and a speed switch under it, which is
// the vocabulary of a VIDEO — something with a beginning you wait through and an end you wait for.
//
// A firewall is not a video. Traffic is not a take. So there are two times now:
//
//   TABLE time  — the walk down the rule base. It runs once, reaches the verdict, and STAYS there.
//                 It is a conclusion ("#4 claims this traffic, #7 never runs"), and a conclusion
//                 that erases itself every few seconds so it can be re-derived is just churn.
//
//   FLOW time   — monotonic, never wraps, never resets. Packets are placed by it modulo their own
//                 journey, so each flow keeps launching new packets on its own cadence without
//                 waiting for the last one to arrive. Several are in the air at once and the
//                 flows drift out of step with each other, because their journeys are different
//                 lengths. That is what traffic looks like.
//
// The only control left is the stage chips, and seek() is what they call: it rewinds TABLE time so
// the walk plays again from "Policy lookup". Traffic is not interrupted by it — nothing a reader
// clicks should stop the packets, because on the real device nothing does.
//
// NOTHING HERE RE-RENDERS PER FRAME. Both times live in refs and the renderers mutate attributes
// directly; React hears about this hook once, on mount.

/**
 * How busy each picture is, and how fast.
 *
 * Not a setting the reader can reach. The three-speed switch that used to sit under the drawing was
 * a control over something nobody wants control over — 2× makes the decision unreadable, and 1× was
 * already too fast to follow a packet past the rule that kills it.
 *
 * But the two views are not the same picture and should not run identically, which is what they did
 * at first. The FULL WALK is a wide stage with a whole rule table on it: it can carry three packets
 * per flow and wants them, because the fact it exists to show is a table under load. The PANEL is
 * that same run in a 700px box beside a chat column, and three per flow there read as a swarm — too
 * much movement in too little space, next to text somebody is trying to read. So it carries two,
 * and moves slower still.
 */
export const WALK_TRAFFIC = { inFlight: 3, speed: 0.4 } as const;
export const PANEL_TRAFFIC = { inFlight: 2, speed: 0.33 } as const;

/** The full walk's density, which is also the default the tests describe. */
export const IN_FLIGHT = WALK_TRAFFIC.inFlight;

/**
 * Where one packet is in its OWN journey, given the monotonic flow time.
 *
 * `period` is how long that flow's packet takes from the source to the point it disappears, so the
 * modulo relaunches it the instant it lands. `gen` spreads this flow's packets evenly along the
 * path — with three in flight, generation 1 sets off a third of a journey behind generation 0,
 * which is why a new packet is on its way long before the one ahead has arrived. `skew` keeps two
 * flows that happen to be decided by the same rule from travelling superimposed.
 */
export function packetTime(
  flowT: number, period: number, gen: number, skew = 0, inFlight: number = IN_FLIGHT,
): number {
  const p = Math.max(1, period);
  return (flowT + skew + gen * (p / Math.max(1, inFlight))) % p;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What a renderer's paint() is handed: the table's moment, and the traffic's running time. */
export type PaintFn = (tableT: number, flowT: number) => void;

export type WalkClock = {
  /** True when the viewer asked for less motion, or the caller wants a still frame. */
  reduced: boolean;
  /**
   * Play the walk down the rule table again from this moment. Traffic is untouched.
   *
   * This is the whole of the transport now. It used to be a scrubber over a run that stopped; it is
   * a way of re-asking "show me the lookup" over a picture that never stops.
   */
  seek: (ms: number) => void;
  /**
   * Draw the current moment, and park a still or reduced-motion view at its settled frame.
   *
   * A renderer calls this from its own layout effect, so it fires after the renderer has published
   * the paint function for the geometry it has just laid out — on mount and after every resize.
   * The clock owns both times outright: nothing outside writes to them, which is both the React
   * Compiler's rule about values returned from hooks and the reason two views can share one clock
   * without either of them being able to corrupt it.
   */
  prime: () => void;
};

export function useWalkClock(
  duration: number,
  still: boolean,
  paintRef: RefObject<PaintFn>,
  /** WALK_TRAFFIC.speed or PANEL_TRAFFIC.speed — the two views run at different paces. */
  speed: number = WALK_TRAFFIC.speed,
): WalkClock {
  const [reducedPref] = useState(prefersReducedMotion);
  const reduced = reducedPref || still;

  /** Monotonic. Never wrapped, never rewound — the packets are placed modulo this. */
  const flowRef = useRef(0);
  /** The flow time the current pass down the table started at. seek() is what moves it. */
  const baseRef = useRef(0);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  const tableAt = useCallback(
    (flowT: number) => Math.min(duration, Math.max(0, flowT - baseRef.current)),
    [duration],
  );

  useEffect(() => {
    // A viewer who asked for less motion gets the settled table and no traffic at all. An animation
    // that never stops is precisely what that preference is about, and this one never stops.
    if (reduced) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; return; }

    lastRef.current = performance.now();
    const step = (now: number) => {
      // Clamped: a backgrounded tab hands back a delta of several seconds, which would teleport
      // every packet to the end of its journey the moment the tab is looked at again.
      flowRef.current += Math.min(64, now - lastRef.current) * speed;
      lastRef.current = now;
      paintRef.current?.(tableAt(flowRef.current), flowRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduced, speed, paintRef, tableAt]);

  // Memoised so a renderer can depend on the clock in an effect without re-running it every frame
  // the parent happens to re-render.
  return useMemo<WalkClock>(() => ({
    reduced,
    seek: (ms: number) => {
      baseRef.current = flowRef.current - Math.max(0, Math.min(duration, ms));
      paintRef.current?.(tableAt(flowRef.current), flowRef.current);
    },
    prime: () => {
      // A still or reduced-motion viewer gets the FINISHED table rather than an empty stage: the
      // picture has to be readable without motion, because for some people there will not be any.
      // No packets are drawn for them — a frozen dot halfway along a wire states nothing, while an
      // empty path under a settled rule table states the verdict, which is the point.
      if (reduced) { paintRef.current?.(duration, 0); return; }
      paintRef.current?.(tableAt(flowRef.current), flowRef.current);
    },
  }), [reduced, duration, paintRef, tableAt]);
}

/**
 * Light the step chip the clock is inside.
 *
 * Called from paint(), so it touches the DOM directly: which of four chips is active changes a
 * handful of times in four seconds, and routing it through React state would re-render the whole
 * drawing sixty times a second to find out.
 *
 * It lives here rather than beside the chips because a file that exports a component and a plain
 * function loses fast refresh for the component.
 */
export function syncSteps(owner: string, stageId: string) {
  document.querySelectorAll<HTMLElement>(`[data-walkstep][data-owner="${owner}"]`)
    .forEach((el) => { el.dataset.on = String(el.dataset.walkstep === stageId); });
}

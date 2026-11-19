import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IN_FLIGHT, PANEL_TRAFFIC, WALK_TRAFFIC, packetTime, useWalkClock, type WalkClock,
} from "./walkClock";

// The clock runs two times now and the difference between them is the whole design, so that is
// what these pin: the TABLE walks once to its verdict and holds, while FLOW time never stops, never
// wraps and is not affected by anything a reader clicks. There is no transport left to restart it.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const DURATION = 4000;

/** A hand-cranked requestAnimationFrame, so a four-second run takes no time to test. */
function fakeRAF() {
  let pending: FrameRequestCallback | null = null;
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { pending = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { pending = null; });
  vi.stubGlobal("performance", { now: () => now });
  return {
    /** Advance by `ms`, in frames small enough to survive the clock's own 64ms clamp. */
    advance(ms: number) {
      for (let left = ms; left > 0; left -= 16) {
        now += Math.min(16, left);
        const cb = pending;
        pending = null;
        cb?.(now);
      }
    },
    get running() { return pending !== null; },
  };
}

let container: HTMLDivElement;
let root: Root;

type Frame = { table: number; flow: number };

function mountClock(still = false) {
  const frames: Frame[] = [];
  const paintRef = { current: (table: number, flow: number) => { frames.push({ table, flow }); } };
  const out: { clock: WalkClock | null } = { clock: null };

  function Probe() {
    const clock = useWalkClock(DURATION, still, paintRef);
    useEffect(() => { out.clock = clock; }, [clock]);
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });
  return { frames, clock: () => out.clock! };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the walk clock", () => {
  it("starts on its own — there is no control that would start it", () => {
    const raf = fakeRAF();
    const { frames } = mountClock();
    act(() => raf.advance(500));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)!.flow).toBeGreaterThan(0);
  });

  it("runs at the pace it is given, and the panel is given a slower one", () => {
    // Two views, two paces. The full walk has a whole rule table to cross; the panel is the same
    // run in a 700px box beside text somebody is reading, so it moves slower and carries less.
    const raf = fakeRAF();
    const { frames } = mountClock();
    act(() => raf.advance(1000));
    const walked = frames.at(-1)!.flow;
    expect(walked).toBeCloseTo(1000 * WALK_TRAFFIC.speed, -2);
    expect(PANEL_TRAFFIC.speed).toBeLessThan(WALK_TRAFFIC.speed);
    expect(PANEL_TRAFFIC.inFlight).toBeLessThan(WALK_TRAFFIC.inFlight);
  });

  it("walks the table once and then holds the verdict", () => {
    // The settled frame — which rules died, how many packets arrived — is an answer, not a step in
    // a loop. Re-deriving it every few seconds was the churn that made the old run feel like a
    // video you had to wait through.
    const raf = fakeRAF();
    const { frames } = mountClock();
    act(() => raf.advance(DURATION * 4));
    const table = frames.map((f) => f.table);
    expect(Math.max(...table), "the table never runs past its own duration").toBe(DURATION);
    expect(table.at(-1)).toBe(DURATION);
    // And it does not go round: once settled it never returns to the start.
    expect(table.slice(table.indexOf(DURATION)).every((v) => v === DURATION)).toBe(true);
  });

  it("keeps flow time running forever, long after the table has settled", () => {
    const raf = fakeRAF();
    const { frames } = mountClock();
    act(() => raf.advance(DURATION * 6));
    const flow = frames.map((f) => f.flow);
    expect(flow.at(-1), "flow time is monotonic and never wraps").toBeGreaterThan(DURATION);
    expect(flow.every((v, i) => i === 0 || v >= flow[i - 1])).toBe(true);
    expect(raf.running, "and it keeps asking for frames").toBe(true);
  });

  it("rewinds the table on seek without touching the traffic", () => {
    // The stage chips are the only control left. Clicking "Policy lookup" should replay the walk,
    // not stop the packets — on the real device nothing a reader clicks interrupts traffic.
    const raf = fakeRAF();
    const { frames, clock } = mountClock();
    act(() => raf.advance(DURATION * 3));
    const flowBefore = frames.at(-1)!.flow;

    act(() => clock().seek(1200));
    const afterSeek = frames.at(-1)!;
    expect(afterSeek.table).toBe(1200);
    expect(afterSeek.flow, "flow time survives a seek").toBe(flowBefore);

    act(() => raf.advance(400));
    expect(frames.at(-1)!.table, "and the table carries on from there").toBeGreaterThan(1200);
    expect(frames.at(-1)!.flow).toBeGreaterThan(flowBefore);
  });

  it("shows a settled table and no traffic to a viewer who asked for less motion", () => {
    // A frozen dot halfway along a wire states nothing. An empty path under a settled rule table
    // states the verdict, which is the point of the picture.
    const raf = fakeRAF();
    const { frames, clock } = mountClock(true);
    expect(clock().reduced).toBe(true);
    act(() => clock().prime());
    expect(frames.at(-1)).toEqual({ table: DURATION, flow: 0 });

    const before = frames.length;
    act(() => raf.advance(2000));
    expect(frames.length, "no frames should be requested at all").toBe(before);
  });
});

describe("packetTime", () => {
  it("relaunches a packet as soon as its journey ends", () => {
    const period = 3000;
    expect(packetTime(0, period, 0)).toBe(0);
    expect(packetTime(2999, period, 0)).toBe(2999);
    expect(packetTime(3000, period, 0), "straight back to the start").toBe(0);
    expect(packetTime(3200, period, 0)).toBe(200);
  });

  it("spreads a flow's packets evenly along its own path", () => {
    // This is what puts several in the air at once: generation 1 is a third of a journey behind
    // generation 0, so the next packet is well on its way before the one ahead has landed.
    const period = 3000;
    const at = Array.from({ length: IN_FLIGHT }, (_, g) => packetTime(0, period, g));
    expect(at).toEqual([0, 1000, 2000]);
  });

  it("skews one flow against another so two never travel superimposed", () => {
    const period = 3000;
    expect(packetTime(0, period, 0, 150)).toBe(150);
    expect(packetTime(0, period, 0, 0)).toBe(0);
  });

  it("never divides by zero on a degenerate period", () => {
    expect(Number.isFinite(packetTime(500, 0, 1))).toBe(true);
  });
});

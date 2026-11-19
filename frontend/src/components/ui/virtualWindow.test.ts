import { describe, expect, it } from "vitest";
import { windowOf } from "./virtualWindow";

// The window arithmetic. An off-by-one here is a row that never renders — on the Application
// Control picker that means a signature the operator cannot select and cannot explain.

describe("windowOf", () => {
  const H = 288;   // the picker's scroll box
  const R = 30;    // one signature row

  it("starts at the top with no negative index", () => {
    const { first } = windowOf(0, R, H, 2414);
    expect(first).toBe(0);
  });

  it("covers the whole viewport plus a margin", () => {
    const { first, last } = windowOf(0, R, H, 2414);
    // ceil(288/30) = 10 visible, + 3 above (clamped away at the top) + 3 below
    expect(last - first).toBeGreaterThanOrEqual(Math.ceil(H / R));
  });

  it("moves with the scroll", () => {
    const a = windowOf(0, R, H, 2414);
    const b = windowOf(600, R, H, 2414);
    expect(b.first).toBeGreaterThan(a.first);
    // 600px down is row 20; with 3 rows of overscan the window starts at 17.
    expect(b.first).toBe(17);
  });

  // ⚠️ The last row has to be reachable. Scrolling to the bottom must include index total-1.
  it("reaches the final row", () => {
    const total = 2414;
    const maxScroll = total * R - H;
    const { last } = windowOf(maxScroll, R, H, total);
    expect(last).toBe(total);
  });

  it("never runs past the end", () => {
    const { last } = windowOf(999_999, R, H, 50);
    expect(last).toBeLessThanOrEqual(50);
  });

  it("handles a list shorter than the viewport", () => {
    const { first, last } = windowOf(0, R, H, 3);
    expect(first).toBe(0);
    expect(last).toBe(3);
  });

  it("is empty for an empty list", () => {
    expect(windowOf(0, R, H, 0)).toEqual({ first: 0, last: 0 });
  });

  // A zero row height would divide by zero and hand back NaN indices, which slice() turns into an
  // empty render — a picker that silently shows nothing.
  it("refuses a zero row height rather than producing NaN", () => {
    expect(windowOf(100, 0, H, 500)).toEqual({ first: 0, last: 0 });
  });
});

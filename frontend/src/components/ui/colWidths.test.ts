import { describe, expect, it } from "vitest";
import { colWidths } from "./colWidths";

// The four User & Authentication list pages hand their `gridCols` prop straight to this, and the
// widths it returns are the only thing keeping an LDAP distinguished name from being squeezed to
// the same share as a two-character status. The cases that matter are the proportion maths and the
// two ways a caller can hand it something it cannot divide up.

describe("colWidths", () => {
  it("shares 100% out in proportion to the fr values", () => {
    expect(colWidths("1fr 1fr", 2)).toEqual(["50.000%", "50.000%"]);
    expect(colWidths("3fr 1fr", 2)).toEqual(["75.000%", "25.000%"]);
  });

  it("handles the fractional tracks the real pages use", () => {
    // user-groups.tsx's own track list.
    const [a, b, c, d] = colWidths("1.4fr 1.8fr 1.6fr 0.6fr", 4);
    expect(Number.parseFloat(a)).toBeCloseTo(25.926, 2);
    expect(Number.parseFloat(b)).toBeCloseTo(33.333, 2);
    expect(Number.parseFloat(c)).toBeCloseTo(29.630, 2);
    expect(Number.parseFloat(d)).toBeCloseTo(11.111, 2);
    const total = [a, b, c, d].reduce((sum, w) => sum + Number.parseFloat(w), 0);
    expect(total).toBeCloseTo(100, 2);
  });

  it("passes a fixed track through untouched", () => {
    // A caller that asked for exactly 120px meant it; only the fr tracks share what is left.
    expect(colWidths("120px 1fr 1fr", 3)).toEqual(["120px", "50.000%", "50.000%"]);
  });

  it("falls back to equal shares when the track count does not match the columns", () => {
    // A width is a presentation detail — a mismatched prop must not be the reason a page throws.
    expect(colWidths("1fr 1fr", 3)).toEqual([
      `${100 / 3}%`, `${100 / 3}%`, `${100 / 3}%`,
    ]);
    expect(colWidths("", 2)).toEqual(["50%", "50%"]);
  });

  it("does not divide by zero when no track is an fr", () => {
    expect(colWidths("120px 80px", 2)).toEqual(["120px", "80px"]);
  });
});

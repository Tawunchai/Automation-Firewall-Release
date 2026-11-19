import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFreshFrom } from "./useFreshFrom";

// Which rows of a live Ping / Trace Route list slide in: the ones added since the last change —
// and after a new run clears the list, the new run's rows from the first one.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** The hook's value, rendered — read back from the DOM so the probe writes nothing outside itself. */
const Probe: React.FC<{ n: number }> = ({ n }) => <output>{useFreshFrom(n)}</output>;

/** Minimal renderHook with rerender — the project has no @testing-library/react. */
function renderFresh(initial: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Probe n={initial} />);
  });
  return {
    current: { get value() { return Number(container.textContent); } },
    rerender: (n: number) => act(() => root.render(<Probe n={n} />)),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useFreshFrom", () => {
  beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("marks only the rows added since the last change as fresh", () => {
    const h = renderFresh(0);
    expect(h.current.value).toBe(0);
    h.rerender(3);
    expect(h.current.value).toBe(0); // rows 0..2 are new
    h.rerender(5);
    expect(h.current.value).toBe(3); // only rows 3..4 are new
    h.rerender(5);
    expect(h.current.value).toBe(3); // an unrelated render keeps the same rows fresh
    h.unmount();
  });

  it("starts over when a new run clears the list", () => {
    const h = renderFresh(10);
    h.rerender(0);
    expect(h.current.value).toBe(0);
    h.rerender(1);
    expect(h.current.value).toBe(0); // the first reply of the new run animates too
    h.unmount();
  });
});

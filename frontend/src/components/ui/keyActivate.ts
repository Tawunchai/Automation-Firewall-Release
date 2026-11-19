import type React from "react";

/**
 * Keyboard activation for an element that is clickable but is not a `<button>`.
 *
 * Several lists in this console are CSS grids whose rows are `<div>`s: the row's columns are the
 * grid's own tracks, so turning the row into a `<button>` takes it out of the grid and the columns
 * stop lining up. Those rows are still buttons in every way that matters to the person using them,
 * so they carry `role="button"` (or `aria-pressed` when they toggle), `tabIndex={0}` and this
 * handler — which is the part a mouse-only `onClick` was missing.
 *
 * Enter and Space, because that is what a button answers to. `preventDefault` on Space stops the
 * page scrolling underneath, which is the usual way this ends up half-done. Keys pressed on a child
 * that handles its own (a real button or input inside the row) are left alone: `e.target !==
 * e.currentTarget` means the row is not the thing being typed into.
 */
export function activateOnKey(
  run: () => void,
): (e: React.KeyboardEvent<HTMLElement>) => void {
  return (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    run();
  };
}

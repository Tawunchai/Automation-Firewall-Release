import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LogSearchField from "./LogSearchField";

// A layout bug is invisible to the type checker and to every test that only asks what the page
// fetched — the first build of this field shipped with the magnifier and the submit button drawn
// on top of each other, and everything was green.
//
// What is actually assertable without a layout engine is the STRUCTURE that makes the overlap
// impossible: the adornments are SIBLINGS of the input inside one flex row, rather than elements
// positioned over it with reserved padding. jsdom computes no geometry, but it can see that.

const render = (value: string) =>
  renderToStaticMarkup(
    <LogSearchField
      value={value}
      onChange={() => {}}
      onSubmit={() => {}}
      onClear={() => {}}
      placeholder="Search — an address, a port, a word, or srcip==10.0.0.1"
    />,
  );

describe("LogSearchField", () => {
  it("lays the field out as one flex row, never as things stacked on an input", () => {
    const html = render("");
    // `.shell-field` is the row; if it is ever swapped back for a bare `.shell-input` the
    // adornments have nowhere to sit but on top of the text.
    expect(html).toContain("shell-field");
    // Absolute positioning is the mechanism the overlap needed. Nothing here may use it.
    expect(html).not.toContain("absolute");
    // Nor the padding that a positioned build has to reserve — the guess that goes wrong.
    expect(html).not.toMatch(/\bp[lr]-\d/);
  });

  it("shows exactly one magnifier when the box is empty", () => {
    // The bug on screen was TWO magnifiers in the same corner: the decorative one and the submit
    // button's, overlapping. They are still two separate elements, so the guard is that the
    // decorative one is hidden from assistive tech and the button is the only named control.
    const html = render("");
    expect(html.match(/aria-label="Run the search"/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    // No clear button with nothing to clear.
    expect(html).not.toContain("Clear the search");
  });

  it("adds the clear button only once there is something to clear", () => {
    // This adornment appearing and disappearing is what broke the padding-based layout: the space
    // the text needed changed as you typed. In a flex row it costs nothing.
    const html = render("srcip==10.0.0.1");
    expect(html.match(/aria-label="Clear the search"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Run the search"/g)).toHaveLength(1);
  });

  it("keeps the input a direct child of the row, so flex can size it", () => {
    // `.shell-field > input` in index.css is a direct-child selector: wrapping the input in a div
    // would silently drop the styling that makes it transparent and borderless inside the box.
    const html = render("");
    expect(html).toMatch(/<div class="shell-field[^"]*">\s*<svg[\s\S]*?<\/svg>\s*<input/);
  });

  it("names the field for a screen reader without repeating the icon", () => {
    const html = render("");
    expect(html).toContain('aria-label="Search the log"');
  });

  it("carries the placeholder it was given", () => {
    expect(render("")).toContain("srcip==10.0.0.1");
  });
});

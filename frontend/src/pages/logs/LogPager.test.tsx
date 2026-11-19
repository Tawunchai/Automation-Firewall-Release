import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LogPager from "./LogPager";

const render = (total: number, index: number) =>
  renderToStaticMarkup(<LogPager total={total} index={index} onChange={() => {}} />);

// The pager's job is small, and so is the way it goes wrong: an enabled Next on the last page, a
// disabled Previous on page two, or a control rendered under a table that has one page of rows.
// None of that is visible to a type checker.

describe("LogPager", () => {
  it("does not render controls when everything fits on one page", () => {
    // A disabled Previous/Next pair under three rows is furniture, not information.
    const html = render(14, 0);
    expect(html).not.toContain("Next page");
    expect(html).not.toContain("Previous page");
    expect(html).toContain("14 entries");
  });

  it("says so plainly when there is nothing at all", () => {
    expect(render(0, 0)).toContain("No entries");
  });

  it("shows the span and the page on a log that needs more than one page", () => {
    // 34 rows is the lab buffer's real size: two pages, the second one short.
    const first = render(34, 0);
    expect(first).toContain("1–20 of 34");
    expect(first).toContain("1 / 2");

    const second = render(34, 1);
    expect(second).toContain("21–34 of 34");
    expect(second).toContain("2 / 2");
  });

  it("disables Previous on the first page and Next on the last", () => {
    // React emits `disabled` BEFORE `aria-label`, so the button is matched by reading the whole
    // tag and asking what is in it — not by assuming an attribute order that is React's to choose.
    const isDisabled = (html: string, label: string) => {
      const tag = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
      expect(tag, `no button labelled ${label}`).toBeDefined();
      return tag!.includes("disabled");
    };

    const first = render(34, 0);
    expect(isDisabled(first, "Previous page")).toBe(true);
    expect(isDisabled(first, "Next page")).toBe(false);

    const last = render(34, 1);
    expect(isDisabled(last, "Next page")).toBe(true);
    expect(isDisabled(last, "Previous page")).toBe(false);
  });

  it("announces the span, because pressing Next navigates nothing", () => {
    // The rows swap in place, so a screen reader has no page change to report on its own.
    expect(render(34, 0)).toContain('aria-live="polite"');
  });

  it("survives an index past the end rather than rendering a blank span", () => {
    // The caller clamps, but the row count can shrink between renders.
    const html = render(34, 9);
    expect(html).toContain("21–34 of 34");
  });
});

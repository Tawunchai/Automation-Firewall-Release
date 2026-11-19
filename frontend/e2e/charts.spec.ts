import { test, expect } from "@playwright/test";

// Charts that stay inside their card.
//
// THE BUG THIS EXISTS TO CATCH
// A recharts ResponsiveContainer measures its parent. Every chart in this console sits in a grid or
// flex cell, and a grid/flex item's `min-width` defaults to `auto` — it may not shrink below its
// own content. So the chart grows happily with the window and then refuses to give the width back:
// widen the browser (or open the sidebar, or switch to a wider device name) and narrow it again,
// and the plot now hangs out of its card over whatever is beside it. Nothing throws, the console
// stays clean, and `npm run build` cannot see it — the only way to catch it is to resize a real
// browser and measure.
//
// The assertion is deliberately not "the chart looks right": it is that the drawn SVG is never
// wider than the box that is supposed to contain it, at a width the layout was never rendered at
// first. Two sizes, in that order, because the failure only appears on the way DOWN.

const WIDE = { width: 1600, height: 1000 };
const NARROW = { width: 900, height: 1000 };

/** Pages that draw at least one recharts plot, with something on them to wait for. */
const CHART_PAGES = [
  { path: "/admin/dashboard", name: "Dashboard" },
  { path: "/admin/fw-interfaces", name: "Interfaces — throughput" },
  { path: "/admin/sdwan?tab=slas", name: "SD-WAN — SLA history" },
  { path: "/admin/config-drift", name: "Config Drift" },
];

for (const target of CHART_PAGES) {
  test(`${target.name}: every chart still fits its card after the window narrows`, async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto(target.path);
    // The charts are behind a device read; give the page a moment to draw them rather than racing.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);

    await page.setViewportSize(NARROW);
    // ResponsiveContainer is debounced by 80ms; wait past it plus a frame.
    await page.waitForTimeout(800);

    const overflowing = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll(".recharts-responsive-container").forEach((el, i) => {
        const parent = el.parentElement;
        if (!parent) return;
        const chart = el.getBoundingClientRect();
        const box = parent.getBoundingClientRect();
        // One pixel of slack for sub-pixel layout; the failure mode this catches is hundreds.
        if (chart.width > box.width + 1) {
          bad.push(`chart ${i}: ${Math.round(chart.width)}px inside ${Math.round(box.width)}px`);
        }
      });
      return bad;
    });

    expect(overflowing, `charts wider than their container on ${target.path}`).toEqual([]);

    // And nothing may spill out of the page itself, which is what a reader actually sees.
    const scroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(scroll.doc, `${target.path} scrolls horizontally at ${NARROW.width}px`)
      .toBeLessThanOrEqual(scroll.win + 1);
  });
}

test("the AI chat can be cleared from its own header", async ({ page }) => {
  await page.goto("/admin/ai-assistant");
  await page.waitForLoadState("networkidle");

  // exact: the sidebar's filter box has a "Clear filter" button, and a loose name matches both.
  const clear = page.getByRole("button", { name: "Clear", exact: true });
  await expect(clear).toBeVisible();
  // Nothing has been said yet, so there is nothing to clear — the control greys out rather than
  // disappearing, so it can be found again.
  await expect(clear).toBeDisabled();

  // Typing alone is enough to make it live: a half-written question is part of the conversation.
  await page.getByPlaceholder(/^Ask /).fill("what policies are on this device?");
  await expect(clear).toBeEnabled();

  await clear.click();
  await expect(page.getByPlaceholder(/^Ask /)).toHaveValue("");
  await expect(clear).toBeDisabled();
});

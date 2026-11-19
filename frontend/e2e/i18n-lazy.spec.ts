import { test, expect } from "@playwright/test";
import { assertClean, attachDiagnostics, visit, watchForErrors } from "./helpers";

/**
 * The dictionaries are code-split, and this is the only place that can prove it.
 *
 * `npm run build` shows two chunks; vitest shows the loader works against mocked tables. Neither
 * answers the question that matters — does a REAL session fetch its own language and nothing else,
 * and does the screen actually come up in that language rather than in English?
 *
 * What is being defended: the entry chunk carried both dictionaries and was 743 KB (222 KB gzip).
 * Every session downloaded Thai AND Chinese, including the English ones. It is now 114 KB (40 KB),
 * and the way that regresses is a single static `import` of src/i18n/dictionary/{th,zh} slipping
 * back in somewhere — which nothing else in the suite would notice, because everything would still
 * work, just slower for everybody.
 */

/** Records which language chunks the browser actually asked the server for. */
function watchDictionaryRequests(page: import("@playwright/test").Page) {
  const asked: string[] = [];
  page.on("request", (req) => {
    const m = /\/assets\/(th|zh)\.lazy-[^/]+\.js$/.exec(req.url());
    if (m) asked.push(m[1]);
  });
  return asked;
}

test.describe("code-split dictionaries", () => {
  test.describe.configure({ mode: "serial" });

  test("an English session downloads no dictionary at all", async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const asked = watchDictionaryRequests(page);

    await page.addInitScript(() => window.localStorage.setItem("console.lang", "en"));
    await visit(page, "/admin/devices");

    expect(asked, "English is the key, not a translation — it must cost no dictionary fetch").toEqual([]);
    await attachDiagnostics(page, testInfo);
    assertClean(errors, "English session");
  });

  test("a Thai session fetches Thai, renders Thai, and never fetches Chinese", async ({ page }, testInfo) => {
    const errors = watchForErrors(page);
    const asked = watchDictionaryRequests(page);

    await page.addInitScript(() => window.localStorage.setItem("console.lang", "th"));
    await visit(page, "/admin/devices");

    // The dictionary is awaited BEFORE the first render (src/main.tsx), so there is no window in
    // which the page is up and still English. If that gate is ever removed this assertion is what
    // catches it — the text would be English at the moment the page settles.
    await expect(page.locator("body")).toContainText(/[฀-๿]/, { timeout: 30_000 });

    expect(asked).toContain("th");
    expect(asked, "a Thai session must not pay for the Chinese dictionary").not.toContain("zh");

    await attachDiagnostics(page, testInfo);
    assertClean(errors, "Thai session");
  });

  test("the switcher loads the picked language on demand and nothing else", async ({ page }, testInfo) => {
    const errors = watchForErrors(page);

    await page.addInitScript(() => window.localStorage.setItem("console.lang", "en"));
    await visit(page, "/admin/devices");

    // Watch only from here, so what is recorded is what the SWITCH caused.
    const asked = watchDictionaryRequests(page);

    await page.locator('button[aria-label="Language"]').first().click();
    await page.locator('[role="option"]', { hasText: "中文" }).first().click();

    // LanguageProvider awaits the dictionary before flipping the language, so the first thing that
    // appears in the new language is already translated — there is no English repaint in between.
    await expect(page.locator("body")).toContainText(/[一-鿿]/, { timeout: 30_000 });

    expect(asked).toContain("zh");
    expect(asked, "picking Chinese must not drag Thai along with it").not.toContain("th");

    await attachDiagnostics(page, testInfo);
    assertClean(errors, "language switch");
  });
});

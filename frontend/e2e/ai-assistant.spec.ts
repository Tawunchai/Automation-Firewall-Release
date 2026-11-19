import { test, expect } from "@playwright/test";
import { assertClean, attachDiagnostics, visit, watchForErrors } from "./helpers";

// The AI Assistant gets its own file because it is the page that must not regress, and because it
// is the one this refactor actually touched: three constant lookup tables and wizKey moved out of
// the component into ./undoKinds. The values are pinned by undoKinds.test.ts; what those unit
// tests cannot show is that the page still MOUNTS with them imported rather than declared inline
// — a circular import between the page and the extracted module would only fail here.
//
// It also loads more separate chunks than any other page (its own ~110 kB, PolicyWizard, and one
// per wizard), so it is the strongest test of the vendor split.

const AI_ROUTE = "/admin/ai-assistant";

test.describe.configure({ mode: "serial" });

test("the page mounts with no uncaught exception", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, AI_ROUTE);

  // The chat composer is the page's core control; if the module failed to initialise, the route
  // renders empty and this is missing.
  await expect(page.locator("textarea").first()).toBeVisible({ timeout: 20_000 });

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "AI Assistant");
});

// NOTE on the extracted undoKinds tables: their VALUES are pinned by undoKinds.test.ts (15 unit
// tests). There is deliberately no browser assertion on them here — reaching them through the UI
// means applying a suggestion, which calls the paid model and writes to a live firewall, and
// reaching them by importing the source module only works against a dev server, not the
// production bundle these tests actually run against. What the browser adds is the mount test
// above: the page still initialises with those tables imported rather than declared inline, which
// is the only failure mode the unit tests cannot see.

test("the device picker is populated from the backend", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, AI_ROUTE);

  // The page loads devices on mount and preselects the first FortiGate. Seeing the lab device's
  // name proves the whole path — auth cookie, /devices, and the component's own state — works.
  await expect(page.getByText(/FortiGate/i).first()).toBeVisible({ timeout: 20_000 });

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "AI Assistant device picker");
});

test("the example prompts render and are enabled", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, AI_ROUTE);

  // EXAMPLE_PROMPTS is a module-level constant in index.tsx sitting right where the extracted
  // lookup tables used to be, so a botched edit there shows up as a missing prompt list.
  //
  // NOT clicked on purpose: the handler is `onClick={() => deviceId && onSend(label)}` — it fires
  // the prompt at the model immediately. A click here would spend real API credit and could push
  // configuration at the lab firewall. Rendered and enabled is the whole assertion.
  // The label is English: the example prompts were translated with the rest of the UI, and this
  // assertion was left looking for the old Thai string.
  const prompt = page.getByRole("button", { name: "Create a LAN → WAN policy" });
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await expect(prompt, "the prompt buttons enable once a device is selected").toBeEnabled();

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "AI Assistant example prompts");
});

test("typing in the composer does not throw", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, AI_ROUTE);

  const composer = page.locator("textarea").first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  // The composer re-renders on every keystroke, and the flush timer / stream view live alongside
  // the code that was edited. Deliberately no submit — this must not call the paid API.
  await composer.fill("ทดสอบ smoke test ไม่ส่งจริง");
  await expect(composer).toHaveValue("ทดสอบ smoke test ไม่ส่งจริง");

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "AI Assistant composer");
});

test("the Simulate page mounts on its own route", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  // The full walk used to be an overlay inside the chat; it is a route now, which means its own
  // lazy chunk (PacketWalk + the rule ledger + the impact report) and its own chance to fail to
  // initialise. Visited COLD and therefore with no hand-off — the run lives in memory in the chat
  // — so what renders is the empty state. That is the assertion this can make without an AI call:
  // the chunk loads, the page mounts, and it offers the way back instead of a blank screen.
  await visit(page, "/admin/ai-assistant/simulate");

  await expect(page.getByText("There is no simulation loaded")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Back to AI Assistant/i }).first())
    .toBeVisible({ timeout: 20_000 });

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "AI Assistant simulate page");
});

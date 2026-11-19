import { test, expect, type Page } from "@playwright/test";
import { assertClean, attachDiagnostics, visit, watchForErrors } from "./helpers";

// The one thing `npm run build`/vitest cannot prove about the Topology stage: that a real WebGL
// context mounts, draws and tears down cleanly in a real browser — see vite.config.ts's own comment
// on why these smoke tests exist at all (a vendor-chunk init-order bug is invisible to tsc/vitest
// and shows up only here). The CSP matters too: an earlier attempt at scene text used a Web Worker
// from a blob: URL, which `script-src 'self'` blocks, and the whole canvas went display:none.
//
// This replaced a spec that drove a 2D/3D toggle. There is no toggle any more — the page is 3D
// only, and the ring renderer it switched to is deleted.

/**
 * These tests can only say anything about the renderer if the app got far enough to draw one.
 *
 * Running the WHOLE suite trips the backend's per-IP rate limiter before this file is reached, and
 * that lands in two places: the device proxy answers "too many requests", so the page shows its
 * "could not read the interfaces" state; and /auth/me is refused too, which the app reads as
 * signed-out and bounces to the login screen. Both are the environment, not the bundle — and these
 * smoke tests exist to catch a broken chunk split or a CSP that kills the canvas, so failing on a
 * lab firewall's mood would make the suite lie about what it covers. Auth itself is covered by
 * smoke.spec.ts, which runs before the limiter is anywhere near.
 */
const sceneOrSkip = async (page: Page) => {
  const canvas = page.locator("canvas");
  const unreadable = page.getByText(/Could not read the interfaces/i);
  const signedOut = page.getByRole("button", { name: /Sign In/i });

  await expect(canvas.or(unreadable).or(signedOut).first()).toBeVisible({ timeout: 25_000 });

  if (await signedOut.isVisible()) {
    test.skip(true, "bounced to login — /auth/me was rate-limited by the earlier specs");
  }
  if (await unreadable.isVisible()) {
    test.skip(true, "device unreachable or rate-limited — nothing for the renderer to draw");
  }
  return canvas;
};

test("Topology: the stage mounts a live WebGL canvas with no uncaught exception", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, "/admin/topology");

  // The three.js/@react-three/fiber/@react-three/drei chunk is lazy — give it the same tolerance
  // `visit()` gives every other lazy chunk.
  const canvas = await sceneOrSkip(page);

  // A WebGL context that fails to initialise still leaves a <canvas> in the DOM, so presence alone
  // would not catch it.
  const live = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return Boolean(gl) && c.width > 0 && c.height > 0;
  });
  expect(live, "the stage canvas never acquired a WebGL context or has zero size").toBe(true);

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "Topology stage");
});

test("Topology: everything in the scene is reachable without the canvas", async ({ page }) => {
  await visit(page, "/admin/topology");
  await sceneOrSkip(page);

  // Nothing inside a WebGL canvas is in the accessibility tree and a mesh cannot take focus, so the
  // page carries a parallel list of the same tiles, jacks and paths. If this ever empties, the
  // scene is the only way to use the page — which is the regression worth catching.
  const list = page.locator('[aria-label^="Topology of"]');
  await expect(list).toHaveCount(1);
  expect(await list.getByRole("button").count()).toBeGreaterThan(0);
});

test("Topology: leaving the page tears the renderer down", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await visit(page, "/admin/topology");
  await sceneOrSkip(page);

  // Unmounting the canvas is where drei's <Html> used to throw a removeChild NotFoundError, which
  // is why scene text is drawn to a texture instead.
  await visit(page, "/admin/dashboard");
  await expect(page.locator("canvas")).toHaveCount(0, { timeout: 15_000 });

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "Topology unmount");
});

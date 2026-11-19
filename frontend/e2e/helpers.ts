import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

// Credentials for the seeded admin. Overridable so this can be pointed at another environment.
export const ADMIN_EMAIL = process.env.SMOKE_EMAIL || "admin@got.co.th";
export const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD || "12345678";

// Where auth.setup.ts parks the signed-in cookie for the other specs to reuse.
export const STORAGE_STATE = "e2e/.auth/state.json";

// Console noise that is NOT a defect in this app, and why each one is tolerated.
const IGNORED_CONSOLE = [
  // React 19 + Ant Design v6 emit deprecation notices that are not actionable here.
  /React Router Future Flag/i,
  /Support for defaultProps/i,
  /\[antd:/i,
  // A device that is unreachable, or an endpoint the lab licence does not cover, surfaces as a
  // failed request. That is a device/network condition, not a broken bundle — the page is
  // expected to render its error state and carry on.
  /Failed to load resource/i,
  /net::ERR_/i,
  /the server responded with a status of (4|5)\d\d/i,
  // The app probes /auth/me on boot and logs the 401 it gets when nobody is signed in yet. That
  // is the normal cold-start path of the login page, not a defect.
  /GetMe error/i,
  // 429 = a rate limiter doing its job. The login page calls /email-phone-numbers on mount and
  // that endpoint sits behind OTPLimiter (5 requests / 10 minutes per IP), so re-running this
  // suite a few times in quick succession trips it. It says nothing about the bundle, which is
  // what these tests are for — and the limiters are in-memory, so restarting the backend clears
  // them if a run really does need a clean slate.
  /status code 429/i,
];

const isIgnored = (text: string) => IGNORED_CONSOLE.some((re) => re.test(text));

export type PageErrors = {
  /** console.error output that is not on the ignore list. */
  consoleErrors: string[];
  /** Uncaught exceptions — this is what a bad chunk split produces. */
  pageErrors: string[];
};

/**
 * watchForErrors attaches listeners BEFORE navigation, so an exception thrown while the module
 * graph initialises is captured. Attaching after page.goto() would miss exactly the failure these
 * tests exist to catch.
 */
export function watchForErrors(page: Page): PageErrors {
  const out: PageErrors = { consoleErrors: [], pageErrors: [] };

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!isIgnored(text)) out.consoleErrors.push(text);
  });

  // pageerror fires for uncaught exceptions and unhandled rejections. Never filtered: a
  // "Cannot access 'X' before initialization" arrives here and means the bundle is broken.
  page.on("pageerror", (err) => out.pageErrors.push(`${err.name}: ${err.message}`));

  return out;
}

/** assertClean fails the test with the collected errors spelled out. */
export function assertClean(errors: PageErrors, where: string) {
  expect(
    errors.pageErrors,
    `${where}: uncaught exception(s) in the browser — this is what a bad vendor-chunk split looks ` +
      `like:\n${errors.pageErrors.join("\n")}`,
  ).toEqual([]);

  expect(
    errors.consoleErrors,
    `${where}: console error(s):\n${errors.consoleErrors.join("\n")}`,
  ).toEqual([]);
}

/**
 * login drives the real login form and waits until the app shell has rendered.
 * Sessions are cookie-based, so everything after this is authenticated.
 */
export async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Already signed in from a previous test in the same context.
  if (!page.url().includes("login") && (await page.locator("aside, nav").count()) > 0) return;

  // `:visible`, not a plain `.first()`. The login page renders one form today, but it used to
  // render three layout variants of it and hide the inapplicable ones with CSS — which made
  // `.first()` land on a hidden input and wait for it forever. Keeping the visibility filter costs
  // nothing and means the next responsive rework cannot resurrect that.
  const email = page.locator('input[type="email"]:visible').first();
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await email.fill(ADMIN_EMAIL);

  await page.locator('input[type="password"]:visible').first().fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]:visible').first().click();

  // Wait for the REDIRECT, not for "the URL stopped saying login": this app serves its login page
  // at "/", so a `!pathname.includes("login")` predicate is already true before the form is even
  // submitted. It returned instantly, the next navigation raced the auth cookie, and the app
  // booted unauthenticated straight back to the login page.
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
  await expect(page.locator('input[type="password"]:visible')).toHaveCount(0);
}

/**
 * visit navigates to an admin route and waits for the lazy chunk to have executed.
 *
 * Every route is a `lazy(() => import(...))`, so "the page loaded" means its chunk was fetched AND
 * evaluated. networkidle is the honest signal for that here: it waits out the chunk request and
 * the device calls the page fires on mount.
 */
export async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {
    // A page that polls (the dashboard charts, the AI deploy poller) never reaches networkidle.
    // That is fine — the chunk has run by then, which is what is being tested.
  });
  // The app shell must be present; a blank body is the symptom of a module-init failure.
  await expect(page.locator("body")).not.toBeEmpty();
}

/** attachDiagnostics saves a screenshot when something failed, to make triage possible. */
export async function attachDiagnostics(page: Page, testInfo: TestInfo) {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("screenshot", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}


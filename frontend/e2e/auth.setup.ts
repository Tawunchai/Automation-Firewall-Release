import { test as setup } from "@playwright/test";
import { login, STORAGE_STATE } from "./helpers";

// Sign in ONCE and save the cookie for every other spec to reuse.
//
// Why this exists rather than a login() in each test: the login page calls /email-phone-numbers on
// mount, and that endpoint sits behind the OTP rate limiter (5 requests per 10 minutes per IP,
// middleware.OTPLimiter). A suite that logs in per test trips it after the fifth page load and
// every subsequent test fails with a 429 that has nothing to do with what it was testing. Logging
// in once is also simply faster.
setup("authenticate", async ({ page }) => {
  await login(page);
  await page.context().storageState({ path: STORAGE_STATE });
});

import { defineConfig, devices } from "@playwright/test";

// Browser smoke tests.
//
// Why they exist: the vendor chunk split in vite.config.ts is the one change in this codebase that
// cannot be verified by `npm run build`. Rollup happily emits a bundle whose modules initialise in
// the wrong order; the failure is a "Cannot access X before initialization" thrown in the browser
// at import time, and it shows up as a blank page. tsc, vitest and the build all pass either way.
//
// These tests load the real app out of the running container and fail on any console error or
// uncaught exception. That is the assertion that matters — not what is on screen, but that nothing
// exploded getting there.
//
// They are NOT part of `npm test`: they need the docker stack up (frontend on :5173, backend on
// :9000, and a reachable FortiGate for the device pages). Run them deliberately:
//
//     npm run test:smoke
//
// BASE_URL overrides the target if the stack is published somewhere else.
//
// ⚠️ Rate limits: each run performs ONE real login, and the backend allows 10 per 15 minutes per
// IP (middleware.LoginLimiter). Running the suite back-to-back more than ~10 times inside that
// window makes the `setup` project fail with a 429 that has nothing to do with the app. The
// limiters are in-memory, so `docker compose restart backend` clears them immediately.
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  // A cold chunk load plus a live device call is slower than a unit test; be patient but bounded.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // one browser against one backend session — keep it predictable
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    ignoreHTTPSErrors: true, // the LAN HTTPS mode uses a self-signed certificate
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    // Sign in once; every spec below reuses the cookie. Logging in per test trips the OTP rate
    // limiter (5 requests / 10 min) that guards /email-phone-numbers, which the login page calls
    // on mount — after the fifth login every later test fails with an unrelated 429.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});

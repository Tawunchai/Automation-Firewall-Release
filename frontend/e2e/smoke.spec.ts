import { test, expect } from "@playwright/test";
import { assertClean, attachDiagnostics, visit, watchForErrors } from "./helpers";

// Every route is a lazy(() => import(...)), so visiting one forces its chunk to be fetched AND
// evaluated. With manualChunks in play that means each page also pulls its share of the vendor
// chunks — vendor-antd, vendor-react, vendor-recharts, vendor-calendar, vendor-apexcharts,
// vendor-i18n — and a module-initialisation problem in any of them throws right there.
//
// Nothing here asserts on appearance. The assertion is that loading the page raised no uncaught
// exception and logged no console error, which is precisely what `npm run build` cannot tell us.

// Ordered roughly by which vendor chunk each page is most likely to pull in first.
const ROUTES: { path: string; name: string; why: string }[] = [
  { path: "/admin/dashboard", name: "Dashboard", why: "recharts + live device polling + the Security Posture Score tile" },
  { path: "/admin/topology", name: "Topology", why: "the live overlay poll + the edge-flow animation loop" },
  { path: "/admin/calendar", name: "Calendar", why: "the whole @fullcalendar chunk" },
  { path: "/admin/user", name: "Users", why: "apexcharts (activity timeline + breakdown)" },
  { path: "/admin/devices", name: "Devices", why: "antd tables, drawers, modals" },
  { path: "/admin/fw-interfaces", name: "Interfaces", why: "the device faceplate + throughput panel" },
  { path: "/admin/fw-interfaces?tab=zones", name: "Zones tab", why: "Zones merged into Interfaces behind a toggle" },
  { path: "/admin/static-routes", name: "Static Routes", why: "form-controls after the move" },
  { path: "/admin/firewall-policy", name: "Firewall Policy", why: "the busiest device page" },
  { path: "/admin/firewall-policy/create", name: "Firewall Policy — create form", why: "the Impact Preview button + its modal" },
  { path: "/admin/fw-addresses", name: "Addresses", why: "" },
  { path: "/admin/fw-addresses?tab=groups", name: "Address Groups tab", why: "Address Groups merged into Addresses behind a toggle" },
  { path: "/admin/fw-services", name: "Services", why: "" },
  { path: "/admin/fw-services?tab=groups", name: "Service Groups tab", why: "Service Groups merged into Services behind a toggle" },
  { path: "/admin/schedules", name: "Schedules", why: "" },
  { path: "/admin/virtual-ips", name: "Virtual IPs", why: "" },
  { path: "/admin/security-profiles/antivirus", name: "Security Profiles", why: "" },
  { path: "/admin/ipsec-tunnels", name: "IPsec Tunnels", why: "" },
  { path: "/admin/rule-lifecycle", name: "Rule Lifecycle", why: "policy hit history chart reads stored samples" },
  // The Phase 7 chart surfaces. Each one draws stored samples with recharts, and each has an
  // empty state that is reached on this lab device — SD-WAN is switched off, so its panel renders
  // "no samples" rather than a plot, which is exactly the path most likely to throw.
  { path: "/admin/sdwan?tab=slas", name: "SD-WAN performance SLAs", why: "live bars plus the stored SLA history panel" },
  { path: "/admin/ipsec-wizard", name: "IPsec Wizard", why: "imports ParentDropdown from its new home" },
  { path: "/admin/user-groups", name: "User Groups", why: "imports Segmented/focusRing from its new home" },
  // The FORM, not just the list. Its state, validation, payload mapping and datasource hook were
  // moved to user-group-form.logic.ts so the component module exports components only; a wrong
  // import path there is invisible to the list page and to tsc's own output, but blank here.
  { path: "/admin/user-groups/create?deviceId=1", name: "User Group form", why: "the logic/component split" },
  { path: "/admin/user-definition", name: "User Definition", why: "" },
  { path: "/admin/ldap-servers", name: "LDAP Servers", why: "" },
  { path: "/admin/radius-servers", name: "RADIUS Servers", why: "" },
  // The page itself: the policy walk, the animated packet path and the Fix it panels. It was only
  // ever reached here through a redirect, so nothing loaded its chunk.
  { path: "/admin/diagnostics/troubleshooting", name: "Troubleshooting", why: "the PacketFlow canvas + PolicyMatrix, FixPanel and the admin-only Ping tab, all in one chunk" },
  // Session Monitor's old address, which redirects here. A broken redirect leaves a saved bookmark
  // on an empty router outlet, and nothing else asserts that it still lands.
  { path: "/admin/diagnostics/sessions", name: "Session Monitor redirect", why: "redirects into Troubleshooting" },
  { path: "/admin/notify", name: "Notify", why: "three tabs behind one shell — rules, channels, history — plus the overview tiles" },
  { path: "/admin/traffic-shaping", name: "Traffic Shaping", why: "two device tables on one screen — shapers and shaping policies — plus the used-by count each shaper is described with" },
  { path: "/admin/logs/local-traffic", name: "Local Traffic", why: "admin-only placeholder page with an inline SVG mascot" },
  { path: "/admin/audit", name: "Audit / Review", why: "runs a full scan as soon as a device is picked" },
  // Lazily imports recharts for its two charts, and renders the merged change history — the one
  // page where a stale filter key or a missing count field shows up as a blank list, not a type
  // error. It was not covered when the review workflow was removed from it.
  { path: "/admin/config-drift", name: "Config Drift", why: "lazy recharts + the merged change history" },
  // The Change Ledger's old address, which redirects here. A broken redirect leaves a saved
  // bookmark on an empty router outlet, and nothing else asserts that it still lands.
  { path: "/admin/change-ledger", name: "Change Ledger redirect", why: "redirects into Config Drift" },
  { path: "/admin/config-deploy", name: "Config Deploy", why: "" },
  { path: "/admin/service", name: "Settings", why: "the maintenance-mode toggle lives here" },
  // Profile carries the Device Credentials card that replaced the activity feed — and /admin/credentials
  // is gone, so this route is the only place that code is reachable from.
  { path: "/admin/profile", name: "Account", why: "TOTP UI + the Device Credentials card" },
];

// The signed-in app shell is proven by auth.setup.ts, which drives the real login form and fails
// the whole run if it cannot. This covers the UNAUTHENTICATED entry point: cookies cleared, so the
// app boots cold into the login page the way a first-time visitor does.
test("the login page renders without a bundle error", async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await page.context().clearCookies();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[type="email"]:visible').first()).toBeVisible({ timeout: 30_000 });

  await attachDiagnostics(page, testInfo);
  assertClean(errors, "login page");
});

test.describe("every route loads without an uncaught exception", () => {
  test.describe.configure({ mode: "serial" });

  for (const route of ROUTES) {
    test(`${route.name}${route.why ? ` — ${route.why}` : ""}`, async ({ page }, testInfo) => {
      const errors = watchForErrors(page);
      await visit(page, route.path);
      await attachDiagnostics(page, testInfo);
      assertClean(errors, route.name);
    });
  }
});

// The vendor chunks have to actually be served. A manualChunks name that no page ever imports
// would silently mean the split did nothing.
test("the vendor chunks are real, served files", async ({ page, request }) => {
  await visit(page, "/admin/dashboard");

  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLScriptElement>("script[src], link[href]"))
      .map((el) => el.getAttribute("src") || el.getAttribute("href") || "")
      .filter((s) => s.endsWith(".js")),
  );

  const vendors = scripts.filter((s) => s.includes("vendor-"));
  expect(vendors.length, `no vendor-* chunk was loaded; scripts were:\n${scripts.join("\n")}`)
    .toBeGreaterThan(0);

  for (const src of vendors) {
    const res = await request.get(src);
    expect(res.status(), `${src} did not serve`).toBe(200);
  }
});

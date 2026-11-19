import { baseApi } from "./http";
import { responseError, responseStatus } from "./errorText";

// The primitives every device-scoped API module is built on.
//
// These were the top of api/policyObject.ts, which had grown to 2,391 lines and is tracked in
// backend/test/layout-budget.json as needing a split. They move out first, on their own, because
// every module carved off that file needs them — and a domain module importing them back FROM
// policyObject.ts while policyObject.ts re-exports the domain module is a cycle.

// ─── Device read failures ─────────────────────────────────────────────────────
//
// Every DeviceList* helper used to end in `catch { return [] }`. That collapses two very different
// answers into one: "the firewall has no policies" and "we could not reach the firewall". On a page
// whose whole job is to show what the firewall enforces, an empty list is a dangerous thing to
// invent — it reads as "nothing is configured".
//
// The lenient behaviour is still the default, because a dozen dropdown/picker call sites
// legitimately prefer an empty option list to an exception. Pages that PRESENT the device's
// configuration pass `{ strict: true }` and get a DeviceRequestError they can render as an error
// state instead.

export class DeviceRequestError extends Error {
  readonly status?: number;
  readonly cause: unknown;
  constructor(what: string, cause: unknown) {
    const status = responseStatus(cause);
    const detail = responseError(cause);
    super(
      detail ? `${what}: ${detail}`
        : status ? `${what}: request failed (HTTP ${status})`
        : `${what}: the device could not be reached`
    );
    this.name = "DeviceRequestError";
    this.status = status;
    this.cause = cause;
  }
}

export type DeviceReadOpts = { strict?: boolean };

// deviceList performs a device GET that yields an array.
//   lenient (default): any failure → []
//   strict           : any failure → DeviceRequestError
// A 200 carrying a non-array is treated as empty in both modes — that is a real, successful
// "nothing here" answer from the backend.
export async function deviceList<T>(url: string, what: string, opts?: DeviceReadOpts): Promise<T[]> {
  try {
    const res = await baseApi.get(url);
    return Array.isArray(res.data) ? (res.data as T[]) : [];
  } catch (err) {
    if (opts?.strict) throw new DeviceRequestError(what, err);
    return [];
  }
}

/** Every device-proxy route hangs off this prefix. */
export const deviceBase = (deviceId: number) => `/policy/device/${deviceId}`;

// ── The virtual domain every device read and write is scoped by ──────────────
//
// A FortiGate can be split into VDOMs — separate tenants with separate policy tables, objects and
// routes, on one box. Every device call in this console used to send `?vdom=root`, hard-coded on
// the server: a firewall divided between three departments showed one of them and hid the other
// two, with nothing on screen to say so.
//
// It is a MODULE-level value rather than a React context, deliberately. The api/ modules are plain
// functions called from effects, wizards, the AI apply path and a background job; threading a
// context value through every one of them would mean ~200 call sites, and the one that forgot it
// would silently read the wrong tenant. The selector sets it once, beside the device selector it
// belongs to.
//
// Empty means "root", which is what every caller got before this existed.
let currentVDOM = "";

/** Called by the VDOM picker. Changing it changes every subsequent device call. */
export const setRequestVDOM = (vdom: string): void => { currentVDOM = vdom; };

/**
 * Appends the selected VDOM to a device URL.
 *
 * Applied by ONE axios request interceptor (api/http.ts) rather than by the ~200 helpers that
 * build these URLs. A per-call version would be ~200 chances to forget it, and the call that
 * forgot would silently read or write a different tenant than the one on screen — with nothing
 * about the screen to say so.
 *
 * A no-op while no VDOM is selected, so a single-VDOM firewall's requests are byte-for-byte what
 * they were.
 */
export const withVDOM = (url: string): string => {
  if (!currentVDOM) return url;
  // Only device-proxy routes are scoped. /users, /notify and the rest are the console's own.
  if (!url.includes("/policy/device/")) return url;
  // A URL that already names one was built deliberately; do not append a second.
  if (/[?&]vdom=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `vdom=${encodeURIComponent(currentVDOM)}`;
};

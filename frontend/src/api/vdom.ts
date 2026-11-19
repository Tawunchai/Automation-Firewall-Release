import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// The virtual domains a FortiGate is split into.
//
// Its own module rather than a few lines in policyObject.ts: a VDOM is not a policy object, it is
// the scope every policy object is read in. The selector in the navbar is the only caller.

/** One virtual domain. Mirrors services.FGVDOM on the backend. */
export type DeviceVDOM = {
  name: string;
  /** What the device's own GUI shows when the name is long. May be absent. */
  short_name?: string;
  /** True for the VDOM that owns the unit's global settings. */
  management: boolean;
  /** Whether the unit is in multi-VDOM mode at all. Carried on every row. */
  multi_vdom: boolean;
};

/**
 * Lists the unit's VDOMs.
 *
 * The `?vdom=` is explicitly EMPTY and is not an oversight. Two things read it:
 *
 *   · withVDOM (api/deviceRequest) leaves any URL that already names a vdom alone, so this one
 *     request escapes the interceptor that scopes every other device call.
 *   · requestVDOM (backend) treats an empty value as absent, which means the unit's management
 *     domain — the same scope every call used before the selector existed.
 *
 * That is the right scope for this question. "Which tenants exist" belongs to the unit, not to
 * whichever tenant happens to be selected, and system/global — where multi_vdom comes from — is
 * not readable from inside a non-management VDOM.
 *
 * Lenient by default: the navbar prefers no picker to an error banner in the chrome.
 */
export const DeviceListVDOMs = (deviceId: number, opts?: DeviceReadOpts): Promise<DeviceVDOM[]> =>
  deviceList<DeviceVDOM>(
    `${deviceBase(deviceId)}/vdoms?vdom=`,
    "Could not read the device's virtual domains",
    opts,
  );

/**
 * Whether to offer a VDOM choice for this unit.
 *
 * Driven by multi_vdom, not by the row count. A single-VDOM firewall answers with one row named
 * "root" — a truthful answer, and not a choice: a picker with one option implies a decision nobody
 * has. A unit in multi-VDOM mode with one VDOM in it is the opposite case, and does get a picker,
 * because which tenant you are writing to is then a real question.
 */
export const unitIsSplit = (vdoms: DeviceVDOM[]): boolean => vdoms.some((v) => v.multi_vdom);

/**
 * The VDOM the device calls are actually going to, given what is selected.
 *
 * Empty means no explicit choice, and the backend's default is literally "root" — NOT the
 * management VDOM, which on an unusual unit is a different one (services.vdomParam). So the picker
 * labels root rather than guessing, and its tick lands on the entry the requests are really
 * reaching.
 */
export const effectiveVDOM = (vdom: string): string => vdom || "root";

/** The VDOM a fresh selection should land on: the management one, else the first. */
export const defaultVDOM = (vdoms: DeviceVDOM[]): string =>
  vdoms.find((v) => v.management)?.name ?? vdoms[0]?.name ?? "";

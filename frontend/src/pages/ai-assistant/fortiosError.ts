/**
 * What the firewall said no with, read as a NUMBER.
 *
 * ── The bug this replaces ────────────────────────────────────────────────────
 *
 * Apply and Fallback both have to tell one refusal apart from another, because some refusals are
 * the outcome we wanted:
 *
 *     "that name already exists"  → the object is there, carry on   (Apply, -5)
 *     "there is no such object"   → the delete already happened     (Fallback, -3 / -15 / 404)
 *     "something still points at it" → say so in words              (Fallback, -23)
 *
 * All three were written against the error TEXT:
 *
 *     /(-5\b|already exist|duplicat)/i        applyViaREST
 *     /(not found|does not exist|-3\b|-15\b|404)/i   undoApply
 *     /-23\b|used by|in use|referenced/i      undoApply
 *     /(-5\b|already exist|duplicat)/i        applySDWAN
 *
 * A FortiOS code is not a substring. It is a number inside a sentence, and the sentence quotes the
 * administrator's own input back — so every one of these matched `-5\b` with no error code
 * anywhere near it:
 *
 *     invalid value for "spoke-5"
 *     tcp-portrange 1-5
 *     attribute "name" value "branch-office-5" is invalid
 *
 * and `-3\b` / `-15\b` likewise match `VLAN-3`, `port 1-15`, `vlan-3`. The consequence is the worst
 * shape a bug can take here: a create that genuinely FAILED was read as "already there", Apply
 * reported success, and the policy that references the object that was never made was applied
 * anyway. In Fallback the mirror image — a delete that failed for an unrelated reason, reported to
 * the user as "already gone", leaving the object on a live firewall.
 *
 * The backend already keeps the code as an integer (services.DeviceError.Code, and the project's
 * own rule: compare error codes as NUMBERS). The device-proxy puts it on the error body as
 * `fortios_code`, and this module is the only place the frontend reads it.
 *
 * ── What happens when `fortios_code` is absent ───────────────────────────────
 *
 * `fortiosCode()` returns null and `isFortiOSCode()` returns FALSE. There is deliberately no
 * fallback to scanning the message: a signal that is wrong some of the time is worse here than no
 * signal, because every caller uses it to decide that a failure was secretly a success. With no
 * code, each caller therefore lands on its SAFE answer:
 *
 *     Apply     → not a duplicate → the error is rethrown and the run stops, loudly, on the object
 *                 that failed, instead of building the policy that references it.
 *     Fallback  → not gone → the object is listed as "could not remove", with the device's own
 *                 wording, instead of being crossed off a list while it is still on the firewall.
 *
 * The one non-`fortios_code` signal accepted is the HTTP status, which is a number the device
 * proxy sets deliberately (404 = the addressed object is not there). That is the status line, not
 * a phrase found in a message.
 */

/** FortiOS codes this console has to act on. Named, because a bare -5 in a condition is the bug. */
export const FG_DUPLICATE = -5;
/** A referenced name does not resolve — the object is missing, or not valid in this context. */
export const FG_NOT_IN_DATASOURCE = -3;
/** The addressed node does not exist. Seen on a by-key operation against an already-removed object. */
export const FG_NO_SUCH_NODE = -15;
/** The object cannot be deleted because something else points at it. */
export const FG_STILL_REFERENCED = -23;

/**
 * Thrown by our own code when it has established the object is not on the device — for instance a
 * static route whose sequence number is not in the device's route table any more.
 *
 * It exists so "we looked and it is not there" does not have to masquerade as a device error with
 * a message for someone to pattern-match later.
 */
export class AlreadyGoneError extends Error {
  constructor(message = "already gone from the device") {
    super(message);
    this.name = "AlreadyGoneError";
  }
}

/**
 * What this module needs off a rejected device call, and nothing more.
 *
 * `unknown` is what a `catch` block actually hands you, and these functions are called from catch
 * blocks exclusively. Declaring the shape and narrowing to it keeps every accessor below free of
 * `any` — which matters here more than it does in most places: `any` would silently accept
 * `err.response.data.fortios_cde` as a `number | null` and every duplicate check in Apply would
 * quietly answer false for ever, which is the exact failure class this file exists to end.
 *
 * Optional at every level because all of them genuinely are: a transport failure has no
 * `response`, a 502 has no `fortios_code`, and a thrown `Error` has only `message`.
 */
type DeviceCallError = {
  response?: { status?: number; data?: { error?: string; fortios_code?: unknown } };
  message?: string;
};

/** Narrow once, here, so no accessor below has to. Never throws: a null or a string is fine. */
const shape = (err: unknown): DeviceCallError => (err ?? {}) as DeviceCallError;

/** The HTTP status the device proxy answered with, when it answered at all. */
export const httpStatus = (err: unknown): number | undefined => shape(err).response?.status;

/**
 * The FortiOS error code the device proxy reported, or null when it reported none.
 *
 * Null means "we do not know what the firewall objected to" — not "no error" and never "fine".
 * A 502 (nothing answered) has no code by definition, which is correct: a device that never
 * replied has told us nothing about the object.
 */
export function fortiosCode(err: unknown): number | null {
  const raw = shape(err).response?.data?.fortios_code;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** True only when the device reported one of `codes`. Absent code ⇒ false, always. */
export function isFortiOSCode(err: unknown, ...codes: number[]): boolean {
  const code = fortiosCode(err);
  return code !== null && codes.includes(code);
}

/**
 * The name is already taken (-5), so the object we were about to create is already on the device.
 *
 * Callers use this to stay idempotent. With no code present this is false and the create failure
 * surfaces — see the note at the top of this file for why that is the right way to be wrong.
 */
export const isDuplicateError = (err: unknown): boolean => isFortiOSCode(err, FG_DUPLICATE);

/**
 * The object is already off the device, so a delete that "failed" actually reached the end state
 * we wanted.
 *
 * Three accepted signals, all of them numbers or our own typed sentinel:
 *   · -3 / -15  — the device's codes for "no such object" on a by-key operation
 *   · HTTP 404  — the device proxy's status for the same thing when it has no code to give
 *   · AlreadyGoneError — our own code looked the object up and it was not there
 */
export const isGoneError = (err: unknown): boolean =>
  err instanceof AlreadyGoneError ||
  isFortiOSCode(err, FG_NOT_IN_DATASOURCE, FG_NO_SUCH_NODE) ||
  httpStatus(err) === 404;

/** FortiGate refuses to delete an object something else still points at (-23). */
export const isStillReferencedError = (err: unknown): boolean =>
  isFortiOSCode(err, FG_STILL_REFERENCED);

/** The device's own wording for a failure, for when there is nothing better to show. */
export const deviceMessage = (err: unknown, fallback = "delete failed"): string =>
  shape(err).response?.data?.error || shape(err).message || fallback;

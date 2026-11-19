/**
 * What to show the user for something that was thrown.
 *
 * `catch (e)` gives `unknown` — anything can be thrown in JavaScript — and the three history panels
 * each reached for `e: any` to get at `.message`, which is how a codebase accumulates `any`: not
 * from laziness about types but from one small shape nobody wanted to write four times.
 *
 * DeviceRequestError already builds a sentence naming what failed and why, so its message is used
 * as-is; anything else falls back to the caller's own wording rather than printing "[object Object]"
 * or a stack trace at somebody trying to read a chart.
 */
export const errorText = (e: unknown, fallback: string): string => {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return fallback;
};

/**
 * The same question for a WRITE that went to a device.
 *
 * `errorText` above reads `Error.message`, which is right for a DeviceRequestError because that
 * class already composes a sentence. A write goes through axios directly, and the useful half is
 * the server's own line — `response.data.error`, which for a device proxy is the FortiGate's
 * refusal passed through whole ("FortiGate error: … error code -15").
 *
 * Every page that saves an object reached for `catch (e: any)` to read that path, which is the one
 * shape that keeps re-introducing `any`. It is written once here instead, with the narrowing the
 * `any` was skipping.
 */
export const apiErrorText = (e: unknown, fallback: string): string => {
  const detail = responseError(e);
  if (detail) return detail;
  return errorText(e, fallback);
};

/**
 * The server's own line, or the caller's wording — and NOTHING in between.
 *
 * This is the same question as `apiErrorText` minus one step, and the step matters. `apiErrorText`
 * falls back to `Error.message`, which is the right answer for a DeviceRequestError because that
 * class composes a sentence about the firewall. For an ordinary axios rejection it is
 * "Request failed with status code 500" — a string that tells the person nothing and displaces the
 * sentence the page author wrote for exactly this case.
 *
 * So the ~70 call sites that only ever read `response.data.error` use this one. Both exist because
 * the choice between them is a choice about what the user reads, and inlining either as `e: any`
 * made that choice invisible.
 */
export const apiErrorDetail = (e: unknown, fallback: string): string => responseError(e) || fallback;

/** The HTTP status an axios rejection carries, when it carries one. */
export const responseStatus = (e: unknown): number | undefined => {
  if (typeof e === "object" && e !== null && "response" in e) {
    const status = (e as { response?: { status?: unknown } }).response?.status;
    if (typeof status === "number") return status;
  }
  return undefined;
};

/**
 * The body a failed request came back with, as `unknown`.
 *
 * Several /auth and /admin calls answer a REFUSAL with the same JSON shape as a success — a
 * `{ error }` the form renders — so the catch block returns it rather than discarding it. Each of
 * those was reaching through `error?.response?.data` off an `any`; the caller still says what the
 * body is, which is the part only it knows.
 */
export const responseBody = (e: unknown): unknown => {
  if (typeof e === "object" && e !== null && "response" in e) {
    return (e as { response?: { data?: unknown } }).response?.data;
  }
  return undefined;
};

/**
 * `response.data.error`, when there is one and it is a non-empty string, otherwise "".
 *
 * Exported because several callers need the server's line WITHOUT a fallback — an error class
 * composing its own sentence, a rule matching on the text. Each of those was reading it off an
 * `any`.
 */
export const responseError = (e: unknown): string => {
  if (typeof e === "object" && e !== null && "response" in e) {
    const data = (e as { response?: { data?: unknown } }).response?.data;
    if (typeof data === "object" && data !== null && "error" in data) {
      const detail = (data as { error?: unknown }).error;
      if (typeof detail === "string" && detail) return detail;
    }
  }
  return "";
};

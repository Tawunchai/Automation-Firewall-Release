// ── Reading a failed request ──────────────────────────────────────────────────
//
// A rejected axios call is `unknown` as far as the language is concerned, and the two things this
// page needs off it — the server's own message and the HTTP status — are buried at different
// depths. These narrow it once, so no handler below has to reach through four optional levels by
// hand (and none of them has to be typed `any` to do it).

export type ApiError = { response?: { status?: number; data?: { error?: string } }; message?: string };

/** The server's explanation for a failure, falling back to the transport error. */
export const errorText = (err: unknown, fallback: string): string =>
  (err as ApiError)?.response?.data?.error || (err as ApiError)?.message || fallback;

/** The HTTP status of a failed request, when the server answered at all. */
export const errorStatus = (err: unknown): number | undefined =>
  (err as ApiError)?.response?.status;


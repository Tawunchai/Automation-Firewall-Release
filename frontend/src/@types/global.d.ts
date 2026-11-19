/// <reference types="vite/client" />

// ── Window events ─────────────────────────────────────────────────────────────
interface WindowEventMap {
  "session:expired": CustomEvent;
  /** Fired by AuthContext AFTER a session has been torn down. Anything holding session state in
   *  MEMORY (the AI job, the AI transcript) must drop it here — clearing storage is not enough,
   *  because a provider mounted above the router never unmounts on logout. */
  "session:ended": CustomEvent;
}

// Two generic envelope types, `ApiResponse<T>` and `PaginatedResponse<T>`, used to sit here and
// were referenced by nothing: this console's API modules each declare the exact shape their own
// endpoint returns, in src/api/, which is what makes a wrong field a compile error rather than an
// `unknown`. A global catch-all envelope invites the opposite. Declare the real shape next to the
// call instead of reviving these.

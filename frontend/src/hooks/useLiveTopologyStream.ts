import { useEffect, useRef } from "react";

// Backs both live-topology pages (single-device and fleet) once the backend push mechanism landed
// — see backend's SSE endpoints under policy/device/:id/topology-live/stream and
// fleet/topology-live/stream. N browser tabs watching the same device now share one backend-to-
// firewall poll instead of each tab triggering its own; this hook is just the browser-side plumbing
// that used to be a bare `window.setInterval` in each page.

/**
 * One EventSource subscription, with a one-shot fallback to polling.
 *
 * The fallback triggers ONLY on a connection that never delivered a single message — a proxy or
 * corporate firewall that blocks SSE outright answers with an error before the first event, and
 * retrying that same dead connection forever would be worse than the honest, if chattier, polling
 * this replaces it with. Once at least one message has arrived (ever, for the life of this
 * subscription), a later drop is left to the browser's own native EventSource auto-reconnect — a
 * plain network blip is not "the stream doesn't work here", and opening a parallel poll underneath
 * a stream that is about to heal itself on its own would double the backend's load for nothing.
 *
 * Hidden tabs close the EventSource rather than let it sit open doing nothing — the same reason the
 * polling code this replaces skipped its own tick in the background. Coming back re-opens a FRESH
 * connection; SSE has no notion of "resume where the tab left off", and both call sites only ever
 * care about the latest reading, so the first event after reopening is simply treated as the first
 * one there has ever been.
 */
export function useLiveStream<T>(opts: {
  /** Null/undefined disables the subscription entirely — e.g. no device selected yet. */
  url: string | null | undefined;
  eventName: string;
  onMessage: (data: T) => void;
  /** The exact pre-SSE behavior to fall back to: called once immediately, then on its own interval. */
  fallbackPoll: () => void;
  fallbackPollMs: number;
}): void {
  const { url, eventName, fallbackPollMs } = opts;

  // Refs so the effect below never has to re-subscribe just because a render produced a new
  // closure for these two callbacks. Kept current from their own effects (never written during
  // render itself) — the same pattern MaintenanceCountdown.tsx uses for its SSE listener.
  const onMessageRef = useRef(opts.onMessage);
  const fallbackPollRef = useRef(opts.fallbackPoll);
  useEffect(() => { onMessageRef.current = opts.onMessage; }, [opts.onMessage]);
  useEffect(() => { fallbackPollRef.current = opts.fallbackPoll; }, [opts.fallbackPoll]);

  useEffect(() => {
    if (!url) return;

    let es: EventSource | null = null;
    let fallbackTimer: number | null = null;
    let everReceived = false;
    let fellBack = false;

    const startFallback = () => {
      fellBack = true;
      // Same hidden-tab skip the pre-SSE polling effects had: the tick fires, it just does
      // nothing while the tab is in the background, rather than tearing the interval down.
      const tick = () => { if (!document.hidden) fallbackPollRef.current(); };
      tick();
      fallbackTimer = window.setInterval(tick, fallbackPollMs);
    };

    const attach = (instance: EventSource) => {
      instance.addEventListener(eventName, (ev: MessageEvent) => {
        everReceived = true;
        try {
          onMessageRef.current(JSON.parse(ev.data));
        } catch {
          // A malformed frame is the backend's bug to fix, not a reason to tear down the stream.
        }
      });
      instance.onerror = () => {
        if (everReceived) return; // already proved it works — let native auto-reconnect handle this
        instance.close();
        if (es === instance) es = null;
        startFallback();
      };
    };

    // Opens the stream if the tab is visible and nothing is open yet; closes it if the tab just
    // went hidden. Called once up front (covers the common case) and again on every
    // visibilitychange, so a tab that starts hidden never opens a connection it would immediately
    // have to tear down, either.
    const sync = () => {
      if (fellBack) return; // polling fallback already matches the original hidden-tab handling
      if (document.hidden) {
        es?.close();
        es = null;
        return;
      }
      if (!es) {
        es = new EventSource(url, { withCredentials: true });
        attach(es);
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      es?.close();
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
    };
  }, [url, eventName, fallbackPollMs]);
}

/**
 * Upserts one row into a list by key — the merge the fleet stream needs because devices tick
 * independently (their shared topics may be at different phases): each event is "update this one
 * row", never "replace the whole list", so a slower first sample for a device the page hasn't seen
 * yet must be appended rather than dropped.
 */
export function upsertById<T>(rows: T[], incoming: T, keyOf: (item: T) => number | string): T[] {
  const key = keyOf(incoming);
  const idx = rows.findIndex((r) => keyOf(r) === key);
  if (idx === -1) return [...rows, incoming];
  const next = rows.slice();
  next[idx] = incoming;
  return next;
}

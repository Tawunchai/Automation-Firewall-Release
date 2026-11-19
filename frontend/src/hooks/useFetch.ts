import { useCallback, useEffect, useRef, useState } from "react";

const FETCH_TIMEOUT_MS = 20_000;

type FetchFn<T> = (() => Promise<T | null>) | ((signal: AbortSignal) => Promise<T | null>);

type UseFetchResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export function useFetch<T>(
  fetchFn: FetchFn<T>,
  deps: unknown[] = []
): UseFetchResult<T> {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const isMountedRef  = useRef(false);
  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);
  const abortRef      = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Reset guards so a remount (e.g. React StrictMode) triggers a fresh fetch
      hasFetchedRef.current = false;
      isFetchingRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const refetch = useCallback(async () => {
    if (isFetchingRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    isFetchingRef.current = true;
    if (isMountedRef.current) { setLoading(true); setError(null); }

    // The timeout is raced against the request, so on the normal path (the request wins) the
    // timer is still pending. It MUST be cleared: an uncleared timer keeps the whole closure —
    // controller, fetchFn, the component's state setters — alive for the full 20s, and every
    // refetch adds another. Clearing it in `finally` bounds that to the one in flight.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error("AbortError"));
      }, FETCH_TIMEOUT_MS);
    });

    try {
      const call = fetchFn.length > 0
        ? (fetchFn as (signal: AbortSignal) => Promise<T | null>)(controller.signal)
        : (fetchFn as () => Promise<T | null>)();

      const result = await Promise.race([call, timeout]);
      if (isMountedRef.current && !controller.signal.aborted) setData(result);
    } catch (err: unknown) {
      if (isMountedRef.current && !controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "An error occurred";
        setError(msg === "AbortError" ? "Request timed out" : msg);
      }
    } finally {
      clearTimeout(timeoutId);
      // A request we TIMED OUT on is still in flight in the browser. Abort it, or it keeps the
      // connection and its response body alive long after we stopped caring. Only on that path:
      // aborting a request that already succeeded would be pointless, and it would also make
      // `controller.signal.aborted` true for the check below.
      if (timedOut) controller.abort();
      isFetchingRef.current = false;
      // Only clear the spinner if this fetch is still the active one — a newer refetch that has
      // already replaced us owns the loading state now.
      if (isMountedRef.current && abortRef.current === controller) setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    if (hasFetchedRef.current && deps.length === 0) return;
    hasFetchedRef.current = true;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, ...deps]);

  return { data, loading, error, refetch };
}

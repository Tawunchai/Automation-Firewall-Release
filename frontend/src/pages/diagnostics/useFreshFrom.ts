import { useState } from "react";

/**
 * The index from which rows in a growing list are new since the previous change — the rows the
 * live Ping and Trace Route pages slide in, while the ones already on screen stay still.
 *
 * It replaces a ref read during render (`const freshFrom = seenRef.current`), which React's rules
 * forbid: a ref is not part of what React tracks, so a render that reads one can show a stale value
 * and the linter rejects it (react-hooks/refs). This is the documented way to remember a value from
 * the previous render — keep it in state and update it DURING render when the input changes, which
 * React re-runs immediately without committing the stale frame.
 *
 * The result stays put until the list changes again, so a fresh row keeps its entry class exactly
 * as long as it did before and its animation plays once. A list that SHRINKS — a new run clearing
 * the old results — starts over at 0, so the first rows of the new run animate too.
 */
export function useFreshFrom(count: number): number {
  const [prev, setPrev] = useState(count);
  const [freshFrom, setFreshFrom] = useState(0);
  if (count !== prev) {
    setPrev(count);
    setFreshFrom(count > prev ? prev : 0);
  }
  return freshFrom;
}

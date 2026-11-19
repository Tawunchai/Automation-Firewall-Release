import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectedDevice } from "../contexts/DeviceContext.logic";
import type { NetworkDevice } from "../api/device";
import { errorText } from "../api/errorText";

// Reading a list off the selected FortiGate, with the one distinction that matters on this
// console: "the device says there is nothing" is NOT the same answer as "we could not ask it".
//
// Every device list page used to write this by hand, and seven of the eight got it wrong:
//
//     setLoading(true);
//     setAddresses(await DeviceListAddresses(device.id));   // lenient → [] on ANY failure
//     setLoading(false);
//
// A lenient read swallows a 404 (device deleted), a 502 (firewall unreachable) and a 401 alike and
// hands back an empty array, so an unreadable firewall rendered as "no address objects on this
// device". On a page whose whole job is to show what a firewall is enforcing, that is not a cosmetic
// bug — it is the screen telling you the opposite of the truth. Firewall Policy already carried a
// comment saying exactly this; the fix is to make every page behave the way that one does.
//
// So: the loader must read STRICTLY (`{ strict: true }`), this hook catches the resulting
// DeviceRequestError, and `deviceViewState` below turns the outcome into the block to render.

/** What a device page should be showing right now. */
export type DeviceViewState = "no-device" | "loading" | "error" | "empty" | "rows";

/**
 * The single rule the whole console follows, as a pure function so it can be pinned by one test
 * instead of re-derived in eight components.
 *
 * Order matters and is the point:
 *   · no device selected outranks everything — there is nothing to have failed yet
 *   · loading outranks a stale error, so a retry does not flash the old failure
 *   · **error outranks empty** — this is the whole bug. A read that failed must never fall
 *     through to "there is nothing here".
 */
export const deviceViewState = (o: {
  hasDevice: boolean;
  loading: boolean;
  error: unknown;
  count: number;
}): DeviceViewState => {
  if (!o.hasDevice) return "no-device";
  if (o.loading) return "loading";
  if (o.error) return "error";
  return o.count === 0 ? "empty" : "rows";
};

export type DeviceData<T> = {
  data: T;
  loading: boolean;
  /** Human-readable failure, or null. Non-null means the list below it is NOT authoritative. */
  error: string | null;
  reload: () => Promise<void>;
  device: NetworkDevice | null;
  /** Convenience: `deviceViewState` already applied, given the row count. */
  viewState: (count: number) => DeviceViewState;
};

/**
 * Loads one device-scoped resource and tracks loading/error for it.
 *
 * `load` MUST pass `{ strict: true }` to its api call — a lenient call can never reject, so this
 * hook would report success for a firewall that never answered.
 *
 * `load` is a dependency: wrap it in useCallback in the caller, exactly as the pages already do.
 */
export function useDeviceData<T>(load: (deviceId: number) => Promise<T>, fallback: T): DeviceData<T> {
  const { device } = useSelectedDevice();
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which read is the current one. Incremented before every attempt; a response whose ticket no
  // longer matches has been superseded and must not touch state.
  //
  // Without this the hook loses the race it exists to prevent. Switching devices starts a second
  // read while the first is still in flight, and the two resolve in whatever order the firewall
  // answers — not the order they were sent. Reads here take 0.3-1.1s against the lab device, and
  // the picker sits in the navbar on every page, so device A's rows landing after device B's is an
  // ordinary interaction, not a stress case. What it produces is the exact failure the strict-read
  // rule above was written to stop: the table showing one firewall's objects while the navbar names
  // another. A ref, not state — changing it must never itself cause a render.
  const readSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++readSeq.current;

    if (!device) {
      setData(fallback);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await load(device.id);
      if (seq !== readSeq.current) return; // superseded — this is a stale device's data
      setData(rows);
    } catch (err) {
      if (seq !== readSeq.current) return; // superseded — a stale failure is not this device's
      // Drop the rows as well as recording the failure: showing the PREVIOUS device's data under
      // an error banner is its own way of lying about which firewall you are looking at.
      setData(fallback);
      setError(errorText(err, "Could not read from the device"));
    } finally {
      // Only the current read owns the spinner. A superseded one clearing it would report the
      // newer read as finished while it is still in flight.
      if (seq === readSeq.current) setLoading(false);
    }
    // `fallback` is intentionally not a dependency — callers pass a literal (`[]`), which would be
    // a new identity on every render and re-fetch the device forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, load]);

  useEffect(() => { void reload(); }, [reload]);

  return {
    data,
    loading,
    error,
    reload,
    device,
    viewState: (count: number) =>
      deviceViewState({ hasDevice: !!device, loading, error, count }),
  };
}

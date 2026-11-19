import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelectedDevice } from "../contexts/DeviceContext.logic";
import type { NetworkDevice } from "../api/device";

/**
 * The firewall a create/edit page is working on: the one `?deviceId` names, resolved against the
 * inventory the app already has.
 *
 * Every one of these pages used to do this itself:
 *
 *     const [device, setDevice] = useState<NetworkDevice | null>(null);
 *     const [loadingDev, setLoadingDev] = useState(true);
 *     useEffect(() => {
 *       if (!id) { setLoadingDev(false); return; }
 *       ListDevices()
 *         .then((list) => setDevice(list.find((d) => d.id === Number(id)) ?? null))
 *         .finally(() => setLoadingDev(false));
 *     }, [id]);
 *
 * Forty-two pages, forty-two GET /devices. The whole inventory is already in DeviceContext —
 * fetched once per session for the navbar picker — so every one of those requests was asking the
 * server for a list the app was holding, and each one added a round trip in front of the form the
 * person came to fill in. Opening Addresses ▸ Create meant waiting for the device list before the
 * page could even decide whether it had a device.
 *
 * The other half of why this matters is agreement. The id in the URL and the navbar's selection
 * are two answers to "which firewall am I about to change?", and on a console that writes to live
 * firewalls that question must have one answer. Resolving the id against the same list the navbar
 * shows means a page can never be pointed at a device the picker does not list — a unit that was
 * deleted, or that is not a FortiGate and has no device-proxy behind it at all.
 *
 * `loading` is the inventory's, not a request of this page's: it is true only while the app's
 * first device fetch is in flight, so `!loading && !device` means "the id names nothing we have",
 * which is exactly when a page should say so instead of rendering a form that cannot save.
 */
export function useDeviceFromQuery(): {
  /** The device named by ?deviceId, or null — either none was named, or no such device. */
  device: NetworkDevice | null;
  /** True while the app's device inventory is still loading. */
  loading: boolean;
  /** The raw id from the query string, for the pages that start their reads from it. */
  deviceId: number | null;
} {
  const [searchParams] = useSearchParams();
  const { devices, loading } = useSelectedDevice();

  const raw = searchParams.get("deviceId");
  const deviceId = raw && Number(raw) > 0 ? Number(raw) : null;

  const device = useMemo(
    () => (deviceId == null ? null : devices.find((d) => d.id === deviceId) ?? null),
    [devices, deviceId],
  );

  return { device, loading, deviceId };
}

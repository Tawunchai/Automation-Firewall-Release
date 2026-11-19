import { useEffect, useState } from "react";
import { DeviceListAddresses, DeviceListServices, DeviceListSystemInterfaces } from "../../api/policyObject";
import { DeviceListTrafficShapers, type ShapingPolicy, type TrafficShaper } from "../../api/trafficShaper";

// Shared state for the shaping policy create page — pulled out of the old modal in index.tsx. There
// is no edit here because the device API has no update for a shaping policy (api/trafficShaper.ts
// only has create and delete) — the old modal never offered one either.

export type PolicyDraft = ShapingPolicy;

export const BLANK_POLICY: PolicyDraft = {
  id: 0, name: "", status: true, comment: "",
  srcaddr: ["all"], dstaddr: ["all"], srcintf: [], dstintf: [], service: ["ALL"],
  traffic_shaper: "", traffic_shaper_reverse: "", per_ip_shaper: "",
};

export const buildPolicyPayload = (d: PolicyDraft): ShapingPolicy => ({ ...d, name: d.name.trim() });

/** The dropdown options a shaping policy picks from: addresses, services, interfaces (best-effort —
    the policy is still creatable if one of these can't be read) and the shaper list (strict — the
    forward/reverse dropdowns are meaningless without it). */
export function usePolicyOptions(deviceId: number | null | undefined) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [shapers, setShapers] = useState<TrafficShaper[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) { setAddresses([]); setServices([]); setInterfaces([]); setShapers([]); return; }
    let live = true;
    setError(null);

    Promise.allSettled([
      DeviceListAddresses(deviceId), DeviceListServices(deviceId), DeviceListSystemInterfaces(deviceId),
    ]).then(([a, sv, i]) => {
      if (!live) return;
      setAddresses(a.status === "fulfilled" ? a.value.map((x) => x.name) : []);
      setServices(sv.status === "fulfilled" ? sv.value.map((x) => x.name) : []);
      setInterfaces(i.status === "fulfilled" ? i.value.map((x) => x.name) : []);
    });

    DeviceListTrafficShapers(deviceId, { strict: true })
      .then((s) => { if (live) setShapers(s); })
      .catch((e: unknown) => {
        if (!live) return;
        setShapers([]);
        setError(e instanceof Error ? e.message : "the shaper list could not be read");
      });

    return () => { live = false; };
  }, [deviceId]);

  return { addresses, services, interfaces, shapers, error };
}

// The pure half of route-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { useEffect, useState } from "react";
import { DeviceListRouteInterfaces, DeviceListInternetServices, type RouteInterface, type InternetService, type StaticRoute, type StaticRoutePayload } from "../../api/policyObject";

export type RouteFormState = {
  dstType: "subnet" | "internet-service";
  dst: string;                    // CIDR
  internetService: number | null;
  internetServiceName: string;
  gateway: string;
  device: string;                 // interface name, or "blackhole"
  distance: string;
  priority: string;
  enabled: boolean;
  comment: string;
};

export const BLANK_ROUTE_FORM: RouteFormState = {
  dstType: "subnet", dst: "0.0.0.0/0.0.0.0",
  internetService: null, internetServiceName: "",
  gateway: "", device: "",
  distance: "10", priority: "1",
  enabled: true, comment: "",
};

export const BLACKHOLE = "blackhole";

export function validateRouteForm(f: RouteFormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (f.dstType === "internet-service") {
    if (!f.internetService) errs.internetService = "Select an Internet Service";
    if (!f.gateway.trim()) errs.gateway = "Gateway address is required";
  } else {
    if (!f.dst.trim()) errs.dst = "Destination subnet is required";
    if (f.device !== BLACKHOLE && !f.gateway.trim()) errs.gateway = "Gateway address is required";
  }
  return errs;
}

export function buildRoutePayload(f: RouteFormState): StaticRoutePayload {
  const num = (s: string, d: number) => { const n = Number(s); return Number.isNaN(n) ? d : n; };
  const p: StaticRoutePayload = {
    dst_type: f.dstType,
    distance: num(f.distance, 10),
    priority: num(f.priority, 1),
    enabled: f.enabled,
    comment: f.comment.trim(),
  };
  if (f.dstType === "internet-service") {
    p.internet_service = f.internetService ?? 0;
    p.gateway = f.gateway.trim();
    p.device = f.device && f.device !== BLACKHOLE ? f.device : "";
  } else {
    p.dst = f.dst.trim();
    if (f.device === BLACKHOLE) {
      p.blackhole = true;
      p.device = "";
    } else {
      p.device = f.device;
      p.gateway = f.gateway.trim();
    }
  }
  return p;
}

export function routeToForm(r: StaticRoute): RouteFormState {
  return {
    ...BLANK_ROUTE_FORM,
    dstType: r.dst_type,
    dst: r.dst || "0.0.0.0/0.0.0.0",
    internetService: r.internet_service || null,
    internetServiceName: r.internet_service_name || "",
    gateway: r.gateway === "0.0.0.0" ? "" : (r.gateway || ""),
    device: r.blackhole ? BLACKHOLE : (r.device || ""),
    distance: String(r.distance ?? 10),
    priority: String(r.priority ?? 1),
    enabled: r.enabled,
    comment: r.comment || "",
  };
}

export function useRouteOptions(deviceId: number | null | undefined) {
  const [interfaces, setInterfaces] = useState<RouteInterface[]>([]);
  // Only the internet-service list drives a spinner, and it is derived from the device its contents
  // came from rather than from a flag set inside the effect — see useUserGroupOptions.
  const [svc, setSvc] = useState<{ services: InternetService[]; loadedFor: number | null }>({
    services: [],
    loadedFor: null,
  });

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceListRouteInterfaces(deviceId)
      .then((rows) => { if (alive) setInterfaces(rows); })
      .catch(() => {});
    DeviceListInternetServices(deviceId)
      .then((services) => { if (alive) setSvc({ services, loadedFor: deviceId }); })
      .catch(() => { if (alive) setSvc((s) => ({ ...s, loadedFor: deviceId })); });
    return () => { alive = false; };
  }, [deviceId]);

  return {
    interfaces,
    services: svc.services,
    loadingSvc: Boolean(deviceId) && svc.loadedFor !== deviceId,
  };
}

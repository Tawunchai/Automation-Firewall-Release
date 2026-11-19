// The pure half of create.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { useEffect, useState } from "react";
import { DeviceListInterfaces, DeviceListAddresses, DeviceListServices, DeviceGetPolicyProfiles, EMPTY_POLICY_PROFILE_OPTIONS, type DeviceInterface, type AddressObject, type ServiceObject, type DevicePolicyProfileOptions, type PolicyPayload, type PolicyAction, type LogTraffic, type FirewallPolicy } from "../../api/policyObject";

export type PolicyFormState = {
  name: string;
  srcIntf: string; dstIntf: string;
  srcAddr: string[]; dstAddr: string[];
  schedule: string; service: string[];
  action: PolicyAction;
  nat: boolean; ipPoolMode: "outgoing" | "dynamic"; poolName: string[];
  manageSourcePort: boolean; fixedPort: boolean; preserveSourcePort: boolean;
  protocolOptions: string;
  avEnabled: boolean; avProfile: string;
  webEnabled: boolean; webProfile: string;
  dnsEnabled: boolean; dnsProfile: string;
  appEnabled: boolean; appProfile: string;
  ipsEnabled: boolean; ipsProfile: string;
  fileEnabled: boolean; fileProfile: string;
  sslSshProfile: string;
  mirrorEnabled: boolean; mirrorProfile: string;
  logViolation: boolean; logAllowed: LogTraffic;
  comments: string; enabled: boolean;
  // Placement in the rule base (UI-only, applied via a move after create):
  // "" = bottom (default), "1" = top, or a 1-based position number.
  policyIndex: string;
};

export const BLANK_POLICY_FORM: PolicyFormState = {
  name: "", srcIntf: "", dstIntf: "", srcAddr: ["all"], dstAddr: ["all"],
  schedule: "always", service: ["ALL"], action: "accept",
  nat: true, ipPoolMode: "outgoing", poolName: [],
  manageSourcePort: false, fixedPort: false, preserveSourcePort: true, protocolOptions: "default",
  avEnabled: false, avProfile: "", webEnabled: false, webProfile: "",
  dnsEnabled: false, dnsProfile: "", appEnabled: false, appProfile: "",
  ipsEnabled: false, ipsProfile: "", fileEnabled: false, fileProfile: "",
  sslSshProfile: "no-inspection", mirrorEnabled: false, mirrorProfile: "",
  logViolation: false, logAllowed: "utm",
  comments: "", enabled: true,
  policyIndex: "",
};

export const SSL_PROFILES_WITHOUT_DECRYPTION = new Set(["no-inspection", "certificate-inspection"]);

export function anyProfileEnabled(f: PolicyFormState): boolean {
  return f.avEnabled || f.webEnabled || f.dnsEnabled || f.appEnabled || f.ipsEnabled || f.fileEnabled;
}

export function effectiveSSLProfile(f: PolicyFormState): string {
  const ssl = f.sslSshProfile || "no-inspection";
  if (f.action === "accept" && anyProfileEnabled(f) && (ssl === "" || ssl === "no-inspection")) {
    return "certificate-inspection";
  }
  return ssl;
}

export function buildPolicyPayload(f: PolicyFormState): PolicyPayload {
  const ssl = effectiveSSLProfile(f);
  return {
    name: f.name.trim(),
    src_intf: f.srcIntf || "any",
    dst_intf: f.dstIntf || "any",
    src_intf_list: f.srcIntf ? [f.srcIntf] : [],
    dst_intf_list: f.dstIntf ? [f.dstIntf] : [],
    src_addr: f.srcAddr,
    dst_addr: f.dstAddr,
    schedule: f.schedule,
    service: f.service,
    action: f.action,
    comments: f.comments.trim(),
    enabled: f.enabled,
    log_traffic: f.action === "deny" ? (f.logViolation ? "all" : "disable") : f.logAllowed,
    nat: f.action === "accept" ? f.nat : false,
    ippool: f.action === "accept" && f.nat && f.ipPoolMode === "dynamic",
    poolname: f.action === "accept" && f.nat && f.ipPoolMode === "dynamic" ? f.poolName : [],
    fixedport: f.action === "accept" && f.nat
      ? (f.ipPoolMode === "dynamic" ? f.preserveSourcePort : (f.manageSourcePort ? f.fixedPort : false))
      : false,
    protocol_options: f.protocolOptions,
    av_profile: f.action === "accept" && f.avEnabled ? f.avProfile : "",
    webfilter_profile: f.action === "accept" && f.webEnabled ? f.webProfile : "",
    dnsfilter_profile: f.action === "accept" && f.dnsEnabled ? f.dnsProfile : "",
    app_control: f.action === "accept" && f.appEnabled ? f.appProfile : "",
    ips_sensor: f.action === "accept" && f.ipsEnabled ? f.ipsProfile : "",
    file_filter_profile: f.action === "accept" && f.fileEnabled ? f.fileProfile : "",
    ssl_ssh_profile: f.action === "accept" ? ssl : "",
    decrypted_traffic_mirror: f.action === "accept" && f.mirrorEnabled && !SSL_PROFILES_WITHOUT_DECRYPTION.has(ssl)
      ? f.mirrorProfile : "",
  };
}

export function policyObjectToFormState(p: FirewallPolicy): PolicyFormState {
  const srcAddr = p.src_addr_list?.length ? p.src_addr_list : ["all"];
  const dstAddr = p.dst_addr_list?.length ? p.dst_addr_list : ["all"];
  const service = p.service_list?.length ? p.service_list : ["ALL"];
  const action: PolicyAction = p.action === "deny" ? "deny" : "accept";
  const log = (p.log_traffic || "utm").toLowerCase();
  return {
    ...BLANK_POLICY_FORM,
    name: p.name,
    srcIntf: p.src_intf || p.src_intf_list?.[0] || "",
    dstIntf: p.dst_intf || p.dst_intf_list?.[0] || "",
    srcAddr, dstAddr, service,
    schedule: p.schedule || "always",
    action,
    nat: !!p.nat,
    ipPoolMode: p.ippool ? "dynamic" : "outgoing",
    poolName: p.poolname ?? [],
    manageSourcePort: !!p.fixedport && !p.ippool,
    fixedPort: !!p.fixedport,
    preserveSourcePort: p.ippool ? !!p.fixedport : true,
    protocolOptions: p.protocol_options || "default",
    avEnabled: !!p.av_profile,   avProfile: p.av_profile || "",
    webEnabled: !!p.webfilter_profile, webProfile: p.webfilter_profile || "",
    dnsEnabled: !!p.dnsfilter_profile, dnsProfile: p.dnsfilter_profile || "",
    appEnabled: !!p.app_control, appProfile: p.app_control || "",
    ipsEnabled: !!p.ips_sensor,  ipsProfile: p.ips_sensor || "",
    fileEnabled: !!p.file_filter_profile, fileProfile: p.file_filter_profile || "",
    sslSshProfile: p.ssl_ssh_profile || "no-inspection",
    mirrorEnabled: !!p.decrypted_traffic_mirror, mirrorProfile: p.decrypted_traffic_mirror || "",
    logViolation: action === "deny" ? log !== "disable" : false,
    logAllowed: (log === "all" ? "all" : "utm") as LogTraffic,
    comments: p.comments || "",
    enabled: p.enabled !== false,
    policyIndex: "",
  };
}

export function checkAddressInterfaceBinding(f: PolicyFormState, addresses: AddressObject[]): Record<string, string> {
  const errs: Record<string, string> = {};
  const byName = new Map(addresses.map((a) => [a.name, a]));
  const bad = (names: string[], intf: string): string | null => {
    if (!intf || intf === "any") return null;
    for (const n of names) {
      const a = byName.get(n);
      if (a && a.interface && a.interface !== "any" && a.interface !== intf) {
        return `"${n}" is bound to interface "${a.interface}" and can't be used on "${intf}". Pick an address on ${intf} (or one with no interface), or change the interface.`;
      }
    }
    return null;
  };
  const s = bad(f.srcAddr, f.srcIntf);
  if (s) errs.srcAddr = s;
  const d = bad(f.dstAddr, f.dstIntf);
  if (d) errs.dstAddr = d;
  return errs;
}

export function validatePolicyForm(f: PolicyFormState, addresses?: AddressObject[]): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!f.name.trim()) errs.name = "Name is required";
  if (!f.srcIntf) errs.srcIntf = "Incoming interface is required";
  if (!f.dstIntf) errs.dstIntf = "Outgoing interface is required";
  if (f.srcAddr.length === 0) errs.srcAddr = "At least one source address is required";
  if (f.dstAddr.length === 0) errs.dstAddr = "At least one destination address is required";
  if (f.service.length === 0) errs.service = "At least one service is required";
  if (addresses && addresses.length) Object.assign(errs, checkAddressInterfaceBinding(f, addresses));
  return errs;
}

export function usePolicyFormOptions(deviceId: number | null | undefined) {
  const [interfaces, setInterfaces] = useState<DeviceInterface[]>([{ name: "any", alias: "", ip: "", type: "any" }]);
  const [addresses, setAddresses]   = useState<AddressObject[]>([]);
  const [services, setServices]     = useState<ServiceObject[]>([]);
  const [profiles, setProfiles]     = useState<DevicePolicyProfileOptions>(EMPTY_POLICY_PROFILE_OPTIONS);
  // Which device the profiles in hand came from. `loadingProfiles` is derived from it rather than
  // stored, so there is no synchronous state update inside the effect and no window where a slow
  // answer for a device the operator has left can clear the spinner on the one they moved to.
  // Same shape as useUserGroupOptions in ../user-auth/user-group-form.tsx.
  const [profilesFor, setProfilesFor] = useState<number | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceListInterfaces(deviceId).then((r) => { if (alive) setInterfaces(r); });
    DeviceListAddresses(deviceId).then((r) => { if (alive) setAddresses(r); });
    DeviceListServices(deviceId).then((r) => { if (alive) setServices(r); });
    DeviceGetPolicyProfiles(deviceId)
      .then((r) => { if (alive) { setProfiles(r); setProfilesFor(deviceId); } })
      .catch(() => { if (alive) setProfilesFor(deviceId); });
    return () => { alive = false; };
  }, [deviceId]);

  return {
    interfaces, addresses, services, profiles,
    loadingProfiles: Boolean(deviceId) && profilesFor !== deviceId,
  };
}

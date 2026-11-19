// The pure half of address-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { useEffect, useState } from "react";
import { DeviceListInterfaces, DeviceListSDNConnectors, type DeviceInterface, type SDNConnector, type AddressObject, type AddressPayload } from "../../api/policyObject";
import { FG_COLORS } from "../../lib/categoryColor";

export type FGAddrType =
  | "ipmask" | "iprange" | "fqdn" | "geography" | "dynamic" | "mac"
  | "wildcard-fqdn" | "interface-subnet";

export const TYPE_LABELS: Record<FGAddrType, string> = {
  "ipmask":           "Subnet",
  "iprange":          "IP Range",
  "fqdn":             "FQDN",
  "wildcard-fqdn":    "FQDN",
  "interface-subnet": "Interface Subnet",
  "geography":        "Geography",
  "dynamic":          "Dynamic",
  "mac":              "Device (MAC Address)",
};

export const ALLOW_ROUTING_TYPES: FGAddrType[] = ["ipmask", "fqdn"];

export function ifaceLabel(iface: DeviceInterface): string {
  if (iface.name === "any") return "any";
  return iface.alias ? `${iface.alias} (${iface.name})` : iface.name;
}

export type AddressFormState = {
  name: string;
  color: string;          // hex or "transparent"
  type: FGAddrType;
  subnet: string;         // ipmask / interface-subnet — CIDR or "ip mask"
  ipRange: string;        // "start-end"
  fqdn: string;
  country: string;        // ISO-2
  subType: string;        // dynamic sub-type (default "sdn")
  sdn: string;            // dynamic SDN connector name
  macAddrs: string[];     // mac
  iface: string;          // associated-interface ("any" = none)
  allowRouting: boolean;  // "Static route configuration"
  comment: string;
};

export const BLANK_ADDRESS_FORM: AddressFormState = {
  name: "", color: "transparent", type: "ipmask",
  subnet: "0.0.0.0 0.0.0.0", ipRange: "", fqdn: "", country: "",
  subType: "sdn", sdn: "", macAddrs: [""],
  iface: "any", allowRouting: false, comment: "",
};

export function splitIpRange(v: string): { start: string; end: string } {
  const parts = (v || "").split("-").map((s) => s.trim());
  return { start: parts[0] || "", end: parts[1] || "" };
}

export function validateAddressForm(f: AddressFormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!f.name.trim()) errs.name = "Name is required";
  if (f.type === "ipmask" && !f.subnet.trim()) errs.subnet = "IP/Netmask is required";
  if (f.type === "iprange") {
    const { start, end } = splitIpRange(f.ipRange);
    if (!start || !end) errs.iprange = "IP Range must be start-end (e.g. 192.168.1.1-192.168.1.100)";
  }
  if (f.type === "fqdn" && !f.fqdn.trim()) errs.fqdn = "FQDN is required";
  if (f.type === "geography" && !f.country) errs.country = "Please select a country";
  if (f.type === "dynamic" && f.subType === "sdn" && !f.sdn) errs.sdn = "Please select an SDN connector";
  return errs;
}

export function buildAddressPayload(f: AddressFormState): AddressPayload {
  const colorIndex = FG_COLORS.indexOf(f.color);
  const payload: AddressPayload = {
    name: f.name.trim(),
    type: f.type,
    comment: f.comment.trim(),
    interface: f.iface !== "any" ? f.iface : "",
    color: colorIndex > 0 ? colorIndex : 0,
  };
  switch (f.type) {
    case "ipmask":
      payload.subnet = f.subnet.trim();
      payload.allow_routing = f.allowRouting;
      break;
    case "iprange": {
      const { start, end } = splitIpRange(f.ipRange);
      payload.start_ip = start;
      payload.end_ip = end;
      break;
    }
    case "fqdn":
      // A wildcard FQDN ("*.example.com") is a normal type "fqdn" object on FortiOS.
      payload.subnet = f.fqdn.trim();
      payload.allow_routing = f.allowRouting;
      break;
    case "interface-subnet":
      payload.subnet = f.subnet.trim();
      break;
    case "geography":
      payload.country = f.country;
      break;
    case "dynamic":
      payload.sub_type = f.subType;
      if (f.subType === "sdn") { payload.sdn = f.sdn; payload.sdn_addr_type = "private"; }
      break;
    case "mac":
      payload.mac_addrs = f.macAddrs.map((m) => m.trim()).filter(Boolean);
      break;
  }
  return payload;
}

export function addressObjectToForm(a: AddressObject): AddressFormState {
  const ci = a.color ?? 0;
  const base: AddressFormState = {
    ...BLANK_ADDRESS_FORM,
    name: a.name,
    color: ci > 0 && ci < FG_COLORS.length ? FG_COLORS[ci] : "transparent",
    type: (a.type === "wildcard-fqdn" ? "fqdn" : a.type) as FGAddrType,
    subnet: "",
    iface: a.interface || "any",
    allowRouting: !!a.allow_routing,
    comment: a.comment || "",
    macAddrs: [""],
  };
  switch (a.type) {
    case "ipmask":
    case "interface-subnet":
      base.subnet = a.subnet || "";
      break;
    case "iprange":
      base.ipRange = [a.start_ip, a.end_ip].filter(Boolean).join("-");
      break;
    case "fqdn":
    case "wildcard-fqdn":
      base.fqdn = a.subnet || "";
      break;
    case "geography":
      base.country = a.country || "";
      break;
    case "dynamic":
      base.subType = a.sub_type || "sdn";
      base.sdn = a.sdn || "";
      break;
    case "mac":
      base.macAddrs = a.mac_addrs && a.mac_addrs.length ? a.mac_addrs : [""];
      break;
  }
  return base;
}

export function useAddressFormOptions(deviceId: number | null | undefined) {
  // The interface list keeps its "any" placeholder as the initial value, so the picker is never
  // empty; `loadedFor` says whether what it holds belongs to the device being asked about, which is
  // what the spinner needs — see useUserGroupOptions for why this is derived rather than a flag.
  const [ifaces, setIfaces] = useState<{ interfaces: DeviceInterface[]; loadedFor: number | null }>({
    interfaces: [{ name: "any", alias: "", ip: "", type: "any" }],
    loadedFor: null,
  });
  const [sdnConnectors, setSdnConnectors] = useState<SDNConnector[]>([]);

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceListInterfaces(deviceId)
      .then((interfaces) => { if (alive) setIfaces({ interfaces, loadedFor: deviceId }); })
      .catch(() => { if (alive) setIfaces((s) => ({ ...s, loadedFor: deviceId })); });
    DeviceListSDNConnectors(deviceId)
      .then((rows) => { if (alive) setSdnConnectors(rows); })
      .catch(() => { if (alive) setSdnConnectors([]); });
    return () => { alive = false; };
  }, [deviceId]);

  return {
    interfaces: ifaces.interfaces,
    loadingIf: Boolean(deviceId) && ifaces.loadedFor !== deviceId,
    sdnConnectors,
  };
}

export function fmtAddrCLI(addrs: AddressObject[], hostname: string): string {
  const L: string[] = [`${hostname} # show`, "config firewall address"];
  addrs.slice(0, 30).forEach((a) => {
    L.push(`    edit "${a.name}"`);
    if (a.type && a.type !== "ipmask") L.push(`        set type ${a.type}`);
    if (a.type === "ipmask" && a.subnet)   L.push(`        set subnet ${a.subnet}`);
    if (a.type === "iprange") { if (a.start_ip) L.push(`        set start-ip ${a.start_ip}`); if (a.end_ip) L.push(`        set end-ip ${a.end_ip}`); }
    if (a.type === "fqdn" && a.subnet)     L.push(`        set fqdn "${a.subnet}"`);
    if (a.type === "geography" && a.country) L.push(`        set country ${a.country}`);
    if (a.type === "dynamic") {
      if (a.sub_type) L.push(`        set sub-type ${a.sub_type}`);
      if (a.sdn)      L.push(`        set sdn "${a.sdn}"`);
    }
    if (a.type === "mac" && Array.isArray(a.mac_addrs)) a.mac_addrs.forEach((m: string) => m && L.push(`        set macaddr "${m}"`));
    if (a.interface && a.interface !== "any") L.push(`        set associated-interface "${a.interface}"`);
    if (a.allow_routing) L.push(`        set allow-routing enable`);
    if (a.comment) L.push(`        set comment "${a.comment}"`);
    L.push("    next");
  });
  L.push("end");
  return L.join("\n");
}

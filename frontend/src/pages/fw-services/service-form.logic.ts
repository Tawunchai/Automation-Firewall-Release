// The pure half of service-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type ServiceObject, type ServiceProtocol, type ServiceCategory, type ServicePayload } from "../../api/policyObject";
import { FG_COLORS } from "../../lib/categoryColor";

export type PortProtocol = "TCP" | "UDP" | "SCTP";

export type AddressMode  = "iprange" | "fqdn";

export type PortEntry    = {
  id: number;
  protocol: PortProtocol;
  low: string; high: string;
  srcLow: string; srcHigh: string; // source port (used when srcEnabled)
};

export type ServiceWritePayload = ServicePayload & { fqdn?: string; iprange?: string };

export let nextId = 1;

export const uid = () => nextId++;

export const emptyPortEntry = (): PortEntry => ({ id: uid(), protocol: "TCP", low: "", high: "", srcLow: "", srcHigh: "" });

export type ServiceFormState = {
  name: string;
  comments: string;
  color: string;              // hex or "transparent"
  category: ServiceCategory;
  protocol: ServiceProtocol;  // TCP/UDP/SCTP | IP | ICMP | ICMPv6
  addrMode: AddressMode;      // iprange | fqdn (TCP/UDP/SCTP address restriction)
  addrVal: string;
  destPorts: PortEntry[];
  srcEnabled: boolean;
  ipProto: number;            // IP protocol number
  icmpType: number;           // -1 = any
  icmpCode: number;           // -1 = any
};

export function blankServiceForm(): ServiceFormState {
  return {
    name: "", comments: "", color: "transparent", category: "Uncategorized",
    protocol: "TCP/UDP/SCTP", addrMode: "iprange", addrVal: "0.0.0.0",
    destPorts: [emptyPortEntry()], srcEnabled: false,
    ipProto: 0, icmpType: -1, icmpCode: -1,
  };
}

export function buildPortStr(entries: PortEntry[], proto: PortProtocol, srcEnabled: boolean): string {
  return entries.filter((r) => r.protocol === proto && r.low)
    .map((r) => {
      const dst = r.high && r.high !== r.low ? `${r.low}-${r.high}` : r.low;
      if (srcEnabled && r.srcLow) {
        const src = r.srcHigh && r.srcHigh !== r.srcLow ? `${r.srcLow}-${r.srcHigh}` : r.srcLow;
        return `${dst}:${src}`;
      }
      return dst;
    })
    .join(" ");
}

export function parsePortsIntoEntries(
  tcpPorts: string, udpPorts: string, sctpPorts: string,
): { entries: PortEntry[]; srcEnabled: boolean } {
  let srcEnabled = false;
  const entries: PortEntry[] = [];

  const parseSingle = (portStr: string, protocol: PortProtocol) => {
    if (!portStr.trim()) return;
    portStr.trim().split(/\s+/).forEach((part) => {
      const colonIdx = part.indexOf(":");
      let dstStr = part;
      let srcStr = "";
      if (colonIdx !== -1) {
        dstStr = part.substring(0, colonIdx);
        srcStr = part.substring(colonIdx + 1);
        if (srcStr) srcEnabled = true;
      }
      const dashIdx = dstStr.indexOf("-");
      const low  = dashIdx !== -1 ? dstStr.substring(0, dashIdx) : dstStr;
      const high = dashIdx !== -1 ? dstStr.substring(dashIdx + 1) : "";
      let srcLow = "", srcHigh = "";
      if (srcStr) {
        const srcDash = srcStr.indexOf("-");
        srcLow  = srcDash !== -1 ? srcStr.substring(0, srcDash) : srcStr;
        srcHigh = srcDash !== -1 ? srcStr.substring(srcDash + 1) : "";
      }
      entries.push({ id: uid(), protocol, low, high, srcLow, srcHigh });
    });
  };

  parseSingle(tcpPorts, "TCP");
  parseSingle(udpPorts, "UDP");
  parseSingle(sctpPorts, "SCTP");

  return {
    entries: entries.length > 0 ? entries : [emptyPortEntry()],
    srcEnabled,
  };
}

export function validateServiceForm(f: ServiceFormState): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!f.name.trim()) errs.name = "Name is required";
  if (f.protocol === "TCP/UDP/SCTP" && !f.destPorts.some((r) => r.low)) errs.dest = "At least one port is required";
  if (f.protocol === "IP" && (f.ipProto < 0 || f.ipProto > 255)) errs.ipProto = "Protocol number must be 0–255";
  return errs;
}

export function buildServicePayload(f: ServiceFormState): ServiceWritePayload {
  const colorIndex = FG_COLORS.indexOf(f.color);
  const payload: ServiceWritePayload = {
    name: f.name.trim(),
    protocol: f.protocol,
    category: f.category,
    comment: f.comments.trim(),
    color: colorIndex > 0 ? colorIndex : 0,
  };
  if (f.protocol === "TCP/UDP/SCTP") {
    payload.tcp_ports  = buildPortStr(f.destPorts, "TCP", f.srcEnabled);
    payload.udp_ports  = buildPortStr(f.destPorts, "UDP", f.srcEnabled);
    payload.sctp_ports = buildPortStr(f.destPorts, "SCTP", f.srcEnabled);
    const addr = f.addrVal.trim();
    if (f.addrMode === "fqdn" && addr) payload.fqdn = addr;
    else if (f.addrMode === "iprange" && addr && addr !== "0.0.0.0") payload.iprange = addr;
  } else if (f.protocol === "IP") {
    payload.ip_proto = f.ipProto;
  } else {
    payload.icmp_type = f.icmpType;
    payload.icmp_code = f.icmpCode;
  }
  return payload;
}

export function serviceObjectToForm(s: ServiceObject): ServiceFormState {
  const f = blankServiceForm();
  f.name = s.name;
  f.comments = s.comment || "";
  f.category = (s.category as ServiceCategory) || "Uncategorized";
  f.protocol = s.protocol as ServiceProtocol;

  const ci = s.color ?? 0;
  f.color = ci > 0 && ci < FG_COLORS.length ? FG_COLORS[ci] : "transparent";

  if (s.protocol === "IP") {
    f.ipProto = s.ip_proto ?? 0;
  } else if (s.protocol === "ICMP" || s.protocol === "ICMPv6") {
    f.icmpType = s.icmp_type ?? -1;
    f.icmpCode = s.icmp_code ?? -1;
  } else {
    const { entries, srcEnabled } = parsePortsIntoEntries(s.tcp_ports || "", s.udp_ports || "", s.sctp_ports || "");
    f.destPorts = entries;
    f.srcEnabled = srcEnabled;
    const ipfqdn = s.ip_fqdn || "";
    if (ipfqdn && ipfqdn !== "0.0.0.0") {
      f.addrMode = /[a-zA-Z*]/.test(ipfqdn) ? "fqdn" : "iprange";
      f.addrVal = ipfqdn;
    }
  }
  return f;
}

export function fmtSvcCLI(services: ServiceObject[], hostname: string): string {
  const L: string[] = [`${hostname} (custom) # show`, "config firewall service custom"];
  services.forEach((s) => {
    L.push(`    edit "${s.name}"`);
    if (s.category)   L.push(`        set category "${s.category}"`);
    if (s.tcp_ports)  L.push(`        set tcp-portrange ${s.tcp_ports}`);
    if (s.udp_ports)  L.push(`        set udp-portrange ${s.udp_ports}`);
    if (s.sctp_ports) L.push(`        set sctp-portrange ${s.sctp_ports}`);
    if (s.protocol === "IP") { L.push(`        set protocol IP`); L.push(`        set protocol-number ${s.ip_proto}`); }
    if (s.protocol === "ICMP" || s.protocol === "ICMPv6") {
      L.push(`        set protocol ${s.protocol}`);
      if ((s.icmp_type ?? -1) >= 0) L.push(`        set icmptype ${s.icmp_type}`);
      if ((s.icmp_code ?? -1) >= 0) L.push(`        set icmpcode ${s.icmp_code}`);
    }
    L.push("    next");
  });
  L.push("end");
  return L.join("\n");
}

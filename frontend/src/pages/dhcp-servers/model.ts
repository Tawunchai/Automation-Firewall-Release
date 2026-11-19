import type { DHCPServer, DHCPServerPayload, DHCPRange, DHCPReservation } from "../../api/dhcp";

// The rules the DHCP page needs, kept out of the component so they can be tested rather than
// clicked through. Every one of them is about a form that would otherwise produce a server the
// device accepts and nobody gets an address from.

/** A row in the form. Ranges arrive with a device-assigned id; a new row has none. */
export type RangeDraft = { id?: number; start_ip: string; end_ip: string };
export type ReservationDraft = { id?: number; mac: string; ip: string; action: string; description: string };

export type DHCPDraft = {
  enabled: boolean;
  interface: string;
  ip_ranges: RangeDraft[];
  exclude_ranges: RangeDraft[];
  netmask: string;
  default_gateway: string;
  dns_service: string;
  dns_servers: string[];
  ntp_service: string;
  ntp_servers: string[];
  lease_time: number;
  domain: string;
  reservations: ReservationDraft[];
};

export const BLANK_DRAFT: DHCPDraft = {
  enabled: true,
  interface: "",
  ip_ranges: [{ start_ip: "", end_ip: "" }],
  exclude_ranges: [],
  netmask: "255.255.255.0",
  default_gateway: "",
  dns_service: "default",
  dns_servers: [],
  ntp_service: "default",
  ntp_servers: [],
  lease_time: 604800,
  domain: "",
  reservations: [],
};

const toDrafts = (rs: DHCPRange[]): RangeDraft[] =>
  rs.map((r) => ({ id: r.id, start_ip: r.start_ip, end_ip: r.end_ip }));

const toResDrafts = (rs: DHCPReservation[]): ReservationDraft[] =>
  rs.map((r) => ({ id: r.id, mac: r.mac, ip: r.ip, action: r.action, description: r.description }));

/** Fills the form from a server the device is running. */
export const draftFrom = (s: DHCPServer): DHCPDraft => ({
  enabled: s.status,
  interface: s.interface,
  // A server with no ranges cannot be edited into having one without a row to type in.
  ip_ranges: s.ip_ranges.length ? toDrafts(s.ip_ranges) : [{ start_ip: "", end_ip: "" }],
  exclude_ranges: toDrafts(s.exclude_ranges),
  netmask: s.netmask,
  default_gateway: s.default_gateway,
  dns_service: s.dns_service || "default",
  dns_servers: [...s.dns_servers],
  ntp_service: s.ntp_service || "default",
  ntp_servers: [...s.ntp_servers],
  lease_time: s.lease_time,
  domain: s.domain,
  reservations: toResDrafts(s.reservations),
});

const cleanRanges = (rs: RangeDraft[]) =>
  rs
    .filter((r) => r.start_ip.trim() !== "" || r.end_ip.trim() !== "")
    .map((r) => ({ id: r.id, start_ip: r.start_ip.trim(), end_ip: r.end_ip.trim() }));

export const buildPayload = (d: DHCPDraft): DHCPServerPayload => ({
  enabled: d.enabled,
  interface: d.interface,
  ip_ranges: cleanRanges(d.ip_ranges),
  exclude_ranges: cleanRanges(d.exclude_ranges),
  netmask: d.netmask.trim(),
  default_gateway: d.default_gateway.trim(),
  dns_service: d.dns_service,
  dns_servers: d.dns_servers.map((s) => s.trim()).filter(Boolean),
  ntp_service: d.ntp_service,
  ntp_servers: d.ntp_servers.map((s) => s.trim()).filter(Boolean),
  lease_time: d.lease_time,
  domain: d.domain.trim(),
  reservations: d.reservations
    .filter((r) => r.mac.trim() !== "")
    .map((r) => ({
      id: r.id,
      mac: r.mac.trim(),
      ip: r.ip.trim(),
      action: r.action,
      description: r.description.trim(),
    })),
});

/** Parses a dotted quad, or null. */
export const parseIP = (s: string): number | null => {
  const parts = s.trim().split(".");
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = v * 256 + n;
  }
  return v;
};

/**
 * Why the form validates at all: FortiOS accepts a DHCP server with no range and one whose range
 * runs backwards. Both answer 200, hand out no leases, and look exactly like a working server.
 *
 * The backend repeats these checks — it has to, because it is a public endpoint — and this copy
 * exists so the operator hears about it before the round trip, next to the field that is wrong.
 */
export const validateDraft = (d: DHCPDraft): string | null => {
  if (!d.interface.trim()) return "Choose the interface this server serves.";

  const ranges = cleanRanges(d.ip_ranges);
  if (ranges.length === 0) return "Add at least one address range — a server with none hands out nothing.";
  for (const r of ranges) {
    if (!r.start_ip || !r.end_ip) return "Every address range needs both a start and an end address.";
    const a = parseIP(r.start_ip);
    const b = parseIP(r.end_ip);
    if (a === null) return `"${r.start_ip}" is not an IPv4 address.`;
    if (b === null) return `"${r.end_ip}" is not an IPv4 address.`;
    // Numeric, not textual: "192.168.1.9" sorts after "192.168.1.10" as a string.
    if (a > b) return `The range ${r.start_ip} – ${r.end_ip} ends before it starts.`;
  }

  for (const r of cleanRanges(d.exclude_ranges)) {
    if (!r.start_ip || !r.end_ip) return "Every excluded range needs both a start and an end address.";
    const a = parseIP(r.start_ip);
    const b = parseIP(r.end_ip);
    if (a === null || b === null) return "An excluded range contains something that is not an IPv4 address.";
    if (a > b) return `The excluded range ${r.start_ip} – ${r.end_ip} ends before it starts.`;
  }

  if (!d.netmask.trim()) return "A netmask is required.";
  if (parseIP(d.netmask) === null) return `"${d.netmask}" is not a netmask.`;
  if (d.default_gateway.trim() && parseIP(d.default_gateway) === null) {
    return `"${d.default_gateway}" is not an IPv4 address.`;
  }

  if (d.dns_service === "specify" && d.dns_servers.filter((s) => s.trim()).length === 0) {
    return "DNS mode Specify needs at least one DNS server.";
  }
  for (const s of d.dns_servers.filter((x) => x.trim())) {
    if (parseIP(s) === null) return `"${s}" is not an IPv4 address.`;
  }

  for (const r of d.reservations.filter((x) => x.mac.trim())) {
    if (!/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(r.mac.trim())) {
      return `"${r.mac}" is not a MAC address — the device wants aa:bb:cc:dd:ee:ff.`;
    }
    if (r.action !== "block" && parseIP(r.ip) === null) {
      return `The reservation for ${r.mac} needs an IPv4 address.`;
    }
  }
  return null;
};

/**
 * Whether clearing the domain is about to be attempted.
 *
 * FortiOS 7.2.10 accepts the write and keeps the old domain — probed on the lab FGT80E with an
 * empty string, a space and a null. The backend refuses the edit outright rather than reporting a
 * success that did not happen; this says so in the form, before the operator submits.
 */
export const clearingDomain = (original: DHCPServer | null, d: DHCPDraft): boolean =>
  !!original && original.domain.trim() !== "" && d.domain.trim() === "";

/** "7 days", "1 hour", "30 minutes" — a lease time an operator can read at a glance. */
export const describeLease = (seconds: number): string => {
  if (seconds <= 0) return "—";
  const units: Array<[number, string]> = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds % size === 0 && seconds >= size) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
};

/** The one-line summary under a server's interface name in the list. */
export const describeServer = (s: DHCPServer): string => {
  const range = s.ip_ranges.length
    ? s.ip_ranges.map((r) => `${r.start_ip} – ${r.end_ip}`).join(", ")
    : "no address range";
  const gw = s.default_gateway ? ` · gateway ${s.default_gateway}` : "";
  return `${range}${gw} · lease ${describeLease(s.lease_time)}`;
};

/** What the DNS row should say — the mode decides whether the addresses mean anything. */
export const describeDNS = (s: Pick<DHCPServer, "dns_service" | "dns_servers">): string => {
  if (s.dns_service === "local") return "The FortiGate itself";
  if (s.dns_service === "specify") {
    return s.dns_servers.length ? s.dns_servers.join(", ") : "Specify — but no server is set";
  }
  return "Same as the system DNS";
};

/**
 * A server this form would damage rather than edit.
 *
 * A server whose ip_mode is `usrgrp`, or whose server_type is `ipsec`, takes its addresses from
 * somewhere this form does not edit — writing it back through this form's payload would rewrite it
 * into a plain range server. The list disables Edit for these; the edit page checks it again in
 * case the row was reached directly by URL.
 */
export const isBeyondThisForm = (s: Pick<DHCPServer, "ip_mode" | "server_type">): boolean =>
  s.ip_mode === "usrgrp" || s.server_type === "ipsec";

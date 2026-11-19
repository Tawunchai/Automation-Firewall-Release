// Diagnostics — the tools under the sidebar's Diagnostics section.
//
// Ping and traceroute are NOT here: they run over a WebSocket so their output appears as the
// firewall produces it (see pages/diagnostics/diagStream.ts). Their result TYPES still live here,
// because the stream's closing event carries exactly these shapes — the backend finishes a live run
// by parsing the whole output with the same parser the batch endpoints used.
//
// Everything here is STRICT: a diagnostic that fails must say so. These pages exist to answer
// "is it working?", and a silent empty result is the one answer they must never invent — it would
// read as "the firewall cannot reach anything", which is a very different thing from "we could not
// ask it".

import { baseApi } from "./http";

// ── Ping ──────────────────────────────────────────────────────────────────────

export type PingReply = { seq: number; ttl: number; time_ms: number; bytes: number };

export type PingResult = {
  target: string;
  /**
   * What the target resolved to. FortiOS prints it on the PING line, and since this firmware has
   * no `execute nslookup` at all, pinging a name is also how this console answers "what does this
   * hostname resolve to, from the firewall?".
   */
  resolved_ip?: string;
  replies: PingReply[];
  transmitted: number;
  received: number;
  loss_percent: number;
  min_ms: number;
  avg_ms: number;
  max_ms: number;
  /** The device answered, and every packet was lost. Distinct from "the device did not answer". */
  all_lost: boolean;
  /** The device's own output, shown verbatim under the summary. */
  raw: string;
};

// ── Traceroute ────────────────────────────────────────────────────────────────

export type TraceHop = {
  hop: number;
  ip?: string;
  hostname?: string;
  /** One entry per probe that answered — a hop can answer some probes and time out on others. */
  rtts: number[];
  timeouts: number;
};

export type TracerouteResult = {
  target: string;
  resolved_ip?: string;
  hops: TraceHop[];
  raw: string;
};

// ── Hop detail ("where is this hop?") ──────────────────────────────────────────
// Computed locally on the backend — reverse DNS + address kind + any role the IP plays on networks
// this console already knows (the selected device's interfaces/routes, or a fleet device's mgmt IP).
// No third-party geolocation: nothing about the hop leaves the box.

/** Offline geolocation + ASN of a public hop, from a local GeoLite2 DB. Absent when not installed. */
export type HopGeo = {
  country?: string;
  country_code?: string;
  city?: string;
  lat?: number;
  lon?: number;
  asn?: number;
  org?: string;
};

export type HopInfo = {
  ip: string;
  rdns?: string;
  /** public | private | cgnat | loopback | link-local | multicast | unspecified | reserved | unknown */
  kind: string;
  kind_label: string;
  /** Roles this IP plays on networks the console knows — may be empty for a public hop out on the internet. */
  internal: string[];
  /** Present only for public hops when a local GeoLite2 database is installed. */
  geo?: HopGeo;
};

export const DeviceLookupIpInfo = async (deviceId: number, ip: string): Promise<HopInfo> => {
  const res = await baseApi.get<HopInfo>(`/policy/device/${deviceId}/ip-info`, { params: { ip } });
  return res.data;
};

/**
 * Kind + geo/ASN for a whole traceroute at once, from one call — the batch, geo-only sibling of
 * DeviceLookupIpInfo. Trace Route uses it to colour the path by who owns each segment and to show a
 * flag inline without expanding each hop. No reverse DNS and no internal-role cross-reference here —
 * that detail stays on the per-hop ip-info call, fetched when a hop is opened.
 */
export type HopGeoEntry = { ip: string; kind: string; kind_label: string; geo?: HopGeo };
export type HopGeoBatch = { enabled: boolean; ips: Record<string, HopGeoEntry> };

export const DeviceLookupIpGeoBatch = async (deviceId: number, ips: string[]): Promise<HopGeoBatch> => {
  if (ips.length === 0) return { enabled: false, ips: {} };
  const res = await baseApi.get<HopGeoBatch>(`/policy/device/${deviceId}/ip-geo`, {
    params: { ips: ips.join(",") },
  });
  return res.data;
};

/**
 * Address kind, computed in the browser — a pure mirror of the backend's `services.ClassifyIP`, so
 * each hop can show its kind inline the moment it arrives, with no round-trip. The backend call
 * (DeviceLookupIpInfo) still provides the rest on demand (rDNS, internal role, geo). IPv4 only, which
 * is what this firmware's traceroute emits.
 */
export const classifyHopKind = (ip: string): { kind: string; label: string } => {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return { kind: "unknown", label: "Unknown" };
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  if (o.some((n) => n > 255)) return { kind: "unknown", label: "Unknown" };
  const [a, b] = o;
  if (a === 0) return { kind: "unspecified", label: "Unspecified address" };
  if (a === 127) return { kind: "loopback", label: "Loopback" };
  if (a === 169 && b === 254) return { kind: "link-local", label: "Link-local" };
  if (a >= 224 && a <= 239) return { kind: "multicast", label: "Multicast" };
  if (a === 100 && b >= 64 && b <= 127) return { kind: "cgnat", label: "Carrier-grade NAT (100.64.0.0/10)" };
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return { kind: "private", label: "Private (RFC 1918)" };
  }
  return { kind: "public", label: "Public — routable on the internet" };
};

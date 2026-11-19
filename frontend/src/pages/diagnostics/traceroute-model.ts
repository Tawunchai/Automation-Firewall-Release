// The pure brains behind Trace Route — kept out of the .tsx so it can be unit-tested and so the page
// module exports only its component (react-refresh/only-export-components, the same reason
// diagFormat.ts exists). Three jobs, all from data the page already has:
//
//   diagnoseTrace   E — one sentence that says whether the packet arrived, and teaches that a run of
//                   "* * *" at the end is almost never a fault.
//   buildSegments   D — groups the hops into the networks they cross (by ASN/owner when a GeoLite2
//                   database is installed, by address kind otherwise), so the path reads as a journey
//                   across owners rather than a column of addresses.
//   latency helpers C — the per-hop averages and the single biggest jump, for the latency chart.

import { classifyHopKind, type TraceHop, type HopGeoEntry } from "../../api/diagnostics";

/** The average of the probes that came back, or null when the hop answered none. */
export const hopAvg = (h: TraceHop): number | null => {
  if (h.rtts.length === 0) return null;
  return h.rtts.reduce((a, b) => a + b, 0) / h.rtts.length;
};

/** A 2-letter ISO country code → its flag emoji (regional indicator symbols). "" when not a code. */
export const flagEmoji = (cc?: string): string => {
  if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return "";
  const base = 0x1f1e6;
  const up = cc.toUpperCase();
  return String.fromCodePoint(base + up.charCodeAt(0) - 65, base + up.charCodeAt(1) - 65);
};

// ── E · Auto-diagnosis ──────────────────────────────────────────────────────────

export type TraceVerdict = {
  tone: "ok" | "warn" | "danger";
  title: string;
  detail: string;
};

/** The last hop that actually replied (has an IP and at least one RTT), or null. */
const lastReplying = (hops: TraceHop[]): TraceHop | null => {
  for (let i = hops.length - 1; i >= 0; i--) {
    if (hops[i].ip && hopAvg(hops[i]) !== null) return hops[i];
  }
  return null;
};

/** How many hops at the very end answered nothing — the trailing run of "* * *". */
const trailingSilent = (hops: TraceHop[]): number => {
  let n = 0;
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!hops[i].ip && hopAvg(hops[i]) === null) n++;
    else break;
  }
  return n;
};

/**
 * Turn a finished traceroute into a verdict. Returns null while the run is still going (there is no
 * answer yet) or before it has started. `destination` is the resolved address the path was aimed at.
 */
export function diagnoseTrace(hops: TraceHop[], destination: string, done: boolean): TraceVerdict | null {
  if (!done || hops.length === 0) return null;

  const dest = destination.trim();
  const reachedHop = dest ? hops.find((h) => h.ip === dest) : undefined;
  if (reachedHop) {
    const ms = hopAvg(reachedHop);
    return {
      tone: "ok",
      title: `Reached ${dest} in ${reachedHop.hop} ${reachedHop.hop === 1 ? "hop" : "hops"}`,
      detail: ms !== null
        ? `Round trip at the destination: ${ms.toFixed(1)} ms.`
        : "The destination is on the path, though it did not time a round trip on this probe.",
    };
  }

  const last = lastReplying(hops);
  if (!last) {
    return {
      tone: "danger",
      title: "No hop answered",
      detail: "Not even the first hop replied. The device may have no route toward this destination, "
        + "or the source address given is not one it owns — try leaving Source IP blank, or use the Ping tab.",
    };
  }

  const silent = trailingSilent(hops);
  const where = last.hostname ? `${last.ip} (${last.hostname})` : last.ip;
  return {
    tone: "warn",
    title: `The path stops answering after hop ${last.hop}`,
    detail: `The last hop to reply was ${where}. `
      + (silent > 0
        ? `The ${silent} silent ${silent === 1 ? "hop" : "hops"} after it (shown as * * *) usually mean a router that does not send ICMP time-exceeded, or a firewall near the destination dropping probes — it is rarely a fault on your side, and ${dest || "the destination"} may still be reachable. Confirm with the Ping tab.`
        : `It did not reach ${dest || "the destination"} within the probed hops. The destination may still answer a direct ping — check the Ping tab.`),
  };
}

// ── D · Path segments (who owns each stretch of the path) ─────────────────────────

export type PathSegment = {
  /** The zone this stretch belongs to, for display. */
  label: string;
  /** "as" (owner-based), an address kind ("public"/"private"/…), or "silent". Drives the tint. */
  kind: string;
  asn?: number;
  countryCode?: string;
  /** Hop numbers this segment spans (inclusive), and how many hops it holds. */
  fromHop: number;
  toHop: number;
  count: number;
};

/** A short, display-ready label for an address kind used as a zone. */
export function zoneLabelForKind(kind: string): string {
  switch (kind) {
    case "public": return "Public internet";
    case "private": return "Private network";
    case "cgnat": return "Carrier-grade NAT";
    case "loopback": return "Loopback";
    case "link-local": return "Link-local";
    case "multicast": return "Multicast";
    case "unspecified": return "Unspecified";
    default: return "Unknown";
  }
}

/** Trim an ASN org name to something that fits a chip without dominating the row. */
const shortOrg = (org?: string): string => {
  if (!org) return "";
  const s = org.trim();
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
};

/**
 * Group consecutive hops into the networks they cross. A hop's zone is its ASN/owner when a GeoLite2
 * lookup supplied one, otherwise its address kind; a hop that answered nothing is its own "No reply"
 * zone, because "we crossed something that will not identify itself" is part of the story. Adjacent
 * hops in the same zone merge, so a 30-hop trace reads as a handful of owners.
 */
export function buildSegments(hops: TraceHop[], geo: Record<string, HopGeoEntry>): PathSegment[] {
  type Seg = PathSegment & { _key: string };
  const segs: Seg[] = [];
  for (const h of hops) {
    const g = h.ip ? geo[h.ip] : undefined;
    const kind = h.ip ? classifyHopKind(h.ip).kind : "silent";
    const asn = g?.geo?.asn;
    // The merge key: same owner (ASN) stays one segment even across different IPs; without an ASN,
    // same address kind merges; silent hops merge with each other.
    const key = !h.ip ? "silent" : asn ? `as:${asn}` : `kind:${kind}`;

    const label = !h.ip
      ? "No reply"
      : asn
        ? `AS${asn}${g?.geo?.org ? ` ${shortOrg(g.geo.org)}` : ""}`
        : zoneLabelForKind(kind);

    const prev = segs[segs.length - 1];
    if (prev && prev._key === key) {
      prev.toHop = h.hop;
      prev.count++;
      // Fill in a country code once one is known for the segment.
      if (!prev.countryCode && g?.geo?.country_code) prev.countryCode = g.geo.country_code;
    } else {
      segs.push({
        label,
        kind: !h.ip ? "silent" : asn ? "as" : kind,
        asn,
        countryCode: g?.geo?.country_code,
        fromHop: h.hop,
        toHop: h.hop,
        count: 1,
        _key: key,
      });
    }
  }
  // Drop the private-helper key before handing the list out.
  return segs.map(({ _key, ...s }) => { void _key; return s; });
}

// ── C · Latency chart helpers ─────────────────────────────────────────────────────

export type LatencyPoint = { hop: number; ms: number | null; ip?: string };

/** One point per hop, in order — null ms where the hop was silent (the line breaks there). */
export function latencyPoints(hops: TraceHop[]): LatencyPoint[] {
  return hops.map((h) => ({ hop: h.hop, ms: hopAvg(h), ip: h.ip }));
}

/**
 * The index (into the points array) of the hop with the largest increase in latency over the previous
 * answering hop, and by how much — the "it gets slow here" marker. null when fewer than two hops
 * answered or no increase is meaningful.
 */
export function biggestJump(points: LatencyPoint[]): { index: number; delta: number } | null {
  let best: { index: number; delta: number } | null = null;
  let prev: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const ms = points[i].ms;
    if (ms === null) continue;
    if (prev !== null) {
      const delta = ms - prev;
      if (delta > 0 && (!best || delta > best.delta)) best = { index: i, delta };
    }
    prev = ms;
  }
  // A sub-millisecond wobble is noise, not a finding.
  return best && best.delta >= 1 ? best : null;
}

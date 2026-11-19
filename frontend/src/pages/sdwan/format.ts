import type { SDWANMember } from "../../api/policyObject";

// The numbers behind the SD-WAN Zones charts, kept pure so the rules they follow can be pinned by
// tests instead of re-derived by eye on a device that has no SD-WAN configured.
//
// One rule runs through all of it: **absent is not zero.** The device reports a member's counters
// only when it knows them, and a bar drawn at 0 for "the firewall did not say" claims a measurement
// nobody made. Every builder below therefore drops members with no value rather than flooring them,
// and a chart with nothing left renders the "No results" state the real GUI shows.

/** One bar of a chart. */
export type ChartDatum = {
  label: string;
  value: number;
  /** Preformatted for the axis/tooltip, so the chart never re-invents the unit. */
  display: string;
};

export type ChartTab = "bandwidth" | "volume" | "sessions";

/**
 * Bytes in the units the FortiGate GUI uses.
 *
 * Deliberately decimal (kB = 1000) rather than binary: that is what the device's own charts print,
 * and two consoles disagreeing about the size of the same transfer is worse than either convention.
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ["kB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
};

/** Bits per second, as a link rate is conventionally quoted. */
export const formatBps = (bps: number): string => {
  if (!Number.isFinite(bps) || bps < 0) return "—";
  if (bps < 1000) return `${Math.round(bps)} bps`;
  const units = ["kbps", "Mbps", "Gbps", "Tbps"];
  let v = bps / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
};

/** A member's label on a chart: the interface is what the GUI names, not the sequence number. */
export const memberLabel = (m: SDWANMember): string => m.interface || `#${m.seq_num}`;

type Pick = (m: SDWANMember) => number | undefined;

const build = (members: SDWANMember[], pick: Pick, fmt: (n: number) => string): ChartDatum[] =>
  members
    .map((m) => ({ m, value: pick(m) }))
    .filter((r): r is { m: SDWANMember; value: number } =>
      typeof r.value === "number" && Number.isFinite(r.value))
    .map(({ m, value }) => ({ label: memberLabel(m), value, display: fmt(value) }))
    // Biggest first, the way the device's own charts rank them.
    .sort((a, b) => b.value - a.value);

/** Bandwidth tab — Download / Upload, from the rate the backend measured between two polls. */
export const downloadSeries = (members: SDWANMember[]): ChartDatum[] =>
  build(members, (m) => m.download_bps, formatBps);

export const uploadSeries = (members: SDWANMember[]): ChartDatum[] =>
  build(members, (m) => m.upload_bps, formatBps);

/** Volume tab — the cumulative byte counters the device reports per interface. */
export const bytesReceivedSeries = (members: SDWANMember[]): ChartDatum[] =>
  build(members, (m) => m.rx_bytes, formatBytes);

export const bytesSentSeries = (members: SDWANMember[]): ChartDatum[] =>
  build(members, (m) => m.tx_bytes, formatBytes);

/**
 * Sessions tab — per-member active sessions.
 *
 * FortiOS carries this on monitor/virtual-wan/members, whose populated shape could not be observed
 * on the lab device (SD-WAN is off there, and the endpoint answers `{"wan2":{"status":"error"}}`).
 * Rather than guess a key name, this reads the runtime object the backend passes through verbatim
 * and uses a value only if it is genuinely a number. When nothing matches, the tab shows the same
 * "No results" the real GUI shows — which is the truthful answer for a firewall reporting nothing.
 */
export const sessionsSeries = (members: SDWANMember[]): ChartDatum[] =>
  build(members, (m) => {
    const raw = m.runtime?.["session"] ?? m.runtime?.["sessions"];
    return typeof raw === "number" ? raw : undefined;
  }, (n) => `${Math.round(n)}`);

/** The chart pair (or single chart) each tab shows, mirroring the FortiGate tab strip. */
export const chartsFor = (
  tab: ChartTab,
  members: SDWANMember[],
): { title: string; data: ChartDatum[] }[] => {
  switch (tab) {
    case "bandwidth":
      return [
        { title: "Download", data: downloadSeries(members) },
        { title: "Upload", data: uploadSeries(members) },
      ];
    case "volume":
      return [
        { title: "Bytes Received", data: bytesReceivedSeries(members) },
        { title: "Bytes Sent", data: bytesSentSeries(members) },
      ];
    case "sessions":
      return [{ title: "Active Sessions", data: sessionsSeries(members) }];
  }
};

/**
 * Rows of the Interfaces table: each zone followed by its own members.
 *
 * The GUI nests members under the zone they belong to, and a member whose zone no longer exists
 * would otherwise vanish from the page while still being configured on the firewall — so orphans
 * are collected under a final synthetic group rather than dropped.
 */
export type TableRow =
  | { kind: "zone"; zone: string; memberCount: number; orphan?: boolean }
  | { kind: "member"; member: SDWANMember };

export const buildRows = (
  zones: { name: string; member_count: number }[],
  members: SDWANMember[],
): TableRow[] => {
  const rows: TableRow[] = [];
  const claimed = new Set<number>();

  for (const z of zones) {
    const mine = members.filter((m) => m.zone === z.name);
    mine.forEach((m) => claimed.add(m.seq_num));
    rows.push({ kind: "zone", zone: z.name, memberCount: mine.length });
    for (const m of mine.slice().sort((a, b) => a.seq_num - b.seq_num)) {
      rows.push({ kind: "member", member: m });
    }
  }

  const orphans = members.filter((m) => !claimed.has(m.seq_num));
  if (orphans.length > 0) {
    rows.push({ kind: "zone", zone: "Unknown zone", memberCount: orphans.length, orphan: true });
    for (const m of orphans.sort((a, b) => a.seq_num - b.seq_num)) {
      rows.push({ kind: "member", member: m });
    }
  }
  return rows;
};

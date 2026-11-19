import type {
  SDWANHealthCheck, SDWANHealthCheckForm, SDWANSLARow,
} from "../../api/policyObject";

// How a Performance SLA reads on screen, and what the form is allowed to send.
//
// Kept pure and separate from the page for the same reason ruleFormat.ts is: every rule below
// exists because the FortiGate calls something by a different name than the CMDB stores it under,
// and getting one wrong shows the user a check that does not match the firewall. Tests pin the
// mapping; the page just renders it.

// ── The dialog's vocabulary ──────────────────────────────────────────────────

/** "Probe mode" — the CMDB detect-mode, in the words the dialog uses. */
export const PROBE_MODES: { value: string; label: string; hint: string }[] = [
  {
    value: "active", label: "Active",
    hint: "The firewall sends its own probes to the server and measures the replies.",
  },
  {
    value: "passive", label: "Passive",
    hint: "Nothing is sent: quality is inferred from the traffic already crossing the member.",
  },
  {
    value: "prefer-passive", label: "Prefer Passive",
    hint: "Measure live traffic where there is some, and fall back to active probes where there is not.",
  },
];

/**
 * "Protocol" — the three the dialog offers.
 *
 * The CMDB also accepts tcp-echo, udp-echo, twamp, tcp-connect and ftp. They are left out on
 * purpose: each needs settings this form has no fields for, so a check created with one could be
 * saved but never edited back.
 */
export const PROBE_PROTOCOLS: { value: string; label: string }[] = [
  { value: "ping", label: "Ping" },
  { value: "http", label: "HTTP" },
  { value: "dns", label: "DNS" },
];

export const probeModeLabel = (mode: string): string =>
  PROBE_MODES.find((m) => m.value === mode)?.label ?? mode ?? "—";

export const protocolLabel = (protocol: string): string =>
  PROBE_PROTOCOLS.find((p) => p.value === protocol)?.label ?? (protocol || "—");

/**
 * Passive mode has no Link Status and no Actions when Inactive.
 *
 * This is not a styling choice. Measured on the device: with detect-mode passive, a PUT carrying
 * failtime / recoverytime / update-static-route returns 200 and reads back unchanged, and the
 * device flips update-static-route to disable by itself. Showing those fields would offer settings
 * the firewall throws away.
 */
export const hasLinkStatus = (mode: string): boolean => mode !== "passive";

/** Passive never sends a packet, so it has no server and no protocol to speak of. */
export const hasProbeTarget = (mode: string): boolean => mode !== "passive";

/** The device's own ceiling on the Server rows: a third is refused outright. */
export const MAX_SERVERS = 2;

/**
 * Why the firewall would refuse this name — "" when it would not.
 *
 * None of this is in the schema; it was probed character by character on the device:
 *
 *   -              → "char(-) is reserved. node_check_object fail!" / -651
 *   < > ' " # ( )  → "The string contains XSS vulnerability characters" / -173
 *
 * The hyphen is the surprise. It is the obvious separator for "Voice-SLA", it is legal in almost
 * every other FortiOS table, and it is precisely why the six checks the device ships with are all
 * named with underscores. Saying so up front beats a -651 after the form is filled in.
 */
export const checkSLAName = (name: string): string => {
  if (name.includes("-")) {
    return "A performance SLA name cannot contain a hyphen — the firewall reserves it (try an underscore)";
  }
  const bad = /[<>'"#()]/.exec(name);
  return bad ? `A performance SLA name cannot contain ${bad[0]}` : "";
};

// ── List columns ─────────────────────────────────────────────────────────────

/**
 * The "Detect Server" column, as the FortiGate list renders it.
 *
 * Three shapes, all of them observed on the stock checks of this lab device:
 *   HTTP           → http://aws.amazon.com/     (the URL the probe actually fetches)
 *   Ping / others  → gmail.com                  (the bare address)
 *   DNS + system   → 96.45.45.45 / 96.45.46.46 (System DNS)
 */
export const detectServerLines = (h: SDWANHealthCheck): string[] => {
  if (!hasProbeTarget(h.detect_mode)) return [];
  if (h.protocol === "dns" && h.system_dns) {
    const dns = h.system_dns_servers ?? [];
    return dns.length > 0 ? [...dns, "(System DNS)"] : ["(System DNS)"];
  }
  if (h.protocol === "http") return h.servers.map((s) => httpProbeURL(s));
  return [...h.servers];
};

/**
 * An HTTP probe's server, shown as the URL it fetches.
 *
 * The CMDB stores a bare host; the GUI prints a URL. A value that already carries a scheme is left
 * alone rather than being prefixed twice.
 */
export const httpProbeURL = (server: string): string => {
  const s = server.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `http://${s}/`;
};

/** The Participants column. Empty means the check watches every SD-WAN member. */
export const participantsLabel = (h: SDWANHealthCheck): string =>
  h.members.length === 0 ? "All SD-WAN Members" : h.member_names.join(", ");

/** The criteria a check's SLA targets select on, deduplicated across its rows. */
export const criteriaUsed = (h: SDWANHealthCheck): string[] => {
  const seen: string[] = [];
  for (const row of h.sla) {
    for (const f of row.link_cost_factor) if (!seen.includes(f)) seen.push(f);
  }
  return seen;
};

export type SLAMetric = "packet-loss" | "latency" | "jitter";

/**
 * One of the three threshold columns.
 *
 * A threshold only means something when its criterion is in `link_cost_factor` — drop "latency"
 * from the set and the device resets latency-threshold to its default 5, which would then print
 * as a limit nobody set. So a row that does not select on the metric contributes nothing, and a
 * check with no such row shows a blank cell, exactly as the FortiGate list does.
 */
export const thresholdLabel = (h: SDWANHealthCheck, metric: SLAMetric): string => {
  const unit = metric === "packet-loss" ? "%" : "ms";
  const values = h.sla
    .filter((row) => row.link_cost_factor.includes(metric))
    .map((row) => thresholdValue(row, metric));
  if (values.length === 0) return "";
  return values.map((v) => `${v}${unit}`).join(" / ");
};

export const thresholdValue = (row: SDWANSLARow, metric: SLAMetric): number => {
  switch (metric) {
    case "latency": return row.latency_threshold;
    case "jitter": return row.jitter_threshold;
    case "packet-loss": return row.packetloss_threshold;
  }
};

// ── The measurement charts above the list ────────────────────────────────────

/** One bar: a member of a check, and what the device currently measures for it. */
export type SLAChartDatum = { label: string; value: number; display: string };

/**
 * The Packet Loss / Latency / Jitter charts.
 *
 * **Absent is not zero.** The device reports a measurement only for a member it is actually
 * probing, and a bar drawn at 0 for "the firewall did not say" claims a reading nobody took. So a
 * member with no value is dropped, and a chart left with nothing renders the same "No data" the
 * real GUI shows on a firewall whose SD-WAN is off — which is the state of this lab device.
 */
export const measurementSeries = (
  checks: SDWANHealthCheck[],
  metric: SLAMetric,
): SLAChartDatum[] => {
  const unit = metric === "packet-loss" ? "%" : "ms";
  const out: SLAChartDatum[] = [];
  for (const h of checks) {
    for (const live of h.live ?? []) {
      const raw = metric === "latency" ? live.latency
        : metric === "jitter" ? live.jitter
          : live.packet_loss;
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      out.push({
        label: `${h.name} · ${live.interface}`,
        value: raw,
        display: `${raw % 1 === 0 ? raw : raw.toFixed(2)}${unit}`,
      });
    }
  }
  return out.sort((a, b) => b.value - a.value);
};

// ── The form ─────────────────────────────────────────────────────────────────

/** The four SLA criteria the CMDB knows. The dialog shows the first three. */
export const SLA_CRITERIA: SLAMetric[] = ["latency", "jitter", "packet-loss"];

/** A blank SLA target row, on the device's own defaults. */
export const emptySLARow = (id = 1): SDWANSLARow => ({
  id,
  link_cost_factor: ["latency", "jitter", "packet-loss"],
  latency_threshold: 5,
  jitter_threshold: 5,
  packetloss_threshold: 0,
  mos_threshold: "",
});

/**
 * A blank form, matching what "Create New" opens on in the FortiGate: Active + Ping, all members,
 * SLA Target off, and the CMDB's own link-status defaults.
 */
export const emptyHealthCheckForm = (): SDWANHealthCheckForm => ({
  name: "",
  detect_mode: "active",
  protocol: "ping",
  servers: [""],
  system_dns: true,
  members: [],
  sla: [],
  interval: 500,
  failtime: 5,
  recoverytime: 5,
  update_static_route: true,
});

/** Load an existing check into the form. */
export const toHealthCheckForm = (h: SDWANHealthCheck): SDWANHealthCheckForm => ({
  name: h.name,
  detect_mode: h.detect_mode || "active",
  protocol: h.protocol || "ping",
  // One empty row so the Server field is never a dead box with no way to type in it.
  servers: h.servers.length > 0 ? [...h.servers] : [""],
  system_dns: h.system_dns,
  members: [...h.members],
  sla: h.sla.map((s) => ({ ...s, link_cost_factor: [...s.link_cost_factor] })),
  interval: h.interval || 500,
  failtime: h.failtime || 5,
  recoverytime: h.recoverytime || 5,
  update_static_route: h.update_static_route,
});

/**
 * What actually goes on the wire.
 *
 * Blank Server rows are dropped, and everything Passive mode owns none of is stripped here rather
 * than left to the server — so the request says exactly what the firewall will end up holding.
 */
export const toHealthCheckPayload = (f: SDWANHealthCheckForm): SDWANHealthCheckForm => {
  const servers = f.servers.map((s) => s.trim()).filter(Boolean);
  const base: SDWANHealthCheckForm = {
    ...f,
    name: f.name.trim(),
    servers,
    sla: f.sla.map((s) => ({ ...s })),
  };
  if (!hasProbeTarget(f.detect_mode)) {
    return { ...base, servers: [], system_dns: false, interval: 0, failtime: 0, recoverytime: 0, update_static_route: false };
  }
  return { ...base, system_dns: f.protocol === "dns" && f.system_dns };
};

/**
 * The client half of the validator, mirroring the server's rules so the form can answer without
 * spending a round trip. Returns "" when the check is submittable.
 *
 * It is a mirror, not the authority — the server re-checks all of it, because a browser is not
 * where a firewall's settings get decided.
 */
export const validateHealthCheck = (f: SDWANHealthCheckForm, isEdit: boolean): string => {
  if (!isEdit) {
    const name = f.name.trim();
    if (!name) return "Enter a name";
    if (name.length > 35) return "The name is limited to 35 characters";
    const badName = checkSLAName(name);
    if (badName) return badName;
  }

  const servers = f.servers.map((s) => s.trim()).filter(Boolean);
  if (hasProbeTarget(f.detect_mode)) {
    if (servers.length > MAX_SERVERS) return `A performance SLA accepts at most ${MAX_SERVERS} servers`;
    if (servers.some((s) => /[\s"]/.test(s))) {
      return "A server address cannot contain spaces or quotes";
    }
    // The device refuses a create with no server: "Attribute 'server' MUST be set." (-56). DNS
    // with "Same as System DNS" is the one exception, because the resolvers are the target.
    const usesSystemDNS = f.protocol === "dns" && f.system_dns;
    if (!isEdit && servers.length === 0 && !usesSystemDNS) {
      return "Enter a server to probe, or choose DNS with Same as System DNS";
    }
  }

  if (hasLinkStatus(f.detect_mode)) {
    if (f.interval < 20 || f.interval > 3600000) return "The check interval must be 20-3600000 ms";
    if (f.failtime < 1 || f.failtime > 3600) return "Failures before inactive must be 1-3600";
    if (f.recoverytime < 1 || f.recoverytime > 3600) return "Restore link after must be 1-3600 checks";
  }

  const ids = new Set<number>();
  for (const row of f.sla) {
    if (row.id < 1 || row.id > 32) return "An SLA number must be 1-32";
    if (ids.has(row.id)) return "Two SLA targets cannot share the same number";
    ids.add(row.id);
    if (row.link_cost_factor.length === 0) {
      return "An SLA target needs at least one threshold turned on";
    }
    if (row.latency_threshold < 0) return "The latency threshold cannot be negative";
    if (row.jitter_threshold < 0) return "The jitter threshold cannot be negative";
    if (row.packetloss_threshold < 0 || row.packetloss_threshold > 100) {
      return "The packet loss threshold must be 0-100%";
    }
  }
  return "";
};

/** Toggle one criterion on an SLA row — what the dialog's per-threshold switches really do. */
export const toggleCriterion = (row: SDWANSLARow, metric: SLAMetric): SDWANSLARow => {
  const on = row.link_cost_factor.includes(metric);
  return {
    ...row,
    link_cost_factor: on
      ? row.link_cost_factor.filter((f) => f !== metric)
      // Keep the CMDB's own order so a round trip does not look like an edit.
      : [...row.link_cost_factor, metric].sort(
        (a, b) => criterionOrder(a) - criterionOrder(b)),
  };
};

const CRITERION_ORDER = ["latency", "jitter", "packet-loss", "mos"];
const criterionOrder = (f: string): number => {
  const i = CRITERION_ORDER.indexOf(f);
  return i === -1 ? CRITERION_ORDER.length : i;
};

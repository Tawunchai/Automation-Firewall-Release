// flowImpact — "this policy is about to go on a live firewall. WHO does it hit, and what does it
// break?"
//
// The flow chart says what the rule DOES. This says what it AFFECTS, which is the question an admin
// (or the person who has to approve the change) actually asks:
//
//   · which network segments are in scope, and roughly how many hosts sit in them
//   · which LAN / DMZ / WAN interface each of those segments lives behind
//   · which EXISTING policies on the device the new rule collides with — above all, whether one of
//     them already matches this traffic, in which case the new rule will never run at all
//
// It is computed here, in the browser, from data the page already holds: the proposal's parsed
// drafts and the device lists the chart is annotated with. No round trip, so the answer is on
// screen with the diagram instead of behind a button.
//
// THE RULE IT NEVER BREAKS: a claim is only made when the inputs support it. An address the device
// could not resolve, an FQDN, a geography object — none of those can be reduced to an IP range, so
// containment ("this rule is fully shadowed") is WITHHELD and the report says it is incomplete. The
// backend's own audit does the same thing (services/audit.go: undecidable objects stay quiet),
// because a confident wrong answer here is worse than no answer.

import type { FirewallPolicy } from "../../api/policyObject";
import type { ChatItem } from "./index";
import type { ParsedPolicy } from "./parsePolicyCLI";
import { policyImpact } from "./applyImpact";
import { pendingObjectMaps, type FlowContext, type FlowInterfaceFact } from "./deviceFacts";

// ── IPv4 set math ────────────────────────────────────────────────────────────

export type IPRange = { start: number; end: number };

/** Every IPv4 address — what FortiOS's built-in `all` means. */
export const FULL_RANGE: IPRange = { start: 0, end: 0xffffffff };

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

/**
 * A displayed address value → the range it covers.
 *
 * Accepts everything the chart shows for an address object: CIDR, a bare host, and the two range
 * spellings (the en dash this app formats with, and the hyphen FortiOS uses). Returns null for a
 * value that simply is not an IP range — an FQDN, a country, an SDN connector — which is the signal
 * to treat the object as undecidable rather than to guess.
 */
export function parseNetworkValue(value: string): IPRange | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  const cidr = v.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    const base = ipToInt(cidr[1]);
    const prefix = Number(cidr[2]);
    if (base == null || prefix > 32) return null;
    const size = prefix === 0 ? 0x100000000 : 2 ** (32 - prefix);
    const start = (base & (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)) >>> 0;
    return { start, end: start + size - 1 };
  }

  const range = v.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*[–-]\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (range) {
    const a = ipToInt(range[1]);
    const b = ipToInt(range[2]);
    if (a == null || b == null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  const host = ipToInt(v);
  return host == null ? null : { start: host, end: host };
}

/** Sorted, non-overlapping union — every set operation below assumes this shape. */
export function mergeRanges(list: IPRange[]): IPRange[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: IPRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    // +1 so two adjacent ranges (…/25 and the next /25) become one, which matters for coverage.
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function rangesIntersect(a: IPRange[], b: IPRange[]): boolean {
  for (const x of a) for (const y of b) if (x.start <= y.end && y.start <= x.end) return true;
  return false;
}

/** True when the union of `outer` fully contains every range in `inner`. */
export function rangesCover(outer: IPRange[], inner: IPRange[]): boolean {
  if (inner.length === 0) return false;
  const merged = mergeRanges(outer);
  return inner.every((i) => merged.some((o) => o.start <= i.start && o.end >= i.end));
}

/**
 * Usable hosts in one range.
 *
 * A /24 is 254, not 256: the network and broadcast addresses are not hosts, and an admin reading
 * "how many machines does this hit" is asking about machines. /31 and /32 have no such pair.
 */
export function usableHosts(r: IPRange): number {
  const size = r.end - r.start + 1;
  return size <= 2 ? size : size - 2;
}

// ── Service math ─────────────────────────────────────────────────────────────

export type PortRange = { proto: string; lo: number; hi: number };

/** Any protocol, any port — FortiOS's built-in `ALL`. */
const ANY_SERVICE: PortRange[] = [{ proto: "ANY", lo: 0, hi: 65535 }];

/**
 * A service's displayed detail → the ports it covers.
 *
 * Parses exactly what the two producers emit: the backend's ServiceDetailsFromFG ("TCP/80",
 * "TCP/53 UDP/53", "IP/50", "ICMP/8", "ANY") and this app's own serviceDetail() ("TCP/9000-9010").
 * For IP and ICMP the number is a protocol/type rather than a port; it is kept in the same shape
 * because the only question asked of it is "do these two overlap".
 */
export function parseServiceDetail(detail: string): PortRange[] {
  const text = (detail ?? "").trim();
  if (!text || /^any$/i.test(text)) return ANY_SERVICE;

  const out: PortRange[] = [];
  for (const token of text.split(/\s+/)) {
    const m = token.match(/^(TCP|UDP|SCTP|ICMP6|ICMP|IP)\/(.+)$/i);
    if (!m) continue;
    const proto = m[1].toUpperCase();
    const value = m[2];
    if (/^any$/i.test(value)) { out.push({ proto, lo: 0, hi: 65535 }); continue; }
    const range = value.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) continue;
    const lo = Number(range[1]);
    const hi = range[2] ? Number(range[2]) : lo;
    out.push({ proto, lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
  }
  return out.length ? out : ANY_SERVICE;
}

/** Exported so packetSim.ts decides "does this rule carry that packet" with the SAME rule the
 *  coverage maths uses. Two implementations of this would be two answers on two screens. */
export const protoMatches = (a: string, b: string) => a === "ANY" || b === "ANY" || a === b;

export function servicesIntersect(a: PortRange[], b: PortRange[]): boolean {
  for (const x of a) for (const y of b) {
    if (protoMatches(x.proto, y.proto) && x.lo <= y.hi && y.lo <= x.hi) return true;
  }
  return false;
}

export function servicesCover(outer: PortRange[], inner: PortRange[]): boolean {
  if (inner.length === 0) return false;
  return inner.every((i) => outer.some((o) =>
    protoMatches(o.proto, i.proto) && o.lo <= i.lo && o.hi >= i.hi));
}

// ── Resolving a policy's object names ────────────────────────────────────────

/** What a set of address names adds up to, and which of them we had to give up on. */
export type ResolvedAddresses = { ranges: IPRange[]; unresolved: string[] };

const isAll = (name: string) => /^all$/i.test(name);

export function resolveAddresses(
  names: string[], pending: Map<string, string>, ctx: FlowContext,
): ResolvedAddresses {
  const ranges: IPRange[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    if (isAll(name)) { ranges.push({ ...FULL_RANGE }); continue; }
    const detail = pending.get(name) ?? ctx.addresses.get(name) ?? "";
    const r = parseNetworkValue(detail);
    if (r) ranges.push(r);
    else unresolved.push(name);
  }
  return { ranges: mergeRanges(ranges), unresolved };
}

/**
 * Do two sides of two policies overlap — and do we actually KNOW?
 *
 * The two answers are separate on purpose. An object that could not be reduced to a range (an FQDN,
 * a geography object, a name the device never answered for) cannot be ruled OUT of the overlap, so
 * it counts as "may intersect": staying silent would leave the panel saying "no existing policy
 * conflicts", which is a false reassurance and the worse of the two errors. What it can never do is
 * make a containment claim — `certain` is what gates that.
 */
export function sideOverlap(
  a: { ranges: IPRange[]; unresolved: string[] },
  b: { ranges: IPRange[]; unresolved: string[] },
): { intersects: boolean; certain: boolean } {
  const certain = a.unresolved.length === 0 && b.unresolved.length === 0;
  return { intersects: !certain || rangesIntersect(a.ranges, b.ranges), certain };
}

/** sideOverlap for services. */
export function serviceOverlap(
  a: { ports: PortRange[]; unresolved: string[] },
  b: { ports: PortRange[]; unresolved: string[] },
): { intersects: boolean; certain: boolean } {
  const certain = a.unresolved.length === 0 && b.unresolved.length === 0;
  return { intersects: !certain || servicesIntersect(a.ports, b.ports), certain };
}

export function resolveServices(
  names: string[], pending: Map<string, string>, ctx: FlowContext,
): { ports: PortRange[]; unresolved: string[] } {
  const ports: PortRange[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    if (isAll(name)) { ports.push(...ANY_SERVICE); continue; }
    const detail = pending.get(name) ?? ctx.services.get(name) ?? "";
    if (!detail) { unresolved.push(name); continue; }
    ports.push(...parseServiceDetail(detail));
  }
  return { ports, unresolved };
}

/** Interface sets overlap. FortiOS's `any` matches every interface. */
export function interfacesMatch(a: string[], b: string[]): boolean {
  const norm = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);
  const A = norm(a), B = norm(b);
  if (A.length === 0 || B.length === 0) return true;
  if (A.some((x) => /^any$/i.test(x)) || B.some((x) => /^any$/i.test(x))) return true;
  return A.some((x) => B.some((y) => x === y));
}

// ── The report ───────────────────────────────────────────────────────────────

export type ImpactSeverity = "critical" | "warning" | "info";

export type AffectedNetwork = {
  /** Dedupe key — the CIDR, so one subnet reached two ways is listed once. */
  key: string;
  label: string;
  cidr: string;
  hosts: number;
  side: "source" | "destination";
  /** The interface this segment sits behind, when one of the device's own subnets contains it. */
  iface?: string;
  ifaceRole?: string;
  origin: "address" | "interface";
  /**
   * "Everything out there" rather than a countable set of machines — an unrestricted side facing a
   * WAN interface. Its host count is meaningless and must not be shown as a number.
   */
  unbounded?: boolean;
};

export type PolicyRelation = "covers-new" | "covered-by-new" | "overlap";

export type ExistingPolicyImpact = {
  policyId: number;
  seq: number;
  name: string;
  action: "accept" | "deny";
  relation: PolicyRelation;
  severity: ImpactSeverity;
  detail: string;
};

export type ImpactFinding = { severity: ImpactSeverity; title: string; detail: string };

export type PolicyImpactReport = {
  policyName: string;
  action: "accept" | "deny";
  srcIntf: string;
  dstIntf: string;
  networks: AffectedNetwork[];
  /** Usable hosts across the SOURCE segments — "how many machines does this rule speak for". */
  sourceHosts: number;
  existing: ExistingPolicyImpact[];
  findings: ImpactFinding[];
  /** Objects that could not be reduced to an IP range or a port set. */
  unresolved: string[];
  /** True when `unresolved` is non-empty: containment verdicts were deliberately withheld. */
  partial: boolean;
};

const SEVERITY_ORDER: Record<ImpactSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** The device's own subnet behind an interface, from its interface IP ("192.168.1.99/24"). */
function interfaceNetwork(fact: FlowInterfaceFact): IPRange | null {
  return fact.ip ? parseNetworkValue(fact.ip) : null;
}

/** CIDR text for a range, when it is one; otherwise the plain "a – b" span. */
function rangeLabel(r: IPRange): string {
  const size = r.end - r.start + 1;
  const prefix = 32 - Math.log2(size);
  if (Number.isInteger(prefix) && prefix >= 0 && (r.start & (size - 1)) === 0) {
    return `${intToIp(r.start)}/${prefix}`;
  }
  return `${intToIp(r.start)} – ${intToIp(r.end)}`;
}

/**
 * The segments a policy actually reaches, per side.
 *
 * `all` is not a segment — it is the ABSENCE of a restriction, and printing "0.0.0.0/0, 4 billion
 * hosts" tells the reader nothing. What they want to know is which of THEIR networks that resolves
 * to, so an unrestricted side falls back to the subnets sitting behind its interface.
 */
function affectedNetworks(
  side: "source" | "destination", names: string[], intf: string,
  pending: Map<string, string>, ctx: FlowContext,
): { networks: AffectedNetwork[]; unresolved: string[] } {
  const { ranges, unresolved } = resolveAddresses(names, pending, ctx);
  const networks: AffectedNetwork[] = [];
  const seen = new Set<string>();

  const ifaceFor = (r: IPRange): FlowInterfaceFact | undefined => {
    for (const fact of ctx.interfaces.values()) {
      const net = interfaceNetwork(fact);
      if (net && net.start <= r.start && net.end >= r.end) return fact;
    }
    return undefined;
  };

  const push = (
    label: string, r: IPRange, origin: AffectedNetwork["origin"],
    fact?: FlowInterfaceFact, unbounded = false,
  ) => {
    const cidr = unbounded ? "0.0.0.0/0" : rangeLabel(r);
    const key = `${side}:${cidr}`;
    if (seen.has(key)) return;
    seen.add(key);
    const owner = fact ?? ifaceFor(r);
    networks.push({
      key, label, cidr, hosts: unbounded ? 0 : usableHosts(r), side,
      iface: owner?.name, ifaceRole: owner?.role, origin, unbounded,
    });
  };

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (isAll(name)) continue; // handled below
    const detail = pending.get(name) ?? ctx.addresses.get(name) ?? "";
    const r = parseNetworkValue(detail);
    if (r) push(name, r, "address");
  }

  // An unrestricted side, or one whose objects we could not resolve at all: fall back to what is
  // actually reachable through that interface, which is the concrete thing the rule will hit.
  //
  // On a LAN or DMZ port that is the device's own subnet — a countable set of machines. On a WAN
  // port it is NOT: `all` there means the internet, and printing the /22 the WAN address happens to
  // sit in would name the wrong thing and attach a host count to it.
  const unrestricted = names.some(isAll) || (ranges.length === 0 && networks.length === 0);
  if (unrestricted) {
    for (const fact of ctx.interfaces.values()) {
      if (intf && !/^any$/i.test(intf) && fact.name !== intf) continue;
      if (fact.role === "wan" || ctx.internetIfaces.has(fact.name)) {
        push("Internet — every destination", FULL_RANGE, "interface", fact, true);
        continue;
      }
      const net = interfaceNetwork(fact);
      if (net) push(fact.alias ? `${fact.alias} (${fact.name})` : fact.name, net, "interface", fact);
    }
  }

  return { networks, unresolved };
}

/**
 * analyzePolicyImpact — one proposed policy against the firewall as it stands today.
 *
 * `existing` is the device's live policy table, in its real order. Every rule in it sits ABOVE a
 * newly created one (Apply appends to the bottom), which is what makes "an existing policy already
 * matches this traffic" the finding that matters most: on a first-match firewall, the new rule then
 * never runs, and nothing else on screen would say so.
 */
export function analyzePolicyImpact(args: {
  draft: ParsedPolicy;
  pendingAddresses: Map<string, string>;
  pendingServices: Map<string, string>;
  ctx: FlowContext;
  existing: FirewallPolicy[];
}): PolicyImpactReport {
  const { draft, pendingAddresses, pendingServices, ctx, existing } = args;
  const name = draft.form.name ?? draft.target;
  const p = policyImpact(name, draft.form);

  const src = affectedNetworks("source", p.srcAddr, p.srcIntf, pendingAddresses, ctx);
  const dst = affectedNetworks("destination", p.dstAddr, p.dstIntf, pendingAddresses, ctx);

  const srcRanges = resolveAddresses(p.srcAddr, pendingAddresses, ctx);
  const dstRanges = resolveAddresses(p.dstAddr, pendingAddresses, ctx);
  const svc = resolveServices(p.service, pendingServices, ctx);

  const unresolved = Array.from(new Set([
    ...srcRanges.unresolved, ...dstRanges.unresolved, ...svc.unresolved,
  ]));
  const partial = unresolved.length > 0;

  // "How many machines does this rule speak for" — an unbounded side contributes nothing countable
  // and must not be folded in as a zero-looking number.
  const sourceHosts = src.networks
    .filter((n) => n.side === "source" && !n.unbounded)
    .reduce((sum, n) => sum + n.hosts, 0);

  // ── Existing policies this one collides with ──
  const collisions: ExistingPolicyImpact[] = [];
  for (const e of existing) {
    if (!e.enabled) continue;
    if (e.name === name) continue; // an edit of the same rule, not a collision with itself
    if (!interfacesMatch(e.src_intf_list ?? [], [p.srcIntf])) continue;
    if (!interfacesMatch(e.dst_intf_list ?? [], [p.dstIntf])) continue;

    const eSrc = resolveAddresses(e.src_addr_list ?? [], pendingAddresses, ctx);
    const eDst = resolveAddresses(e.dst_addr_list ?? [], pendingAddresses, ctx);
    const eSvc = resolveServices(e.service_list ?? [], pendingServices, ctx);

    const srcMatch = sideOverlap(eSrc, srcRanges);
    const dstMatch = sideOverlap(eDst, dstRanges);
    const svcMatch = serviceOverlap(eSvc, svc);
    if (!srcMatch.intersects || !dstMatch.intersects || !svcMatch.intersects) continue;

    // Containment is only claimed when every side resolved completely — see the header note.
    const decidable = srcMatch.certain && dstMatch.certain && svcMatch.certain;
    const covers = decidable
      && rangesCover(eSrc.ranges, srcRanges.ranges)
      && rangesCover(eDst.ranges, dstRanges.ranges)
      && servicesCover(eSvc.ports, svc.ports);
    const coveredBy = decidable
      && rangesCover(srcRanges.ranges, eSrc.ranges)
      && rangesCover(dstRanges.ranges, eDst.ranges)
      && servicesCover(svc.ports, eSvc.ports);

    const eAction = e.action === "deny" ? "deny" : "accept";
    const sameAction = eAction === p.action;

    let relation: PolicyRelation = "overlap";
    let severity: ImpactSeverity = "info";
    let detail = "";

    if (covers) {
      relation = "covers-new";
      if (sameAction) {
        severity = "warning";
        detail = `this policy already covers the same traffic and does the same thing (${eAction}) — the new one adds nothing`;
      } else {
        severity = "critical";
        detail = `this policy sits above it and ${eAction === "accept" ? "allows" : "blocks"} all of the same traffic — ` +
          `the new policy would never be reached (first match wins); move it above "${e.name}" for it to take effect`;
      }
    } else if (coveredBy) {
      relation = "covered-by-new";
      severity = sameAction ? "info" : "warning";
      detail = sameAction
        ? `the new policy fully covers this one — placed above it, the existing rule becomes dead`
        : `the new policy fully covers this one and does the opposite (${p.action} vs ${eAction}) — ` +
          `placed above it, this rule never runs again`;
    } else if (!decidable) {
      // Reported, but hedged: something on one side could not be evaluated, so this is "may
      // collide" rather than a verdict.
      severity = sameAction ? "info" : "warning";
      detail = `may overlap — some objects cannot be evaluated (FQDN / geography / unreadable from the device) ` +
        `so which rule shadows which cannot be confirmed (${p.action} vs ${eAction})`;
    } else {
      severity = sameAction ? "info" : "warning";
      detail = sameAction
        ? "traffic partly overlaps (same action)"
        : `traffic partly overlaps and the actions differ (${p.action} vs ${eAction}) — order decides which one wins`;
    }

    collisions.push({
      policyId: e.id, seq: e.seq_num, name: e.name || `policy ${e.id}`,
      action: eAction, relation, severity, detail,
    });
  }

  collisions.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.seq - b.seq);

  // ── Findings: the overview, in the order it should be read ──
  const findings: ImpactFinding[] = [];

  const srcNets = src.networks.filter((n) => n.side === "source");
  if (srcNets.length) {
    const zones = Array.from(new Set(srcNets.map((n) => n.iface).filter(Boolean)));
    const counted = srcNets.filter((n) => !n.unbounded);
    findings.push({
      severity: "info",
      title: counted.length
        ? `${counted.length} subnets · about ${sourceHosts.toLocaleString()} hosts`
        : "Unrestricted source — anything arriving on this interface",
      detail: `Source: ${srcNets.map((n) => n.cidr).join(", ")}` +
        (zones.length ? ` — behind interface ${zones.join(", ")}` : ""),
    });
  }

  const blocking = collisions.find((c) => c.relation === "covers-new" && c.severity === "critical");
  if (blocking) {
    findings.push({
      severity: "critical",
      title: `The new policy will not run if it is left at the bottom of the table`,
      detail: `"${blocking.name}" (position ${blocking.seq}) matches this traffic first — ` +
        `use the Policy Wizard's placement step to put it above that rule`,
    });
  } else if (collisions.length) {
    findings.push({
      severity: collisions.some((c) => c.severity === "warning") ? "warning" : "info",
      title: `Interacts with ${collisions.length} existing ${collisions.length === 1 ? "policy" : "policies"}`,
      detail: "Check the order before applying — FortiGate matches top to bottom and the first match wins",
    });
  } else {
    findings.push({
      severity: "info",
      title: "No existing policy overlaps",
      detail: "No rule on this interface pair matches the same traffic — the new policy will work as configured",
    });
  }

  if (p.action === "deny") {
    const allowing = collisions.filter((c) => c.action === "accept");
    if (allowing.length) {
      findings.push({
        severity: "warning",
        title: "This traffic is allowed right now",
        detail: `Allowed by ${allowing.map((c) => `"${c.name}"`).join(", ")} — ` +
          `the block only takes effect if the new policy sits above those rules`,
      });
    }
  }

  if (partial) {
    findings.push({
      severity: "warning",
      title: "Incomplete evaluation",
      detail: `Could not evaluate ${unresolved.join(", ")} (FQDN / geography / not readable from the device) — ` +
        "so no conclusion is drawn about which rule shadows which",
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    policyName: name,
    action: p.action,
    srcIntf: p.srcIntf,
    dstIntf: p.dstIntf,
    networks: [...src.networks, ...dst.networks],
    sourceHosts,
    existing: collisions,
    findings,
    unresolved,
    partial,
  };
}

/** The worst thing in a report — drives the badge colour on the collapsed summary. */
export function reportSeverity(r: PolicyImpactReport): ImpactSeverity {
  return r.findings.reduce<ImpactSeverity>(
    (worst, f) => (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst] ? f.severity : worst),
    "info",
  );
}

/**
 * Every policy in one AI answer, analysed.
 *
 * Keyed by the DIAGRAM id (`policy-0`, `policy-1`, …) so a chart and its impact are paired without
 * either side having to re-derive the other's ordering.
 */
export function analyzeProposal(item: ChatItem, ctx: FlowContext): Map<string, PolicyImpactReport> {
  const out = new Map<string, PolicyImpactReport>();
  const drafts = item.policyDrafts ?? [];
  if (drafts.length === 0) return out;

  const { addresses, services } = pendingObjectMaps(item);
  drafts.forEach((draft, i) => {
    out.set(`policy-${i}`, analyzePolicyImpact({
      draft, pendingAddresses: addresses, pendingServices: services,
      ctx, existing: ctx.policies,
    }));
  });
  return out;
}

/** One line for the collapsed view: "3 วง · ~760 โฮสต์ · 2 policy เดิม". */
export function impactHeadline(r: PolicyImpactReport): string {
  const sources = r.networks.filter((n) => n.side === "source" && !n.unbounded).length;
  const parts = sources
    ? [`${sources} subnets`, `~${r.sourceHosts.toLocaleString()} hosts`]
    : ["unrestricted source"];
  if (r.existing.length) parts.push(`${r.existing.length} existing`);
  return parts.join(" · ");
}

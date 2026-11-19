// packetSim — one proposed policy, walked down the firewall's real rule table.
//
// WHY THIS EXISTS
// The CLI an AI answer produces tells you the syntax is right. It does not tell you that the rule
// will never run because rule #4 already matches, or that six rules below it are about to become
// unreachable, or that the office loses NTP at 02:00 and nobody finds out until Kerberos starts
// failing. Those are set-containment facts about the WHOLE table, and no amount of reading one
// policy's CLI produces them.
//
// So this module answers three questions, in the order somebody approving a change asks them:
//
//   1. WHERE DOES MY TRAFFIC LAND?   — a walk down the table, first match wins, per sample flow.
//   2. WHAT ELSE BREAKS?             — every rule the proposal shadows, and what it was carrying.
//   3. WHAT STOPS WORKING?           — that, restated in services and networks rather than seq
//                                      numbers, because "#17 is now dead" is not a sentence anyone
//                                      can act on at four in the afternoon.
//
// PURE AND SYNCHRONOUS. No React, no DOM, no fetch. Everything comes in through `SimArgs` and the
// answer comes back as data, so the interesting cases are unit tests rather than something you have
// to reproduce against a live firewall.
//
// IT DOES NOT REIMPLEMENT THE MATHS. Every range and port comparison here is flowImpact.ts's, which
// already backs the Apply confirmation dialog. If the two ever disagreed, one screen would be
// telling the truth and the other would not — so there is one implementation and this file calls it.
//
// WHAT IT REFUSES TO DO. An object it cannot reduce to a range (an FQDN, a geography object, a name
// the device did not answer for) makes a comparison UNDECIDABLE, and an undecidable comparison
// stops the walk with "cannot be evaluated" instead of guessing. A simulation that quietly assumes
// a match is worse than one that says it does not know: the whole point is that somebody is about
// to trust it before writing to a live firewall.

import type { FirewallPolicy } from "../../api/policyObject";
import type { ParsedPolicy } from "./parsePolicyCLI";
import { policyImpact } from "./applyImpact";
import type { FlowContext } from "./deviceFacts";
import {
  FULL_RANGE, intToIp, ipToInt, interfacesMatch, parseNetworkValue, protoMatches,
  rangesCover, rangesIntersect, resolveAddresses, resolveServices, servicesCover,
  servicesIntersect, usableHosts,
  type IPRange, type PortRange,
} from "./flowImpact";

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Which of the three tables to build. `fixed` is only offered when `after` is unreachable. */
export type SimPhase = "before" | "after" | "fixed";

export type RuleState =
  /** The proposal itself. */
  | "new"
  /** Sits below the proposal, which fully covers it: it can never match again. */
  | "dead"
  /** The proposal will never run — something above it already matches the same traffic. */
  | "unreachable"
  /** Still matches, but a share of what it used to carry now stops one row higher. */
  | "narrowed"
  /** Unaffected. */
  | "survives";

export type SimVerdict =
  | { kind: "match" }
  | { kind: "skip"; reason: string }
  /** A field could not be reduced to a range or a port set, so nothing is claimed either way. */
  | { kind: "unsure"; reason: string }
  /** Never consulted — an earlier rule already matched. */
  | { kind: "unreached" };

export type SimRule = {
  /** Stable key: "p<id>" for a live policy, "new" for the proposal. */
  key: string;
  id: number | null;
  name: string;
  /** Position in the table AFTER the change — what the device would show. */
  shown: number;
  srcIntf: string[];
  dstIntf: string[];
  srcAddr: string[];
  dstAddr: string[];
  service: string[];
  action: "accept" | "deny";
  nat: boolean;
  /** "AntiVirus: default", … — the same strings policyImpact() builds. */
  profiles: string[];
  enabled: boolean;
  isNew: boolean;
  state: RuleState;
  /** Why it earned that state, in one sentence. Empty for an untouched rule. */
  note: string;
};

export type SimBand = {
  kind: "band";
  /** How many consecutive policies were folded in here. */
  count: number;
  /** Why none of them can carry this traffic — the first comparison FortiOS makes. */
  why: string;
};

export type SimRow = SimBand | ({ kind: "rule" } & SimRule);

export type SimFlow = {
  /** "A" · "B" · "C" — short enough to sit on a moving dot. */
  id: string;
  /** "Guest-WiFi-Subnet → the internet on HTTPS" */
  label: string;
  srcIp: string;
  dstIp: string;
  proto: string;
  port: number;
  /**
   * True when the destination was "all"/0.0.0.0/0, so `dstIp` is the 8.8.8.8 stand-in rather than a
   * real target. The renderer uses this (with the egress interface) to decide whether the
   * destination node is the internet or an internal segment like a DMZ — "all out the DMZ port" is
   * not the internet.
   */
  dstUnbounded: boolean;
  /** The service object this flow stands in for. */
  service: string;
  /** Where this flow came from, for the chip's tooltip. */
  origin: string;
  /**
   * True for an ILLUSTRATIVE flow — one synthesised to make the new rule's scope legible (another
   * service it lets through, or a service it does not cover) rather than taken from a real policy.
   * It is a real packet walked down the real table, so its fate is honest; but it is NOT counted as
   * a consequence of the change — the verdict and its numbers read only the real flows, while the
   * picture draws all of them. This is how the panel shows "what gets through and what is blocked"
   * without ever inventing a drop the proposal did not cause.
   */
  synthetic?: boolean;
};

export type FlowOutcome = "allowed" | "inspected" | "dropped" | "unknown";

export type SimFlowResult = {
  flow: SimFlow;
  /** Index into `rows` of the row that claims it. */
  rowIndex: number;
  rule: SimRule | null;
  outcome: FlowOutcome;
  /** Set when the walk stopped because something could not be evaluated. */
  blockedBy?: string;
};

export type StageId = "ingress" | "lookup" | "verdict" | "impact";

export type SimStage = { id: StageId; title: string; detail: string; from: number; to: number };

export type LedgerEntry = {
  key: string;
  shown: number;
  name: string;
  /** "Corp-Users → all · HTTP, HTTPS" */
  summary: string;
  action: "accept" | "deny";
  state: RuleState;
  note: string;
};

export type BreakKind = "stop" | "keep" | "care";

export type BreakItem = { kind: BreakKind; port: string; title: string; detail: string };

export type Tone = "allow" | "deny" | "warn" | "info" | "accent";

export type SimHeadline = {
  tone: Tone;
  title: string;
  detail: string;
  nums: { v: string; l: string }[];
};

export type Scenario = {
  phase: SimPhase;
  rows: SimRow[];
  flows: SimFlowResult[];
  stages: SimStage[];
  duration: number;
  /** How long one rung of the walk takes, so the renderer and the timeline agree. */
  perRow: number;
  ingressMs: number;
  ingress: string;
  egress: string;
  /**
   * Whether the egress interface actually leads to the internet (a default route points out of it).
   * When false, an "all" destination is a reach across an internal segment — a DMZ, a server VLAN —
   * not "the internet", and the diagram must say so. Computed from the device's own routing, never
   * from the interface's `role`, which is optional and often wrong.
   */
  egressIsInternet: boolean;
  /**
   * Whether traffic ARRIVES from the internet — the ingress interface is one a default route points
   * out of. With an unbounded ("all") source this is what turns the source node into the globe
   * rather than a plain "0.0.0.0/0" card: a policy from port1 (the WAN) inward is internet→inside,
   * and drawing its source as an anonymous address box was the "Internet → LAN" bug. Same fact,
   * same `internetIfaces` set, as `egressIsInternet` — only read on the way in.
   */
  ingressIsInternet: boolean;
  source: { label: string; value: string; hosts: number; unbounded: boolean };
  /** The profiles on the rule that claims the first allowed flow, if any. */
  utm: string[];
  headline: SimHeadline;
  ledger: LedgerEntry[];
  breaks: BreakItem[];
  /** Objects nothing could reduce to a range — named, never silently dropped. */
  unresolved: string[];
  /** Set when a rule above the proposal already matches: the id to place it before. */
  blockedById: number | null;
  blockedByName: string;
  /**
   * False when the proposal's OWN source could not be reduced to an address range, so no packet
   * stands for the traffic it is about. Other flows may still be drawn — they come from rules that
   * did resolve — but nothing on screen demonstrates what this policy would do, and the panel has
   * to say so rather than let a green walk read as reassurance.
   */
  simulatesProposal: boolean;
};

export type SimArgs = {
  draft: ParsedPolicy;
  ctx: FlowContext;
  pendingAddresses: Map<string, string>;
  pendingServices: Map<string, string>;
  /** The id of the live policy this one is placed BEFORE; null = bottom of its interface pair. */
  beforeId: number | null;
  phase: SimPhase;
};

// ── Interface pair ───────────────────────────────────────────────────────────

const intfSet = (list: string[] | undefined, single: string): string[] =>
  (list?.length ? list : single ? [single] : []);

/**
 * Does this policy share the proposal's interface pair?
 *
 * The whole reason a 200-rule table can be drawn at all: FortiOS rejects everything else on its
 * first comparison, so those rules are folded into one band instead of eighty rows. It lives here
 * rather than in the placement board (which used to own it) because it is a fact about the rule
 * base, not about a drag-and-drop widget — and because a pure module can be tested.
 */
export const isPairRelevant = (p: FirewallPolicy, srcIntf: string, dstIntf: string): boolean => {
  const has = (arr: string[], name: string) => arr.length === 0 || arr.includes("any") || arr.includes(name);
  return has(intfSet(p.src_intf_list, p.src_intf), srcIntf) && has(intfSet(p.dst_intf_list, p.dst_intf), dstIntf);
};

// ── Small helpers ────────────────────────────────────────────────────────────

const contains = (ranges: IPRange[], ip: number) => ranges.some((r) => r.start <= ip && ip <= r.end);
const isUnbounded = (ranges: IPRange[]) =>
  ranges.length === 1 && ranges[0].start === FULL_RANGE.start && ranges[0].end === FULL_RANGE.end;

const nameList = (l: string[]) => (l.length ? l.join(", ") : "all");

/**
 * Does traffic leaving by this interface actually reach the internet? True when the interface (or
 * zone name) is one the device's default route points out of — the `internetIfaces` fact, never the
 * unreliable `role`. An unknown or "any" egress defaults to true, because "all" out of nowhere in
 * particular is still most sensibly read as the internet; a named internal interface (a DMZ, a
 * server VLAN) that is not an internet interface returns false, which is what fixes "all → DMZ"
 * being drawn as the internet. Matched case-insensitively, since dstintf casing varies ("DMZ"/"dmz").
 */
function isInternetEgress(ctx: FlowContext, egress: string): boolean {
  if (!egress || egress === "any") return true;
  const e = egress.toLowerCase();
  for (const i of ctx.internetIfaces) if (i.toLowerCase() === e) return true;
  return false;
}

/** Sum of usable hosts across bounded ranges. An unbounded side contributes nothing countable. */
function hostCount(ranges: IPRange[]): number {
  if (isUnbounded(ranges)) return 0;
  return ranges.reduce((n, r) => n + usableHosts(r), 0);
}

/** CIDR text for a range when it is one, else the plain span. */
function rangeLabel(r: IPRange): string {
  const size = r.end - r.start + 1;
  const prefix = 32 - Math.log2(size);
  if (Number.isInteger(prefix) && prefix >= 0 && (r.start & (size - 1)) === 0) {
    return `${intToIp(r.start)}/${prefix}`;
  }
  return `${intToIp(r.start)} – ${intToIp(r.end)}`;
}

/** The first address in a range that a machine could actually hold. */
function firstHost(r: IPRange): string | null {
  const size = r.end - r.start + 1;
  const n = size <= 2 ? r.start : r.start + 1;
  return n > r.end ? null : intToIp(n >>> 0);
}

/**
 * A concrete protocol and port to send, from whatever the rule's service resolves to.
 *
 * `used` is what the other flows already carry. Two rules commonly resolve to overlapping port
 * sets, and sending the same port twice would draw two dots that mean one thing — so a rule with
 * several services gives up its first UNUSED one before falling back to repeating.
 */
function pickPort(ports: PortRange[], used: Set<string> = new Set()): { proto: string; port: number } {
  const concrete = ports.filter((p) => p.proto !== "ANY" && p.proto !== "IP" && p.lo > 0);
  for (const p of concrete) {
    if (!used.has(`${p.proto}:${p.lo}`)) return { proto: p.proto, port: p.lo };
  }
  if (concrete.length) return { proto: concrete[0].proto, port: concrete[0].lo };
  // "ALL", or a protocol without a port (IP/50). HTTPS is the honest stand-in for "some traffic":
  // it is what a wide-open rule mostly carries, and the flow's label says which service it means.
  return { proto: "TCP", port: 443 };
}

const portText = (proto: string, port: number) => `${port}/${proto.toLowerCase()}`;

// ── Building the ordered table ───────────────────────────────────────────────

function toSimRule(p: FirewallPolicy): SimRule {
  return {
    key: `p${p.id}`,
    id: p.id,
    name: p.name || `policy ${p.id}`,
    shown: 0,
    srcIntf: intfSet(p.src_intf_list, p.src_intf),
    dstIntf: intfSet(p.dst_intf_list, p.dst_intf),
    srcAddr: p.src_addr_list?.length ? p.src_addr_list : ["all"],
    dstAddr: p.dst_addr_list?.length ? p.dst_addr_list : ["all"],
    service: p.service_list?.length ? p.service_list : ["ALL"],
    action: p.action === "deny" ? "deny" : "accept",
    nat: !!p.nat,
    profiles: [
      p.av_profile && `AntiVirus: ${p.av_profile}`,
      p.webfilter_profile && `Web Filter: ${p.webfilter_profile}`,
      p.dnsfilter_profile && `DNS Filter: ${p.dnsfilter_profile}`,
      p.app_control && `App Control: ${p.app_control}`,
      p.ips_sensor && `IPS: ${p.ips_sensor}`,
      p.file_filter_profile && `File Filter: ${p.file_filter_profile}`,
    ].filter(Boolean) as string[],
    enabled: p.enabled !== false,
    isNew: false,
    state: "survives",
    note: "",
  };
}

/**
 * Where Apply would put the new rule.
 *
 * `beforeId` is the placement board's own vocabulary — "sit BEFORE this policy" — so the simulation
 * and the wizard cannot disagree about position. Null means the bottom of the interface pair, which
 * is what Apply does when nobody has dragged anything.
 */
export function insertIndex(
  live: FirewallPolicy[], beforeId: number | null, srcIntf: string, dstIntf: string,
): number {
  if (beforeId != null) {
    const i = live.findIndex((p) => p.id === beforeId);
    if (i >= 0) return i;
  }
  let last = -1;
  live.forEach((p, i) => { if (isPairRelevant(p, srcIntf, dstIntf)) last = i; });
  return last >= 0 ? last + 1 : live.length;
}

/** Why a policy cannot carry this traffic at all — the comparison FortiOS makes first. */
function pairMismatch(p: FirewallPolicy, srcIntf: string, dstIntf: string): string {
  const src = intfSet(p.src_intf_list, p.src_intf);
  if (!interfacesMatch(src, [srcIntf])) return `srcintf ${src.join("/") || "—"} ≠ ${srcIntf}`;
  const dst = intfSet(p.dst_intf_list, p.dst_intf);
  return `dstintf ${dst.join("/") || "—"} ≠ ${dstIntf}`;
}

// ── The walk ─────────────────────────────────────────────────────────────────

type Resolved = {
  src: { ranges: IPRange[]; unresolved: string[] };
  dst: { ranges: IPRange[]; unresolved: string[] };
  svc: { ports: PortRange[]; unresolved: string[] };
};

function resolveRule(r: SimRule, args: SimArgs): Resolved {
  return {
    src: resolveAddresses(r.srcAddr, args.pendingAddresses, args.ctx),
    dst: resolveAddresses(r.dstAddr, args.pendingAddresses, args.ctx),
    svc: resolveServices(r.service, args.pendingServices, args.ctx),
  };
}

/** One rule against one flow, in FortiOS's own comparison order. */
export function verdictFor(
  rule: SimRule, res: Resolved, flow: SimFlow, ingress: string, egress: string,
): SimVerdict {
  if (!rule.enabled) return { kind: "skip", reason: "disabled" };
  if (!interfacesMatch(rule.srcIntf, [ingress])) return { kind: "skip", reason: "srcintf" };
  if (!interfacesMatch(rule.dstIntf, [egress])) return { kind: "skip", reason: "dstintf" };

  const s = ipToInt(flow.srcIp), d = ipToInt(flow.dstIp);
  if (s == null || d == null) return { kind: "unsure", reason: "flow address" };

  if (!contains(res.src.ranges, s)) {
    if (res.src.unresolved.length) return { kind: "unsure", reason: `srcaddr ${res.src.unresolved.join(", ")}` };
    return { kind: "skip", reason: "srcaddr" };
  }
  if (!contains(res.dst.ranges, d)) {
    if (res.dst.unresolved.length) return { kind: "unsure", reason: `dstaddr ${res.dst.unresolved.join(", ")}` };
    return { kind: "skip", reason: "dstaddr" };
  }
  const hit = res.svc.ports.some((p) =>
    protoMatches(p.proto, flow.proto) && p.lo <= flow.port && flow.port <= p.hi);
  if (!hit) {
    if (res.svc.unresolved.length) return { kind: "unsure", reason: `service ${res.svc.unresolved.join(", ")}` };
    return { kind: "skip", reason: "service" };
  }
  return { kind: "match" };
}

// ── Sample flows ─────────────────────────────────────────────────────────────

/**
 * The three flows the walk sends.
 *
 * One is the traffic the proposal is ABOUT. The other two are taken from rules on the same
 * interface pair, nearest the insertion point first, because those are the rules a new policy
 * silently kills — and watching a packet that used to be theirs die one row higher is the only way
 * that fact reads as a consequence rather than as a table entry.
 *
 * THE SAME PACKETS IN EVERY RUN. The candidate list is built from the LIVE table and never from the
 * proposal's own effects, so "Today" and "After Apply" send an identical set. Deriving them from
 * the rules the change happens to kill produced three flows in one run and one in the next, and two
 * pictures of different traffic cannot be compared — which is the entire point of showing both.
 *
 * A flow is only produced from a rule whose source reduces to a real range, so nothing here is
 * invented: every address sent is one the device's own configuration names.
 */
function deriveFlows(
  proposal: SimRule, propRes: Resolved, below: { rule: SimRule; res: Resolved }[],
  ctx: FlowContext, ingress: string, egress: string,
): SimFlow[] {
  const out: SimFlow[] = [];
  const seen = new Set<string>();
  const usedPorts = new Set<string>();
  const letters = ["A", "B", "C", "D"];
  const egressInternet = isInternetEgress(ctx, egress);

  /** A plausible source address for a side that resolves to "everything". */
  const ifaceHost = (): string | null => {
    const fact = ctx.interfaces.get(ingress);
    const net = fact?.ip ? parseNetworkValue(fact.ip) : null;
    return net ? firstHost(net) : null;
  };

  const dstFor = (res: Resolved): { ip: string; text: string; unbounded: boolean } => {
    if (!isUnbounded(res.dst.ranges) && res.dst.ranges.length) {
      const ip = firstHost(res.dst.ranges[0]);
      if (ip) return { ip, text: rangeLabel(res.dst.ranges[0]), unbounded: false };
    }
    // "all" as the destination. Out an internet-facing interface that is the internet; out an
    // internal one (a DMZ, a server segment) it is "everything on that network", NOT the internet.
    // 8.8.8.8 is a real public address that stands in for the walk's arithmetic either way; the text
    // names what the egress actually reaches so the number never reads as a finding.
    const text = egressInternet ? "the internet" : `the ${egress} network`;
    return { ip: "8.8.8.8", text, unbounded: true };
  };

  /** Push one concrete packet, de-duplicated on source+port and capped at the letter count. */
  const add = (
    srcIp: string, dst: { ip: string; text: string; unbounded: boolean },
    proto: string, port: number, label: string, service: string, origin: string,
    synthetic = false,
  ): boolean => {
    if (out.length >= letters.length) return false;
    const key = `${srcIp}:${proto}:${port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    usedPorts.add(`${proto}:${port}`);
    out.push({
      id: letters[out.length],
      label, srcIp, dstIp: dst.ip, dstUnbounded: dst.unbounded, proto, port,
      service, origin, synthetic,
    });
    return true;
  };

  const push = (rule: SimRule, res: Resolved, origin: string) => {
    if (out.length >= letters.length) return;
    // Falling back to the ingress interface's own subnet is right for a source that is genuinely
    // `all` — "everything behind that port" is what the rule means. It is WRONG for a source that
    // merely failed to resolve: sending a packet from 10.0.1.1 on behalf of a rule whose srcaddr is
    // an FQDN would be the console inventing traffic and then drawing conclusions from it.
    if (!res.src.ranges.length && res.src.unresolved.length) return;
    const srcIp = (isUnbounded(res.src.ranges) || !res.src.ranges.length
      ? ifaceHost()
      : firstHost(res.src.ranges[0])) ?? null;
    if (!srcIp) return;
    const { proto, port } = pickPort(res.svc.ports, usedPorts);
    add(srcIp, dstFor(res), proto, port,
      `${nameList(rule.srcAddr)} → ${dstFor(res).text} on ${nameList(rule.service)}`,
      nameList(rule.service), origin);
  };

  push(proposal, propRes, "The traffic this policy is about");
  for (const b of below) {
    push(b.rule, b.res, `Taken from "${b.rule.name}" — a rule below the new one on the same interface pair`);
  }

  // ── Contrast flows ───────────────────────────────────────────────────────────
  //
  // The point somebody is at here is "what will this rule actually do?", and one dot cannot answer
  // it. So the remaining lanes are filled to make the rule's SCOPE visible: a few more services it
  // lets through, and — only when it genuinely restricts the service — one it does NOT cover, so the
  // boundary is on screen rather than implied.
  //
  // These never invent a verdict. Each is a real packet from the proposal's own source, walked down
  // the same real table; a flow the rule does not claim shows whatever the table actually does with
  // it (usually the implicit deny). They are marked `synthetic` so they enrich the picture without
  // being counted as a consequence of the change — a boundary flow that the implicit deny drops was
  // already being dropped, and must not read as "this accept rule drops traffic".
  //
  // A fully-open rule (service ALL) has no uncovered service, so nothing is shown as blocked — which
  // is the truth: an all-services rule blocks nothing on its path.
  const rep = out.find((f) => !f.synthetic && f.origin.startsWith("The traffic this policy"));
  if (rep && out.length < letters.length) {
    const dst = dstFor(propRes);
    const svcIsAll = proposal.service.length === 0 || proposal.service.some((s) => /^(all|any)$/i.test(s));
    const covers = (proto: string, port: number) =>
      svcIsAll || propRes.svc.ports.some((p) => protoMatches(p.proto, proto) && p.lo <= port && port <= p.hi);
    const COMMON: [string, number][] = [["TCP", 443], ["UDP", 53], ["TCP", 80], ["TCP", 22], ["TCP", 3389]];
    const label = (proto: string, port: number) =>
      `${nameList(proposal.srcAddr)} → ${dst.text} on ${port}/${proto.toLowerCase()}`;

    // One service the rule does NOT cover — the clearest boundary — when it restricts the service.
    if (!svcIsAll) {
      for (const [proto, port] of COMMON) {
        if (covers(proto, port) || usedPorts.has(`${proto}:${port}`)) continue;
        if (add(rep.srcIp, dst, proto, port, label(proto, port), `${port}/${proto.toLowerCase()}`,
          "A service the new rule does not cover — shown so its limit is visible", true)) break;
      }
    }
    // Fill the rest with other services the rule DOES claim, so the picture shows the breadth of
    // what the one rule decides rather than a single port.
    const verb = proposal.action === "accept" ? "allows" : "blocks";
    for (const [proto, port] of COMMON) {
      if (out.length >= letters.length) break;
      if (!covers(proto, port) || usedPorts.has(`${proto}:${port}`)) continue;
      add(rep.srcIp, dst, proto, port, label(proto, port), `${port}/${proto.toLowerCase()}`,
        `Another service the new rule ${verb}`, true);
    }
  }

  return out;
}

// ── The scenario ─────────────────────────────────────────────────────────────

const PER_ROW = 300, INGRESS_MS = 560, VERDICT_MS = 1500, HOLD_MS = 900;

export function buildScenario(args: SimArgs): Scenario {
  const { ctx, phase } = args;
  const name = args.draft.form.name ?? args.draft.target;
  const p = policyImpact(name, args.draft.form);
  const ingress = p.srcIntf || "any";
  const egress = p.dstIntf || "any";

  const proposal: SimRule = {
    key: "new", id: null, name: name || "new policy", shown: 0,
    srcIntf: ingress ? [ingress] : [], dstIntf: egress ? [egress] : [],
    srcAddr: p.srcAddr, dstAddr: p.dstAddr, service: p.service,
    action: p.action, nat: p.nat, profiles: p.profiles,
    enabled: true, isNew: true, state: "new", note: "",
  };
  const propRes = resolveRule(proposal, args);

  const live = ctx.policies;
  const cut = insertIndex(live, args.beforeId, ingress, egress);

  // ── The blocking rule: the first policy ABOVE the insertion point that already claims
  //    everything the proposal would. This is what makes an appended rule dead on arrival, and it
  //    is also what the "place it above" run needs to know.
  let blockedById: number | null = null;
  let blockedByName = "";
  for (let i = 0; i < cut; i++) {
    const r = toSimRule(live[i]);
    if (!r.enabled) continue;
    if (!isPairRelevant(live[i], ingress, egress)) continue;
    const res = resolveRule(r, args);
    const decidable = !res.src.unresolved.length && !res.dst.unresolved.length && !res.svc.unresolved.length
      && !propRes.src.unresolved.length && !propRes.dst.unresolved.length && !propRes.svc.unresolved.length;
    if (!decidable) continue;
    if (rangesCover(res.src.ranges, propRes.src.ranges)
      && rangesCover(res.dst.ranges, propRes.dst.ranges)
      && servicesCover(res.svc.ports, propRes.svc.ports)) {
      blockedById = r.id; blockedByName = r.name; break;
    }
  }

  // For the "fixed" run, place the proposal immediately above whatever was blocking it.
  const effectiveCut = phase === "fixed" && blockedById != null
    ? live.findIndex((x) => x.id === blockedById)
    : cut;

  // ── The ordered list this run walks ──
  const ordered: SimRule[] = live.map(toSimRule);
  if (phase !== "before") {
    ordered.splice(effectiveCut < 0 ? cut : effectiveCut, 0, proposal);
  }
  const newIdx = ordered.findIndex((r) => r.isNew);

  const liveById = new Map(live.map((x) => [x.id, x]));

  // ── Rule states ──
  //
  // Only rules on the same interface pair can be affected at all: FortiOS rejects the others before
  // it ever looks at an address, so a rule on a different pair is untouched however wide the new
  // one is.
  if (newIdx >= 0) {
    ordered.forEach((r, i) => {
      if (r.isNew || !r.enabled) return;
      const raw = r.id != null ? liveById.get(r.id) : undefined;
      if (!raw || !isPairRelevant(raw, ingress, egress)) return;
      const res = resolveRule(r, args);
      const decidable = !res.src.unresolved.length && !res.dst.unresolved.length && !res.svc.unresolved.length
        && !propRes.src.unresolved.length && !propRes.dst.unresolved.length && !propRes.svc.unresolved.length;
      const covers = decidable
        && rangesCover(propRes.src.ranges, res.src.ranges)
        && rangesCover(propRes.dst.ranges, res.dst.ranges)
        && servicesCover(propRes.svc.ports, res.svc.ports);
      const overlaps = rangesIntersect(propRes.src.ranges, res.src.ranges)
        && rangesIntersect(propRes.dst.ranges, res.dst.ranges)
        && servicesIntersect(propRes.svc.ports, res.svc.ports);

      if (i > newIdx) {
        if (covers) {
          r.state = "dead";
          r.note = `Everything it matches is already claimed by "${proposal.name}" one row above, so it can never run again.`;
        } else if (overlaps) {
          r.state = "narrowed";
          r.note = `Still matches, but the part it shares with "${proposal.name}" now stops one row higher.`;
        }
      } else if (covers) {
        r.state = "survives";
        r.note = "Survives only because it sits ABOVE the new rule — reorder the table and it dies.";
      }
    });
    if (blockedById != null && effectiveCut === cut && phase === "after") {
      proposal.state = "unreachable";
      proposal.note = `"${blockedByName}" already matches this traffic and sits above it, so the new rule can never run.`;
    }
  }

  // ── Collapse into rows ──
  const rows: SimRow[] = [];
  let bandCount = 0;
  const bandWhy = new Set<string>();
  const flushBand = () => {
    if (!bandCount) return;
    rows.push({
      kind: "band", count: bandCount,
      why: bandWhy.size === 1 ? [...bandWhy][0] : "different interface pair",
    });
    bandCount = 0; bandWhy.clear();
  };
  for (const r of ordered) {
    const raw = r.id != null ? liveById.get(r.id) : undefined;
    if (!r.isNew && raw && !isPairRelevant(raw, ingress, egress)) {
      bandCount++; bandWhy.add(pairMismatch(raw, ingress, egress));
      continue;
    }
    flushBand();
    rows.push({ kind: "rule", ...r });
  }
  flushBand();
  // The implicit deny is part of the table, not a footnote: it is what claims a packet no policy
  // wanted, and leaving it off makes "nothing matched" look like a gap in the picture.
  rows.push({
    kind: "rule", key: "implicit", id: null, name: "Implicit deny", shown: 0,
    srcIntf: [], dstIntf: [], srcAddr: ["all"], dstAddr: ["all"], service: ["ALL"],
    action: "deny", nat: false, profiles: [], enabled: true, isNew: false,
    state: "survives", note: "",
  });

  // Display numbering — what the device's table would show after the change.
  let n = 0;
  for (const row of rows) {
    if (row.kind === "band") { n += row.count; continue; }
    if (row.key === "implicit") continue;
    row.shown = ++n;
  }

  // ── Flows ──
  //
  // Built from `live` — the table as it stands — so every run walks the same packets. The rules
  // BELOW the insertion point come first because they are the ones at risk; the ones above follow,
  // so a table where nothing sits below the new rule still gets more than one flow.
  const relevant = live.filter((x) => isPairRelevant(x, ingress, egress));
  const cutId = live[cut]?.id;
  const cutAt = cutId != null ? relevant.findIndex((x) => x.id === cutId) : relevant.length;
  const ordered2 = cutAt < 0
    ? relevant
    : [...relevant.slice(cutAt), ...relevant.slice(0, cutAt)];
  const flowSources = ordered2.map((x) => {
    const r = toSimRule(x);
    return { rule: r, res: resolveRule(r, args) };
  });
  const flows = deriveFlows(proposal, propRes, flowSources, ctx, ingress, egress);

  // ── Walk each flow ──
  const results: SimFlowResult[] = flows.map((flow) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.kind === "band") continue;
      const res = row.key === "implicit"
        ? { src: { ranges: [{ ...FULL_RANGE }], unresolved: [] },
            dst: { ranges: [{ ...FULL_RANGE }], unresolved: [] },
            svc: { ports: [{ proto: "ANY", lo: 0, hi: 65535 }], unresolved: [] } }
        : resolveRule(row, args);
      const v = row.key === "implicit"
        ? ({ kind: "match" } as SimVerdict)
        : verdictFor(row, res, flow, ingress, egress);
      if (v.kind === "match") {
        const inspected = row.action === "accept" && row.profiles.length > 0;
        return {
          flow, rowIndex: i, rule: row,
          outcome: row.action === "deny" ? "dropped" : inspected ? "inspected" : "allowed",
        };
      }
      if (v.kind === "unsure") {
        return { flow, rowIndex: i, rule: row, outcome: "unknown", blockedBy: v.reason };
      }
    }
    return { flow, rowIndex: rows.length - 1, rule: null, outcome: "dropped" };
  });

  // ── Stages ──
  const maxIdx = results.length ? Math.max(...results.map((r) => r.rowIndex)) : 0;
  const lookupEnd = INGRESS_MS + (maxIdx + 1) * PER_ROW;
  const bandCountTotal = rows.reduce((s, r) => s + (r.kind === "band" ? r.count : 0), 0);
  const shownRules = rows.filter((r) => r.kind === "rule" && r.key !== "implicit").length;
  // Read from `rows`, not from `ordered`. The collapse loop spreads each rule into a NEW object,
  // and the display numbering that follows writes `shown` onto those copies — so the entries in
  // `ordered` still carry shown: 0, and every consequence sentence would name rule "#0".
  const numbered = rows.filter(
    (r): r is { kind: "rule" } & SimRule => r.kind === "rule" && r.key !== "implicit");
  const dead = numbered.filter((r) => r.state === "dead");
  // The verdict reads REAL flows only. A synthetic contrast flow is drawn to show the rule's scope,
  // not to be counted — a boundary flow the implicit deny drops was already dropped, and letting it
  // raise the "flows dropped" count would make an accept rule read as if it blocked traffic.
  const realResults = results.filter((r) => !r.flow.synthetic);
  const dropped = realResults.filter((r) => r.outcome === "dropped").length;

  const narrowed = numbered.filter((r) => r.state === "narrowed");
  const simulatesProposal = propRes.src.ranges.length > 0;
  const headline = buildHeadline(
    phase, proposal, dead, narrowed, realResults, dropped, propRes, blockedByName, simulatesProposal,
    isInternetEgress(ctx, egress));

  const stages: SimStage[] = [
    { id: "ingress", title: "Ingress", from: 0, to: INGRESS_MS,
      detail: `${results.length} sample flow${results.length === 1 ? "" : "s"} enter on ${ingress}.` },
    { id: "lookup", title: "Policy lookup", from: INGRESS_MS, to: lookupEnd,
      detail: bandCountTotal
        ? `Tested top to bottom. ${bandCountTotal} of the ${bandCountTotal + shownRules} policies never share this interface pair and are folded into the grey bands.`
        : "Tested top to bottom — the first rule that matches decides, and nothing below it is consulted." },
    { id: "verdict", title: "Verdicts", from: lookupEnd, to: lookupEnd + VERDICT_MS,
      detail: headline.detail },
    { id: "impact", title: "Impact", from: lookupEnd + VERDICT_MS, to: lookupEnd + VERDICT_MS + HOLD_MS,
      detail: headline.title },
  ];

  const firstAllowed = realResults.find((r) => r.outcome === "allowed" || r.outcome === "inspected");

  const unresolved = Array.from(new Set([
    ...propRes.src.unresolved, ...propRes.dst.unresolved, ...propRes.svc.unresolved,
  ]));

  return {
    phase, rows, flows: results, stages,
    duration: lookupEnd + VERDICT_MS + HOLD_MS,
    perRow: PER_ROW, ingressMs: INGRESS_MS,
    ingress, egress,
    egressIsInternet: isInternetEgress(ctx, egress),
    ingressIsInternet: isInternetEgress(ctx, ingress),
    source: {
      label: nameList(proposal.srcAddr),
      // An unresolved source is not an unrestricted one. Printing "0.0.0.0/0 · unrestricted" for a
      // policy whose srcaddr is an FQDN would overstate its reach by four billion addresses.
      value: propRes.src.ranges.length
        ? (isUnbounded(propRes.src.ranges) ? "0.0.0.0/0" : propRes.src.ranges.map(rangeLabel).join(", "))
        : `${propRes.src.unresolved.join(", ") || "—"} · not an address range`,
      hosts: hostCount(propRes.src.ranges),
      unbounded: isUnbounded(propRes.src.ranges),
    },
    utm: firstAllowed?.rule?.profiles ?? [],
    headline,
    ledger: buildLedger(rows, phase),
    breaks: buildBreaks(phase, proposal, dead, narrowed, results, unresolved),
    unresolved,
    blockedById, blockedByName, simulatesProposal,
  };
}

// ── The three answers, written out ───────────────────────────────────────────

function buildHeadline(
  phase: SimPhase, proposal: SimRule, dead: SimRule[], narrowed: SimRule[],
  results: SimFlowResult[], dropped: number, propRes: Resolved, blockedByName: string,
  simulatesProposal: boolean, egressIsInternet: boolean,
): SimHeadline {
  // "the internet" only when an unbounded destination genuinely leaves by an internet-facing
  // interface; an "all" destination out a DMZ/internal port reaches "their destination", not the net.
  const reachText = results[0]?.flow.dstUnbounded && egressIsInternet ? "the internet" : "their destination";
  const scope = isUnbounded(propRes.src.ranges) || !propRes.src.ranges.length
    ? "every source"
    : `${hostCount(propRes.src.ranges).toLocaleString()}`;
  const scopeLabel = scope === "every source" ? "unrestricted source" : "addresses in scope";

  if (phase === "before") {
    const out = results.filter((r) => r.outcome !== "dropped").length;
    return {
      tone: "info",
      title: "The rule base as it stands, before anything is applied",
      detail: `${out} of ${results.length} sample flows reach ${reachText} today.`,
      nums: [
        { v: `${out}/${results.length}`, l: "flows getting through" },
        { v: String(results.filter((r) => r.outcome === "inspected").length), l: "of them inspected" },
        { v: scope, l: scopeLabel },
      ],
    };
  }

  if (!simulatesProposal) {
    const names = propRes.src.unresolved.join(", ") || "its source";
    return {
      tone: "warn",
      title: "This policy's own traffic could not be simulated",
      detail: `${names} does not reduce to an address range — an FQDN, a geography object, or a name the device did not answer for — so there is no packet that stands for what this rule would carry. The rule states below are still computed wherever the comparison was decidable, and any flow drawn belongs to another rule.`,
      nums: [
        { v: String(dead.length), l: dead.length === 1 ? "rule becomes dead" : "rules become dead" },
        { v: String(propRes.src.unresolved.length), l: "source objects unresolved" },
        { v: "—", l: "flows for this rule" },
      ],
    };
  }

  if (proposal.state === "unreachable") {
    return {
      tone: "warn",
      title: "Nothing changes — the new rule is unreachable where Apply would put it",
      detail: `“${blockedByName}” already matches this traffic and sits above it. FortiOS stops at the first match, so the firewall would behave exactly as it does now.`,
      nums: [
        { v: "0", l: "rules become dead" },
        { v: `0/${results.length}`, l: "flows affected" },
        { v: blockedByName ? `“${blockedByName}”` : "—", l: "rule that still wins" },
      ],
    };
  }

  const flowText = `${dropped} of the ${results.length} sample flow${results.length === 1 ? "" : "s"} ${dropped === 1 ? "is" : "are"} dropped`;
  const tone: Tone = dead.length || dropped ? "deny" : narrowed.length ? "warn" : "allow";
  const title = dead.length
    ? `${dead.length} rule${dead.length === 1 ? "" : "s"} stop working${dropped ? `, and ${flowText}` : ""}`
    : dropped
      ? flowText
      : narrowed.length
        ? `${narrowed.length} rule${narrowed.length === 1 ? "" : "s"} keep${narrowed.length === 1 ? "s" : ""} matching, but carry less`
        : "No existing rule is affected";
  // Two whole sentences rather than one with its pronouns swapped in: the console translates a
  // sentence, and "…wider than {} below it, so {} unreachable" filled with "the rule" / "it
  // becomes" has no translation that reads — "it" and "they" alone never reach the dictionary.
  const detail = dead.length === 1
    ? "The new rule is wider than the rule below it, so that rule becomes unreachable. Nothing is deleted and the device gives no warning — it simply never matches again."
    : dead.length
    ? "The new rule is wider than the rules below it, so they become unreachable. Nothing is deleted and the device gives no warning — they simply never match again."
    : narrowed.length
      ? "Nothing below it becomes unreachable, but the traffic they share now stops one row higher. Each of those rules still matches what the new one does not claim."
      : "Every other rule on this interface pair still matches traffic the new one does not claim.";

  return {
    tone, title, detail,
    nums: [
      { v: String(dead.length), l: dead.length === 1 ? "rule becomes dead" : "rules become dead" },
      ...(narrowed.length
        ? [{ v: String(narrowed.length), l: narrowed.length === 1 ? "rule narrowed" : "rules narrowed" }]
        : []),
      { v: `${dropped}/${results.length}`, l: "sample flows dropped" },
      { v: scope, l: scopeLabel },
    ],
  };
}

const STATE_ORDER: RuleState[] = ["unreachable", "dead", "narrowed", "new", "survives"];

function buildLedger(rows: SimRow[], phase: SimPhase): LedgerEntry[] {
  if (phase === "before") return [];
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    if (r.kind !== "rule" || r.key === "implicit") continue;
    if (r.state === "survives" && !r.note) continue;
    out.push({
      key: r.key, shown: r.shown, name: r.name,
      summary: `${nameList(r.srcAddr)} → ${nameList(r.dstAddr)} · ${nameList(r.service)}`,
      action: r.action, state: r.state, note: r.note,
    });
  }
  return out.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.shown - b.shown);
}

/**
 * The consequences, stated in services and networks.
 *
 * A dead rule is a fact about the table. "FTP stops for Finance-Hosts" is the same fact in the
 * words of whoever gets the call, and it is the reason this panel exists rather than a diff.
 */
function buildBreaks(
  phase: SimPhase, proposal: SimRule, dead: SimRule[], narrowed: SimRule[],
  results: SimFlowResult[], unresolved: string[],
): BreakItem[] {
  if (phase === "before") return [];
  const out: BreakItem[] = [];

  if (proposal.state === "unreachable") {
    out.push({
      kind: "care", port: "—",
      title: "The change you asked for does not happen",
      detail: "No traffic is affected and no rule changes. Applying this and walking away leaves the firewall exactly as it was — move the rule above the one that shadows it first.",
    });
  }

  for (const r of dead) {
    out.push({
      kind: "stop",
      port: nameList(r.service),
      title: `${nameList(r.service)} stops for ${nameList(r.srcAddr)}`,
      detail: `"${r.name}" (#${r.shown}) was permitting it on this path and can no longer be reached. Nothing on the device reports this; the traffic simply starts failing.`,
    });
  }

  const unknown = results.filter((r) => r.outcome === "unknown");
  for (const u of unknown) {
    out.push({
      kind: "care", port: portText(u.flow.proto, u.flow.port),
      title: `Flow ${u.flow.id} could not be evaluated`,
      detail: `The walk stopped at "${u.rule?.name}" because ${u.blockedBy} cannot be reduced to an address range — an FQDN, a geography object, or a name the device did not answer for. No conclusion is drawn about it either way.`,
    });
  }

  if (proposal.state !== "unreachable") {
    if (proposal.action === "accept") {
      out.push({
        kind: "keep",
        port: nameList(proposal.service),
        title: `${nameList(proposal.service)} keeps working for ${nameList(proposal.srcAddr)}`,
        detail: proposal.profiles.length
          ? `And it is now inspected by ${proposal.profiles.join(", ")}.`
          : "No security profile is attached, so it passes without being scanned.",
      });
    } else {
      const scope = nameList(proposal.srcAddr);
      out.push({
        kind: "stop",
        port: nameList(proposal.service),
        title: `${scope} is blocked on ${nameList(proposal.service)}`,
        detail: `Out of ${proposal.dstIntf.join(", ") || "the egress interface"}. Anything on that network that still needs to get out needs a rule ABOVE this one, created in the same change.`,
      });
    }
  }

  if (unresolved.length) {
    out.push({
      kind: "care", port: "—",
      title: "Part of this proposal could not be evaluated",
      detail: `${unresolved.join(", ")} does not reduce to an address range or a port set, so no containment claim is made about it. The rules above may be affected in ways this simulation cannot see.`,
    });
  }

  for (const r of narrowed) {
    out.push({
      kind: "care",
      port: nameList(r.service),
      title: `"${r.name}" (#${r.shown}) carries less than it did`,
      detail: `It still matches ${nameList(r.srcAddr)} → ${nameList(r.dstAddr)} on ${nameList(r.service)}, minus the part "${proposal.name}" now claims one row above. Worth checking that what it keeps is still what it was written for.`,
    });
  }

  if (!dead.length && !narrowed.length && !unknown.length && proposal.state !== "unreachable") {
    out.push({
      kind: "keep", port: "—",
      title: "No other rule is shadowed",
      detail: "Nothing else on this interface pair is covered by the new rule, so every existing policy still matches exactly the traffic it did before.",
    });
  }
  return out;
}

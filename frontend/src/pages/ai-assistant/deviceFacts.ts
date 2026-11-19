// deviceFacts — what the firewall already has, and what one AI answer would add to it.
//
// WHY THIS FILE EXISTS. These types and helpers used to live at the top of flowModel.ts, above a
// thousand lines that turned a proposal into boxes and arrows. That drawing code is gone — the
// Simulate panel replaced it — but three things in it were never about drawing at all:
//
//   · FlowContext, the device's own addresses / services / interfaces / policy table, which
//     flowContext.ts fills and flowImpact.ts measures a proposal against;
//   · pendingObjectMaps, the objects an answer CREATES, so a policy can be evaluated even though
//     half the objects it references do not exist on the device yet;
//   · hasFlowDrafts, the question "is there anything here to simulate at all".
//
// They are the device-facts layer, so they are named for that rather than for a picture nothing
// draws any more. The type is still called FlowContext: it is threaded through flowImpact.ts,
// flowContext.ts and their tests, and renaming it would be churn with no reader on the other side.

import type { AddressFormState } from "../fw-addresses/address-form.logic";
import type { ServiceFormState } from "../fw-services/service-form.logic";
import type { FirewallPolicy, ScheduleForm } from "../../api/policyObject";
import type { ChatItem } from "./index";
import { fgSubnetToCIDR } from "./fgFormat";

// ── What the device already has ──────────────────────────────────────────────

export type FlowInterfaceFact = { name: string; alias?: string; role?: string; ip?: string };

export type FlowContext = {
  /** Address object name → its value ("10.0.1.0/24", "youtube.com", …). */
  addresses: Map<string, string>;
  /** Address object name → the interface it is LOCKED to, if any. */
  addressIface: Map<string, string>;
  interfaces: Map<string, FlowInterfaceFact>;
  /** Service name → "TCP/443". */
  services: Map<string, string>;
  /**
   * The firewall's live policy table, in its real order. This is what flowImpact.ts measures a
   * proposal AGAINST ("does a rule above this one already match?") and what packetSim.ts walks.
   */
  policies: FirewallPolicy[];
  /**
   * Interfaces that lead to the internet: the ones a default route points out of.
   *
   * A fact, not a guess. The `role` field would be the obvious source, but it is optional and
   * routinely wrong — the lab FortiGate has its actual WAN port tagged `role lan` — and "all" on
   * an internet-facing interface means something completely different from "all" on a LAN one.
   */
  internetIfaces: Set<string>;
};

export const EMPTY_FLOW_CONTEXT: FlowContext = {
  addresses: new Map(),
  addressIface: new Map(),
  interfaces: new Map(),
  services: new Map(),
  policies: [],
  internetIfaces: new Set(),
};

// ── Value formatting ─────────────────────────────────────────────────────────

/** The value of an address object, from a parsed draft — the "10.0.1.0/24" the user asked for. */
export function addressDetail(f: Partial<AddressFormState>): string {
  switch (f.type) {
    case "iprange":          return (f.ipRange ?? "").replace("-", " – ");
    case "fqdn":             return f.fqdn ?? "";
    case "geography":        return f.country ? `Country ${f.country}` : "";
    case "mac":              return (f.macAddrs ?? []).filter(Boolean).join(", ");
    case "dynamic":          return f.sdn ? `SDN ${f.sdn}` : (f.subType ?? "");
    case "interface-subnet": return f.subnet ? fgSubnetToCIDR(f.subnet) : (f.iface ?? "");
    default:
      // No `set type` at all: whichever value field the CLI filled in decides what it is.
      if (f.subnet) return fgSubnetToCIDR(f.subnet);
      return f.fqdn || (f.ipRange ?? "").replace("-", " – ");
  }
}

/** The ports of a custom service, in the notation the Services page uses ("TCP/443"). */
export function serviceDetail(f: Partial<ServiceFormState>): string {
  if (f.protocol === "IP") return f.ipProto ? `IP/${f.ipProto}` : "IP/any";
  if (f.protocol === "ICMP" || f.protocol === "ICMPv6") {
    const type = f.icmpType;
    if (type == null || type < 0) return `${f.protocol}/any`;
    const code = f.icmpCode != null && f.icmpCode >= 0 ? `/${f.icmpCode}` : "";
    return `${f.protocol}/${type}${code}`;
  }
  const ports = (f.destPorts ?? [])
    .filter((e) => e.low)
    .map((e) => `${e.protocol}/${e.high && e.high !== e.low ? `${e.low}-${e.high}` : e.low}`);
  return ports.join(" ");
}

const DAY_SHORT: Record<string, string> = {
  sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat",
};

/** When a schedule is active, in one line. */
export function scheduleDetail(f: ScheduleForm): string {
  if (f.type === "group") return `${(f.member ?? []).length} members`;
  const time = [f.start, f.end].filter(Boolean).join(" – ");
  if (f.type === "onetime") return time || "—";
  const days = (f.day ?? []).map((d) => DAY_SHORT[d] ?? d).join(" ");
  return [days, time].filter(Boolean).join(" · ") || "Every day";
}

// ── Entry points ─────────────────────────────────────────────────────────────

/** Whether this chat message has anything worth simulating or listing. */
export function hasFlowDrafts(item: ChatItem): boolean {
  return Boolean(
    item.policyDrafts?.length || item.addrDrafts?.length || item.svcDrafts?.length ||
    item.schedDrafts?.length || item.vipDrafts?.length || item.routeDraft || item.vpnDraft ||
    item.avDraft || item.webDraft || item.dnsDraft || item.appDraft || item.ffDraft ||
    item.ulDrafts?.length || item.ugDrafts?.length ||
    item.ldapDrafts?.length || item.radDrafts?.length ||
    item.prereqBlocks?.length,
  );
}

/** Whether this message proposes at least one POLICY — the only thing the walk can simulate. */
export function hasPolicyDrafts(item: ChatItem): boolean {
  return Boolean(item.policyDrafts?.length);
}

/**
 * The objects this answer CREATES, name → value.
 *
 * Shared by the simulation (so a rule referencing an object the device has never heard of can still
 * be reduced to a range) and by the impact analysis, which measures a proposal against the live
 * policy table even though half its objects do not exist yet.
 */
export function pendingObjectMaps(item: ChatItem): {
  addresses: Map<string, string>; services: Map<string, string>;
} {
  const addresses = new Map<string, string>();
  for (const a of item.addrDrafts ?? []) {
    const name = a.form.name ?? a.target;
    if (name) addresses.set(name, addressDetail(a.form));
  }
  // A VIP is a valid dstaddr, so it belongs in the same lookup — a policy pointing at one should
  // resolve to the external IP it forwards, not stay an unresolvable name.
  for (const v of item.vipDrafts ?? []) {
    const name = v.form.name ?? v.target;
    if (name) addresses.set(name, v.form.ext_ip || v.form.ext_addr || "");
  }
  const services = new Map<string, string>();
  for (const s of item.svcDrafts ?? []) {
    const name = s.form.name ?? s.target;
    if (name) services.set(name, serviceDetail(s.form));
  }
  return { addresses, services };
}

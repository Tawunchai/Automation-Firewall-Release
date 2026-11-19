import type { FixPlan, FixStep, PolicyTrace, PolicyVerdict, RouteAnswer, TraceCheck } from "../../api/troubleshoot";

// What the Troubleshooting page says about a trace — pure, so every sentence can be pinned by a
// test. The backend returns facts (which rule, which checks, which routes, which links); this turns
// them into the three things the page draws:
//
//   stages       the packet's path, stage by stage, for the animation — and where it stops
//   steps        the diagnosis checklist, one line per thing that can go wrong
//   fixes        what to do about it, specific to this trace
//
// Sentences are whole, with values dropped in, never glued from fragments: the console translates a
// sentence, and a sentence assembled from pieces has no entry to match.

export type StageState = "ok" | "fail" | "warn" | "off" | "skip";

export type StageKey = "source" | "ingress" | "route" | "policy" | "nat" | "inspect" | "egress" | "destination";

export type Stage = {
  key: StageKey;
  /** Small caption above the node: what this stage is. */
  title: string;
  /** Main line under the node. */
  label: string;
  /** Second line under the node. */
  sub: string;
  state: StageState;
};

const PROTO: Record<number, string> = { 1: "ICMP", 6: "TCP", 17: "UDP", 58: "ICMPv6", 132: "SCTP" };

/** "TCP/443", "ICMP", "IP protocol 47". */
export function serviceOf(t: PolicyTrace): string {
  const p = t.query.protocol;
  if (p === 6 || p === 17 || p === 132) return `${PROTO[p]}/${t.query.dst_port}`;
  return PROTO[p] ?? `IP protocol ${p}`;
}

function linkState(link: PolicyTrace["ingress_link"]): StageState {
  if (!link) return "ok";
  return link.link ? "ok" : "fail";
}

/**
 * The packet's path through the firewall, stage by stage.
 *
 * Stages after the one that stops the packet are "skip": they are drawn greyed, because the packet
 * never got there — which is the whole picture the animation is for.
 */
export function flowStages(t: PolicyTrace): Stage[] {
  const accepted = t.verdict === "allowed";
  const m = t.matched;
  const stages: Stage[] = [
    { key: "source", title: "Source", label: t.query.src_ip, sub: serviceOf(t), state: "ok" },
    {
      key: "ingress", title: "In", label: t.ingress || "?",
      sub: t.ingress_link ? (t.ingress_link.link ? "link up" : "link down") : t.ingress_via === "user" ? "chosen" : "from route",
      state: t.ingress ? linkState(t.ingress_link) : "warn",
    },
    {
      key: "route", title: "Routing", label: t.routable ? t.egress_route.network : "No route",
      sub: t.routable ? `via ${t.egress_route.gateway}` : `to ${t.query.dst_ip}`,
      state: t.routable ? "ok" : "fail",
    },
    {
      key: "policy", title: "Policy",
      // Id 0 is a policy a what-if created: the device has not assigned it an id yet.
      label: m ? (m.policy_id ? `#${m.policy_id}` : "New policy") : t.verdict === "implicit-deny" ? "Implicit deny" : "—",
      sub: m ? (m.name || "(unnamed)") : t.verdict === "implicit-deny" ? "no policy matched" : "",
      state: !t.routable ? "skip" : accepted ? "ok" : "fail",
    },
    {
      key: "nat", title: "NAT",
      label: t.dnat ? "DNAT" : t.snat ? "SNAT" : "No NAT",
      sub: t.dnat ? `→ ${t.dnat.mapped_ip}` : t.snat ? (t.snat.mode === "pool" ? (t.snat.pools ?? []).join(", ") : `as ${t.snat.ip || t.egress}`) : "",
      state: !accepted ? "skip" : t.snat || t.dnat ? "ok" : "off",
    },
    {
      key: "inspect", title: "Inspection",
      label: m?.profiles?.length ? `${m.profiles.length} profile${m.profiles.length === 1 ? "" : "s"}` : "None",
      sub: m?.profiles?.length ? "security profiles" : "not inspected",
      state: !accepted ? "skip" : m?.profiles?.length ? "ok" : "warn",
    },
    {
      key: "egress", title: "Out", label: t.egress || "?",
      sub: t.egress_link ? (t.egress_link.link ? "link up" : "link down") : "",
      state: !accepted ? "skip" : linkState(t.egress_link),
    },
    {
      key: "destination", title: "Destination",
      label: t.dnat ? t.dnat.mapped_ip : t.query.dst_ip,
      sub: t.dnat ? `was ${t.query.dst_ip}` : accepted ? "reached" : "not reached",
      state: accepted ? "ok" : "skip",
    },
  ];
  return stages;
}

/** Index of the stage the packet stops at, or the last stage when it gets through. */
export function stopIndex(stages: Stage[]): number {
  const i = stages.findIndex((s) => s.state === "fail");
  return i === -1 ? stages.length - 1 : i;
}

// ── Who is at each end ────────────────────────────────────────────────────────

/** What the animation draws at an end of the path: a laptop, a server, or the internet. */
export type EndpointKind = "client" | "server" | "internet";

/**
 * Whether an address lives inside somebody's network rather than on the internet: RFC 1918,
 * CGNAT (100.64/10), loopback and link-local for IPv4; ULA, link-local and loopback for IPv6.
 *
 * Anything that is not a well-formed address counts as public, so a value we cannot place is drawn
 * as "the internet" — never as a host we would be inventing.
 */
export function isPrivateAddress(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o;
    return a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (s.includes(":")) return s === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(s) || /^fe[89ab][0-9a-f]?:/.test(s);
  return false;
}

/**
 * The icon for one end. A public address is the internet whichever side it is on — an inbound
 * trace to a Virtual IP starts there. A private one is a client at the source and a server at the
 * destination, which is what it is in every trace people run on this page.
 */
export function endpointKind(ip: string, side: "source" | "destination"): EndpointKind {
  if (!isPrivateAddress(ip)) return "internet";
  return side === "source" ? "client" : "server";
}

// ── The topology around the FortiGate ─────────────────────────────────────────

/**
 * The next-hop router a route goes through, or null when the network is directly connected.
 * FortiOS answers a connected route with gateway 0.0.0.0 — there is no router to draw there.
 */
export function gatewayOf(r?: RouteAnswer | null): string | null {
  const g = r?.gateway?.trim();
  if (!r?.success || !g || g === "0.0.0.0" || g === "::") return null;
  return g;
}

/** A port's negotiated speed as a badge: "100M", "1G", "2.5G". Empty when it is not known. */
export function fmtSpeed(mbps?: number): string {
  if (!mbps || mbps <= 0) return "";
  if (mbps < 1000) return `${mbps}M`;
  const g = mbps / 1000;
  return `${Number.isInteger(g) ? g : g.toFixed(1)}G`;
}

/** The addresses a packet carries on one side of the FortiGate. */
export type WireHeader = { src: string; dst: string; srcChanged: boolean; dstChanged: boolean };

/**
 * What the packet carries on the wire: as the source sent it, and as it leaves the FortiGate.
 *
 * `after` is null unless the traffic is allowed — a dropped packet never reaches the far wire, so
 * there is no header there to show. Source NAT rewrites the source (the interface address, or the
 * IP pool's name when a pool is used, since the pool picks the address per session); a Virtual IP
 * rewrites the destination, and its port too when it forwards one.
 */
export function wireHeaders(t: PolicyTrace): { before: WireHeader; after: WireHeader | null } {
  const q = t.query;
  const ported = q.protocol === 6 || q.protocol === 17 || q.protocol === 132;
  const at = (ip: string, port: string | number) => (ported && port ? `${ip}:${port}` : ip);

  const before: WireHeader = { src: q.src_ip, dst: at(q.dst_ip, q.dst_port), srcChanged: false, dstChanged: false };
  if (t.verdict !== "allowed") return { before, after: null };

  // The interface's own address when the device gave one; otherwise say WHOSE address it is rather
  // than print the interface name where an address belongs.
  const src = !t.snat ? q.src_ip
    : t.snat.mode === "pool" ? (t.snat.pools ?? []).join(", ") || q.src_ip
    : t.snat.ip || t.egress_link?.ip || `${t.egress} IP`;
  const dst = !t.dnat ? before.dst
    : at(t.dnat.mapped_ip, t.dnat.port_forward ? (t.dnat.mapped_port || t.dnat.ext_port || q.dst_port) : q.dst_port);

  return { before, after: { src, dst, srcChanged: src !== before.src, dstChanged: dst !== before.dst } };
}

// ── How to fix it ─────────────────────────────────────────────────────────────

/** What one failed check would need, in words: "enable the policy", "add 192.168.1.50 to srcaddr". */
export function checkFix(c: TraceCheck): string {
  switch (c.field) {
    case "status": return "enable the policy";
    case "srcintf": return `add ${c.got} to its incoming interfaces`;
    case "dstintf": return `add ${c.got} to its outgoing interfaces`;
    case "srcaddr": return `add ${c.got} to its source addresses`;
    case "dstaddr": return `add ${c.got} to its destination addresses`;
    case "service": return `add ${c.got} to its services`;
    case "schedule": return "make its schedule include the current time";
  }
}

/** "Policy #1 default would match if you enable the policy." */
export function closestSentence(p: PolicyVerdict): string {
  const fixes = p.checks.filter((c) => !c.ok).map(checkFix);
  const name = `#${p.policy_id} ${p.name || "(unnamed)"}`;
  return fixes.length === 1
    ? `Policy ${name} would match if you ${fixes[0]}.`
    : `Policy ${name} would match if you ${fixes[0]} and ${fixes[1]}.`;
}

const WELL_KNOWN: Record<string, string> = {
  "TCP/443": "HTTPS", "TCP/80": "HTTP", "UDP/53": "DNS", "TCP/53": "DNS", "TCP/22": "SSH",
  "TCP/3389": "RDP", "TCP/25": "SMTP", "UDP/123": "NTP", "TCP/21": "FTP", "ICMP": "PING",
};

/**
 * The CLI of a policy that would allow this traffic — a starting point, shown as text to copy.
 *
 * Addresses are placeholders on purpose: a policy needs address OBJECTS, and inventing their names
 * would print a command that fails. The console's own Firewall Policy page builds the real one.
 */
export function newPolicyCli(t: PolicyTrace): string {
  const svc = WELL_KNOWN[serviceOf(t)] ?? `<a service for ${serviceOf(t)}>`;
  return [
    "config firewall policy",
    "    edit 0",
    `        set name "allow-${t.query.src_ip}-to-${t.query.dst_ip}"`,
    `        set srcintf "${t.ingress || "<incoming interface>"}"`,
    `        set dstintf "${t.egress || "<outgoing interface>"}"`,
    `        set srcaddr "<an address object for ${t.query.src_ip}>"`,
    `        set dstaddr "<an address object for ${t.query.dst_ip}>"`,
    "        set action accept",
    '        set schedule "always"',
    `        set service "${svc}"`,
    "        set nat enable",
    "    next",
    "end",
  ].join("\n");
}

/**
 * One piece of advice. `planId` is set when the trace also carries a concrete, simulated plan for
 * it — the card then offers "Preview this fix" instead of leaving the operator to make the edit.
 */
export type Fix = { title: string; detail: string; cli?: string; link?: { label: string; to: string }; planId?: string };

/** The plan id, if the trace offers one by that id. */
const planned = (t: PolicyTrace, id: string): string | undefined =>
  t.fixes?.some((f) => f.id === id) ? id : undefined;

export function fixesFor(t: PolicyTrace): Fix[] {
  const fixes: Fix[] = [];
  const pair = `srcip==${t.query.src_ip} dstip==${t.query.dst_ip}`;
  const logLink = { label: "See the real log entries", to: `/admin/logs/local-traffic?log=forward&q=${encodeURIComponent(pair)}` };
  const createPlan = planned(t, "create");

  switch (t.verdict) {
    case "no-route":
      fixes.push({
        title: "Add a route to the destination",
        detail: `The FortiGate has no route to ${t.query.dst_ip}. Add a static route (or a default route) through the interface that leads there, and check that interface's link.`,
        link: { label: "Open Static Routes", to: "/admin/static-routes" },
      });
      break;
    case "implicit-deny":
      // The narrow fix first when there is a plan for it: a policy for exactly this connection opens
      // nothing else, while adjusting a closest rule opens everything else that rule lists.
      if (createPlan) {
        fixes.push({
          title: "Add a policy for exactly this connection",
          detail: `Nothing permits ${t.query.src_ip} → ${t.query.dst_ip} on ${serviceOf(t)}. A new policy from ${t.ingress || "the incoming interface"} to ${t.egress} would, and it lets through nothing else.`,
          planId: createPlan,
        });
      }
      for (const p of t.closest ?? []) {
        fixes.push({
          title: `Adjust policy #${p.policy_id}`,
          detail: closestSentence(p),
          link: { label: "Open Firewall Policy", to: "/admin/firewall-policy" },
          planId: planned(t, `adjust-${p.policy_id}`),
        });
      }
      if (!createPlan) {
        fixes.push({
          title: "Or add a policy for this traffic",
          detail: `Nothing permits ${t.query.src_ip} → ${t.query.dst_ip} on ${serviceOf(t)}. A new policy from ${t.ingress || "the incoming interface"} to ${t.egress} would. It must sit above any policy that denies this traffic.`,
          cli: newPolicyCli(t),
          link: { label: "Create a policy", to: "/admin/firewall-policy/create" },
        });
      }
      break;
    case "denied": {
      const m = t.matched!;
      const allowBelow = (t.shadowed ?? []).find((p) => p.action === "accept");
      if (allowBelow) {
        fixes.push({
          title: `Move policy #${allowBelow.policy_id} above #${m.policy_id}`,
          detail: `Policy #${allowBelow.policy_id} ${allowBelow.name || "(unnamed)"} would allow this traffic, but #${m.policy_id} denies it first. Moving it above #${m.policy_id} lets it take effect.`,
          link: { label: "Open Firewall Policy", to: "/admin/firewall-policy" },
          planId: planned(t, `move-${allowBelow.policy_id}`),
        });
      }
      fixes.push({
        title: `Change policy #${m.policy_id}, or put an allowing policy above it`,
        detail: `Policy #${m.policy_id} ${m.name || "(unnamed)"} is deliberately denying this traffic. If it should be allowed, narrow that policy or add an accept policy above it.`,
        link: { label: "Open Firewall Policy", to: "/admin/firewall-policy" },
        // The plan is the second half of that sentence: an accept policy for this connection, above it.
        planId: createPlan,
      });
      break;
    }
    case "allowed":
      fixes.push({
        title: "The firewall allows it — if it still fails, look beyond this policy",
        detail: "Check the security profiles on the policy in the log (a Web Filter or Application Control block shows there), that the destination is listening on that port, and that the far side can route back.",
        link: logLink,
      });
      return fixes;
  }
  fixes.push({ title: "Confirm with the log", detail: "The traffic log shows what the firewall actually did with these connections.", link: logLink });
  return fixes;
}

// ── Fix it: the words for a plan ──────────────────────────────────────────────

/** The heading of a plan, as the preview panel names it. */
export function fixTitle(plan: FixPlan): string {
  switch (plan.kind) {
    case "create":
      return plan.ref_id
        ? `A new policy for exactly this connection, above #${plan.ref_id}`
        : "A new policy for exactly this connection";
    case "move":
      return `Move policy #${plan.policy_id} ${plan.policy_name || "(unnamed)"} above #${plan.ref_id}`;
    case "adjust":
      return `Adjust policy #${plan.policy_id} ${plan.policy_name || "(unnamed)"}`;
  }
}

/** One step, as a sentence — never CLI, which the panel shows separately. */
export function stepSentence(s: FixStep): string {
  switch (s.op) {
    case "create-address":
      return `Create address ${s.name} for ${s.value}`;
    case "create-service":
      return `Create service ${s.name} for ${s.value}`;
    case "create-policy":
      return `Create policy ${s.value} for this connection`;
    case "enable-policy":
      return `Enable policy #${s.name}`;
    case "move-policy":
      return s.name === "new" ? `Place the new policy above #${s.value}` : `Move policy #${s.name} above #${s.value}`;
    case "add-member":
      switch (s.field) {
        case "srcintf": return `Add ${s.value} to the incoming interfaces of policy #${s.name}`;
        case "dstintf": return `Add ${s.value} to the outgoing interfaces of policy #${s.name}`;
        case "srcaddr": return `Add ${s.value} to the source addresses of policy #${s.name}`;
        case "dstaddr": return `Add ${s.value} to the destination addresses of policy #${s.name}`;
        case "service": return `Add ${s.value} to the services of policy #${s.name}`;
        default: return `Add ${s.value} to policy #${s.name}`;
      }
  }
}

/** The simulated outcome, in one sentence. */
export function whatIfSentence(after: PolicyTrace): string {
  const pair = `${after.query.src_ip} → ${after.query.dst_ip} (${serviceOf(after)})`;
  const m = after.matched;
  if (after.verdict !== "allowed" || !m) return `${pair} would still be blocked.`;
  return m.policy_id
    ? `${pair} would be allowed by policy #${m.policy_id} ${m.name || "(unnamed)"}.`
    : `${pair} would be allowed by the new policy ${m.name}.`;
}

/** Every step's CLI, in order — what "Copy all" puts on the clipboard. */
export function planCli(plan: FixPlan): string {
  return plan.steps.map((s) => s.cli).join("\n\n");
}

// ── Recent traces ─────────────────────────────────────────────────────────────

export type SavedTrace = { src: string; dst: string; protocol: string; port: string; srcIntf: string };

// The "recent traces" store that used to live here is gone: nothing ever read it back. Troubleshooting
// keeps its last query in component state, and the localStorage list it wrote under
// "troubleshoot.recent" had no reader outside this module's own test. SavedTrace stays — the page
// uses the shape.

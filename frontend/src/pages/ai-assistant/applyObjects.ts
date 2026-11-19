// The ONE synchronous answer to "which objects does this CLI actually define?"
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// Three places needed that answer and each worked it out its own way:
//
//   · planApply (applyViaREST.ts) — the authority. It runs every parser, and an object whose block
//     the parser cannot read simply produces no step, so Apply creates nothing for it.
//   · countRESTApplicable — used to count `topLevelEdits(block).length`, i.e. the `edit` lines in
//     the TEXT. A block the parser returns null for therefore counted as 1, and the chat told the
//     user "Everything in this config already exists on the device" after creating nothing. That
//     message is the one the delete bug hid behind for months; this was the same lie by another
//     route, and the only one of the three paths that counted text instead of objects.
//   · summarizeApplyImpact (applyImpact.ts) — listed the objects in the confirmation dialog from a
//     third copy of the walk, which listed an unparseable profile block as "will be created" too.
//
// So the walk lives here once, in the ORDER planApply writes to the device (addresses → VIPs →
// services → schedules → profiles → auth servers → users → groups → SD-WAN → policies → route),
// and both of the other two read it. Pure and synchronous: no device call, so it is safe in a
// render path and in a confirmation dialog that must open instantly.
//
// The rule it encodes, which is the fix: an object counts when a PARSER produced it, never when the
// text merely looked like it.

import { extractPrereqBlocks, normalizeCLI } from "./parsePrereqCLI";
import { parseAllAddressesFromCLI } from "./parseAddressCLI";
import { parseAllVIPsFromCLI } from "./parseVirtualIPCLI";
import { parseAllServicesFromCLI } from "./parseServiceCLI";
import { parseAllSchedulesFromCLI } from "./parseScheduleCLI";
import { parseAllLDAPServersFromCLI } from "./parseLDAPServerCLI";
import { parseAllRADIUSServersFromCLI } from "./parseRADIUSServerCLI";
import { parseAllUserDefinitionsFromCLI } from "./parseUserDefinitionCLI";
import { parseAllUserGroupsFromCLI } from "./parseUserGroupCLI";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import { parseRouteFromCLI } from "./parseRouteCLI";
import { parseSDWANFromCLI } from "./parseSDWANCLI";
import { parseAntivirusFromCLI } from "./parseAntivirusCLI";
import { parseWebFilterFromCLI } from "./parseWebFilterCLI";
import { parseDNSFilterFromCLI } from "./parseDNSFilterCLI";
import { parseFileFilterFromCLI } from "./parseFileFilterCLI";
import { parseAppControlFromCLI } from "./parseAppControlCLI";
import type { AppliedKind } from "./applyViaREST";

/** One object a CLI defines: what it is, how to label it, and the name Apply would key it by. */
export type ParsedObject = { kind: AppliedKind; label: string; name: string };

// A profile block is only an object if its OWN parser can read it. `ips` is absent on purpose: it
// has no REST endpoint, so a CLI containing one takes the SSH path whole and nothing here applies.
const PROFILE_PARSERS: Record<string, { kind: AppliedKind; label: string; name: (cli: string) => string | undefined }> = {
  "antivirus": {
    kind: "antivirus", label: "AntiVirus",
    name: (cli) => { const d = parseAntivirusFromCLI(cli); return d?.form.name ?? d?.target; },
  },
  "webfilter": {
    kind: "webfilter", label: "Web Filter",
    name: (cli) => { const d = parseWebFilterFromCLI(cli); return d?.form.name ?? d?.target; },
  },
  "dnsfilter": {
    kind: "dnsfilter", label: "DNS Filter",
    name: (cli) => { const d = parseDNSFilterFromCLI(cli); return d?.form.name ?? d?.target; },
  },
  "file-filter": {
    kind: "file-filter", label: "File Filter",
    name: (cli) => { const d = parseFileFilterFromCLI(cli); return d?.form.name ?? d?.target; },
  },
  "application-control": {
    kind: "application-control", label: "Application Control",
    name: (cli) => { const d = parseAppControlFromCLI(cli); return d?.name ?? d?.target; },
  },
};

/**
 * parsedApplyObjects returns every object the CLI defines that Apply would build object by object,
 * in the order it would build them.
 *
 * A VPN is NOT in here: it is one object set the device proxy creates wholesale (phase1/phase2 plus
 * the addresses, policies and routes inside it), so its parts must never be listed as separate
 * creates. Callers handle that case before asking — see planApply step 0.
 */
export function parsedApplyObjects(cli: string): ParsedObject[] {
  const text = normalizeCLI(cli);
  const out: ParsedObject[] = [];
  const push = (kind: AppliedKind, label: string, name: string | undefined) => {
    if (!name) return;
    if (out.some((o) => o.kind === kind && o.name === name)) return; // the same object named twice
    out.push({ kind, label, name });
  };

  for (const a of parseAllAddressesFromCLI(text)) push("address", "Address", a.form.name ?? a.target);
  for (const v of parseAllVIPsFromCLI(text)) push("virtual-ip", "Virtual IP", v.form.name ?? v.target);
  for (const s of parseAllServicesFromCLI(text)) push("service", "Service", s.form.name ?? s.target);
  for (const s of parseAllSchedulesFromCLI(text)) push("schedule", "Schedule", s.form.name ?? s.target);

  for (const b of extractPrereqBlocks(text)) {
    const p = PROFILE_PARSERS[b.kind];
    if (!p) continue;
    // planApply's fallback order: the parsed name, then the block's own `edit` target. A block the
    // parser cannot read at all contributes nothing — that is the bug this file fixes.
    push(p.kind, p.label, p.name(b.cli) ?? undefined);
  }

  for (const l of parseAllLDAPServersFromCLI(text)) push("ldap-server", "LDAP Server", l.form.name ?? l.target);
  for (const r of parseAllRADIUSServersFromCLI(text)) push("radius-server", "RADIUS Server", r.form.name ?? r.target);
  for (const u of parseAllUserDefinitionsFromCLI(text)) push("user", "User", u.form.name ?? u.target);
  for (const g of parseAllUserGroupsFromCLI(text)) push("user-group", "User Group", g.form.name ?? g.target);

  // SD-WAN before the policies: a policy can name an SD-WAN zone as its outgoing interface, which
  // is the order planApply walks too.
  const sdwan = parseSDWANFromCLI(text);
  if (sdwan) {
    for (const z of sdwan.zones) push("sdwan-zone", "SD-WAN Zone", z.form.name);
    for (const m of sdwan.members) push("sdwan-member", "SD-WAN Member", m.form.interface);
    for (const h of sdwan.healthChecks) push("sdwan-health-check", "Performance SLA", h.form.name);
    for (const r of sdwan.rules) push("sdwan-rule", "SD-WAN Rule", r.form.name);
  }

  // A policy is keyed by a numeric id FortiOS assigns, so `p.target` is a number, not a name:
  // planApply skips a policy block with no `set name` rather than inventing one, and so does this.
  for (const p of parseAllPoliciesFromCLI(text)) push("policy", "Policy", p.form.name);

  // A static route has no name either — planApply labels it by destination (or internet-service).
  const route = parseRouteFromCLI(text);
  if (route) {
    const f = route.form;
    const label = f.dstType === "internet-service" ? f.internetServiceName : f.dst;
    push("static-route", "Static Route", label || "route");
  }

  return out;
}

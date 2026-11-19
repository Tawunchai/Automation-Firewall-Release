// applyImpact — "I am about to press Apply. What actually happens?", answered BEFORE the click.
//
// WHY THIS EXISTS
// Apply writes straight to a live firewall, and until now one click did it. Dry-run answers the same
// question far more precisely — but it reads the device, takes a round trip, and is optional; people
// who are in a hurry press Apply, which is exactly when a confirmation is worth the most.
//
// So this is the CHEAP half of the question: everything that can be known from the CLI text alone,
// computed synchronously with no device call, so a confirmation dialog can open instantly and say
// what is about to be built and what it will let through. It deliberately does NOT claim to know
// what is already on the device — a name that exists is skipped by Apply, and only Dry-run can tell
// you that. The dialog says so in as many words rather than implying every object is new.
//
// The object list is built in the SAME order planApply walks (addresses → VIPs → services →
// schedules → profiles → auth servers → users → groups → policies → route), so the dialog reads in
// the order the firewall will actually be written to.

import type { ConfigImpact } from "../../api/ai";
import type { PolicyFormState } from "../firewall-policy/create.logic";
import { canApplyViaREST, countRESTApplicable, hasDestructiveStatement, type AppliedKind } from "./applyViaREST";
import { normalizeCLI } from "./parsePrereqCLI";
import { parsedApplyObjects } from "./applyObjects";
import { parseVPNFromCLI } from "./parseVPNCLI";
import { parseAllPoliciesFromCLI } from "./parsePolicyCLI";
import { parseRouteFromCLI } from "./parseRouteCLI";
import { parseSDWANFromCLI } from "./parseSDWANCLI";

/** One object the CLI defines, as the dialog lists it. */
export type ImpactObject = { kind: AppliedKind; label: string; name: string };

/** The five security-profile kinds, for the "a profile no policy references inspects nothing" line. */
const PROFILE_KINDS = new Set<AppliedKind>([
  "antivirus", "webfilter", "dnsfilter", "application-control", "file-filter",
]);

/** One firewall policy, reduced to the facts that decide what traffic changes. */
export type ImpactPolicy = {
  name: string;
  srcIntf: string;
  dstIntf: string;
  srcAddr: string[];
  dstAddr: string[];
  service: string[];
  schedule: string;
  action: "accept" | "deny";
  nat: boolean;
  /** Security profiles attached, already labelled ("AntiVirus: default"). */
  profiles: string[];
  /** any source → any destination on every service: the literal "permit everything" shape. */
  wideOpen: boolean;
  /** An accept with no UTM profile at all — traffic passes uninspected. */
  uninspected: boolean;
};

export type ApplyImpact = {
  /**
   * Whether this Apply BUILDS something new or WRITES OVER something that is already on the device.
   * The dialog's wording turns on it — "will be created" and "will be overwritten" are different
   * promises, and the second one is the dangerous one.
   */
  mode: "create" | "edit";
  /** "rest" = built object by object (undoable with Fallback); "ssh" = the whole CLI is shipped. */
  transport: "rest" | "ssh";
  /** The CLI contains delete / unset / purge — Apply cannot express that object by object. */
  destructive: boolean;
  objects: ImpactObject[];
  policies: ImpactPolicy[];
  /** What changes on the network, one plain line each. */
  effects: string[];
  /** Things worth a second look before the click. */
  warnings: string[];
  /**
   * The caveat that belongs UNDER the object list — what the list does not say. It differs by path
   * (the chat cannot know which names the device already has; a wizard has just looked), so each
   * builder writes its own rather than the dialog assuming one.
   */
  note?: string;
  /** The model's own "ผลกระทบ (Impact)" bullets, shown as its claim rather than ours. */
  aiImpact: string[];
};

// ── Formatting ───────────────────────────────────────────────────────────────

/** Joins names for a one-line summary, keeping the line short: "a, b, c +2". */
export function nameList(names: string[] | undefined, max = 3): string {
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return "—";
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max}`;
}

// ── The model's own impact bullets ───────────────────────────────────────────

// impactBullets turns the three fields of the tool's `impact` object into the lines the dialog
// shows, in the order the prompt names them: subnets · who is affected · placement.
//
// This is the path that should run on every config answer the current backend produces. The field
// is part of the tool schema (`strict: true`), so it either arrives whole or the request fails
// loudly — unlike the prose section it replaced, which could go missing silently.
export function impactBullets(impact?: ConfigImpact | null): string[] {
  if (!impact) return [];
  const out: string[] = [];
  const subnets = (impact.subnets ?? []).map((s) => s.trim()).filter(Boolean);
  if (subnets.length) out.push(subnets.join(", "));
  const affected = (impact.affected ?? []).map((s) => s.trim()).filter(Boolean);
  if (affected.length) out.push(affected.join(" · "));
  const placement = (impact.placement ?? "").trim();
  // "-" is what the prompt tells the model to write when the answer creates no policy, so it is an
  // answer, not a value worth a line of the dialog.
  if (placement && placement !== "-") out.push(placement);
  return out;
}

// extractImpactBullets is the FALLBACK, for an answer with no `impact` object: a conversation
// restored from a session snapshot written before the field existed, or a model that filled only
// the explanation.
//
// ai.go used to instruct the model to end every config explanation with a section titled
// "ผลกระทบ (Impact)" holding exactly 3 one-line bullets, and this is the regex that found it. It is
// kept because an old transcript should not lose its impact section on upgrade — but nothing new
// relies on it.
//
// The heading must START the line (after any markdown/bullet decoration) — the word "impact" inside
// a sentence is prose, not a section.
// ⚠️ The word-boundary guard applies to the LATIN word only. `\b` is defined against [A-Za-z0-9_],
// so "ผลกระทบ\b" never matches — every Thai character sits outside \w and there is no boundary to
// find. Written as `impact\b`, the Thai heading matches on the literal alone.
const IMPACT_HEADING = /^[*_·•\-\s]*(ผลกระทบ|impact\b)/i;
const BULLET = /^[·•\-*–—]\s*(.+)$/;

export function extractImpactBullets(explanation?: string): string[] {
  if (!explanation) return [];
  const lines = normalizeCLI(explanation).split("\n");
  const start = lines.findIndex((l) => IMPACT_HEADING.test(l.trim()));
  if (start < 0) return [];

  const out: string[] = [];
  for (let i = start + 1; i < lines.length && out.length < 5; i++) {
    const raw = lines[i].trim();
    if (!raw) {
      if (out.length) break; // a blank line after the bullets ends the section
      continue;
    }
    const m = raw.match(BULLET);
    if (!m) {
      if (out.length) break; // prose again — the section is over
      continue;
    }
    out.push(m[1].replace(/\*\*/g, "").trim());
  }
  return out;
}

// ── Policies ─────────────────────────────────────────────────────────────────

// FortiOS spells "everything" as the built-in object `all` for addresses and `ALL` for services —
// one name, matched case-insensitively, on both sides.
const isEverything = (names: string[]) => names.length === 1 && /^all$/i.test(names[0]);

/**
 * policyImpact reduces a policy form to the facts that decide what traffic changes.
 *
 * Shared by BOTH confirmation paths — the chat's Apply (form parsed out of the AI's CLI) and the
 * Policy Wizard's Apply (the form the user has been editing). One reading of "what does this rule
 * do", so the two dialogs cannot describe the same policy differently.
 */
export function policyImpact(name: string, f: Partial<PolicyFormState>): ImpactPolicy {
  const action = f.action === "deny" ? "deny" : "accept";

  // ⚠️ Mirrors buildPolicyPayload's gate exactly: `action === "accept" && <kind>Enabled ? profile : ""`.
  // A wizard form keeps the profile NAME after its toggle is switched off, so reading the name alone
  // would list a profile the write is not going to set — and the dialog would show an inspected
  // policy for traffic that leaves uninspected. That is precisely the direction of error this
  // summary must never make.
  const attached = (on: boolean | undefined, profile: string | undefined, label: string) =>
    action === "accept" && on === true && profile ? `${label}: ${profile}` : "";
  const profiles = [
    attached(f.avEnabled, f.avProfile, "AntiVirus"),
    attached(f.webEnabled, f.webProfile, "Web Filter"),
    attached(f.dnsEnabled, f.dnsProfile, "DNS Filter"),
    attached(f.appEnabled, f.appProfile, "App Control"),
    attached(f.ipsEnabled, f.ipsProfile, "IPS"),
    attached(f.fileEnabled, f.fileProfile, "File Filter"),
  ].filter(Boolean);

  // FortiOS's own defaults for a field the form/CLI leaves out, so an omitted srcaddr reads as
  // "all" here exactly as the device would treat it — not as "unknown".
  const srcAddr = f.srcAddr?.length ? f.srcAddr : ["all"];
  const dstAddr = f.dstAddr?.length ? f.dstAddr : ["all"];
  const service = f.service?.length ? f.service : ["ALL"];

  return {
    name,
    srcIntf: f.srcIntf ?? "",
    dstIntf: f.dstIntf ?? "",
    srcAddr, dstAddr, service,
    schedule: f.schedule ?? "always",
    action,
    nat: f.nat === true,
    profiles,
    wideOpen: action === "accept" && isEverything(srcAddr) && isEverything(dstAddr) && isEverything(service),
    uninspected: action === "accept" && profiles.length === 0,
  };
}

/** The one line that says what this rule lets through (or stops). */
export function policyEffectLine(p: ImpactPolicy): string {
  const verb = p.action === "accept" ? "Allows" : "Blocks";
  const when = p.schedule && !/^always$/i.test(p.schedule) ? ` during ${p.schedule} only` : "";
  const nat = p.action === "accept" && p.nat
    ? ` · NAT on — the source is rewritten to the IP of ${p.dstIntf || "the egress interface"}`
    : "";
  return `${verb} ${nameList(p.srcAddr)} (${p.srcIntf || "any"}) → ${nameList(p.dstAddr)} ` +
    `(${p.dstIntf || "any"}) on service ${nameList(p.service)}${when}${nat}`;
}

/** The warnings a single policy earns on its own contents (placement is the caller's business). */
export function policyWarnings(p: ImpactPolicy): string[] {
  const out: string[] = [];
  if (p.wideOpen) {
    out.push(`Policy "${p.name}" allows every source, destination and service — it is wide open`);
  }
  if (p.uninspected) {
    out.push(`Policy "${p.name}" has no security profile attached — traffic passes without being scanned`);
  }
  return out;
}

// ── The summary ──────────────────────────────────────────────────────────────

/**
 * summarizeApplyImpact reads the AI's CLI (and, optionally, its explanation and its typed `impact`
 * object) and returns what the confirmation dialog shows. Pure and synchronous: no device call, so
 * the dialog opens instantly.
 *
 * `impact` wins over `explanation` when both are there — it is the field the model was asked to
 * fill, and the prose section is only still read for transcripts that predate it.
 */
export function summarizeApplyImpact(cli: string, explanation?: string, impact?: ConfigImpact | null): ApplyImpact {
  const typed = impactBullets(impact);
  const aiImpact = typed.length > 0 ? typed : extractImpactBullets(explanation);
  const destructive = hasDestructiveStatement(cli);
  const transport: "rest" | "ssh" = canApplyViaREST(cli) ? "rest" : "ssh";

  const objects: ImpactObject[] = [];
  const policies: ImpactPolicy[] = [];
  const effects: string[] = [];
  const warnings: string[] = [];

  // A VPN is one object set built wholesale by the device proxy — its own policies, addresses and
  // routes travel inside it and must NOT be listed as separate creates (see planApply step 0).
  const vpn = parseVPNFromCLI(cli);
  if (vpn) {
    const label = vpn.kind === "hub-spoke" ? "Hub-and-Spoke VPN"
      : vpn.kind === "remote-access" ? "Remote Access VPN" : "Site-to-Site VPN";
    objects.push({ kind: "ipsec-tunnel", label, name: vpn.name });
    effects.push(
      `Creates IPsec tunnel "${vpn.name}" (${label}) with its phase 1 / phase 2 and the addresses, policies and routes it needs`,
    );
    effects.push("The tunnel stays down until the far end is configured to match (PSK, proposal, selectors)");
    return { mode: "create", transport, destructive, objects, policies, effects, warnings, aiImpact };
  }

  // The object list and its order come from parsedApplyObjects — the same walk countRESTApplicable
  // uses, and the same one planApply writes to the device in. It used to be a third copy of that
  // walk here, which listed a profile block the parser cannot read as "will be created".
  objects.push(...parsedApplyObjects(cli));

  const profileCount = objects.filter((o) => PROFILE_KINDS.has(o.kind)).length;

  const sdwan = parseSDWANFromCLI(cli);
  if (sdwan) {
    if (sdwan.members.length) {
      effects.push(
        `Adds ${sdwan.members.map((m) => m.form.interface).join(", ")} to SD-WAN — once SD-WAN is on, ` +
        "routes out of those interfaces are chosen by the SD-WAN rules rather than by the routing table",
      );
    }
    if (sdwan.rules.length) {
      effects.push(
        `Adds ${sdwan.rules.length} SD-WAN rule(s), which are first-match top to bottom like firewall policies`,
      );
    }
    // Apply deliberately never writes the parent's `status`. Saying so is the difference between a
    // user who knows their SD-WAN is still off and one who thinks the proposal turned it on.
    if (sdwan.requestedStatus === true) {
      warnings.push(
        "This config enables SD-WAN (`set status enable`), and Apply does NOT write that flag — " +
        "enabling SD-WAN re-homes every route leaving through a member interface, so it stays a " +
        "deliberate act on the Network ▸ SD-WAN page. Everything else here is created.",
      );
    }
  }

  // The policies are already in `objects`; this second pass is for their TRAFFIC facts, which the
  // object list does not carry. Named policies only — a block with no `set name` is one planApply
  // skips, so promising anything about its traffic would be a promise about nothing.
  for (const p of parseAllPoliciesFromCLI(cli)) {
    if (!p.form.name) continue;
    policies.push(policyImpact(p.form.name, p.form));
  }

  const route = parseRouteFromCLI(cli);
  if (route) {
    const f = route.form;
    const dst = f.dstType === "internet-service" ? f.internetServiceName : f.dst;
    effects.push(
      f.device === "blackhole"
        ? `Drops all traffic to ${dst} (blackhole route)`
        : `Traffic to ${dst} will leave through ${f.device || "the chosen interface"} instead` +
          (f.gateway ? ` via gateway ${f.gateway}` : ""),
    );
  }

  // ── Effects: what changes for traffic ──
  for (const p of policies) effects.push(policyEffectLine(p));

  const userCount = objects.filter((o) => o.kind === "user").length;
  const groupCount = objects.filter((o) => o.kind === "user-group").length;
  if (userCount || groupCount) {
    effects.push(
      `Adds ${userCount} user account(s) and ${groupCount} group(s) — ` +
      "none of it affects traffic until a policy or a VPN references the group",
    );
  }
  if (profileCount && policies.length === 0) {
    effects.push(
      `Creates ${profileCount} security profile(s) — a profile no policy references inspects nothing`,
    );
  }
  if (effects.length === 0 && objects.length > 0) {
    effects.push("Creates the objects listed above — none of them changes where traffic goes until a policy references them");
  }

  // ── Warnings: the parts that bite ──
  if (destructive) {
    warnings.push(
      "This config contains delete / unset — it is sent as one block over the SSH pipeline, and Fallback cannot take it back",
    );
  } else if (transport === "ssh") {
    warnings.push(
      "This config contains a section with no REST endpoint — it is sent as one block over the SSH pipeline rather than object by object, " +
      "so Fallback cannot take it back",
    );
  }
  for (const p of policies) warnings.push(...policyWarnings(p));
  if (policies.length > 0) {
    warnings.push(
      "The new policy is appended to the bottom of the table. FortiGate matches top to bottom, so if a broader policy " +
      "sits above it the new one never matches — use the Policy Wizard to choose the position yourself.",
    );
  }
  if (transport === "rest" && countRESTApplicable(cli) === 0) {
    warnings.push("No creatable object was found in this config — applying it may send nothing to the device");
  }

  // Always "create": Apply SKIPS a name the device already has rather than writing over it. The one
  // exception is a user group's member list (planApply's single "update" step), which is a merge, not
  // an overwrite — not enough to call the whole batch an edit.
  return {
    mode: "create", transport, destructive, objects, policies, effects, warnings, aiImpact,
    note: "Names that already exist on the device are skipped, not overwritten — run a dry run to see which ones exist",
  };
}

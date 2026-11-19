import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import { BLANK_POLICY_FORM, type PolicyFormState } from "../firewall-policy/create.logic";

// A parsed draft plus the object's CURRENT identity (the `edit "X"` key). `target` lets the
// wizard find the existing object on the device even when the user is renaming it (the new
// name lives in form.name) or when the AI's edit block doesn't restate the name at all.
export type ParsedPolicy = { form: Partial<PolicyFormState>; target: string };

type CLIStatement = { key: string; tokens: string[] };

function parseSetLine(line: string): CLIStatement | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const rest = m[2].trim();
  // Values may be quoted, unquoted, or BOTH in one line: `set srcaddr "LAN" all` is valid FortiOS.
  // Taking only the quoted ones when any quote is present dropped `all` here — i.e. silently
  // narrowed (or, on dstaddr, widened) the rule the user was shown. Scan the line once instead,
  // taking each quoted span as one value and each bare run as another, in order.
  const tokens = [...rest.matchAll(/"([^"]*)"|(\S+)/g)]
    .map((mm) => mm[1] ?? mm[2])
    .filter((t) => t !== undefined && t !== "");
  return { key, tokens };
}

const enableBool = (tokens: string[]) => (tokens[0] ?? "").toLowerCase() === "enable";

// parsePolicyEdit converts ONE `edit "<key>" … next` body of a `config firewall policy` block into a
// partial PolicyFormState. `editKey` is the object's current identity ("0" for a brand-new object).
//
// Field mapping mirrors buildPolicyPayload()/the FGPolicy struct in backend/services/fortigate.go —
// same CLI key names FortiOS itself uses, which is also exactly what the AI's own system prompt teaches
// it to output (see backend/services/ai.go CLIReference).
function parsePolicyEdit(editKey: string, body: string[]): ParsedPolicy | null {
  // The edit key is the object's current identity. "0" (edit 0 → new object) is not a target.
  const target = editKey === "0" ? "" : editKey;
  const form: Partial<PolicyFormState> = {};
  let avProfile = "", webProfile = "", dnsProfile = "", appProfile = "", ipsProfile = "", fileProfile = "";
  let ippoolEnabled = false, poolName: string[] = [], fixedportEnabled = false;

  for (const rawLine of body) {
    const stmt = parseSetLine(rawLine);
    if (!stmt) continue;
    const { key, tokens } = stmt;

    switch (key) {
      case "name":     form.name = tokens[0] ?? ""; break;
      case "srcintf":  form.srcIntf = tokens[0] ?? ""; break;
      case "dstintf":  form.dstIntf = tokens[0] ?? ""; break;
      case "srcaddr":  form.srcAddr = tokens; break;
      case "dstaddr":  form.dstAddr = tokens; break;
      case "service":  form.service = tokens; break;
      case "schedule": form.schedule = tokens[0] ?? "always"; break;
      // FortiOS has a third action, `ipsec` (policy-based VPN), and this ternary used to fold it
      // — and any typo, and anything a future FortiOS adds — into "accept". That is the wrong
      // direction to fail in: the chat would show the user a rule they described as a tunnel
      // policy and Apply would create a rule that ALLOWS the traffic. An action this console
      // cannot represent now makes the whole policy unparseable, which is the honest answer and
      // is handled: an unparseable block is reported, not silently applied.
      case "action":
        if (tokens[0] !== "accept" && tokens[0] !== "deny") return null;
        form.action = tokens[0];
        break;
      case "nat":      form.nat = enableBool(tokens); break;
      case "ippool":   ippoolEnabled = enableBool(tokens); break;
      case "poolname": poolName = tokens; break;
      case "fixedport": fixedportEnabled = enableBool(tokens); break;
      case "protocol-options":
      case "profile-protocol-options": form.protocolOptions = tokens[0] ?? "default"; break;
      case "av-profile":         avProfile  = tokens[0] ?? ""; break;
      case "webfilter-profile":  webProfile = tokens[0] ?? ""; break;
      case "dnsfilter-profile":  dnsProfile = tokens[0] ?? ""; break;
      case "application-list":   appProfile = tokens[0] ?? ""; break;
      case "ips-sensor":         ipsProfile = tokens[0] ?? ""; break;
      case "file-filter-profile": fileProfile = tokens[0] ?? ""; break;
      case "ssl-ssh-profile":    form.sslSshProfile = tokens[0] ?? ""; break;
      case "logtraffic": {
        const v = (tokens[0] ?? "").toLowerCase();
        if (v === "all" || v === "utm") form.logAllowed = v as "all" | "utm";
        form.logViolation = v !== "disable";
        break;
      }
      case "comments": form.comments = tokens.join(" "); break;
      case "status":   form.enabled = enableBool(tokens); break;
      default: break; // ignore fields we don't surface (utm-status, uuid, global-label, ...)
    }
  }

  if (avProfile)   { form.avEnabled = true;   form.avProfile = avProfile; }
  if (webProfile)  { form.webEnabled = true;  form.webProfile = webProfile; }
  if (dnsProfile)  { form.dnsEnabled = true;  form.dnsProfile = dnsProfile; }
  if (appProfile)  { form.appEnabled = true;  form.appProfile = appProfile; }
  if (ipsProfile)  { form.ipsEnabled = true;  form.ipsProfile = ipsProfile; }
  if (fileProfile) { form.fileEnabled = true; form.fileProfile = fileProfile; }

  if (form.nat) {
    form.ipPoolMode = ippoolEnabled ? "dynamic" : "outgoing";
    form.poolName = poolName;
    form.manageSourcePort = fixedportEnabled;
    form.fixedPort = fixedportEnabled;
  }

  // Name the object: an explicit `set name` (create, or a rename's NEW name) wins; otherwise
  // fall back to the edit key so a field-only edit ("edit X / set service Y") still yields a draft.
  if (!form.name) {
    if (!target) return null; // edit 0 with no name → can't identify → not a wizard draft
    form.name = target;
  }
  return { form, target: target || form.name };
}

// parseGroups reads `config <header>` blocks (service group / addrgrp) the AI defined in this CLI and
// returns name → member list. Used to INLINE a group a policy references into its members, because the
// wizard/REST create paths can build custom services and addresses but not group objects (no REST
// endpoint). Only groups DEFINED in this CLI are returned — a group that already exists on the device
// is left as-is (reused by name).
function parseGroups(cliText: string, header: string): Map<string, string[]> {
  const lines = normalizeCLI(cliText).split("\n");
  const map = new Map<string, string[]>();
  for (const blk of topLevelConfigBlocks(lines)) {
    if (blk.header !== header) continue;
    for (const e of topLevelEdits(blk.inner)) {
      const members: string[] = [];
      for (const l of e.body) {
        const m = l.match(/^\s*set\s+member\s+(.*)$/i);
        if (!m) continue;
        const quoted = [...m[1].matchAll(/"([^"]*)"/g)].map((q) => q[1]);
        members.push(...(quoted.length ? quoted : m[1].trim().split(/\s+/).filter(Boolean)));
      }
      if (e.name) map.set(e.name.trim(), members);
    }
  }
  return map;
}

// expandGroups replaces any name that is a CLI-defined group with its members (one level, deduped).
// Names that are not groups pass through unchanged.
function expandGroups(names: string[] | undefined, groups: Map<string, string[]>): string[] | undefined {
  if (!names || groups.size === 0) return names;
  const out: string[] = [];
  for (const n of names) {
    const members = groups.get(n);
    if (members && members.length) out.push(...members);
    else out.push(n);
  }
  return Array.from(new Set(out));
}

// parseAllPoliciesFromCLI extracts EVERY `config firewall policy … edit … next … end` entry from
// AI-generated FortiOS CLI text, in the order the AI wrote them (which is also the intended
// top-to-bottom order — a more specific policy is written before the broader one it carves out of).
// A single request often yields two or more policies ("allow the office out" + "block games at
// lunch"); each becomes its own draft the wizard/apply can create independently.
//
// Any NEW service/address GROUP the AI defined and a policy references is INLINED into that policy's
// service / srcaddr / dstaddr as its members — the create paths can build the member custom objects
// but not the group itself, and a policy that references "HTTPS" "App-9000" directly allows exactly the
// same traffic as one that references a group of the two. (A group that already exists on the device is
// not in this CLI, so it is left referenced by name and reused.)
export function parseAllPoliciesFromCLI(cliText: string): ParsedPolicy[] {
  const lines = normalizeCLI(cliText).split("\n");
  const svcGroups  = parseGroups(cliText, "firewall service group");
  const addrGroups = parseGroups(cliText, "firewall addrgrp");
  const out: ParsedPolicy[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    // `firewall policy` only — never the IPv6 / proxy / multicast variants, which the wizard
    // can't build. Header whitespace is already collapsed + lowercased by topLevelConfigBlocks.
    if (header !== "firewall policy") continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parsePolicyEdit(e.name.trim(), e.body);
      if (!parsed) continue;
      parsed.form.service = expandGroups(parsed.form.service, svcGroups);
      parsed.form.srcAddr = expandGroups(parsed.form.srcAddr, addrGroups);
      parsed.form.dstAddr = expandGroups(parsed.form.dstAddr, addrGroups);
      out.push(parsed);
    }
  }
  return out;
}

// Extracts the FIRST firewall policy block — back-compat for callers that only ever handled one
// policy. Prefer parseAllPoliciesFromCLI for anything that must cover a multi-policy suggestion.
// Returns null when the text contains no firewall policy block at all (e.g. an address/service/VPN
// suggestion) or when no usable draft was found.
export function parsePolicyFromCLI(cliText: string): ParsedPolicy | null {
  return parseAllPoliciesFromCLI(cliText)[0] ?? null;
}

// referencedByPolicy returns the object NAMES a single policy points at, so a multi-policy answer
// can hand each policy wizard only ITS own prerequisites (addresses / services / schedule /
// security profiles) instead of every object the whole suggestion defined. Built-ins ("all",
// "none", "always", "ALL") are left in — callers already skip those when auto-creating.
export function referencedByPolicy(form: Partial<PolicyFormState>): {
  addresses: string[]; services: string[]; schedule: string; profiles: string[];
} {
  const addresses = Array.from(new Set([...(form.srcAddr ?? []), ...(form.dstAddr ?? [])])).filter(Boolean);
  const services = Array.from(new Set(form.service ?? [])).filter(Boolean);
  const schedule = (form.schedule ?? "").trim();
  const profiles = [
    form.avEnabled ? form.avProfile : "",
    form.webEnabled ? form.webProfile : "",
    form.dnsEnabled ? form.dnsProfile : "",
    form.appEnabled ? form.appProfile : "",
    form.ipsEnabled ? form.ipsProfile : "",
    form.fileEnabled ? form.fileProfile : "",
  ].filter((n): n is string => !!n);
  return { addresses, services, schedule, profiles };
}

// policyOrderLocks decides which policies of a multi-policy suggestion may be opened/created yet.
// Policies must be created in the AI's written (top→bottom) order — the more specific policy first, so
// it lands above the broad one (first match wins). A policy is therefore LOCKED until EVERY policy
// before it is already on the device; `lockReason` is the first such earlier policy the user must
// create first. Applied policies are never locked (they open read-only).
export function policyOrderLocks(
  names: string[], applied: Set<string>,
): { applied: boolean; locked: boolean; lockReason?: string }[] {
  return names.map((name, idx) => {
    const isApplied = applied.has(name);
    const prevUnapplied = names.slice(0, idx).find((n) => !applied.has(n));
    return { applied: isApplied, locked: !isApplied && prevUnapplied !== undefined, lockReason: prevUnapplied };
  });
}

// Merges a parsed partial draft over the blank defaults so every PolicyFormState field
// has a valid value the wizard can render immediately.
export function policyDraftToFormState(draft: Partial<PolicyFormState>): PolicyFormState {
  return { ...BLANK_POLICY_FORM, ...draft };
}

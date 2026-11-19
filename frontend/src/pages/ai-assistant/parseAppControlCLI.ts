import type {
  AppControlProfileForm, AppCategoryAction, AppAction,
  AppOverride, AppSignatureRef, AppNetworkService, AppSignatureMeta,
} from "../../api/policyObject";
import { topLevelConfigBlocks, topLevelEdits, normalizeCLI } from "./parsePrereqCLI";

// A parsed draft plus the profile's CURRENT name (the `edit "X"` key). Everything a FortiOS
// application list can express is parsed — the category grid, Application overrides (by signature
// id), Filter overrides (category/risk/popularity/technology/behavior/protocol/vendor), Network
// Protocol Enforcement and the profile-level options — so the wizard shows exactly what the AI
// proposed, with nothing silently dropped.
export type ParsedAppControl = {
  name: string;
  comment?: string;
  categoryActions: AppCategoryAction[];
  overrides: AppOverride[];
  networkProtocolEnforcement?: boolean;
  networkServices: AppNetworkService[];
  unknownApplicationAction?: AppAction;
  blockNonDefaultPorts?: boolean;
  allowAndLogDNS?: boolean;
  replacementMessages?: boolean;
  target: string;
};

// FortiOS stores an application filter's technology and behavior as numeric codes, not the display
// strings the GUI shows (the backend does the same mapping on write — keep the two in step). The
// AI is taught to emit the codes, but a display name is accepted too so a hand-written block works.
const TECHNOLOGY_BY_CODE: Record<string, string> = {
  "0": "Network-Protocol", "1": "Browser-Based", "2": "Client-Server", "4": "Peer-to-Peer",
};
const BEHAVIOR_BY_CODE: Record<string, string> = {
  "2": "Botnet", "3": "Evasive", "5": "Excessive-Bandwidth", "6": "Tunneling",
};

// Maps a FortiOS application-list entry to our GUI action. FortiOS defaults an entry with no
// explicit `set action` to BLOCK, and `pass` with logging on is what the GUI calls "monitor".
function entryAction(action: string | null, log: string | null, quarantine: string | null): AppAction {
  if ((quarantine ?? "").toLowerCase() === "attacker") return "quarantine";
  const a = (action ?? "").toLowerCase();
  if (a === "block" || a === "reset" || a === "deny") return "block";
  if (a === "") return "block"; // FortiOS entry default
  // pass / allow
  return (log ?? "").toLowerCase() === "disable" ? "allow" : "monitor";
}

// "1 2 3" → [1,2,3]; blank → []. Duplicates are dropped — a signature list is a set, and the AI
// does repeat an id occasionally when it enumerates a large app family.
const numList = (v: string | undefined): number[] => {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of (v ?? "").trim().split(/\s+/)) {
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

// Decodes a space-separated coded attribute ("1 2") into display names, dropping the "all"
// wildcard (which means "no narrowing"). Unknown codes pass through so nothing is lost.
const decodeAttr = (v: string | undefined, byCode: Record<string, string>): string[] => {
  const raw = (v ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") return [];
  return raw.split(/\s+/).map((c) => byCode[c] ?? c);
};

// Plain (uncoded) space-separated attribute — protocols / vendor. "all" means no narrowing.
const plainAttr = (v: string | undefined): string[] => {
  const raw = (v ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") return [];
  return raw.split(/\s+/);
};

// Popularity 1-5 in full means "every level" — i.e. no narrowing, same as unset.
const narrowedPopularity = (v: string | undefined): number[] => {
  const list = numList(v);
  return list.length === 5 ? [] : list;
};

const grab = (body: string, re: RegExp): string | undefined => body.match(re)?.[1]?.trim();

const EMPTY_OVERRIDE: Omit<AppOverride, "type" | "action"> = {
  applications: [], categories: [], risk: [], popularity: [],
  technologies: [], behaviors: [], protocols: [], vendors: [],
};

// Parses the first `config application list … edit "<name>" … next` block from AI CLI.
// Returns null when there is no application-list block.
export function parseAppControlFromCLI(cliText: string): ParsedAppControl | null {
  if (!cliText) return null;
  const lines = normalizeCLI(cliText).split("\n");
  const listBlk = topLevelConfigBlocks(lines).find((b) => b.header === "application list");
  if (!listBlk) return null;
  const edits = topLevelEdits(listBlk.inner);
  if (edits.length === 0) return null;

  const target = edits[0].name.trim();
  if (!target) return null;
  const bodyLines = edits[0].body;
  const body = bodyLines.join("\n");

  const parsed: ParsedAppControl = {
    name: grab(body, /set\s+name\s+"?([^"\n]+?)"?\s*$/im) ?? target,
    comment: body.match(/set\s+comment\s+"([^"]*)"/i)?.[1],
    categoryActions: [],
    overrides: [],
    networkServices: [],
    target,
  };

  // ── Profile-level options ───────────────────────────────────────────────────────────
  const unknownAction = grab(body, /set\s+unknown-application-action\s+(\S+)/i);
  const unknownLog    = grab(body, /set\s+unknown-application-log\s+(\S+)/i);
  if (unknownAction || unknownLog) {
    parsed.unknownApplicationAction = (unknownAction ?? "").toLowerCase() === "block"
      ? "block"
      : (unknownLog ?? "").toLowerCase() === "enable" ? "monitor" : "allow";
  }
  const enforcePort = grab(body, /set\s+enforce-default-app-port\s+(\S+)/i);
  if (enforcePort) parsed.blockNonDefaultPorts = enforcePort.toLowerCase() === "enable";
  const replacemsg = grab(body, /set\s+app-replacemsg\s+(\S+)/i);
  if (replacemsg) parsed.replacementMessages = replacemsg.toLowerCase() === "enable";
  const options = grab(body, /set\s+options\s+([^\n]+)/i);
  if (options !== undefined) parsed.allowAndLogDNS = /\ballow-dns\b/i.test(options);
  const ctrlNetSvc = grab(body, /set\s+control-default-network-services\s+(\S+)/i);
  if (ctrlNetSvc) parsed.networkProtocolEnforcement = ctrlNetSvc.toLowerCase() === "enable";

  // ── Nested blocks: entries + default-network-services ───────────────────────────────
  const nested = topLevelConfigBlocks(bodyLines);

  const entriesBlk = nested.find((b) => b.header === "entries");
  if (entriesBlk) {
    for (const e of topLevelEdits(entriesBlk.inner)) {
      const eb = e.body.join("\n");
      const action = entryAction(
        grab(eb, /set\s+action\s+([a-z-]+)/i) ?? null,
        grab(eb, /set\s+log\s+([a-z-]+)/i) ?? null,
        grab(eb, /set\s+quarantine\s+([a-z-]+)/i) ?? null,
      );

      const apps = numList(grab(eb, /set\s+application\s+([0-9\s]+)/i));
      const categories = numList(grab(eb, /set\s+category\s+([0-9\s]+)/i));
      const risk = numList(grab(eb, /set\s+risk\s+([0-9\s]+)/i));
      const popularity = narrowedPopularity(grab(eb, /set\s+popularity\s+([0-9\s]+)/i));
      const technologies = decodeAttr(grab(eb, /set\s+technology\s+([^\n]+)/i), TECHNOLOGY_BY_CODE);
      const behaviors = decodeAttr(grab(eb, /set\s+behavior\s+([^\n]+)/i), BEHAVIOR_BY_CODE);
      const protocols = plainAttr(grab(eb, /set\s+protocols\s+([^\n]+)/i));
      const vendors = plainAttr(grab(eb, /set\s+vendor\s+([^\n]+)/i));

      // 1) Application override — targets named apps by signature id.
      if (apps.length) {
        parsed.overrides.push({
          ...EMPTY_OVERRIDE, type: "application", action,
          applications: apps.map((id): AppSignatureRef => ({ id, name: "" })),
        });
        continue;
      }

      // 2) Filter override — any attribute beyond a bare category narrows the match.
      const narrowed = risk.length + popularity.length + technologies.length +
        behaviors.length + protocols.length + vendors.length;
      if (narrowed > 0) {
        parsed.overrides.push({
          ...EMPTY_OVERRIDE, type: "filter", action,
          categories, risk, popularity, technologies, behaviors, protocols, vendors,
        });
        continue;
      }

      // 3) Plain category entry — one tile action per category in the grid.
      for (const c of categories) parsed.categoryActions.push({ category: c, action });
    }
  }

  const npeBlk = nested.find((b) => b.header === "default-network-services");
  if (npeBlk) {
    for (const s of topLevelEdits(npeBlk.inner)) {
      const sb = s.body.join("\n");
      const port = parseInt(grab(sb, /set\s+port\s+(\d+)/i) ?? "", 10);
      if (Number.isNaN(port) || port <= 0) continue;
      parsed.networkServices.push({
        id: 0,
        port,
        services: plainAttr(grab(sb, /set\s+services\s+([^\n]+)/i)),
        violation_action: (grab(sb, /set\s+violation-action\s+(\S+)/i) ?? "block").toLowerCase() === "monitor"
          ? "monitor" : "block",
      });
    }
    // A default-network-services table only takes effect with the master toggle on.
    if (parsed.networkServices.length && parsed.networkProtocolEnforcement === undefined) {
      parsed.networkProtocolEnforcement = true;
    }
  }

  return parsed;
}

// Builds the full AppControlProfileForm from a parsed draft: seed every category from live
// metadata (P2P + Proxy blocked, the rest monitored — the FortiOS default sensor), then overlay
// everything the AI specified — category actions, Application/Filter overrides, Network Protocol
// Enforcement and the option toggles.
//
// `applications` (the device's live signature database) is used to resolve each override signature
// id to its real name AND to DROP any id the device doesn't have: an invented id would create a
// profile that silently matches nothing, so a signature the device never heard of is never saved.
export function appControlDraftToForm(
  parsed: ParsedAppControl | null,
  base: AppControlProfileForm,
  categoryIds: { id: number }[],
  applications: AppSignatureMeta[] = [],
): AppControlProfileForm {
  const DEFAULT_BLOCKED = [2, 6]; // P2P, Proxy
  const seeded: AppCategoryAction[] = categoryIds.map((c) => ({
    category: c.id,
    action: (DEFAULT_BLOCKED.includes(c.id) ? "block" : "monitor") as AppAction,
  }));
  const form: AppControlProfileForm = { ...base, categories: seeded, overrides: [], network_services: [] };
  return applyParsedAppControl(form, parsed, applications);
}

// Overlays everything a parsed draft specifies onto an existing form — used both to seed a NEW
// profile (over the default grid) and to apply the AI's proposal onto a profile already on the
// device, so an edit shows the AI's overrides instead of silently keeping only the old ones.
export function applyParsedAppControl(
  form: AppControlProfileForm,
  parsed: ParsedAppControl | null,
  applications: AppSignatureMeta[] = [],
): AppControlProfileForm {
  if (!parsed) return form;
  const out: AppControlProfileForm = { ...form };

  out.name = parsed.name;
  if (parsed.comment !== undefined) out.comment = parsed.comment;

  // Category grid — overlay the AI's actions onto whatever the grid already holds.
  if (parsed.categoryActions.length) {
    const byCat = new Map(out.categories.map((c) => [c.category, c.action] as const));
    for (const ca of parsed.categoryActions) byCat.set(ca.category, ca.action);
    out.categories = Array.from(byCat, ([category, action]) => ({ category, action }));
  }

  // Application / Filter overrides — resolve signature names, drop ids this device doesn't have.
  if (parsed.overrides.length) {
    const nameById = new Map(applications.map((a) => [a.id, a.name] as const));
    const knownDB = applications.length > 0;
    out.overrides = parsed.overrides.flatMap((o): AppOverride[] => {
      if (o.type !== "application") return [o];
      const apps = o.applications
        .filter((a) => !knownDB || nameById.has(a.id))
        .map((a) => ({ id: a.id, name: nameById.get(a.id) ?? a.name }));
      return apps.length ? [{ ...o, applications: apps }] : [];
    });
  }

  if (parsed.networkServices.length) out.network_services = parsed.networkServices;
  if (parsed.networkProtocolEnforcement !== undefined) out.network_protocol_enforcement = parsed.networkProtocolEnforcement;
  if (parsed.unknownApplicationAction !== undefined) out.unknown_application_action = parsed.unknownApplicationAction;
  if (parsed.blockNonDefaultPorts !== undefined) out.block_non_default_ports = parsed.blockNonDefaultPorts;
  if (parsed.allowAndLogDNS !== undefined) out.allow_and_log_dns = parsed.allowAndLogDNS;
  if (parsed.replacementMessages !== undefined) out.replacement_messages = parsed.replacementMessages;

  return out;
}

import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type { FileFilterProfileForm, FileFilterRule } from "../../api/policyObject";

// A parsed File Filter draft plus the profile's CURRENT name (the `edit "X"` key), so the wizard
// can find an existing profile even when the AI renames it (the new name lives in form.name).
export type ParsedFileFilter = { form: Partial<FileFilterProfileForm>; target: string };

// A file-filter profile nests `config rules … edit "<rule>" … next … end` INSIDE its own
// `edit … next`, so this parser walks the CLI with the balanced helpers rather than a flat regex:
// a non-greedy /edit … next/ stops at the first RULE's `next` and silently truncates the profile.
const FF_HEADERS = new Set(["file-filter profile", "file-filter.profile"]);

// Values FortiOS accepts, so a hallucinated one is dropped rather than shipped to the device.
const PROTOCOLS = new Set(["http", "ftp", "smtp", "imap", "pop3", "mapi", "cifs", "ssh"]);
const DIRECTIONS = new Set(["incoming", "outgoing", "any"]);

function parseSetLine(line: string): { key: string; tokens: string[] } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key: m[1].toLowerCase(), tokens };
}

const isEnable = (v?: string) => (v ?? "").toLowerCase() === "enable";

// parseRule turns one `edit "<rule>" … next` body from inside `config rules` into a FileFilterRule.
//
// ⚠️ The CLI has NO "monitor" keyword — FortiOS stores the GUI's Monitor as "log-only", so that is
// what the AI is told to emit and what we map back here (see services/fortigate.go).
function parseRule(name: string, bodyLines: string[]): FileFilterRule {
  const body = bodyLines.join("\n");
  const rule: FileFilterRule = {
    name,
    comment: "",
    protocols: [],
    direction: "any",
    password_protected: false,
    file_types: [],
    action: "monitor",
  };

  for (const line of body.split("\n")) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name":
        if (tokens[0]) rule.name = tokens[0];
        break;
      case "comment":
      case "comments":
        rule.comment = tokens.join(" ");
        break;
      case "protocol":
        rule.protocols = tokens.map((t) => t.toLowerCase()).filter((t) => PROTOCOLS.has(t));
        break;
      case "action":
        // log-only → the GUI's Monitor; anything that isn't block is the safe, non-blocking action.
        rule.action = tokens[0]?.toLowerCase() === "block" ? "block" : "monitor";
        break;
      case "direction": {
        const d = tokens[0]?.toLowerCase() ?? "";
        rule.direction = (DIRECTIONS.has(d) ? d : "any") as FileFilterRule["direction"];
        break;
      }
      case "password-protected":
        rule.password_protected = tokens[0]?.toLowerCase() === "yes";
        break;
      case "file-type":
      case "file-types":
        // "set file-type exe bat elf" — a space-separated list, or quoted names.
        rule.file_types = tokens.filter(Boolean);
        break;
      default:
        break;
    }
  }
  return rule;
}

// parseProfileEdit converts one top-level `edit "<profile>" … next` body into a draft.
function parseProfileEdit(target: string, bodyLines: string[]): ParsedFileFilter | null {
  if (!target) return null;
  const form: Partial<FileFilterProfileForm> = {
    name: target,
    comment: "",
    // The GUI defaults "Scan archive contents" ON; only an explicit disable turns it off.
    scan_archive_contents: true,
    rules: [],
  };

  // Split the profile's own set-lines from the nested `config rules … end`, so a rule's
  // "set comment" can never be read as the profile's.
  for (const { header, inner } of topLevelConfigBlocks(bodyLines)) {
    if (header !== "rules") continue;
    for (const e of topLevelEdits(inner)) {
      if (e.name) form.rules!.push(parseRule(e.name, e.body));
    }
  }

  let cfgDepth = 0;
  for (const line of bodyLines) {
    if (/^\s*config\s+/i.test(line)) { cfgDepth++; continue; }
    if (/^\s*end\s*$/i.test(line))   { cfgDepth--; continue; }
    if (cfgDepth > 0) continue; // inside `config rules` — not a profile field
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name":
        if (tokens[0]) form.name = tokens[0]; // rename → new name
        break;
      case "comment":
      case "comments":
        form.comment = tokens.join(" ");
        break;
      case "scan-archive-contents":
        form.scan_archive_contents = isEnable(tokens[0]);
        break;
      default:
        break;
    }
  }
  return { form, target };
}

// parseAllFileFiltersFromCLI extracts EVERY file-filter profile — a multi-policy suggestion may
// define more than one.
export function parseAllFileFiltersFromCLI(cliText: string): ParsedFileFilter[] {
  const lines = normalizeCLI(cliText).split("\n");
  const out: ParsedFileFilter[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    if (!FF_HEADERS.has(header)) continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parseProfileEdit(e.name, e.body);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// Parses the FIRST file-filter profile block from AI CLI into a draft the wizard can prefill.
export function parseFileFilterFromCLI(cliText: string): ParsedFileFilter | null {
  return parseAllFileFiltersFromCLI(cliText)[0] ?? null;
}

// The six formats the device accepts with password-protected=yes (verified live). Mirrors
// fileFilterPasswordProtectedTypes in backend/services/fortigate.go.
const PASSWORD_PROTECTED_TYPES = new Set(["7z", "msoffice", "msofficex", "pdf", "rar", "zip"]);

// fileFilterDraftToForm normalises a parsed draft into a complete form for creation, keeping the
// draft honest about what the device will actually store:
//   · a rule with password-protected on can only carry archive/document types (others ⇒ -3), and
//   · direction only applies to http/ftp/ssh/cifs (a mail-only rule is forced to "any").
// Both are dropped here rather than sent and silently mangled.
export function fileFilterDraftToForm(draft: Partial<FileFilterProfileForm>): FileFilterProfileForm {
  const rules = (draft.rules ?? []).map((r) => {
    const fileTypes = r.password_protected
      ? r.file_types.filter((t) => PASSWORD_PROTECTED_TYPES.has(t.toLowerCase()))
      : r.file_types;
    const canDirect = r.protocols.length === 0
      || r.protocols.some((p) => ["http", "ftp", "ssh", "cifs"].includes(p.toLowerCase()));
    return {
      name: r.name,
      comment: r.comment ?? "",
      protocols: r.protocols ?? [],
      direction: canDirect ? r.direction : "any",
      password_protected: !!r.password_protected,
      file_types: fileTypes,
      action: r.action === "block" ? "block" : "monitor",
    } as FileFilterRule;
  });

  return {
    name: draft.name ?? "",
    comment: draft.comment ?? "",
    scan_archive_contents: draft.scan_archive_contents ?? true,
    // A rule with no file types is rejected by the device (-61), so never ship one.
    rules: rules.filter((r) => r.name.trim() !== "" && r.file_types.length > 0),
  };
}

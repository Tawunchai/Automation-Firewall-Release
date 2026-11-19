import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type { LocalUserPayload, LocalUserTwoFactor } from "../../api/policyObject";

// A parsed local-user draft plus the user's CURRENT name (the `edit "X"` key), so the wizard can
// find an existing user even when the AI renames it (the new name lives in form.name).
export type ParsedLocalUser = { form: LocalUserPayload; target: string };

// user/local has no nested sub-blocks today, but it is walked with the same balanced helpers as
// the other parsers so a future one can't silently truncate an entry.
const UL_HEADERS = new Set(["user local", "user.local"]);

// The app only builds "Local User" (type=password); the remote types need a server object.
const LOCAL_TYPE = "password";
// The wizard's 2FA modes. The CMDB also allows email/sms, but those aren't auth types in the GUI.
const TWO_FACTORS = new Set<LocalUserTwoFactor>(["disable", "fortitoken", "fortitoken-cloud"]);

function parseSetLine(line: string): { key: string; tokens: string[] } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key: m[1].toLowerCase(), tokens };
}

// A model that won't invent a password sometimes writes a placeholder instead. The user APPLIES
// this CLI verbatim, so "<UNKNOWN>" would silently become the account's real password. The prompt
// forbids it (see ai.go), and this drops it if one slips through: no password reaches the backend,
// which then rejects the create with "password is required" instead of making a weak account.
const PLACEHOLDER_PASSWORD = /^<.*>$|^(changeme|password|placeholder|todo|xxx+)$/i;

export const isPlaceholderPassword = (v: string) => PLACEHOLDER_PASSWORD.test(v.trim());

// splitSMSPhone reverses the "+66-812345678" form FortiOS stores in sms-phone. Mirrors
// splitSMSPhone in backend/services/fortigate.go.
export function splitSMSPhone(v: string): { code: string; phone: string } {
  const s = (v ?? "").trim();
  if (!s) return { code: "", phone: "" };
  if (s.startsWith("+")) {
    const i = s.indexOf("-");
    if (i > 0) return { code: s.slice(0, i), phone: s.slice(i + 1) };
  }
  return { code: "", phone: s };
}

function parseUserEdit(target: string, bodyLines: string[]): ParsedLocalUser | null {
  if (!target) return null;
  const body = bodyLines.join("\n");
  const form: LocalUserPayload = {
    name: target,
    type: LOCAL_TYPE,
    two_factor: "disable",
    status: true, // FortiOS defaults user/local status to enable
  };

  for (const line of body.split("\n")) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name":
        if (tokens[0]) form.name = tokens[0]; // rename → new name
        break;
      case "passwd":
      case "password": {
        const pw = tokens.join(" ");
        if (!isPlaceholderPassword(pw)) form.password = pw;
        break;
      }
      case "status":
        form.status = tokens[0]?.toLowerCase() === "enable";
        break;
      case "two-factor": {
        const v = tokens[0]?.toLowerCase() as LocalUserTwoFactor;
        if (TWO_FACTORS.has(v)) form.two_factor = v;
        break;
      }
      case "fortitoken":
        form.fortitoken = tokens[0];
        break;
      case "email-to":
        form.email_to = tokens[0];
        break;
      case "sms-phone": {
        const { code, phone } = splitSMSPhone(tokens.join(" "));
        if (phone) {
          form.sms_enabled = true;
          form.sms_country_code = code;
          form.sms_phone = phone;
        }
        break;
      }
      default:
        // "set type password" is the only type we build; anything else is caught below.
        break;
    }
  }

  // A remote user (radius/tacacs+/ldap) isn't a local user — surface it as unsupported rather
  // than quietly creating a local account with the same name.
  const typeLine = body.match(/^\s*set\s+type\s+(\S+)/im);
  if (typeLine && typeLine[1].toLowerCase() !== LOCAL_TYPE) return null;

  return { form, target };
}

// parseAllUserDefinitionsFromCLI extracts EVERY local-user block — "create 3 staff accounts"
// yields three. A remote (radius/tacacs+/ldap) entry is skipped, not silently made local.
export function parseAllUserDefinitionsFromCLI(cliText: string): ParsedLocalUser[] {
  const lines = normalizeCLI(cliText).split("\n");
  const out: ParsedLocalUser[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    if (!UL_HEADERS.has(header)) continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parseUserEdit(e.name, e.body);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// Parses the FIRST local-user block from AI CLI into a draft the wizard can prefill.
export function parseUserDefinitionFromCLI(cliText: string): ParsedLocalUser | null {
  return parseAllUserDefinitionsFromCLI(cliText)[0] ?? null;
}

// userDefinitionDraftToForm normalises a parsed draft into a complete create payload, dropping the
// contact fields that only matter with 2FA on (the device clears them anyway).
export function userDefinitionDraftToForm(draft: LocalUserPayload): LocalUserPayload {
  const out: LocalUserPayload = {
    name: draft.name,
    type: "password",
    two_factor: draft.two_factor ?? "disable",
    status: draft.status ?? true,
    groups: [], // membership is set from the group side — see parseUserGroupCLI
  };
  if (draft.password) out.password = draft.password;
  if (out.two_factor !== "disable") {
    // fortitoken-cloud has no serial of its own; a stale one would be wrong.
    if (out.two_factor === "fortitoken" && draft.fortitoken) out.fortitoken = draft.fortitoken;
    out.email_to = draft.email_to ?? "";
    out.sms_enabled = !!draft.sms_enabled;
    if (out.sms_enabled) {
      out.sms_country_code = draft.sms_country_code ?? "";
      out.sms_phone = draft.sms_phone ?? "";
    }
  }
  return out;
}

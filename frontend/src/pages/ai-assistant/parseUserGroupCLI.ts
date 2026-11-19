import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type { UserGroupPayload, UserGroupType, UserGroupMatch } from "../../api/policyObject";

// A parsed user-group draft plus the group's CURRENT name (the `edit "X"` key), so the wizard can
// find an existing group even when the AI renames it (the new name lives in form.name).
export type ParsedUserGroup = { form: UserGroupPayload; target: string };

// A group can nest `config match … edit 1 … next … end` (the LDAP/FSSO server+group pairs) inside
// its own `edit … next`, so this parser walks the CLI with the balanced helpers: a flat non-greedy
// /edit … next/ stops at the sub-block's `next` and silently truncates the group.
const UG_HEADERS = new Set(["user group", "user.group"]);

const GROUP_TYPES = new Set<UserGroupType>(["firewall", "fsso-service", "rsso", "guest"]);
const USER_IDS = new Set(["email", "auto-generate", "specify"]);
const PASSWORDS = new Set(["auto-generate", "specify", "disable"]);
const SPONSORS = new Set(["optional", "mandatory", "disabled"]);
const EXPIRE_TYPES = new Set(["immediately", "first-successful-login"]);

function parseSetLine(line: string): { key: string; tokens: string[] } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key: m[1].toLowerCase(), tokens };
}

const isEnable = (v?: string) => (v ?? "").toLowerCase() === "enable";

// Only firewall / fsso-service groups store members — the device silently drops a member list on
// guest and rsso groups (verified live). Mirrors UserGroupTakesMembers in services/fortigate.go.
export const groupTakesMembers = (t: UserGroupType) => t === "firewall" || t === "fsso-service";

// Mirrors UserGroupTakesMatches in services/fortigate.go — the Remote Groups table is Firewall-only.
export const groupTakesMatches = (t: UserGroupType) => t === "firewall";

// parseMatchBlock reads the `config match … edit N … next … end` sub-block into Remote Group rows.
// The device's `id` is positional and meaningless to the user, so it is dropped — the backend
// re-numbers the rows from their order.
function parseMatchBlock(inner: string[]): UserGroupMatch[] {
  const out: UserGroupMatch[] = [];
  for (const e of topLevelEdits(inner)) {
    let serverName = "";
    let groupName = "";
    for (const line of e.body) {
      const stmt = parseSetLine(line);
      if (!stmt) continue;
      // A DN holds commas and spaces ("CN=VPN Users,OU=Groups,DC=corp") — parseSetLine's quoted
      // capture keeps it whole, so join the tokens back for the unquoted case.
      if (stmt.key === "server-name") serverName = stmt.tokens[0] ?? "";
      else if (stmt.key === "group-name") groupName = stmt.tokens.join(" ");
    }
    // A row missing either half cannot be applied (server-name is a datasource → -3), so it is
    // dropped rather than shown to the user as a half-filled row.
    if (serverName && groupName) out.push({ server_name: serverName, group_name: groupName });
  }
  return out;
}

function parseGroupEdit(target: string, bodyLines: string[]): ParsedUserGroup | null {
  if (!target) return null;
  const form: UserGroupPayload = { name: target, group_type: "firewall" };
  let members: string[] = [];
  let matches: UserGroupMatch[] = [];

  // `config match` (the Remote Groups table) is parsed by its own reader; every OTHER sub-block is
  // skipped so a nested "set group-name" can't be mistaken for a field of the group itself.
  let cfgDepth = 0;
  let matchInner: string[] | null = null;
  for (const line of bodyLines) {
    if (/^\s*config\s+/i.test(line)) {
      cfgDepth++;
      // Only the OUTERMOST `config match` is the table — anything nested deeper isn't one.
      if (cfgDepth === 1 && /^\s*config\s+match\s*$/i.test(line)) matchInner = [];
      else if (matchInner) matchInner.push(line);
      continue;
    }
    if (/^\s*end\s*$/i.test(line)) {
      cfgDepth--;
      if (cfgDepth === 0 && matchInner) {
        matches = matches.concat(parseMatchBlock(matchInner));
        matchInner = null;
      } else if (matchInner) matchInner.push(line);
      continue;
    }
    if (cfgDepth > 0) {
      if (matchInner) matchInner.push(line);
      continue;
    }
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name":
        if (tokens[0]) form.name = tokens[0]; // rename → new name
        break;
      case "group-type": {
        const t = tokens[0]?.toLowerCase() as UserGroupType;
        if (GROUP_TYPES.has(t)) form.group_type = t;
        break;
      }
      case "member":
        // "set member "alice" "bob"" — the line replaces the whole list.
        members = tokens.filter(Boolean);
        break;
      case "sso-attribute-value":
        form.sso_attribute_value = tokens.join(" ");
        break;
      // ── guest block ──
      case "multiple-guest-add":
        form.multiple_guest_add = isEnable(tokens[0]);
        break;
      case "user-id": {
        const v = tokens[0]?.toLowerCase();
        if (v && USER_IDS.has(v)) form.user_id = v as UserGroupPayload["user_id"];
        break;
      }
      case "password": {
        const v = tokens[0]?.toLowerCase();
        if (v && PASSWORDS.has(v)) form.password = v as UserGroupPayload["password"];
        break;
      }
      case "user-name":
        form.user_name = isEnable(tokens[0]);
        break;
      case "email":
        form.email = isEnable(tokens[0]);
        break;
      case "mobile-phone":
        form.mobile_phone = isEnable(tokens[0]);
        break;
      case "sms-server": {
        const v = tokens[0]?.toLowerCase();
        if (v === "fortiguard" || v === "custom") form.sms_server = v;
        break;
      }
      case "sms-custom-server":
        form.sms_custom_server = tokens[0];
        break;
      case "sponsor": {
        const v = tokens[0]?.toLowerCase();
        if (v && SPONSORS.has(v)) form.sponsor = v as UserGroupPayload["sponsor"];
        break;
      }
      case "company": {
        const v = tokens[0]?.toLowerCase();
        if (v && SPONSORS.has(v)) form.company = v as UserGroupPayload["company"];
        break;
      }
      case "expire-type": {
        const v = tokens[0]?.toLowerCase();
        if (v && EXPIRE_TYPES.has(v)) form.expire_type = v as UserGroupPayload["expire_type"];
        break;
      }
      case "expire": {
        const n = parseInt(tokens[0], 10);
        if (!Number.isNaN(n)) form.expire = n;
        break;
      }
      case "max-accounts": {
        const n = parseInt(tokens[0], 10);
        if (!Number.isNaN(n)) form.max_accounts = n;
        break;
      }
      default:
        break;
    }
  }

  // Members belong to firewall/fsso groups only — the device drops them elsewhere, so don't
  // pretend otherwise in the draft the user reviews.
  if (groupTakesMembers(form.group_type)) form.members = members;
  // Remote Groups are Firewall-only: a guest/rsso group stores match=[] while answering 200, and
  // an fsso-service group cannot hold the auth server as a member in the first place.
  if (groupTakesMatches(form.group_type) && matches.length > 0) form.matches = matches;
  return { form, target };
}

// parseAllUserGroupsFromCLI extracts EVERY user-group block — one request can define several.
export function parseAllUserGroupsFromCLI(cliText: string): ParsedUserGroup[] {
  const lines = normalizeCLI(cliText).split("\n");
  const out: ParsedUserGroup[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    if (!UG_HEADERS.has(header)) continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parseGroupEdit(e.name, e.body);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// Parses the FIRST user-group block from AI CLI into a draft the wizard can prefill.
export function parseUserGroupFromCLI(cliText: string): ParsedUserGroup | null {
  return parseAllUserGroupsFromCLI(cliText)[0] ?? null;
}

// userGroupDraftToForm normalises a parsed draft into a complete create payload, filling the
// defaults the device would apply and dropping what the chosen type doesn't use.
export function userGroupDraftToForm(draft: UserGroupPayload): UserGroupPayload {
  const t = draft.group_type ?? "firewall";
  if (groupTakesMembers(t)) {
    const out: UserGroupPayload = { name: draft.name, group_type: t, members: draft.members ?? [] };
    // ⚠️ A match's server MUST also be a member or the device rejects the whole group with -518.
    // The backend adds it too; doing it here as well keeps the draft the user reviews honest about
    // what will land.
    if (groupTakesMatches(t) && draft.matches?.length) {
      out.matches = draft.matches;
      const seen = new Set(out.members);
      for (const m of draft.matches) {
        if (m.server_name && !seen.has(m.server_name)) { seen.add(m.server_name); out.members!.push(m.server_name); }
      }
    }
    return out;
  }
  if (t === "rsso") {
    return { name: draft.name, group_type: t, sso_attribute_value: draft.sso_attribute_value ?? "" };
  }
  // guest — expire defaults to the GUI's 4 hours; max_accounts 0 = unlimited.
  const batch = !!draft.multiple_guest_add;
  const out: UserGroupPayload = {
    name: draft.name,
    group_type: "guest",
    multiple_guest_add: batch,
    max_accounts: draft.max_accounts ?? 0,
    expire_type: draft.expire_type ?? "immediately",
    expire: draft.expire ?? 14400,
  };
  // ⚠️ Under batch mode the device FORCES user-id/password to auto-generate and resets the rest of
  // the Guest Details, answering 200 either way — so those fields are omitted entirely.
  if (!batch) {
    out.user_id = draft.user_id ?? "email";
    out.password = draft.password ?? "auto-generate";
    out.user_name = draft.user_name ?? false;
    out.email = draft.email ?? true;
    out.mobile_phone = draft.mobile_phone ?? false;
    out.sponsor = draft.sponsor ?? "optional";
    out.company = draft.company ?? "optional";
    if (out.mobile_phone) {
      out.sms_server = draft.sms_server ?? "fortiguard";
      if (out.sms_server === "custom" && draft.sms_custom_server) {
        out.sms_custom_server = draft.sms_custom_server;
      }
    }
  }
  return out;
}

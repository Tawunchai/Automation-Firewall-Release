import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type { RADIUSServerPayload, RADIUSAuthType } from "../../api/policyObject";
import { isPlaceholderSecret } from "./parseLDAPServerCLI";

// Parses `config user radius` out of the AI's FortiOS CLI into the same draft the RADIUS Servers
// page uses, so the AI RADIUS Wizard opens on the real form.
//
// The form mirrors the FortiGate dialog: Name, Authentication method, NAS IP, Include in every
// user group, Primary Server, Secondary Server. user/radius also has tertiary-* and timeout, but
// the GUI shows neither — so this parser IGNORES both. A model that emits them is not an error;
// the extra keys simply never reach the device, and whatever the CLI already set stays put.

// A parsed RADIUS draft plus the server's CURRENT name (the `edit "X"` key), so the wizard can
// find an existing server even when the AI renames it.
export type ParsedRADIUSServer = { form: RADIUSServerPayload; target: string };

const RADIUS_HEADERS = new Set(["user radius", "user.radius"]);

// "auto" is the GUI's Default position, not an entry in the Specify dropdown.
const AUTH_TYPES = new Set<RADIUSAuthType>(["auto", "ms_chap_v2", "ms_chap", "chap", "pap"]);

function parseSetLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const raw = m[2].trim();
  const quoted = raw.match(/^"([\s\S]*)"$/);
  return { key: m[1].toLowerCase(), value: quoted ? quoted[1] : raw };
}

const isEnable = (v: string) => v.trim().toLowerCase() === "enable";

// The device's "unset" address. It can come back in a `show`, and the form shows those blank.
const UNSET_IPV4 = "0.0.0.0";
const host = (v: string) => (v === UNSET_IPV4 ? "" : v);

function parseRADIUSEdit(target: string, bodyLines: string[]): ParsedRADIUSServer | null {
  if (!target) return null;

  const form: RADIUSServerPayload = {
    name: target,
    auth_method_specify: false,
    auth_type: "auto",
    all_usergroup: false,
    server: "",
  };

  let cfgDepth = 0;
  for (const line of bodyLines) {
    if (/^\s*config\s+/i.test(line)) { cfgDepth++; continue; }
    if (/^\s*end\s*$/i.test(line))   { cfgDepth--; continue; }
    if (cfgDepth > 0) continue;

    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, value } = stmt;
    switch (key) {
      case "name":
        if (value) form.name = value; // rename → new name
        break;
      case "server":
        form.server = host(value);
        break;
      case "secret":
        // A shared secret the model invented is dropped — see isPlaceholderSecret.
        if (!isPlaceholderSecret(value)) form.secret = value;
        break;
      case "secondary-server":
        form.secondary_server = host(value);
        break;
      case "secondary-secret":
        if (!isPlaceholderSecret(value)) form.secondary_secret = value;
        break;
      case "auth-type": {
        const t = value.toLowerCase() as RADIUSAuthType;
        if (AUTH_TYPES.has(t)) {
          form.auth_type = t;
          // Anything other than auto means the GUI's switch sits on "Specify".
          form.auth_method_specify = t !== "auto";
        }
        break;
      }
      case "nas-ip": {
        const v = host(value);
        if (v) form.nas_ip = v;
        break;
      }
      case "all-usergroup":
        form.all_usergroup = isEnable(value);
        break;
      // tertiary-server / tertiary-secret / timeout: not in the GUI dialog — deliberately ignored.
      default:
        break;
    }
  }

  // A secondary secret without a host can't be applied — drop it rather than shipping a payload
  // FortiOS would reject.
  if (!form.secondary_server) delete form.secondary_secret;
  return { form, target };
}

// parseAllRADIUSServersFromCLI extracts EVERY `config user radius` entry — one request can define
// several ("add the NPS pair for HQ and branch").
export function parseAllRADIUSServersFromCLI(cliText: string): ParsedRADIUSServer[] {
  const lines = normalizeCLI(cliText).split("\n");
  const out: ParsedRADIUSServer[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    if (!RADIUS_HEADERS.has(header)) continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parseRADIUSEdit(e.name, e.body);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// Parses the FIRST RADIUS block into a draft the wizard can prefill.
export function parseRADIUSServerFromCLI(cliText: string): ParsedRADIUSServer | null {
  return parseAllRADIUSServersFromCLI(cliText)[0] ?? null;
}

// radiusServerDraftToForm normalises a parsed draft into a complete create payload. nas_ip is
// always present (blank included) because the backend turns a blank one into the device's
// 0.0.0.0 "unset"; the secondary host and both secrets are omitted when blank, since FortiOS
// rejects an empty address (-257) and a blank secret means "keep the stored one".
export function radiusServerDraftToForm(draft: RADIUSServerPayload): RADIUSServerPayload {
  const specify = !!draft.auth_method_specify && draft.auth_type !== "auto";
  const out: RADIUSServerPayload = {
    name: draft.name,
    auth_method_specify: specify,
    auth_type: specify ? (draft.auth_type ?? "pap") : "auto",
    nas_ip: draft.nas_ip ?? "",
    all_usergroup: !!draft.all_usergroup,
    server: draft.server ?? "",
  };
  if (draft.secret) out.secret = draft.secret;
  if (draft.secondary_server) {
    out.secondary_server = draft.secondary_server;
    if (draft.secondary_secret) out.secondary_secret = draft.secondary_secret;
  }
  return out;
}

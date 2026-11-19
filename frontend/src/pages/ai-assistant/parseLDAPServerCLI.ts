import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type { LDAPServerPayload, LDAPBindType, LDAPProtocol } from "../../api/policyObject";

// Parses `config user ldap` out of the AI's FortiOS CLI into the same draft the LDAP Servers
// page uses, so the AI LDAP Wizard opens on the real form.
//
// The GUI's four toggles have no CMDB field of their own — they are DERIVED here exactly as
// services/fortigate_authserver.go derives them when reading an object back off the device:
//   secure_enabled        ← `set secure starttls|ldaps`  (absent / "disable" ⇒ off)
//   protocol              ← the same `secure` value
//   cert_enabled          ← "is a ca-cert named?"
//   exchange_enabled      ← `set obtain-user-info enable`, or an exchange server being named
//
// ⚠️ obtain-user-info DEFAULTS TO enable on the device, so a draft with the toggle off must end
// up with exchange_enabled:false and the backend will send the explicit "disable".

// A parsed LDAP draft plus the server's CURRENT name (the `edit "X"` key), so the wizard can find
// an existing server even when the AI renames it (the new name lives in form.name).
export type ParsedLDAPServer = { form: LDAPServerPayload; target: string };

const LDAP_HEADERS = new Set(["user ldap", "user.ldap"]);

const BIND_TYPES = new Set<LDAPBindType>(["simple", "anonymous", "regular"]);
const PROTOCOLS = new Set<LDAPProtocol>(["starttls", "ldaps"]);

export const LDAP_PORT_PLAIN = 389;
export const LDAP_PORT_LDAPS = 636;

// A secret the model made up instead of leaving the field out. An LDAP bind password and a RADIUS
// shared secret belong to an EXISTING AD/NPS server — the AI cannot know them, and the prompt tells
// it to omit the line. This is the backstop for when it does not: the placeholder is dropped so the
// wizard shows an empty, required field instead of pushing a bogus credential onto a live firewall
// (Apply would otherwise send it verbatim, and the auth server would silently never authenticate).
const PLACEHOLDER_SECRET =
  /^(<[^>]*>|\{+[^}]*\}+|x{3,}|\*{3,}|\.{3,}|_+|-+|changeme|password|passwd|secret|your[-_ ]?(password|secret)|todo|tbd|n\/a|unknown|placeholder)$/i;

export const isPlaceholderSecret = (v: string): boolean =>
  !v.trim() || PLACEHOLDER_SECRET.test(v.trim());

// `set <key> <value>` → key + the value with any surrounding quotes stripped. A value can hold
// spaces and commas ("cn=svc account,dc=corp"), so the whole remainder is one token.
function parseSetLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const raw = m[2].trim();
  const quoted = raw.match(/^"([\s\S]*)"$/);
  return { key: m[1].toLowerCase(), value: quoted ? quoted[1] : raw };
}

const isEnable = (v: string) => v.trim().toLowerCase() === "enable";

function parseLDAPEdit(target: string, bodyLines: string[]): ParsedLDAPServer | null {
  if (!target) return null;

  const form: LDAPServerPayload = {
    name: target,
    server: "",
    port: LDAP_PORT_PLAIN,
    cnid: "cn",
    dn: "",
    exchange_enabled: false,
    bind_type: "simple",
    secure_enabled: false,
    cert_enabled: false,
    server_identity_check: false,
  };

  // Raw CMDB values, folded into the toggles after the loop — the order of `set` lines must not
  // change the result (e.g. `set ca-cert` before `set secure`).
  let secure = "";
  let caCert = "";
  let identityCheck: boolean | null = null;
  let obtainUserInfo: boolean | null = null;
  let exchangeServer = "";
  let portSeen = false;

  // A `config` sub-block inside the entry isn't part of this form — skip its lines so a nested
  // `set name` can't be mistaken for the server's own.
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
        form.server = value;
        break;
      case "port": {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n)) { form.port = n; portSeen = true; }
        break;
      }
      case "cnid":
        if (value) form.cnid = value;
        break;
      case "dn":
        form.dn = value;
        break;
      case "type": {
        const t = value.toLowerCase() as LDAPBindType;
        if (BIND_TYPES.has(t)) form.bind_type = t;
        break;
      }
      case "username":
        form.username = value;
        break;
      case "password":
        // Dropped when it is a made-up placeholder — see isPlaceholderSecret.
        if (!isPlaceholderSecret(value)) form.password = value;
        break;
      case "secure":
        secure = value.toLowerCase();
        break;
      case "ca-cert":
        caCert = value;
        break;
      case "server-identity-check":
        identityCheck = isEnable(value);
        break;
      case "obtain-user-info":
        obtainUserInfo = isEnable(value);
        break;
      case "user-info-exchange-server":
        exchangeServer = value;
        break;
      default:
        break;
    }
  }

  // Secure Connection + Protocol + Certificate.
  if (PROTOCOLS.has(secure as LDAPProtocol)) {
    form.secure_enabled = true;
    form.protocol = secure as LDAPProtocol;
    if (caCert) {
      form.cert_enabled = true;
      form.ca_cert = caCert;
      // The CMDB default is enable, which is also what the GUI pre-selects.
      form.server_identity_check = identityCheck ?? true;
    }
    // The GUI moves the port to 636 for LDAPS; do the same when the AI didn't say one, so the
    // draft is usable as-is rather than silently pointing LDAPS at 389.
    if (!portSeen && secure === "ldaps") form.port = LDAP_PORT_LDAPS;
  }

  // Exchange server. Naming a connector implies the feature, which is what the GUI does when you
  // pick one; an explicit "set obtain-user-info disable" still wins.
  const exchangeOn = obtainUserInfo ?? !!exchangeServer;
  if (exchangeOn && exchangeServer) {
    form.exchange_enabled = true;
    form.exchange_server = exchangeServer;
  }

  // Credentials belong to a Regular bind only — FortiOS ignores them otherwise, and carrying
  // them into the draft would show the user fields the form doesn't render.
  if (form.bind_type !== "regular") {
    delete form.username;
    delete form.password;
  }
  return { form, target };
}

// parseAllLDAPServersFromCLI extracts EVERY `config user ldap` entry — one request can define
// several ("add our two domain controllers").
export function parseAllLDAPServersFromCLI(cliText: string): ParsedLDAPServer[] {
  const lines = normalizeCLI(cliText).split("\n");
  const out: ParsedLDAPServer[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    if (!LDAP_HEADERS.has(header)) continue;
    for (const e of topLevelEdits(inner)) {
      const parsed = parseLDAPEdit(e.name, e.body);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// Parses the FIRST LDAP block into a draft the wizard can prefill.
export function parseLDAPServerFromCLI(cliText: string): ParsedLDAPServer | null {
  return parseAllLDAPServersFromCLI(cliText)[0] ?? null;
}

// ldapServerDraftToForm normalises a parsed draft into a complete create payload, filling the
// defaults the device would apply and dropping what the chosen toggles don't use. Apply uses
// this directly; the wizard runs it through ldapServerToForm for editing.
export function ldapServerDraftToForm(draft: LDAPServerPayload): LDAPServerPayload {
  const secure = !!draft.secure_enabled;
  const cert = secure && !!draft.cert_enabled && !!draft.ca_cert;
  const out: LDAPServerPayload = {
    name: draft.name,
    server: draft.server ?? "",
    port: draft.port || (secure && draft.protocol === "ldaps" ? LDAP_PORT_LDAPS : LDAP_PORT_PLAIN),
    cnid: draft.cnid || "cn",
    dn: draft.dn ?? "",
    exchange_enabled: !!draft.exchange_enabled && !!draft.exchange_server,
    bind_type: draft.bind_type ?? "simple",
    secure_enabled: secure,
    cert_enabled: cert,
    server_identity_check: cert && !!draft.server_identity_check,
  };
  if (out.exchange_enabled) out.exchange_server = draft.exchange_server;
  if (out.bind_type === "regular") {
    out.username = draft.username ?? "";
    if (draft.password) out.password = draft.password;
  }
  if (secure) out.protocol = draft.protocol ?? "starttls";
  if (cert) out.ca_cert = draft.ca_cert;
  return out;
}

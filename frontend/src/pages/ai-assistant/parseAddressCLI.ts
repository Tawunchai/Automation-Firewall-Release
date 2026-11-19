import { normalizeCLI } from "./parsePrereqCLI";
import { FG_COLORS } from "../../lib/categoryColor";
import { BLANK_ADDRESS_FORM, type AddressFormState, type FGAddrType } from "../fw-addresses/address-form.logic";

// A parsed draft plus the address's CURRENT name (the `edit "X"` key), so the wizard can find
// the existing object even on a rename (the new name lives in form.name).
export type ParsedAddress = { form: Partial<AddressFormState>; target: string };

// Parses the first `config firewall address ... edit "<name>" ... next ... end` block from
// AI-generated FortiOS CLI into a partial AddressFormState the Address wizard can prefill.
// Returns null when the text has no firewall-address block (e.g. it's a policy/antivirus
// suggestion) or when no name was found (spurious match).
//
// Field mapping mirrors addrInputToFG()/the FGAddress struct in
// backend/services/fortigate.go — the same CLI keys FortiOS itself uses and the AI's system
// prompt teaches it to emit. Only the FIRST address block is parsed; extra blocks stay as
// plain CLI text in the chat.

type CLIStatement = { key: string; tokens: string[] };

function parseSetLine(line: string): CLIStatement | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key, tokens };
}

const KNOWN_TYPES = new Set<FGAddrType>([
  "ipmask", "iprange", "fqdn", "geography", "dynamic", "mac", "wildcard-fqdn", "interface-subnet",
]);

export function parseAddressFromCLI(cliText: string): ParsedAddress | null {
  cliText = normalizeCLI(cliText);
  const configMatch = cliText.match(/config\s+firewall\s+address\b([\s\S]*?)\n\s*end\b/i)
    ?? cliText.match(/config\s+firewall\s+address\b([\s\S]*)/i);
  if (!configMatch) return null;

  const editMatch = configMatch[1].match(/edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/i);
  if (!editMatch) return null;

  return parseAddressEdit(editMatch[1].trim(), editMatch[2]);
}

// parseAllAddressesFromCLI extracts EVERY `edit … next` entry inside the (possibly single)
// `config firewall address` block — so a suggestion that defines both a source and a
// destination address yields both. Used to auto-create referenced addresses when the user
// jumps straight to the Policy Wizard without opening the Address Wizard first.
export function parseAllAddressesFromCLI(cliText: string): ParsedAddress[] {
  cliText = normalizeCLI(cliText);
  const configMatch = cliText.match(/config\s+firewall\s+address\b([\s\S]*?)\n\s*end\b/i)
    ?? cliText.match(/config\s+firewall\s+address\b([\s\S]*)/i);
  if (!configMatch) return [];
  const out: ParsedAddress[] = [];
  const re = /edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(configMatch[1])) !== null) {
    const parsed = parseAddressEdit(m[1].trim(), m[2]);
    if (parsed) out.push(parsed);
  }
  return out;
}

// parseAddressEdit converts one `edit "<name>" … next` body into a ParsedAddress.
function parseAddressEdit(target: string, body: string): ParsedAddress | null {
  if (!target) return null;

  const draft: Partial<AddressFormState> = { name: target };
  let explicitType: FGAddrType | null = null;
  let startIp = "", endIp = "";
  const macAddrs: string[] = [];

  for (const rawLine of body.split("\n")) {
    const stmt = parseSetLine(rawLine);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    const val = tokens[0] ?? "";

    switch (key) {
      case "type":
        // FortiOS emits "wildcard" for IP wildcard masks; we don't surface that as a
        // create option, so treat only the address types we know.
        if (KNOWN_TYPES.has(val as FGAddrType)) explicitType = val as FGAddrType;
        break;
      case "subnet": {
        // "10.10.10.0 255.255.255.0" → keep as-is; the form/back-end accept either mask or CIDR.
        draft.subnet = tokens.join(" ");
        break;
      }
      case "start-ip": startIp = val; break;
      case "end-ip":   endIp = val; break;
      case "fqdn":     draft.fqdn = val; break;
      case "country":  draft.country = val.toUpperCase(); break;
      case "sub-type": draft.subType = val; break;
      case "sdn":      draft.sdn = val; break;
      case "macaddr":  if (val) macAddrs.push(val); break;
      case "associated-interface": draft.iface = val; break;
      case "allow-routing": draft.allowRouting = val.toLowerCase() === "enable"; break;
      case "color": {
        const idx = parseInt(val, 10);
        if (!Number.isNaN(idx) && idx > 0 && idx < FG_COLORS.length) draft.color = FG_COLORS[idx];
        break;
      }
      case "name":     if (val) draft.name = val; break; // rename: new name
      case "comment":
      case "comments": draft.comment = tokens.join(" "); break;
      default: break;
    }
  }

  if (startIp || endIp) draft.ipRange = [startIp, endIp].filter(Boolean).join("-");
  if (macAddrs.length) draft.macAddrs = macAddrs;

  // Determine type: explicit `set type` wins; otherwise infer from which value fields exist.
  let type: FGAddrType | null = explicitType;
  if (!type) {
    if (draft.ipRange) type = "iprange";
    else if (draft.fqdn) type = "fqdn";
    else if (draft.country) type = "geography";
    else if (draft.sdn || draft.subType) type = "dynamic";
    else if (macAddrs.length) type = "mac";
    else if (draft.subnet) type = "ipmask";
  }
  // A wildcard FQDN is a plain fqdn object on the device.
  if (type === "wildcard-fqdn") type = "fqdn";
  if (type) draft.type = type;

  return { form: draft, target };
}

// Merges a parsed partial draft over the blank defaults so every AddressFormState field has a
// valid value the wizard can render immediately. `base` lets the edit flow start from the
// existing device object instead of the blank form.
export function addressDraftToForm(
  draft: Partial<AddressFormState>,
  base: AddressFormState = BLANK_ADDRESS_FORM,
): AddressFormState {
  return { ...base, ...draft };
}

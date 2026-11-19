import { normalizeCLI } from "./parsePrereqCLI";
import { SERVICE_CATEGORIES, type ServiceCategory, type ServiceProtocol } from "../../api/policyObject";
import { FG_COLORS } from "../fw-services/service-form";
import { blankServiceForm, parsePortsIntoEntries, type ServiceFormState } from "../fw-services/service-form.logic";

// A parsed draft plus the service's CURRENT name (the `edit "X"` key), so the wizard can find the
// existing object even on a rename (the new name lives in form.name).
export type ParsedService = { form: Partial<ServiceFormState>; target: string };

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

const VALID_CATEGORIES = new Set<string>(SERVICE_CATEGORIES as readonly string[]);

// Normalize FortiOS protocol token → our ServiceProtocol.
function normalizeProtocol(v: string): ServiceProtocol | null {
  const u = v.toUpperCase();
  if (u === "TCP/UDP/SCTP") return "TCP/UDP/SCTP";
  if (u === "IP") return "IP";
  if (u === "ICMP") return "ICMP";
  if (u === "ICMP6" || u === "ICMPV6") return "ICMPv6";
  return null;
}

// Parses the first `config firewall service custom ... edit "<name>" ... next ... end` block from
// AI-generated FortiOS CLI into a partial ServiceFormState the Service wizard can prefill.
// Field mapping mirrors svcInputToFG()/the FGService struct in backend/services/fortigate.go.
export function parseServiceFromCLI(cliText: string): ParsedService | null {
  cliText = normalizeCLI(cliText);
  const configMatch = cliText.match(/config\s+firewall\s+service\s+custom\b([\s\S]*?)\n\s*end\b/i)
    ?? cliText.match(/config\s+firewall\s+service\s+custom\b([\s\S]*)/i);
  if (!configMatch) return null;

  const editMatch = configMatch[1].match(/edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/i);
  if (!editMatch) return null;

  return parseServiceEdit(editMatch[1].trim(), editMatch[2]);
}

// parseAllServicesFromCLI extracts EVERY `edit … next` entry inside the (possibly single)
// `config firewall service custom` block — so a suggestion that defines several custom services
// yields all of them. Used to auto-create referenced-but-missing services when the user jumps
// straight to the Policy Wizard and hits Apply.
export function parseAllServicesFromCLI(cliText: string): ParsedService[] {
  cliText = normalizeCLI(cliText);
  const configMatch = cliText.match(/config\s+firewall\s+service\s+custom\b([\s\S]*?)\n\s*end\b/i)
    ?? cliText.match(/config\s+firewall\s+service\s+custom\b([\s\S]*)/i);
  if (!configMatch) return [];
  const out: ParsedService[] = [];
  const re = /edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(configMatch[1])) !== null) {
    const parsed = parseServiceEdit(m[1].trim(), m[2]);
    if (parsed) out.push(parsed);
  }
  return out;
}

// parseServiceEdit converts one `edit "<name>" … next` body into a ParsedService.
function parseServiceEdit(target: string, body: string): ParsedService | null {
  if (!target) return null;

  const draft: Partial<ServiceFormState> = { name: target };
  let protocol: ServiceProtocol | null = null;
  let tcp = "", udp = "", sctp = "";
  let fqdn = "", iprange = "";

  for (const rawLine of body.split("\n")) {
    const stmt = parseSetLine(rawLine);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    const val = tokens[0] ?? "";

    switch (key) {
      case "name":     if (val) draft.name = val; break; // rename: new name
      case "protocol": protocol = normalizeProtocol(val); break;
      case "tcp-portrange":  tcp  = tokens.join(" "); break;
      case "udp-portrange":  udp  = tokens.join(" "); break;
      case "sctp-portrange": sctp = tokens.join(" "); break;
      case "protocol-number": draft.ipProto = parseInt(val, 10) || 0; break;
      case "icmptype": draft.icmpType = parseInt(val, 10); break;
      case "icmpcode": draft.icmpCode = parseInt(val, 10); break;
      case "fqdn":     fqdn = val; break;
      case "iprange":  iprange = val; break;
      case "category": if (VALID_CATEGORIES.has(tokens.join(" "))) draft.category = tokens.join(" ") as ServiceCategory; break;
      case "color": {
        const idx = parseInt(val, 10);
        if (!Number.isNaN(idx) && idx > 0 && idx < FG_COLORS.length) draft.color = FG_COLORS[idx];
        break;
      }
      case "comment":
      case "comments": draft.comments = tokens.join(" "); break;
      default: break;
    }
  }

  // Infer protocol from which fields are present when not stated explicitly.
  if (!protocol) {
    if (tcp || udp || sctp) protocol = "TCP/UDP/SCTP";
    else if (draft.ipProto != null) protocol = "IP";
    else if (draft.icmpType != null || draft.icmpCode != null) protocol = "ICMP";
  }
  if (protocol) draft.protocol = protocol;

  if (protocol === "TCP/UDP/SCTP" || tcp || udp || sctp) {
    const { entries, srcEnabled } = parsePortsIntoEntries(tcp, udp, sctp);
    draft.destPorts = entries;
    draft.srcEnabled = srcEnabled;
    if (fqdn)         { draft.addrMode = "fqdn";    draft.addrVal = fqdn; }
    else if (iprange) { draft.addrMode = "iprange"; draft.addrVal = iprange; }
  }

  return { form: draft, target };
}

// Merges a parsed partial draft over blank defaults (or over the existing service for an edit).
export function serviceDraftToForm(
  draft: Partial<ServiceFormState>,
  base: ServiceFormState = blankServiceForm(),
): ServiceFormState {
  return { ...base, ...draft };
}

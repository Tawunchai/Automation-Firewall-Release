import type { VirtualIP, VIPProtocol } from "../../api/policyObject";
import { EMPTY_VIP } from "../virtual-ips/vip-form-rules";
import { topLevelConfigBlocks, topLevelEdits, normalizeCLI } from "./parsePrereqCLI";

// A parsed draft plus the VIP's CURRENT name (the `edit "X"` key), so the wizard can find the
// existing object even on a rename (the new name lives in form.name).
//
// Everything the FortiOS firewall/vip object can express through the form is parsed: Static NAT
// vs FQDN, the port-forward block, and the Optional Filters (source addresses + services) — so a
// VIP the AI proposes arrives in the wizard complete.
export type ParsedVIP = { form: Partial<VirtualIP>; target: string };

const normProtocol = (v: string | undefined): VIPProtocol => {
  const u = (v ?? "").toLowerCase();
  return u === "udp" || u === "sctp" || u === "icmp" ? (u as VIPProtocol) : "tcp";
};

// FortiOS stores a range as "a-b" over REST but the CLI writes two space-separated IPs for a
// range on some fields; normalise "a b" → "a-b" and leave a single IP alone.
const normRange = (tokens: string[]): string => {
  if (tokens.length >= 2) return `${tokens[0]}-${tokens[1]}`;
  return tokens[0] ?? "";
};

// Split a `set key "a" "b"` / `set key a b` value list.
const values = (body: string, key: string): string[] => {
  const m = body.match(new RegExp(`^\\s*set\\s+${key}\\s+(.+)$`, "im"));
  if (!m) return [];
  const rest = m[1].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return quoted.length ? quoted : rest.split(/\s+/).filter(Boolean);
};
const first = (body: string, key: string): string => values(body, key)[0] ?? "";

// Parses the first `config firewall vip … edit "<name>" … next … end` block.
export function parseVIPFromCLI(cliText: string): ParsedVIP | null {
  const cli = normalizeCLI(cliText);
  const lines = cli.split("\n");
  const blk = topLevelConfigBlocks(lines).find((b) => b.header === "firewall vip");
  if (!blk) return null;
  const edits = topLevelEdits(blk.inner);
  if (edits.length === 0) return null;
  return parseVIPEdit(edits[0].name.trim(), edits[0].body.join("\n"));
}

// Parses EVERY `edit … next` in the block — a suggestion may expose two servers at once.
export function parseAllVIPsFromCLI(cliText: string): ParsedVIP[] {
  const cli = normalizeCLI(cliText);
  const lines = cli.split("\n");
  const blk = topLevelConfigBlocks(lines).find((b) => b.header === "firewall vip");
  if (!blk) return [];
  const out: ParsedVIP[] = [];
  for (const e of topLevelEdits(blk.inner)) {
    const p = parseVIPEdit(e.name.trim(), e.body.join("\n"));
    if (p) out.push(p);
  }
  return out;
}

function parseVIPEdit(target: string, body: string): ParsedVIP | null {
  if (!target) return null;
  const form: Partial<VirtualIP> = { name: target };

  const cmt = first(body, "comment") || first(body, "comments");
  if (cmt) form.comment = cmt;

  const type = first(body, "type").toLowerCase();
  form.type = type === "fqdn" ? "fqdn" : "static-nat";

  const extintf = first(body, "extintf");
  if (extintf) form.interface = extintf;

  if (form.type === "fqdn") {
    // FQDN maps an external FQDN address to a mapped FQDN address (never an IP — that is the -8 trap).
    form.ext_addr = first(body, "extaddr");
    form.mapped_addr = first(body, "mapped-addr");
  } else {
    form.ext_ip = normRange(values(body, "extip"));
    form.mapped_ip = normRange(values(body, "mappedip"));
  }

  const srcFilter = values(body, "src-filter");
  if (srcFilter.length) form.source_filter = srcFilter;
  const services = values(body, "service");
  if (services.length) form.services = services;

  if (/^\s*set\s+portforward\s+enable/im.test(body)) {
    form.port_forward = true;
    form.protocol = normProtocol(first(body, "protocol"));
    const pmt = first(body, "portmapping-type");
    if (pmt) form.port_mapping_type = pmt === "m-to-n" ? "m-to-n" : "1-to-1";
    const extport = first(body, "extport");
    if (extport && extport !== "0") form.ext_port = extport;
    const mappedport = first(body, "mappedport");
    if (mappedport) form.mapped_port = mappedport;
  }

  return { form, target };
}

// Merges a parsed partial over the blank defaults so every field is valid for the wizard.
export function vipDraftToForm(draft: Partial<VirtualIP>): VirtualIP {
  return { ...EMPTY_VIP, ...draft };
}

// parsePrereqCLI — extracts standalone, deployable CLI blocks for the security-profile objects
// a firewall policy references (AntiVirus, Web Filter, Application Control, DNS Filter, IPS,
// File Filter). The Policy Wizard uses these to AUTO-CREATE any referenced profile that doesn't
// exist on the device yet — the same idea as auto-creating a referenced address, but the source
// of truth here is the AI's own (already valid) FortiOS CLI, so no fragile per-field parsing is
// needed: each block is deployed verbatim to create exactly that profile.

// The security-profile kinds a policy can reference and the wizard can auto-create.
export type PrereqKind =
  | "antivirus" | "webfilter" | "application-control" | "dnsfilter" | "ips" | "file-filter";

export type PrereqBlock = { kind: PrereqKind; name: string; cli: string };

// FortiOS `config <section>` header → kind. The header is matched case-insensitively with
// whitespace collapsed.
const SECTION_TO_KIND: { header: string; kind: PrereqKind }[] = [
  { header: "antivirus profile",   kind: "antivirus" },
  { header: "webfilter profile",   kind: "webfilter" },
  { header: "application list",    kind: "application-control" },
  { header: "dnsfilter profile",   kind: "dnsfilter" },
  { header: "ips sensor",          kind: "ips" },
  { header: "file-filter profile", kind: "file-filter" },
];

// Normalises line endings before any parsing. A stray "\r" is not just cosmetic: in JavaScript
// regexes "." does NOT match a carriage return, so a `set name "X"\r` line silently fails to match
// `^\s*set\s+(\S+)\s+(.*)$` and the whole draft comes back empty. Every parser entry point runs its
// input through this.
export const normalizeCLI = (cli: string): string => cli.replace(/\r\n?/g, "\n");

const isConfig = (l: string) => /^\s*config\b/i.test(l);
const isEnd    = (l: string) => /^\s*end\b/i.test(l);
const isEdit   = (l: string) => /^\s*edit\b/i.test(l);
const isNext   = (l: string) => /^\s*next\b/i.test(l);

// Finds every TOP-LEVEL `config <section> … end` block, returning its header + inner lines.
// Balanced on config/end so nested `config … end` sub-blocks (e.g. webfilter ftgd-wf/filters,
// application-list entries) are kept inside the parent block, not mistaken for its terminator.
// Exported so other parsers (e.g. parseWebFilterCLI's urlfilter table) can reuse the balanced logic.
export function topLevelConfigBlocks(lines: string[]): { header: string; inner: string[] }[] {
  const blocks: { header: string; inner: string[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^\s*config\s+(.+?)\s*$/i);
    if (!m) { i++; continue; }
    const header = m[1].replace(/\s+/g, " ").trim().toLowerCase();
    let depth = 1;
    const inner: string[] = [];
    i++;
    while (i < lines.length && depth > 0) {
      const l = lines[i];
      if (isConfig(l)) depth++;
      else if (isEnd(l)) { depth--; if (depth === 0) { i++; break; } }
      inner.push(l);
      i++;
    }
    blocks.push({ header, inner });
  }
  return blocks;
}

// Splits a section's inner lines into its top-level `edit "<name>" … next` entries. Balanced on
// BOTH edit/next and config/end so a nested `config … end` (with its own `edit … next`) inside an
// entry doesn't prematurely close it. Exported for reuse by other CLI parsers.
export function topLevelEdits(inner: string[]): { name: string; body: string[] }[] {
  const edits: { name: string; body: string[] }[] = [];
  let cfgDepth = 0;
  let i = 0;
  while (i < inner.length) {
    const l = inner[i];
    if (isConfig(l)) { cfgDepth++; i++; continue; }
    if (isEnd(l))    { cfgDepth--; i++; continue; }
    const em = l.match(/^\s*edit\s+"?([^"\n]+?)"?\s*$/i);
    if (cfgDepth === 0 && em) {
      let editDepth = 1, cfg = 0;
      const body: string[] = [];
      i++;
      while (i < inner.length) {
        const bl = inner[i];
        if (isConfig(bl)) cfg++;
        else if (isEnd(bl)) cfg--;
        else if (cfg === 0 && isEdit(bl)) editDepth++;
        else if (cfg === 0 && isNext(bl)) { editDepth--; if (editDepth === 0) { i++; break; } }
        body.push(bl);
        i++;
      }
      edits.push({ name: em[1].trim(), body });
      continue;
    }
    i++;
  }
  return edits;
}

// extractPrereqBlocks returns one standalone deployable CLI block per security profile defined in
// the AI's CLI, e.g.:
//   config webfilter profile
//       edit "WebFilter-Standard"
//           …body…
//       next
//   end
export function extractPrereqBlocks(cli: string): PrereqBlock[] {
  if (!cli) return [];
  const lines = normalizeCLI(cli).split("\n");
  const out: PrereqBlock[] = [];
  for (const { header, inner } of topLevelConfigBlocks(lines)) {
    const match = SECTION_TO_KIND.find((s) => s.header === header);
    if (!match) continue;
    for (const e of topLevelEdits(inner)) {
      if (!e.name) continue;
      const cliBlock = [
        `config ${header}`,
        `    edit "${e.name}"`,
        ...e.body,
        `    next`,
        `end`,
      ].join("\n");
      out.push({ kind: match.kind, name: e.name, cli: cliBlock });
    }
  }
  return out;
}

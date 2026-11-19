import type {
  WebFilterProfileForm, WebFilterURLEntry, WebFilterURLType, WebFilterURLEntryAction,
  WebFilterCategoryAction, WebFilterAction, WebFilterContentEntry,
  WebFilterContentPatternType, WebFilterContentLang,
} from "../../api/policyObject";
import { EMPTY_WEBFILTER_FORM } from "../security-profiles/webfilter-form.logic";
import { topLevelConfigBlocks, topLevelEdits, normalizeCLI } from "./parsePrereqCLI";

// A parsed draft plus the profile's CURRENT name (the `edit "X"` key), so the wizard can find
// the existing profile even on a rename (the new name lives in form.name).
//
// Everything the FortiOS webfilter profile can express is parsed: the FortiGuard category filter
// (config ftgd-wf/filters), the Static URL Filter (webfilter urlfilter table), the Content Filter
// (webfilter content table), the Rating options and the Proxy options — so nothing the AI proposes
// is silently dropped on its way into the wizard.
export type ParsedWebFilter = { form: Partial<WebFilterProfileForm>; target: string };

const normType = (v: string): WebFilterURLType => {
  const u = v.toLowerCase();
  if (u === "regex" || u === "regexp") return "regex";
  if (u === "simple") return "simple";
  return "wildcard";
};
const normAction = (v: string): WebFilterURLEntryAction => {
  const u = v.toLowerCase();
  if (u === "block" || u === "exempt" || u === "allow" || u === "monitor") return u as WebFilterURLEntryAction;
  return "block";
};

// FortiGuard category action. FortiOS uses "warning" and "authenticate" alongside block/monitor;
// an entry with no explicit action means "allow" (the category is simply not filtered).
const normCategoryAction = (v: string | undefined): WebFilterAction => {
  const u = (v ?? "").toLowerCase();
  if (u === "block" || u === "monitor" || u === "warning" || u === "authenticate" || u === "allow") {
    return u as WebFilterAction;
  }
  return "allow";
};

const CONTENT_LANGS: WebFilterContentLang[] = [
  "western", "simch", "trach", "japanese", "korean", "french", "thai", "spanish", "cyrillic",
];
const normLang = (v: string | undefined): WebFilterContentLang => {
  const u = (v ?? "").toLowerCase() as WebFilterContentLang;
  return CONTENT_LANGS.includes(u) ? u : "western";
};
const normPatternType = (v: string | undefined): WebFilterContentPatternType =>
  (v ?? "").toLowerCase() === "regexp" ? "regexp" : "wildcard";

// Parse every `config webfilter urlfilter … edit <id> … config entries … end … next … end` table
// into a map of table-id → its URL entries. Uses the balanced config/edit parser so the nested
// `config entries … end` inside each table isn't mistaken for the table's terminator. This is the
// FortiOS structure a profile's Static URL Filter references by `set urlfilter-table <id>`.
function parseURLFilterTables(cli: string): Record<string, WebFilterURLEntry[]> {
  const tables: Record<string, WebFilterURLEntry[]> = {};
  const lines = cli.split("\n");
  for (const blk of topLevelConfigBlocks(lines)) {
    if (blk.header !== "webfilter urlfilter") continue;
    for (const tbl of topLevelEdits(blk.inner)) {           // tbl.name = table id
      const entriesBlk = topLevelConfigBlocks(tbl.body).find((b) => b.header === "entries");
      if (!entriesBlk) continue;
      const entries: WebFilterURLEntry[] = [];
      for (const e of topLevelEdits(entriesBlk.inner)) {
        const eb = e.body.join("\n");
        const url = eb.match(/set\s+url\s+"?([^"\n]+?)"?\s*$/im)?.[1]?.trim();
        if (!url) continue;
        entries.push({
          url,
          type: normType(eb.match(/set\s+type\s+([a-z]+)/i)?.[1] ?? "wildcard"),
          action: normAction(eb.match(/set\s+action\s+([a-z]+)/i)?.[1] ?? "block"),
          status: /set\s+status\s+disable/i.test(eb) ? "disable" : "enable",
        });
      }
      if (entries.length) tables[tbl.name] = entries;
    }
  }
  return tables;
}

// Parse every `config webfilter content … edit <id> … config entries … end … next … end` banned-word
// table into a map of table-id → its content entries. Same structure as the urlfilter table, but the
// entry mkey is the pattern itself.
function parseContentTables(cli: string): Record<string, WebFilterContentEntry[]> {
  const tables: Record<string, WebFilterContentEntry[]> = {};
  const lines = cli.split("\n");
  for (const blk of topLevelConfigBlocks(lines)) {
    if (blk.header !== "webfilter content") continue;
    for (const tbl of topLevelEdits(blk.inner)) {
      const entriesBlk = topLevelConfigBlocks(tbl.body).find((b) => b.header === "entries");
      if (!entriesBlk) continue;
      const entries: WebFilterContentEntry[] = [];
      for (const e of topLevelEdits(entriesBlk.inner)) {
        const eb = e.body.join("\n");
        // The pattern is the entry's mkey, but `set pattern "…"` is accepted too.
        const pattern = (eb.match(/set\s+pattern\s+"?([^"\n]+?)"?\s*$/im)?.[1] ?? e.name).trim();
        if (!pattern) continue;
        const score = parseInt(eb.match(/set\s+score\s+(\d+)/i)?.[1] ?? "", 10);
        entries.push({
          pattern,
          pattern_type: normPatternType(eb.match(/set\s+pattern-type\s+(\S+)/i)?.[1]),
          lang: normLang(eb.match(/set\s+lang\s+(\S+)/i)?.[1]),
          action: /set\s+action\s+exempt/i.test(eb) ? "exempt" : "block",
          status: /set\s+status\s+disable/i.test(eb) ? "disable" : "enable",
          score: Number.isNaN(score) ? 10 : score,
        });
      }
      if (entries.length) tables[tbl.name] = entries;
    }
  }
  return tables;
}

// normalizeURLEntries mirrors the backend's NormalizeURLFilterEntries so the wizard SHOWS exactly
// what will be written to the device. FortiOS entry types are easy to get wrong:
//   simple   → exact host ("youtube.com" does NOT match www.youtube.com)
//   wildcard → a pattern; meaningless unless it contains "*" ("*.youtube.com" does NOT match the apex)
// so a wildcard with no "*" is repaired to "*.<host>", and every blocking "*.<host>" gains its apex
// companion. Idempotent — running it twice changes nothing.
export function normalizeURLEntries(list: WebFilterURLEntry[]): WebFilterURLEntry[] {
  const out: WebFilterURLEntry[] = [];
  const seen = new Set<string>();
  const push = (e: WebFilterURLEntry) => {
    const key = `${e.url.toLowerCase()}|${e.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };

  for (const raw of list) {
    const url = raw.url.trim();
    if (!url) continue;
    const e = { ...raw, url };
    if (e.type === "wildcard" && !e.url.includes("*")) e.url = `*.${e.url}`;
    push(e);
  }

  for (const e of [...out]) {
    if (e.type !== "wildcard" || e.action !== "block") continue;
    const host = e.url.startsWith("*.") ? e.url.slice(2) : "";
    if (!host || host.includes("*")) continue;
    if (seen.has(`${host.toLowerCase()}|simple`)) continue;
    push({ url: host, type: "simple", action: e.action, status: e.status });
  }
  return out;
}

// Pick the table the profile references by id, or the sole table in the CLI when the profile
// didn't name one (the AI often emits exactly one).
function pickTable<T>(tables: Record<string, T[]>, refId: string | undefined): T[] | undefined {
  if (refId && tables[refId]) return tables[refId];
  const ids = Object.keys(tables);
  return ids.length === 1 ? tables[ids[0]] : undefined;
}

// Parses the first `config webfilter profile … edit "<name>" … next … end` block from AI CLI into
// a partial WebFilterProfileForm the Web Filter wizard can prefill.
export function parseWebFilterFromCLI(cliText: string): ParsedWebFilter | null {
  cliText = normalizeCLI(cliText);
  // Balanced extraction so a nested `config ftgd-wf/filters` edit…next doesn't truncate the profile.
  const lines = cliText.split("\n");
  const profileBlk = topLevelConfigBlocks(lines).find((b) => b.header === "webfilter profile");
  if (!profileBlk) return null;
  const edits = topLevelEdits(profileBlk.inner);
  if (edits.length === 0) return null;

  const target = edits[0].name.trim();
  if (!target) return null;
  const bodyLines = edits[0].body;
  const body = bodyLines.join("\n");

  const form: Partial<WebFilterProfileForm> = { name: target };

  const cmt = body.match(/set\s+comment\s+"([^"]*)"/i);
  if (cmt) form.comment = cmt[1];
  const nameSet = body.match(/set\s+name\s+"?([^"\n]+?)"?\s*$/im);
  if (nameSet) form.name = nameSet[1].trim();

  // Profile-level "options" multi-flag → Block invalid URLs + Remove Cookies.
  const options = body.match(/^\s*set\s+options\s+([^\n]+)$/im)?.[1] ?? "";
  if (/\bblock-invalid-url\b/i.test(options)) form.block_invalid_urls = true;
  if (/\bcookiefilter\b/i.test(options)) form.remove_cookies = true;

  // Proxy Options · HTTP POST Action.
  if (/set\s+post-action\s+block/i.test(body)) form.http_post_action = "block";

  const nested = topLevelConfigBlocks(bodyLines);

  // ── FortiGuard Category Based Filter (config ftgd-wf) ────────────────────────────────
  const ftgd = nested.find((b) => b.header === "ftgd-wf");
  if (ftgd) {
    form.fortiguard_category_filter = true;

    // Rating Options live on ftgd-wf's own "options" flag (NOT the profile's).
    const ftgdOptions = ftgd.inner.join("\n").match(/^\s*set\s+options\s+([^\n]+)$/im)?.[1] ?? "";
    if (/\berror-allow\b/i.test(ftgdOptions)) form.allow_rating_error = true;
    if (/\brate-server-ip\b/i.test(ftgdOptions)) form.rate_by_domain_and_ip = true;

    // Per-category actions — one `edit <n>` per category filter row.
    const filters = topLevelConfigBlocks(ftgd.inner).find((b) => b.header === "filters");
    if (filters) {
      const categories: WebFilterCategoryAction[] = [];
      for (const f of topLevelEdits(filters.inner)) {
        const fb = f.body.join("\n");
        const catRaw = fb.match(/set\s+category\s+([0-9\s]+)/i)?.[1];
        if (!catRaw) continue;
        const action = normCategoryAction(fb.match(/set\s+action\s+([a-z]+)/i)?.[1]);
        // "authenticate" carries the user group(s) allowed through — FortiOS rejects the profile
        // without them, so they must survive the trip from CLI into the form.
        const authGroups = action === "authenticate"
          ? (fb.match(/set\s+auth-usr-grp\s+([^\n]+)/i)?.[1] ?? "")
              .match(/"([^"]+)"|(\S+)/g)?.map((g) => g.replace(/"/g, "")) ?? []
          : [];
        for (const c of catRaw.trim().split(/\s+/)) {
          const id = parseInt(c, 10);
          if (Number.isNaN(id)) continue;
          categories.push(action === "authenticate"
            ? { category: id, action, auth_groups: authGroups }
            : { category: id, action });
        }
      }
      if (categories.length) form.categories = categories;
    }
  }

  // ── Static URL Filter block (config web) ────────────────────────────────────────────
  const web = nested.find((b) => b.header === "web");
  const webBody = web ? web.inner.join("\n") : "";
  if (/set\s+blocklist\s+enable/i.test(webBody)) form.block_malicious_fortisandbox = true;

  // URL Filter table — link the profile's referenced urlfilter table (or the sole table) so the
  // wizard shows the blocks and the structured create rebuilds the table on the device.
  const urlEntries = pickTable(
    parseURLFilterTables(cliText),
    webBody.match(/set\s+urlfilter-table\s+(\d+)/i)?.[1] ?? body.match(/set\s+urlfilter-table\s+(\d+)/i)?.[1],
  );
  if (urlEntries?.length) {
    form.url_filter = true;
    form.url_filter_entries = normalizeURLEntries(urlEntries);
  }

  // Content Filter (banned word) table — same wiring via bword-table.
  const contentEntries = pickTable(
    parseContentTables(cliText),
    webBody.match(/set\s+bword-table\s+(\d+)/i)?.[1] ?? body.match(/set\s+bword-table\s+(\d+)/i)?.[1],
  );
  if (contentEntries?.length) {
    form.content_filter = true;
    form.content_filter_entries = contentEntries;
  }

  return { form, target };
}

// Merges a parsed partial draft over the blank defaults so every field has a valid value.
export function webFilterDraftToForm(draft: Partial<WebFilterProfileForm>): WebFilterProfileForm {
  return { ...EMPTY_WEBFILTER_FORM, ...draft };
}

import type {
  DNSFilterProfileForm, DNSFilterAction, DNSFilterCategoryAction,
  DNSDomainEntry, DNSTranslationEntry,
} from "../../api/policyObject";
import { EMPTY_DNSFILTER_FORM } from "../security-profiles/dnsfilter-form.logic";
import { topLevelConfigBlocks, topLevelEdits, normalizeCLI } from "./parsePrereqCLI";

// A parsed draft plus the profile's CURRENT name (the `edit "X"` key), so the wizard can find the
// existing profile even on a rename (the new name lives in form.name).
//
// Everything the FortiOS dnsfilter profile can express is parsed: the FortiGuard category filter
// (config ftgd-dns/filters), the Static Domain Filter (dnsfilter domain-filter table), DNS
// Translation, the External IP Block Lists and the Options — so nothing the AI proposes is
// silently dropped on its way into the wizard.
export type ParsedDNSFilter = { form: Partial<DNSFilterProfileForm>; target: string };

const REDIRECT_PORTAL_DEFAULT = "0.0.0.0";

const normDomainType = (v: string | undefined): DNSDomainEntry["type"] => {
  const u = (v ?? "").toLowerCase();
  if (u === "regex" || u === "regexp") return "regex";
  if (u === "wildcard") return "wildcard";
  return "simple";
};

const normDomainAction = (v: string | undefined): DNSDomainEntry["action"] => {
  const u = (v ?? "").toLowerCase();
  if (u === "allow" || u === "monitor") return u;
  return "block";
};

// A category filter row's action.
//
// ⚠️ An entry with NO `set action` is MONITOR, not allow — monitor is the CMDB default for
// ftgd-dns.filters.action, so FortiOS omits it from `show` output (a row that reads just
// `edit 2 / set category 3` is a monitor row). This is the opposite of the Web Filter parser,
// where a category with no entry/action means allow. "Allow" here is the ABSENCE of the whole
// entry, which is why this function never returns it: a row that exists is filtered somehow.
const normCategoryAction = (v: string | undefined): DNSFilterAction => {
  const u = (v ?? "").toLowerCase();
  if (u === "block") return "block";
  return "monitor";
};

// Parse every `config dnsfilter domain-filter … edit <id> … config entries … end … next … end`
// table into a map of table-id → its domain rows. Uses the balanced config/edit parser so the
// nested `config entries … end` isn't mistaken for the table's terminator. This is the FortiOS
// structure a profile's Static Domain Filter references by `set domain-filter-table <id>`.
function parseDomainFilterTables(cli: string): Record<string, DNSDomainEntry[]> {
  const tables: Record<string, DNSDomainEntry[]> = {};
  const lines = cli.split("\n");
  for (const blk of topLevelConfigBlocks(lines)) {
    if (blk.header !== "dnsfilter domain-filter") continue;
    for (const tbl of topLevelEdits(blk.inner)) {           // tbl.name = table id
      const entriesBlk = topLevelConfigBlocks(tbl.body).find((b) => b.header === "entries");
      if (!entriesBlk) continue;
      const entries: DNSDomainEntry[] = [];
      for (const e of topLevelEdits(entriesBlk.inner)) {
        const eb = e.body.join("\n");
        // The domain is normally `set domain "x"`, but FortiOS also keys rows by it.
        const domain = (eb.match(/set\s+domain\s+"?([^"\n]+?)"?\s*$/im)?.[1] ?? "").trim();
        if (!domain) continue;
        entries.push({
          domain,
          type: normDomainType(eb.match(/set\s+type\s+(\S+)/i)?.[1]),
          action: normDomainAction(eb.match(/set\s+action\s+(\S+)/i)?.[1]),
          status: /set\s+status\s+disable/i.test(eb) ? "disable" : "enable",
        });
      }
      if (entries.length) tables[tbl.name] = entries;
    }
  }
  return tables;
}

// Pick the table the profile references by id, or the sole table in the CLI when the profile
// didn't name one (the AI often emits exactly one).
function pickTable<T>(tables: Record<string, T[]>, refId: string | undefined): T[] | undefined {
  if (refId && tables[refId]) return tables[refId];
  const ids = Object.keys(tables);
  return ids.length === 1 ? tables[ids[0]] : undefined;
}

// Split a FortiOS name list — `set external-ip-blocklist "a" "b"` or bare words.
const parseNameList = (v: string | undefined): string[] =>
  (v ?? "").match(/"([^"]+)"|(\S+)/g)?.map((s) => s.replace(/"/g, "").trim()).filter(Boolean) ?? [];

// Parses the first `config dnsfilter profile … edit "<name>" … next … end` block from AI CLI into
// a partial DNSFilterProfileForm the DNS Filter wizard can prefill.
export function parseDNSFilterFromCLI(cliText: string): ParsedDNSFilter | null {
  cliText = normalizeCLI(cliText);
  // Balanced extraction so a nested `config ftgd-dns/filters` edit…next doesn't truncate the profile.
  const lines = cliText.split("\n");
  const profileBlk = topLevelConfigBlocks(lines).find((b) => b.header === "dnsfilter profile");
  if (!profileBlk) return null;
  const edits = topLevelEdits(profileBlk.inner);
  if (edits.length === 0) return null;

  const target = edits[0].name.trim();
  if (!target) return null;
  const bodyLines = edits[0].body;
  const body = bodyLines.join("\n");

  const form: Partial<DNSFilterProfileForm> = { name: target };

  const cmt = body.match(/set\s+comment\s+"([^"]*)"/i);
  if (cmt) form.comment = cmt[1];
  const nameSet = body.match(/set\s+name\s+"?([^"\n]+?)"?\s*$/im);
  if (nameSet) form.name = nameSet[1].trim();

  // ── Basic toggles ────────────────────────────────────────────────────────────────────
  if (/set\s+block-botnet\s+enable/i.test(body)) form.redirect_botnet = true;
  if (/set\s+safe-search\s+enable/i.test(body)) form.safe_search = true;
  if (/set\s+log-all-domain\s+enable/i.test(body)) form.log_all_domains = true;

  const yt = body.match(/set\s+youtube-restrict\s+(\S+)/i)?.[1]?.toLowerCase();
  // The 7.2.10 schema offers strict|moderate only — anything else is the device default.
  if (yt) form.youtube_restrict = yt === "moderate" ? "moderate" : "strict";

  // ── Redirect Portal IP ───────────────────────────────────────────────────────────────
  // 0.0.0.0 is how FortiOS stores "Use FortiGuard Default", so it is NOT a specified IP.
  const portal = body.match(/set\s+redirect-portal\s+"?([^"\s]+)"?/i)?.[1]?.trim();
  if (portal) {
    if (portal === REDIRECT_PORTAL_DEFAULT) {
      form.use_default_redirect_portal = true;
      form.redirect_portal_ip = "";
    } else {
      form.use_default_redirect_portal = false;
      form.redirect_portal_ip = portal;
    }
  }

  // ── External IP Block Lists ──────────────────────────────────────────────────────────
  const blocklist = parseNameList(body.match(/set\s+external-ip-blocklist\s+([^\n]+)/i)?.[1]);
  if (blocklist.length) {
    form.external_ip_blocklist = true;
    form.external_ip_blocklist_names = blocklist;
  }

  const nested = topLevelConfigBlocks(bodyLines);

  // ── FortiGuard Category Based Filter (config ftgd-dns) ───────────────────────────────
  const ftgd = nested.find((b) => b.header === "ftgd-dns");
  if (ftgd) {
    const ftgdBody = ftgd.inner.join("\n");
    const ftgdOptions = ftgdBody.match(/^\s*set\s+options\s+([^\n]+)$/im)?.[1] ?? "";
    // The master toggle is the ABSENCE of "ftgd-disable"; "error-allow" is a separate flag that
    // can sit in the same list.
    form.fortiguard_category_filter = !/\bftgd-disable\b/i.test(ftgdOptions);
    if (/\berror-allow\b/i.test(ftgdOptions)) form.allow_rating_error = true;

    const filters = topLevelConfigBlocks(ftgd.inner).find((b) => b.header === "filters");
    if (filters) {
      const categories: DNSFilterCategoryAction[] = [];
      for (const f of topLevelEdits(filters.inner)) {
        const fb = f.body.join("\n");
        const catRaw = fb.match(/set\s+category\s+([0-9\s]+)/i)?.[1];
        if (!catRaw) continue;
        const action = normCategoryAction(fb.match(/set\s+action\s+([a-z]+)/i)?.[1]);
        // One row may list several ids — FortiOS accepts `set category 1 2 3`.
        for (const c of catRaw.trim().split(/\s+/)) {
          const id = parseInt(c, 10);
          if (Number.isNaN(id)) continue;
          categories.push({ category: id, action });
        }
      }
      if (categories.length) form.categories = categories;
    }
  }

  // ── Static Domain Filter (config domain-filter → set domain-filter-table <id>) ───────
  const dfBlock = nested.find((b) => b.header === "domain-filter");
  const dfBody = dfBlock ? dfBlock.inner.join("\n") : "";
  const tableRef = dfBody.match(/set\s+domain-filter-table\s+(\d+)/i)?.[1]
    ?? body.match(/set\s+domain-filter-table\s+(\d+)/i)?.[1];
  const domainEntries = pickTable(parseDomainFilterTables(cliText), tableRef);
  if (domainEntries?.length) {
    form.domain_filter = true;
    form.domain_filter_entries = domainEntries;
  }

  // ── DNS Translation ──────────────────────────────────────────────────────────────────
  const trans = nested.find((b) => b.header === "dns-translation");
  if (trans) {
    const rows: DNSTranslationEntry[] = [];
    for (const e of topLevelEdits(trans.inner)) {
      const eb = e.body.join("\n");
      // IPv4 rows only — an ipv6 row carries src6/dst6, which this form doesn't model, and
      // importing it as a blank IPv4 row would silently drop it on Apply.
      const addrType = eb.match(/set\s+addr-type\s+(\S+)/i)?.[1]?.toLowerCase();
      if (addrType && addrType !== "ipv4") continue;
      const src = eb.match(/set\s+src\s+"?([^"\s]+)"?/i)?.[1]?.trim();
      const dst = eb.match(/set\s+dst\s+"?([^"\s]+)"?/i)?.[1]?.trim();
      if (!src || !dst) continue;
      rows.push({
        src, dst,
        netmask: eb.match(/set\s+netmask\s+"?([^"\s]+)"?/i)?.[1]?.trim() ?? "255.255.255.255",
        status: /set\s+status\s+disable/i.test(eb) ? "disable" : "enable",
      });
    }
    if (rows.length) {
      form.dns_translation = true;
      form.dns_translation_entries = rows;
    }
  }

  return { form, target };
}

// Parses EVERY `config dnsfilter profile` block — one suggestion may define several (e.g. a
// per-department DNS filter for two policies).
export function parseAllDNSFiltersFromCLI(cliText: string): ParsedDNSFilter[] {
  const cli = normalizeCLI(cliText);
  const lines = cli.split("\n");
  const profileBlk = topLevelConfigBlocks(lines).find((b) => b.header === "dnsfilter profile");
  if (!profileBlk) return [];

  // The domain-filter tables live OUTSIDE the profile block, so every single-profile re-parse
  // has to carry them along or `set domain-filter-table <id>` resolves to nothing.
  const tablesCLI = extractDomainFilterTablesCLI(cli);

  const out: ParsedDNSFilter[] = [];
  for (const e of topLevelEdits(profileBlk.inner)) {
    // Re-parse each profile on its own so the table/section logic above is reused verbatim
    // rather than duplicated.
    const one = [
      "config dnsfilter profile",
      `    edit "${e.name}"`,
      ...e.body,
      "    next",
      "end",
      tablesCLI,
    ].join("\n");
    const parsed = parseDNSFilterFromCLI(one);
    if (parsed) out.push(parsed);
  }
  return out;
}

// Returns just the `config dnsfilter domain-filter … end` blocks of a CLI document, so a
// single-profile re-parse can still resolve its `set domain-filter-table <id>` reference.
function extractDomainFilterTablesCLI(cli: string): string {
  const lines = normalizeCLI(cli).split("\n");
  return topLevelConfigBlocks(lines)
    .filter((b) => b.header === "dnsfilter domain-filter")
    .map((b) => ["config dnsfilter domain-filter", ...b.inner, "end"].join("\n"))
    .join("\n");
}

// Merges a parsed partial draft over the blank defaults so every field has a valid value.
export function dnsFilterDraftToForm(draft: Partial<DNSFilterProfileForm>): DNSFilterProfileForm {
  return { ...EMPTY_DNSFILTER_FORM, ...draft };
}

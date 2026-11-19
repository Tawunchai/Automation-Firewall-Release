/**
 * Lists the harvested English UI strings that neither dictionary translates yet.
 *
 *   node scripts/i18n-missing.mjs              # report to stdout
 *   node scripts/i18n-missing.mjs missing.tsv  # …or into a file
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST
 *
 * This used to live at src/i18n/zzz.report.test.ts, written as a vitest case that asserted nothing
 * and wrote its report to the path in `process.env.R`. It was a developer scratch tool wearing a
 * test's clothes, and it cost the project its test suite: `npm run test` runs with no `R` set, so
 * `fs.writeFileSync(undefined, …)` threw and vitest was red on main for everyone — including the
 * `frontend` job in .github/workflows/ci.yml. A gate that cannot be green is a gate nobody reads,
 * and this repo's rule is that the gates are green.
 *
 * The capability itself is worth keeping: it is how you find out what a new page still needs
 * translated. It just belongs beside i18n-extract.mjs, as something you RUN, rather than among the
 * things that must pass.
 *
 * WHAT IT COMPARES
 *
 *   scripts/i18n-strings.json   the harvested inventory (`strings` = literals, `templates` =
 *                               interpolated patterns like "Report sent to {} recipient{}")
 *   dictionary/{th,zh}          the literal tables
 *   dictionary/{th,zh}.patterns the pattern tables
 *   dictionary/keep.ts          strings that are deliberately identical in all three languages
 *                               (protocol tokens, hardware labels, product names) — not missing
 *
 * Regenerating the inventory is a SEPARATE step (`node scripts/i18n-extract.mjs`); this script only
 * reads it, so running the report can never produce a diff.
 *
 * Output is one tab-separated row per gap, the same shape the old reporter wrote:
 *
 *   <lang>  <s|p>  <first source location>  <the string, JSON-quoted>
 *
 * `s` is a literal, `p` an interpolated pattern — they live in different dictionary files, so the
 * column says which one to add the entry to.
 */
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY = path.join(HERE, "i18n-strings.json");
const DICT = path.resolve(HERE, "../src/i18n/dictionary");

// The dictionaries are TypeScript, and they import each other the way the app does — extensionless
// (`./merge`, `./th/common`). Node 24 strips the types on its own but will not guess the extension,
// so a resolve hook adds `.ts` for relative specifiers that do not already carry a module
// extension. `.patterns` and `.lazy` are name parts, not extensions, which is why this tests for
// the known extensions rather than for "ends in a dot-something".
const HAS_EXT = /\.(m?[jt]sx?|json|node)$/i;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !HAS_EXT.test(specifier)) {
      try {
        return nextResolve(specifier + ".ts", context);
      } catch {
        // Not a .ts module after all — fall through to normal resolution.
      }
    }
    return nextResolve(specifier, context);
  },
});

const load = (file) => import(pathToFileURL(path.join(DICT, file)).href);

const [{ th }, { zh }, { thPatterns }, { zhPatterns }, { keepAsIs }] = await Promise.all([
  load("th.ts"), load("zh.ts"), load("th.patterns.ts"), load("zh.patterns.ts"), load("keep.ts"),
]);

/** { strings, templates, where } — see i18n-extract.mjs. */
const inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
const keep = new Set(keepAsIs);

/** Harvested strings this table has no entry for, minus the deliberately-English ones. */
const missing = (table, harvested) =>
  harvested.filter((s) => table[s] === undefined && !keep.has(s));

const rows = [];
const counts = [];
for (const [lang, literals, patterns] of [
  ["th", th, thPatterns],
  ["zh", zh, zhPatterns],
]) {
  let n = 0;
  for (const [kind, table, harvested] of [
    ["s", literals, inv.strings],
    ["p", patterns, inv.templates],
  ]) {
    for (const s of missing(table, harvested)) {
      rows.push(`${lang}\t${kind}\t${inv.where[s]?.[0] ?? "?"}\t${JSON.stringify(s)}`);
      n++;
    }
  }
  counts.push(`${lang}: ${n}`);
}

const report = rows.join("\n");
const outfile = process.argv[2];

if (outfile) {
  fs.writeFileSync(outfile, report + (report ? "\n" : ""), "utf8");
  console.log(`${rows.length} untranslated string(s) (${counts.join(", ")}) -> ${outfile}`);
} else if (rows.length) {
  console.log(report);
  // The summary goes to stderr so `node scripts/i18n-missing.mjs | sort` stays clean.
  console.error(`\n${rows.length} untranslated string(s) (${counts.join(", ")})`);
} else {
  console.log(`Nothing untranslated — ${inv.strings.length} strings + ${inv.templates.length} patterns, th and zh both complete.`);
}

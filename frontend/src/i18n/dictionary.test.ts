import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { th } from "./dictionary/th";
import { zh } from "./dictionary/zh";
import { thPatterns } from "./dictionary/th.patterns";
import { zhPatterns } from "./dictionary/zh.patterns";
import { keepAsIs } from "./dictionary/keep";
import { mergeDicts, type Dict } from "./dictionary/merge";
import { thParts } from "./dictionary/th";
import { zhParts } from "./dictionary/zh";

/**
 * The console must not be half-translated.
 *
 * A missing dictionary entry does not throw, does not warn, and does not fail a type check — the
 * English falls through and renders, which is right for device data and wrong for a page heading.
 * The failure mode is therefore a Thai screen with English words scattered through it, and the only
 * thing that finds it is a list of what the app can display checked against a list of what has been
 * translated. scripts/i18n-extract.mjs produces the first list; this test does the checking.
 *
 * If this fails after you add a page: run `node scripts/i18n-extract.mjs`, then add the strings it
 * names to src/i18n/dictionary/{th,zh}/<area>.ts — or to keep.ts if the right rendering really is
 * the English one (product names, protocol tokens, units).
 */

const INVENTORY = path.resolve(__dirname, "../../scripts/i18n-strings.json");

type Inventory = { strings: string[]; templates: string[]; where: Record<string, string[]> };

const inventory: Inventory = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
const keep = new Set(keepAsIs);

/** The opposite language, so a per-language rendering decision can be told from an oversight. */
const OTHER: Record<string, { table: Dict; patterns: Dict }> = {
  Thai: { table: zh, patterns: zhPatterns },
  Chinese: { table: th, patterns: thPatterns },
};

/** Reports at most a dozen, with a source location each — a 900-line diff teaches nobody anything. */
function report(missing: string[], lang: string, kind: string): string {
  const shown = missing.slice(0, 12).map((s) => {
    const at = inventory.where[s]?.[0] ?? "?";
    return `  ${JSON.stringify(s)}  (${at})`;
  });
  const more = missing.length > 12 ? `\n  …and ${missing.length - 12} more` : "";
  return `${missing.length} ${kind} have no ${lang} translation:\n${shown.join("\n")}${more}`;
}

const missingFrom = (table: Dict, list: string[]) =>
  list.filter((s) => table[s] === undefined && !keep.has(s));

describe.each([
  ["Thai", th, thPatterns, thParts],
  ["Chinese", zh, zhPatterns, zhParts],
])("%s dictionary", (lang, table, patterns, parts) => {
  it("translates every string the app can render", () => {
    const missing = missingFrom(table, inventory.strings);
    expect(missing, report(missing, lang, "strings")).toEqual([]);
  });

  it("translates every interpolated sentence the app can build", () => {
    const missing = missingFrom(patterns, inventory.templates);
    expect(missing, report(missing, lang, "patterns")).toEqual([]);
  });

  it("gives each interpolated sentence somewhere to put its values", () => {
    // The translation may reorder the holes with {1}/{2} but may not drop one: a hole fewer than
    // the English has means a count, a device name or a reason silently vanishes from the screen.
    const holes = (s: string) => s.match(/\{\d*\}/g) ?? [];
    const dropped = Object.entries(patterns)
      .filter(([english, translated]) => holes(translated).length !== holes(english).length)
      .map(([english, translated]) => `${JSON.stringify(english)} -> ${JSON.stringify(translated)}`);
    expect(dropped, `these ${lang} patterns change the number of {} holes`).toEqual([]);
  });

  it("does not mix numbered and unnumbered holes in one sentence", () => {
    // "{} … {2}" is ambiguous: the bare hole takes "the next one", and whether that means the first
    // or the one after {2} is a coin flip a reader should never have to make. Pick one form.
    const mixed = Object.entries(patterns)
      .filter(([, translated]) => {
        const holes = translated.match(/\{(\d*)\}/g) ?? [];
        return holes.some((h) => h === "{}") && holes.some((h) => h !== "{}");
      })
      .map(([english, translated]) => `${JSON.stringify(english)} -> ${JSON.stringify(translated)}`);
    expect(mixed, `these ${lang} patterns mix {} with {1}/{2}`).toEqual([]);
  });

  it("numbers its holes within range", () => {
    const outOfRange = Object.entries(patterns)
      .filter(([english, translated]) => {
        const available = (english.match(/\{\}/g) ?? []).length;
        return [...translated.matchAll(/\{(\d+)\}/g)].some(
          (m) => Number(m[1]) < 1 || Number(m[1]) > available,
        );
      })
      .map(([english, translated]) => `${JSON.stringify(english)} -> ${JSON.stringify(translated)}`);
    expect(outOfRange, `these ${lang} patterns reference a value that does not exist`).toEqual([]);
  });

  it("actually translates, except where the other language disagrees", () => {
    // A copy-pasted line that was never translated looks exactly like a finished one, so an entry
    // that equals its own English is suspicious — but not always wrong. `IP:` is `IP:` in Thai and
    // `IP：` in Chinese, because Chinese uses a full-width colon; `Trace Route` is the tool's name
    // in Thai and 路由跟踪 in Chinese. Those are real per-language decisions.
    //
    // What is NOT a decision is a string left as English in BOTH languages: that is either an
    // untranslated line or a deliberate keep, and keep.ts is where deliberate lives. So the rule
    // is: identity is allowed only when the other language translated the same key.
    const others = { ...OTHER[lang].table, ...OTHER[lang].patterns };
    const untouched = Object.entries({ ...table, ...patterns })
      .filter(([english, translated]) => english === translated)
      .filter(([english]) => others[english] === undefined || others[english] === english)
      .map(([english]) => english);
    expect(
      untouched,
      `these ${lang} entries are English in both languages - move them to keep.ts`,
    ).toEqual([]);
  });

  it("does not translate one English string two different ways", () => {
    const { conflicts } = mergeDicts(parts);
    expect([...new Set(conflicts)], `${lang}: same English, two translations`).toEqual([]);
  });

  it("has no blank translations", () => {
    const blank = Object.entries({ ...table, ...patterns })
      .filter(([, translated]) => translated.trim() === "")
      .map(([english]) => english);
    expect(blank, `${lang}: blank entries would erase the text on screen`).toEqual([]);
  });
});

describe("the dictionaries as a pair", () => {
  it("translates a string in both languages or in neither", () => {
    // One language ahead of the other is the normal way this drifts: a page gets its Thai in the
    // change that adds it, and its Chinese never arrives — leaving a screen that is Chinese
    // everywhere except the one page somebody was working on. The per-language coverage tests
    // above cannot see this, because falling back to keep.ts counts as covered.
    const thKeys = new Set([...Object.keys(th), ...Object.keys(thPatterns)]);
    const zhKeys = new Set([...Object.keys(zh), ...Object.keys(zhPatterns)]);
    const onlyTh = [...thKeys].filter((k) => !zhKeys.has(k));
    const onlyZh = [...zhKeys].filter((k) => !thKeys.has(k));
    expect({ onlyTh: onlyTh.slice(0, 10), onlyZh: onlyZh.slice(0, 10) })
      .toEqual({ onlyTh: [], onlyZh: [] });
  });

  it("keeps keep.ts for strings the app can actually render", () => {
    // A keep entry is a claim that some string is deliberately left in English. If the app no
    // longer renders that string, the claim is stale and hides nothing useful.
    const renderable = new Set([...inventory.strings, ...inventory.templates]);
    const stale = keepAsIs.filter((s) => !renderable.has(s));
    expect(stale, "keep.ts names strings the app no longer renders").toEqual([]);
  });
});

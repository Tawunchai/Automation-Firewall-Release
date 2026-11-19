/**
 * English string in, chosen language out.
 *
 * The dictionaries are keyed by the English text itself (see scripts/i18n-extract.mjs for why), so
 * this module is mostly a Map lookup. The parts that are not:
 *
 *   1. WHITESPACE. `<span><Icon /> Blackhole</span>` hands React the child `" Blackhole"`, leading
 *      space included, and JSX indentation leaves newlines in longer paragraphs. The dictionary
 *      holds the trimmed, single-spaced form; the padding is stripped, the core translated, and the
 *      padding put back, so spacing between an icon and its label survives translation.
 *
 *   2. INTERPOLATED TEXT. `Report sent to 3 recipients` is never the same string twice and can
 *      never be a dictionary key. Those are stored as patterns - `Report sent to {} recipient{}` -
 *      and matched with a regex built once and cached. The values are then dropped into the
 *      TRANSLATION's holes, which is the whole point: Thai and Chinese put the count and the
 *      classifier in a different place than English does, and a naive prefix/suffix concatenation
 *      would produce word salad in both.
 *
 * Anything with no entry is returned unchanged. That is the designed behaviour, not a fallback:
 * device data (policy names, interfaces, CLI output, FortiGate error text) shares this path with UI
 * text, and leaving it alone is exactly right for it.
 */

import { getLang, type Lang } from "./lang";

export type Dictionary = Readonly<Record<string, string>>;

// -- Dictionary loading -------------------------------------------------------

/**
 * The dictionaries are FETCHED, not bundled.
 *
 * They used to be four static imports, and that put every language into the entry chunk: 743 KB of
 * JavaScript, of which 87,000 Thai characters and 29,000 Chinese ones — downloaded and parsed by
 * every session before anything could render, including the English ones that would never read a
 * word of it, and including a Thai session's copy of the Chinese.
 *
 * Now a language's table arrives with `import()` the moment the console decides to speak it, and
 * only that language's. English loads nothing at all, because English IS the key: `translate`
 * returns its argument.
 *
 * Two rules keep this from being visible as a flash of English:
 *
 *   · main.tsx awaits ensureLanguage(getLang()) BEFORE the first render, so a session that opens in
 *     Thai has its dictionary in hand before React builds an element.
 *   · LanguageProvider awaits it before switching, so the language only changes once the words to
 *     change it into are here.
 *
 * If a load fails — offline, a chunk 404 after a redeploy — the language still switches and the
 * console renders in English. Degrading to a readable screen beats blocking on a file the browser
 * cannot fetch, and the next ensureLanguage retries, because a failed load registers nothing.
 */
type LoadedDictionary = { exact: Dictionary; patterns: Dictionary };

const LOADED: Partial<Record<Lang, LoadedDictionary>> = {};

/** In-flight loads, so five callers during one render produce one request. */
const inflight = new Map<Lang, Promise<void>>();

/**
 * Installs a dictionary that is already in memory.
 *
 * Exported for the tests, which import the tables directly and must not be made asynchronous just
 * to assert on a lookup. Clearing the compiled pattern cache is the part that is easy to forget and
 * impossible to see: compileFor caches per language on first use, so a language that was consulted
 * while its table was still missing has an EMPTY pattern list memoised, and would go on returning
 * English forever after the real one arrived.
 */
export function registerLanguage(lang: Lang, exact: Dictionary, patterns: Dictionary): void {
  if (lang === "en") return;
  LOADED[lang] = { exact, patterns };
  compiled.delete(lang);
  NO_TRANSLATION[lang].clear();
}

/** True when this language can be rendered right now — English always can. */
export function isLanguageReady(lang: Lang): boolean {
  return lang === "en" || LOADED[lang] !== undefined;
}

/** Loads a language's dictionary if it is not already in memory. Never rejects. */
export function ensureLanguage(lang: Lang): Promise<void> {
  if (isLanguageReady(lang)) return Promise.resolve();
  const running = inflight.get(lang);
  if (running) return running;

  // A switch, not a template literal: Vite resolves `import()` at build time and needs to see the
  // specifier to emit the chunk. A computed path would leave both dictionaries un-code-split (or
  // pull in every file under dictionary/ as a glob).
  const load = (async () => {
    try {
      const mod = lang === "th"
        ? await import("./dictionary/th.lazy")
        : await import("./dictionary/zh.lazy");
      registerLanguage(lang, mod.default.exact, mod.default.patterns);
    } catch (err) {
      // Left unregistered on purpose: the console renders English, and the next call tries again.
      console.error(`[i18n] could not load the ${lang} dictionary`, err);
    } finally {
      inflight.delete(lang);
    }
  })();
  inflight.set(lang, load);
  return load;
}

const EXACT = (lang: Lang): Dictionary | undefined => LOADED[lang]?.exact;
const PATTERNS = (lang: Lang): Dictionary | undefined => LOADED[lang]?.patterns;

// -- Miss log (dev only) ------------------------------------------------------

/**
 * Strings that reached the UI with no translation, readable from the console.
 *
 * The extractor works statically, so it cannot see a string that is assembled at runtime or that
 * arrives from a source it does not scan. This is the other half of the loop: switch to Thai with
 * `localStorage.i18nDebug = "1"` set, walk the app, and `window.__i18nMisses` is the to-do list.
 * Off by default because it would otherwise grow without bound in a long-running session.
 */
const debugEnabled = (() => {
  try {
    return localStorage.getItem("i18nDebug") === "1";
  } catch {
    return false;
  }
})();

const misses = new Set<string>();
if (debugEnabled && typeof window !== "undefined") {
  (window as unknown as { __i18nMisses: Set<string> }).__i18nMisses = misses;
}

// -- Pattern matching ---------------------------------------------------------

type CompiledPattern = { re: RegExp; template: string };

/** Built lazily per language, because most sessions never leave English. */
const compiled = new Map<Lang, CompiledPattern[]>();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compileFor(lang: Lang): CompiledPattern[] {
  const cached = compiled.get(lang);
  if (cached) return cached;

  const table = PATTERNS(lang);
  // Nothing loaded yet: answer "no patterns" WITHOUT caching it. Memoising the empty list here is
  // how a lazily-loaded dictionary would arrive and never be consulted.
  if (!table) return [];

  const out: CompiledPattern[] = [];
  {
    for (const [english, translated] of Object.entries(table)) {
      // `{}` becomes a non-greedy capture; everything else is literal. Non-greedy so that
      // "Skipped {}: {}" splits at the FIRST colon, which is where the reason starts.
      const body = english.split("{}").map(escapeRe).join("(.*?)");
      out.push({ re: new RegExp("^" + body + "$", "s"), template: translated });
    }
    // Longest English first: "Failed to {} user group" must be tried before "Failed to {} user",
    // or the more specific sentence never matches.
    out.sort((a, b) => b.re.source.length - a.re.source.length);
  }
  compiled.set(lang, out);
  return out;
}

/**
 * Fills a translation's holes from the captures.
 *
 * `{}` takes the next value in order. `{1}`, `{2}` … take the numbered one, and exist because Thai
 * and Chinese frequently need the values in a different order than English put them:
 *
 *   "Send {} command(s) to {} device(s)"  ->  "向 {2} 台设备发送 {1} 条命令"
 *
 * Without the indices that Chinese would read "send <device count> commands to <command count>
 * devices" — two numbers, both present, both wrong, and nothing on screen to suggest it. The two
 * forms may not be mixed within one translation; ../dictionary.test.ts enforces that, because
 * "{} … {2}" has no reading that is obviously right.
 *
 * A template asking for more values than were captured leaves the extras empty rather than printing
 * "undefined".
 *
 * THE VALUES ARE TRANSLATED TOO, and that is what makes the composed sentences readable. A hole is
 * usually device data — a policy name, a count, an interface — and those have no entry and pass
 * through, which is the whole design. But a handful of the app's sentences are assembled from a
 * WORD rather than from data:
 *
 *   `This device has no ${noun} yet`   with noun = "web filter"   (components/ui/StateBlock)
 *   `Search ${noun}…`                  with noun = "antivirus"
 *
 * Left alone those render as "อุปกรณ์นี้ยังไม่มีweb filter" — a Thai sentence with an English word
 * welded into the middle of it, which is worse than either language alone. Translating the value on
 * its way into the hole fixes them without touching the call sites, and costs nothing for the data
 * holes, which simply miss and come back as themselves.
 *
 * `value !== text` guards the recursion: a capture is a substring of the string being translated,
 * so each nested call is on a strictly shorter string and the chain has to end. The one shape that
 * could capture everything is a pattern that is nothing but a hole, and that is what the guard is
 * for.
 */
function fill(template: string, values: string[], lang: Lang, text: string): string {
  let next = 0;
  return template.replace(/\{(\d*)\}/g, (_, index: string) => {
    const value = (index ? values[Number(index) - 1] : values[next++]) ?? "";
    return value && value !== text ? translate(value, lang) : value;
  });
}

function byPattern(text: string, lang: Lang): string | null {
  for (const { re, template } of compileFor(lang)) {
    const m = re.exec(text);
    if (m) return fill(template, m.slice(1), lang, text);
  }
  return null;
}

// -- Public -------------------------------------------------------------------

/** Split off the surrounding whitespace so it can be restored after the lookup. */
const PADDING = /^(\s*)([\s\S]*?)(\s*)$/;

/**
 * Translates one string into the current (or given) language.
 *
 * Hot path: called for every string child of every element the app renders, so the cheap rejections
 * come first and English returns before touching a Map at all.
 */
/**
 * Thai, and the CJK ranges Chinese uses.
 *
 * A string containing these has already been through here once — a `title` prop translated on the
 * component and then rendered as the `<h1>`'s child, which is the ordinary way text reaches the DOM
 * here. Looking it up again can only miss, so the second pass is skipped: it saves the work, and
 * more usefully it keeps `window.__i18nMisses` a list of things that still need translating rather
 * than a list of things that already were.
 *
 * THE SECOND CONDITION IS WHAT MAKES THIS SAFE. Skipping on non-Latin script ALONE is wrong, and
 * quietly so: a mixed string is not a finished one. Components take a display prop and build a
 * sentence out of it — `placeholder={`Search ${title.toLowerCase()}…`}` in the shared User & Auth
 * list page — and `title` was translated when its own element was created, so what arrives here is
 * "Search 用户组…". Half of it is done and the other half is English, and a guard that looks only
 * for CJK calls that finished and renders the English word. Requiring that no untranslated Latin
 * WORD remains sends those back through the pattern matcher, where "Search {}" matches, the capture
 * comes back unchanged (it is already Chinese), and the sentence comes out whole.
 *
 * A single letter does not count as a word: "IP", "SSL" and the rest of the acronyms that stay
 * English by design are two letters or more, but a stray "a" or a units "s" is not worth a rescan.
 */
// Written as \u escapes rather than literal characters on purpose. One of the bounds is
// U+3000 IDEOGRAPHIC SPACE, which renders as an ordinary blank — as literals this line was a
// row of unrenderable boxes containing an invisible space, and 'tidying' that space away would
// silently change which text counts as already translated.
//
//   0E00-0E7F  Thai          3000-303F  CJK symbols and punctuation
//   3400-4DBF  CJK ext A     4E00-9FFF  CJK unified ideographs
//   FF00-FFEF  halfwidth and fullwidth forms
const ALREADY_TRANSLATED = /[\u0E00-\u0E7F\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]/;
const UNTRANSLATED_WORD = /[A-Za-z]{2,}/;

/**
 * Strings that have been looked up and have no translation, so the next render can skip the work.
 *
 * The pattern scan is ~400 regexes and the relaxed guard above sends more strings into it — every
 * Thai sentence with an acronym in it now gets a second look. Nearly all of those miss, and they
 * miss identically every render, so remembering the answer costs one Set lookup and saves the scan.
 *
 * Capped because the keys include device data, which is unbounded: policy names, CLI output and
 * FortiGate error text all pass through here. At the cap the cache is dropped whole rather than
 * evicted one by one — it is an optimisation, and a simple one is worth more than a smart one.
 */
const NO_TRANSLATION: Record<Lang, Set<string>> = { en: new Set(), th: new Set(), zh: new Set() };
const NO_TRANSLATION_CAP = 4000;

export function translate(text: string, lang: Lang = getLang()): string {
  if (lang === "en") return text;
  if (!text) return text;
  // No letters means no words: counts, IPs, dates, punctuation separators.
  if (!/[A-Za-z]/.test(text)) return text;
  if (ALREADY_TRANSLATED.test(text) && !UNTRANSLATED_WORD.test(text)) return text;

  const m = PADDING.exec(text);
  if (!m) return text;
  const [, before, rawCore, after] = m;
  if (!rawCore) return text;

  // The dictionary is keyed on single-spaced text; JSX leaves newline + indentation inside longer
  // paragraphs, so collapse before looking up.
  const core = rawCore.replace(/\s+/g, " ");

  const exact = EXACT(lang)?.[core];
  if (exact !== undefined) return before + exact + after;

  const known = NO_TRANSLATION[lang];
  if (known.has(core)) return text;

  const pattern = byPattern(core, lang);
  if (pattern !== null) return before + pattern + after;

  if (known.size >= NO_TRANSLATION_CAP) known.clear();
  known.add(core);
  if (debugEnabled) misses.add(core);
  return text;
}

/** True when this string has a translation - used by the tests and the coverage report. */
export function hasTranslation(text: string, lang: Lang): boolean {
  const core = text.replace(/\s+/g, " ").trim();
  return EXACT(lang)?.[core] !== undefined || byPattern(core, lang) !== null;
}

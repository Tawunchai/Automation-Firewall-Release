/**
 * Harvests the English UI strings out of src/ so the th/zh dictionaries can be built from them.
 *
 * The dictionaries in src/i18n/dictionary are keyed by the ENGLISH STRING itself, not by an
 * invented `page.section.key`. That is a deliberate choice: 330 of the app's 345 source files
 * render their text as JSX literals, and rewriting every one of them into `t("some.key")` would be
 * ~2,500 hand edits whose only product is a second name for a string we already have. Keying on the
 * English means the source stays readable, a new page is translated by adding two dictionary lines
 * rather than by touching the page, and an untranslated string degrades to English instead of
 * rendering a raw `some.key`.
 *
 * WHAT IT LOOKS FOR mirrors what src/i18n/jsxRuntime.ts translates at runtime — JSX text, string
 * children, and the display-only attributes — plus the object/array literals that feed them
 * (column headers, menu labels, toast text). Anything this misses is not broken, only English:
 * run the app with `localStorage.i18nDebug = "1"` and read `window.__i18nMisses` to find it.
 *
 *   node scripts/i18n-extract.mjs      # write scripts/i18n-strings.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const OUT = path.join(HERE, "i18n-strings.json");

/** Attributes whose value is shown to a person. `value`/`name`/`id` are NOT here: they are data. */
const TEXT_ATTRS = new Set([
  "placeholder", "title", "alt", "aria-label", "aria-placeholder", "aria-description",
  "label", "description", "subtitle", "tooltip", "hint", "emptyText", "okText", "cancelText",
  "confirmText", "helpText", "heading", "caption", "legend", "summary",
  // Kept in step with TEXT_ATTRS in src/i18n/jsx-runtime.ts — see the note there.
  "desc", "note", "sub", "header", "message",
  // components/ui/StateBlock's own props: the word for the thing a device page lists.
  //
  // Harvested here but deliberately NOT translated by the runtime, which is the one place the two
  // lists disagree on purpose. The noun needs a dictionary entry, because it ends up on screen; it
  // must not be translated at the prop, because the sentence it is built into has to match first.
  // src/i18n/jsx-runtime.ts spells the failure out.
  "noun", "what",
]);

/** Object/array keys that hold display text (`{ label: "Devices" }`, `{ title: "Static Routes" }`). */
const TEXT_PROPS = new Set([
  "label", "title", "desc", "description", "subtitle", "text", "tooltip", "hint", "placeholder",
  "help", "helpText", "message", "heading", "caption", "name", "summary", "detail", "details",
  "note", "reason", "unit", "suffix", "prefix", "empty", "emptyText", "okText", "cancelText",
  "confirmText", "body", "content", "blurb", "why", "what",
  // `noun` reaches the screen through StateBlock's four sentences rather than on its own, and the
  // pages that have more than one of them keep it in a lookup table — CATEGORY_META in
  // pages/security-profiles is `{ noun: "AntiVirus profile" }`. It was on the JSX-attribute list
  // but not this one, so the six security-profile nouns were never harvested and every one of those
  // pages said "This device has no AntiVirus profile yet" in the middle of a Thai screen.
  "noun",
  // `l` is the label half of the `{ v, l }` option pairs that components/ui/form-controls' Segmented
  // takes. Single-letter keys are usually data, but this one is a label in every use in the app.
  "l",
  // `header` is the column heading in every table definition in the app — `{ key: "auth", header:
  // "Auth Method", render: … }`. Only "heading" was listed, which no table uses.
  "header",
  // `sub` is the second line of a page header card; `prompt` is the text of an AI example chip,
  // which is what a person clicks and therefore reads.
  "sub", "prompt",
]);

/**
 * Variables whose name says their contents are display text.
 *
 * The app's enum-to-label maps are plain records — `TYPE_LABELS = { physical: "Physical Interface",
 * "hard-switch": "Hardware Switch" }` — where the KEY is the FortiOS token and the VALUE is what a
 * person reads. No property name in TEXT_PROPS can catch those, because the property names are the
 * device's vocabulary, not ours. The variable's own name is the reliable signal instead.
 */
const TEXT_TABLE_NAMES =
  /(LABELS?|NAMES?|TITLES?|HEADERS?|CAPTIONS?|DESCRIPTIONS?|TEXTS?|WORDS?|GROUPS?|OPTIONS?)$/;

/** Toast / dialog helpers whose first string argument is shown to a person. */
const TEXT_CALLS = /^(message|toast|notify)\.(success|error|info|warning|warn|loading)$/;

/** Text inside these tags is machine output (CLI, config, code) and must stay verbatim. */
const OPAQUE_TAGS = new Set(["code", "pre", "script", "style", "textarea"]);

// -- Filters -----------------------------------------------------------------

/**
 * Is this string a sentence a person reads, or an identifier the code passes around?
 *
 * The cost of the two mistakes is not symmetric. A false positive costs one junk dictionary line
 * that nothing ever looks up. A false negative costs an English word stranded on a Thai screen. So
 * this leans permissive and rejects only shapes that cannot be prose.
 */
function isDisplayText(raw, jsxText = false) {
  const s = raw.trim();
  if (s.length < 2 || s.length > 400) return false;
  if (!/[A-Za-z]/.test(s)) return false;                      // numbers, punctuation, emoji
  if (/^[\d\s.,:%+/-]+$/.test(s)) return false;

  // Identifiers: kebab/snake/dot/camel single tokens - "internet-service", "srcintf", "dst_type".
  //
  // Not applied to JSX TEXT, though. A bare lowercase word between two tags is a word on screen -
  // the "route" in `{n} route{n === 1 ? "" : "s"}`, which twenty-two pages write that way - and
  // dropping those left a scatter of English nouns in the middle of otherwise Thai sentences. In a
  // string literal the same token really is usually an identifier, so the rule still holds there.
  if (!jsxText && !/\s/.test(s) && /^[a-z][\w.-]*$/.test(s)) return false;
  if (!/\s/.test(s) && /^[a-z]+[A-Z]/.test(s)) return false;  // camelCase token

  if (/^(https?:)?\/\//.test(s)) return false;                // URLs
  if (/^wss?:$/.test(s)) return false;                        // WebSocket scheme halves
  if (/^[./]{0,2}[\w-]+(\/[\w.:-]+)+$/.test(s)) return false; // paths, api routes, "TCP/443"
  if (/^\/[a-z][\w-]+$/.test(s)) return false;                // single-segment route, "/api"
  // A route WITH a query string: "/admin/fw-addresses?tab=groups". The path rule above stops at
  // the "?" because its segment class holds no "?" or "=", so these two navigate() targets reached
  // the inventory and the i18n gate asked for them in Thai and Chinese. Translating one would be a
  // broken link. Requires no whitespace, so prose containing a slash ("Allow / Deny") is untouched.
  if (/^\/[\w-]+(\/[\w.:-]*)*\?[\w\-=&%.]+$/.test(s) && !/\s/.test(s)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return false;            // colours
  if (/rgba?\(/.test(s)) return false;                       // css colour functions, anywhere
  if (/^\d+(\.\d+)*px$|^var\(/.test(s)) return false;         // css
  if (/^_/.test(s)) return false;                             // "_flat" and other private markers
  if (/^[0-9a-f]{16,}$/i.test(s)) return false;               // hex blobs, sample tokens
  if (/^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}$/i.test(s)) return false; // sample IPv6
  if (/^\d+(\.\d+)?m?s$/.test(s)) return false;               // durations: "12s", "250ms"
  if (/^[a-z]+\/[\w+.-]+(,[a-z]+\/[\w+.-]+)*$/.test(s)) return false; // MIME accept lists
  // CSS grid templates. Every table on every list page declares its columns as one of these, and
  // they are the only multi-token strings in the app made entirely of lengths.
  if (s.split(/\s+/).every((w) => GRID_TRACK.test(w))) return false;

  // Tailwind and the app's own utility classes.
  //
  // Rule one is the ordinary class list, where every token carries a separator. It misses the ones
  // that mix bare utilities in — "flex min-h-0 flex-1 flex-col", "truncate ink-3", "chip
  // chip-accent" — because "flex", "truncate" and "chip" look exactly like words.
  //
  // Rule two is for those, and it is deliberately narrow, because the obvious wider version is
  // wrong: a vocabulary that includes "static", "gap" or "self" throws away "static route",
  // "controls with a gap somewhere" and "self-authenticated", all of which are text on screen. So a
  // string is only condemned when it names one of index.css's OWN classes — `ink`, `hairline`,
  // `surface-*`, `chip`, `banner`, `btn`, `seg`, `shell-*`, `state-*`, which no sentence uses — or
  // when a bare Tailwind keyword appears alongside a token that is unambiguously a class.
  const words = s.split(/\s+/);
  const classShaped = words.every((w) => /^-?[a-z0-9]+[\w:[\]./-]*$/.test(w));
  if (words.length > 1 && classShaped) {
    if (words.every((w) => /[-:[]/.test(w))) return false;
    if (words.some((w) => APP_CLASS.test(w))) return false;
    if (words.some((w) => TAILWIND_BARE.test(w)) && words.some((w) => /[-:[]/.test(w))) return false;
  }
  // A lone token is a class only when it is punctuated like one: an arbitrary value in brackets
  // ("text-[13px]") or a variant prefix with something after the colon ("sm:inline"). A trailing
  // colon is a label — the traffic counters read "in:" and "out:" — and hyphenated words like
  // "self-authenticated" and "monitor-all" stay too.
  if (words.length === 1 && classShaped && (s.includes("[") || /^[a-z0-9-]+:[a-z0-9-]/.test(s))) {
    return false;
  }
  return true;
}

/** One column of a CSS `grid-template-columns`: a length, a keyword, or a minmax() of those. */
const GRID_TRACK =
  /^(?:\d+(?:\.\d+)?(?:fr|px|%|em|rem|ch|vw|vh)|auto|min-content|max-content|minmax\([^)]*\))$/;

/** index.css's own class vocabulary — see the design-system note there. Never used in prose. */
const APP_CLASS = /^(?:ink|hairline|surface|chip|banner|btn|seg|shell|state|t)(?:-|$)/;

/** Tailwind utilities written without a modifier, which do read as ordinary words on their own. */
const TAILWIND_BARE =
  /^(?:flex|grid|truncate|rounded|hidden|absolute|relative|sticky|fixed|block|inline|shrink|grow|border|shadow|transition|overflow|uppercase|lowercase|capitalize|italic|underline)$/;

/**
 * Most template literals in this codebase are not sentences.
 *
 * The app assembles URLs, Tailwind class strings, FortiOS CLI lines, API paths and regex sources
 * the same way it assembles prose, and 834 of the 3,315 harvested strings arrive from that machine
 * traffic. A URL that gets "translated" is a broken link, and a class string that gets translated
 * is an unstyled page, so this is the one filter that must lean strict rather than permissive: when
 * in doubt, leave it English.
 */
function isSentencePattern(s) {
  const words = s.replace(/\{\}/g, " ").replace(/\s+/g, " ").trim();
  if (!isDisplayText(words) || !/[A-Za-z]{2}/.test(words)) return false;

  if (/^[/{]/.test(s) || /\{\}\//.test(s)) return false;        // /admin/x/{}, {}/audit - routes
  if (/[?&=]\{\}|\{\}[?&=]/.test(s)) return false;              // query strings
  if (/^(set|unset|config|edit|next|end|get|show|diagnose|execute)\s/.test(s)) return false; // CLI
  if (/[\\^$]|\(\.\+\)|\[\^/.test(s)) return false;             // regex sources
  if (/^\d|px\b|rgba?\(|^#|\bvar\(--/.test(s)) return false;    // css values
  if (/\u001b\[/.test(s)) return false;                     // ANSI-coloured terminal output
  if (/^[a-z][\w-]*\(/.test(s)) return false;                   // scale({}), color-mix(in srgb, {}
  if (/\b(?:linear|ease|forwards|infinite)\b.*\{\}|\{\}m?s\s/.test(s)) return false; // animations
  if (/^\[[\w\s]+\]/.test(s)) return false;                     // "[WebFilter edit] GET ..." debug
  // Identifier assembly: a hole welded to a word with no space - vip{}-ext, vpn_{}_l2tp, p{}-rule.
  //
  // `-` and `:` are in the adjacency class as well as alphanumerics, because an id is just as
  // often joined by a separator: `img-{}-{}` (attachImages.ts builds an attachment id) and
  // `grp:{}:{}` (layout3d.ts keys a topology group) both reached the inventory and sat there
  // waiting for a Thai translation of a map key. The no-whitespace guard is what keeps this
  // narrow — "{} ms" and "{}h ago" contain a space and are unaffected.
  if (/[a-z0-9:-]\{\}|\{\}[a-z0-9:-]/.test(s) && !/\s/.test(s.replace(/\{\}/g, ""))) return false;
  if (/[_][\w]*\{\}|\{\}[_]/.test(s)) return false;

  // Tailwind: any recognisably utility-shaped token means the whole string is a class list.
  if (/\b(?:flex|grid|block|inline|hidden|absolute|relative|truncate|rounded|border|shadow|transition)\b/.test(words)
      && /-\[|(?:^|\s)(?:px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|text|bg|w|h|min|max|top|left|right|bottom|z|opacity|leading|tracking|ring)-/.test(words)) {
    return false;
  }
  // A lone identifier with a hole - "match.{}.group", "{}h ago" is fine, "auth.{}" is not.
  if (!/\s/.test(words) && !/^[A-Z]/.test(words)) return false;

  return true;
}

/**
 * HTML entities, decoded.
 *
 * The AST hands back JSX text exactly as it was typed, so `User &amp; Authentication` arrives with
 * the entity intact — but React decodes it before it reaches the DOM, so the string the runtime
 * asks the dictionary for is `User & Authentication`. Without this the ten affected sentences would
 * be harvested in a spelling that nothing ever looks up, and would silently stay English.
 */
const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&rsquo;": "’",
  "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&times;": "×",
  "&middot;": "·", "&deg;": "°", "&copy;": "©",
};
const decodeEntities = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|[a-zA-Z]+);/g, (m, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[m] ?? m;
  });

/**
 * Collapses the whitespace JSX indentation leaves behind, the same way the runtime does.
 *
 * `entities` is on only for text that passed through the JSX parser, which is where `&amp;` means
 * `&`. In a plain object literal it is six literal characters and decoding it would invent a string
 * the app never renders.
 */
const normalise = (s, entities = false) =>
  (entities ? decodeEntities(s) : s).replace(/\s+/g, " ").trim();

// -- Walk --------------------------------------------------------------------

/**
 * src/i18n is skipped by the generic walk, and that is not an optimisation.
 *
 * The dictionaries under src/i18n/dictionary are `{ "Static Routes": "เส้นทางแบบกำหนดเอง" }` — object
 * literals full of string values. Walking them would harvest every Thai and Chinese translation as
 * though it were English UI text to be translated, and each run would feed its own output back in.
 * The one file in there that does hold English for translation, locales/en.ts, is read deliberately
 * by extractLocaleBundle() below.
 */
const SKIP_DIRS = new Set(["node_modules", "i18n"]);

/**
 * `fixture*.ts` is CAPTURED DEVICE DATA, not source to harvest.
 *
 * pages/topology/stage/fixture80e.ts is a recorded snapshot of what the lab FortiGate answered —
 * interfaces, addresses and the names of its firewall policies. Walking it harvested nine of those
 * policy names as English UI text awaiting translation:
 *
 *     "Block-FB-YT-172.16.100.123"   "LAN-to-WAN-Secure"   "TS-8.8.8.8-192.168.1.50"
 *     "Guest-WiFi-Access"            "Test-DMZ-to-WAN"     "Testing-Policy-Object"   …
 *
 * Those are object names on somebody's firewall. They are never translated — an operator comparing
 * this console against `show firewall policy` has to see the same characters — and the i18n gate
 * demanded a Thai and a Chinese rendering of each one anyway. Same class of mistake as parsing .ts
 * as TSX (see extractFile): the harvest looks plausible, so nothing fails until a person reads it.
 *
 * The rule is the filename prefix rather than a list of paths, so the next captured fixture is
 * excluded the day it is added instead of the day someone notices.
 */
const isFixture = (name) => /^fixture/i.test(name);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!(SKIP_DIRS.has(entry.name) && path.dirname(full) === SRC) && entry.name !== "node_modules") {
        sourceFiles(full, out);
      }
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !isFixture(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `t("some.key")` the app actually calls.
 *
 * locales/en.ts is the console's original starter bundle and still carries whole sections — invites,
 * support tickets, a healthcare module — for screens this app no longer has. Harvesting the file
 * wholesale added 680 strings that nothing renders, which is 680 sentences to translate twice for
 * no one. Only the keys with a live call site are worth a dictionary line.
 */
function referencedKeys(files) {
  const T_CALL = /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
  const keys = new Set();
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(T_CALL)) keys.add(m[1]);
  }
  return keys;
}

const tagNameOf = (node) => {
  const el = ts.isJsxElement(node) ? node.openingElement : node;
  return el.tagName ? el.tagName.getText() : "";
};

/**
 * Every string literal an expression could evaluate to.
 *
 * A label is very often not a bare literal. The console writes a toggle's two states as one
 * conditional — `label={activeMenu ? "Collapse sidebar" : "Expand sidebar"}`, `{mode === "pair" ?
 * "Interface Pair" : "By Sequence"}`, `aria-label={shown ? "Hide password" : "Show password"}` —
 * and a default as a fallback: `days.join(" · ") || "Every day"`. Taking only a directly-written
 * literal left the second half of every one of those pairs out of the dictionary, so a screen in
 * Thai turned English the moment you collapsed the sidebar or showed a password.
 *
 * Both branches of a conditional are returned, since both can be on screen. For `||` and `??` only
 * the fallback is: the left side is the value being defaulted, and if it happens to be a literal
 * too the recursion picks it up anyway.
 */
const isFallback = (node) =>
  ts.isBinaryExpression(node) &&
  (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);

/**
 * `"a long " + "sentence"` folded back into the one string it renders as.
 *
 * Long copy is wrapped across lines with `+` — HeroArt's alt text is three literals — and each
 * fragment on its own is not what reaches the DOM, so harvesting them separately produces three
 * dictionary keys that never match anything. Returns null unless every leaf is a literal, since a
 * concatenation with a value in it is a pattern, not a string.
 */
function foldConcat(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return foldConcat(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldConcat(node.left);
    const right = foldConcat(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function displayStrings(node, out = []) {
  if (!node) return out;
  if (ts.isStringLiteral(node)) out.push(node);
  else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    foldConcat(node) !== null
  ) {
    // Reuses the literal's node for the source location; only `.text` is read downstream.
    out.push({ text: foldConcat(node) });
  }
  else if (ts.isParenthesizedExpression(node)) displayStrings(node.expression, out);
  else if (ts.isConditionalExpression(node)) {
    displayStrings(node.whenTrue, out);
    displayStrings(node.whenFalse, out);
  } else if (isFallback(node)) {
    displayStrings(node.left, out);
    displayStrings(node.right, out);
  }
  return out;
}

function extractFile(file, hits, patterns) {
  const text = fs.readFileSync(file, "utf8");
  // ScriptKind by EXTENSION, not TSX for everything.
  //
  // `<` means two different things in the two dialects, and this is the one place that matters: in
  // .tsx it opens a JSX element, in .ts it is the less-than operator. Parsing a .ts file as TSX
  // therefore reads `Number(n) <= 255` as a JSX element — and everything after it, up to whatever
  // the parser decides closes the tag, becomes JSX TEXT, which this extractor then harvests as
  // user-facing English.
  //
  // It really happened. pages/device-admins/model.ts contributed 26 "translatable strings" that
  // were fragments of its own source, among them:
  //
  //     "= 255); }; if (s.includes(\"/\"))"
  //     "$/.test(mask.trim())) return Number(mask)"
  //
  // Each one then sat in scripts/i18n-strings.json demanding a Thai and a Chinese translation, so
  // the i18n gate could only be satisfied by translating source code. Two notes on the shape of
  // that failure: it is silent, because a mis-parse produces plausible-looking rows rather than an
  // error; and it is contagious, because the honest way to make the gate green is to add the junk
  // to keep.ts, which hides it for ever.
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const rel = path.relative(SRC, file).replace(/\\/g, "/");

  const add = (value, node, jsxText = false) => {
    const s = normalise(value, jsxText);
    if (!isDisplayText(s, jsxText)) return;
    record(hits, s, node, sf, file);
  };

  /**
   * A template literal becomes a PATTERN, with every `${...}` written as `{}`.
   *
   * `Showing ${n} of ${total} routes` is one string on screen but never the same string twice, so
   * an exact-match dictionary can never hold it. Recording the shape lets the runtime match it back
   * and put the values into the translation's own word order - which matters, because Thai and
   * Chinese do not put the count where English does.
   */
  const addPattern = (node) => {
    let pattern = node.head.text;
    for (const span of node.templateSpans) pattern += "{}" + span.literal.text;
    const s = normalise(pattern);
    if (!isSentencePattern(s)) return;
    record(patterns, s, node, sf, file);
  };

  /** Tag stack, so text inside <code>/<pre> can be skipped. */
  const opaque = [];
  /** Attribute stack, so a conditional inside className/style/value is not read as prose. */
  const inDataAttr = [];

  const visit = (node) => {
    const isEl = ts.isJsxElement(node);
    if (isEl && OPAQUE_TAGS.has(tagNameOf(node))) opaque.push(true);
    const dataAttr = ts.isJsxAttribute(node) && !TEXT_ATTRS.has(node.name.getText());
    if (dataAttr) inDataAttr.push(true);

    if (!opaque.length) {
      if (ts.isJsxText(node)) {
        add(node.text, node, true);
      } else if (ts.isJsxAttribute(node) && node.initializer) {
        const name = node.name.getText();
        if (TEXT_ATTRS.has(name)) {
          if (ts.isStringLiteral(node.initializer)) add(node.initializer.text, node, true);
          else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
            for (const s of displayStrings(node.initializer.expression)) add(s.text, node);
          }
        }
      } else if (ts.isJsxExpression(node) && node.expression) {
        // `{"text"}` as a child, and the far commoner `{open ? "Collapse sidebar" : "Expand
        // sidebar"}` — see displayStrings for why both branches are taken.
        for (const s of displayStrings(node.expression)) add(s.text, node);
      } else if (ts.isPropertyAssignment(node)) {
        const key = node.name.getText().replace(/^["']|["']$/g, "");
        if (TEXT_PROPS.has(key)) {
          for (const s of displayStrings(node.initializer)) add(s.text, node);
        }
      } else if (ts.isVariableDeclaration(node) && node.initializer && node.name.getText) {
        // TYPE_LABELS = { physical: "Physical Interface", … } — the values are the display text and
        // the keys are the device's own vocabulary, so only the variable's name marks it.
        //
        // Both sides are taken, because which one is the label depends on which way the table
        // faces. TYPE_LABELS maps a FortiOS token to a label; TYPE_GROUPS, ten lines below it in
        // the same file, maps a label to the tokens it covers. isDisplayText sorts them out: a
        // lone lowercase token like "wildcard-fqdn" is rejected, "IP Range/Subnet" is not.
        if (
          TEXT_TABLE_NAMES.test(node.name.getText()) &&
          ts.isObjectLiteralExpression(node.initializer)
        ) {
          for (const prop of node.initializer.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            if (ts.isStringLiteral(prop.name)) add(prop.name.text, prop);
            for (const s of displayStrings(prop.initializer)) add(s.text, prop);
          }
        } else {
          // A sentence parked in a const so two call sites can share it:
          //   const FORTIGUARD_GATE_REASON = "Requires FortiGuard Category Based Filter…";
          // These are ordinary UI copy that simply has a name, and there are enough of them —
          // gate reasons, empty-state text, error messages — that leaving them out put whole
          // explanatory paragraphs on screen in English.
          for (const s of displayStrings(node.initializer)) add(s.text, node);
        }
      } else if (ts.isReturnStatement(node) && node.expression) {
        // A helper that answers with a label rather than computing one:
        //   if (!cfg.two_step) return "Off — every flow that uses an emailed OTP is disabled";
        //   if (r === "admin") return "Admin";
        // Both are ordinary display text; neither is a literal anywhere the rules above look.
        for (const s of displayStrings(node.expression)) add(s.text, node);
      } else if (!inDataAttr.length && (ts.isConditionalExpression(node) || isFallback(node))) {
        // The same two shapes as displayStrings, but reached anywhere rather than only under a
        // display prop — helpers that compute a label are ordinary functions:
        //   return [days, time].filter(Boolean).join(" · ") || "Every day";
        // `inDataAttr` keeps this out of className/style/value, where a conditional chooses between
        // two class names or two colours rather than between two things to read. Everything else
        // relies on isDisplayText, which rejects the lone lowercase tokens that CLI values and
        // utility classes are made of.
        for (const s of displayStrings(node)) add(s.text, node);
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression.getText();
        if (TEXT_CALLS.test(callee)) {
          for (const arg of node.arguments) {
            if (ts.isStringLiteral(arg)) { add(arg.text, node); break; }
            // message.error(err?.x || "Failed to delete route")
            if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.BarBarToken
                && ts.isStringLiteral(arg.right)) { add(arg.right.text, node); break; }
          }
        }
      } else if (ts.isTemplateExpression(node)) {
        addPattern(node);
      } else if (ts.isArrayLiteralExpression(node)) {
        // Column headers and tab labels: ["DESTINATION", "GATEWAY IP", ...]. Only when every
        // element is a string, so arrays of ids with one prose entry are not dragged in wholesale.
        //
        // The all-strings requirement this rule started with was too strict, and the two shapes it
        // dropped are both common here: the tuple, `[["schedules", "Schedules", <FiClock/>], …]`,
        // rejected because of the icon; and the mixed header row, `[t("user.name"), …, "Device
        // access", t("user.action")]`, rejected because of the `t()` calls around the one literal.
        // Every string element is taken instead and isDisplayText decides, which is what it is for:
        // a lone lowercase token like "schedules" is an id and is not prose.
        for (const el of node.elements) {
          if (ts.isStringLiteral(el)) add(el.text, el);
          else if (ts.isArrayLiteralExpression(el)) {
            for (const e of el.elements) if (ts.isStringLiteral(e)) add(e.text, e);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
    if (dataAttr) inDataAttr.pop();
    if (isEl && OPAQUE_TAGS.has(tagNameOf(node))) opaque.pop();
  };

  visit(sf);
}

/**
 * The i18next bundle's own English values, which are display text by definition.
 *
 * Fifteen files still call `t("account.save")` against src/i18n/locales/en.ts. What `t()` returns
 * is English, and it reaches the screen as a string child like any other literal — so it needs a
 * dictionary entry exactly as a hardcoded string does. The generic walk above only catches the
 * handful of keys that happen to be named `title`/`label`, which is why this pass exists.
 *
 * i18next's `{{name}}` interpolation is rewritten to the `{}` the pattern matcher speaks, and
 * `key_one`/`key_other` plural pairs are picked up on both sides.
 */
function extractLocaleBundle(file, keys, hits, patterns) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** The dotted path of a property, so `account.save` can be checked against the call sites. */
  const pathOf = (node) => {
    const parts = [];
    for (let n = node; n; n = n.parent) {
      if (ts.isPropertyAssignment(n)) parts.unshift(n.name.getText().replace(/^["']|["']$/g, ""));
    }
    return parts.join(".");
  };

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const key = pathOf(node);
      // i18next stores plurals as `key_one` / `key_other`; the call site names the base key.
      const base = key.replace(/_(one|other|zero|few|many)$/, "");
      if (keys.has(key) || keys.has(base)) {
        const raw = node.initializer.text.replace(/\{\{\s*[^}]+\s*\}\}/g, "{}");
        const s = normalise(raw);
        if (s.includes("{}")) {
          if (isSentencePattern(s)) record(patterns, s, node, sf, file);
        } else if (isDisplayText(s)) {
          record(hits, s, node, sf, file);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Shared by both passes: remembers a string and the first few places it was found. */
function record(bag, s, node, sf, file) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const where = bag.get(s) ?? new Set();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  where.add(rel + ":" + (line + 1));
  bag.set(s, where);
}

// -- Main --------------------------------------------------------------------

const hits = new Map();
const patterns = new Map();
const files = sourceFiles(SRC);
for (const f of files) extractFile(f, hits, patterns);
extractLocaleBundle(path.join(SRC, "i18n/locales/en.ts"), referencedKeys(files), hits, patterns);

const byText = (a, b) => a.localeCompare(b);
const strings = [...hits.keys()].sort(byText);
const templates = [...patterns.keys()].sort(byText);
const where = Object.fromEntries(
  [...strings, ...templates].map((s) => [s, [...(hits.get(s) ?? patterns.get(s))].sort().slice(0, 4)]),
);

fs.writeFileSync(
  OUT,
  JSON.stringify({ files: files.length, strings, templates, where }, null, 2) + "\n",
);
console.log(
  files.length + " files -> " + strings.length + " strings + " + templates.length +
  " interpolated patterns -> scripts/i18n-strings.json",
);

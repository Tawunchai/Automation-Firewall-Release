/**
 * The JSX runtime the app compiles against, so that translation needs no call sites.
 *
 * WHY THIS AND NOT A `t()` CALL AT EVERY SITE
 * (no example key is spelled out anywhere in this file on purpose — keys.test.ts scans the source
 * for literal translation-key calls, and one written in a comment would be reported as missing)
 * 330 of the console's 345 source files write their text as JSX literals — `title="Static Routes"`,
 * `HEADERS = ["DESTINATION", …]`, `message.success("Static route deleted")`. Converting them would
 * be ~2,500 hand edits across every page in the app, each one a chance to change a message's
 * meaning, and it would leave the source less readable than it is now. Instead the strings stay
 * where they are and are translated on the way to the DOM.
 *
 * HOW IT IS WIRED
 * vite.config.ts sets `jsxImportSource: "i18n-jsx"` and aliases that to this directory, so
 * @vitejs/plugin-react emits `import { jsx } from "i18n-jsx/jsx-runtime"` for the app's own files.
 * It is deliberately NOT an alias on `react/jsx-runtime`: node_modules ship pre-compiled JS that
 * imports React's runtime directly, and rewriting that module for the whole dependency graph would
 * put recharts and FullCalendar's internals on this path for no gain — and would make this file
 * import itself.
 *
 * WHAT IT TOUCHES
 *   - string children of HOST elements (`<h1>Static Routes</h1>`) — this is the bulk of it, and it
 *     is where text from anywhere else in the app converges: a label held in an object, a column
 *     header from an array, a toast built in an api catch, the return value of i18next's `t()`.
 *     They all become a string child of some <div> eventually, so all of them are covered here.
 *   - a fixed list of DISPLAY-ONLY attributes (placeholder, title, aria-label, …), on host elements
 *     and on components alike. The component case is what reaches text rendered by a library —
 *     recharts axis labels and FullCalendar button text never pass through this runtime, but the
 *     props we hand them do.
 *
 * WHAT IT MUST NOT TOUCH, and why each one would break something:
 *   - `value`, `defaultValue`, `name`, `id`, `key`, `href`, `src`, `className`, `style` — data and
 *     identity. A translated `value` submits Thai to the FortiGate.
 *   - children of <code>, <pre> and <textarea> — CLI, config text and diff output are quoted
 *     machine output; translating a word inside `set dstintf "port1"` would be a lie about what
 *     the device was sent.
 *   - anything with no dictionary entry, which is most device data. Policy names, interface names
 *     and FortiGate error strings share this path with UI text and fall through untranslated, which
 *     is exactly what is wanted for them.
 */

import { Fragment as ReactFragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import { getLang } from "./lang";
import { translate } from "./translate";

// The JSX namespace tsc needs comes straight from React; only jsx/jsxs are replaced, and the
// explicit exports below win over this star.
export * from "react/jsx-runtime";

/**
 * Re-exported by name rather than left to the star above, because the star does not survive Vite's
 * dependency pre-bundling: React ships its runtime as CJS, the optimizer rewrites it, and a star
 * re-export of the result loses `Fragment`. Every `<>…</>` in the app compiles to a Fragment import
 * from this module, so the whole console failed to mount in dev with "does not provide an export
 * named 'Fragment'" — while `npm run build`, which uses Rollup rather than the optimizer, was fine.
 * The production build passing is not evidence that the dev server does.
 */
export const Fragment = ReactFragment;

type Props = Record<string, unknown> & { children?: unknown };

/**
 * Attributes whose value a person reads.
 *
 * Kept in step with TEXT_ATTRS in scripts/i18n-extract.mjs — that list decides what gets harvested
 * for translation, this one decides what gets translated, and a string in one but not the other is
 * either a wasted dictionary line or an untranslated label.
 */
const TEXT_ATTRS = new Set([
  "placeholder", "title", "alt", "aria-label", "aria-placeholder", "aria-description",
  "aria-roledescription", "aria-valuetext", "label", "description", "subtitle", "tooltip", "hint",
  "emptyText", "okText", "cancelText", "confirmText", "helpText", "heading", "caption", "legend",
  "summary", "unit",
  // The rest of the app's own display props, found by walking the console with the miss log on:
  // `desc` and `note` are the second line of a settings row (Service ▸ Two-Step Verification is
  // built entirely out of them), `sub` the second line of a page header, `header` a column title.
  "desc", "note", "sub", "header", "message",
]);

/**
 * Display props that must NOT be translated here, even though a person reads them.
 *
 * `noun` and `what` are components/ui/StateBlock's — the word for the thing a device page lists
 * ("static route", "LDAP server"). Nothing renders them directly; all four of StateBlock's states
 * build an English sentence around one first (`This device has no ${noun} yet`). Translating the
 * word at the prop would hand ../i18n/translate.ts a half-Thai sentence, which it recognises as
 * already-translated and passes through — leaving the sentence in English with one Thai word in the
 * middle of it. So the noun stays English until the sentence around it has matched, and `fill` in
 * ./translate.ts translates it into the hole.
 *
 * Said here rather than merely left absent because the two names read like ordinary display text,
 * and the next person to extend TEXT_ATTRS would reasonably add them. They used to be a `Set` on
 * this module as well, which nothing imported — scripts/i18n-extract.mjs keeps its own copy of the
 * same two names (lines 41 and 55), so a second list here was a thing to forget rather than a
 * single source of truth. If you change the pair, change it in BOTH files.
 */

/** Children of these are machine output and are passed through verbatim. */
const OPAQUE_TAGS = new Set(["code", "pre", "textarea", "script", "style"]);

/**
 * Translates a child slot in place-ish, returning a new value only when something changed.
 *
 * Returning the original array identity when nothing was translated matters: React compares
 * children by identity in a few places, and handing back a fresh array on every render for the
 * English case would be pure churn for the 99% of sessions that never leave English.
 */
function translateChildren(children: unknown): unknown {
  if (typeof children === "string") return translate(children);

  if (Array.isArray(children)) {
    let changed = false;
    /** Whether the child immediately before this one came back translated. */
    let prevTranslated = false;

    const out = children.map((child, i) => {
      if (typeof child !== "string") {
        prevTranslated = false;
        return child;
      }

      // The English plural suffix, dropped once its noun has been translated.
      //
      // Twenty-two places in the app count something as `{n} route{n === 1 ? "" : "s"}`, which
      // reaches React as three children: the number, " route", and "s". Translating the middle one
      // and leaving the last produces "5 เส้นทางs" — the one visibly wrong thing on an otherwise
      // Thai page. Neither Thai nor Chinese marks plurals this way, so the suffix is dropped, but
      // ONLY when the word before it actually translated: if the noun fell through as English, "s"
      // is still doing its job and "5 routes" is what should render.
      if ((child === "s" || child === "es") && i > 0 && prevTranslated) {
        changed = true;
        prevTranslated = false;
        return "";
      }

      const next = translate(child);
      prevTranslated = next !== child;
      if (prevTranslated) changed = true;
      return next;
    });
    return changed ? out : children;
  }

  return children;
}

/** Exported for ./jsx-dev-runtime.ts, which needs the same pass with jsxDEV's argument list. */
export function translateElementProps(type: unknown, props: Props): Props {
  const isHost = typeof type === "string";
  const opaque = isHost && OPAQUE_TAGS.has(type as string);

  let out: Props | null = null;
  const write = (key: string, value: unknown) => {
    if (!out) out = { ...props };
    out[key] = value;
  };

  // Children: host elements only. A component's own string props are its business until it renders
  // them into a host element, and translating them here as well would mean doing it twice.
  if (isHost && !opaque && props.children !== undefined) {
    const next = translateChildren(props.children);
    if (next !== props.children) write("children", next);
  }

  for (const key of TEXT_ATTRS) {
    const value = props[key];
    if (typeof value !== "string") continue;
    const next = translate(value);
    if (next !== value) write(key, next);
  }

  return out ?? props;
}

export function jsx(type: unknown, props: Props, key?: unknown) {
  // Straight through in English — the common case, and the one that must cost nothing.
  if (getLang() === "en" || props == null) {
    return (reactJsx as CallableFunction)(type, props, key);
  }
  return (reactJsx as CallableFunction)(type, translateElementProps(type, props), key);
}

export function jsxs(type: unknown, props: Props, key?: unknown) {
  if (getLang() === "en" || props == null) {
    return (reactJsxs as CallableFunction)(type, props, key);
  }
  return (reactJsxs as CallableFunction)(type, translateElementProps(type, props), key);
}

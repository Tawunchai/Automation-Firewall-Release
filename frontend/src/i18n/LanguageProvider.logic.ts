// The language context object and the `useLanguage` hook. The provider stays in
// LanguageProvider.tsx.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import { createContext, useContext } from "react";
import { type Lang } from "./lang";

/**
 * Mirrors the module-level language into React, and makes the switch visible.
 *
 * THE REMOUNT
 * Translation happens in ./jsx-runtime.ts while an element is being built, so a component only
 * speaks the new language once it renders again. Ordinary state propagation does not guarantee
 * that: half this console's tree sits behind `React.memo` or a `useMemo`'d element, whose whole
 * purpose is to NOT re-render when their props are unchanged — and a language switch changes no
 * props at all. The result would be a page half in Thai and half in English, with the half that
 * stayed English being exactly the expensive, memoised parts people notice.
 *
 * So the subtree is keyed by the language and React rebuilds it. Pages remount and refetch, which
 * costs a moment on a switch that happens once a session; the alternative is either a full page
 * reload (worse — it drops the route and every open dialog) or a correctness hole.
 *
 * i18next is kept in step because ~15 files still call `t()` against src/i18n/locales. Their
 * English return values flow through the same dictionary as everything else, so those screens
 * translate either way; changing the language here as well keeps the plural and interpolation rules
 * honest for the handful of keys that use them.
 */

export type LanguageContextValue = {
  lang: Lang;
  setLang: (next: Lang) => void;
};

export const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
});

export const useLanguage = (): LanguageContextValue => useContext(LanguageContext);

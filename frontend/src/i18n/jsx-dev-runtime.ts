/**
 * The development twin of ./jsx-runtime.ts.
 *
 * `@vitejs/plugin-react` emits `jsxDEV` from `<jsxImportSource>/jsx-dev-runtime` in a dev build and
 * `jsx`/`jsxs` from `<jsxImportSource>/jsx-runtime` in a production one. Without this file the dev
 * server would render straight through React's own runtime and nothing would translate until
 * `npm run build` — which is the worst possible place to discover a missing dictionary entry.
 *
 * The translation itself lives in ./jsx-runtime.ts; this only adapts it to jsxDEV's extra
 * arguments (the source location and `this`, which React uses for component stack traces).
 */

import { Fragment as ReactFragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";
import { getLang } from "./lang";
import { translateElementProps } from "./jsx-runtime";

export * from "react/jsx-dev-runtime";

/** Named explicitly for the reason given in ./jsx-runtime.ts — the star loses it in dev. */
export const Fragment = ReactFragment;

type Props = Record<string, unknown>;

export function jsxDEV(
  type: unknown,
  props: Props,
  key: unknown,
  isStatic: boolean,
  source?: unknown,
  self?: unknown,
) {
  const next = getLang() === "en" || props == null ? props : translateElementProps(type, props);
  return (reactJsxDEV as CallableFunction)(type, next, key, isStatic, source, self);
}

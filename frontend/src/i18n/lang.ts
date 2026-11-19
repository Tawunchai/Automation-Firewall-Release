/**
 * The one place that knows which language the console is speaking.
 *
 * This is a module singleton rather than React state, and that is load-bearing. The JSX runtime in
 * ./jsx-runtime.ts asks it on every element it builds — including elements built outside any React
 * tree, which the app really does have: components/ui/toast.tsx renders into its own
 * `createRoot` from promise catches and api-layer code, where there is no provider above it to read
 * a context from. A context-only implementation would leave every toast in English.
 *
 * LanguageProvider mirrors this into React so components re-render when it changes; it does not own
 * it. See ./LanguageProvider.tsx.
 */

export type Lang = "en" | "th" | "zh";

export const LANGS: readonly Lang[] = ["en", "th", "zh"] as const;

const STORAGE_KEY = "console.lang";

export const isLang = (v: unknown): v is Lang =>
  typeof v === "string" && (LANGS as readonly string[]).includes(v);

/**
 * The language to open with.
 *
 * A stored choice wins. Failing that the browser is asked, because a Thai-configured machine
 * showing an English console is a worse first impression than a wrong guess is a problem — and the
 * switcher is two clicks away either way. `navigator.language` is matched on its primary subtag, so
 * `zh-CN`, `zh-TW` and `zh-Hans` all land on `zh`.
 */
function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Private mode, or storage disabled by policy. Fall through to the browser's own setting.
  }
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const primary = tag?.toLowerCase().split("-")[0];
      if (isLang(primary)) return primary;
    }
  } catch {
    // No navigator (SSR, tests).
  }
  return "en";
}

let current: Lang = initialLang();

type Listener = (lang: Lang) => void;
const listeners = new Set<Listener>();

export const getLang = (): Lang => current;

export function setLang(next: Lang): void {
  if (!isLang(next) || next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisting is survivable; not switching is not. Carry on.
  }
  applyDocumentLang(next);
  for (const fn of [...listeners]) fn(next);
}

export function subscribeLang(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Tells the browser and the stylesheet which language is on screen.
 *
 * `lang` drives font fallback, hyphenation and the screen-reader voice; `data-lang` is what
 * index.css hangs the per-language type adjustments off, because Thai needs more line-height than
 * Latin at the same size and Chinese needs none of Noto Sans Thai's ascender room.
 */
export function applyDocumentLang(lang: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
}

applyDocumentLang(current);

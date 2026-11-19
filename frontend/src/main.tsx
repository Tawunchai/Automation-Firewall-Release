import { StrictMode, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import "./i18n";
import { getLang } from "./i18n/lang";
import { ensureLanguage, isLanguageReady } from "./i18n/translate";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in index.html");

const app = (
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </BrowserRouter>
  </StrictMode>
);

function mount() {
  ReactDOM.createRoot(rootEl!).render(app);
}

// Translation happens while an element is being BUILT (src/i18n/jsx-runtime.ts), so the dictionary
// has to be in memory before the first render or the opening screen is English and then repaints.
// English needs nothing and mounts synchronously, exactly as before; a Thai or Chinese session
// waits for its own dictionary — one file, fetched in parallel with the route chunk — and never for
// the other language's.
//
// ── Why this is not split further, though it looks like it should be ─────────
//
// A Thai session blocks its first paint on 95 KB (gzipped) of dictionary, and the source is already
// filed per area of the console — dictionary/th/ai.ts, audit.ts, vpn.ts and so on — so "load only
// the namespace this route needs" is the obvious next optimisation. It does not work here, and the
// reason is worth writing down so nobody spends a day rediscovering it:
//
//   · translate() is a FLAT lookup keyed by the English string itself (src/i18n/translate.ts).
//     There are no namespaces at runtime; a string does not know which file it came from.
//   · The strings are not partitioned by route either. Shared components, toasts and API error
//     messages appear on every page, so any per-route subset is missing strings that page renders.
//   · A missed lookup does not retry. Translation happens at element-build time and much of this
//     tree is memoised, so a string that rendered English before its chunk arrived STAYS English
//     until something remounts it — which is the half-translated screen LanguageProvider's remount
//     comment exists to prevent.
//
// The 95 KB is the price of translating plain JSX with no t() calls at 2,500 sites. Making it
// smaller means giving the dictionary a namespace the lookup can use, which is a different design,
// not a tweak to this one.
if (isLanguageReady(getLang())) {
  mount();
} else {
  void ensureLanguage(getLang()).then(mount);
}

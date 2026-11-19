# i18n — and why there are two systems here

The console ships in **English, Thai and Chinese**. English is the source language: it is what you
write in the components, and it is also the lookup key.

There are **two** translation mechanisms in this codebase. That is not an accident left half-done;
it is a migration that was stopped on purpose, and the remaining 14 files are the reason.

## 1. Render-time translation — the one to use

Components contain plain English. No `t()`, no keys, no imports:

```tsx
<button>Create New</button>
```

`translate.ts` walks what React is about to render and swaps the strings for the active language,
looking each one up by its **exact English text** in `dictionary/<lang>/*.ts`. A string with no
entry renders as the English it already was, so a missing translation is never a crash or a raw
`some.dotted.key` on screen.

**Adding or changing a user-visible string:**

```bash
node scripts/i18n-extract.mjs                       # rebuild scripts/i18n-strings.json
node scripts/run-vitest.mjs run src/i18n/dictionary.test.ts
```

Commit the regenerated `i18n-strings.json` together with the `th`/`zh` entries. If the string
should stay English in every language, add it to `dictionary/keep.ts` instead.

> The inventory finds **missing** strings, not **unused** ones. Do not prune translations against
> it — a pass that did this once wanted to delete `CPU {}% · RAM {}%`, which is live.

## 2. i18next `useTranslation()` — legacy, 14 files

These predate the render-time system and still call `t("some.key")` against `locales/`:

```
components/structure/navbar/index.tsx        pages/account/index.tsx
components/structure/navbar/UserProfile.tsx  pages/account/data/index.tsx
components/ui/OtpModal.tsx                   pages/account/profile/index.tsx
components/ui/UserFormModal.tsx              pages/authentication/index.tsx
pages/calendar/index.tsx                     pages/authentication/auth-code-view.tsx
pages/password-policy/index.tsx              pages/service/index.tsx
pages/user/index.tsx
```

(plus `OtpModal.render.test.tsx`, which mocks `react-i18next`.)

**Do not remove i18next to tidy up.** Every one of those screens reads its text from `locales/`,
and with the provider gone they render raw dotted keys — fourteen broken screens, including the
login page and the whole Account area. The dependency is small and it works.

If you do want one system, the migration is per file and reversible: replace each `t("a.b.c")`
with the English sentence it resolves to, drop the `useTranslation` import, re-run the extractor,
and fill in `th`/`zh`. Doing it a screen at a time keeps every step shippable.

## Files

| file | what it does |
|---|---|
| `translate.ts` | the render-time walker and the lookup |
| `dictionary/<lang>/*.ts` | English sentence → translation. Split by area; `th/audit.ts` is the largest |
| `dictionary/keep.ts` | strings that stay English in every language |
| `locales/` | the i18next JSON the 14 legacy files read |
| `LanguageProvider.tsx` | current language, persistence, and the lazy chunk load |
| `lang.ts` | the language list and detection |

## One gate to know about

`th/ai.ts`, `th/audit.ts`, `th/common.ts`, `th/security.ts` and `zh/audit.ts` are capped by
**`backend/test/layout-budget-bytes.json`** and may not grow. Editing one of them and running only
the frontend gates will miss it — the check lives in `go test ./...`.

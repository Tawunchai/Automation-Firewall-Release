import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Accessibility, added with the Modal focus trap in Phase 4. It runs as the RECOMMENDED
      // set rather than strict: recommended is the part that catches real barriers — a
      // click handler on a div with no keyboard equivalent, an image with no alt, a label
      // pointing at nothing — while strict adds stylistic rules that would have started
      // this at hundreds of findings and taught everyone to skip it.
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // An underscore prefix is the conventional way to say "this parameter exists to satisfy a
      // signature and is intentionally not read" — `remoteAccessDeviceSupported(_s)` returns true
      // for every template but has to keep the argument its callers pass. Without this option the
      // only ways to silence it are deleting a parameter callers rely on, or a disable comment on
      // each one; naming the convention once is better than either.
      //
      // Deliberately narrow: it applies to arguments and caught errors, never to unused local
      // variables or imports, which stay errors.
      // A <label> that WRAPS its input is a valid association and needs no htmlFor. The rule only
      // looks two elements deep by default, so the console's wrapping labels — which put the input
      // inside a flex row for layout — were reported as unlabelled. Raising the depth leaves only
      // the real cases: a label that is a SIBLING of its input with nothing tying them together,
      // where clicking the text does not focus the field and a screen reader announces neither.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 4 }],

      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '',
      }],
    },
  },
])
